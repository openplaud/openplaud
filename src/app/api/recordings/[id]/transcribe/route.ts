import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { OpenAI } from "openai";
import { db } from "@/db";
import { apiCredentials, plaudConnections, recordings, transcriptions, userSettings } from "@/db/schema";
import { auth } from "@/lib/auth";
import { generateTitleFromTranscription } from "@/lib/ai/generate-title";
import { decrypt } from "@/lib/encryption";
import { createPlaudClient } from "@/lib/plaud/client";
import { createUserStorageProvider } from "@/lib/storage/factory";

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

        // Decrypt API key
        const apiKey = decrypt(credentials.apiKey);

        // Create OpenAI client (works with all OpenAI-compatible APIs)
        const openai = new OpenAI({
            apiKey,
            baseURL: credentials.baseUrl || undefined,
        });

        // Get storage provider and download audio
        const storage = await createUserStorageProvider(session.user.id);
        const audioBuffer = await storage.downloadFile(recording.storagePath);

        // Create a File object for the transcription API
        // Determine content type from storage path
        const contentType = recording.storagePath.endsWith(".mp3")
            ? "audio/mpeg"
            : "audio/opus";
        const audioFile = new File(
            [new Uint8Array(audioBuffer)],
            recording.filename,
            {
                type: contentType,
            },
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
        };

        // Extract text and detected language from response
        const transcriptionText =
            typeof transcription === "string"
                ? transcription
                : (transcription as VerboseTranscription).text;

        const detectedLanguage =
            typeof transcription === "string"
                ? null
                : (transcription as VerboseTranscription).language || null;

        // Save transcription
        const [existingTranscription] = await db
            .select()
            .from(transcriptions)
            .where(eq(transcriptions.recordingId, id))
            .limit(1);

        if (existingTranscription) {
            await db
                .update(transcriptions)
                .set({
                    text: transcriptionText,
                    detectedLanguage,
                    transcriptionType: "server",
                    provider: credentials.provider,
                    model: credentials.defaultModel || "whisper-1",
                })
                .where(eq(transcriptions.id, existingTranscription.id));
        } else {
            await db.insert(transcriptions).values({
                recordingId: id,
                userId: session.user.id,
                text: transcriptionText,
                detectedLanguage,
                transcriptionType: "server",
                provider: credentials.provider,
                model: credentials.defaultModel || "whisper-1",
            });
        }

        // Run title generation if the user has it enabled
        const [settings] = await db
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, session.user.id))
            .limit(1);

        const autoGenerateTitle = settings?.autoGenerateTitle ?? true;
        const syncTitleToPlaud = settings?.syncTitleToPlaud ?? false;

        if (autoGenerateTitle && transcriptionText.trim()) {
            try {
                const generatedTitle = await generateTitleFromTranscription(
                    session.user.id,
                    transcriptionText,
                );

                if (generatedTitle) {
                    await db
                        .update(recordings)
                        .set({ filename: generatedTitle, filenameModified: true, updatedAt: new Date() })
                        .where(eq(recordings.id, id));

                    if (syncTitleToPlaud) {
                        try {
                            const [connection] = await db
                                .select()
                                .from(plaudConnections)
                                .where(eq(plaudConnections.userId, session.user.id))
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
