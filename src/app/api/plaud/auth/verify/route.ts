import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { plaudVerifyOtp } from "@/lib/plaud/auth";
import { persistPlaudConnection } from "@/lib/plaud/persist-connection";
import { isValidPlaudApiUrl } from "@/lib/plaud/servers";

/**
 * POST /api/plaud/auth/verify
 *
 * Verifies the OTP code against Plaud's API, obtains a long-lived access
 * token, encrypts it, and stores the connection.
 *
 * Source: https://github.com/openplaud/openplaud/blob/main/src/app/api/plaud/auth/verify/route.ts
 */
export async function POST(request: Request) {
    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const { code, otpToken, apiBase, email } = await request.json();

        if (
            typeof code !== "string" ||
            typeof otpToken !== "string" ||
            typeof apiBase !== "string" ||
            !code ||
            !otpToken ||
            !apiBase
        ) {
            return NextResponse.json(
                { error: "Code, OTP token, and API base are required" },
                { status: 400 },
            );
        }

        // SSRF guard: the client sends apiBase back to us (originally obtained
        // via the regional -302 redirect in send-code). Restrict to plaud.ai
        // hosts so a tampered client cannot point the server at an arbitrary
        // URL and coerce it into an internal-network request.
        if (!isValidPlaudApiUrl(apiBase)) {
            return NextResponse.json(
                { error: "Invalid API base" },
                { status: 400 },
            );
        }

        const plaudEmail =
            typeof email === "string" && email.trim().length > 0
                ? email.trim().toLowerCase()
                : null;

        // Verify OTP with Plaud → get the (long-lived) user token (UT)
        const { accessToken } = await plaudVerifyOtp(code, otpToken, apiBase);

        // Hand off to the shared persistence path: workspace discovery,
        // end-to-end /device/list validation, encrypted upsert, device sync.
        // Same gauntlet the paste-token connect flow runs through.
        const { devices } = await persistPlaudConnection({
            userId: session.user.id,
            accessToken,
            apiBase,
            plaudEmail,
        });

        return NextResponse.json({
            success: true,
            devices,
        });
    } catch (error) {
        console.error("Error verifying Plaud OTP:", error);
        // User-actionable errors (invalid code, expired OTP, rate-limited,
        // bad API base) pass through unchanged and return 400. Anything
        // else (DB errors, network blowups) is treated as an internal bug
        // — generic message, 500 status — so we don't leak implementation
        // details and so clients can distinguish "user's fault" from
        // "our fault".
        if (error instanceof Error && isUserFacingPlaudError(error.message)) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        return NextResponse.json(
            { error: "Verification failed" },
            { status: 500 },
        );
    }
}

/**
 * User-actionable errors we're willing to surface verbatim:
 * - `Plaud API error: ...` thrown by PlaudClient.request and by the Plaud
 *   auth helpers (plaudVerifyOtp etc).
 * - `Invalid API base` thrown by our own SSRF guard above.
 */
function isUserFacingPlaudError(msg: string): boolean {
    return msg.startsWith("Plaud API error") || msg === "Invalid API base";
}
