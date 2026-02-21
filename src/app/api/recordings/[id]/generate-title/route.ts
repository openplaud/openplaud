import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { plaudConnections, recordings, transcriptions, userSettings } from "@/db/schema";
import { auth } from "@/lib/auth";
import { generateTitleFromTranscription } from "@/lib/ai/generate-title";
import { createPlaudClient } from "@/lib/plaud/client";

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
            .limit(1);

        if (!transcription?.text) {
            return NextResponse.json(
                { error: "No transcription available — transcribe the recording first" },
                { status: 400 },
            );
        }

        const generatedTitle = await generateTitleFromTranscription(
            session.user.id,
            transcription.text,
        );

        if (!generatedTitle) {
            return NextResponse.json(
                { error: "Could not generate a title — check your AI provider configuration" },
                { status: 422 },
            );
        }

        await db
            .update(recordings)
            .set({ filename: generatedTitle, filenameModified: true, updatedAt: new Date() })
            .where(eq(recordings.id, id));

        // Sync to Plaud device if the user has that option enabled
        const [settings] = await db
            .select({ syncTitleToPlaud: userSettings.syncTitleToPlaud })
            .from(userSettings)
            .where(eq(userSettings.userId, session.user.id))
            .limit(1);

        if (settings?.syncTitleToPlaud) {
            try {
                const [connection] = await db
                    .select()
                    .from(plaudConnections)
                    .where(eq(plaudConnections.userId, session.user.id))
                    .limit(1);

                if (connection) {
                    const plaudClient = await createPlaudClient(
                        connection.bearerToken,
                        connection.apiBase,
                    );
                    await plaudClient.updateFilename(
                        recording.plaudFileId,
                        generatedTitle,
                    );
                }
            } catch (err) {
                console.error("Failed to sync title to Plaud:", err);
            }
        }

        return NextResponse.json({ title: generatedTitle });
    } catch (error) {
        console.error("Error generating title:", error);
        return NextResponse.json(
            { error: "Failed to generate title" },
            { status: 500 },
        );
    }
}
