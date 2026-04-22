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
            throw new Error("Too many region redirects from Plaud API");
        }
        const regionalBase = body.data.domains.api.replace(/\/+$/, "");
        return plaudSendCode(email, regionalBase, _redirectCount + 1);
    }

    if (body.status !== 0 || !body.token) {
        throw new Error(body.msg || "Failed to send verification code");
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
        throw new Error(body.msg || "Invalid verification code");
    }

    return { accessToken };
}
