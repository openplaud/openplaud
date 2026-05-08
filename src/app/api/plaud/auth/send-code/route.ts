import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth-server";
import { plaudSendCode } from "@/lib/plaud/auth";

/**
 * POST /api/plaud/auth/send-code
 *
 * Proxies the OTP request to Plaud's API. The email and OTP token
 * pass straight through — we don't store either.
 *
 * Source: https://github.com/openplaud/openplaud/blob/main/src/app/api/plaud/auth/send-code/route.ts
 */
export async function POST(request: Request) {
    try {
        const sessionResult = await getApiSession(request);
        if (!sessionResult.session) return sessionResult.response;

        const { email } = await request.json();

        if (!email || typeof email !== "string") {
            return NextResponse.json(
                { error: "Email is required" },
                { status: 400 },
            );
        }

        const { token, apiBase } = await plaudSendCode(email.trim());

        return NextResponse.json({
            success: true,
            otpToken: token,
            apiBase,
        });
    } catch (error) {
        console.error("Error sending Plaud OTP:", error);
        // User-actionable Plaud errors (email not found, rate-limited,
        // region-redirect loop) all surface with a "Plaud API error:"
        // prefix — pass those through with a 400. Anything else is an
        // internal bug, generic message, 500.
        if (
            error instanceof Error &&
            error.message.startsWith("Plaud API error")
        ) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        return NextResponse.json(
            { error: "Failed to send verification code" },
            { status: 500 },
        );
    }
}
