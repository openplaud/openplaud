import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { googleCalendarConnections } from "@/db/schema";
import { auth } from "@/lib/auth";
import { encrypt } from "@/lib/encryption";
import { env } from "@/lib/env";
import { exchangeCodeForTokens } from "@/lib/google-calendar/client";

export async function GET(request: Request) {
    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            const appUrl = env.APP_URL || "http://localhost:3000";
            return NextResponse.redirect(
                `${appUrl}/settings#integrations&error=unauthorized`,
            );
        }

        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        const appUrl = env.APP_URL || "http://localhost:3000";

        if (error) {
            return NextResponse.redirect(
                `${appUrl}/settings#integrations&error=${encodeURIComponent(error)}`,
            );
        }

        if (!code) {
            return NextResponse.redirect(
                `${appUrl}/settings#integrations&error=no_code`,
            );
        }

        // Verify state matches user ID
        if (state !== session.user.id) {
            return NextResponse.redirect(
                `${appUrl}/settings#integrations&error=invalid_state`,
            );
        }

        // Exchange code for tokens
        const tokens = await exchangeCodeForTokens(code);

        if (!tokens.refresh_token) {
            return NextResponse.redirect(
                `${appUrl}/settings#integrations&error=no_refresh_token`,
            );
        }

        const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

        // Upsert the connection
        const [existing] = await db
            .select()
            .from(googleCalendarConnections)
            .where(eq(googleCalendarConnections.userId, session.user.id))
            .limit(1);

        if (existing) {
            await db
                .update(googleCalendarConnections)
                .set({
                    accessToken: encrypt(tokens.access_token),
                    refreshToken: encrypt(tokens.refresh_token),
                    expiresAt,
                    updatedAt: new Date(),
                })
                .where(eq(googleCalendarConnections.userId, session.user.id));
        } else {
            await db.insert(googleCalendarConnections).values({
                userId: session.user.id,
                accessToken: encrypt(tokens.access_token),
                refreshToken: encrypt(tokens.refresh_token),
                expiresAt,
            });
        }

        return NextResponse.redirect(
            `${appUrl}/settings#integrations&success=google_calendar`,
        );
    } catch (error) {
        console.error("Error in Google Calendar callback:", error);
        const appUrl = env.APP_URL || "http://localhost:3000";
        return NextResponse.redirect(
            `${appUrl}/settings#integrations&error=callback_failed`,
        );
    }
}
