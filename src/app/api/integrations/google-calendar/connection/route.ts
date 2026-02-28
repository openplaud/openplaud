import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { googleCalendarConnections } from "@/db/schema";
import { auth } from "@/lib/auth";

// GET - Check if Google Calendar is connected
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

        const [connection] = await db
            .select({
                id: googleCalendarConnections.id,
                calendarId: googleCalendarConnections.calendarId,
                createdAt: googleCalendarConnections.createdAt,
            })
            .from(googleCalendarConnections)
            .where(eq(googleCalendarConnections.userId, session.user.id))
            .limit(1);

        return NextResponse.json({
            connected: !!connection,
            calendarId: connection?.calendarId || null,
            connectedAt: connection?.createdAt || null,
        });
    } catch (error) {
        console.error("Error checking Google Calendar connection:", error);
        return NextResponse.json(
            { error: "Failed to check connection" },
            { status: 500 },
        );
    }
}

// DELETE - Disconnect Google Calendar
export async function DELETE(request: Request) {
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

        await db
            .delete(googleCalendarConnections)
            .where(eq(googleCalendarConnections.userId, session.user.id));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error disconnecting Google Calendar:", error);
        return NextResponse.json(
            { error: "Failed to disconnect" },
            { status: 500 },
        );
    }
}
