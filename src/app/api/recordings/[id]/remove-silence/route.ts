import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
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
            const { stdout } = await execFileAsync(
                "ffprobe",
                ["-v", "quiet", "-print_format", "json", flag, filePath],
                { timeout: 5_000 },
            );
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
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "openplaud-silence-"),
    );
    // Hoist storage and storageKey so the catch block can clean up on DB failure.
    let storage:
        | Awaited<ReturnType<typeof createUserStorageProvider>>
        | undefined;
    let storageKey: string | undefined;
    let storageUploaded = false;
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

        // Clamp values to safe ranges to prevent ffmpeg from mangling audio.
        // A threshold of 0 dB would strip all audio; very short durations can
        // cause unpredictable filter behavior.
        const thresholdDb = Math.max(
            -80,
            Math.min(-10, settings?.silenceThresholdDb ?? -40),
        );
        const durationSeconds = Math.max(
            0.1,
            Math.min(10, settings?.silenceDurationSeconds ?? 1.0),
        );

        // Download the audio file
        storage = await createUserStorageProvider(session.user.id);
        const audioBuffer = await storage.downloadFile(recording.storagePath);

        // Write original to temp dir (keep original extension for probing)
        const inputExt =
            path.extname(recording.storagePath).toLowerCase() || ".ogg";
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

        await execFileAsync(
            "ffmpeg",
            [
                "-v",
                "error",
                "-i",
                inputPath,
                "-map",
                "0:a",
                "-af",
                silenceFilter,
                "-c:a",
                "libopus",
                "-b:a",
                "32k",
                outputPath,
            ],
            { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 },
        );

        const outputBuffer = await fs.readFile(outputPath);

        const md5 = createHash("md5").update(outputBuffer).digest("hex");

        // Use ffprobe to get the actual duration of the output file.
        // File-size ratio is unreliable when the output bitrate differs from
        // the input bitrate (e.g. re-encoding with libopus at a fixed 32 kbps).
        const estimatedDurationMs = await getAudioDurationMs(outputPath);

        // Guard against a zero duration (e.g. if ffprobe fails to read the
        // output).  A recording with duration 0 and endTime === startTime is
        // misleading and makes it impossible to seek in the player.
        if (estimatedDurationMs <= 0) {
            return NextResponse.json(
                {
                    error: "Could not determine output duration — the file may be corrupt",
                },
                { status: 422 },
            );
        }

        // Build storage key and upload AFTER duration validation so we don't
        // leave orphaned files when the duration check fails.
        const storagePathBase = recording.storagePath.replace(/\.[^.]+$/, "");
        storageKey = `${storagePathBase}_silence-removed.ogg`;

        await storage.uploadFile(storageKey, outputBuffer, "audio/ogg");
        storageUploaded = true;

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
                // Only update the row if it belongs to the current user —
                // this prevents a collision with another user's recording that
                // happens to have the same plaudFileId.
                setWhere: eq(recordings.userId, session.user.id),
                set: {
                    filename: `${baseFilename} (Silence Removed)`,
                    duration: estimatedDurationMs,
                    endTime: new Date(
                        recording.startTime.getTime() + estimatedDurationMs,
                    ),
                    filesize: outputBuffer.length,
                    fileMd5: md5,
                    storageType: recording.storageType,
                    storagePath: storageKey,
                    downloadedAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            .returning({ id: recordings.id });

        // If setWhere prevented the update (plaudFileId conflict with another user),
        // returning() is empty. Clean up the orphaned storage file before
        // returning the conflict error.
        if (!upserted) {
            await storage
                .deleteFile(storageKey)
                .catch((err) =>
                    console.error(
                        `Failed to delete orphaned storage file on conflict:`,
                        err,
                    ),
                );
            return NextResponse.json(
                { error: "Recording ID conflict — try again" },
                { status: 409 },
            );
        }
        const resultId = upserted.id;

        const originalSizeMb = (audioBuffer.length / 1024 / 1024).toFixed(1);
        const newSizeMb = (outputBuffer.length / 1024 / 1024).toFixed(1);

        return NextResponse.json({
            success: true,
            recordingId: resultId,
            originalSizeMb,
            newSizeMb,
            reductionPercent: Math.max(
                0,
                Math.round(
                    (1 - outputBuffer.length / audioBuffer.length) * 100,
                ),
            ),
        });
    } catch (error) {
        console.error("Error removing silence:", error);
        // Clean up any uploaded storage file so we don't leave orphaned files
        // when the DB upsert (or any other step after upload) throws.
        if (storageUploaded && storageKey && storage) {
            await storage
                .deleteFile(storageKey)
                .catch((e) =>
                    console.error(
                        "Failed to delete orphaned file on error:",
                        e,
                    ),
                );
        }
        return NextResponse.json(
            { error: "Failed to remove silence" },
            { status: 500 },
        );
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
}
