import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
    },
}));

vi.mock("@/lib/auth-server", () => ({
    requireApiSession: vi.fn().mockResolvedValue({
        user: { id: "user-1" },
    }),
}));

vi.mock("@/lib/encryption/fields", () => ({
    decryptText: vi.fn((value: string | null | undefined) =>
        typeof value === "string" ? value.replace(/^encrypted:/, "") : value,
    ),
}));

import { GET as listRecordings } from "@/app/api/recordings/route";
import { db } from "@/db";
import { requireApiSession } from "@/lib/auth-server";

const now = new Date("2026-05-06T12:00:00.000Z");

function selectRows(rows: unknown[]) {
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue(rows),
            }),
        }),
    };
}

describe("GET /api/recordings", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (requireApiSession as unknown as Mock).mockResolvedValue({
            user: { id: "user-1" },
        });
    });

    it("returns plaintext filenames when recordings are encrypted at rest", async () => {
        (db.select as Mock).mockReturnValueOnce(
            selectRows([
                {
                    id: "rec-1",
                    userId: "user-1",
                    deviceSn: "SN-1",
                    plaudFileId: "plaud-1",
                    filename: "encrypted:Planning Call",
                    duration: 120000,
                    startTime: now,
                    endTime: now,
                    filesize: 12345,
                    fileMd5: "abc",
                    storageType: "local",
                    storagePath: "user-1/rec.mp3",
                    downloadedAt: now,
                    plaudVersion: "1",
                    timezone: null,
                    zonemins: null,
                    scene: null,
                    isTrash: false,
                    deletedAt: null,
                    createdAt: now,
                    updatedAt: now,
                },
            ]),
        );

        const response = await listRecordings(
            new Request("http://localhost/api/recordings"),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            recordings: [{ id: "rec-1", filename: "Planning Call" }],
        });
    });
});
