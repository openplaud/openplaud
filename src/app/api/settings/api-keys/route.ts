import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import {
    createApiKey,
    getApiKeyPrefix,
    hashApiKey,
    normalizeApiKeyScopes,
} from "@/lib/auth-request";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

function serializeApiKey(apiKey: typeof apiKeys.$inferSelect) {
    return {
        id: apiKey.id,
        name: apiKey.name,
        keyPrefix: apiKey.keyPrefix,
        source: apiKey.source,
        scopes: apiKey.scopes,
        lastUsedAt: apiKey.lastUsedAt,
        expiresAt: apiKey.expiresAt,
        revokedAt: apiKey.revokedAt,
        createdAt: apiKey.createdAt,
    };
}

function parseExpiresAt(value: unknown): Date | null {
    if (value == null || value === "") return null;
    if (typeof value !== "string") {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "expiresAt must be a string",
            400,
            { field: "expiresAt" },
        );
    }

    const expiresAt = new Date(value);
    if (Number.isNaN(expiresAt.getTime())) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "expiresAt must be an ISO timestamp",
            400,
            { field: "expiresAt" },
        );
    }
    return expiresAt;
}

export const GET = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    const rows = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.userId, session.user.id))
        .orderBy(desc(apiKeys.createdAt));

    return NextResponse.json({ apiKeys: rows.map(serializeApiKey) });
});

export const POST = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    const body = (await request.json().catch(() => ({}))) as Record<
        string,
        unknown
    >;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "API key name is required",
            400,
            { field: "name" },
        );
    }
    if (name.length > 120) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "API key name must be 120 characters or less",
            400,
            { field: "name" },
        );
    }

    const expiresAt = parseExpiresAt(body.expiresAt);
    if (expiresAt && expiresAt <= new Date()) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "expiresAt must be in the future",
            400,
            { field: "expiresAt" },
        );
    }

    const scopes = normalizeApiKeyScopes(body.scopes);
    const rawKey = createApiKey();

    const [apiKey] = await db
        .insert(apiKeys)
        .values({
            userId: session.user.id,
            name,
            keyHash: hashApiKey(rawKey),
            keyPrefix: getApiKeyPrefix(rawKey),
            source: "manual",
            scopes,
            expiresAt,
        })
        .returning();

    return NextResponse.json(
        {
            key: rawKey,
            apiKey: serializeApiKey(apiKey),
        },
        { status: 201 },
    );
});
