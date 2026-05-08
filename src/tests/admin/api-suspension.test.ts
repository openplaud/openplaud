import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Verifies that getApiSession refuses suspended users with a 403 +
 * ACCOUNT_SUSPENDED code, while letting normal users through. This is the
 * gate that prevents a suspended user with the dashboard already loaded
 * from continuing to hit /api/* endpoints until they reload.
 */

const { dbMock, getSessionMock } = vi.hoisted(() => ({
    dbMock: { select: vi.fn() },
    getSessionMock: vi.fn(),
}));

vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/db/schema", () => ({
    users: { id: "users.id", suspendedAt: "users.suspendedAt" },
}));
vi.mock("@/lib/auth", () => ({
    auth: { api: { getSession: getSessionMock } },
}));

import { getApiSession } from "@/lib/auth-server";

function makeChainable(result: unknown[]) {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockResolvedValue(result);
    return chain;
}

describe("getApiSession", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns 401 when not authenticated", async () => {
        getSessionMock.mockResolvedValue(null);
        const req = new Request("https://example.com/api/anything");
        const result = await getApiSession(req);
        expect(result.session).toBe(null);
        if ("response" in result) {
            expect(result.response.status).toBe(401);
        }
    });

    it("returns the session when user is not suspended", async () => {
        getSessionMock.mockResolvedValue({ user: { id: "u1" } });
        dbMock.select.mockReturnValue(makeChainable([{ suspendedAt: null }]));
        const req = new Request("https://example.com/api/anything");
        const result = await getApiSession(req);
        expect(result.session).not.toBe(null);
    });

    it("returns 403 ACCOUNT_SUSPENDED when user is suspended", async () => {
        getSessionMock.mockResolvedValue({ user: { id: "u1" } });
        dbMock.select.mockReturnValue(
            makeChainable([{ suspendedAt: new Date() }]),
        );
        const req = new Request("https://example.com/api/anything");
        const result = await getApiSession(req);
        expect(result.session).toBe(null);
        if ("response" in result) {
            expect(result.response.status).toBe(403);
            const body = await result.response.json();
            expect(body.code).toBe("ACCOUNT_SUSPENDED");
        }
    });

    it("returns the session when DB lookup returns no row (race: user just deleted)", async () => {
        // If users.id row vanished mid-request, we don't crash; absence of a
        // row means no suspension flag, treat as authenticated. The next call
        // that touches user-owned data will 404 naturally.
        getSessionMock.mockResolvedValue({ user: { id: "u1" } });
        dbMock.select.mockReturnValue(makeChainable([]));
        const req = new Request("https://example.com/api/anything");
        const result = await getApiSession(req);
        expect(result.session).not.toBe(null);
    });
});
