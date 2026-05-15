import { NextResponse } from "next/server";
import { env } from "@/lib/env";

// Shared runtime proxy for Rybbit's same-origin endpoints.
//
// Why route handlers and not `next.config.ts` rewrites: rewrites are
// baked into `routes-manifest.json` at `next build`. The published
// Docker image is built generically (no `IS_HOSTED`/`RYBBIT_*` in the
// build env), so the rewrite list shipped empty and 404'd at runtime
// even when those vars were set on the host. Reading `env` here at
// request time keeps the proxy in lockstep with `<RybbitAnalytics>`'s
// render gate.
//
// Hosted-only. Self-host returns 404 even if an operator happens to set
// `RYBBIT_HOST`/`RYBBIT_SITE_ID`, matching `<RybbitAnalytics>`'s render
// gate exactly so the two never disagree. Self-hosters who want their
// own Rybbit instance should point it at their app directly rather than
// going through this proxy.
//
// Rybbit derives the client IP from `X-Forwarded-For` (otherwise every
// hit looks like our app's egress IP and geolocation collapses to one
// country). Forward XFF, User-Agent, and the original body verbatim.
// Never forward cookies or `Authorization` — same-origin pages would
// otherwise leak our auth session cookies to the analytics backend.
// `src/proxy.ts` strips those at the edge as defence-in-depth, but we
// also build the upstream Headers from scratch here rather than copying
// `req.headers`, so any future header that the middleware misses still
// can't leak through.

function gated(): { ok: false; res: NextResponse } | { ok: true } {
    if (!env.IS_HOSTED || !env.RYBBIT_HOST || !env.RYBBIT_SITE_ID) {
        return {
            ok: false,
            res: new NextResponse("Not found", { status: 404 }),
        };
    }
    return { ok: true };
}

function upstreamUrl(path: string): string {
    // RYBBIT_HOST is gated above; the cast keeps TS narrow at the
    // call site without re-checking.
    const host = (env.RYBBIT_HOST as string).replace(/\/$/, "");
    const suffix = path.startsWith("/") ? path : `/${path}`;
    return `${host}${suffix}`;
}

function forwardClientHeaders(req: Request, headers: Headers): void {
    const ua = req.headers.get("user-agent");
    if (ua) headers.set("User-Agent", ua);

    // Preserve the original client IP for Rybbit's geolocation. Next.js
    // doesn't expose `req.ip` on the standard Request, so we rebuild XFF
    // from the inbound header (set by our reverse proxy / load balancer).
    const xff = req.headers.get("x-forwarded-for");
    if (xff) {
        headers.set("X-Forwarded-For", xff);
    } else {
        const realIp = req.headers.get("x-real-ip");
        if (realIp) headers.set("X-Forwarded-For", realIp);
    }
}

export interface ProxyRybbitGetOptions {
    /**
     * Cache-Control to send to the browser. Defaults to `no-store`. The
     * tracking script and replay script are effectively static per
     * upstream deploy and benefit from a short shared cache; the
     * tracking-config endpoint is per-site config and should not be
     * cached across deploys.
     */
    cacheControl?: string;
    /**
     * Fallback `Content-Type` if upstream doesn't set one. Lets the JS
     * routes serve `application/javascript` and the JSON routes serve
     * `application/json` without inspecting bodies.
     */
    fallbackContentType?: string;
}

export async function proxyRybbitGet(
    req: Request,
    upstreamPath: string,
    opts: ProxyRybbitGetOptions = {},
): Promise<NextResponse> {
    const gate = gated();
    if (!gate.ok) return gate.res;

    const headers = new Headers();
    forwardClientHeaders(req, headers);

    let upstreamRes: Response;
    try {
        upstreamRes = await fetch(upstreamUrl(upstreamPath), {
            method: "GET",
            headers,
            cache: "no-store",
        });
    } catch {
        return new NextResponse("Bad gateway", { status: 502 });
    }
    if (!upstreamRes.ok || !upstreamRes.body) {
        return new NextResponse("Bad gateway", { status: 502 });
    }

    const resHeaders = new Headers();
    resHeaders.set(
        "Content-Type",
        upstreamRes.headers.get("content-type") ??
            opts.fallbackContentType ??
            "application/octet-stream",
    );
    resHeaders.set("Cache-Control", opts.cacheControl ?? "no-store");

    return new NextResponse(upstreamRes.body, {
        status: upstreamRes.status,
        headers: resHeaders,
    });
}

export async function proxyRybbitPost(
    req: Request,
    upstreamPath: string,
): Promise<NextResponse> {
    const gate = gated();
    if (!gate.ok) return gate.res;

    const body = await req.arrayBuffer();

    const headers = new Headers();
    headers.set(
        "Content-Type",
        req.headers.get("content-type") ?? "application/json",
    );
    forwardClientHeaders(req, headers);

    let upstreamRes: Response;
    try {
        upstreamRes = await fetch(upstreamUrl(upstreamPath), {
            method: "POST",
            headers,
            body,
            cache: "no-store",
        });
    } catch {
        return new NextResponse("Bad gateway", { status: 502 });
    }

    const resHeaders = new Headers();
    const ct = upstreamRes.headers.get("content-type");
    if (ct) resHeaders.set("Content-Type", ct);

    return new NextResponse(upstreamRes.body, {
        status: upstreamRes.status,
        headers: resHeaders,
    });
}
