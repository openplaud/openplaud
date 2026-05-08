import { and, eq, isNull } from "drizzle-orm";
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
import { decrypt } from "@/lib/encryption";
import { decryptText, encryptText } from "@/lib/encryption/fields";
import { createPlaudClient } from "@/lib/plaud/client-factory";
import { createUserStorageProvider } from "@/lib/storage/factory";
import {
    getResponseFormat,
    parseTranscriptionResponse,
} from "@/lib/transcription/format";

export interface TranscribeAudioOptions {
    signal?: AbortSignal;
    overrideProviderId?: string;
    overrideModel?: string;
}

export interface TranscribeAudioResult {
    text: string;
    detectedLanguage: string | undefined;
}

export interface PostProcessResult {
    titleUpdated: boolean;
    plaudSynced: boolean;
}

/**
 * Pure transcription: AI call + tombstone re-check.
 * Returns the transcribed text without touching the transcriptions table
 * or triggering title generation / Plaud sync.
 */
export async function transcribeAudio(
    userId: string,
    recordingId: string,
    options?: TranscribeAudioOptions,
): Promise<TranscribeAudioResult> {
    const [recording] = await db
        .select()
        .from(recordings)
        .where(
            and(
                eq(recordings.id, recordingId),
                eq(recordings.userId, userId),
                isNull(recordings.deletedAt),
            ),
        )
        .limit(1);

    if (!recording) {
        throw new Error("Recording not found");
    }

    const [existingTranscription] = await db
        .select()
        .from(transcriptions)
        .where(eq(transcriptions.recordingId, recordingId))
        .limit(1);

    if (existingTranscription?.text) {
        return {
            text: existingTranscription.text,
            detectedLanguage:
                existingTranscription.detectedLanguage ?? undefined,
        };
    }

    const [credentials] = options?.overrideProviderId
        ? await db
              .select()
              .from(apiCredentials)
              .where(
                  and(
                      eq(apiCredentials.userId, userId),
                      eq(apiCredentials.id, options.overrideProviderId),
                  ),
              )
              .limit(1)
        : await db
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
        throw new Error("No transcription API configured");
    }

    const [settings] = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, userId))
        .limit(1);

    const defaultLanguage = settings?.defaultTranscriptionLanguage || undefined;

    const apiKey = decrypt(credentials.apiKey);
    const openai = new OpenAI({
        apiKey,
        baseURL: credentials.baseUrl || undefined,
    });

    const storage = await createUserStorageProvider(userId);
    const audioBuffer = await storage.downloadFile(recording.storagePath);

    // Detect audio format from magic bytes rather than file extension.
    // Plaud recordings arrive as OGG Opus or MP3.
    const isOgg =
        audioBuffer[0] === 0x4f &&
        audioBuffer[1] === 0x67 &&
        audioBuffer[2] === 0x67 &&
        audioBuffer[3] === 0x53;
    const contentType = isOgg ? "audio/ogg" : "audio/mpeg";
    const audioFile = new File(
        [new Uint8Array(audioBuffer)],
        decryptText(recording.filename),
        {
            type: contentType,
        },
    );

    const model =
        options?.overrideModel || credentials.defaultModel || "whisper-1";
    const responseFormat = getResponseFormat(model);

    const transcription = await openai.audio.transcriptions.create({
        file: audioFile,
        model,
        response_format: responseFormat,
        ...(defaultLanguage ? { language: defaultLanguage } : {}),
        ...(options?.signal ? { signal: options.signal } : {}),
    });

    const { text: transcriptionText, detectedLanguage } =
        parseTranscriptionResponse(transcription, responseFormat);

    // Tombstone re-check after the provider call. The user may have deleted
    // the recording while we were waiting on the transcription API; abort
    // before the caller writes child rows or runs post-processing.
    const [stillActive] = await db
        .select({ deletedAt: recordings.deletedAt })
        .from(recordings)
        .where(
            and(eq(recordings.id, recordingId), eq(recordings.userId, userId)),
        )
        .limit(1);
    if (!stillActive || stillActive.deletedAt) {
        throw new Error("Recording was deleted before transcription finished");
    }

    return {
        text: transcriptionText,
        detectedLanguage: detectedLanguage ?? undefined,
    };
}

/**
 * Post-processing after transcription: title generation + Plaud sync.
 * Does NOT touch the transcriptions table.
 * Errors are caught and logged — never thrown.
 */
export async function postProcessTranscription(
    userId: string,
    recordingId: string,
    transcriptionText: string,
): Promise<PostProcessResult> {
    const result: PostProcessResult = {
        titleUpdated: false,
        plaudSynced: false,
    };

    try {
        const [settings] = await db
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, userId))
            .limit(1);

        const autoGenerateTitle = settings?.autoGenerateTitle ?? true;
        const syncTitleToPlaud = settings?.syncTitleToPlaud ?? false;

        if (!autoGenerateTitle || !transcriptionText.trim()) {
            return result;
        }

        let generatedTitle: string | undefined;

        try {
            const rawTitle = await generateTitleFromTranscription(
                userId,
                transcriptionText,
            );
            generatedTitle = rawTitle ?? undefined;
        } catch (error) {
            console.error("Failed to generate title:", error);
            return result;
        }

        if (!generatedTitle) {
            return result;
        }

        await db
            .update(recordings)
            .set({
                filename: encryptText(generatedTitle),
                updatedAt: new Date(),
            })
            .where(eq(recordings.id, recordingId));

        result.titleUpdated = true;

        if (!syncTitleToPlaud) {
            return result;
        }

        try {
            const [connection] = await db
                .select()
                .from(plaudConnections)
                .where(eq(plaudConnections.userId, userId))
                .limit(1);

            if (connection) {
                const [recording] = await db
                    .select({ plaudFileId: recordings.plaudFileId })
                    .from(recordings)
                    .where(eq(recordings.id, recordingId))
                    .limit(1);

                if (!recording?.plaudFileId) {
                    console.error(
                        "Cannot sync title to Plaud: recording has no plaudFileId",
                    );
                    return result;
                }

                const plaudClient = await createPlaudClient(
                    connection.bearerToken,
                    connection.apiBase,
                    connection.workspaceId,
                );
                await plaudClient.updateFilename(
                    recording.plaudFileId,
                    generatedTitle,
                );

                result.plaudSynced = true;

                // Backfill workspaceId if newly resolved.
                const resolved = plaudClient.workspaceId;
                if (resolved && resolved !== connection.workspaceId) {
                    await db
                        .update(plaudConnections)
                        .set({ workspaceId: resolved })
                        .where(
                            and(
                                eq(plaudConnections.id, connection.id),
                                eq(plaudConnections.userId, userId),
                            ),
                        );
                }
            }
        } catch (error) {
            console.error("Failed to sync title to Plaud:", error);
        }

        return result;
    } catch (error) {
        console.error("Error during post-process transcription:", error);
        return result;
    }
}

/**
 * Backward-compatible wrapper: transcribes audio, persists the transcription
 * row, then runs post-processing (title generation + Plaud sync).
 *
 * Signature preserved from the original implementation.
 */
export async function transcribeRecording(
    userId: string,
    recordingId: string,
): Promise<{ success: boolean; error?: string }> {
    try {
        const { text: transcriptionText, detectedLanguage } =
            await transcribeAudio(userId, recordingId);

        // Persist the transcription row with a tombstone re-check inside
        // a transaction with FOR UPDATE. This prevents the race where the
        // user deletes the recording between transcribeAudio completing and
        // the insert/update — we acquire a row-level lock and confirm the
        // recording is still active before writing.
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

        const [existingTranscription] = await db
            .select()
            .from(transcriptions)
            .where(eq(transcriptions.recordingId, recordingId))
            .limit(1);

        await db.transaction(async (tx) => {
            const [active] = await tx
                .select({ id: recordings.id })
                .from(recordings)
                .where(
                    and(
                        eq(recordings.id, recordingId),
                        eq(recordings.userId, userId),
                        isNull(recordings.deletedAt),
                    ),
                )
                .limit(1);

            if (!active) {
                throw new Error(
                    "Recording was deleted before transcription finished",
                );
            }

            const encryptedText = encryptText(transcriptionText);

            if (existingTranscription) {
                await tx
                    .update(transcriptions)
                    .set({
                        text: encryptedText,
                        detectedLanguage,
                        transcriptionType: "server",
                        status: "completed",
                        provider: credentials?.provider,
                        model: credentials?.defaultModel || "whisper-1",
                        createdAt: new Date(),
                    })
                    .where(eq(transcriptions.id, existingTranscription.id));
            } else {
                await tx.insert(transcriptions).values({
                    recordingId,
                    userId,
                    text: encryptedText,
                    detectedLanguage,
                    transcriptionType: "server",
                    status: "completed",
                    provider: credentials?.provider,
                    model: credentials?.defaultModel || "whisper-1",
                });
            }
        });

        await postProcessTranscription(userId, recordingId, transcriptionText);

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
