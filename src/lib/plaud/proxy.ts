/**
 * Outbound proxy selection for Plaud API calls.
 *
 * Why this exists: Plaud's API is fronted by Cloudflare with aggressive
 * bot/datacenter-ASN filtering. Calls originating from common VPS provider
 * IPs (Contabo, OVH, Hetzner, …) get a 403 + Cloudflare HTML challenge at
 * the edge regardless of token, headers, or region. We confirmed this with
 * `scripts/plaud-egress-probe.sh` from a flagged VPS IP: every Plaud
 * endpoint, every region, every header combination returned 403 with
 * `server: cloudflare` and a `<title>Attention Required!</title>` body.
 * From a residential IP (or via a residential proxy) the same requests
 * return 200.
 *
 * Strategy: bring-your-own residential proxy via Webshare. When
 * `WEBSHARE_API_KEY` is set, this module lists Webshare's available
 * proxies (cached 5 min), rotates randomly per call, and blacklists any
 * that get rejected by Plaud. When the env var is unset (default — the
 * self-host path) every call routes direct.
 *
 * Self-host degradation: residential / homelab IPs aren't on Cloudflare's
 * datacenter-ASN bucket, so the direct path keeps working for the
 * overwhelming majority of self-hosters. Only operators on flagged VPS
 * IPs need to set this.
 *
 * Pattern mirrors apps/split-service in the betterbahn project; kept
 * scoped to Plaud in this codebase so future generic-proxy use stays
 * opt-in per service.
 */

import { env } from "@/lib/env";

interface WebshareProxy {
    id: string;
    username: string;
    password: string;
    proxy_address: string;
    port: number;
    valid: boolean;
}

interface ProxyCache {
    proxies: WebshareProxy[];
    expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60_000;
const WEBSHARE_LIST_URL =
    "https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page=1&page_size=100";

let cachedList: ProxyCache | null = null;
let badProxyIds = new Set<string>();

async function fetchProxyList(): Promise<WebshareProxy[]> {
    const apiKey = env.WEBSHARE_API_KEY;
    if (!apiKey) return [];

    try {
        const res = await fetch(WEBSHARE_LIST_URL, {
            headers: { Authorization: `Token ${apiKey}` },
        });
        if (!res.ok) {
            console.warn(
                `[plaud/proxy] Webshare list error: ${res.status} ${res.statusText}`,
            );
            return [];
        }
        const data = (await res.json()) as { results?: WebshareProxy[] };
        const proxies = (data.results ?? []).filter((p) => p.valid);
        cachedList = { proxies, expiresAt: Date.now() + CACHE_TTL_MS };
        badProxyIds = new Set();
        return proxies;
    } catch (err) {
        console.warn(
            "[plaud/proxy] Webshare list fetch failed:",
            err instanceof Error ? err.message : err,
        );
        return [];
    }
}

/**
 * Should an outbound call to `url` be routed through the Plaud proxy?
 *
 * Matches Plaud API hosts (api.plaud.ai, api-*.plaud.ai) and the signed-URL
 * CDN (resource.plaud.ai). All Plaud-owned hostnames sit behind the same
 * Cloudflare zone, so any of them can trigger the datacenter-ASN block.
 *
 * Returns false for unknown / malformed URLs so we never accidentally route
 * non-Plaud traffic through a third-party proxy.
 */
export function shouldProxyPlaud(url: string): boolean {
    try {
        const u = new URL(url);
        if (u.protocol !== "https:") return false;
        const h = u.hostname.toLowerCase();
        return h === "plaud.ai" || h.endsWith(".plaud.ai");
    } catch {
        return false;
    }
}

export interface SelectedProxy {
    /** Webshare proxy id — the stable handle used for blacklisting. */
    id: string;
    /** http://user:pass@host:port form. Contains credentials — do not log. */
    url: string;
    /** host:port — safe to log. */
    label: string;
}

/**
 * Pick a proxy from the cached Webshare list, lazily refreshing on expiry
 * or when all proxies have been blacklisted. Returns null if Webshare is
 * not configured or returned an empty list — callers fall back to direct.
 */
export async function getPlaudProxyUrl(): Promise<SelectedProxy | null> {
    if (!env.WEBSHARE_API_KEY) return null;

    let proxies: WebshareProxy[];
    let justRefreshed = false;
    if (cachedList && cachedList.expiresAt > Date.now()) {
        proxies = cachedList.proxies;
    } else {
        proxies = await fetchProxyList();
        justRefreshed = true;
    }

    let available = proxies.filter((p) => !badProxyIds.has(p.id));
    if (available.length === 0 && !justRefreshed) {
        // All blacklisted — force one refresh and reset the blacklist.
        // Skip the refresh if we already fetched a fresh (but empty) list
        // this call, so a Webshare outage doesn't burn two list requests
        // per Plaud call.
        proxies = await fetchProxyList();
        available = proxies;
    }
    if (available.length === 0) {
        console.warn("[plaud/proxy] no valid Webshare proxies available");
        return null;
    }

    const proxy = available[Math.floor(Math.random() * available.length)];
    const url = `http://${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@${proxy.proxy_address}:${proxy.port}`;
    const label = `${proxy.proxy_address}:${proxy.port}`;
    return { id: proxy.id, url, label };
}

/**
 * Mark a specific proxy as bad. Called by `plaudFetch` when Plaud returns
 * 403 (Cloudflare challenge — proxy IP is also flagged) or 407 (proxy auth
 * rejected). The proxy stays blacklisted until the next list refresh.
 *
 * Takes the proxy explicitly (rather than reading a module-global
 * "last served") so concurrent `plaudFetch` calls can't blacklist each
 * other's proxy by race: each caller threads its own `SelectedProxy`
 * through and invalidates exactly the one it just used.
 */
export function invalidatePlaudProxy(proxy: SelectedProxy): void {
    badProxyIds.add(proxy.id);
}

/**
 * Whether a Webshare API key is configured. Surfaced by the dev-info
 * endpoint so we can tell at a glance whether prod is using the proxy.
 */
export function isPlaudProxyConfigured(): boolean {
    return Boolean(env.WEBSHARE_API_KEY);
}

/**
 * Test-only: reset module state between unit tests.
 */
export function _resetPlaudProxyCacheForTest(): void {
    cachedList = null;
    badProxyIds = new Set();
}
