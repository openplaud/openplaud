import { and, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings, transcriptions } from "@/db/schema";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Accept optional ?since=ISO for time-based filtering.
    // Default: last 60s to catch recent completions on first poll.
    const url = new URL(request.url);
    const sinceParam = url.searchParams.get("since");
    const since = sinceParam
        ? new Date(sinceParam)
        : new Date(Date.now() - 60000);

    const conditions = [
        eq(transcriptions.userId, session.user.id),
        eq(transcriptions.status, "completed"),
        gt(transcriptions.createdAt, since),
    ];

    const rows = await db
        .select({
            transcriptionId: transcriptions.id,
            recordingId: transcriptions.recordingId,
            filename: recordings.filename,
            text: transcriptions.text,
        })
        .from(transcriptions)
        .innerJoin(recordings, eq(transcriptions.recordingId, recordings.id))
        .where(and(...conditions));

    return NextResponse.json({
        events: rows.map((r) => ({
            transcriptionId: r.transcriptionId,
            recordingId: r.recordingId,
            filename: r.filename,
            snippet: r.text ? `${r.text.slice(0, 80)}…` : "",
        })),
    });
}
