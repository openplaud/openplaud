import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { plaudConnections } from "@/db/schema";
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
