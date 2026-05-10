import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

type IdContext = { params: Promise<{ id: string }> };

export const DELETE = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);

    const { id } = await (context as IdContext).params;
    const now = new Date();
    const [apiKey] = await db
        .update(apiKeys)
        .set({ revokedAt: now, updatedAt: now })
        .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, session.user.id)))
        .returning({ id: apiKeys.id });

    if (!apiKey) {
        throw new AppError(ErrorCode.NOT_FOUND, "API key not found", 404, {
            id,
        });
    }

    return NextResponse.json({ success: true });
});
