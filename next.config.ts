import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    output: "standalone",
    // Disable Next.js built-in gzip compression so HAProxy (or the browser)
    // controls compression.  Required because Next.js would otherwise gzip
    // SSE responses, which breaks streaming (gzip buffers until stream close).
    compress: false,
    images: {
        loader: "custom",
        loaderFile: "./loader.ts",
        remotePatterns: [],
    },
    async headers() {
        return [
            {
                // Apply no-store + no-transform to all non-static routes.
                // no-store: prevents HAProxy cache from serving stale HTML/JS.
                // no-transform: tells HAProxy NOT to gzip-compress responses —
                // critical for SSE endpoints where gzip buffering breaks streaming.
                source: "/((?!_next/static|_next/image|favicon.ico).*)",
                headers: [
                    {
                        key: "Cache-Control",
                        value: "no-store, must-revalidate, no-transform",
                    },
                ],
            },
        ];
    },
};

export default nextConfig;
