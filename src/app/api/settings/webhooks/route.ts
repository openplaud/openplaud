import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { webhookEndpoints } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/emit";
import {
    encryptWebhookSecret,
    encryptWebhookUrl,
} from "@/lib/webhooks/secrets";
import {
    parseWebhookEvents,
    serializeWebhookEndpoint,
} from "@/lib/webhooks/settings";
import { assertWebhookUrlAllowed, parseWebhookUrl } from "@/lib/webhooks/url";

function webhookValidationError(error: unknown): AppError {
    return new AppError(
        ErrorCode.INVALID_INPUT,
        error instanceof Error ? error.message : "Invalid webhook",
        400,
    );
}

export const GET = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    const endpoints = await db
        .select()
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.userId, session.user.id))
        .orderBy(desc(webhookEndpoints.createdAt));

    return NextResponse.json({
        webhooks: endpoints.map(serializeWebhookEndpoint),
        events: WEBHOOK_EVENTS,
    });
});

export const POST = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);
    const body = (await request.json().catch(() => ({}))) as Record<
        string,
        unknown
    >;

    let url: string;
    let events: string[];
    try {
        url = parseWebhookUrl(body.url);
        await assertWebhookUrlAllowed(url);
        events = parseWebhookEvents(body.events);
    } catch (error) {
        throw webhookValidationError(error);
    }

    const secret = `whsec_${nanoid(32)}`;
    const encryptedSecret = encryptWebhookSecret(secret);
    const encryptedUrl = encryptWebhookUrl(url);
    const [endpoint] = await db
        .insert(webhookEndpoints)
        .values({
            userId: session.user.id,
            url: encryptedUrl,
            secret: encryptedSecret,
            events,
            description:
                typeof body.description === "string" && body.description.trim()
                    ? body.description.trim()
                    : null,
            enabled: typeof body.enabled === "boolean" ? body.enabled : true,
        })
        .returning();

    return NextResponse.json(
        {
            webhook: serializeWebhookEndpoint(endpoint),
            secret,
        },
        { status: 201 },
    );
});
