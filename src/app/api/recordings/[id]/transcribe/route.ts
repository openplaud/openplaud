import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { OpenAI } from "openai";
import { db } from "@/db";
import {
    apiCredentials,
    plaudConnections,
    recordings,
    transcriptions,
    userSettings,
} from "@/db/schema";
import { generateTitleFromTranscription } from "@/lib/ai/generate-title";
import { auth } from "@/lib/auth";
import { decrypt } from "@/lib/encryption";
import { createPlaudClient } from "@/lib/plaud/client";
import { createUserStorageProvider } from "@/lib/storage/factory";
import { postProcessTranscription } from "@/lib/transcription/post-process";
import { trimTrailingSilence } from "@/lib/transcription/trim-silence";
import { audioFilenameWithExt, getAudioMimeType } from "@/lib/utils";

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const { id } = await params;

        // Verify the recording belongs to the user
        const [recording] = await db
            .select({ id: recordings.id })
            .from(recordings)
            .where(
                and(
                    eq(recordings.id, id),
                    eq(recordings.userId, session.user.id),
                ),
            )
            .limit(1);

        if (!recording) {
            return NextResponse.json(
                { error: "Recording not found" },
                { status: 404 },
            );
        }

        const [existing] = await db
            .select({ id: transcriptions.id })
            .from(transcriptions)
            .where(
                and(
                    eq(transcriptions.recordingId, id),
                    eq(transcriptions.userId, session.user.id),
                ),
            )
            .limit(1);

        if (!existing) {
            return NextResponse.json(
                { error: "No transcription found" },
                { status: 404 },
            );
        }

        await db
            .delete(transcriptions)
            .where(eq(transcriptions.id, existing.id));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error deleting transcription:", error);
        return NextResponse.json(
            { error: "Failed to delete transcription" },
            { status: 500 },
        );
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const { id } = await params;

        const [recording] = await db
            .select()
            .from(recordings)
            .where(
                and(
                    eq(recordings.id, id),
                    eq(recordings.userId, session.user.id),
                ),
            )
            .limit(1);

        if (!recording) {
            return NextResponse.json(
                { error: "Recording not found" },
                { status: 404 },
            );
        }

        // Get user's transcription API credentials
        const [credentials] = await db
            .select()
            .from(apiCredentials)
            .where(
                and(
                    eq(apiCredentials.userId, session.user.id),
                    eq(apiCredentials.isDefaultTranscription, true),
                ),
            )
            .limit(1);

        if (!credentials) {
            return NextResponse.json(
                { error: "No transcription API configured" },
                { status: 400 },
            );
        }

        // Get storage provider and download audio
        const storage = await createUserStorageProvider(session.user.id);
        const rawAudioBuffer = await storage.downloadFile(
            recording.storagePath,
        );
        // Trim trailing silence to prevent end-of-audio hallucinations
        const audioBuffer = await trimTrailingSilence(
            rawAudioBuffer,
            recording.storagePath,
        );

        // Speaches streaming path
        if (
            credentials.provider === "Speaches" &&
            credentials.streamingEnabled
        ) {
            const baseUrl = credentials.baseUrl || "http://localhost:8000/v1";
            const model = credentials.defaultModel || "whisper-1";
            const apiKey = decrypt(credentials.apiKey);

            // Build FormData for Speaches streaming request
            const formData = new FormData();
            formData.append(
                "file",
                new File(
                    [new Uint8Array(audioBuffer)],
                    audioFilenameWithExt(recording.storagePath),
                    { type: getAudioMimeType(recording.storagePath) },
                ),
            );
            formData.append("model", model);
            formData.append("stream", "true");

            // Use a 10-minute timeout — large recordings may take a while to
            // process, and undici's default 30 s headersTimeout would fire first.
            const speachesResponse = await fetch(
                `${baseUrl}/audio/transcriptions`,
                {
                    method: "POST",
                    headers: { Authorization: `Bearer ${apiKey}` },
                    body: formData,
                    signal: AbortSignal.timeout(600_000),
                },
            );

            if (!speachesResponse.ok) {
                const errorText = await speachesResponse.text();
                throw new Error(
                    `Speaches request failed (${speachesResponse.status}): ${errorText}`,
                );
            }

            const contentType =
                speachesResponse.headers.get("content-type") ?? "";

            if (!contentType.includes("text/event-stream")) {
                // Speaches returned regular JSON (older version or streaming unsupported)
                // Fall back to parsing it like the standard path
                const json = (await speachesResponse.json()) as {
                    text?: string;
                };
                const rawText = json.text ?? "";
                const transcriptionText = postProcessTranscription(rawText);
                const detectedLanguage = null;

                await saveTranscription(
                    id,
                    session.user.id,
                    transcriptionText,
                    detectedLanguage,
                    credentials,
                );
                await runTitleGeneration(
                    id,
                    session.user.id,
                    recording,
                    transcriptionText,
                );

                return NextResponse.json({
                    transcription: transcriptionText,
                    detectedLanguage,
                });
            }

            const encoder = new TextEncoder();

            const stream = new ReadableStream({
                async start(controller) {
                    const send = (data: Record<string, unknown>) => {
                        controller.enqueue(
                            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
                        );
                    };

                    // Send SSE comment heartbeats every 15 s so reverse proxies
                    // with short read timeouts don't close the connection while
                    // Speaches processes long recordings.
                    const heartbeat = setInterval(() => {
                        try {
                            controller.enqueue(
                                encoder.encode(": heartbeat\n\n"),
                            );
                        } catch {
                            clearInterval(heartbeat);
                        }
                    }, 15_000);

                    try {
                        const reader = speachesResponse.body?.getReader();
                        if (!reader)
                            throw new Error(
                                "Speaches response body is not readable",
                            );
                        const decoder = new TextDecoder();
                        let buffer = "";
                        let accumulatedText = "";

                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;

                            buffer += decoder.decode(value, { stream: true });
                            const blocks = buffer.split("\n\n");
                            buffer = blocks.pop() ?? "";

                            for (const block of blocks) {
                                const line = block.trim();
                                if (!line.startsWith("data:")) continue;
                                const jsonStr = line.slice(5).trim();
                                if (!jsonStr) continue;

                                let event: {
                                    type: string;
                                    delta?: string;
                                    transcript?: string;
                                };
                                try {
                                    event = JSON.parse(jsonStr);
                                } catch {
                                    continue;
                                }

                                if (
                                    event.type === "transcript.text.delta" &&
                                    event.delta
                                ) {
                                    accumulatedText += event.delta;
                                    send({ type: "chunk", text: event.delta });
                                } else if (
                                    event.type === "transcript.text.done"
                                ) {
                                    // Use the authoritative full transcript from done event
                                    if (event.transcript) {
                                        accumulatedText = event.transcript;
                                    }
                                }
                            }
                        }

                        // Post-process and persist
                        const transcriptionText =
                            postProcessTranscription(accumulatedText);
                        await saveTranscription(
                            id,
                            session.user.id,
                            transcriptionText,
                            null,
                            credentials,
                        );
                        await runTitleGeneration(
                            id,
                            session.user.id,
                            recording,
                            transcriptionText,
                        );

                        clearInterval(heartbeat);
                        send({
                            type: "done",
                            transcription: transcriptionText,
                            detectedLanguage: null,
                        });
                        controller.close();
                    } catch (err) {
                        clearInterval(heartbeat);
                        console.error("Speaches streaming error:", err);
                        send({
                            type: "error",
                            message:
                                err instanceof Error
                                    ? err.message
                                    : "Transcription failed",
                        });
                        controller.close();
                    }
                },
            });

            return new Response(stream, {
                headers: {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    Connection: "keep-alive",
                },
            });
        }

        // Standard (non-streaming) path for all other providers
        const apiKey = decrypt(credentials.apiKey);

        // Create OpenAI client (works with all OpenAI-compatible APIs)
        const openai = new OpenAI({
            apiKey,
            baseURL: credentials.baseUrl || undefined,
        });

        // Create a File object for the transcription API.
        // Use the correct MIME type and a filename that carries the right
        // extension — some servers (e.g. faster-whisper / Speaches) rely on
        // the filename extension for audio format detection.
        const audioFile = new File(
            [new Uint8Array(audioBuffer)],
            audioFilenameWithExt(recording.storagePath),
            { type: getAudioMimeType(recording.storagePath) },
        );

        // Transcribe with verbose JSON to get language detection
        const transcription = await openai.audio.transcriptions.create({
            file: audioFile,
            model: credentials.defaultModel || "whisper-1",
            response_format: "verbose_json",
        });

        type VerboseTranscription = {
            text: string;
            language?: string | null;
            segments?: Array<{
                text: string;
                start?: number;
                end?: number;
                avg_logprob?: number;
                compression_ratio?: number;
                no_speech_prob?: number;
            }>;
        };

        // Extract text, segments and detected language from response
        const rawText =
            typeof transcription === "string"
                ? transcription
                : (transcription as VerboseTranscription).text;

        const segments =
            typeof transcription === "string"
                ? undefined
                : ((transcription as VerboseTranscription).segments ??
                  undefined);

        // Filter out hallucination loops before saving
        const transcriptionText = postProcessTranscription(rawText, segments);

        const detectedLanguage =
            typeof transcription === "string"
                ? null
                : (transcription as VerboseTranscription).language || null;

        await saveTranscription(
            id,
            session.user.id,
            transcriptionText,
            detectedLanguage,
            credentials,
        );
        await runTitleGeneration(
            id,
            session.user.id,
            recording,
            transcriptionText,
        );

        return NextResponse.json({
            transcription: transcriptionText,
            detectedLanguage,
        });
    } catch (error) {
        console.error("Error transcribing:", error);
        return NextResponse.json(
            { error: "Failed to transcribe recording" },
            { status: 500 },
        );
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function saveTranscription(
    recordingId: string,
    userId: string,
    text: string,
    detectedLanguage: string | null,
    credentials: { provider: string; defaultModel: string | null },
) {
    const [existingTranscription] = await db
        .select()
        .from(transcriptions)
        .where(eq(transcriptions.recordingId, recordingId))
        .limit(1);

    if (existingTranscription) {
        await db
            .update(transcriptions)
            .set({
                text,
                detectedLanguage,
                transcriptionType: "server",
                provider: credentials.provider,
                model: credentials.defaultModel || "whisper-1",
            })
            .where(eq(transcriptions.id, existingTranscription.id));
    } else {
        await db.insert(transcriptions).values({
            recordingId,
            userId,
            text,
            detectedLanguage,
            transcriptionType: "server",
            provider: credentials.provider,
            model: credentials.defaultModel || "whisper-1",
        });
    }
}

async function runTitleGeneration(
    recordingId: string,
    userId: string,
    recording: {
        id: string;
        plaudFileId: string;
        filenameModified: boolean;
    },
    transcriptionText: string,
) {
    const [settings] = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, userId))
        .limit(1);

    const autoGenerateTitle = settings?.autoGenerateTitle ?? true;
    const syncTitleToPlaud = settings?.syncTitleToPlaud ?? false;

    if (
        autoGenerateTitle &&
        transcriptionText.trim() &&
        !recording.filenameModified
    ) {
        try {
            const generatedTitle = await generateTitleFromTranscription(
                userId,
                transcriptionText,
            );

            if (generatedTitle) {
                await db
                    .update(recordings)
                    .set({
                        filename: generatedTitle,
                        filenameModified: true,
                        updatedAt: new Date(),
                    })
                    .where(eq(recordings.id, recordingId));

                const isLocallyCreated =
                    recording.plaudFileId.startsWith("split-") ||
                    recording.plaudFileId.startsWith("silence-removed-") ||
                    recording.plaudFileId.startsWith("uploaded-");

                if (
                    syncTitleToPlaud &&
                    !isLocallyCreated &&
                    recording.plaudFileId
                ) {
                    try {
                        const [connection] = await db
                            .select()
                            .from(plaudConnections)
                            .where(eq(plaudConnections.userId, userId))
                            .limit(1);

                        if (connection) {
                            const plaudClient = await createPlaudClient(
                                connection.bearerToken,
                                connection.apiBase,
                            );
                            await plaudClient.updateFilename(
                                recording.plaudFileId,
                                generatedTitle,
                            );
                        }
                    } catch (err) {
                        console.error("Failed to sync title to Plaud:", err);
                    }
                }
            }
        } catch (err) {
            console.error("Failed to generate title:", err);
        }
    }
}
