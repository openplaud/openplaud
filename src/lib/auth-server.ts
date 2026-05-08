import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { auth } from "./auth";

/**
 * Get the current session on the server
 * Requires server component or API route
 */
export async function getSession() {
    const session = await auth.api.getSession({
        headers: await headers(),
    });

    return session;
}

/**
 * Require authentication - redirects to login if not authenticated, or to
 * /suspended if the user has been suspended by an admin (hosted mode only).
 * Use in server components.
 */
export async function requireAuth() {
    const session = await getSession();

    if (!session?.user) {
        redirect("/login");
    }

    // Hosted-mode suspension check. Cheap (PK lookup, indexed). Self-host
    // never sets suspendedAt because the admin gate is locked behind
    // IS_HOSTED, so this resolves to a no-op fast path there.
    const [u] = await db
        .select({ suspendedAt: users.suspendedAt })
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1);
    if (u?.suspendedAt) {
        redirect("/suspended");
    }

    return session;
}

/**
 * Redirect to dashboard if already authenticated
 * Use in login/register pages
 */
export async function redirectIfAuthenticated() {
    const session = await getSession();

    if (session?.user) {
        redirect("/dashboard");
    }
}

/**
 * API-route variant of requireAuth. Use in /api/* route handlers that operate
 * on user-owned data. Returns a discriminated result so the caller stays in
 * its existing try/catch shape:
 *
 *     const auth = await getApiSession(request);
 *     if (!auth.session) return auth.response;
 *     const session = auth.session;
 *
 * On unauthenticated requests returns a 401. On suspended users returns 403
 * with code ACCOUNT_SUSPENDED so the client can render the suspension state.
 * The check costs one indexed PK lookup; on self-host the column is always
 * null so the branch never triggers. This is the same boundary requireAuth()
 * applies for server pages -- factoring both onto the same suspension column
 * keeps enforcement consistent across the app.
 */
export async function getApiSession(
    request: Request,
): Promise<
    | { session: NonNullable<Awaited<ReturnType<typeof getSession>>> }
    | { session: null; response: NextResponse }
> {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
        return {
            session: null,
            response: NextResponse.json(
                { error: "Unauthorized", code: "UNAUTHORIZED" },
                { status: 401 },
            ),
        };
    }

    const [u] = await db
        .select({ suspendedAt: users.suspendedAt })
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1);

    if (u?.suspendedAt) {
        return {
            session: null,
            response: NextResponse.json(
                {
                    error: "Account suspended",
                    code: "ACCOUNT_SUSPENDED",
                },
                { status: 403 },
            ),
        };
    }

    return { session };
}
