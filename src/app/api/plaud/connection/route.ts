import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { plaudConnections, plaudDevices } from "@/db/schema";
import { auth } from "@/lib/auth";
import { serverKeyFromApiBase } from "@/lib/plaud/servers";

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
            .select()
            .from(plaudConnections)
            .where(eq(plaudConnections.userId, session.user.id))
            .limit(1);

        if (!connection) {
            return NextResponse.json({ connected: false });
        }

        const server = serverKeyFromApiBase(connection.apiBase);

        return NextResponse.json({
            connected: true,
            server,
            plaudEmail: connection.plaudEmail ?? null,
            createdAt: connection.createdAt,
            updatedAt: connection.updatedAt,
            // Include the raw URL so the UI can populate the custom field
            ...(server === "custom" && { apiBase: connection.apiBase }),
        });
    } catch (error) {
        console.error("Error checking Plaud connection:", error);
        return NextResponse.json(
            { error: "Failed to check connection" },
            { status: 500 },
        );
    }
}

/**
 * DELETE /api/plaud/connection
 *
 * Disconnects the current Plaud account for this user by deleting the
 * stored connection and its associated device rows. Synced recordings are
 * preserved — they remain in the user's OpenPlaud library.
 */
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
            .delete(plaudDevices)
            .where(eq(plaudDevices.userId, session.user.id));

        await db
            .delete(plaudConnections)
            .where(eq(plaudConnections.userId, session.user.id));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error disconnecting Plaud:", error);
        return NextResponse.json(
            { error: "Failed to disconnect" },
            { status: 500 },
        );
    }
}
