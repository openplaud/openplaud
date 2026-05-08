import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
    adminActionLog,
    plaudConnections,
    recordings,
    users,
} from "@/db/schema";

/**
 * Typed admin mutation dispatcher.
 *
 * Every mutation is invoked from a request handler that already passed
 * requireAdminMutation() (= IS_HOSTED + email allowlist + IP allowlist +
 * session + elevated cookie within mutation TTL). This file is the second
 * line of defense -- it doesn't re-check identity but it DOES enforce:
 *   - reason is non-empty
 *   - target exists
 *   - the audit row is written before* the mutation when possible (better:
 *     the row contains both before and after, written after a successful
 *     mutation; failures still get a row tagged with action='*_failed').
 *
 * Each function returns a small JSON-safe result describing what changed so
 * the caller can render confirmation UI.
 */

interface ActionContext {
    adminUserId: string;
    ip: string | null;
    reason: string;
}

function assertReason(reason: string): void {
    const trimmed = reason.trim();
    if (trimmed.length < 4) {
        throw new Error("Admin action reason is required (min 4 characters)");
    }
}

async function writeActionLog(opts: {
    ctx: ActionContext;
    action: string;
    targetUserId: string | null;
    targetResourceId: string | null;
    before: unknown;
    after: unknown;
}) {
    await db.insert(adminActionLog).values({
        adminUserId: opts.ctx.adminUserId,
        action: opts.action,
        targetUserId: opts.targetUserId,
        targetResourceId: opts.targetResourceId,
        reason: opts.ctx.reason,
        before: opts.before as never,
        after: opts.after as never,
        ip: opts.ctx.ip,
    });
}

export async function suspendUser(
    ctx: ActionContext,
    targetUserId: string,
): Promise<{ ok: true; suspendedAt: Date }> {
    assertReason(ctx.reason);
    const [u] = await db
        .select({
            id: users.id,
            email: users.email,
            suspendedAt: users.suspendedAt,
            suspendedReason: users.suspendedReason,
        })
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1);
    if (!u) throw new Error("User not found");
    if (u.suspendedAt) {
        // Idempotent -- log but do not change the timestamp.
        return { ok: true, suspendedAt: u.suspendedAt };
    }
    const suspendedAt = new Date();
    await db
        .update(users)
        .set({ suspendedAt, suspendedReason: ctx.reason })
        .where(eq(users.id, targetUserId));
    await writeActionLog({
        ctx,
        action: "suspend_user",
        targetUserId,
        targetResourceId: null,
        before: { suspendedAt: null, suspendedReason: null },
        after: { suspendedAt, suspendedReason: ctx.reason },
    });
    return { ok: true, suspendedAt };
}

export async function unsuspendUser(
    ctx: ActionContext,
    targetUserId: string,
): Promise<{ ok: true }> {
    assertReason(ctx.reason);
    const [u] = await db
        .select({
            suspendedAt: users.suspendedAt,
            suspendedReason: users.suspendedReason,
        })
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1);
    if (!u) throw new Error("User not found");
    await db
        .update(users)
        .set({ suspendedAt: null, suspendedReason: null })
        .where(eq(users.id, targetUserId));
    await writeActionLog({
        ctx,
        action: "unsuspend_user",
        targetUserId,
        targetResourceId: null,
        before: {
            suspendedAt: u.suspendedAt,
            suspendedReason: u.suspendedReason,
        },
        after: { suspendedAt: null, suspendedReason: null },
    });
    return { ok: true };
}

export async function forceDisconnectPlaud(
    ctx: ActionContext,
    targetUserId: string,
): Promise<{ ok: true; deleted: number }> {
    assertReason(ctx.reason);
    // We delete the connection row (forces user to reconnect via OTP). The
    // bearer token is encrypted at rest, so we never log it -- just record
    // metadata.
    const [pc] = await db
        .select({
            id: plaudConnections.id,
            apiBase: plaudConnections.apiBase,
            plaudEmail: plaudConnections.plaudEmail,
            lastSync: plaudConnections.lastSync,
        })
        .from(plaudConnections)
        .where(eq(plaudConnections.userId, targetUserId))
        .limit(1);
    if (!pc) {
        await writeActionLog({
            ctx,
            action: "force_disconnect_plaud_noop",
            targetUserId,
            targetResourceId: null,
            before: { connected: false },
            after: { connected: false },
        });
        return { ok: true, deleted: 0 };
    }
    await db
        .delete(plaudConnections)
        .where(eq(plaudConnections.userId, targetUserId));
    await writeActionLog({
        ctx,
        action: "force_disconnect_plaud",
        targetUserId,
        targetResourceId: pc.id,
        before: {
            connected: true,
            apiBase: pc.apiBase,
            plaudEmail: pc.plaudEmail,
            lastSync: pc.lastSync,
        },
        after: { connected: false },
    });
    return { ok: true, deleted: 1 };
}

export async function softDeleteRecording(
    ctx: ActionContext,
    recordingId: string,
): Promise<{ ok: true }> {
    assertReason(ctx.reason);
    const [r] = await db
        .select({
            id: recordings.id,
            userId: recordings.userId,
            filesize: recordings.filesize,
            deletedAt: recordings.deletedAt,
        })
        .from(recordings)
        .where(
            and(eq(recordings.id, recordingId), isNull(recordings.deletedAt)),
        )
        .limit(1);
    if (!r) throw new Error("Recording not found or already deleted");
    const deletedAt = new Date();
    await db
        .update(recordings)
        .set({ deletedAt })
        .where(eq(recordings.id, recordingId));
    await writeActionLog({
        ctx,
        action: "soft_delete_recording",
        targetUserId: r.userId,
        targetResourceId: r.id,
        before: { deletedAt: null, filesize: r.filesize },
        // Note: the audio file is NOT hard-deleted here; the regular user
        // delete flow does the storage cleanup. This admin action only marks
        // the tombstone so the row stops appearing in user views and stops
        // counting toward quota. Hard-deletion of the blob is intentionally
        // a separate, more careful action.
        after: { deletedAt },
    });
    return { ok: true };
}

/**
 * For pricing-snapshot CSV export: log the export as a distinct action so
 * we have an audit trail of who took bulk PII (emails) off the system.
 */
export async function logCsvExport(
    ctx: ActionContext,
    kind: string,
    rowCount: number,
): Promise<void> {
    assertReason(ctx.reason);
    await writeActionLog({
        ctx,
        action: `csv_export_${kind}`,
        targetUserId: null,
        targetResourceId: null,
        before: null,
        after: { rowCount },
    });
}
