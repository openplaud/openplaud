import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock("@/lib/encryption", () => ({
    decrypt: vi.fn().mockReturnValue("fake-api-key"),
}));

vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn().mockResolvedValue({
        downloadFile: vi.fn().mockResolvedValue(Buffer.from("audio-data")),
    }),
}));

vi.mock("openai", () => {
    const MockOpenAI = vi.fn(() => ({
        audio: {
            transcriptions: {
                create: vi.fn(),
            },
        },
    }));
    return { OpenAI: MockOpenAI };
});

import { OpenAI } from "openai";
import { db } from "@/db";
import { transcribeRecording } from "@/lib/transcription/transcribe-recording";

describe("Transcription", () => {
    const mockUserId = "user-123";
    const mockRecordingId = "rec-456";

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("transcribeRecording", () => {
        it("should return error when recording not found", async () => {
            (db.select as Mock).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                }),
            });

            const result = await transcribeRecording(
                mockUserId,
                mockRecordingId,
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe("Recording not found");
        });

        it("should return success when transcription already exists", async () => {
            (db.select as Mock)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                {
                                    id: mockRecordingId,
                                    filename: "test.mp3",
                                },
                            ]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi
                                .fn()
                                .mockResolvedValue([
                                    { id: "trans-1", text: "Existing text" },
                                ]),
                        }),
                    }),
                });

            const result = await transcribeRecording(
                mockUserId,
                mockRecordingId,
            );

            expect(result.success).toBe(true);
        });

        it("should return error when no API credentials configured", async () => {
            (db.select as Mock)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                {
                                    id: mockRecordingId,
                                    filename: "test.mp3",
                                    storagePath: "test.mp3",
                                },
                            ]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([]),
                        }),
                    }),
                });

            const result = await transcribeRecording(
                mockUserId,
                mockRecordingId,
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe("No transcription API configured");
        });

        it("should return error when API call fails", async () => {
            const mockCreate = vi
                .fn()
                .mockRejectedValue(new Error("API Error"));
            (OpenAI as unknown as Mock).mockReturnValue({
                audio: { transcriptions: { create: mockCreate } },
            });

            (db.select as Mock)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                {
                                    id: mockRecordingId,
                                    filename: "test.mp3",
                                    storagePath: "test.mp3",
                                },
                            ]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                {
                                    id: "creds-1",
                                    provider: "openai",
                                    apiKey: "encrypted-key",
                                    defaultModel: "whisper-1",
                                },
                            ]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi
                                .fn()
                                .mockResolvedValue([{ id: "settings-1" }]),
                        }),
                    }),
                });

            const result = await transcribeRecording(
                mockUserId,
                mockRecordingId,
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe("API Error");
        });
    });
});
