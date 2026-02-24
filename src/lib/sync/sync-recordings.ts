import { eq } from "drizzle-orm";
import { db } from "@/db";
import { plaudConnections, recordings, userSettings, users } from "@/db/schema";
import { env } from "@/lib/env";
import { sendNewRecordingBarkNotification } from "@/lib/notifications/bark";
import { sendNewRecordingEmail } from "@/lib/notifications/email";
import { createPlaudClient } from "@/lib/plaud/client";
import { createUserStorageProvider } from "@/lib/storage/factory";
import { transcribeRecording } from "@/lib/transcription/transcribe-recording";

interface SyncResult {
    newRecordings: number;
    updatedRecordings: number;
    errors: string[];
}

export async function syncRecordingsForUser(
    userId: string,
): Promise<SyncResult> {
    const result: SyncResult = {
        newRecordings: 0,
        updatedRecordings: 0,
        errors: [],
    };

    try {
        const [connection] = await db
            .select()
            .from(plaudConnections)
            .where(eq(plaudConnections.userId, userId))
            .limit(1);

        if (!connection) {
            result.errors.push("No Plaud connection found");
            return result;
        }

        const [settings] = await db
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, userId))
            .limit(1);

        const autoTranscribe = settings?.autoTranscribe ?? false;
        const emailNotifications = settings?.emailNotifications ?? false;
        const barkNotifications = settings?.barkNotifications ?? false;

        const [user] = await db
            .select({ email: users.email })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        const notificationEmail =
            settings?.notificationEmail || user?.email || null;
        const barkPushUrl = settings?.barkPushUrl || null;

        const plaudClient = await createPlaudClient(
            connection.bearerToken,
            connection.apiBase,
        );
        const storage = await createUserStorageProvider(userId);
        const recordingsResponse = await plaudClient.getRecordings();
        const newRecordingNames: string[] = [];
        for (const plaudRecording of recordingsResponse.data_file_list) {
            try {
                const [existingRecording] = await db
                    .select()
                    .from(recordings)
                    .where(eq(recordings.plaudFileId, plaudRecording.id))
                    .limit(1);

                const versionKey = plaudRecording.version_ms.toString();

                if (
                    existingRecording &&
                    existingRecording.plaudVersion === versionKey
                ) {
                    continue;
                }

                const audioBuffer = await plaudClient.downloadRecording(
                    plaudRecording.id,
                    false,
                );

                const fileExtension = "mp3";
                const storageKey = `${userId}/${plaudRecording.id}.${fileExtension}`;
                const contentType = "audio/mpeg";
                await storage.uploadFile(storageKey, audioBuffer, contentType);

                const recordingData = {
                    userId,
                    deviceSn: plaudRecording.serial_number,
                    plaudFileId: plaudRecording.id,
                    filename: plaudRecording.filename,
                    duration: plaudRecording.duration,
                    startTime: new Date(plaudRecording.start_time),
                    endTime: new Date(plaudRecording.end_time),
                    filesize: plaudRecording.filesize,
                    fileMd5: plaudRecording.file_md5,
                    storageType: env.DEFAULT_STORAGE_TYPE,
                    storagePath: storageKey,
                    downloadedAt: new Date(),
                    plaudVersion: versionKey,
                    timezone: plaudRecording.timezone,
                    zonemins: plaudRecording.zonemins,
                    scene: plaudRecording.scene,
                    isTrash: plaudRecording.is_trash,
                };

                let recordingId: string;

                if (existingRecording) {
                    recordingId = existingRecording.id;
                    await db
                        .update(recordings)
                        .set({ ...recordingData, updatedAt: new Date() })
                        .where(eq(recordings.id, existingRecording.id));
                    result.updatedRecordings++;
                } else {
                    const [newRecording] = await db
                        .insert(recordings)
                        .values(recordingData)
                        .returning({ id: recordings.id });
                    recordingId = newRecording.id;
                    result.newRecordings++;
                    newRecordingNames.push(plaudRecording.filename);

                    if (autoTranscribe) {
                        try {
                            const transcribeResult = await transcribeRecording(
                                userId,
                                recordingId,
                            );
                            if (!transcribeResult.success) {
                                result.errors.push(
                                    `Auto-transcription failed for ${plaudRecording.filename}: ${transcribeResult.error}`,
                                );
                            }
                        } catch (error) {
                            result.errors.push(
                                `Auto-transcription error for ${plaudRecording.filename}: ${error}`,
                            );
                        }
                    }
                }
            } catch (error) {
                result.errors.push(
                    `Failed to sync recording ${plaudRecording.filename}: ${error}`,
                );
            }
        }

        await db
            .update(plaudConnections)
            .set({ lastSync: new Date() })
            .where(eq(plaudConnections.id, connection.id));

        if (
            emailNotifications &&
            notificationEmail &&
            result.newRecordings > 0
        ) {
            try {
                await sendNewRecordingEmail(
                    notificationEmail,
                    result.newRecordings,
                    newRecordingNames,
                );
            } catch (error) {
                console.error("Failed to send email notification:", error);
                result.errors.push("Email notification failed");
            }
        }

        if (barkNotifications && barkPushUrl && result.newRecordings > 0) {
            try {
                const success = await sendNewRecordingBarkNotification(
                    barkPushUrl,
                    result.newRecordings,
                    newRecordingNames,
                );
                if (!success) {
                    result.errors.push("Bark notification failed or timed out");
                }
            } catch (error) {
                console.error("Failed to send Bark notification:", error);
                result.errors.push("Bark notification failed");
            }
        }

        return result;
    } catch (error) {
        result.errors.push(`Sync failed: ${error}`);
        return result;
    }
}
