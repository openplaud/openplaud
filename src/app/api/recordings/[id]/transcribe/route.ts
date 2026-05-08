import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings, transcriptions } from "@/db/schema";
import { auth } from "@/lib/auth";
import { decryptText } from "@/lib/encryption/fields";
import { abort } from "@/lib/transcription/abort-registry";

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
                    isNull(recordings.deletedAt),
                ),
            )
            .limit(1);

        if (!recording) {
            return NextResponse.json(
                { error: "Recording not found" },
                { status: 404 },
            );
        }

        const [existing] = await db
            .select()
            .from(transcriptions)
            .where(eq(transcriptions.recordingId, id))
            .limit(1);

        if (existing) {
            if (
                existing.status === "pending" ||
                existing.status === "processing"
            ) {
                return NextResponse.json({
                    status: existing.status,
                });
            }

            await db
                .update(transcriptions)
                .set({
                    status: "pending",
                    text: "",
                    errorMessage: null,
                    retryCount: 0,
                    lockedAt: null,
                })
                .where(eq(transcriptions.recordingId, id));

            import("@/lib/transcription/worker").then(
                ({ ensureWorkerStarted }) => ensureWorkerStarted(),
            );

            return NextResponse.json({ status: "pending" });
        }

        await db.insert(transcriptions).values({
            recordingId: id,
            userId: session.user.id,
            status: "pending",
            text: "",
            provider: "",
            model: "",
        });

        import("@/lib/transcription/worker").then(({ ensureWorkerStarted }) =>
            ensureWorkerStarted(),
        );

        return NextResponse.json({ status: "pending" }, { status: 202 });
    } catch (error) {
        console.error("Error enqueuing transcription:", error);
        return NextResponse.json(
            { error: "Failed to enqueue transcription" },
            { status: 500 },
        );
    }
}

export async function GET(
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

        const [row] = await db
            .select()
            .from(transcriptions)
            .where(
                and(
                    eq(transcriptions.recordingId, id),
                    eq(transcriptions.userId, session.user.id),
                ),
            )
            .limit(1);

        if (!row) {
            return NextResponse.json({ status: null });
        }

        return NextResponse.json({
            status: row.status,
            text: row.text ? decryptText(row.text) : null,
            errorMessage: row.errorMessage,
            detectedLanguage: row.detectedLanguage,
            provider: row.provider,
            model: row.model,
            createdAt: row.createdAt,
        });
    } catch (error) {
        console.error("Error polling transcription:", error);
        return NextResponse.json(
            { error: "Failed to poll transcription" },
            { status: 500 },
        );
    }
}

export async function DELETE(
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

        const [row] = await db
            .select()
            .from(transcriptions)
            .where(
                and(
                    eq(transcriptions.recordingId, id),
                    eq(transcriptions.userId, session.user.id),
                ),
            )
            .limit(1);

        if (!row) {
            return NextResponse.json(
                { error: "No transcription found" },
                { status: 404 },
            );
        }

        if (row.status !== "pending" && row.status !== "processing") {
            return NextResponse.json(
                { error: "Cannot cancel" },
                { status: 409 },
            );
        }

        await db
            .update(transcriptions)
            .set({
                status: "cancelled",
                text: "",
                lockedAt: null,
            })
            .where(eq(transcriptions.recordingId, id));

        abort(id);

        return NextResponse.json({ status: "cancelled" });
    } catch (error) {
        console.error("Error cancelling transcription:", error);
        return NextResponse.json(
            { error: "Failed to cancel transcription" },
            { status: 500 },
        );
    }
}
