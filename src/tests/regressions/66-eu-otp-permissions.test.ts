/**
 * Regression test for issue #66:
 *   "Sync returns empty list for EU accounts \u2014 OTP token has insufficient
 *   permissions"
 *
 * Plaud's regional servers (EU, APAC) require a *workspace token* (WT, JWT
 * typ="WT", 24h lifetime) on recording endpoints like /file/simple/web.
 * The user token (UT) returned by /auth/otp-login authenticates /user/me
 * and the workspace-token mint endpoints, but on /file/simple/web it
 * silently returns HTTP 200 with an empty list. PlaudClient must mint a WT
 * from the UT before hitting recording endpoints.
 *
 * These tests cover the four cache states for the persisted workspaceId:
 *   1. cache empty   \u2192 list workspaces \u2192 mint WT \u2192 expose new id
 *   2. cache hit     \u2192 mint WT directly (no list call)
 *   3. cache stale   \u2192 mint 4xx \u2192 invalidate \u2192 list \u2192 mint \u2192 expose new id
 *   4. mint fails    \u2192 fall back to UT (preserves pre-fix behavior)
 */

import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    type Mock,
    vi,
} from "vitest";
import { PlaudClient } from "@/lib/plaud/client";

const originalFetch = global.fetch;
let mockFetch: Mock;

beforeAll(() => {
    mockFetch = vi.fn() as Mock;
    global.fetch = mockFetch as typeof global.fetch;
});

afterAll(() => {
    global.fetch = originalFetch;
});

beforeEach(() => {
    vi.clearAllMocks();
});

const UT = "ut.user.token";
const WT = "wt.workspace.token";
const API_BASE = "https://api-euc1.plaud.ai";
const WORKSPACE_ID = "ws_cKyt7F2Iec";
const NEW_WORKSPACE_ID = "ws_newDiscovered";

interface MockResponseInit {
    ok?: boolean;
    status?: number;
    body: unknown;
}

function mockResponse({ ok = true, status = 200, body }: MockResponseInit): {
    ok: boolean;
    status: number;
    statusText: string;
    headers: { get: () => null };
    json: () => Promise<unknown>;
} {
    return {
        ok,
        status,
        statusText: ok ? "OK" : "Error",
        headers: { get: () => null },
        json: () => Promise.resolve(body),
    };
}

function workspaceListResponse(workspaceId: string) {
    return mockResponse({
        body: {
            status: 0,
            data: {
                workspaces: [
                    {
                        workspace_id: workspaceId,
                        member_id: "mem_x",
                        name: "Personal",
                        role: "admin",
                        status: "active",
                        workspace_type: "0",
                    },
                ],
            },
        },
    });
}

function workspaceTokenResponse(workspaceToken: string) {
    return mockResponse({
        body: {
            status: 0,
            data: {
                status: 0,
                workspace_token: workspaceToken,
                expires_in: 86400,
                wt_expires_at: 0,
                refresh_token: "refresh.token",
                refresh_expires_in: 2592000,
                refresh_expires_at: 0,
                workspace_id: WORKSPACE_ID,
                member_id: "mem_x",
                role: "admin",
            },
        },
    });
}

function recordingsResponse() {
    return mockResponse({
        body: {
            status: 0,
            msg: "success",
            data_file_total: 1,
            data_file_list: [{ id: "rec_1", filename: "test.mp3" }],
        },
    });
}

/**
 * Pull the Authorization header off a mockFetch invocation.
 * Our PlaudClient sends `Bearer <token>` (capital B); `fetch` is called as
 * `fetch(url, { headers: { Authorization: ... } })`.
 */
function authHeaderFromCall(call: unknown[]): string {
    const init = call[1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    return headers.Authorization ?? "";
}

describe("issue #66: workspace token (WT) is required on EU recording endpoints", () => {
    it("cache empty: lists workspaces, mints WT, sends WT on /file/simple/web", async () => {
        // 1. workspaces/list   2. workspace/token mint   3. /file/simple/web
        mockFetch
            .mockResolvedValueOnce(workspaceListResponse(WORKSPACE_ID))
            .mockResolvedValueOnce(workspaceTokenResponse(WT))
            .mockResolvedValueOnce(recordingsResponse());

        const client = new PlaudClient(UT, API_BASE);
        const result = await client.getRecordings(0, 10);

        expect(result.data_file_total).toBe(1);
        expect(mockFetch).toHaveBeenCalledTimes(3);

        // First call hits the workspaces/list endpoint with the UT.
        const listCall = mockFetch.mock.calls[0];
        expect(listCall[0]).toContain("/team-app/workspaces/list");
        expect(authHeaderFromCall(listCall)).toBe(`Bearer ${UT}`);

        // Second call mints the WT \u2014 also authenticated with the UT.
        const mintCall = mockFetch.mock.calls[1];
        expect(mintCall[0]).toContain(
            `/user-app/auth/workspace/token/${WORKSPACE_ID}`,
        );
        expect(authHeaderFromCall(mintCall)).toBe(`Bearer ${UT}`);
        expect((mintCall[1] as RequestInit).method).toBe("POST");

        // Third call (the actual recordings fetch) MUST use the WT, not UT.
        // This is the load-bearing assertion for the bug.
        const recCall = mockFetch.mock.calls[2];
        expect(recCall[0]).toContain("/file/simple/web");
        expect(authHeaderFromCall(recCall)).toBe(`Bearer ${WT}`);

        // Resolved workspace id is now exposed for the caller to persist.
        expect(client.workspaceId).toBe(WORKSPACE_ID);
        expect(client.usingUserTokenFallback).toBe(false);
    });

    it("cache hit: skips workspaces/list, mints WT directly", async () => {
        mockFetch
            .mockResolvedValueOnce(workspaceTokenResponse(WT))
            .mockResolvedValueOnce(recordingsResponse());

        const client = new PlaudClient(UT, API_BASE, WORKSPACE_ID);
        await client.getRecordings(0, 10);

        expect(mockFetch).toHaveBeenCalledTimes(2);

        // No workspaces/list call \u2014 went straight to mint.
        expect(mockFetch.mock.calls[0][0]).toContain(
            `/user-app/auth/workspace/token/${WORKSPACE_ID}`,
        );
        expect(mockFetch.mock.calls[1][0]).toContain("/file/simple/web");
        expect(authHeaderFromCall(mockFetch.mock.calls[1])).toBe(
            `Bearer ${WT}`,
        );
        expect(client.workspaceId).toBe(WORKSPACE_ID);
    });

    it("cache stale: mint 4xx, invalidates, relists, exposes new workspaceId", async () => {
        // 1. mint with stale id \u2192 404
        // 2. workspaces/list \u2192 returns NEW workspace id
        // 3. mint with new id \u2192 WT
        // 4. /file/simple/web with WT
        mockFetch
            .mockResolvedValueOnce(
                mockResponse({
                    ok: false,
                    status: 404,
                    body: { status: 404, msg: "workspace not found" },
                }),
            )
            .mockResolvedValueOnce(workspaceListResponse(NEW_WORKSPACE_ID))
            .mockResolvedValueOnce(workspaceTokenResponse(WT))
            .mockResolvedValueOnce(recordingsResponse());

        const client = new PlaudClient(UT, API_BASE, "ws_stale");
        await client.getRecordings(0, 10);

        expect(mockFetch).toHaveBeenCalledTimes(4);
        expect(mockFetch.mock.calls[0][0]).toContain(
            "/user-app/auth/workspace/token/ws_stale",
        );
        expect(mockFetch.mock.calls[1][0]).toContain(
            "/team-app/workspaces/list",
        );
        expect(mockFetch.mock.calls[2][0]).toContain(
            `/user-app/auth/workspace/token/${NEW_WORKSPACE_ID}`,
        );
        expect(authHeaderFromCall(mockFetch.mock.calls[3])).toBe(
            `Bearer ${WT}`,
        );

        // Caller will persist this back to plaud_connections.workspace_id.
        expect(client.workspaceId).toBe(NEW_WORKSPACE_ID);
    });

    it("workspace mint fails entirely: falls back to UT (preserves global users)", async () => {
        // workspaces/list \u2192 500. Client gives up on WT and uses UT directly.
        mockFetch
            .mockResolvedValueOnce(
                mockResponse({
                    ok: false,
                    status: 500,
                    body: { status: 500, msg: "server error" },
                }),
            )
            .mockResolvedValueOnce(recordingsResponse());

        const client = new PlaudClient(UT, API_BASE);
        await client.getRecordings(0, 10);

        expect(mockFetch).toHaveBeenCalledTimes(2);
        // Recording call uses UT, not WT.
        expect(authHeaderFromCall(mockFetch.mock.calls[1])).toBe(
            `Bearer ${UT}`,
        );
        expect(client.usingUserTokenFallback).toBe(true);
        expect(client.workspaceId).toBeUndefined();
    });

    it("concurrent requests share a single WT mint", async () => {
        // 1. workspaces/list   2. mint WT   3+4. two parallel /file/simple/web
        mockFetch
            .mockResolvedValueOnce(workspaceListResponse(WORKSPACE_ID))
            .mockResolvedValueOnce(workspaceTokenResponse(WT))
            .mockResolvedValueOnce(recordingsResponse())
            .mockResolvedValueOnce(recordingsResponse());

        const client = new PlaudClient(UT, API_BASE);
        await Promise.all([
            client.getRecordings(0, 10),
            client.getRecordings(10, 10),
        ]);

        // 4 total calls: 1 list + 1 mint + 2 recordings (NOT 1+1+1+1+2 = 6).
        expect(mockFetch).toHaveBeenCalledTimes(4);
        expect(authHeaderFromCall(mockFetch.mock.calls[2])).toBe(
            `Bearer ${WT}`,
        );
        expect(authHeaderFromCall(mockFetch.mock.calls[3])).toBe(
            `Bearer ${WT}`,
        );
    });
});
