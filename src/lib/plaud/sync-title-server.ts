import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { plaudConnections, recordings } from "@/db/schema";
import { createPlaudClient } from "@/lib/plaud/client";
import { isPlaudLocallyCreated } from "@/lib/plaud/sync-title";

export type SyncTitleResult = "synced" | "locally_created" | "no_connection";

export async function syncTitleToPlaudIfNeeded(
    userId: string,
    recordingId: string,
    plaudFileId: string,
    newTitle: string,
): Promise<SyncTitleResult> {
    if (isPlaudLocallyCreated(plaudFileId)) return "locally_created";

    const [connection] = await db
        .select()
        .from(plaudConnections)
        .where(eq(plaudConnections.userId, userId))
        .limit(1);

    if (!connection) return "no_connection";

    const plaudClient = await createPlaudClient(
        connection.bearerToken,
        connection.apiBase,
    );
    await plaudClient.updateFilename(plaudFileId, newTitle);

    await db
        .update(recordings)
        .set({ filenameModified: false })
        .where(
            and(eq(recordings.id, recordingId), eq(recordings.userId, userId)),
        );

    return "synced";
}
