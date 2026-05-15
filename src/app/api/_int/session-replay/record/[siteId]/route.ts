import { proxyRybbitPost } from "@/lib/rybbit/proxy";

// Session replay event ingest. The replay recorder POSTs batched
// rrweb-style events here; we forward them to Rybbit. Same trust model
// as `/api/_int/track`: body forwarded verbatim, XFF + UA preserved,
// auth cookies stripped at the middleware layer.

export const dynamic = "force-dynamic";

export async function POST(
    req: Request,
    { params }: { params: Promise<{ siteId: string }> },
) {
    const { siteId } = await params;
    return proxyRybbitPost(
        req,
        `/api/session-replay/record/${encodeURIComponent(siteId)}`,
    );
}
