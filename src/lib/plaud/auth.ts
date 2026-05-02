/**
 * Plaud authentication via OTP (email verification code).
 *
 * Flow:
 * 1. POST /auth/otp-send-code { username } → { status, token }
 *    - If status === -302: user's region differs; response includes
 *      data.domains.api with the correct regional API base.
 * 2. POST /auth/otp-login { code, token } → { access_token }
 *
 * Plaud issues long-lived access tokens (~300 day lifetime per decoded JWT
 * claims) and does NOT return a refresh token in the web OTP flow. When the
 * token eventually expires, users re-authenticate via the reconnect UI.
 */

import { DEFAULT_PLAUD_API_BASE } from "./client";

// ── Types ──────────────────────────────────────────────────────────────────

export interface PlaudSendCodeResponse {
    status: number;
    msg: string;
    /** Short-lived JWT to pass back in otp-login */
    token?: string;
    /** Present when status === -302 (region mismatch) */
    data?: {
        domains?: {
            api?: string;
        };
    };
}

export interface PlaudOtpLoginResponse {
    status: number;
    msg: string;
    /** Tokens can appear at root (observed) or under data (older/region variants) */
    access_token?: string;
    data?: {
        access_token?: string;
    };
}

// ── API calls ──────────────────────────────────────────────────────────────

/**
 * Send a one-time verification code to the user's email.
 *
 * Returns the OTP session token on success.
 * If the user belongs to a different region, returns the correct API base
 * so the caller can retry against the right server.
 */
const MAX_REGION_REDIRECTS = 3;

export async function plaudSendCode(
    email: string,
    apiBase: string = DEFAULT_PLAUD_API_BASE,
    _redirectCount = 0,
): Promise<{
    token: string;
    /** Final resolved API base (may differ from input after region redirect) */
    apiBase: string;
}> {
    const res = await fetch(`${apiBase}/auth/otp-send-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: email }),
    });

    const body = (await res.json()) as PlaudSendCodeResponse;

    // Region mismatch → retry against the correct regional server
    if (body.status === -302 && body.data?.domains?.api) {
        if (_redirectCount >= MAX_REGION_REDIRECTS) {
            throw new Error("Plaud API error: too many region redirects");
        }
        const regionalBase = body.data.domains.api.replace(/\/+$/, "");
        return plaudSendCode(email, regionalBase, _redirectCount + 1);
    }

    if (body.status !== 0 || !body.token) {
        throw new Error(
            `Plaud API error: ${body.msg || "failed to send verification code"}`,
        );
    }

    return { token: body.token, apiBase };
}

/**
 * Verify the OTP code and obtain the access token.
 */
export async function plaudVerifyOtp(
    code: string,
    otpToken: string,
    apiBase: string = DEFAULT_PLAUD_API_BASE,
): Promise<{
    accessToken: string;
}> {
    const res = await fetch(`${apiBase}/auth/otp-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, token: otpToken }),
    });

    const body = (await res.json()) as PlaudOtpLoginResponse;

    // Tokens can appear at root or nested under data
    const accessToken =
        body.access_token ?? body.data?.access_token ?? undefined;

    if (!accessToken) {
        throw new Error(
            `Plaud API error: ${body.msg || "invalid verification code"}`,
        );
    }

    return { accessToken };
}

// ── Error classification ─────────────────────────────────────────────────

/**
 * Decide whether a Plaud-related error message is the user's responsibility
 * (return verbatim with HTTP 400) or our / Plaud's responsibility (surface
 * as 500 so the user retries instead of being told to fix their token).
 *
 * Two shapes we throw:
 *
 *   - `Plaud API error (NNN): ...` — HTTP-level failure from
 *     PlaudClient.request or the workspace helpers. Status carries the
 *     verdict: 4xx is the user (bad token / forbidden / etc.), 5xx is
 *     Plaud (or our infra) — don't tell users to "fix their token" when
 *     Plaud is the broken party.
 *
 *   - `Plaud API error: ...` (no parenthesised status) — business-level
 *     failure where Plaud returned HTTP 200 with a `status: -N` body, or
 *     a workspace helper rejected on its own. These are user-actionable
 *     by definition ("invalid verification code", "failed to send code",
 *     "no workspaces returned", ...). Pre-narrowing this would silently
 *     break the OTP error UX.
 *
 *   - The literal `Invalid API base` from our SSRF guard.
 */
export function isUserActionablePlaudError(message: string): boolean {
    if (message === "Invalid API base") return true;
    if (!message.startsWith("Plaud API error")) return false;
    const m = /^Plaud API error \((\d{3})\):/.exec(message);
    if (m) {
        const status = Number.parseInt(m[1], 10);
        return status >= 400 && status < 500;
    }
    // Bare `Plaud API error: ...` — business-level failure, user-actionable.
    return true;
}

// ── JWT helpers (UX-only; not security boundaries) ────────────────────────

/**
 * Decode a Plaud access token's `exp` claim without verifying the signature.
 *
 * Plaud's user tokens are JWTs with a ~300-day lifetime. We only decode here
 * to give the paste-token UI a friendly hint ("this token expires in 3 days")
 * — actual validation always happens by hitting Plaud's /device/list. Never
 * trust the decoded payload for any security decision.
 *
 * Returns `null` on any malformed input rather than throwing — callers treat
 * a null result as "unknown expiry, let Plaud decide".
 */
export function decodeAccessTokenExpiry(token: string): Date | null {
    if (typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    try {
        // base64url → base64 → utf-8 JSON
        const b64 =
            parts[1].replace(/-/g, "+").replace(/_/g, "/") +
            "=".repeat((4 - (parts[1].length % 4)) % 4);
        const json =
            typeof atob === "function"
                ? atob(b64)
                : Buffer.from(b64, "base64").toString("utf8");
        const payload = JSON.parse(json) as { exp?: unknown };
        if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
            return null;
        }
        return new Date(payload.exp * 1000);
    } catch {
        return null;
    }
}

/**
 * Best-effort fetch of /user/me to derive the linked Plaud account email.
 *
 * Used only by the paste-token connect flow, which doesn't otherwise know
 * the user's Plaud email. Returns `null` on any failure — the email is a
 * UX nicety (it shows up in settings as "Connected as foo@bar.com"), not
 * a correctness requirement, and plaud_connections.plaud_email is nullable.
 *
 * Same SSRF posture as the rest of this module: caller must have already
 * passed `apiBase` through `isValidPlaudApiUrl`.
 */
export async function fetchPlaudUserMeEmail(
    accessToken: string,
    apiBase: string,
): Promise<string | null> {
    try {
        const res = await fetch(`${apiBase}/user/me`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
        });
        if (!res.ok) return null;
        const body = (await res.json()) as {
            status?: number;
            data?: { email?: unknown };
            email?: unknown;
        };
        // Tolerate both root-level and data-nested shapes (Plaud's response
        // shape varies across endpoints/regions).
        const raw =
            (typeof body.email === "string" && body.email) ||
            (typeof body.data?.email === "string" && body.data.email) ||
            null;
        if (!raw) return null;
        return raw.trim().toLowerCase() || null;
    } catch {
        return null;
    }
}
