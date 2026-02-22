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

async function getAudioDurationMs(filePath: string): Promise<number> {
    // Try stream duration first, fall back to format duration
    for (const flag of ["-show_streams", "-show_format"]) {
        try {
            const { stdout } = await execFileAsync("ffprobe", [
                "-v",
                "quiet",
                "-print_format",
                "json",
                flag,
                filePath,
            ]);
            const info = JSON.parse(stdout) as {
                streams?: Array<{ codec_type: string; duration?: string }>;
                format?: { duration?: string };
            };
            const durationStr =
                flag === "-show_streams"
                    ? info.streams?.find((s) => s.codec_type === "audio")
                          ?.duration
                    : info.format?.duration;
            const sec = parseFloat(durationStr ?? "0");
            if (sec > 0) return Math.round(sec * 1000);
        } catch {
            // try next flag
        }
    }
    return 0;
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    // Auth check before allocating any resources
    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) {
        return NextResponse.json(
            { error: "Unauthorized" },
            { status: 401 },
        );
    }

    const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "openplaud-silence-"),
    );
    try {

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
        const inputExt = path.extname(recording.storagePath).toLowerCase() || ".ogg";
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
        ], { timeout: 30_000 });

        const outputBuffer = await fs.readFile(outputPath);

        // Build storage key
        const storagePathBase = recording.storagePath.replace(/\.[^.]+$/, "");
        const storageKey = `${storagePathBase}_silence-removed.ogg`;

        await storage.uploadFile(storageKey, outputBuffer, "audio/ogg");

        const md5 = createHash("md5").update(outputBuffer).digest("hex");

        // Use ffprobe to get the actual duration of the output file.
        // File-size ratio is unreliable when the output bitrate differs from
        // the input bitrate (e.g. re-encoding with libopus at a fixed 32 kbps).
        const estimatedDurationMs = await getAudioDurationMs(outputPath);

        const baseFilename = recording.filename.replace(/\.[^.]+$/, "");
        const silencedPlaudFileId = `silence-removed-${recording.plaudFileId}`;

        // Atomic upsert: insert the silence-removed recording, or update the
        // existing row on conflict with the plaud_file_id unique constraint.
        // This replaces the previous SELECT-then-INSERT/UPDATE pattern which
        // was susceptible to a TOCTOU race under concurrent requests.
        const [upserted] = await db
            .insert(recordings)
            .values({
                userId: session.user.id,
                deviceSn: recording.deviceSn,
                plaudFileId: silencedPlaudFileId,
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
            .onConflictDoUpdate({
                target: recordings.plaudFileId,
                set: {
                    filename: `${baseFilename} (Silence Removed)`,
                    duration: estimatedDurationMs,
                    endTime: new Date(
                        recording.startTime.getTime() + estimatedDurationMs,
                    ),
                    filesize: outputBuffer.length,
                    fileMd5: md5,
                    storagePath: storageKey,
                    downloadedAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            .returning({ id: recordings.id });

        const resultId = upserted.id;

        const originalSizeMb = (audioBuffer.length / 1024 / 1024).toFixed(1);
        const newSizeMb = (outputBuffer.length / 1024 / 1024).toFixed(1);

        return NextResponse.json({
            success: true,
            recordingId: resultId,
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
