import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { OpenAI } from "openai";
import { db } from "@/db";
import { apiCredentials, recordings, transcriptions } from "@/db/schema";
import { auth } from "@/lib/auth";
import { decrypt } from "@/lib/encryption";
import { createUserStorageProvider } from "@/lib/storage/factory";
import {
    getResponseFormat,
    parseTranscriptionResponse,
} from "@/lib/transcription/format";

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
        const body = await request.json().catch(() => ({}));
        const overrideProviderId = body.providerId as string | undefined;
        const overrideModel = body.model as string | undefined;

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

        // Get user's transcription API credentials
        // If a specific provider was requested, look it up by ID
        const [credentials] = overrideProviderId
            ? await db
                  .select()
                  .from(apiCredentials)
                  .where(
                      and(
                          eq(apiCredentials.id, overrideProviderId),
                          eq(apiCredentials.userId, session.user.id),
                      ),
                  )
                  .limit(1)
            : await db
                  .select()
                  .from(apiCredentials)
                  .where(
                      and(
                          eq(apiCredentials.userId, session.user.id),
                          eq(apiCredentials.isDefaultTranscription, true),
                      ),
                  )
                  .limit(1);

        if (!credentials) {
            return NextResponse.json(
                { error: "No transcription API configured" },
                { status: 400 },
            );
        }

        // Decrypt API key
        const apiKey = decrypt(credentials.apiKey);

        // Create OpenAI client (works with all OpenAI-compatible APIs)
        const openai = new OpenAI({
            apiKey,
            baseURL: credentials.baseUrl || undefined,
        });

        // Get storage provider and download audio
        const storage = await createUserStorageProvider(session.user.id);
        const audioBuffer = await storage.downloadFile(recording.storagePath);

        // Create a File object for the transcription API
        // Detect actual audio format from magic bytes since Plaud files
        // may have .mp3 extension but contain OGG/Opus data
        const header = new Uint8Array(audioBuffer.slice(0, 4));
        const isOgg =
            header[0] === 0x4f &&
            header[1] === 0x67 &&
            header[2] === 0x67 &&
            header[3] === 0x53; // "OggS"

        const ext = isOgg
            ? "ogg"
            : recording.storagePath.split(".").pop() || "mp3";
        const contentType = isOgg
            ? "audio/ogg"
            : recording.storagePath.endsWith(".mp3")
              ? "audio/mpeg"
              : "audio/opus";

        // Ensure filename has a valid extension so the API can detect the format
        const filename = recording.filename.match(/\.\w{2,4}$/)
            ? recording.filename
            : `${recording.filename}.${ext}`;

        const audioFile = new File([new Uint8Array(audioBuffer)], filename, {
            type: contentType,
        });

        const model = overrideModel || credentials.defaultModel || "whisper-1";
        const responseFormat = getResponseFormat(model);

        const transcription = await openai.audio.transcriptions.create({
            file: audioFile,
            model,
            response_format: responseFormat,
        });

        const { text: transcriptionText, detectedLanguage } =
            parseTranscriptionResponse(transcription, responseFormat);

        // Save transcription
        const [existingTranscription] = await db
            .select()
            .from(transcriptions)
            .where(eq(transcriptions.recordingId, id))
            .limit(1);

        if (existingTranscription) {
            await db
                .update(transcriptions)
                .set({
                    text: transcriptionText,
                    detectedLanguage,
                    transcriptionType: "server",
                    provider: credentials.provider,
                    model,
                })
                .where(eq(transcriptions.id, existingTranscription.id));
        } else {
            await db.insert(transcriptions).values({
                recordingId: id,
                userId: session.user.id,
                text: transcriptionText,
                detectedLanguage,
                transcriptionType: "server",
                provider: credentials.provider,
                model,
            });
        }

        return NextResponse.json({
            transcription: transcriptionText,
            detectedLanguage,
        });
    } catch (error) {
        console.error("Error transcribing:", error);
        return NextResponse.json(
            { error: "Failed to transcribe recording" },
            { status: 500 },
        );
    }
}
