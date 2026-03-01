import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { notionConnections } from "@/db/schema";
import { auth } from "@/lib/auth";

// GET - Check if Notion is connected
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
                id: notionConnections.id,
                databaseName: notionConnections.databaseName,
                databaseId: notionConnections.databaseId,
                createdAt: notionConnections.createdAt,
            })
            .from(notionConnections)
            .where(eq(notionConnections.userId, session.user.id))
            .limit(1);

        return NextResponse.json({
            connected: !!connection,
            databaseName: connection?.databaseName || null,
            databaseId: connection?.databaseId || null,
            connectedAt: connection?.createdAt || null,
        });
    } catch (error) {
        console.error("Error checking Notion connection:", error);
        return NextResponse.json(
            { error: "Failed to check connection" },
            { status: 500 },
        );
    }
}

// DELETE - Disconnect Notion
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
            .delete(notionConnections)
            .where(eq(notionConnections.userId, session.user.id));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error disconnecting Notion:", error);
        return NextResponse.json(
            { error: "Failed to disconnect" },
            { status: 500 },
        );
    }
}
