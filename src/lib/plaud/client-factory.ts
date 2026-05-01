import { decrypt } from "@/lib/encryption";
import { DEFAULT_PLAUD_API_BASE, PlaudClient } from "./client";

/**
 * Create Plaud client from an encrypted bearer token stored in the DB.
 *
 * Pass the (possibly null) cached `workspaceId` from
 * `plaud_connections.workspace_id` so the client can skip the
 * /team-app/workspaces/list lookup on cache hits. After using the client,
 * callers should compare `client.workspaceId` against what they passed in
 * and persist back any difference.
 *
 * Lives in its own module so importing the PlaudClient class (e.g. from
 * unit tests) doesn't transitively load encryption/env validation.
 */
export async function createPlaudClient(
    encryptedToken: string,
    apiBase: string = DEFAULT_PLAUD_API_BASE,
    workspaceId?: string | null,
): Promise<PlaudClient> {
    const bearerToken = decrypt(encryptedToken);
    return new PlaudClient(bearerToken, apiBase, workspaceId ?? undefined);
}
