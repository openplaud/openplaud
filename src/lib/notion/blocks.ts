import type { BlockObjectRequest } from "@notionhq/client/build/src/api-endpoints";

const MAX_RICH_TEXT_LENGTH = 2000;
const MAX_BLOCKS_PER_REQUEST = 100;

interface NotionPageContentInput {
    title: string;
    transcriptionText: string;
    summary?: string | null;
    actionItems?: string[] | null;
    recordingUrl: string;
    duration?: number;
    date?: string;
    language?: string;
    includeSummary?: boolean;
    includeActionItems?: boolean;
}

/**
 * Split text into chunks that fit within Notion's 2000-char rich_text limit
 */
export function chunkText(text: string): string[] {
    if (text.length <= MAX_RICH_TEXT_LENGTH) {
        return [text];
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= MAX_RICH_TEXT_LENGTH) {
            chunks.push(remaining);
            break;
        }

        // Find a good break point (newline or space near the limit)
        let breakPoint = remaining.lastIndexOf(
            "\n",
            MAX_RICH_TEXT_LENGTH,
        );
        if (breakPoint === -1 || breakPoint < MAX_RICH_TEXT_LENGTH * 0.5) {
            breakPoint = remaining.lastIndexOf(" ", MAX_RICH_TEXT_LENGTH);
        }
        if (breakPoint === -1 || breakPoint < MAX_RICH_TEXT_LENGTH * 0.5) {
            breakPoint = MAX_RICH_TEXT_LENGTH;
        }

        chunks.push(remaining.slice(0, breakPoint));
        remaining = remaining.slice(breakPoint).trimStart();
    }

    return chunks;
}

/**
 * Build Notion block children array from transcription data.
 * Returns batched arrays of max 100 blocks each.
 */
export function buildNotionPageContent(
    input: NotionPageContentInput,
): BlockObjectRequest[][] {
    const blocks: BlockObjectRequest[] = [];

    // Summary section
    if (input.includeSummary !== false && input.summary) {
        blocks.push({
            object: "block" as const,
            type: "heading_2",
            heading_2: {
                rich_text: [{ type: "text", text: { content: "Summary" } }],
            },
        });

        for (const chunk of chunkText(input.summary)) {
            blocks.push({
                object: "block" as const,
                type: "paragraph",
                paragraph: {
                    rich_text: [{ type: "text", text: { content: chunk } }],
                },
            });
        }
    }

    // Action Items section
    if (
        input.includeActionItems !== false &&
        input.actionItems &&
        input.actionItems.length > 0
    ) {
        blocks.push({
            object: "block" as const,
            type: "heading_2",
            heading_2: {
                rich_text: [
                    { type: "text", text: { content: "Action Items" } },
                ],
            },
        });

        for (const item of input.actionItems) {
            blocks.push({
                object: "block" as const,
                type: "to_do",
                to_do: {
                    rich_text: [{ type: "text", text: { content: item } }],
                    checked: false,
                },
            });
        }
    }

    // Full Transcription section
    blocks.push({
        object: "block" as const,
        type: "heading_2",
        heading_2: {
            rich_text: [
                { type: "text", text: { content: "Full Transcription" } },
            ],
        },
    });

    for (const chunk of chunkText(input.transcriptionText)) {
        blocks.push({
            object: "block" as const,
            type: "paragraph",
            paragraph: {
                rich_text: [{ type: "text", text: { content: chunk } }],
            },
        });
    }

    // Metadata section
    blocks.push({
        object: "block" as const,
        type: "divider",
        divider: {},
    });

    const metaParts: string[] = [];
    if (input.duration) {
        const minutes = Math.floor(input.duration / 60000);
        const seconds = Math.floor((input.duration % 60000) / 1000);
        metaParts.push(`Duration: ${minutes}:${seconds.toString().padStart(2, "0")}`);
    }
    if (input.date) {
        metaParts.push(`Date: ${input.date}`);
    }
    if (input.language) {
        metaParts.push(`Language: ${input.language}`);
    }
    metaParts.push(`Source: ${input.recordingUrl}`);

    blocks.push({
        object: "block" as const,
        type: "paragraph",
        paragraph: {
            rich_text: [
                {
                    type: "text",
                    text: { content: metaParts.join(" | ") },
                    annotations: {
                        italic: true,
                        color: "gray",
                    },
                },
            ],
        },
    });

    // Batch into groups of MAX_BLOCKS_PER_REQUEST
    const batches: BlockObjectRequest[][] = [];
    for (let i = 0; i < blocks.length; i += MAX_BLOCKS_PER_REQUEST) {
        batches.push(blocks.slice(i, i + MAX_BLOCKS_PER_REQUEST));
    }

    return batches;
}
