import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { notionConfig, transcriptions } from "@/db/schema";
import { auth } from "@/lib/auth";
import { syncTranscriptionToNotion } from "@/lib/notion/sync";

const BULK_SYNC_DELAY = 500; // ms between syncs

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// POST - Bulk sync all pending/failed transcriptions to Notion
export async function POST(request: Request) {
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

        // Check notion config
        const [config] = await db
            .select()
            .from(notionConfig)
            .where(eq(notionConfig.userId, session.user.id))
            .limit(1);

        if (!config || !config.enabled) {
            return NextResponse.json(
                { error: "Notion is not configured or disabled" },
                { status: 400 },
            );
        }

        // Find all transcriptions needing sync
        const pendingTranscriptions = await db
            .select({ id: transcriptions.id })
            .from(transcriptions)
            .where(
                and(
                    eq(transcriptions.userId, session.user.id),
                    inArray(transcriptions.notionSyncStatus, [
                        "pending",
                        "failed",
                    ]),
                ),
            );

        const total = pendingTranscriptions.length;

        if (total === 0) {
            return NextResponse.json({
                success: true,
                synced: 0,
                total: 0,
                message: "No transcriptions to sync",
            });
        }

        // Process sequentially with delay (fire-and-forget)
        let synced = 0;
        let failed = 0;

        for (const txn of pendingTranscriptions) {
            try {
                await syncTranscriptionToNotion(txn.id);
                synced++;
            } catch {
                failed++;
            }
            await delay(BULK_SYNC_DELAY);
        }

        return NextResponse.json({
            success: true,
            synced,
            failed,
            total,
        });
    } catch (error) {
        console.error("Error in bulk Notion sync:", error);
        return NextResponse.json(
            { error: "Failed to perform bulk sync" },
            { status: 500 },
        );
    }
}
