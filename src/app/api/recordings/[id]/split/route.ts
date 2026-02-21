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
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openplaud-split-"));
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

        // Get split segment duration from user settings
        const [settings] = await db
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, session.user.id))
            .limit(1);

        const splitSegmentMinutes = settings?.splitSegmentMinutes ?? 60;
        const segmentSeconds = splitSegmentMinutes * 60;

        // Download the audio file
        const storage = await createUserStorageProvider(session.user.id);
        const audioBuffer = await storage.downloadFile(recording.storagePath);

        // Plaud files always contain OGG/Opus audio regardless of the stored
        // file extension (storagePath may end in .mp3 but the container is OGG).
        // Always write input with its original extension so ffmpeg can probe it,
        // but always output segments as .ogg which is the correct container.
        const inputExt = recording.storagePath.endsWith(".mp3") ? ".mp3" : ".ogg";
        const outputExt = ".ogg";
        const contentType = "audio/ogg";

        // Write original to temp dir
        const inputPath = path.join(tmpDir, `input${inputExt}`);
        await fs.writeFile(inputPath, audioBuffer);

        // Run ffmpeg to split into segments.
        // -map 0:a  — select only the audio stream; Plaud OGG files contain an
        //             unknown metadata stream (stream #0:1) that ffmpeg cannot
        //             copy and which would otherwise cause "Conversion failed".
        const outputPattern = path.join(tmpDir, `part_%03d${outputExt}`);
        await execFileAsync("ffmpeg", [
            "-i", inputPath,
            "-map", "0:a",
            "-f", "segment",
            "-segment_time", String(segmentSeconds),
            "-c", "copy",
            "-reset_timestamps", "1",
            outputPattern,
        ]);

        // Read generated segment files (sorted)
        const allFiles = await fs.readdir(tmpDir);
        const segmentFiles = allFiles
            .filter((f) => f.startsWith("part_") && f.endsWith(outputExt))
            .sort();

        if (segmentFiles.length <= 1) {
            return NextResponse.json(
                { error: "Recording is too short to split into multiple segments" },
                { status: 400 },
            );
        }

        // Upload segments and create DB records
        const storagePathBase = recording.storagePath.replace(/\.[^.]+$/, "");
        const baseFilename = recording.filename.replace(/\.[^.]+$/, "");
        const durationPerSegmentMs = segmentSeconds * 1000;

        const newRecordingIds: string[] = [];

        for (let i = 0; i < segmentFiles.length; i++) {
            const segFile = segmentFiles[i];
            const segBuffer = await fs.readFile(path.join(tmpDir, segFile));
            const partNum = i + 1;

            // Build storage key (always .ogg for segments)
            const storageKey = `${storagePathBase}_part${String(partNum).padStart(3, "0")}${outputExt}`;

            // Upload segment
            await storage.uploadFile(storageKey, segBuffer, contentType);

            // Compute MD5
            const md5 = createHash("md5").update(segBuffer).digest("hex");

            // Calculate timing for this segment
            const segStartMs = i * durationPerSegmentMs;
            const segEndMs =
                i < segmentFiles.length - 1
                    ? (i + 1) * durationPerSegmentMs
                    : recording.duration;
            const segDurationMs = segEndMs - segStartMs;

            const segStartTime = new Date(
                recording.startTime.getTime() + segStartMs,
            );
            const segEndTime = new Date(
                recording.startTime.getTime() + segEndMs,
            );

            // Insert new recording row
            const [newRecording] = await db
                .insert(recordings)
                .values({
                    userId: session.user.id,
                    deviceSn: recording.deviceSn,
                    plaudFileId: `split-${recording.plaudFileId}-part${String(partNum).padStart(3, "0")}`,
                    filename: `${baseFilename} (Part ${partNum})`,
                    duration: segDurationMs,
                    startTime: segStartTime,
                    endTime: segEndTime,
                    filesize: segBuffer.length,
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

            newRecordingIds.push(newRecording.id);
        }

        return NextResponse.json({
            success: true,
            segmentCount: segmentFiles.length,
            recordingIds: newRecordingIds,
        });
    } catch (error) {
        console.error("Error splitting recording:", error);
        return NextResponse.json(
            { error: "Failed to split recording" },
            { status: 500 },
        );
    } finally {
        // Clean up temp files
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
}
