import { proxyRybbitGet } from "@/lib/rybbit/proxy";

// Per-site tracking config. The Rybbit client fetches this at startup
// to learn whether session replay, web vitals, etc. are enabled for the
// site. Without this route the client logs a 404 in the console and
// silently falls back to defaults.

export const dynamic = "force-dynamic";

export async function GET(
    req: Request,
    { params }: { params: Promise<{ siteId: string }> },
) {
    const { siteId } = await params;
    return proxyRybbitGet(
        req,
        `/api/site/tracking-config/${encodeURIComponent(siteId)}`,
        {
            fallbackContentType: "application/json",
        },
    );
}
