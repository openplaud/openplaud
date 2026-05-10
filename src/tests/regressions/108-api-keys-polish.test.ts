import { getTableConfig } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/lib/env", () => ({
    env: {
        BETTER_AUTH_SECRET: "better-auth-secret-with-32-chars",
        API_TOKEN_HASH_SECRET: undefined,
    },
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

import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
    authenticateRequest,
    createApiKey,
    hashApiKey,
} from "@/lib/auth-request";
import { ErrorCode } from "@/lib/errors";

describe("Issue #108 - API keys polish", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (auth.api.getSession as unknown as Mock).mockResolvedValue(null);
    });

    it("uses the api_keys schema with source and usage metadata", () => {
        const config = getTableConfig(apiKeys);
        const columns = config.columns.map((column) => column.name);
        const indexes = config.indexes.map((index) => index.config.name);

        expect(config.name).toBe("api_keys");
        expect(columns).toEqual(
            expect.arrayContaining([
                "name",
                "source",
                "last_used_at",
                "key_hash",
                "key_prefix",
            ]),
        );
        // No explicit `api_keys_key_hash_idx` — the unique constraint
        // creates an implicit btree index that the bearer-token lookup
        // already uses. A second explicit index would just double the
        // write cost on every key issue / revoke.
        expect(indexes).toEqual(
            expect.arrayContaining(["api_keys_user_id_idx"]),
        );
        expect(indexes).not.toContain("api_keys_key_hash_idx");
    });

    it("only accepts op-prefixed keys and updates lastUsedAt on successful auth", async () => {
        const legacyResult = await authenticateRequest(
            new Request("http://localhost/api/v1/recordings", {
                headers: { Authorization: "Bearer opp_legacy" },
            }),
        );

        expect(legacyResult).toBeNull();
        expect(db.select).not.toHaveBeenCalled();

        const key = createApiKey();
        const keyHash = hashApiKey(key);
        const updateSet = vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
        });
        (db.update as unknown as Mock).mockReturnValue({ set: updateSet });
        (db.select as unknown as Mock).mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([
                        {
                            id: "api-key-108",
                            userId: "user-108",
                            name: "Hermes",
                            keyHash,
                            keyPrefix: key.slice(0, 12),
                            source: "manual",
                            scopes: ["read"],
                            lastUsedAt: null,
                            expiresAt: null,
                            revokedAt: null,
                            createdAt: new Date("2026-05-06T12:00:00.000Z"),
                            updatedAt: new Date("2026-05-06T12:00:00.000Z"),
                        },
                    ]),
                }),
            }),
        });

        const result = await authenticateRequest(
            new Request("http://localhost/api/v1/recordings", {
                headers: { Authorization: `Bearer ${key}` },
            }),
        );

        expect(result).toEqual({
            user: { id: "user-108" },
            via: "api-key",
            apiKeyId: "api-key-108",
        });
        expect(updateSet).toHaveBeenCalledWith(
            expect.objectContaining({
                lastUsedAt: expect.any(Date) as Date,
                updatedAt: expect.any(Date) as Date,
            }),
        );
    });

    it("rejects API-key authentication when the owning user is suspended", async () => {
        const key = createApiKey();
        const keyHash = hashApiKey(key);

        (db.select as unknown as Mock)
            .mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([
                            {
                                id: "api-key-108",
                                userId: "user-108",
                                name: "Hermes",
                                keyHash,
                                keyPrefix: key.slice(0, 12),
                                source: "manual",
                                scopes: ["read"],
                                lastUsedAt: null,
                                expiresAt: null,
                                revokedAt: null,
                                createdAt: new Date("2026-05-06T12:00:00.000Z"),
                                updatedAt: new Date("2026-05-06T12:00:00.000Z"),
                            },
                        ]),
                    }),
                }),
            })
            .mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([
                            {
                                suspendedAt: new Date(
                                    "2026-05-06T12:00:00.000Z",
                                ),
                            },
                        ]),
                    }),
                }),
            });

        await expect(
            authenticateRequest(
                new Request("http://localhost/api/v1/recordings", {
                    headers: { Authorization: `Bearer ${key}` },
                }),
            ),
        ).rejects.toMatchObject({
            code: ErrorCode.ACCOUNT_SUSPENDED,
            statusCode: 403,
        });
        expect(db.update).not.toHaveBeenCalled();
    });
});
