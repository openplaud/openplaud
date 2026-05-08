import { headers as nextHeaders } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isAdminEmail } from "@/lib/admin/guard";
import {
    clientIpFromHeaders,
    ipMatchesAllowlist,
} from "@/lib/admin/ip-allowlist";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { ReauthForm } from "./reauth-form";

/**
 * Password reprompt for the admin dashboard. Reachable only after a regular
 * session is in place; non-admins, self-host, and IP-blocked clients all 404.
 *
 * The actual password verification + cookie issuance happens in
 * /api/admin/reauth -- this page just renders the form.
 */
export default async function AdminReauthPage({
    searchParams,
}: {
    searchParams: Promise<{ next?: string }>;
}) {
    if (!env.IS_HOSTED) notFound();
    if (env.ADMIN_EMAILS.length === 0) notFound();

    const hdrs = await nextHeaders();
    if (env.ADMIN_IP_ALLOWLIST.length > 0) {
        const ip = clientIpFromHeaders(hdrs);
        if (!ipMatchesAllowlist(ip, env.ADMIN_IP_ALLOWLIST)) notFound();
    }

    const session = await auth.api.getSession({ headers: hdrs });
    if (!session?.user) redirect("/login");
    if (!isAdminEmail(session.user.email)) notFound();

    const sp = await searchParams;
    // Restrict next-redirect to /admin or /admin/* so the cookie isn't used
    // to bounce through to arbitrary URLs. `.startsWith("/admin")` alone
    // would permit "/admin../foo" -- require the exact root or a trailing
    // slash.
    const rawNext = sp.next ?? "/admin";
    const next =
        rawNext === "/admin" || rawNext.startsWith("/admin/")
            ? rawNext
            : "/admin";

    return (
        <div className="min-h-[60vh] flex items-center justify-center p-6">
            <div className="w-full max-w-sm border rounded-xl p-6 bg-card shadow-sm">
                <h1 className="text-lg font-semibold mb-1">Admin reauth</h1>
                <p className="text-sm text-muted-foreground mb-4">
                    Enter your password to continue. The elevated session is
                    valid for {env.ADMIN_REAUTH_TTL_MINUTES} minutes.
                </p>
                <ReauthForm email={session.user.email} next={next} />
            </div>
        </div>
    );
}
