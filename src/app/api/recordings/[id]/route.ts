import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings, transcriptions } from "@/db/schema";
import { auth } from "@/lib/auth";
import { createUserStorageProvider } from "@/lib/storage/factory";

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

        // Get transcription if exists
        const [transcription] = await db
            .select()
            .from(transcriptions)
            .where(eq(transcriptions.recordingId, id))
            .limit(1);

        return NextResponse.json({
            recording,
            transcription: transcription || null,
        });
    } catch (error) {
        console.error("Error fetching recording:", error);
        return NextResponse.json(
            { error: "Failed to fetch recording" },
            { status: 500 },
        );
    }
}

export async function PATCH(
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
        let body: unknown;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json(
                { error: "Invalid JSON body" },
                { status: 400 },
            );
        }
        const parsed = body as Record<string, unknown>;
        if (typeof parsed?.filename !== "string") {
            return NextResponse.json(
                { error: "Filename must be a string" },
                { status: 400 },
            );
        }
        const filename = parsed.filename.trim();

        if (!filename) {
            return NextResponse.json(
                { error: "Filename is required" },
                { status: 400 },
            );
        }

        const [recording] = await db
            .select({ id: recordings.id })
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

        await db
            .update(recordings)
            .set({ filename, filenameModified: true, updatedAt: new Date() })
            .where(
                and(
                    eq(recordings.id, id),
                    eq(recordings.userId, session.user.id),
                ),
            );

        return NextResponse.json({ success: true, filename });
    } catch (error) {
        console.error("Error updating recording:", error);
        return NextResponse.json(
            { error: "Failed to update recording" },
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

        const isLocallyCreated =
            recording.plaudFileId.startsWith("split-") ||
            recording.plaudFileId.startsWith("silence-removed-") ||
            recording.plaudFileId.startsWith("uploaded-");

        if (!isLocallyCreated) {
            return NextResponse.json(
                { error: "Only locally created recordings can be deleted" },
                { status: 403 },
            );
        }

        // Delete audio file from storage
        try {
            const storage = await createUserStorageProvider(session.user.id);
            await storage.deleteFile(recording.storagePath);
        } catch (err) {
            console.error("Failed to delete audio file from storage:", err);
            // Continue with DB deletion even if storage delete fails
        }

        // Delete from DB — transcriptions cascade automatically.
        // Include userId in the WHERE clause for defense-in-depth against
        // TOCTOU races: the ownership check above is a separate SELECT, so
        // repeating it here ensures we never delete a row we don't own even
        // if the session changes between the two queries.
        await db
            .delete(recordings)
            .where(
                and(
                    eq(recordings.id, id),
                    eq(recordings.userId, session.user.id),
                ),
            );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error deleting recording:", error);
        return NextResponse.json(
            { error: "Failed to delete recording" },
            { status: 500 },
        );
    }
}
