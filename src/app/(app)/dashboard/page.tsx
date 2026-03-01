import { desc, eq } from "drizzle-orm";
import { Workstation } from "@/components/dashboard/workstation";
import { db } from "@/db";
import { recordings, transcriptions } from "@/db/schema";
import { requireAuth } from "@/lib/auth-server";
import { serializeRecording } from "@/types/recording";

export default async function DashboardPage() {
    const session = await requireAuth();

    const userRecordings = await db
        .select({
            id: recordings.id,
            filename: recordings.filename,
            duration: recordings.duration,
            startTime: recordings.startTime,
            filesize: recordings.filesize,
            deviceSn: recordings.deviceSn,
        })
        .from(recordings)
        .where(eq(recordings.userId, session.user.id))
        .orderBy(desc(recordings.startTime));

    const userTranscriptions = await db
        .select({
            recordingId: transcriptions.recordingId,
            text: transcriptions.text,
            language: transcriptions.detectedLanguage,
            notionSyncStatus: transcriptions.notionSyncStatus,
        })
        .from(transcriptions)
        .where(eq(transcriptions.userId, session.user.id));

    const recordingsData = userRecordings.map(serializeRecording);

    const transcriptionMap = new Map(
        userTranscriptions.map((t) => [
            t.recordingId,
            { text: t.text, language: t.language || undefined },
        ]),
    );

    const notionSyncStatuses = new Map(
        userTranscriptions
            .filter((t) => t.notionSyncStatus)
            .map((t) => [t.recordingId, t.notionSyncStatus as string]),
    );

    return (
        <Workstation
            recordings={recordingsData}
            transcriptions={transcriptionMap}
            notionSyncStatuses={notionSyncStatuses}
        />
    );
}
