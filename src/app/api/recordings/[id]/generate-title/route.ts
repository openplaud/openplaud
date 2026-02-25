import { and, desc, eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { db } from "@/db";
import { recordings, transcriptions, userSettings } from "@/db/schema";
import { generateTitleFromTranscription } from "@/lib/ai/generate-title";
import { auth } from "@/lib/auth";
import { syncTitleToPlaudIfNeeded } from "@/lib/plaud/sync-title-server";

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

        const [transcription] = await db
            .select({ text: transcriptions.text })
            .from(transcriptions)
            .where(
                and(
                    eq(transcriptions.recordingId, id),
                    eq(transcriptions.userId, session.user.id),
                ),
            )
            .orderBy(desc(transcriptions.createdAt))
            .limit(1);

        if (!transcription?.text) {
            return NextResponse.json(
                {
                    error: "No transcription available — transcribe the recording first",
                },
                { status: 400 },
            );
        }

        const generatedTitle = await generateTitleFromTranscription(
            session.user.id,
            transcription.text,
        );

        if (!generatedTitle) {
            return NextResponse.json(
                {
                    error: "Could not generate a title — check your AI provider configuration",
                },
                { status: 422 },
            );
        }

        await db
            .update(recordings)
            .set({
                filename: generatedTitle,
                filenameModified: true,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(recordings.id, id),
                    eq(recordings.userId, session.user.id),
                ),
            );

        // Sync to Plaud device after the response is sent (fire-and-forget, best-effort)
        after(async () => {
            try {
                const [settings] = await db
                    .select({ syncTitleToPlaud: userSettings.syncTitleToPlaud })
                    .from(userSettings)
                    .where(eq(userSettings.userId, session.user.id))
                    .limit(1);

                if (settings?.syncTitleToPlaud) {
                    await syncTitleToPlaudIfNeeded(
                        session.user.id,
                        id,
                        recording.plaudFileId,
                        generatedTitle,
                    );
                }
            } catch (err) {
                console.error("Failed to sync title to Plaud:", err);
            }
        });

        return NextResponse.json({ title: generatedTitle });
    } catch (error) {
        console.error("Error generating title:", error);
        return NextResponse.json(
            { error: "Failed to generate title" },
            { status: 500 },
        );
    }
}
