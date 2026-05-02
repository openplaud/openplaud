import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { aiEnhancements, recordings, transcriptions } from "@/db/schema";
import { auth } from "@/lib/auth";
import { createUserStorageProvider } from "@/lib/storage/factory";

export async function GET(
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
                    isNull(recordings.deletedAt),
                ),
            )
            .limit(1);

        if (!recording) {
            return NextResponse.json(
                { error: "Recording not found" },
                { status: 404 },
            );
        }

        // Get transcription if exists
        const [transcription] = await db
            .select()
            .from(transcriptions)
            .where(eq(transcriptions.recordingId, id))
            .limit(1);

        return NextResponse.json({
            recording,
            transcription: transcription || null,
        });
    } catch (error) {
        console.error("Error fetching recording:", error);
        return NextResponse.json(
            { error: "Failed to fetch recording" },
            { status: 500 },
        );
    }
}

/**
 * Soft-delete a recording.
 *
 * - Hard-deletes the audio file from storage.
 * - Hard-deletes any transcription and AI-enhancement rows.
 * - Sets `recordings.deletedAt = now()` so sync does not resurrect the
 *   recording from Plaud on the next pull (sync is keyed on plaudFileId).
 *
 * This does NOT delete the recording on Plaud's servers. Plaud remains the
 * upstream source of truth; OpenPlaud just stops mirroring this file.
 */
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

        const [recording] = await db
            .select()
            .from(recordings)
            .where(
                and(
                    eq(recordings.id, id),
                    eq(recordings.userId, session.user.id),
                    isNull(recordings.deletedAt),
                ),
            )
            .limit(1);

        if (!recording) {
            return NextResponse.json(
                { error: "Recording not found" },
                { status: 404 },
            );
        }

        // Best-effort storage delete. If the file is already gone (e.g. user
        // deleted it out-of-band, or storage provider returns 404), continue
        // with the DB tombstone so the row state is consistent.
        try {
            const storage = await createUserStorageProvider(session.user.id);
            await storage.deleteFile(recording.storagePath);
        } catch (storageError) {
            console.error(
                `Failed to delete storage file for recording ${id}:`,
                storageError,
            );
        }

        // Remove derived rows. These contain user content (transcript text,
        // AI summary) that the user is asking to remove.
        await db
            .delete(transcriptions)
            .where(
                and(
                    eq(transcriptions.recordingId, id),
                    eq(transcriptions.userId, session.user.id),
                ),
            );

        await db
            .delete(aiEnhancements)
            .where(
                and(
                    eq(aiEnhancements.recordingId, id),
                    eq(aiEnhancements.userId, session.user.id),
                ),
            );

        // Soft-delete the recording row (tombstone for sync).
        await db
            .update(recordings)
            .set({ deletedAt: new Date(), updatedAt: new Date() })
            .where(
                and(
                    eq(recordings.id, id),
                    eq(recordings.userId, session.user.id),
                ),
            );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error deleting recording:", error);
        return NextResponse.json(
            { error: "Failed to delete recording" },
            { status: 500 },
        );
    }
}
