import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { and, eq, like } from "drizzle-orm";
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
        const force =
            new URL(request.url).searchParams.get("force") === "true";

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

        const rawSegmentMinutes = settings?.splitSegmentMinutes ?? 60;
        // Clamp to a minimum of 1 minute to prevent ffmpeg from hanging
        // on zero-length or negative segment sizes.
        const splitSegmentMinutes = Math.max(1, rawSegmentMinutes);
        const segmentSeconds = splitSegmentMinutes * 60;

        const storage = await createUserStorageProvider(session.user.id);

        // Check for already-existing split segments in the DB.
        // Count only those that are actually still present — the user may have
        // already deleted some manually since the last split.
        const escapedPlaudFileId = recording.plaudFileId
            // Escape backslash first (PostgreSQL LIKE default escape char), then % and _
            .replace(/\\/g, "\\\\")
            .replace(/%/g, "\\%")
            .replace(/_/g, "\\_");

        const existingSplits = await db
            .select({ id: recordings.id, storagePath: recordings.storagePath })
            .from(recordings)
            .where(
                and(
                    eq(recordings.userId, session.user.id),
                    like(
                        recordings.plaudFileId,
                        `split-${escapedPlaudFileId}-part%`,
                    ),
                ),
            );

        if (existingSplits.length > 0 && !force) {
            // Return conflict: let the client ask for confirmation first
            return NextResponse.json(
                {
                    error: "existing_splits",
                    existingCount: existingSplits.length,
                },
                { status: 409 },
            );
        }

        // Storage-file deletion for force re-splits is deferred to after
        // the DB transaction commits so a failed transaction never leaves
        // orphaned DB rows pointing at deleted files.

        // From here on: download, split, upload, then insert atomically
        const tmpDir = await fs.mkdtemp(
            path.join(os.tmpdir(), "openplaud-split-"),
        );

        try {
            const audioBuffer = await storage.downloadFile(
                recording.storagePath,
            );

            // Detect the actual file extension from the storage path and use it
            // for both input and output. OGG cannot hold MP3/AAC/PCM streams, so
            // non-OGG files must keep their original container format.
            const detectedExt = path.extname(recording.storagePath).toLowerCase() || ".ogg";
            const NON_OGG_EXTS = new Set([".mp3", ".m4a", ".wav"]);
            const inputExt = detectedExt;
            const outputExt = NON_OGG_EXTS.has(detectedExt) ? detectedExt : ".ogg";
            const contentType = outputExt === ".mp3"
                ? "audio/mpeg"
                : outputExt === ".m4a"
                  ? "audio/mp4"
                  : outputExt === ".wav"
                    ? "audio/wav"
                    : "audio/ogg";

            const inputPath = path.join(tmpDir, `input${inputExt}`);
            await fs.writeFile(inputPath, audioBuffer);

            // -map 0:a — skip the unknown metadata stream present in Plaud OGG files
            const outputPattern = path.join(tmpDir, `part_%03d${outputExt}`);
            await execFileAsync("ffmpeg", [
                "-i",
                inputPath,
                "-map",
                "0:a",
                "-f",
                "segment",
                "-segment_time",
                String(segmentSeconds),
                "-c",
                "copy",
                "-reset_timestamps",
                "1",
                outputPattern,
            ], { timeout: 300_000 }); // 5-minute timeout for large files

            const allFiles = await fs.readdir(tmpDir);
            const segmentFiles = allFiles
                .filter((f) => f.startsWith("part_") && f.endsWith(outputExt))
                .sort();

            if (segmentFiles.length <= 1) {
                return NextResponse.json(
                    {
                        error: "Recording is too short to split into multiple segments",
                    },
                    { status: 400 },
                );
            }

            const storagePathBase = recording.storagePath.replace(
                /\.[^.]+$/,
                "",
            );
            const baseFilename = recording.filename.replace(/\.[^.]+$/, "");
            const durationPerSegmentMs = segmentSeconds * 1000;

            // Prepare all segment buffers and storage uploads before touching
            // the database, so the DB transaction is as short as possible.
            const segmentRows: (typeof recordings.$inferInsert)[] = [];
            for (let i = 0; i < segmentFiles.length; i++) {
                const segBuffer = await fs.readFile(
                    path.join(tmpDir, segmentFiles[i]),
                );
                const partNum = i + 1;
                const storageKey = `${storagePathBase}_part${String(partNum).padStart(3, "0")}${outputExt}`;

                await storage.uploadFile(storageKey, segBuffer, contentType);

                const md5 = createHash("md5").update(segBuffer).digest("hex");

                const segStartMs = i * durationPerSegmentMs;
                const segEndMs =
                    i < segmentFiles.length - 1
                        ? (i + 1) * durationPerSegmentMs
                        : Math.max(segStartMs, recording.duration);

                segmentRows.push({
                    userId: session.user.id,
                    deviceSn: recording.deviceSn,
                    plaudFileId: `split-${recording.plaudFileId}-part${String(partNum).padStart(3, "0")}`,
                    filename: `${baseFilename} (Part ${partNum})`,
                    duration: segEndMs - segStartMs,
                    startTime: new Date(
                        recording.startTime.getTime() + segStartMs,
                    ),
                    endTime: new Date(
                        recording.startTime.getTime() + segEndMs,
                    ),
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
                });
            }

            // Wrap the DB delete (for force re-splits) and all inserts in a
            // single transaction so that partial failures leave no orphaned rows
            // and concurrent force=true requests cannot interleave their writes.
            const newRecordingIds = await db.transaction(async (tx) => {
                if (existingSplits.length > 0 && force) {
                    await tx
                        .delete(recordings)
                        .where(
                            and(
                                eq(recordings.userId, session.user.id),
                                like(
                                    recordings.plaudFileId,
                                    `split-${escapedPlaudFileId}-part%`,
                                ),
                            ),
                        );
                }

                const ids: string[] = [];
                for (const row of segmentRows) {
                    const [newRecording] = await tx
                        .insert(recordings)
                        .values(row)
                        .returning({ id: recordings.id });
                    ids.push(newRecording.id);
                }
                return ids;
            });

            // Delete old split storage files only after the DB transaction
            // has successfully committed, preserving consistency.
            if (existingSplits.length > 0 && force) {
                for (const split of existingSplits) {
                    try {
                        await storage.deleteFile(split.storagePath);
                    } catch (err) {
                        console.error(
                            `Failed to delete old storage file ${split.storagePath}:`,
                            err,
                        );
                    }
                }
            }

            return NextResponse.json({
                success: true,
                segmentCount: segmentFiles.length,
                recordingIds: newRecordingIds,
            });
        } finally {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    } catch (error) {
        console.error("Error splitting recording:", error);
        return NextResponse.json(
            { error: "Failed to split recording" },
            { status: 500 },
        );
    }
}
