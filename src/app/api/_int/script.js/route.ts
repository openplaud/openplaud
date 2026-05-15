import { proxyRybbitGet } from "@/lib/rybbit/proxy";

// Same-origin proxy for Rybbit's tracking script.
//
// The path segment `script.js` is load-bearing: the Rybbit client
// derives its `analyticsHost` by running `src.split("/script.js")[0]`.
// If we serve from `/api/_int/s.js`, that split is a no-op and the
// client tries to POST to the literal full src + `/api/track`, which
// resolves to nonsense. Keep this path as `script.js`.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    return proxyRybbitGet(req, "/api/script.js", {
        fallbackContentType: "application/javascript; charset=utf-8",
        // Rybbit's script is effectively static per upstream deploy.
        // Let browsers and our CDN cache it briefly so we don't proxy
        // every page load; `stale-while-revalidate` keeps it snappy
        // after expiry.
        cacheControl: "public, max-age=300, stale-while-revalidate=86400",
    });
}
