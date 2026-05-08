import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth-server";
import { sendTestEmail } from "@/lib/notifications/email";

export async function POST(request: Request) {
    try {
        const sessionResult = await getApiSession(request);
        if (!sessionResult.session) return sessionResult.response;

        const body = await request.json();
        const { email } = body;

        if (!email || typeof email !== "string") {
            return NextResponse.json(
                { error: "Email address is required" },
                { status: 400 },
            );
        }

        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return NextResponse.json(
                { error: "Invalid email address" },
                { status: 400 },
            );
        }

        // Send test email
        await sendTestEmail(email);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error sending test email:", error);
        const errorMessage =
            error instanceof Error
                ? error.message
                : "Failed to send test email";
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
