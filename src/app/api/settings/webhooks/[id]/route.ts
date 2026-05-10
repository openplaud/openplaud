import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { webhookEndpoints } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { encryptWebhookUrl } from "@/lib/webhooks/secrets";
import {
    parseWebhookEvents,
    serializeWebhookEndpoint,
} from "@/lib/webhooks/settings";
import { assertWebhookUrlAllowed, parseWebhookUrl } from "@/lib/webhooks/url";

type IdContext = { params: Promise<{ id: string }> };

function webhookValidationError(error: unknown): AppError {
    return new AppError(
        ErrorCode.INVALID_INPUT,
        error instanceof Error ? error.message : "Invalid webhook",
        400,
    );
}

export const PATCH = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;
    const body = (await request.json().catch(() => ({}))) as Record<
        string,
        unknown
    >;
    const updates: Partial<typeof webhookEndpoints.$inferInsert> = {
        updatedAt: new Date(),
    };

    try {
        if (body.url !== undefined) {
            const url = parseWebhookUrl(body.url);
            await assertWebhookUrlAllowed(url);
            updates.url = encryptWebhookUrl(url);
        }
        if (body.events !== undefined) {
            updates.events = parseWebhookEvents(body.events);
        }
    } catch (error) {
        throw webhookValidationError(error);
    }

    if (body.enabled !== undefined) {
        if (typeof body.enabled !== "boolean") {
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                "enabled must be a boolean",
                400,
                { field: "enabled" },
            );
        }
        updates.enabled = body.enabled;
    }

    if (body.description !== undefined) {
        updates.description =
            typeof body.description === "string" && body.description.trim()
                ? body.description.trim()
                : null;
    }

    const [endpoint] = await db
        .update(webhookEndpoints)
        .set(updates)
        .where(
            and(
                eq(webhookEndpoints.id, id),
                eq(webhookEndpoints.userId, session.user.id),
            ),
        )
        .returning();

    if (!endpoint) {
        throw new AppError(ErrorCode.NOT_FOUND, "Webhook not found", 404, {
            id,
        });
    }

    return NextResponse.json({
        webhook: serializeWebhookEndpoint(endpoint),
    });
});

export const DELETE = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;
    const [endpoint] = await db
        .delete(webhookEndpoints)
        .where(
            and(
                eq(webhookEndpoints.id, id),
                eq(webhookEndpoints.userId, session.user.id),
            ),
        )
        .returning({ id: webhookEndpoints.id });

    if (!endpoint) {
        throw new AppError(ErrorCode.NOT_FOUND, "Webhook not found", 404, {
            id,
        });
    }

    return NextResponse.json({ success: true });
});
