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
    maskApiKey,
    normalizeApiKeyScopes,
    validateApiKeyFormat,
} from "@/lib/auth-request";

describe("API keys", () => {
    beforeEach(() => {
        mockEnv.BETTER_AUTH_SECRET = "better-auth-secret-with-32-chars";
        mockEnv.API_TOKEN_HASH_SECRET = undefined;
    });

    it("generates op-prefixed base62 keys with a CRC32 checksum suffix", () => {
        const key = createApiKey();

        // Default payload length is 30, checksum is 4 → 3 + 30 + 4 = 37.
        expect(key).toMatch(/^op_[0-9A-Za-z]{34}$/);
        expect(key).toHaveLength(37);
        expect(getApiKeyPrefix(key)).toBe(key.slice(0, 12));
        expect(validateApiKeyFormat(key)).toBe(true);
    });

    it("rejects keys whose checksum does not match the payload", () => {
        const key = createApiKey();
        // Flip one payload character (anything in position 5 that is base62
        // but not equal to the original).
        const original = key[5];
        const swapped = original === "a" ? "b" : "a";
        const tampered = `${key.slice(0, 5)}${swapped}${key.slice(6)}`;

        expect(tampered).not.toBe(key);
        expect(validateApiKeyFormat(tampered)).toBe(false);
    });

    it("rejects legacy nanoid-shaped keys via validateApiKeyFormat", () => {
        // Strict format check: legacy `op_` + nanoid keys (which may include
        // `-` / `_` and carry no checksum) are not valid under the new scheme.
        // Authentication still accepts them — it looks up by HMAC hash —
        // this helper is intentionally stricter.
        expect(validateApiKeyFormat("op_abc-def_ghijklmnopqrstuv")).toBe(false);
        expect(validateApiKeyFormat("not-an-op-key")).toBe(false);
        expect(validateApiKeyFormat("op_short")).toBe(false);
    });

    it("masks a full key while preserving prefix and checksum", () => {
        const key = createApiKey();
        const masked = maskApiKey(key);

        expect(masked.startsWith(key.slice(0, 12))).toBe(true);
        expect(masked.endsWith(key.slice(-4))).toBe(true);
        expect(masked).toHaveLength(key.length);
        expect(masked).not.toBe(key);
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
