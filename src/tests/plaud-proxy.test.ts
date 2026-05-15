/**
 * Unit tests for the Plaud outbound proxy layer.
 *
 * What's pinned here:
 *   - `shouldProxyPlaud` only matches Plaud-owned hostnames over HTTPS.
 *   - `plaudFetch` falls through to direct fetch when Webshare isn't
 *     configured (the self-host default — must not regress).
 *   - With a Webshare list available, `plaudFetch` selects a proxy and
 *     attaches an undici `dispatcher` to the fetch call.
 *   - A 403 response while proxied triggers exactly one rotation, after
 *     which the original response is returned (we don't loop forever
 *     and we don't blow past the rotation budget).
 *   - Non-Plaud URLs are never proxied even if Webshare is configured.
 */

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    type Mock,
    vi,
} from "vitest";

const mockEnv = vi.hoisted(() => ({
    WEBSHARE_API_KEY: undefined as string | undefined,
}));

vi.mock("@/lib/env", () => ({ env: mockEnv }));

import { _resetPlaudFetchForTest, plaudFetch } from "@/lib/plaud/fetch";
import {
    _resetPlaudProxyCacheForTest,
    isPlaudProxyConfigured,
    shouldProxyPlaud,
} from "@/lib/plaud/proxy";

const originalFetch = global.fetch;
let mockFetch: Mock;

const PLAUD_API_URL =
    "https://api-euc1.plaud.ai/team-app/workspaces/list?need_personal_workspace=true";

function okResponse(): Response {
    return new Response('{"status":0,"data":{"workspaces":[]}}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
}

function forbiddenResponse(): Response {
    return new Response("<html>Cloudflare</html>", {
        status: 403,
        headers: { "Content-Type": "text/html" },
    });
}

function webshareList(proxies: Array<Record<string, unknown>>): Response {
    return new Response(JSON.stringify({ results: proxies }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
}

const sampleProxy = {
    id: "p1",
    username: "u",
    password: "p",
    proxy_address: "1.2.3.4",
    port: 8080,
    valid: true,
};
const otherProxy = {
    id: "p2",
    username: "u2",
    password: "p2",
    proxy_address: "5.6.7.8",
    port: 8081,
    valid: true,
};

beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as typeof global.fetch;
    mockEnv.WEBSHARE_API_KEY = undefined;
    _resetPlaudProxyCacheForTest();
    _resetPlaudFetchForTest();
});

afterEach(() => {
    global.fetch = originalFetch;
});

describe("shouldProxyPlaud", () => {
    it("matches Plaud API hosts over HTTPS", () => {
        expect(shouldProxyPlaud("https://api.plaud.ai/foo")).toBe(true);
        expect(shouldProxyPlaud("https://api-euc1.plaud.ai/foo")).toBe(true);
        expect(shouldProxyPlaud("https://api-apse1.plaud.ai/foo")).toBe(true);
        expect(shouldProxyPlaud("https://resource.plaud.ai/foo")).toBe(true);
        expect(shouldProxyPlaud("https://plaud.ai/")).toBe(true);
    });

    it("rejects non-Plaud, http, and malformed URLs", () => {
        expect(shouldProxyPlaud("https://example.com/")).toBe(false);
        expect(shouldProxyPlaud("https://plaud.ai.evil.com/")).toBe(false);
        expect(shouldProxyPlaud("http://api.plaud.ai/")).toBe(false);
        expect(shouldProxyPlaud("not-a-url")).toBe(false);
    });
});

describe("plaudFetch without Webshare configured", () => {
    it("calls global fetch directly with no dispatcher", async () => {
        mockFetch.mockResolvedValueOnce(okResponse());

        const res = await plaudFetch(PLAUD_API_URL);
        expect(res.status).toBe(200);
        expect(mockFetch).toHaveBeenCalledTimes(1);

        const [, init] = mockFetch.mock.calls[0];
        expect(init?.dispatcher).toBeUndefined();
        expect(isPlaudProxyConfigured()).toBe(false);
    });

    it("does not proxy non-Plaud URLs", async () => {
        mockFetch.mockResolvedValueOnce(okResponse());
        await plaudFetch("https://example.com/x");
        const [, init] = mockFetch.mock.calls[0];
        expect(init?.dispatcher).toBeUndefined();
    });
});

describe("plaudFetch with Webshare configured", () => {
    beforeEach(() => {
        mockEnv.WEBSHARE_API_KEY = "test-key";
    });

    it("fetches the Webshare list and attaches a dispatcher", async () => {
        mockFetch
            // 1) Webshare list call
            .mockResolvedValueOnce(webshareList([sampleProxy]))
            // 2) actual Plaud call through the proxy
            .mockResolvedValueOnce(okResponse());

        const res = await plaudFetch(PLAUD_API_URL);
        expect(res.status).toBe(200);
        expect(mockFetch).toHaveBeenCalledTimes(2);

        const [listUrl] = mockFetch.mock.calls[0];
        expect(String(listUrl)).toContain("proxy.webshare.io");

        const [plaudUrl, init] = mockFetch.mock.calls[1];
        expect(String(plaudUrl)).toBe(PLAUD_API_URL);
        // dispatcher is an undici ProxyAgent instance — we just assert
        // shape, not identity, because the cache lazy-constructs it.
        expect(init?.dispatcher).toBeDefined();
        expect(typeof init?.dispatcher).toBe("object");
    });

    it("rotates exactly once on 403 and returns the second response", async () => {
        mockFetch
            // Webshare list (two proxies so rotation has a target)
            .mockResolvedValueOnce(webshareList([sampleProxy, otherProxy]))
            // first proxied attempt: blocked
            .mockResolvedValueOnce(forbiddenResponse())
            // second proxied attempt: also blocked, but we've burned the budget
            .mockResolvedValueOnce(forbiddenResponse());

        const res = await plaudFetch(PLAUD_API_URL);
        expect(res.status).toBe(403);
        // 1 list call + 2 plaud attempts = 3 fetches. Crucially NOT 4.
        expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("returns a readable body when rotation is exhausted (no second proxy)", async () => {
        // Pins the fix for cubic P1 (canceled-body bug): when only one
        // proxy is available and it 403s, plaudFetch must surface the
        // 403 Response with its body intact so the caller can parse it.
        mockFetch
            .mockResolvedValueOnce(webshareList([sampleProxy]))
            .mockResolvedValueOnce(forbiddenResponse());

        const res = await plaudFetch(PLAUD_API_URL);
        expect(res.status).toBe(403);
        // The critical assertion: body has not been canceled. Reading
        // it would throw with `TypeError: Body is unusable` if the bug
        // were present.
        const text = await res.text();
        expect(text).toContain("Cloudflare");
    });

    it("returns the success response after a rotation succeeds", async () => {
        mockFetch
            .mockResolvedValueOnce(webshareList([sampleProxy, otherProxy]))
            .mockResolvedValueOnce(forbiddenResponse())
            .mockResolvedValueOnce(okResponse());

        const res = await plaudFetch(PLAUD_API_URL);
        expect(res.status).toBe(200);
        expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("falls through to direct fetch when Webshare list is empty", async () => {
        mockFetch
            .mockResolvedValueOnce(webshareList([]))
            .mockResolvedValueOnce(okResponse());

        const res = await plaudFetch(PLAUD_API_URL);
        expect(res.status).toBe(200);
        // Second call must NOT carry a dispatcher.
        const [, init] = mockFetch.mock.calls[1];
        expect(init?.dispatcher).toBeUndefined();
    });

    it("does not proxy non-Plaud URLs even when configured", async () => {
        mockFetch.mockResolvedValueOnce(okResponse());
        await plaudFetch("https://s3.amazonaws.com/some-bucket/file");
        // Only the direct call; no Webshare list lookup.
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [, init] = mockFetch.mock.calls[0];
        expect(init?.dispatcher).toBeUndefined();
    });
});
