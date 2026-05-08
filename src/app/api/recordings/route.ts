import { and, desc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { getApiSession } from "@/lib/auth-server";

export async function GET(request: Request) {
    try {
        const sessionResult = await getApiSession(request);
        if (!sessionResult.session) return sessionResult.response;
        const session = sessionResult.session;

        const userRecordings = await db
            .select()
            .from(recordings)
            .where(
                and(
                    eq(recordings.userId, session.user.id),
                    isNull(recordings.deletedAt),
                ),
            )
            .orderBy(desc(recordings.startTime));

        return NextResponse.json({ recordings: userRecordings });
    } catch (error) {
        console.error("Error fetching recordings:", error);
        return NextResponse.json(
            { error: "Failed to fetch recordings" },
            { status: 500 },
        );
    }
}
