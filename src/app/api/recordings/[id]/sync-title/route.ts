import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { auth } from "@/lib/auth";
import { syncTitleToPlaudIfNeeded } from "@/lib/plaud/sync-title";

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
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

        const { id } = await params;

        const [recording] = await db
            .select()
            .from(recordings)
            .where(
                and(
                    eq(recordings.id, id),
                    eq(recordings.userId, session.user.id),
                ),
            )
            .limit(1);

        if (!recording) {
            return NextResponse.json(
                { error: "Recording not found" },
                { status: 404 },
            );
        }

        const result = await syncTitleToPlaudIfNeeded(
            session.user.id,
            id,
            recording.plaudFileId,
            recording.filename,
        );

        if (result === "locally_created") {
            return NextResponse.json(
                { error: "Only original Plaud recordings can be synced" },
                { status: 400 },
            );
        }

        if (result === "no_connection") {
            return NextResponse.json(
                { error: "No Plaud connection configured" },
                { status: 400 },
            );
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error syncing title to Plaud:", error);
        return NextResponse.json(
            { error: "Failed to sync title to Plaud" },
            { status: 500 },
        );
    }
}
