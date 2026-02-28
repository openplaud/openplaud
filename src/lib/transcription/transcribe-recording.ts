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
import { getCalendarEventAtTime } from "@/lib/google-calendar/client";
import { pushToNotion } from "@/lib/notion/client";
import { createPlaudClient } from "@/lib/plaud/client";
import { createUserStorageProvider } from "@/lib/storage/factory";

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
        const useTitleFromCalendar = settings?.useTitleFromCalendar ?? false;
        const autoSyncToNotion = settings?.autoSyncToNotion ?? false;

        void quality;

        const apiKey = decrypt(credentials.apiKey);
        const openai = new OpenAI({
            apiKey,
            baseURL: credentials.baseUrl || undefined,
        });

        const storage = await createUserStorageProvider(userId);
        const audioBuffer = await storage.downloadFile(recording.storagePath);

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
            transcriptionText = (diarized.segments ?? [])
                .map((seg) => `${seg.speaker}: ${seg.text}`)
                .join("\n");
            // TranscriptionDiarized doesn't expose language
        } else if (responseFormat === "verbose_json") {
            const verbose = transcription as TranscriptionVerbose;
            transcriptionText = verbose.text;
            detectedLanguage = verbose.language ?? null;
        } else {
            transcriptionText =
                typeof transcription === "string"
                    ? transcription
                    : (transcription.text ?? "");
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

        // Step 1: Look up calendar event at recording time (if enabled)
        let calendarEventName: string | undefined;
        if (useTitleFromCalendar) {
            try {
                const calendarEvent = await getCalendarEventAtTime(
                    userId,
                    recording.startTime,
                );
                if (calendarEvent) {
                    calendarEventName = calendarEvent.summary;
                }
            } catch (error) {
                console.error("Failed to fetch calendar event:", error);
            }
        }

        // Step 2: Generate title (with calendar context if available)
        let finalTitle: string | null = null;
        if (autoGenerateTitle && transcriptionText.trim()) {
            try {
                const generatedTitle = await generateTitleFromTranscription(
                    userId,
                    transcriptionText,
                    calendarEventName,
                );

                if (generatedTitle) {
                    finalTitle = generatedTitle;
                    await db
                        .update(recordings)
                        .set({
                            filename: generatedTitle,
                            updatedAt: new Date(),
                        })
                        .where(eq(recordings.id, recordingId));

                    if (syncTitleToPlaud) {
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

        // Step 3: Push to Notion (if enabled)
        if (autoSyncToNotion && transcriptionText.trim()) {
            try {
                const notionTitle =
                    finalTitle || calendarEventName || recording.filename;
                const result = await pushToNotion(userId, {
                    title: notionTitle,
                    transcription: transcriptionText,
                    recordingDate: recording.startTime,
                    duration: recording.duration,
                    calendarEvent: calendarEventName,
                    detectedLanguage: detectedLanguage || undefined,
                });

                if (!result.success) {
                    console.error("Failed to push to Notion:", result.error);
                }
            } catch (error) {
                console.error("Failed to push to Notion:", error);
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
