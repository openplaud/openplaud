import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
    aiEnhancements,
    notionConfig,
    recordings,
    transcriptions,
} from "@/db/schema";
import { env } from "@/lib/env";
import { buildNotionPageContent } from "./blocks";
import { createNotionClient } from "./client";

const RATE_LIMIT_DELAY = 350; // ms between API calls (3 req/s limit)

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sync a transcription to Notion. Non-blocking: catches all errors internally.
 */
export async function syncTranscriptionToNotion(
    transcriptionId: string,
): Promise<void> {
    try {
        // Fetch transcription with recording data
        const [txn] = await db
            .select()
            .from(transcriptions)
            .where(eq(transcriptions.id, transcriptionId))
            .limit(1);

        if (!txn) {
            console.error("Notion sync: transcription not found", transcriptionId);
            return;
        }

        // Fetch recording
        const [recording] = await db
            .select()
            .from(recordings)
            .where(eq(recordings.id, txn.recordingId))
            .limit(1);

        if (!recording) {
            console.error("Notion sync: recording not found", txn.recordingId);
            return;
        }

        // Fetch AI enhancement (if exists)
        const [enhancement] = await db
            .select()
            .from(aiEnhancements)
            .where(eq(aiEnhancements.recordingId, txn.recordingId))
            .limit(1);

        // Fetch notion config
        const [config] = await db
            .select()
            .from(notionConfig)
            .where(eq(notionConfig.userId, txn.userId))
            .limit(1);

        if (!config || !config.enabled) {
            return;
        }

        // Update status to syncing
        await db
            .update(transcriptions)
            .set({ notionSyncStatus: "syncing" })
            .where(eq(transcriptions.id, transcriptionId));

        const client = createNotionClient(config.encryptedToken);

        const appUrl = env.APP_URL || "http://localhost:3000";
        const recordingUrl = `${appUrl}/recordings/${recording.id}`;

        // Create page properties
        const properties: Record<string, unknown> = {
            Name: {
                title: [
                    {
                        text: {
                            content: recording.filename,
                        },
                    },
                ],
            },
            Status: {
                status: {
                    name: "Inbox",
                },
            },
            Tags: {
                multi_select: (config.defaultTags || ["Knowledge"]).map(
                    (tag: string) => ({ name: tag }),
                ),
            },
            URL: {
                url: recordingUrl,
            },
        };

        // Create the page
        const page = await client.pages.create({
            parent: { database_id: config.databaseId },
            properties: properties as Parameters<typeof client.pages.create>[0]["properties"],
        });

        // Build content blocks
        const actionItems =
            enhancement?.actionItems &&
            Array.isArray(enhancement.actionItems)
                ? (enhancement.actionItems as string[])
                : null;

        const batches = buildNotionPageContent({
            title: recording.filename,
            transcriptionText: txn.text,
            summary: config.includeSummary
                ? (enhancement?.summary ?? null)
                : null,
            actionItems: config.includeActionItems ? actionItems : null,
            recordingUrl,
            duration: recording.duration,
            date: recording.startTime.toISOString(),
            language: txn.detectedLanguage || config.language,
            includeSummary: config.includeSummary,
            includeActionItems: config.includeActionItems,
        });

        // Append blocks in batches with rate limiting
        for (const batch of batches) {
            await client.blocks.children.append({
                block_id: page.id,
                children: batch,
            });
            await delay(RATE_LIMIT_DELAY);
        }

        // Extract page URL
        const pageUrl =
            "url" in page ? (page.url as string) : null;

        // Update transcription with success
        await db
            .update(transcriptions)
            .set({
                notionPageId: page.id,
                notionPageUrl: pageUrl,
                notionSyncStatus: "synced",
                notionSyncError: null,
                notionSyncedAt: new Date(),
            })
            .where(eq(transcriptions.id, transcriptionId));
    } catch (error) {
        console.error("Notion sync failed:", error);

        // Update transcription with failure
        try {
            await db
                .update(transcriptions)
                .set({
                    notionSyncStatus: "failed",
                    notionSyncError:
                        error instanceof Error
                            ? error.message
                            : "Unknown error",
                })
                .where(eq(transcriptions.id, transcriptionId));
        } catch (dbError) {
            console.error("Failed to update sync error status:", dbError);
        }
    }
}
