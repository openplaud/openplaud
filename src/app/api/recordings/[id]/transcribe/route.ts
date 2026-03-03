import { and, eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
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
import { postFormData } from "@/lib/fetch-keepalive";
import { createPlaudClient } from "@/lib/plaud/client";
import { createUserStorageProvider } from "@/lib/storage/factory";
import { postProcessTranscription } from "@/lib/transcription/post-process";
import {
    normalizeForDiarization,
    trimTrailingSilence,
} from "@/lib/transcription/trim-silence";
import { audioFilenameWithExt, getAudioMimeType } from "@/lib/utils";
import type { DiarizedSegment } from "@/types/transcription";

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

        console.log(`[transcribe:${id.slice(0, 8)}] POST received`);

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

        const diarize =
            new URL(request.url).searchParams.get("diarize") === "true";

        console.log(
            `[transcribe:${id.slice(0, 8)}] provider=${credentials.provider} streaming=${credentials.streamingEnabled} diarize=${diarize} model=${credentials.defaultModel}`,
        );

        // Get storage provider
        const storage = await createUserStorageProvider(session.user.id);

        // Speaches diarization path — non-streaming request to Speaches but
        // wrapped in SSE to browser so heartbeats keep the proxy alive.
        if (credentials.provider === "Speaches" && diarize) {
            const baseUrl = credentials.baseUrl || "http://localhost:8000/v1";
            const model = credentials.defaultModel || "whisper-1";
            const apiKey = decrypt(credentials.apiKey);
            const encoder = new TextEncoder();
            const recordingLabel = `[diarize:${id.slice(0, 8)}]`;

            console.log(`${recordingLabel} Starting Speaches diarization`, {
                model,
                baseUrl,
            });

            const stream = new ReadableStream({
                async start(controller) {
                    const send = (data: Record<string, unknown>) => {
                        controller.enqueue(
                            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
                        );
                    };

                    controller.enqueue(
                        encoder.encode('data: {"type":"ping"}\n\n'),
                    );
                    console.log(`${recordingLabel} Initial ping sent`);

                    let heartbeatCount = 0;
                    const heartbeat = setInterval(() => {
                        try {
                            heartbeatCount++;
                            controller.enqueue(
                                encoder.encode('data: {"type":"ping"}\n\n'),
                            );
                            if (
                                heartbeatCount <= 5 ||
                                heartbeatCount % 20 === 0
                            ) {
                                console.log(
                                    `${recordingLabel} Heartbeat #${heartbeatCount} sent`,
                                );
                            }
                        } catch {
                            clearInterval(heartbeat);
                        }
                    }, 3_000);

                    try {
                        send({
                            type: "status",
                            message: "Downloading audio...",
                        });
                        console.log(
                            `${recordingLabel} Downloading audio from storage…`,
                        );
                        const rawAudioBuffer = await storage.downloadFile(
                            recording.storagePath,
                        );
                        console.log(
                            `${recordingLabel} Download complete — ${(rawAudioBuffer.length / 1_048_576).toFixed(1)} MB. Trimming silence…`,
                        );

                        send({
                            type: "status",
                            message: "Removing silence...",
                        });
                        const trimmedBuffer = await trimTrailingSilence(
                            rawAudioBuffer,
                            recording.storagePath,
                        );
                        console.log(
                            `${recordingLabel} Silence trim complete — ${(trimmedBuffer.length / 1_048_576).toFixed(1)} MB. Normalizing for diarization…`,
                        );

                        // Normalize to 16 kHz mono WAV with EBU R128 loudness.
                        // Low-level Plaud recordings cause onnx-diarization to
                        // compute overlapping speaker embeddings → everything
                        // mapped to SPEAKER_00. Normalization separates them.
                        send({
                            type: "status",
                            message: "Preparing audio for speaker detection...",
                        });
                        const {
                            buffer: audioBuffer,
                            mimeType: audioMimeType,
                            filename: audioFilename,
                        } = await normalizeForDiarization(
                            trimmedBuffer,
                            recording.storagePath,
                        );
                        console.log(
                            `${recordingLabel} Normalization complete — ${(audioBuffer.length / 1_048_576).toFixed(1)} MB (${audioFilename}). Sending to Speaches for diarization…`,
                        );

                        // Two-pass approach: Speaches has a separate
                        // /v1/audio/diarization endpoint that returns speaker
                        // labels with timestamps (no text). We transcribe in
                        // parallel to get text with timestamps, then merge.
                        const makeAudioFile = () =>
                            new File(
                                [new Uint8Array(audioBuffer)],
                                audioFilename,
                                { type: audioMimeType },
                            );

                        // Pass 1: Diarization — speaker segments
                        const diarizeForm = new FormData();
                        diarizeForm.append("file", makeAudioFile());

                        // Pass 2: Transcription — verbose_json for timestamps
                        const transcribeForm = new FormData();
                        transcribeForm.append("file", makeAudioFile());
                        transcribeForm.append("model", model);
                        transcribeForm.append(
                            "response_format",
                            "verbose_json",
                        );
                        transcribeForm.append("vad_filter", "true");

                        send({
                            type: "status",
                            message: "Detecting speakers and transcribing...",
                        });
                        const authHeaders = {
                            Authorization: `Bearer ${apiKey}`,
                        };

                        // Use postFormData (node:http with TCP keepalive)
                        // instead of fetch(). Bun's fetch has an idle socket
                        // timeout (~5 min) that kills connections where no
                        // data flows -- diarization on long recordings easily
                        // exceeds that. TCP keepalive probes every 30 s
                        // prevent the connection from being considered idle.
                        const [diarizeResponse, transcribeResponse] =
                            await Promise.all([
                                postFormData(
                                    `${baseUrl}/audio/diarization`,
                                    diarizeForm,
                                    authHeaders,
                                ),
                                postFormData(
                                    `${baseUrl}/audio/transcriptions`,
                                    transcribeForm,
                                    authHeaders,
                                ),
                            ]);

                        console.log(
                            `${recordingLabel} Speaches responded — diarize: HTTP ${diarizeResponse.status}, transcribe: HTTP ${transcribeResponse.status}`,
                        );

                        // Check diarization response
                        if (diarizeResponse.status === 404) {
                            clearInterval(heartbeat);
                            console.error(
                                `${recordingLabel} Diarization endpoint not found (404) — Speaches >= v0.9.0 required`,
                            );
                            send({
                                type: "error",
                                message:
                                    "Speaker detection requires Speaches v0.9.0 or newer.\n" +
                                    "Your Speaches server does not have the /v1/audio/diarization endpoint.\n" +
                                    "Rebuild your Speaches container from source at tag v0.9.0-rc.3 or later.",
                            });
                            controller.close();
                            return;
                        }

                        if (diarizeResponse.status === 500) {
                            const errorText = await diarizeResponse.text();
                            console.error(
                                `${recordingLabel} Speaches diarization 500:`,
                                errorText.slice(0, 500),
                            );
                            clearInterval(heartbeat);
                            const isDiarizationMissing =
                                errorText
                                    .toLowerCase()
                                    .includes("diarization") ||
                                errorText.toLowerCase().includes("onnx");
                            send({
                                type: "error",
                                message: isDiarizationMissing
                                    ? "Speaker detection not available — install onnx-diarization in your Speaches container:\n" +
                                      "docker exec <container> pip install onnx-diarization"
                                    : `Diarization failed: ${errorText.slice(0, 200)}`,
                            });
                            controller.close();
                            return;
                        }

                        if (!diarizeResponse.ok) {
                            const errorText = await diarizeResponse.text();
                            throw new Error(
                                `Speaches diarization failed (${diarizeResponse.status}): ${errorText}`,
                            );
                        }

                        // Retry transcription without vad_filter if it 500'd
                        // (silero-vad not installed)
                        let finalTranscribeResponse = transcribeResponse;
                        if (transcribeResponse.status === 500) {
                            console.log(
                                `${recordingLabel} Transcription 500 with vad_filter — retrying without`,
                            );
                            const retryForm = new FormData();
                            retryForm.append("file", makeAudioFile());
                            retryForm.append("model", model);
                            retryForm.append("response_format", "verbose_json");
                            finalTranscribeResponse = await postFormData(
                                `${baseUrl}/audio/transcriptions`,
                                retryForm,
                                authHeaders,
                            );
                        }

                        if (!finalTranscribeResponse.ok) {
                            const errorText =
                                await finalTranscribeResponse.text();
                            throw new Error(
                                `Speaches transcription failed (${finalTranscribeResponse.status}): ${errorText}`,
                            );
                        }

                        // Parse diarization: {duration, segments: [{start, end, speaker}]}
                        type DiarizeResult = {
                            segments: Array<{
                                start: number;
                                end: number;
                                speaker: string;
                            }>;
                        };
                        // Parse transcription: {text, segments: [{text, start, end, ...}]}
                        type TranscribeResult = {
                            text?: string;
                            segments?: Array<{
                                text: string;
                                start: number;
                                end: number;
                            }>;
                        };

                        const diarizeJson =
                            (await diarizeResponse.json()) as DiarizeResult;
                        const transcribeJson =
                            (await finalTranscribeResponse.json()) as TranscribeResult;

                        const diarizeSegments = diarizeJson.segments ?? [];
                        const transcribeSegments =
                            transcribeJson.segments ?? [];

                        console.log(
                            `${recordingLabel} Diarize: ${diarizeSegments.length} speaker segments. Transcribe: ${transcribeSegments.length} text segments.`,
                        );

                        send({
                            type: "status",
                            message: "Merging speaker data...",
                        });
                        // Merge: assign a speaker to each transcription segment
                        // by finding the diarization segment with the most
                        // temporal overlap.
                        const speakersJsonData: DiarizedSegment[] =
                            transcribeSegments
                                .map((seg) => {
                                    let bestSpeaker = "SPEAKER_00";
                                    let bestOverlap = 0;
                                    for (const dSeg of diarizeSegments) {
                                        const overlap = Math.max(
                                            0,
                                            Math.min(seg.end, dSeg.end) -
                                                Math.max(seg.start, dSeg.start),
                                        );
                                        if (overlap > bestOverlap) {
                                            bestOverlap = overlap;
                                            bestSpeaker = dSeg.speaker;
                                        }
                                    }
                                    return {
                                        speaker: bestSpeaker,
                                        text: seg.text.trim(),
                                        start: seg.start,
                                        end: seg.end,
                                    };
                                })
                                .filter((seg) => seg.text.length > 0);

                        const rawText =
                            transcribeJson.text ??
                            speakersJsonData.map((s) => s.text).join(" ");
                        const transcriptionText =
                            postProcessTranscription(rawText);

                        console.log(
                            `${recordingLabel} Diarization complete — ${speakersJsonData.length} segments, ${transcriptionText.length} chars. Saving…`,
                        );

                        send({
                            type: "status",
                            message: "Saving transcription...",
                        });
                        await saveTranscription(
                            id,
                            session.user.id,
                            transcriptionText,
                            null,
                            credentials,
                            speakersJsonData,
                        );
                        await runTitleGeneration(
                            id,
                            session.user.id,
                            recording,
                            transcriptionText,
                        );

                        clearInterval(heartbeat);
                        console.log(
                            `${recordingLabel} Done. Sending done event.`,
                        );
                        send({
                            type: "done",
                            transcription: transcriptionText,
                            speakersJson: speakersJsonData,
                            detectedLanguage: null,
                        });
                        controller.close();
                    } catch (err) {
                        clearInterval(heartbeat);
                        console.error(
                            `${recordingLabel} Diarization error:`,
                            err,
                        );
                        try {
                            send({
                                type: "error",
                                message:
                                    err instanceof Error
                                        ? err.message
                                        : "Diarization failed",
                            });
                            controller.close();
                        } catch {
                            // controller may already be closed
                        }
                    }
                },
            });

            return new Response(stream, {
                headers: {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache, no-transform",
                    Connection: "keep-alive",
                    "X-Accel-Buffering": "no",
                    "Content-Encoding": "identity",
                },
            });
        }

        // Speaches streaming path — return SSE response *immediately* so the
        // heartbeat keeps the proxy connection alive during the slow
        // download + trim-silence + upload phase. All blocking I/O happens
        // inside ReadableStream.start() AFTER the response headers are sent.
        if (
            credentials.provider === "Speaches" &&
            credentials.streamingEnabled
        ) {
            const baseUrl = credentials.baseUrl || "http://localhost:8000/v1";
            const model = credentials.defaultModel || "whisper-1";
            const apiKey = decrypt(credentials.apiKey);
            const encoder = new TextEncoder();
            const recordingLabel = `[speaches:${id.slice(0, 8)}]`;

            console.log(
                `${recordingLabel} Starting Speaches streaming transcription`,
                { model, baseUrl },
            );

            // Shared state between the ReadableStream and the after() handler.
            // Declared here so after() can read the latest value even if Bun's
            // runtime terminates the ReadableStream context early (e.g. when the
            // client disconnects and "context canceled" bypasses our try/catch).
            let accumulatedText = "";
            let transcriptionSaved = false;

            // after() runs after the response is done — even when the browser
            // disconnects mid-stream.  If the ReadableStream was killed before
            // it could call saveTranscription(), we save whatever was accumulated.
            after(async () => {
                if (transcriptionSaved || accumulatedText.length === 0) return;
                console.log(
                    `${recordingLabel} after(): client disconnected — saving ${accumulatedText.length} chars`,
                );
                try {
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
                    console.log(
                        `${recordingLabel} after(): transcription saved (${transcriptionText.length} chars)`,
                    );
                } catch (saveErr) {
                    console.error(
                        `${recordingLabel} after(): save failed:`,
                        saveErr,
                    );
                }
            });

            const stream = new ReadableStream({
                async start(controller) {
                    const send = (data: Record<string, unknown>) => {
                        controller.enqueue(
                            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
                        );
                    };

                    // Send an immediate ping so nginx/other proxies flush the
                    // SSE response headers to the browser right away.  Without
                    // this, proxy buffering keeps the headers held until the
                    // first body chunk arrives (~10 s later at the first
                    // heartbeat), by which point proxy_read_timeout may have
                    // already closed the connection and replaced our SSE
                    // response with a 504 error page.
                    controller.enqueue(
                        encoder.encode('data: {"type":"ping"}\n\n'),
                    );
                    console.log(`${recordingLabel} Initial ping sent`);

                    // Continue heartbeats every 3 s to reset proxy read-idle
                    // timers while the slow download + silence-detect + upload
                    // phases run.  3 s is intentionally short: HAProxy (and
                    // some other intermediaries) close SSE connections if no
                    // data arrives for ~9–10 s, so we must beat that deadline
                    // comfortably.
                    let heartbeatCount = 0;
                    const heartbeat = setInterval(() => {
                        try {
                            heartbeatCount++;
                            controller.enqueue(
                                encoder.encode('data: {"type":"ping"}\n\n'),
                            );
                            if (
                                heartbeatCount <= 5 ||
                                heartbeatCount % 20 === 0
                            ) {
                                console.log(
                                    `${recordingLabel} Heartbeat #${heartbeatCount} sent`,
                                );
                            }
                        } catch {
                            clearInterval(heartbeat);
                            console.log(
                                `${recordingLabel} Heartbeat failed — stream cancelled by client`,
                            );
                        }
                    }, 3_000);

                    try {
                        // Slow I/O runs here, inside the stream, so SSE headers
                        // are already sent and heartbeats are flowing.
                        send({
                            type: "status",
                            message: "Downloading audio...",
                        });
                        console.log(
                            `${recordingLabel} Downloading audio from storage…`,
                        );
                        const rawAudioBuffer = await storage.downloadFile(
                            recording.storagePath,
                        );
                        console.log(
                            `${recordingLabel} Download complete — ${(rawAudioBuffer.length / 1_048_576).toFixed(1)} MB. Trimming silence…`,
                        );

                        send({
                            type: "status",
                            message: "Removing silence...",
                        });
                        const audioBuffer = await trimTrailingSilence(
                            rawAudioBuffer,
                            recording.storagePath,
                        );
                        console.log(
                            `${recordingLabel} Silence trim complete — ${(audioBuffer.length / 1_048_576).toFixed(1)} MB. Uploading to Speaches…`,
                        );

                        send({
                            type: "status",
                            message: "Uploading to transcription server...",
                        });
                        // Build FormData for Speaches. Re-usable so we can
                        // retry without vad_filter if the first attempt fails.
                        const makeFormData = (withVadFilter: boolean) => {
                            const fd = new FormData();
                            fd.append(
                                "file",
                                new File(
                                    [new Uint8Array(audioBuffer)],
                                    audioFilenameWithExt(recording.storagePath),
                                    {
                                        type: getAudioMimeType(
                                            recording.storagePath,
                                        ),
                                    },
                                ),
                            );
                            fd.append("model", model);
                            fd.append("stream", "true");
                            if (withVadFilter) {
                                // Silero VAD — skips non-speech segments before
                                // Whisper, preventing trailing hallucinations.
                                // Requires silero-vad in the Speaches environment.
                                fd.append("vad_filter", "true");
                            }
                            return fd;
                        };

                        let speachesResponse = await fetch(
                            `${baseUrl}/audio/transcriptions`,
                            {
                                method: "POST",
                                headers: { Authorization: `Bearer ${apiKey}` },
                                body: makeFormData(true),
                            },
                        );

                        // HTTP 500 with vad_filter usually means silero-vad is
                        // not installed in the Speaches environment. Retry once
                        // without it so transcription still works for everyone.
                        if (speachesResponse.status === 500) {
                            console.log(
                                `${recordingLabel} Speaches returned 500 with vad_filter — retrying without (silero-vad likely not installed)`,
                            );
                            speachesResponse = await fetch(
                                `${baseUrl}/audio/transcriptions`,
                                {
                                    method: "POST",
                                    headers: {
                                        Authorization: `Bearer ${apiKey}`,
                                    },
                                    body: makeFormData(false),
                                },
                            );
                        }

                        console.log(
                            `${recordingLabel} Speaches responded — HTTP ${speachesResponse.status}, content-type: ${speachesResponse.headers.get("content-type")}`,
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
                            // Speaches returned regular JSON (older version or
                            // streaming unsupported) — parse and forward as done.
                            console.log(
                                `${recordingLabel} Non-SSE response — parsing JSON fallback`,
                            );
                            const json = (await speachesResponse.json()) as {
                                text?: string;
                            };
                            const rawText = json.text ?? "";
                            const transcriptionText =
                                postProcessTranscription(rawText);

                            send({
                                type: "status",
                                message: "Saving transcription...",
                            });
                            await saveTranscription(
                                id,
                                session.user.id,
                                transcriptionText,
                                null,
                                credentials,
                            );
                            transcriptionSaved = true;
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
                            return;
                        }

                        console.log(
                            `${recordingLabel} SSE stream open — reading Speaches chunks…`,
                        );
                        const reader = speachesResponse.body?.getReader();
                        if (!reader)
                            throw new Error(
                                "Speaches response body is not readable",
                            );
                        const decoder = new TextDecoder();
                        let buffer = "";
                        let chunkCount = 0;

                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) {
                                // Flush remaining TextDecoder bytes and process any trailing SSE block.
                                buffer += decoder.decode();
                                if (buffer.trim()) {
                                    const trailingBlocks = buffer.split("\n\n");
                                    for (const block of trailingBlocks) {
                                        let jsonStr = "";
                                        for (const line of block.split("\n")) {
                                            const trimmed = line.trim();
                                            if (trimmed.startsWith("data:")) {
                                                jsonStr = trimmed
                                                    .slice(5)
                                                    .trim();
                                            }
                                        }
                                        if (!jsonStr) continue;
                                        try {
                                            const data = JSON.parse(jsonStr);
                                            const delta =
                                                data.delta ?? data.text ?? "";
                                            if (delta) {
                                                accumulatedText += delta;
                                                chunkCount++;
                                            }
                                        } catch {
                                            // ignore unparseable trailing data
                                        }
                                    }
                                }
                                console.log(
                                    `${recordingLabel} Speaches SSE stream closed (reader done). Chunks received: ${chunkCount}, accumulated chars: ${accumulatedText.length}`,
                                );
                                break;
                            }

                            buffer += decoder.decode(value, { stream: true });
                            const blocks = buffer.split("\n\n");
                            buffer = blocks.pop() ?? "";

                            for (const block of blocks) {
                                // Parse all lines in the SSE block.
                                // Speaches uses the SSE protocol "event:" field for
                                // the event type, NOT a "type" field inside the JSON.
                                // Format:
                                //   event: transcript.text.delta
                                //   data: {"delta": "hello "}
                                let sseEventType = "";
                                let jsonStr = "";

                                for (const line of block.split("\n")) {
                                    const trimmed = line.trim();
                                    if (trimmed.startsWith("event:")) {
                                        sseEventType = trimmed.slice(6).trim();
                                    } else if (trimmed.startsWith("data:")) {
                                        jsonStr = trimmed.slice(5).trim();
                                    }
                                    // ignore comment lines (": heartbeat")
                                }

                                if (!jsonStr) continue;

                                let data: {
                                    type?: string;
                                    delta?: string;
                                    transcript?: string;
                                    text?: string; // Format B: plain Speaches segment
                                };
                                try {
                                    data = JSON.parse(jsonStr);
                                } catch {
                                    console.warn(
                                        `${recordingLabel} Failed to parse SSE data:`,
                                        jsonStr.slice(0, 200),
                                    );
                                    continue;
                                }

                                // Prefer SSE protocol "event:" field; fall back to
                                // JSON "type" field for any future format changes.
                                const eventType =
                                    sseEventType || data.type || "";

                                if (
                                    eventType === "transcript.text.delta" &&
                                    data.delta
                                ) {
                                    // Format A: named SSE event + delta field
                                    accumulatedText += data.delta;
                                    chunkCount++;
                                    if (chunkCount === 1) {
                                        console.log(
                                            `${recordingLabel} First transcript chunk received`,
                                        );
                                    } else if (chunkCount % 50 === 0) {
                                        console.log(
                                            `${recordingLabel} ${chunkCount} chunks, ${accumulatedText.length} chars so far`,
                                        );
                                    }
                                    send({ type: "chunk", text: data.delta });
                                } else if (
                                    eventType === "transcript.text.done"
                                ) {
                                    // Format A: named done event with authoritative transcript
                                    console.log(
                                        `${recordingLabel} transcript.text.done received — ${data.transcript?.length ?? 0} chars`,
                                    );
                                    if (data.transcript) {
                                        accumulatedText = data.transcript;
                                    }
                                } else if (
                                    typeof data.text === "string" &&
                                    data.text
                                ) {
                                    // Format B: plain {"text": "..."} segment
                                    // (Speaches default streaming format — no event: header,
                                    // no type field, just a text field per segment)
                                    accumulatedText += data.text;
                                    chunkCount++;
                                    if (chunkCount === 1) {
                                        console.log(
                                            `${recordingLabel} First transcript chunk received (plain-text format)`,
                                        );
                                    } else if (chunkCount % 50 === 0) {
                                        console.log(
                                            `${recordingLabel} ${chunkCount} chunks, ${accumulatedText.length} chars so far`,
                                        );
                                    }
                                    send({ type: "chunk", text: data.text });
                                } else {
                                    console.log(
                                        `${recordingLabel} Unhandled SSE event — event="${eventType}" data keys=[${Object.keys(data).join(",")}]`,
                                    );
                                }
                            }
                        }

                        // Post-process and persist
                        send({
                            type: "status",
                            message: "Saving transcription...",
                        });
                        console.log(
                            `${recordingLabel} Post-processing ${accumulatedText.length} chars…`,
                        );
                        const transcriptionText =
                            postProcessTranscription(accumulatedText);
                        console.log(
                            `${recordingLabel} Saving transcription (${transcriptionText.length} chars)…`,
                        );
                        await saveTranscription(
                            id,
                            session.user.id,
                            transcriptionText,
                            null,
                            credentials,
                        );
                        transcriptionSaved = true;
                        console.log(
                            `${recordingLabel} Transcription saved. Running title generation…`,
                        );
                        await runTitleGeneration(
                            id,
                            session.user.id,
                            recording,
                            transcriptionText,
                        );

                        clearInterval(heartbeat);
                        console.log(
                            `${recordingLabel} Done. Sending done event.`,
                        );
                        send({
                            type: "done",
                            transcription: transcriptionText,
                            detectedLanguage: null,
                        });
                        controller.close();
                    } catch (err) {
                        clearInterval(heartbeat);

                        // Speaches (and some other servers) close the streaming
                        // connection with TCP RST instead of a clean FIN after
                        // sending all data.  Bun's fetch surfaces this as an
                        // ECONNRESET.  If we already have accumulated text the
                        // stream completed normally — save it and send "done".
                        if (accumulatedText.length > 0) {
                            console.log(
                                `${recordingLabel} Speaches connection reset after receiving ${accumulatedText.length} chars — treating as done`,
                            );
                            try {
                                const transcriptionText =
                                    postProcessTranscription(accumulatedText);
                                await saveTranscription(
                                    id,
                                    session.user.id,
                                    transcriptionText,
                                    null,
                                    credentials,
                                );
                                transcriptionSaved = true;
                                await runTitleGeneration(
                                    id,
                                    session.user.id,
                                    recording,
                                    transcriptionText,
                                );
                                send({
                                    type: "done",
                                    transcription: transcriptionText,
                                    detectedLanguage: null,
                                });
                                controller.close();
                            } catch (saveErr) {
                                console.error(
                                    `${recordingLabel} Failed to save partial transcript:`,
                                    saveErr,
                                );
                                try {
                                    send({
                                        type: "error",
                                        message: "Failed to save transcription",
                                    });
                                    controller.close();
                                } catch {
                                    /* controller already closed */
                                }
                            }
                            return;
                        }

                        console.error(
                            `${recordingLabel} Speaches streaming error:`,
                            err,
                        );
                        try {
                            send({
                                type: "error",
                                message:
                                    err instanceof Error
                                        ? err.message
                                        : "Transcription failed",
                            });
                            controller.close();
                        } catch {
                            // controller may already be closed (client disconnect)
                        }
                    }
                },
            });

            return new Response(stream, {
                headers: {
                    "Content-Type": "text/event-stream",
                    // no-transform: tells HAProxy (and any other proxy) NOT to
                    // gzip-compress this response.  Gzip on SSE buffers all
                    // events until the stream closes, so the client never sees
                    // individual chunks — it gets everything at once at the end.
                    "Cache-Control": "no-cache, no-transform",
                    Connection: "keep-alive",
                    // Disable nginx proxy buffering so SSE events reach the
                    // client immediately instead of being held until the buffer fills.
                    "X-Accel-Buffering": "no",
                    // Explicitly signal no content-encoding so proxies don't
                    // compress the stream.
                    "Content-Encoding": "identity",
                },
            });
        }

        // Standard (non-streaming) path for all other providers
        const rawAudioBuffer = await storage.downloadFile(
            recording.storagePath,
        );
        // Trim trailing silence to prevent end-of-audio hallucinations
        const audioBuffer = await trimTrailingSilence(
            rawAudioBuffer,
            recording.storagePath,
        );

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
        console.log(
            `[transcribe:${id.slice(0, 8)}] Sending to ${credentials.provider} (${credentials.defaultModel}) — ${(audioBuffer.length / 1_048_576).toFixed(1)} MB`,
        );
        const transcription = await openai.audio.transcriptions.create({
            file: audioFile,
            model: credentials.defaultModel || "whisper-1",
            response_format: "verbose_json",
        });
        console.log(
            `[transcribe:${id.slice(0, 8)}] ${credentials.provider} responded OK`,
        );

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
        const message =
            error instanceof Error
                ? error.message
                : "Failed to transcribe recording";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function saveTranscription(
    recordingId: string,
    userId: string,
    text: string,
    detectedLanguage: string | null,
    credentials: { provider: string; defaultModel: string | null },
    speakersJson?: DiarizedSegment[],
) {
    const speakersJsonStr = speakersJson ? JSON.stringify(speakersJson) : null;

    const [existingTranscription] = await db
        .select()
        .from(transcriptions)
        .where(
            and(
                eq(transcriptions.recordingId, recordingId),
                eq(transcriptions.userId, userId),
            ),
        )
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
                speakersJson: speakersJsonStr,
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
            speakersJson: speakersJsonStr,
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
                const updateResult = await db
                    .update(recordings)
                    .set({
                        filename: generatedTitle,
                        filenameModified: true,
                        updatedAt: new Date(),
                    })
                    .where(
                        and(
                            eq(recordings.id, recordingId),
                            eq(recordings.filenameModified, false),
                        ),
                    );

                // Only sync to Plaud if we actually updated the local title.
                // The conditional WHERE can no-op if a concurrent user rename
                // already set filenameModified=true.
                const rowsUpdated = updateResult.rowCount ?? 0;

                const isLocallyCreated =
                    recording.plaudFileId.startsWith("split-") ||
                    recording.plaudFileId.startsWith("silence-removed-") ||
                    recording.plaudFileId.startsWith("uploaded-");

                if (
                    rowsUpdated > 0 &&
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
