import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted to the top of the file, so the factory must construct
// its own state. We expose handles via vi.hoisted so tests can reach in and
// re-wire chainable returns per-test.
const { dbMock } = vi.hoisted(() => ({
    dbMock: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
    },
}));

vi.mock("@/db", () => ({ db: dbMock }));

vi.mock("@/db/schema", () => {
    // We only need stable references; the actions module compares by drizzle's
    // column proxy identity which the real module exports. For unit testing
    // we just stub them.
    return {
        users: { id: "users.id" },
        plaudConnections: { userId: "plaudConnections.userId" },
        recordings: { id: "recordings.id" },
        adminActionLog: {},
    };
});

import {
    forceDisconnectPlaud,
    softDeleteRecording,
    suspendUser,
    unsuspendUser,
} from "@/lib/admin/actions";

function makeChainable(result: unknown[]) {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockResolvedValue(result);
    chain.set = vi.fn().mockReturnValue(chain);
    chain.values = vi.fn().mockResolvedValue(undefined);
    return chain;
}

describe("admin actions reason guard", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const ctx = { adminUserId: "admin1", ip: null, reason: "" };

    it("suspendUser rejects empty reason", async () => {
        await expect(suspendUser(ctx, "u1")).rejects.toThrow(/reason/i);
    });

    it("unsuspendUser rejects short reason", async () => {
        await expect(
            unsuspendUser({ ...ctx, reason: "ab" }, "u1"),
        ).rejects.toThrow(/reason/i);
    });

    it("forceDisconnectPlaud rejects empty reason", async () => {
        await expect(forceDisconnectPlaud(ctx, "u1")).rejects.toThrow(
            /reason/i,
        );
    });

    it("softDeleteRecording rejects empty reason", async () => {
        await expect(softDeleteRecording(ctx, "r1")).rejects.toThrow(/reason/i);
    });
});

describe("suspendUser happy path", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("writes audit log and updates user when not already suspended", async () => {
        // First select: load target user (not suspended).
        const selectChain = makeChainable([
            {
                id: "u1",
                email: "x@y",
                suspendedAt: null,
                suspendedReason: null,
            },
        ]);
        dbMock.select.mockReturnValue(selectChain);
        const updateChain = {
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        };
        dbMock.update.mockReturnValue(updateChain);
        const insertChain = { values: vi.fn().mockResolvedValue(undefined) };
        dbMock.insert.mockReturnValue(insertChain);

        const res = await suspendUser(
            {
                adminUserId: "admin1",
                ip: "1.2.3.4",
                reason: "abuse: bulk imports",
            },
            "u1",
        );

        expect(res.ok).toBe(true);
        expect(updateChain.set).toHaveBeenCalledWith(
            expect.objectContaining({
                suspendedReason: "abuse: bulk imports",
            }),
        );
        expect(insertChain.values).toHaveBeenCalledTimes(1);
        const auditRow = insertChain.values.mock.calls[0][0] as {
            action: string;
            adminUserId: string;
            targetUserId: string;
            reason: string;
        };
        expect(auditRow.action).toBe("suspend_user");
        expect(auditRow.adminUserId).toBe("admin1");
        expect(auditRow.targetUserId).toBe("u1");
        expect(auditRow.reason).toBe("abuse: bulk imports");
    });
});
