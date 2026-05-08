import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
    BETTER_AUTH_SECRET: "better-auth-secret-with-32-chars",
    API_TOKEN_HASH_SECRET: undefined as string | undefined,
}));

vi.mock("@/lib/env", () => ({
    env: mockEnv,
}));

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock("@/lib/auth", () => ({
    auth: {
        api: {
            getSession: vi.fn(),
        },
    },
}));

import {
    createApiKey,
    getApiKeyPrefix,
    hashApiKey,
    isApiKeyActive,
    normalizeApiKeyScopes,
} from "@/lib/auth-request";

describe("API keys", () => {
    beforeEach(() => {
        mockEnv.BETTER_AUTH_SECRET = "better-auth-secret-with-32-chars";
        mockEnv.API_TOKEN_HASH_SECRET = undefined;
    });

    it("generates op-prefixed keys and display prefixes", () => {
        const key = createApiKey();

        expect(key).toMatch(/^op_[A-Za-z0-9_-]{24}$/);
        expect(getApiKeyPrefix(key)).toBe(key.slice(0, 12));
    });

    it("hashes keys deterministically without storing the raw key", () => {
        const key = "op_testkey";
        const hash = hashApiKey(key);

        expect(hash).toHaveLength(64);
        expect(hash).toBe(hashApiKey(key));
        expect(hash).not.toContain(key);
        expect(hash).toBe(
            createHmac("sha256", mockEnv.BETTER_AUTH_SECRET)
                .update(key)
                .digest("hex"),
        );
    });

    it("hashes the same key differently when the HMAC key changes", () => {
        const key = "op_testkey";
        const first = hashApiKey(key);

        mockEnv.BETTER_AUTH_SECRET = "different-better-auth-secret-32-chars";
        const second = hashApiKey(key);

        expect(second).not.toBe(first);
    });

    it("uses API_TOKEN_HASH_SECRET before BETTER_AUTH_SECRET", () => {
        const key = "op_testkey";
        mockEnv.API_TOKEN_HASH_SECRET = "api-token-hash-secret-32-characters";

        const hash = hashApiKey(key);

        expect(hash).toBe(
            createHmac("sha256", mockEnv.API_TOKEN_HASH_SECRET)
                .update(key)
                .digest("hex"),
        );
        expect(hash).not.toBe(
            createHmac("sha256", mockEnv.BETTER_AUTH_SECRET)
                .update(key)
                .digest("hex"),
        );
    });

    it("treats revoked and expired keys as inactive", () => {
        const now = new Date("2026-05-06T12:00:00.000Z");

        expect(isApiKeyActive({ revokedAt: null, expiresAt: null }, now)).toBe(
            true,
        );
        expect(
            isApiKeyActive(
                {
                    revokedAt: new Date("2026-05-06T11:00:00.000Z"),
                    expiresAt: null,
                },
                now,
            ),
        ).toBe(false);
        expect(
            isApiKeyActive(
                {
                    revokedAt: null,
                    expiresAt: new Date("2026-05-06T11:00:00.000Z"),
                },
                now,
            ),
        ).toBe(false);
    });

    it("normalizes scopes to read-only", () => {
        expect(normalizeApiKeyScopes(["read", "write", 1])).toEqual(["read"]);
        expect(normalizeApiKeyScopes([])).toEqual(["read"]);
        expect(normalizeApiKeyScopes("read")).toEqual(["read"]);
    });
});
