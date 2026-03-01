import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyNotionConnection } from "@/lib/notion/verify";

// POST - Verify Notion connection
export async function POST(request: Request) {
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

        const { token, databaseId } = await request.json();

        if (!token || !databaseId) {
            return NextResponse.json(
                { error: "Token and database ID are required" },
                { status: 400 },
            );
        }

        const result = await verifyNotionConnection(token, databaseId);

        return NextResponse.json(result);
    } catch (error) {
        console.error("Error verifying Notion connection:", error);
        return NextResponse.json(
            { error: "Failed to verify Notion connection" },
            { status: 500 },
        );
    }
}
