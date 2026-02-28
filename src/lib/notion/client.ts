import { Client } from "@notionhq/client";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notionConnections } from "@/db/schema";
import { decrypt } from "@/lib/encryption";

interface NotionPageData {
    title: string;
    transcription: string;
    recordingDate: Date;
    duration: number; // milliseconds
    calendarEvent?: string;
    detectedLanguage?: string;
}

/**
 * Get a Notion client for a user
 */
async function getNotionClient(
    userId: string,
): Promise<{ client: Client; databaseId: string } | null> {
    const [connection] = await db
        .select()
        .from(notionConnections)
        .where(eq(notionConnections.userId, userId))
        .limit(1);

    if (!connection) return null;

    const apiKey = decrypt(connection.apiKey);
    const client = new Client({ auth: apiKey });

    return { client, databaseId: connection.databaseId };
}

/**
 * Push a transcription to a Notion database as a new page
 */
export async function pushToNotion(
    userId: string,
    data: NotionPageData,
): Promise<{ success: boolean; pageUrl?: string; error?: string }> {
    try {
        const notionSetup = await getNotionClient(userId);
        if (!notionSetup) {
            return { success: false, error: "Notion not connected" };
        }

        const { client, databaseId } = notionSetup;

        // Format duration as human-readable
        const durationMin = Math.round(data.duration / 60000);
        const durationStr =
            durationMin >= 60
                ? `${Math.floor(durationMin / 60)}u ${durationMin % 60}min`
                : `${durationMin}min`;

        // Split transcription into blocks of ~2000 chars (Notion block limit)
        const textBlocks = splitText(data.transcription, 2000);

        // Build page children (content blocks)
        const children: Parameters<
            typeof client.blocks.children.append
        >[0]["children"] = [];

        // Add metadata header
        children.push({
            object: "block" as const,
            type: "callout" as const,
            callout: {
                icon: { type: "emoji" as const, emoji: "🎙️" as const },
                rich_text: [
                    {
                        type: "text" as const,
                        text: {
                            content: `Opname: ${data.recordingDate.toLocaleDateString("nl-NL", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} | Duur: ${durationStr}${data.calendarEvent ? ` | Agenda: ${data.calendarEvent}` : ""}`,
                        },
                    },
                ],
            },
        });

        // Add divider
        children.push({
            object: "block" as const,
            type: "divider" as const,
            divider: {},
        });

        // Add transcription heading
        children.push({
            object: "block" as const,
            type: "heading_2" as const,
            heading_2: {
                rich_text: [
                    {
                        type: "text" as const,
                        text: { content: "Transcriptie" },
                    },
                ],
            },
        });

        // Add transcription text blocks
        for (const block of textBlocks) {
            children.push({
                object: "block" as const,
                type: "paragraph" as const,
                paragraph: {
                    rich_text: [
                        {
                            type: "text" as const,
                            text: { content: block },
                        },
                    ],
                },
            });
        }

        // Build page properties - use "Name" or "title" as the title property
        // Notion databases always have exactly one title property
        const page = await client.pages.create({
            parent: { database_id: databaseId },
            properties: {
                // Try the common title property name - Notion will match the title column
                title: {
                    title: [
                        {
                            text: { content: data.title },
                        },
                    ],
                },
            },
            children,
        });

        const pageUrl = (page as { url?: string }).url;
        return { success: true, pageUrl: pageUrl || undefined };
    } catch (error) {
        console.error("Error pushing to Notion:", error);
        const message =
            error instanceof Error ? error.message : "Failed to push to Notion";

        // Common error: title property name mismatch
        if (message.includes("property") && message.includes("title")) {
            return {
                success: false,
                error: "Notion database title property not found. Make sure your database has a title column.",
            };
        }

        return { success: false, error: message };
    }
}

/**
 * Verify a Notion connection works and get database info
 */
export async function verifyNotionConnection(
    apiKey: string,
    databaseId: string,
): Promise<{ valid: boolean; databaseName?: string; error?: string }> {
    try {
        const client = new Client({ auth: apiKey });

        const database = await client.databases.retrieve({
            database_id: databaseId,
        });

        // Extract database name from title
        const titleProperty = (
            database as {
                title?: Array<{ plain_text?: string }>;
            }
        ).title;
        const databaseName =
            titleProperty?.map((t) => t.plain_text).join("") || "Untitled";

        return { valid: true, databaseName };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { valid: false, error: message };
    }
}

/**
 * Split text into chunks for Notion blocks (max 2000 chars each)
 */
function splitText(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];

    const blocks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            blocks.push(remaining);
            break;
        }

        // Try to split at a paragraph or sentence boundary
        let splitIndex = remaining.lastIndexOf("\n\n", maxLength);
        if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
            splitIndex = remaining.lastIndexOf("\n", maxLength);
        }
        if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
            splitIndex = remaining.lastIndexOf(". ", maxLength);
        }
        if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
            splitIndex = maxLength;
        }

        blocks.push(remaining.substring(0, splitIndex + 1));
        remaining = remaining.substring(splitIndex + 1);
    }

    return blocks;
}
