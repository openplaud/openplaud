import { NextResponse } from "next/server";
import { env } from "@/lib/env";

// Runtime same-origin proxy for Rybbit's tracking script. Replaces the
// build-time `rewrites()` entry that used to live in `next.config.ts` —
// rewrites are baked into `routes-manifest.json` at `next build`, so a
// generically-built Docker image (no `IS_HOSTED`/`RYBBIT_*` in the build
// env) shipped an empty rewrite list and 404'd at runtime even when those
// vars were set on the host. Reading `env` here at request time keeps the
// proxy in lockstep with `<RybbitAnalytics>`'s render gate.
//
// Hosted-only. Self-host returns 404 even if an operator happens to set
// `RYBBIT_HOST`/`RYBBIT_SITE_ID`, matching `<RybbitAnalytics>`'s render
// gate exactly so the two never disagree. Self-hosters who want their
// own Rybbit instance should point it at their app directly rather than
// going through this proxy.

export const dynamic = "force-dynamic";

export async function GET() {
    if (!env.IS_HOSTED || !env.RYBBIT_HOST || !env.RYBBIT_SITE_ID) {
        return new NextResponse("Not found", { status: 404 });
    }

    const upstream = `${env.RYBBIT_HOST.replace(/\/$/, "")}/api/script.js`;
    const res = await fetch(upstream, { cache: "no-store" });
    if (!res.ok || !res.body) {
        return new NextResponse("Bad gateway", { status: 502 });
    }

    const headers = new Headers();
    headers.set(
        "Content-Type",
        res.headers.get("content-type") ??
            "application/javascript; charset=utf-8",
    );
    // Rybbit's script is effectively static per upstream deploy. Let
    // browsers and our CDN cache it briefly so we don't proxy every page
    // load; `stale-while-revalidate` keeps it snappy after expiry.
    headers.set(
        "Cache-Control",
        "public, max-age=300, stale-while-revalidate=86400",
    );

    return new NextResponse(res.body, { status: 200, headers });
}
