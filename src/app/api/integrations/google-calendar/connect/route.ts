import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { getGoogleAuthUrl } from "@/lib/google-calendar/client";

export async function GET(request: Request) {
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

        if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
            return NextResponse.json(
                {
                    error: "Google Calendar integration is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
                },
                { status: 400 },
            );
        }

        // Use user ID as state for security verification
        const state = session.user.id;
        const authUrl = getGoogleAuthUrl(state);

        return NextResponse.json({ authUrl });
    } catch (error) {
        console.error("Error generating Google auth URL:", error);
        return NextResponse.json(
            { error: "Failed to initiate Google Calendar connection" },
            { status: 500 },
        );
    }
}
