/**
 * Regression test for the Rybbit analytics proxy 404 bug:
 *   https://openplaud.com/api/_int/s.js returned 404 even though
 *   IS_HOSTED + RYBBIT_HOST + RYBBIT_SITE_ID were set on the host.
 *
 * Root cause: `next.config.ts` `rewrites()` is evaluated at `next build`.
 * The published Docker image (`ghcr.io/openplaud/openplaud:*`) is built
 * generically without those env vars, so the rewrite list was baked as
 * `[]` and never reinstated at runtime. <RybbitAnalytics> reads env at
 * request time and emitted <script src="/api/_int/s.js"> anyway -> 404.
 *
 * Fix: replace the build-time rewrites with runtime route handlers under
 * src/app/api/_int/* that read env at request time, in lockstep with the
 * component's render gate.
 *
 * This test verifies the runtime contract for those handlers:
 *   - unconfigured (RYBBIT_HOST or RYBBIT_SITE_ID missing) -> 404
 *   - configured -> proxies to ${RYBBIT_HOST}/api/{script.js,track,identify}
 *     with body forwarded and (for events) client IP / UA preserved.
 */

import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from "vitest";

// Mocked env module read by the route handlers. We mutate `mockEnv` per
// test and the handlers see the updated values because they reference
// `env.RYBBIT_HOST` etc. at request time, not at import time.
const mockEnv: {
    IS_HOSTED?: boolean;
    RYBBIT_HOST?: string;
    RYBBIT_SITE_ID?: string;
} = {};

vi.mock("@/lib/env", () => ({
    get env() {
        return mockEnv;
    },
}));

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;
let originalFetch: typeof globalThis.fetch;

beforeAll(() => {
    originalFetch = globalThis.fetch;
});

afterAll(() => {
    globalThis.fetch = originalFetch;
});

afterEach(() => {
    mockEnv.IS_HOSTED = undefined;
    mockEnv.RYBBIT_HOST = undefined;
    mockEnv.RYBBIT_SITE_ID = undefined;
    vi.restoreAllMocks();
});

function installFetchMock(response: Response) {
    fetchMock = vi.fn().mockResolvedValue(response);
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
}

describe("Rybbit proxy: /api/_int/s.js", () => {
    it("returns 404 when IS_HOSTED is false (self-host)", async () => {
        // Even if a self-hoster happens to set RYBBIT_*, the proxy stays
        // off unless IS_HOSTED=true, matching <RybbitAnalytics>'s gate.
        mockEnv.IS_HOSTED = false;
        mockEnv.RYBBIT_HOST = "https://rybbit.example.com";
        mockEnv.RYBBIT_SITE_ID = "site-1";
        const { GET } = await import("@/app/api/_int/s.js/route");
        const res = await GET();
        expect(res.status).toBe(404);
    });

    it("returns 404 when RYBBIT_HOST is missing", async () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.RYBBIT_SITE_ID = "site-1";
        const { GET } = await import("@/app/api/_int/s.js/route");
        const res = await GET();
        expect(res.status).toBe(404);
    });

    it("returns 404 when RYBBIT_SITE_ID is missing", async () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.RYBBIT_HOST = "https://rybbit.example.com";
        const { GET } = await import("@/app/api/_int/s.js/route");
        const res = await GET();
        expect(res.status).toBe(404);
    });

    it("proxies to RYBBIT_HOST/api/script.js when configured", async () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.RYBBIT_HOST = "https://rybbit.example.com";
        mockEnv.RYBBIT_SITE_ID = "site-1";
        installFetchMock(
            new Response("/* rybbit script */", {
                status: 200,
                headers: { "content-type": "application/javascript" },
            }),
        );

        const { GET } = await import("@/app/api/_int/s.js/route");
        const res = await GET();

        expect(fetchMock).toHaveBeenCalledWith(
            "https://rybbit.example.com/api/script.js",
            expect.objectContaining({ cache: "no-store" }),
        );
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain(
            "application/javascript",
        );
        expect(await res.text()).toBe("/* rybbit script */");
    });

    it("strips trailing slash from RYBBIT_HOST", async () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.RYBBIT_HOST = "https://rybbit.example.com/";
        mockEnv.RYBBIT_SITE_ID = "site-1";
        installFetchMock(new Response("ok", { status: 200 }));

        const { GET } = await import("@/app/api/_int/s.js/route");
        await GET();

        expect(fetchMock).toHaveBeenCalledWith(
            "https://rybbit.example.com/api/script.js",
            expect.anything(),
        );
    });

    it("returns 502 when upstream fails", async () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.RYBBIT_HOST = "https://rybbit.example.com";
        mockEnv.RYBBIT_SITE_ID = "site-1";
        installFetchMock(new Response("nope", { status: 500 }));

        const { GET } = await import("@/app/api/_int/s.js/route");
        const res = await GET();
        expect(res.status).toBe(502);
    });
});

describe("Rybbit proxy: /api/_int/track", () => {
    it("returns 404 when unconfigured", async () => {
        const { POST } = await import("@/app/api/_int/track/route");
        const res = await POST(
            new Request("https://app.example.com/api/_int/track", {
                method: "POST",
                body: JSON.stringify({ event: "pageview" }),
            }),
        );
        expect(res.status).toBe(404);
    });

    it("returns 404 when IS_HOSTED is false even if RYBBIT_* are set", async () => {
        mockEnv.IS_HOSTED = false;
        mockEnv.RYBBIT_HOST = "https://rybbit.example.com";
        mockEnv.RYBBIT_SITE_ID = "site-1";
        const { POST } = await import("@/app/api/_int/track/route");
        const res = await POST(
            new Request("https://app.example.com/api/_int/track", {
                method: "POST",
                body: "{}",
            }),
        );
        expect(res.status).toBe(404);
    });

    it("forwards body, content-type, UA, and X-Forwarded-For", async () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.RYBBIT_HOST = "https://rybbit.example.com";
        mockEnv.RYBBIT_SITE_ID = "site-1";
        installFetchMock(new Response("{}", { status: 202 }));

        const payload = JSON.stringify({ event: "pageview", path: "/" });
        const { POST } = await import("@/app/api/_int/track/route");
        const res = await POST(
            new Request("https://app.example.com/api/_int/track", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "user-agent": "Mozilla/5.0 test",
                    "x-forwarded-for": "203.0.113.7",
                    // Auth cookies must NOT be forwarded to the analytics
                    // backend - same-origin pages send them automatically.
                    cookie: "session=secret",
                    authorization: "Bearer secret",
                },
                body: payload,
            }),
        );

        expect(res.status).toBe(202);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://rybbit.example.com/api/track");
        expect(init.method).toBe("POST");
        const headers = new Headers(init.headers);
        expect(headers.get("content-type")).toBe("application/json");
        expect(headers.get("user-agent")).toBe("Mozilla/5.0 test");
        expect(headers.get("x-forwarded-for")).toBe("203.0.113.7");
        expect(headers.get("cookie")).toBeNull();
        expect(headers.get("authorization")).toBeNull();
        const body = init.body as ArrayBuffer;
        expect(new TextDecoder().decode(body)).toBe(payload);
    });

    it("falls back to X-Real-IP when X-Forwarded-For is absent", async () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.RYBBIT_HOST = "https://rybbit.example.com";
        mockEnv.RYBBIT_SITE_ID = "site-1";
        installFetchMock(new Response("{}", { status: 202 }));

        const { POST } = await import("@/app/api/_int/track/route");
        await POST(
            new Request("https://app.example.com/api/_int/track", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-real-ip": "203.0.113.9",
                },
                body: "{}",
            }),
        );

        const init = fetchMock.mock.calls[0][1] as RequestInit;
        const headers = new Headers(init.headers);
        expect(headers.get("x-forwarded-for")).toBe("203.0.113.9");
    });

    it("returns 502 when upstream fetch throws", async () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.RYBBIT_HOST = "https://rybbit.example.com";
        mockEnv.RYBBIT_SITE_ID = "site-1";
        fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

        const { POST } = await import("@/app/api/_int/track/route");
        const res = await POST(
            new Request("https://app.example.com/api/_int/track", {
                method: "POST",
                body: "{}",
            }),
        );
        expect(res.status).toBe(502);
    });
});

describe("Rybbit proxy: /api/_int/identify", () => {
    it("proxies to RYBBIT_HOST/api/identify", async () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.RYBBIT_HOST = "https://rybbit.example.com";
        mockEnv.RYBBIT_SITE_ID = "site-1";
        installFetchMock(new Response("{}", { status: 202 }));

        const { POST } = await import("@/app/api/_int/identify/route");
        const res = await POST(
            new Request("https://app.example.com/api/_int/identify", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ userId: "u_1" }),
            }),
        );

        expect(res.status).toBe(202);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://rybbit.example.com/api/identify",
            expect.objectContaining({ method: "POST" }),
        );
    });
});
