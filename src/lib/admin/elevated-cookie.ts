import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Signed elevated-session cookie for the admin dashboard.
 *
 * The cookie is set after successful password reprompt (`POST /api/admin/reauth`)
 * and required for any admin route. It carries:
 *   - userId          who was reauthenticated
 *   - issuedAt        unix-ms timestamp of reauth
 *   - mac             HMAC-SHA256 over `${userId}.${issuedAt}` keyed off
 *                     BETTER_AUTH_SECRET
 *
 * The HMAC binds the cookie to this server's secret. A leaked DB row alone
 * cannot forge it (BETTER_AUTH_SECRET is not in the DB); a leaked cookie
 * still expires by `issuedAt + ttl`.
 *
 * Two TTLs are checked at gate time:
 *   - reauth TTL  (env.ADMIN_REAUTH_TTL_MINUTES, default 30)
 *     gates read access; older cookies bounce to /admin/reauth.
 *   - mutation TTL (env.ADMIN_MUTATION_TTL_MINUTES, default 10)
 *     additionally required for any /api/admin/actions/* mutation.
 */

export const ADMIN_ELEVATED_COOKIE = "openplaud_admin_elev";

interface ElevatedPayload {
    userId: string;
    issuedAt: number;
}

function secret(): string {
    // env validation guarantees BETTER_AUTH_SECRET is present at runtime.
    const s = env.BETTER_AUTH_SECRET;
    if (!s)
        throw new Error(
            "BETTER_AUTH_SECRET missing -- cannot sign admin cookie",
        );
    return s;
}

function macFor(userId: string, issuedAt: number): string {
    return createHmac("sha256", secret())
        .update(`${userId}.${issuedAt}`)
        .digest("hex");
}

export function signElevatedCookie(userId: string, now = Date.now()): string {
    const mac = macFor(userId, now);
    return `${userId}.${now}.${mac}`;
}

/**
 * Verify the cookie's structure + HMAC. Returns the payload on success or
 * null on any failure (malformed, bad MAC, wrong shape). Expiry is checked
 * separately by the gate so it can distinguish "expired -> reauth" from
 * "tampered -> 404".
 */
export function verifyElevatedCookie(
    raw: string | undefined | null,
): ElevatedPayload | null {
    if (!raw) return null;
    const parts = raw.split(".");
    if (parts.length !== 3) return null;
    const [userId, issuedAtStr, providedMac] = parts;
    const issuedAt = Number(issuedAtStr);
    if (!userId || !Number.isFinite(issuedAt)) return null;

    const expectedMac = macFor(userId, issuedAt);
    const a = Buffer.from(expectedMac, "hex");
    const b = Buffer.from(providedMac, "hex");
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;

    return { userId, issuedAt };
}

export function isWithinReauthTtl(
    payload: ElevatedPayload,
    now = Date.now(),
): boolean {
    const ttlMs = env.ADMIN_REAUTH_TTL_MINUTES * 60 * 1000;
    return now - payload.issuedAt <= ttlMs;
}

export function isWithinMutationTtl(
    payload: ElevatedPayload,
    now = Date.now(),
): boolean {
    const ttlMs = env.ADMIN_MUTATION_TTL_MINUTES * 60 * 1000;
    return now - payload.issuedAt <= ttlMs;
}
