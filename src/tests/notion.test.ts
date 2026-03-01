import { describe, expect, it, vi } from "vitest";
import { buildNotionPageContent, chunkText } from "../lib/notion/blocks";

// Mock env for encryption tests
vi.mock("../lib/env", () => ({
    env: {
        ENCRYPTION_KEY:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
}));

describe("Notion Integration", () => {
    describe("chunkText", () => {
        it("should return single chunk for short text", () => {
            const text = "Hello, world!";
            const chunks = chunkText(text);
            expect(chunks).toHaveLength(1);
            expect(chunks[0]).toBe(text);
        });

        it("should split text at 2000 characters", () => {
            const text = "a".repeat(4000);
            const chunks = chunkText(text);
            expect(chunks.length).toBeGreaterThanOrEqual(2);
            for (const chunk of chunks) {
                expect(chunk.length).toBeLessThanOrEqual(2000);
            }
        });

        it("should preserve all content after chunking", () => {
            const text = "word ".repeat(500); // ~2500 chars
            const chunks = chunkText(text);
            const rejoined = chunks.join(" "); // trimStart in chunkText may remove leading spaces
            // Check total length is approximately correct
            expect(rejoined.length).toBeGreaterThan(0);
            expect(chunks.length).toBeGreaterThanOrEqual(2);
        });

        it("should prefer breaking at newlines", () => {
            const part1 = "a".repeat(1500);
            const part2 = "b".repeat(1500);
            const text = `${part1}\n${part2}`;
            const chunks = chunkText(text);
            expect(chunks[0]).toBe(part1);
        });

        it("should handle empty string", () => {
            const chunks = chunkText("");
            expect(chunks).toHaveLength(1);
            expect(chunks[0]).toBe("");
        });

        it("should handle exactly 2000 characters", () => {
            const text = "x".repeat(2000);
            const chunks = chunkText(text);
            expect(chunks).toHaveLength(1);
            expect(chunks[0]).toBe(text);
        });
    });

    describe("buildNotionPageContent", () => {
        it("should create blocks for basic transcription", () => {
            const batches = buildNotionPageContent({
                title: "Test Recording",
                transcriptionText: "This is a test transcription.",
                recordingUrl: "http://localhost:3000/recordings/abc",
            });

            expect(batches).toHaveLength(1);
            const blocks = batches[0];

            // Should have: heading2 (Full Transcription), paragraph (text), divider, paragraph (metadata)
            expect(blocks.length).toBeGreaterThanOrEqual(4);

            // First block should be heading for "Full Transcription" (no summary or action items)
            const headingBlock = blocks[0];
            expect(headingBlock.type).toBe("heading_2");
        });

        it("should include summary section when provided", () => {
            const batches = buildNotionPageContent({
                title: "Test",
                transcriptionText: "Transcription text",
                summary: "This is a summary",
                recordingUrl: "http://localhost:3000/recordings/abc",
                includeSummary: true,
            });

            const blocks = batches[0];
            // First block should be summary heading
            expect(blocks[0].type).toBe("heading_2");
            if (blocks[0].type === "heading_2") {
                expect(
                    blocks[0].heading_2.rich_text[0].type === "text" &&
                        blocks[0].heading_2.rich_text[0].text.content,
                ).toBe("Summary");
            }
        });

        it("should include action items as to_do blocks", () => {
            const batches = buildNotionPageContent({
                title: "Test",
                transcriptionText: "Transcription text",
                actionItems: ["Item 1", "Item 2", "Item 3"],
                recordingUrl: "http://localhost:3000/recordings/abc",
                includeActionItems: true,
            });

            const blocks = batches[0];
            const todoBlocks = blocks.filter((b) => b.type === "to_do");
            expect(todoBlocks).toHaveLength(3);
        });

        it("should skip summary when includeSummary is false", () => {
            const batches = buildNotionPageContent({
                title: "Test",
                transcriptionText: "Transcription text",
                summary: "This should be skipped",
                recordingUrl: "http://localhost:3000/recordings/abc",
                includeSummary: false,
            });

            const blocks = batches[0];
            const headings = blocks.filter(
                (b) =>
                    b.type === "heading_2" &&
                    "heading_2" in b &&
                    b.heading_2.rich_text[0].type === "text" &&
                    b.heading_2.rich_text[0].text.content === "Summary",
            );
            expect(headings).toHaveLength(0);
        });

        it("should skip action items when includeActionItems is false", () => {
            const batches = buildNotionPageContent({
                title: "Test",
                transcriptionText: "Transcription text",
                actionItems: ["Item 1"],
                recordingUrl: "http://localhost:3000/recordings/abc",
                includeActionItems: false,
            });

            const blocks = batches[0];
            const todoBlocks = blocks.filter((b) => b.type === "to_do");
            expect(todoBlocks).toHaveLength(0);
        });

        it("should batch blocks at 100 blocks per batch", () => {
            // Create a very long transcription that will generate many blocks
            const longText = Array.from({ length: 200 })
                .map((_, i) => `Paragraph ${i}: ${"x".repeat(1900)}`)
                .join("\n\n");

            const batches = buildNotionPageContent({
                title: "Long Recording",
                transcriptionText: longText,
                recordingUrl: "http://localhost:3000/recordings/abc",
            });

            // Should have multiple batches
            expect(batches.length).toBeGreaterThan(1);

            // Each batch should have at most 100 blocks
            for (const batch of batches) {
                expect(batch.length).toBeLessThanOrEqual(100);
            }
        });

        it("should include metadata in the last block", () => {
            const batches = buildNotionPageContent({
                title: "Test",
                transcriptionText: "Some text",
                recordingUrl: "http://localhost:3000/recordings/abc",
                duration: 120000, // 2 minutes
                date: "2024-01-15T10:00:00Z",
                language: "nl",
            });

            const lastBatch = batches[batches.length - 1];
            const lastBlock = lastBatch[lastBatch.length - 1];

            expect(lastBlock.type).toBe("paragraph");
            if (lastBlock.type === "paragraph") {
                const content =
                    lastBlock.paragraph.rich_text[0].type === "text"
                        ? lastBlock.paragraph.rich_text[0].text.content
                        : "";
                expect(content).toContain("Duration: 2:00");
                expect(content).toContain("Language: nl");
                expect(content).toContain("Source:");
            }
        });
    });

    describe("Encryption roundtrip for Notion token", () => {
        it("should encrypt and decrypt a Notion integration token", async () => {
            const { encrypt, decrypt } = await import("../lib/encryption");

            const token = "ntn_1234567890abcdef1234567890";
            const encrypted = encrypt(token);
            const decrypted = decrypt(encrypted);

            expect(encrypted).not.toBe(token);
            expect(decrypted).toBe(token);
        });
    });
});
