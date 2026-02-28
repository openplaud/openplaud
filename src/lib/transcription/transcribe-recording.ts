import { and, eq } from "drizzle-orm";
import { OpenAI } from "openai";
import type {
    TranscriptionDiarized,
    TranscriptionVerbose,
} from "openai/resources/audio/transcriptions";
import { db } from "@/db";
import {
    apiCredentials,
    plaudConnections,
    recordings,
    transcriptions,
    userSettings,
} from "@/db/schema";
import { generateTitleFromTranscription } from "@/lib/ai/generate-title";
import { decrypt } from "@/lib/encryption";
import { createPlaudClient } from "@/lib/plaud/client";
import { createUserStorageProvider } from "@/lib/storage/factory";
import { postProcessTranscription } from "@/lib/transcription/post-process";
import { trimTrailingSilence } from "@/lib/transcription/trim-silence";
import { audioFilenameWithExt, getAudioMimeType } from "@/lib/utils";

export async function transcribeRecording(
    userId: string,
    recordingId: string,
): Promise<{ success: boolean; error?: string }> {
    try {
        const [recording] = await db
            .select()
            .from(recordings)
            .where(
                and(
                    eq(recordings.id, recordingId),
                    eq(recordings.userId, userId),
                ),
            )
            .limit(1);

        if (!recording) {
            return { success: false, error: "Recording not found" };
        }

        const [existingTranscription] = await db
            .select()
            .from(transcriptions)
            .where(eq(transcriptions.recordingId, recordingId))
            .limit(1);

        if (existingTranscription?.text) {
            return { success: true };
        }

        const [credentials] = await db
            .select()
            .from(apiCredentials)
            .where(
                and(
                    eq(apiCredentials.userId, userId),
                    eq(apiCredentials.isDefaultTranscription, true),
                ),
            )
            .limit(1);

        if (!credentials) {
            return { success: false, error: "No transcription API configured" };
        }

        const [settings] = await db
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, userId))
            .limit(1);

        const defaultLanguage =
            settings?.defaultTranscriptionLanguage || undefined;
        const quality = settings?.transcriptionQuality || "balanced";
        const autoGenerateTitle = settings?.autoGenerateTitle ?? true;
        const syncTitleToPlaud = settings?.syncTitleToPlaud ?? false;

        void quality;

        const apiKey = decrypt(credentials.apiKey);
        const openai = new OpenAI({
            apiKey,
            baseURL: credentials.baseUrl || undefined,
        });

        const storage = await createUserStorageProvider(userId);
        const rawAudioBuffer = await storage.downloadFile(
            recording.storagePath,
        );
        // Trim trailing silence to prevent end-of-audio hallucinations
        const audioBuffer = await trimTrailingSilence(
            rawAudioBuffer,
            recording.storagePath,
        );

        const audioFile = new File(
            [new Uint8Array(audioBuffer)],
            audioFilenameWithExt(recording.storagePath),
            { type: getAudioMimeType(recording.storagePath) },
        );

        const model = credentials.defaultModel || "whisper-1";

        const isGpt4o = model.startsWith("gpt-4o");
        const supportsDiarizedJson =
            model.includes("diarize") || model.includes("diarized");

        const responseFormat = supportsDiarizedJson
            ? ("diarized_json" as const)
            : isGpt4o
              ? ("json" as const)
              : ("verbose_json" as const);

        const transcription = await openai.audio.transcriptions.create({
            file: audioFile,
            model,
            response_format: responseFormat,
            ...(defaultLanguage ? { language: defaultLanguage } : {}),
        });

        let transcriptionText: string;
        let detectedLanguage: string | null = null;

        if (supportsDiarizedJson) {
            const diarized = transcription as TranscriptionDiarized;
            const rawDiarized = (diarized.segments ?? [])
                .map((seg) => `${seg.speaker}: ${seg.text}`)
                .join("\n");
            // Apply text-based repetition removal as safety net for diarized output
            transcriptionText = postProcessTranscription(
                rawDiarized,
                undefined,
            );
            // TranscriptionDiarized does not expose language
        } else if (responseFormat === "verbose_json") {
            const verbose = transcription as TranscriptionVerbose;
            const segments = verbose.segments ?? undefined;
            transcriptionText = postProcessTranscription(
                verbose.text,
                segments,
            );
            detectedLanguage = verbose.language ?? null;
        } else {
            const rawText =
                typeof transcription === "string"
                    ? transcription
                    : (transcription.text ?? "");
            transcriptionText = postProcessTranscription(rawText, undefined);
        }
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
                recordingId,
                userId,
                text: transcriptionText,
                detectedLanguage,
                transcriptionType: "server",
                provider: credentials.provider,
                model: credentials.defaultModel || "whisper-1",
            });
        }

        if (autoGenerateTitle && transcriptionText.trim()) {
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
                            updatedAt: new Date(),
                        })
                        .where(eq(recordings.id, recordingId));

                    const isLocallyCreated =
                        recording.plaudFileId.startsWith("split-") ||
                        recording.plaudFileId.startsWith("silence-removed-") ||
                        recording.plaudFileId.startsWith("uploaded-");

                    if (syncTitleToPlaud && !isLocallyCreated) {
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
                        } catch (error) {
                            console.error(
                                "Failed to sync title to Plaud:",
                                error,
                            );
                        }
                    }
                }
            } catch (error) {
                console.error("Failed to generate title:", error);
            }
        }

        return { success: true };
    } catch (error) {
        console.error("Error transcribing recording:", error);
        return {
            success: false,
            error:
                error instanceof Error ? error.message : "Transcription failed",
        };
    }
}
