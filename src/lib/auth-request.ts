import { createHmac } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { apiKeys, users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { AppError, ErrorCode } from "@/lib/errors";

export type AuthenticatedRequest = {
    user: { id: string };
    via: "session" | "api-key";
    apiKeyId?: string;
};

export type ApiKeyRow = typeof apiKeys.$inferSelect;

const API_KEY_PREFIX = "op_";
const API_KEY_RANDOM_LENGTH = 24;
const DISPLAY_PREFIX_LENGTH = 12;

export function createApiKey(): string {
    return `${API_KEY_PREFIX}${nanoid(API_KEY_RANDOM_LENGTH)}`;
}

export function hashApiKey(apiKey: string): string {
    const key = env.API_TOKEN_HASH_SECRET ?? env.BETTER_AUTH_SECRET;
    if (!key) {
        throw new Error("API key hash secret is not configured");
    }
    return createHmac("sha256", key).update(apiKey).digest("hex");
}

export function getApiKeyPrefix(apiKey: string): string {
    return apiKey.slice(0, DISPLAY_PREFIX_LENGTH);
}

export function isApiKeyActive(
    apiKey: Pick<ApiKeyRow, "expiresAt" | "revokedAt">,
    now = new Date(),
): boolean {
    if (apiKey.revokedAt) return false;
    if (apiKey.expiresAt && apiKey.expiresAt <= now) return false;
    return true;
}

export function normalizeApiKeyScopes(scopes: unknown): string[] {
    if (!Array.isArray(scopes)) return ["read"];
    const normalized = scopes.filter((scope): scope is string => {
        return scope === "read";
    });
    return normalized.length > 0 ? normalized : ["read"];
}

function getBearerToken(request: Request): string | null {
    const authorization = request.headers.get("authorization");
    if (!authorization) return null;

    const match = authorization.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || null;
}

async function assertUserNotSuspended(userId: string): Promise<void> {
    const [user] = await db
        .select({ suspendedAt: users.suspendedAt })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

    if (user?.suspendedAt) {
        throw new AppError(
            ErrorCode.ACCOUNT_SUSPENDED,
            "Account suspended",
            403,
        );
    }
}

export async function authenticateRequest(
    request: Request,
): Promise<AuthenticatedRequest | null> {
    const bearerToken = getBearerToken(request);

    if (bearerToken?.startsWith(API_KEY_PREFIX)) {
        const keyHash = hashApiKey(bearerToken);
        const now = new Date();

        const [apiKey] = await db
            .select()
            .from(apiKeys)
            .where(
                and(
                    eq(apiKeys.keyHash, keyHash),
                    isNull(apiKeys.revokedAt),
                    or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now)),
                ),
            )
            .limit(1);

        if (!apiKey) return null;
        await assertUserNotSuspended(apiKey.userId);

        void db
            .update(apiKeys)
            .set({ lastUsedAt: now, updatedAt: now })
            .where(
                and(
                    eq(apiKeys.id, apiKey.id),
                    eq(apiKeys.userId, apiKey.userId),
                ),
            )
            .catch((error) => {
                console.error("Failed to update API key last_used_at:", error);
            });

        return {
            user: { id: apiKey.userId },
            via: "api-key",
            apiKeyId: apiKey.id,
        };
    }

    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) return null;
    await assertUserNotSuspended(session.user.id);

    return {
        user: { id: session.user.id },
        via: "session",
    };
}
