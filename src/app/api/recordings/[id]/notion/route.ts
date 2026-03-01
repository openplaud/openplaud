import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { notionConfig, recordings, transcriptions } from "@/db/schema";
import { auth } from "@/lib/auth";
import { syncTranscriptionToNotion } from "@/lib/notion/sync";

interface RouteContext {
    params: Promise<{ id: string }>;
}

// GET - Return notion sync status for recording's transcription
export async function GET(request: Request, context: RouteContext) {
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

        const { id } = await context.params;

        // Verify recording belongs to user
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

        const [txn] = await db
            .select({
                notionSyncStatus: transcriptions.notionSyncStatus,
                notionPageUrl: transcriptions.notionPageUrl,
                notionSyncError: transcriptions.notionSyncError,
                notionSyncedAt: transcriptions.notionSyncedAt,
            })
            .from(transcriptions)
            .where(eq(transcriptions.recordingId, id))
            .limit(1);

        if (!txn) {
            return NextResponse.json({ status: null });
        }

        return NextResponse.json({
            notionSyncStatus: txn.notionSyncStatus,
            notionPageUrl: txn.notionPageUrl,
            notionSyncError: txn.notionSyncError,
            notionSyncedAt: txn.notionSyncedAt,
        });
    } catch (error) {
        console.error("Error fetching Notion status:", error);
        return NextResponse.json(
            { error: "Failed to fetch Notion status" },
            { status: 500 },
        );
    }
}

// POST - Trigger manual sync/re-sync to Notion
export async function POST(request: Request, context: RouteContext) {
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

        const { id } = await context.params;

        // Verify recording belongs to user
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

        // Check notion config exists
        const [config] = await db
            .select()
            .from(notionConfig)
            .where(eq(notionConfig.userId, session.user.id))
            .limit(1);

        if (!config) {
            return NextResponse.json(
                { error: "Notion is not configured" },
                { status: 400 },
            );
        }

        // Find transcription
        const [txn] = await db
            .select({ id: transcriptions.id })
            .from(transcriptions)
            .where(eq(transcriptions.recordingId, id))
            .limit(1);

        if (!txn) {
            return NextResponse.json(
                { error: "No transcription found for this recording" },
                { status: 404 },
            );
        }

        // Reset sync status before re-syncing
        await db
            .update(transcriptions)
            .set({
                notionSyncStatus: "pending",
                notionSyncError: null,
                notionPageId: null,
                notionPageUrl: null,
            })
            .where(eq(transcriptions.id, txn.id));

        // Sync (non-blocking)
        syncTranscriptionToNotion(txn.id).catch((err) =>
            console.error("Manual Notion sync failed:", err),
        );

        return NextResponse.json({ success: true, message: "Sync started" });
    } catch (error) {
        console.error("Error triggering Notion sync:", error);
        return NextResponse.json(
            { error: "Failed to trigger Notion sync" },
            { status: 500 },
        );
    }
}
