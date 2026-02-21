import { createHash } from "crypto";
import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings, userSettings } from "@/db/schema";
import { auth } from "@/lib/auth";
import { createUserStorageProvider } from "@/lib/storage/factory";

const execFileAsync = promisify(execFile);

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "openplaud-silence-"),
    );
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

        // Get silence removal settings
        const [settings] = await db
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, session.user.id))
            .limit(1);

        const thresholdDb = settings?.silenceThresholdDb ?? -40;
        const durationSeconds = settings?.silenceDurationSeconds ?? 1.0;

        // Download the audio file
        const storage = await createUserStorageProvider(session.user.id);
        const audioBuffer = await storage.downloadFile(recording.storagePath);

        // Write original to temp dir (keep original extension for probing)
        const inputExt = recording.storagePath.endsWith(".mp3") ? ".mp3" : ".ogg";
        const inputPath = path.join(tmpDir, `input${inputExt}`);
        await fs.writeFile(inputPath, audioBuffer);

        // Output is always OGG/Opus (Plaud's native format)
        const outputPath = path.join(tmpDir, "output.ogg");

        // Run ffmpeg silenceremove filter.
        // start_periods=1  — trim leading silence
        // stop_periods=-1  — remove all interior silence periods
        // Thresholds and minimum duration come from user settings.
        // Re-encode with libopus at 32 kbps (Plaud records at ~34 kbps mono).
        const silenceFilter = [
            "silenceremove=",
            `start_periods=1:start_duration=0.1:start_threshold=${thresholdDb}dB`,
            `:stop_periods=-1:stop_duration=${durationSeconds}:stop_threshold=${thresholdDb}dB`,
        ].join("");

        await execFileAsync("ffmpeg", [
            "-i", inputPath,
            "-map", "0:a",
            "-af", silenceFilter,
            "-c:a", "libopus",
            "-b:a", "32k",
            outputPath,
        ]);

        const outputBuffer = await fs.readFile(outputPath);

        // Build storage key
        const storagePathBase = recording.storagePath.replace(/\.[^.]+$/, "");
        const storageKey = `${storagePathBase}_silence-removed.ogg`;

        await storage.uploadFile(storageKey, outputBuffer, "audio/ogg");

        const md5 = createHash("md5").update(outputBuffer).digest("hex");

        // Estimate duration from file size ratio (rough approximation)
        const durationRatio = outputBuffer.length / audioBuffer.length;
        const estimatedDurationMs = Math.round(recording.duration * durationRatio);

        const baseFilename = recording.filename.replace(/\.[^.]+$/, "");

        const [newRecording] = await db
            .insert(recordings)
            .values({
                userId: session.user.id,
                deviceSn: recording.deviceSn,
                plaudFileId: `silence-removed-${recording.plaudFileId}`,
                filename: `${baseFilename} (Silence Removed)`,
                duration: estimatedDurationMs,
                startTime: recording.startTime,
                endTime: new Date(
                    recording.startTime.getTime() + estimatedDurationMs,
                ),
                filesize: outputBuffer.length,
                fileMd5: md5,
                storageType: recording.storageType,
                storagePath: storageKey,
                downloadedAt: new Date(),
                plaudVersion: recording.plaudVersion,
                timezone: recording.timezone,
                zonemins: recording.zonemins,
                scene: recording.scene,
                isTrash: false,
            })
            .returning({ id: recordings.id });

        const originalSizeMb = (audioBuffer.length / 1024 / 1024).toFixed(1);
        const newSizeMb = (outputBuffer.length / 1024 / 1024).toFixed(1);

        return NextResponse.json({
            success: true,
            recordingId: newRecording.id,
            originalSizeMb,
            newSizeMb,
            reductionPercent: Math.round((1 - outputBuffer.length / audioBuffer.length) * 100),
        });
    } catch (error) {
        console.error("Error removing silence:", error);
        return NextResponse.json(
            { error: "Failed to remove silence" },
            { status: 500 },
        );
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
}
