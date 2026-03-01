import { eq } from "drizzle-orm";
import { db } from "@/db";
import { googleCalendarConnections } from "@/db/schema";
import { decrypt, encrypt } from "@/lib/encryption";
import { env } from "@/lib/env";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

interface GoogleTokenResponse {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    token_type: string;
}

interface CalendarEvent {
    id: string;
    summary: string;
    description?: string;
    start: { dateTime?: string; date?: string };
    end: { dateTime?: string; date?: string };
    attendees?: Array<{ email: string; displayName?: string }>;
}

interface CalendarEventsResponse {
    items: CalendarEvent[];
}

/**
 * Get the Google OAuth redirect URI based on APP_URL
 */
export function getGoogleRedirectUri(): string {
    const appUrl = env.APP_URL || "http://localhost:3000";
    return `${appUrl}/api/integrations/google-calendar/callback`;
}

/**
 * Generate the Google OAuth authorization URL
 */
export function getGoogleAuthUrl(state: string): string {
    const clientId = env.GOOGLE_CLIENT_ID;
    if (!clientId) throw new Error("GOOGLE_CLIENT_ID not configured");

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: getGoogleRedirectUri(),
        response_type: "code",
        scope: "https://www.googleapis.com/auth/calendar.readonly",
        access_type: "offline",
        prompt: "consent",
        state,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
    code: string,
): Promise<GoogleTokenResponse> {
    const clientId = env.GOOGLE_CLIENT_ID;
    const clientSecret = env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        throw new Error("Google OAuth credentials not configured");
    }

    const response = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: getGoogleRedirectUri(),
            grant_type: "authorization_code",
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to exchange code for tokens: ${error}`);
    }

    return response.json();
}

/**
 * Refresh an expired access token
 */
async function refreshAccessToken(
    refreshToken: string,
): Promise<GoogleTokenResponse> {
    const clientId = env.GOOGLE_CLIENT_ID;
    const clientSecret = env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        throw new Error("Google OAuth credentials not configured");
    }

    const response = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "refresh_token",
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to refresh token: ${error}`);
    }

    return response.json();
}

/**
 * Get a valid access token for a user, refreshing if needed
 */
async function getValidAccessToken(userId: string): Promise<string | null> {
    const [connection] = await db
        .select()
        .from(googleCalendarConnections)
        .where(eq(googleCalendarConnections.userId, userId))
        .limit(1);

    if (!connection) return null;

    const now = new Date();
    const expiresAt = connection.expiresAt;

    // If token is still valid (with 5 min buffer), return it
    if (expiresAt > new Date(now.getTime() + 5 * 60 * 1000)) {
        return decrypt(connection.accessToken);
    }

    // Refresh the token
    try {
        const decryptedRefreshToken = decrypt(connection.refreshToken);
        const tokenResponse = await refreshAccessToken(decryptedRefreshToken);

        const newExpiresAt = new Date(
            Date.now() + tokenResponse.expires_in * 1000,
        );

        await db
            .update(googleCalendarConnections)
            .set({
                accessToken: encrypt(tokenResponse.access_token),
                expiresAt: newExpiresAt,
                updatedAt: new Date(),
            })
            .where(eq(googleCalendarConnections.userId, userId));

        return tokenResponse.access_token;
    } catch (error) {
        console.error("Failed to refresh Google Calendar token:", error);
        return null;
    }
}

/**
 * Get the calendar event happening at a specific time
 * Returns the event summary (title) or null if no event found
 */
export async function getCalendarEventAtTime(
    userId: string,
    time: Date,
): Promise<{ summary: string; description?: string } | null> {
    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) return null;

    const [connection] = await db
        .select()
        .from(googleCalendarConnections)
        .where(eq(googleCalendarConnections.userId, userId))
        .limit(1);

    if (!connection) return null;

    const calendarId = connection.calendarId || "primary";

    // Search for events happening at the given time
    // Use a window of +-1 minute to account for slight timing differences
    const timeMin = new Date(time.getTime() - 60 * 1000).toISOString();
    const timeMax = new Date(time.getTime() + 60 * 1000).toISOString();

    const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "5",
    });

    try {
        const response = await fetch(
            `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
            {
                headers: { Authorization: `Bearer ${accessToken}` },
            },
        );

        if (!response.ok) {
            console.error(
                "Failed to fetch calendar events:",
                await response.text(),
            );
            return null;
        }

        const data: CalendarEventsResponse = await response.json();

        if (data.items.length === 0) return null;

        // Return the first event that contains the recording time
        const event = data.items[0];
        return {
            summary: event.summary || "Untitled event",
            description: event.description,
        };
    } catch (error) {
        console.error("Error fetching calendar events:", error);
        return null;
    }
}
