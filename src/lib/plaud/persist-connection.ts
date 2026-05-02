/**
 * Shared persistence path for "we just obtained a Plaud user token, now turn
 * it into a stored connection".
 *
 * Two routes call this:
 *   - /api/plaud/auth/verify         (OTP flow → access_token)
 *   - /api/plaud/auth/connect-token  (paste-token flow → access_token)
 *
 * Both go through the same gauntlet:
 *   1. Discover the personal workspace ID via /team-app/workspaces/list
 *      (best-effort; warn-and-continue if the endpoint isn't reachable).
 *   2. Validate the token end-to-end by calling /device/list. If that fails
 *      we throw — there is no point persisting a token Plaud rejects.
 *   3. AES-256-GCM-encrypt the token and upsert plaud_connections, scoped
 *      to userId on both the SELECT and UPDATE.
 *   4. Upsert plaud_devices for each device returned by /device/list,
 *      scoped by (userId, serialNumber) so we never touch another user's
 *      row (the schema enforces uniqueness on that pair).
 *
 * Errors prefixed with "Plaud API error:" are user-actionable and should be
 * mapped to 400 by callers; everything else is a 500.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { plaudConnections, plaudDevices } from "@/db/schema";
import { encrypt } from "@/lib/encryption";
import type { PlaudDeviceListResponse } from "@/types/plaud";
import { PlaudClient } from "./client";
import { listPlaudWorkspaces, pickPersonalWorkspaceId } from "./workspace";

export interface PersistPlaudConnectionInput {
    userId: string;
    accessToken: string;
    apiBase: string;
    /** Lowercased Plaud account email, or null if unknown. */
    plaudEmail: string | null;
}

export interface PersistPlaudConnectionResult {
    devices: PlaudDeviceListResponse["data_devices"];
    workspaceId: string | null;
}

/**
 * Validate a Plaud user token end-to-end and persist it as the user's
 * connection. Idempotent: re-running with a fresh token replaces the stored
 * one and reconciles devices.
 *
 * Throws on validation failure — callers must NOT have written anything
 * before invoking this.
 */
export async function persistPlaudConnection({
    userId,
    accessToken,
    apiBase,
    plaudEmail,
}: PersistPlaudConnectionInput): Promise<PersistPlaudConnectionResult> {
    // 1. Workspace discovery (best-effort — preserves behaviour for any
    // server / legacy account where /team-app/workspaces/list isn't
    // available; the client will fall back to using the UT directly).
    let resolvedWorkspaceId: string | null = null;
    try {
        const list = await listPlaudWorkspaces(accessToken, apiBase);
        resolvedWorkspaceId = pickPersonalWorkspaceId(list);
    } catch (err) {
        console.warn(
            "[plaud/persist] workspace discovery failed:",
            err instanceof Error ? err.message : err,
        );
    }

    // 2. End-to-end validation — Plaud must accept this token on a real
    // recording-scoped endpoint, otherwise the connection is useless and
    // we'd silently store a dead token. /device/list also gives us the
    // device rows we need to upsert below in a single round-trip.
    const client = new PlaudClient(accessToken, apiBase, resolvedWorkspaceId);
    let deviceList: PlaudDeviceListResponse;
    try {
        deviceList = await client.listDevices();
    } catch (err) {
        console.warn(
            "[plaud/persist] device list validation failed:",
            err instanceof Error ? err.message : err,
        );
        throw new Error(
            "Plaud API error: token validation failed (Plaud rejected the token on /device/list)",
        );
    }

    // 3. Encrypt + upsert connection. Always re-scope by userId on the
    // UPDATE/SELECT so we never touch another user's row (defense-in-depth
    // alongside the userId-scoped lookup).
    const encryptedAccessToken = encrypt(accessToken);

    const [existingConnection] = await db
        .select()
        .from(plaudConnections)
        .where(eq(plaudConnections.userId, userId))
        .limit(1);

    if (existingConnection) {
        await db
            .update(plaudConnections)
            .set({
                bearerToken: encryptedAccessToken,
                apiBase,
                plaudEmail,
                workspaceId: resolvedWorkspaceId,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(plaudConnections.id, existingConnection.id),
                    eq(plaudConnections.userId, userId),
                ),
            );
    } else {
        await db.insert(plaudConnections).values({
            userId,
            bearerToken: encryptedAccessToken,
            apiBase,
            plaudEmail,
            workspaceId: resolvedWorkspaceId,
        });
    }

    // 4. Reconcile devices. Schema has a unique constraint on
    // (userId, serialNumber) so we look up by that pair.
    for (const device of deviceList.data_devices) {
        const [existingDevice] = await db
            .select()
            .from(plaudDevices)
            .where(
                and(
                    eq(plaudDevices.userId, userId),
                    eq(plaudDevices.serialNumber, device.sn),
                ),
            )
            .limit(1);

        if (existingDevice) {
            await db
                .update(plaudDevices)
                .set({
                    name: device.name,
                    model: device.model,
                    versionNumber: device.version_number,
                    updatedAt: new Date(),
                })
                .where(eq(plaudDevices.id, existingDevice.id));
        } else {
            await db.insert(plaudDevices).values({
                userId,
                serialNumber: device.sn,
                name: device.name,
                model: device.model,
                versionNumber: device.version_number,
            });
        }
    }

    return {
        devices: deviceList.data_devices,
        workspaceId: resolvedWorkspaceId,
    };
}
