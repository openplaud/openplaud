import { and, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { webhookDeliveries, webhookEndpoints } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { signalWebhookWorker } from "@/lib/webhooks/worker";

type DeliveryContext = {
    params: Promise<{ id: string; deliveryId: string }>;
};

export const POST = apiHandler<DeliveryContext>(async (request, context) => {
    const session = await requireApiSession(request);

    const { id, deliveryId } = await (context as DeliveryContext).params;
    const [endpoint] = await db
        .select({
            id: webhookEndpoints.id,
            enabled: webhookEndpoints.enabled,
        })
        .from(webhookEndpoints)
        .where(
            and(
                eq(webhookEndpoints.id, id),
                eq(webhookEndpoints.userId, session.user.id),
            ),
        )
        .limit(1);

    if (!endpoint) {
        throw new AppError(ErrorCode.NOT_FOUND, "Webhook not found", 404, {
            id,
        });
    }
    if (!endpoint.enabled) {
        throw new AppError(ErrorCode.CONFLICT, "Webhook is disabled", 409, {
            id,
        });
    }

    const [delivery] = await db
        .update(webhookDeliveries)
        .set({
            status: "pending",
            nextAttemptAt: new Date(),
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(webhookDeliveries.id, deliveryId),
                eq(webhookDeliveries.endpointId, endpoint.id),
                eq(webhookDeliveries.userId, session.user.id),
                ne(webhookDeliveries.status, "processing"),
            ),
        )
        .returning({ id: webhookDeliveries.id });

    if (!delivery) {
        const [existingDelivery] = await db
            .select({ status: webhookDeliveries.status })
            .from(webhookDeliveries)
            .where(
                and(
                    eq(webhookDeliveries.id, deliveryId),
                    eq(webhookDeliveries.endpointId, endpoint.id),
                    eq(webhookDeliveries.userId, session.user.id),
                ),
            )
            .limit(1);

        if (existingDelivery?.status === "processing") {
            throw new AppError(
                ErrorCode.CONFLICT,
                "Delivery is already processing",
                409,
                { id: deliveryId },
            );
        }

        throw new AppError(ErrorCode.NOT_FOUND, "Delivery not found", 404, {
            id: deliveryId,
        });
    }

    signalWebhookWorker();

    return NextResponse.json({ success: true });
});
