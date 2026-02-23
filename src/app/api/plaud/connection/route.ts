import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { plaudConnections } from "@/db/schema";
import { auth } from "@/lib/auth";
import { PLAUD_SERVERS, type PlaudServerKey } from "@/lib/plaud/servers";

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

        let server: PlaudServerKey | undefined;
        if (connection) {
            const entry = (
                Object.entries(PLAUD_SERVERS) as [
                    PlaudServerKey,
                    (typeof PLAUD_SERVERS)[PlaudServerKey],
                ][]
            ).find(([, s]) => s.apiBase === connection.apiBase);
            server = entry?.[0];
        }

        return NextResponse.json({
            connected: !!connection,
            server,
        });
    } catch (error) {
        console.error("Error checking Plaud connection:", error);
        return NextResponse.json(
            { error: "Failed to check connection" },
            { status: 500 },
        );
    }
}
