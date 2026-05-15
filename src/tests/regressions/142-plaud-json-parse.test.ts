/**
 * Regression test for issue #142 (and the OTP-flow path in #137):
 *   "Plaud OTP Email - Failed to parse JSON"
 *
 * When Plaud's Cloudflare WAF 403s a request, the response body is an HTML
 * challenge page rather than JSON. Pre-fix, `plaudSendCode` / `plaudVerifyOtp`
 * called `await res.json()` unguarded \u2014 the raw `SyntaxError` escaped the
 * helper, bypassed every `AppError` mapper, and `apiHandler` flattened it
 * to `INTERNAL_ERROR` (500). The user saw "An unexpected error occurred"
 * and the server logged `INTERNAL_ERROR SyntaxError: Failed to parse JSON`.
 *
 * The fix routes JSON parsing through `safeParseJson` (src/lib/plaud/parse.ts)
 * which throws a status-mapped `AppError` instead of a raw `SyntaxError`.
 *
 * These tests assert the four affected helpers (`plaudSendCode`,
 * `plaudVerifyOtp`, `listPlaudWorkspaces`, `mintPlaudWorkspaceToken`)
 * convert a non-JSON 403 / 200 body into a structured `AppError` with the
 * right `code`, HTTP `statusCode`, and a `bodySnippet` in `details`.
 *
 * Note: `client.ts:request` already had a catch-all that mapped raw errors
 * to `PLAUD_UPSTREAM_ERROR` (502), so this test exists primarily for the
 * auth + workspace helpers that lacked that net.
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
import { AppError, ErrorCode } from "@/lib/errors";
import { plaudSendCode, plaudVerifyOtp } from "@/lib/plaud/auth";
import {
    listPlaudWorkspaces,
    mintPlaudWorkspaceToken,
} from "@/lib/plaud/workspace";

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
    mockFetch.mockReset();
});

const API_BASE = "https://api-euc1.plaud.ai";
const HTML_BODY =
    "<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title></head><body>...</body></html>";

/**
 * Build a mock `Response` whose `.text()` returns a Cloudflare-shaped HTML
 * body and whose `.json()` would throw \u2014 i.e. exactly what Plaud returns
 * when its WAF rejects a request.
 *
 * `listPlaudWorkspaces` short-circuits on `!res.ok` *before* parsing the
 * body and throws `PLAUD_API_ERROR` directly, so its assertion is on the
 * code, not on a body snippet. The auth helpers parse the body
 * unconditionally and route through `safeParseJson`.
 */
function mockCloudflare403() {
    return {
        ok: false,
        status: 403,
        statusText: "Forbidden",
        headers: { get: () => null },
        text: () => Promise.resolve(HTML_BODY),
        json: () =>
            Promise.reject(
                new SyntaxError(
                    "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON",
                ),
            ),
    };
}

/**
 * Same shape but HTTP 200 \u2014 simulates a WAF that returns a challenge
 * page with a successful status (rare, but possible on some Cloudflare
 * configurations). Exercises the success-path defensive parse.
 */
function mock200Html() {
    return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => null },
        text: () => Promise.resolve(HTML_BODY),
        json: () =>
            Promise.reject(
                new SyntaxError(
                    "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON",
                ),
            ),
    };
}

describe("issue #142: non-JSON Plaud response \u2192 structured AppError", () => {
    it("plaudSendCode on Cloudflare 403 throws PLAUD_API_ERROR, not SyntaxError", async () => {
        mockFetch.mockResolvedValueOnce(mockCloudflare403());
        await expect(
            plaudSendCode("user@example.com", API_BASE),
        ).rejects.toMatchObject({
            // Crucially NOT a `SyntaxError` \u2014 that's the pre-fix bug.
            name: "AppError",
            code: ErrorCode.PLAUD_API_ERROR,
            statusCode: 400,
            details: expect.objectContaining({
                plaudStatus: 403,
                bodySnippet: expect.stringContaining("<!DOCTYPE"),
            }),
        });
    });

    it("plaudSendCode on 200 with HTML body throws PLAUD_UPSTREAM_ERROR", async () => {
        mockFetch.mockResolvedValueOnce(mock200Html());
        try {
            await plaudSendCode("user@example.com", API_BASE);
            throw new Error("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).code).toBe(ErrorCode.PLAUD_UPSTREAM_ERROR);
            expect((err as AppError).statusCode).toBe(502);
        }
    });

    it("plaudVerifyOtp on Cloudflare 403 throws PLAUD_API_ERROR, not SyntaxError", async () => {
        mockFetch.mockResolvedValueOnce(mockCloudflare403());
        await expect(
            plaudVerifyOtp("123456", "otp.token", API_BASE),
        ).rejects.toMatchObject({
            name: "AppError",
            code: ErrorCode.PLAUD_API_ERROR,
            statusCode: 400,
        });
    });

    it("listPlaudWorkspaces on Cloudflare 403 throws PLAUD_API_ERROR (existing !res.ok branch)", async () => {
        mockFetch.mockResolvedValueOnce(mockCloudflare403());
        // This helper had a pre-existing `!res.ok` guard so it already
        // produced `PLAUD_API_ERROR` before #142; the fix preserves that
        // behavior and adds defensive parse on the success path.
        await expect(
            listPlaudWorkspaces("ut.token", API_BASE),
        ).rejects.toMatchObject({
            name: "AppError",
            code: ErrorCode.PLAUD_API_ERROR,
        });
    });

    it("mintPlaudWorkspaceToken on Cloudflare 403 throws WorkspaceTokenError (existing !res.ok branch)", async () => {
        mockFetch.mockResolvedValueOnce(mockCloudflare403());
        await expect(
            mintPlaudWorkspaceToken("ut.token", "ws_x", API_BASE),
        ).rejects.toMatchObject({
            // Pre-existing typed error \u2014 same as listPlaudWorkspaces,
            // here purely as a guard that the fix didn't regress the
            // status-401 / stale-cache contract that downstream relies on.
            name: "WorkspaceTokenError",
        });
    });
});
