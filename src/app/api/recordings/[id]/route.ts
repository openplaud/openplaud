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
            recording.plaudFileId.startsWith("silence-removed-");

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

        // Delete from DB — transcriptions cascade automatically
        await db
            .delete(recordings)
            .where(eq(recordings.id, id));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error deleting recording:", error);
        return NextResponse.json(
            { error: "Failed to delete recording" },
            { status: 500 },
        );
    }
}
