/**
 * `plaudFetch` — thin wrapper around `fetch()` that routes Plaud-bound
 * requests through a residential proxy when one is configured.
 *
 * See `./proxy.ts` for the why: Plaud's Cloudflare zone blocks datacenter
 * ASNs with a 403 + HTML challenge at the edge. This wrapper:
 *
 *   1. Decides per-URL whether to proxy (`shouldProxyPlaud`).
 *   2. Picks a proxy from the Webshare list (`getPlaudProxyUrl`).
 *   3. Sends the request via an `undici.ProxyAgent` dispatcher.
 *   4. On 403 / 407 while proxied, invalidates the proxy and retries once
 *      with a fresh one. On the second 403 we give up — that's almost
 *      certainly an upstream Plaud-side rejection (bad token, missing
 *      workspace), not a proxy-IP problem.
 *
 * SSRF posture is unchanged: every caller still passes URLs through
 * `safePlaudUrl` / `isValidPlaudApiUrl` first, so the proxy never sees an
 * off-domain target. The proxy URL itself is server-controlled (env var
 * → Webshare API) and is never user-influenced.
 *
 * Non-Plaud URLs fall straight through to the global `fetch`. We do NOT
 * proxy other outbound calls (S3, AI providers, SMTP) — they aren't
 * blocked and adding latency / cost would be wasteful.
 */

import { ProxyAgent } from "undici";
import {
    getPlaudProxyUrl,
    invalidatePlaudProxy,
    type SelectedProxy,
    shouldProxyPlaud,
} from "./proxy";

const MAX_PROXY_ROTATIONS = 1;

/**
 * Memoised dispatcher per proxy URL. ProxyAgent maintains an internal
 * connection pool — recreating it per request would defeat keep-alive.
 *
 * Bounded by the size of the Webshare list (typically <100 entries) and by
 * the blacklist eviction in proxy.ts; we don't otherwise prune.
 */
const dispatcherCache = new Map<string, ProxyAgent>();

function getDispatcher(proxyUrl: string): ProxyAgent {
    let agent = dispatcherCache.get(proxyUrl);
    if (!agent) {
        agent = new ProxyAgent(proxyUrl);
        dispatcherCache.set(proxyUrl, agent);
    }
    return agent;
}

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
        // `dispatcher` is undici-specific; Node's global fetch is backed by
        // undici so the property is honoured at runtime. TS doesn't know
        // this without lib augmentation, so we cast at the boundary.
        const dispatcher = getDispatcher(currentProxy.url);
        const initWithDispatcher = {
            ...init,
            dispatcher,
        } as RequestInit & { dispatcher: ProxyAgent };

        let response: Response;
        try {
            response = await fetch(url, initWithDispatcher);
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
 * Test-only: reset the dispatcher cache. The proxy.ts cache is reset
 * independently via `_resetPlaudProxyCacheForTest`.
 */
export function _resetPlaudFetchForTest(): void {
    for (const agent of dispatcherCache.values()) {
        agent.close().catch(() => undefined);
    }
    dispatcherCache.clear();
}
