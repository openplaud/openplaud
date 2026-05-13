import { NextResponse } from "next/server";
import { env } from "@/lib/env";

// Shared runtime proxy for Rybbit event endpoints (`track`, `identify`).
// See `s.js/route.ts` for why this is a runtime route handler instead of a
// `next.config.ts` rewrite.
//
// Rybbit derives the client IP from `X-Forwarded-For` (otherwise everything
// looks like it came from our app's egress IP and geolocation collapses to
// one country). Forward that, the User-Agent, and the original body
// verbatim. Don't forward cookies or `Authorization` — same-origin pages
// would otherwise leak our auth session cookies to the analytics backend.

type Endpoint = "track" | "identify";

export async function proxyRybbitEvent(
    req: Request,
    endpoint: Endpoint,
): Promise<NextResponse> {
    if (!env.IS_HOSTED || !env.RYBBIT_HOST || !env.RYBBIT_SITE_ID) {
        return new NextResponse("Not found", { status: 404 });
    }

    const upstream = `${env.RYBBIT_HOST.replace(/\/$/, "")}/api/${endpoint}`;
    const body = await req.arrayBuffer();

    const headers = new Headers();
    headers.set(
        "Content-Type",
        req.headers.get("content-type") ?? "application/json",
    );
    const ua = req.headers.get("user-agent");
    if (ua) headers.set("User-Agent", ua);

    // Preserve the original client IP for Rybbit's geolocation. Next.js
    // doesn't expose req.ip on the standard Request, so we rebuild XFF
    // from the inbound header (set by our reverse proxy / load balancer).
    const xff = req.headers.get("x-forwarded-for");
    if (xff) headers.set("X-Forwarded-For", xff);
    const realIp = req.headers.get("x-real-ip");
    if (realIp && !xff) headers.set("X-Forwarded-For", realIp);

    let upstreamRes: Response;
    try {
        upstreamRes = await fetch(upstream, {
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
