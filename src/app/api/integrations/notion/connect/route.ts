import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { notionConnections } from "@/db/schema";
import { auth } from "@/lib/auth";
import { encrypt } from "@/lib/encryption";
import { verifyNotionConnection } from "@/lib/notion/client";

// POST - Connect Notion with API key and database ID
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

        const body = await request.json();
        const { apiKey, databaseId } = body;

        if (!apiKey || !databaseId) {
            return NextResponse.json(
                { error: "API key and database ID are required" },
                { status: 400 },
            );
        }

        // Verify the connection works
        const verification = await verifyNotionConnection(apiKey, databaseId);

        if (!verification.valid) {
            return NextResponse.json(
                {
                    error: `Notion connection failed: ${verification.error}`,
                },
                { status: 400 },
            );
        }

        // Upsert the connection
        const [existing] = await db
            .select()
            .from(notionConnections)
            .where(eq(notionConnections.userId, session.user.id))
            .limit(1);

        if (existing) {
            await db
                .update(notionConnections)
                .set({
                    apiKey: encrypt(apiKey),
                    databaseId,
                    databaseName: verification.databaseName || null,
                    updatedAt: new Date(),
                })
                .where(eq(notionConnections.userId, session.user.id));
        } else {
            await db.insert(notionConnections).values({
                userId: session.user.id,
                apiKey: encrypt(apiKey),
                databaseId,
                databaseName: verification.databaseName || null,
            });
        }

        return NextResponse.json({
            success: true,
            databaseName: verification.databaseName,
        });
    } catch (error) {
        console.error("Error connecting Notion:", error);
        return NextResponse.json(
            { error: "Failed to connect Notion" },
            { status: 500 },
        );
    }
}
