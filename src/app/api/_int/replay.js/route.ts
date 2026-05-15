import { proxyRybbitGet } from "@/lib/rybbit/proxy";

// Session replay recorder script. Only loaded by the tracking script
// when the per-site tracking config has session replay enabled. We
// proxy it unconditionally so the client can decide; the gate stays at
// the Rybbit dashboard level.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    return proxyRybbitGet(req, "/api/replay.js", {
        fallbackContentType: "application/javascript; charset=utf-8",
        cacheControl: "public, max-age=300, stale-while-revalidate=86400",
    });
}
