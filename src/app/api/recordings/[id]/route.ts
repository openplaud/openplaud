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
 * Storage providers throw on any deleteFile error including "object not
 * present". Detect the not-found case so retries after a half-failed delete
 * still tombstone cleanly. We match on common substrings rather than typed
 * error classes so this works across the local-fs adapter (ENOENT) and the
 * S3 adapter (NoSuchKey / NotFound / 404).
 */
function isStorageNotFoundError(error: unknown): boolean {
    const message =
        error instanceof Error ? error.message : String(error ?? "");
    return /ENOENT|NoSuchKey|NotFound|\b404\b/i.test(message);
}

/**
 * Soft-delete a recording.
 *
 * Order of operations is important:
 *
 * 1. Hard-delete the audio file from storage. If the storage provider fails
 *    for any reason other than "already gone", abort with 500 — we do NOT
 *    tombstone, so the user can retry instead of being left with an orphan
 *    blob that storage-usage stats can't see.
 * 2. Run all DB writes (transcription rows, AI-enhancement rows, tombstone
 *    update on `recordings.deletedAt`) inside a single transaction. Either
 *    they all commit or none do, so a partial failure can't leave the user
 *    with a half-deleted recording (e.g. transcript gone but row still
 *    visible).
 *
 * The tombstone (instead of a hard delete) exists because sync is keyed on
 * `recordings.plaudFileId`. Without it, the next pull from Plaud would
 * resurrect the recording. This endpoint does NOT delete the file on
 * Plaud's servers — Plaud remains the upstream source of truth.
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
        const userId = session.user.id;

        const [recording] = await db
            .select()
            .from(recordings)
            .where(
                and(
                    eq(recordings.id, id),
                    eq(recordings.userId, userId),
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

        // 1. Storage delete first. Treat "already gone" as success; surface
        //    every other error so the user can retry.
        try {
            const storage = await createUserStorageProvider(userId);
            await storage.deleteFile(recording.storagePath);
        } catch (storageError) {
            if (!isStorageNotFoundError(storageError)) {
                console.error(
                    `Failed to delete storage file for recording ${id}:`,
                    storageError,
                );
                return NextResponse.json(
                    {
                        error: "Failed to delete recording audio. Please retry.",
                    },
                    { status: 500 },
                );
            }
            // Object already absent — continue with tombstone.
        }

        // 2. Atomic DB writes: child rows + tombstone in one transaction.
        await db.transaction(async (tx) => {
            await tx
                .delete(transcriptions)
                .where(
                    and(
                        eq(transcriptions.recordingId, id),
                        eq(transcriptions.userId, userId),
                    ),
                );

            await tx
                .delete(aiEnhancements)
                .where(
                    and(
                        eq(aiEnhancements.recordingId, id),
                        eq(aiEnhancements.userId, userId),
                    ),
                );

            await tx
                .update(recordings)
                .set({ deletedAt: new Date(), updatedAt: new Date() })
                .where(
                    and(
                        eq(recordings.id, id),
                        eq(recordings.userId, userId),
                        isNull(recordings.deletedAt),
                    ),
                );
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error deleting recording:", error);
        return NextResponse.json(
            { error: "Failed to delete recording" },
            { status: 500 },
        );
    }
}
