/**
 * `plaudFetch` — thin wrapper around `fetch()` that routes Plaud-bound
 * requests through a residential proxy when one is configured.
 *
 * Why two layers of mitigation, not one: Plaud sits behind Cloudflare's
 * Bot Management, which scores TWO signals independently:
 *
 *   1. Source IP / ASN. Datacenter ASNs (Contabo, OVH, Hetzner, …) are
 *      bucketed and blocked at the edge. Mitigated by routing through a
 *      Webshare residential proxy — see `./proxy.ts`.
 *   2. TLS / HTTP fingerprint (JA3, JA4, HTTP/2 SETTINGS, header order).
 *      OpenPlaud runs on Bun in production (`Dockerfile` uses `oven/bun:1`),
 *      and Bun's TLS handshake produces a fingerprint Cloudflare flags as
 *      "lying client" when paired with a Chrome User-Agent — even from a
 *      clean residential IP. Mitigated by `wreq-js`, a Rust-backed HTTP
 *      client that emits a byte-identical Chrome `ClientHello` and HTTP/2
 *      SETTINGS frame.
 *
 * The two mitigations compose: app → wreq-js (Chrome JA3) → Webshare
 * (residential ASN) → Plaud. Both are required on flagged-VPS deploys.
 *
 * Behaviour summary:
 *   1. Decides per-URL whether to proxy (`shouldProxyPlaud`).
 *   2. Picks a proxy from the Webshare list (`getPlaudProxyUrl`).
 *   3. Sends the request via `wreq-js` with a Chrome browser profile and
 *      the proxy URL.
 *   4. On 403 / 407 while proxied, invalidates the proxy and retries once
 *      with a fresh one. On the second 403 we give up — that's almost
 *      certainly an upstream Plaud-side rejection (bad token, missing
 *      workspace), not a proxy-IP problem.
 *
 * SSRF posture is unchanged: every caller still passes URLs through
 * `safePlaudUrl` / `isValidPlaudApiUrl` first, so wreq-js never sees an
 * off-domain target. The proxy URL itself is server-controlled (env var
 * → Webshare API) and is never user-influenced.
 *
 * Non-Plaud URLs fall straight through to the global `fetch`. We do NOT
 * proxy or fingerprint-spoof other outbound calls (S3, AI providers,
 * SMTP) — they aren't blocked and the cost would be wasteful.
 */

import {
    fetch as impersonateFetch,
    type BodyInit as WreqBodyInit,
} from "wreq-js";
import {
    getPlaudProxyUrl,
    invalidatePlaudProxy,
    type SelectedProxy,
    shouldProxyPlaud,
} from "./proxy";

const MAX_PROXY_ROTATIONS = 1;

/**
 * Browser profile we present to Cloudflare. Chrome 142 on Windows is one
 * of the most common live browser fingerprints; using a popular profile
 * keeps us in the high-traffic JA4 buckets that Cloudflare's bot-score
 * heuristics treat as normal browser noise. Profile name is from
 * `wreq-js`'s `BrowserProfile` enum.
 */
const IMPERSONATE_BROWSER = "chrome_142" as const;
const IMPERSONATE_OS = "windows" as const;

/**
 * Drop-in replacement for `fetch()` for any URL that may be a Plaud host.
 * Same call signature; same return type. Callers handle status codes and
 * body parsing exactly as before.
 */
export async function plaudFetch(
    url: string,
    init?: RequestInit,
): Promise<Response> {
    if (!shouldProxyPlaud(url)) {
        return fetch(url, init);
    }

    let attempt = 0;
    let currentProxy: SelectedProxy | null = null;
    // First-try proxy selection. null result → Webshare unconfigured or
    // exhausted; fall through to direct fetch. That keeps self-host
    // deployments (which leave WEBSHARE_API_KEY unset) on the direct path
    // with no behavior change.
    currentProxy = await getPlaudProxyUrl();
    if (!currentProxy) {
        return fetch(url, init);
    }

    while (true) {
        let response: Response;
        try {
            // wreq-js's fetch is web-Response-compatible; cast to the
            // global `Response` so the public signature is unchanged for
            // callers (which only use `.status`, `.headers.get`,
            // `.json()`, `.text()`, `.body`, `.arrayBuffer()`).
            response = (await impersonateFetch(url, {
                method: init?.method,
                headers: init?.headers as Record<string, string> | undefined,
                // wreq-js's `BodyInit` is narrower than the DOM's (no
                // ReadableStream). Plaud calls only ever send
                // JSON-string bodies (or no body at all), so the cast
                // is safe in practice; if a caller ever passes a
                // streamed body it'll surface here at the type level.
                body: init?.body as WreqBodyInit | null | undefined,
                signal: init?.signal ?? undefined,
                proxy: currentProxy.url,
                browser: IMPERSONATE_BROWSER,
                os: IMPERSONATE_OS,
            })) as unknown as Response;
        } catch (err) {
            // Network error through the proxy (timeout, connection reset).
            // Treat like a 403: invalidate + rotate once.
            if (attempt < MAX_PROXY_ROTATIONS) {
                logProxyEvent(
                    "network-error",
                    url,
                    currentProxy.label,
                    err instanceof Error ? err.message : String(err),
                );
                invalidatePlaudProxy(currentProxy);
                const next = await getPlaudProxyUrl();
                if (!next) {
                    // No more proxies — last-resort direct attempt so a
                    // total Webshare outage doesn't take sync down on
                    // operators whose VPS IP is actually fine.
                    return fetch(url, init);
                }
                currentProxy = next;
                attempt += 1;
                continue;
            }
            throw err;
        }

        if (
            (response.status === 403 || response.status === 407) &&
            attempt < MAX_PROXY_ROTATIONS
        ) {
            // 403 while proxied: most likely the proxy IP itself is on
            // Cloudflare's bot list. 407: proxy refused auth. Either
            // way, blacklist + rotate.
            logProxyEvent(
                `http-${response.status}`,
                url,
                currentProxy.label,
                response.statusText,
            );
            invalidatePlaudProxy(currentProxy);

            // Resolve the next proxy BEFORE touching the body. If we
            // cancel the body and then discover there's no next proxy,
            // we'd return a `Response` whose body has already been
            // consumed, and the caller (which expects to read JSON)
            // would blow up on a parse step that worked fine pre-rotate.
            const next = await getPlaudProxyUrl();
            if (!next) return response;

            // Now safe to drain the body so the connection can be
            // reused for the retry; ignore errors — we don't care
            // about the contents at this point.
            await response.body?.cancel().catch(() => undefined);
            currentProxy = next;
            attempt += 1;
            continue;
        }

        return response;
    }
}

function logProxyEvent(
    kind: string,
    url: string,
    proxyLabel: string,
    detail: string,
): void {
    let host: string;
    try {
        host = new URL(url).host;
    } catch {
        host = "<invalid-url>";
    }
    console.warn(
        `[plaud/proxy] ${kind} via=${proxyLabel} host=${host} detail=${detail}`,
    );
}

/**
 * Test-only: previously reset the undici dispatcher cache. wreq-js
 * manages its own internal connection state per request — there is no
 * module-level cache to reset on this side anymore. Kept as a no-op so
 * existing test imports don't break; the proxy.ts cache is reset
 * independently via `_resetPlaudProxyCacheForTest`.
 */
export function _resetPlaudFetchForTest(): void {
    // intentionally empty
}
