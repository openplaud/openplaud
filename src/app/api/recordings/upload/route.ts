import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { createUserStorageProvider } from "@/lib/storage/factory";
import { getAudioMimeType } from "@/lib/utils";

const execFileAsync = promisify(execFile);

const ACCEPTED_EXTENSIONS = new Set([
    ".mp3",
    ".mp4",
    ".m4a",
    ".wav",
    ".ogg",
    ".opus",
    ".webm",
    ".aac",
    ".flac",
]);

async function getAudioDurationMs(filePath: string): Promise<number> {
    // Try stream duration first, fall back to format duration
    for (const flag of ["-show_streams", "-show_format"]) {
        try {
            const { stdout } = await execFileAsync(
                "ffprobe",
                ["-v", "quiet", "-print_format", "json", flag, filePath],
                { timeout: 30000 },
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

export async function POST(request: Request) {
    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "openplaud-upload-"),
    );

    try {
        const formData = await request.formData();
        const fileEntry = formData.get("file");

        if (!fileEntry || !(fileEntry instanceof File)) {
            return NextResponse.json(
                { error: "No file provided" },
                { status: 400 },
            );
        }

        const file = fileEntry;

        // Reject files larger than 500 MB
        const MAX_FILE_SIZE = 500 * 1024 * 1024;
        if (file.size > MAX_FILE_SIZE) {
            return NextResponse.json(
                { error: "File exceeds the 500 MB size limit" },
                { status: 413 },
            );
        }

        const ext = path.extname(file.name).toLowerCase();

        if (!ACCEPTED_EXTENSIONS.has(ext)) {
            return NextResponse.json(
                {
                    error: `Unsupported format. Accepted: ${[...ACCEPTED_EXTENSIONS].join(", ")}`,
                },
                { status: 400 },
            );
        }

        // Read file into buffer (inline to avoid keeping the intermediate
        // ArrayBuffer in scope alongside the Buffer, which would briefly
        // double memory usage for large files)
        const buffer = Buffer.from(await file.arrayBuffer());

        // Write to temp file so ffprobe can read it
        const inputPath = path.join(tmpDir, `input${ext}`);
        await fs.writeFile(inputPath, buffer);

        // Compute MD5 synchronously (no need to parallelize a sync operation)
        const md5 = createHash("md5").update(buffer).digest("hex");
        const durationMs = await getAudioDurationMs(inputPath);

        // Reject files where ffprobe could not detect a valid audio stream.
        // A duration of 0 means the file contains no readable audio data.
        if (durationMs === 0) {
            return NextResponse.json(
                { error: "File does not contain a valid audio stream" },
                { status: 422 },
            );
        }

        // Unique ID and storage key for this upload
        const fileId = `uploaded-${nanoid()}`;
        const storageKey = `${session.user.id}/${fileId}${ext}`;
        // Always derive content type from the validated extension — never
        // trust the user-supplied file.type, which could be set to text/html
        // and cause a stored XSS if the file is ever served directly.
        const contentType = getAudioMimeType(storageKey);

        const storage = await createUserStorageProvider(session.user.id);
        await storage.uploadFile(storageKey, buffer, contentType);

        const basename = path.basename(file.name, ext);
        const now = new Date();
        const endTime = new Date(now.getTime() + durationMs);

        try {
            await db.insert(recordings).values({
                userId: session.user.id,
                deviceSn: "local",
                plaudFileId: fileId,
                filename: basename,
                duration: durationMs,
                startTime: now,
                endTime,
                filesize: buffer.length,
                fileMd5: md5,
                storageType: env.DEFAULT_STORAGE_TYPE,
                storagePath: storageKey,
                downloadedAt: now,
                plaudVersion: "1",
                isTrash: false,
            });
        } catch (dbError) {
            // DB insert failed — clean up the already-uploaded storage file
            // to avoid orphaned objects with no corresponding DB record.
            try {
                await storage.deleteFile(storageKey);
            } catch (cleanupErr) {
                console.error(
                    "Failed to clean up orphaned storage file after DB insert error:",
                    cleanupErr,
                );
            }
            throw dbError;
        }

        return NextResponse.json({ success: true, filename: basename });
    } catch (error) {
        console.error("Error uploading recording:", error);
        return NextResponse.json(
            { error: "Failed to upload recording" },
            { status: 500 },
        );
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
}
