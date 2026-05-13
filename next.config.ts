import type { NextConfig } from "next";

// The Rybbit analytics proxy used to live here as a `rewrites()` entry.
// `next.config.ts` is evaluated at `next build`, and the published Docker
// image is built generically without `IS_HOSTED`/`RYBBIT_*` set, so the
// rewrite list was baked as `[]` and `/api/_int/*` 404'd at runtime even
// when those vars were configured on the host. The proxy now lives as
// runtime route handlers under `src/app/api/_int/*` which read `env` at
// request time, in lockstep with `<RybbitAnalytics>`'s render gate.
const nextConfig: NextConfig = {
    output: "standalone",
    // The `/install.sh` and `/[version]/install.sh` routes read
    // `scripts/install.sh` from disk at request time. The standalone
    // output only includes files reachable through the build graph, so
    // declare the script as an extra traced input or it won't ship in
    // the Docker image. See `src/lib/install-script.ts`.
    outputFileTracingIncludes: {
        "/install.sh": ["./scripts/install.sh"],
        "/[version]/install.sh": ["./scripts/install.sh"],
    },
    images: {
        loader: "custom",
        loaderFile: "./loader.ts",
        remotePatterns: [],
    },
};

export default nextConfig;
