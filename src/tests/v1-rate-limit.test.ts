import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
    BETTER_AUTH_SECRET: "better-auth-secret-with-32-chars",
    API_TOKEN_HASH_SECRET: undefined as string | undefined,
    RATE_LIMIT_TRUST_PROXY_HEADERS: undefined as boolean | undefined,
}));

vi.mock("@/lib/env", () => ({
    env: mockEnv,
}));

vi.mock("@/db", () => ({
    db: {
        insert: vi.fn(),
    },
}));

import { db } from "@/db";
import { ErrorCode } from "@/lib/errors";
import {
    enforceV1AuthenticatedRateLimit,
    getClientIp,
} from "@/lib/v1/rate-limit";

describe("v1 rate limiting", () => {
    beforeEach(() => {
        mockEnv.BETTER_AUTH_SECRET = "better-auth-secret-with-32-chars";
        mockEnv.API_TOKEN_HASH_SECRET = undefined;
        mockEnv.RATE_LIMIT_TRUST_PROXY_HEADERS = undefined;
    });

    it("ignores spoofable forwarding headers unless proxy trust is enabled", () => {
        const request = new Request("http://localhost/api/v1/recordings", {
            headers: {
                "x-forwarded-for": "203.0.113.10",
                "x-real-ip": "203.0.113.11",
                "cf-connecting-ip": "203.0.113.12",
            },
        });

        expect(getClientIp(request)).toBe("unknown");
    });

    it("uses trusted proxy headers when explicitly enabled", () => {
        mockEnv.RATE_LIMIT_TRUST_PROXY_HEADERS = true;

        expect(
            getClientIp(
                new Request("http://localhost/api/v1/recordings", {
                    headers: { "cf-connecting-ip": "203.0.113.12" },
                }),
            ),
        ).toBe("203.0.113.12");

        expect(
            getClientIp(
                new Request("http://localhost/api/v1/recordings", {
                    headers: { "x-real-ip": "203.0.113.11" },
                }),
            ),
        ).toBe("203.0.113.11");

        expect(
            getClientIp(
                new Request("http://localhost/api/v1/recordings", {
                    headers: {
                        "x-forwarded-for":
                            "198.51.100.1, 198.51.100.2, 203.0.113.10",
                    },
                }),
            ),
        ).toBe("198.51.100.1");
    });

    it("returns the unified error envelope and headers when auth buckets are exhausted", async () => {
        const resetAt = new Date(Date.now() + 30_000);
        (db.insert as unknown as Mock).mockReturnValue({
            values: vi.fn().mockReturnValue({
                onConflictDoUpdate: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([
                        {
                            count: 601,
                            resetAt,
                        },
                    ]),
                }),
            }),
        });

        const response = await enforceV1AuthenticatedRateLimit({
            user: { id: "user-1" },
            via: "api-key",
            apiKeyId: "api-key-1",
        });

        expect(response).not.toBeNull();
        if (!response) return;
        expect(response.status).toBe(429);
        expect(response.headers.get("Retry-After")).toBeTruthy();
        expect(response.headers.get("X-RateLimit-Limit")).toBe("600");
        expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
        expect(response.headers.get("X-RateLimit-Reset")).toBe(
            Math.ceil(resetAt.getTime() / 1000).toString(),
        );
        await expect(response.json()).resolves.toEqual({
            error: "Rate limit exceeded",
            code: ErrorCode.RATE_LIMITED,
            details: {
                retryAfter: expect.any(Number) as number,
                limit: 600,
                remaining: 0,
                resetAt: Math.ceil(resetAt.getTime() / 1000),
            },
        });
    });
});
