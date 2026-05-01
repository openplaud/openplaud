/**
 * Plaud workspace token (WT) flow.
 *
 * Plaud issues two distinct JWTs:
 *  - **UT** (User Token, typ="UT"): returned by POST /auth/otp-login, lifetime
 *    ~300 days. Authenticates user-scoped endpoints (/user/me,
 *    /team-app/workspaces/list, the workspace-token mint endpoint itself).
 *  - **WT** (Workspace Token, typ="WT"): minted from a UT, lifetime 24h.
 *    Required by recording endpoints (/file/simple/web, /device/list,
 *    /file/temp-url/*, /filetag/, ...). On regional servers (EU, APAC) a UT
 *    sent to /file/simple/web returns a 200 with an empty list — the request
 *    silently fails open, which is the bug behind issue #66.
 *
 * We never persist the WT or its refresh_token; we mint a fresh WT from the
 * stored UT on every PlaudClient instance. The WT lasts 24h, far longer than
 * any sync run, so no in-flight refresh logic is needed.
 *
 * The workspaceId itself IS persisted in plaud_connections.workspace_id so we
 * can skip the /team-app/workspaces/list lookup on subsequent syncs.
 */

import type {
    PlaudWorkspaceListResponse,
    PlaudWorkspaceTokenResponse,
} from "@/types/plaud";

/**
 * List all workspaces accessible to the user. Personal accounts always have
 * exactly one workspace with workspace_type="0" ("Personal"). Team accounts
 * may have additional workspaces; we always pick the personal one.
 *
 * Auth: requires a valid UT.
 */
export async function listPlaudWorkspaces(
    userToken: string,
    apiBase: string,
): Promise<PlaudWorkspaceListResponse> {
    const res = await fetch(
        `${apiBase}/team-app/workspaces/list?need_personal_workspace=true`,
        {
            method: "GET",
            headers: {
                Authorization: `Bearer ${userToken}`,
                "Content-Type": "application/json",
            },
        },
    );

    if (!res.ok) {
        throw new Error(
            `Plaud API error (${res.status}): failed to list workspaces`,
        );
    }

    const body = (await res.json()) as PlaudWorkspaceListResponse;
    if (body.status !== 0 || !body.data?.workspaces) {
        throw new Error(
            `Plaud API error: ${body.msg || "failed to list workspaces"}`,
        );
    }
    return body;
}

/**
 * Pick the personal workspace (workspace_type === "0") from a workspace list.
 * Falls back to the first workspace if no personal one is found, since some
 * accounts (e.g. team-only members) may not have one. Throws if the list is
 * empty.
 */
export function pickPersonalWorkspaceId(
    response: PlaudWorkspaceListResponse,
): string {
    const workspaces = response.data?.workspaces ?? [];
    if (workspaces.length === 0) {
        throw new Error("Plaud API error: no workspaces returned");
    }
    const personal = workspaces.find((w) => w.workspace_type === "0");
    return (personal ?? workspaces[0]).workspace_id;
}

/**
 * Mint a fresh workspace token (WT) for a given workspace.
 *
 * Auth: requires a valid UT. Body is `{}` — the workspace is identified by
 * the URL path.
 */
export async function mintPlaudWorkspaceToken(
    userToken: string,
    workspaceId: string,
    apiBase: string,
): Promise<string> {
    const res = await fetch(
        `${apiBase}/user-app/auth/workspace/token/${encodeURIComponent(workspaceId)}`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${userToken}`,
                "Content-Type": "application/json",
            },
            body: "{}",
        },
    );

    if (!res.ok) {
        const status = res.status;
        throw new WorkspaceTokenError(
            `Plaud API error (${status}): failed to mint workspace token`,
            status,
        );
    }

    const body = (await res.json()) as PlaudWorkspaceTokenResponse;
    if (body.status !== 0 || !body.data?.workspace_token) {
        throw new WorkspaceTokenError(
            `Plaud API error: ${body.msg || "failed to mint workspace token"}`,
        );
    }
    return body.data.workspace_token;
}

/**
 * Thrown when the workspace-token mint fails. Carries the HTTP status when
 * available so callers can decide whether the cached workspaceId is stale
 * (4xx → invalidate and relist) vs. a transient server issue (5xx → bubble).
 */
export class WorkspaceTokenError extends Error {
    constructor(
        message: string,
        public readonly httpStatus?: number,
    ) {
        super(message);
        this.name = "WorkspaceTokenError";
    }
}

/**
 * Resolve a usable WT given a UT. If a cached workspaceId is provided we try
 * it first; on 4xx we invalidate and re-discover via /team-app/workspaces/list.
 *
 * Returns both the minted WT and the workspaceId that was actually used, so
 * callers can persist the (possibly newly-discovered) workspaceId.
 */
export async function resolveWorkspaceToken(
    userToken: string,
    apiBase: string,
    cachedWorkspaceId: string | null | undefined,
): Promise<{ workspaceToken: string; workspaceId: string }> {
    if (cachedWorkspaceId) {
        try {
            const workspaceToken = await mintPlaudWorkspaceToken(
                userToken,
                cachedWorkspaceId,
                apiBase,
            );
            return { workspaceToken, workspaceId: cachedWorkspaceId };
        } catch (err) {
            // Stale cache (workspace deleted/moved) → fall through to relist.
            // Anything else (5xx, network) → propagate.
            const status =
                err instanceof WorkspaceTokenError ? err.httpStatus : undefined;
            const isStale =
                typeof status === "number" && status >= 400 && status < 500;
            if (!isStale) throw err;
        }
    }

    const list = await listPlaudWorkspaces(userToken, apiBase);
    const workspaceId = pickPersonalWorkspaceId(list);
    const workspaceToken = await mintPlaudWorkspaceToken(
        userToken,
        workspaceId,
        apiBase,
    );
    return { workspaceToken, workspaceId };
}
