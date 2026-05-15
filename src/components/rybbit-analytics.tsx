import Script from "next/script";
import { env } from "@/lib/env";

// Module-scoped guard so the misconfig warning logs at most once per
// server process, even though this server component re-renders on every
// request (and may render multiple times in dev).
let warnedMisconfig = false;

/**
 * Rybbit analytics tracking script. Hosted-only.
 *
 * Renders nothing unless `IS_HOSTED=true` and both `RYBBIT_SITE_ID` and
 * `RYBBIT_HOST` are set. Self-hosters never load it and never make a
 * request to Rybbit.
 *
 * The script is loaded from same-origin (`/api/_int/script.js`) via
 * runtime route handlers in `src/app/api/_int/*`. The Rybbit client
 * derives its `analyticsHost` by splitting its own `src` on
 * `/script.js`, so the path segment is load-bearing: serving from
 * `/api/_int/s.js` would leave the client unable to compute event
 * URLs. Events POST back to `/api/_int/track` (same-origin), which the
 * proxy forwards to `${RYBBIT_HOST}/api/track`. This bypasses
 * ad-blockers that filter third-party analytics.
 */
export function RybbitAnalytics() {
    if (!env.IS_HOSTED) return null;
    if (!env.RYBBIT_SITE_ID || !env.RYBBIT_HOST) {
        if (!warnedMisconfig) {
            warnedMisconfig = true;
            // Loud-but-non-fatal: hosted deploy missing analytics config.
            console.warn(
                "[rybbit] IS_HOSTED=true but RYBBIT_SITE_ID and/or RYBBIT_HOST are unset; analytics disabled.",
            );
        }
        return null;
    }

    return (
        <Script
            src="/api/_int/script.js"
            data-site-id={env.RYBBIT_SITE_ID}
            strategy="afterInteractive"
        />
    );
}
