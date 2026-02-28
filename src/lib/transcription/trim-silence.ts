import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Trims trailing silence from an audio file using ffmpeg's silenceremove
 * filter applied via the double-reverse technique:
 *   reverse → remove leading silence → reverse back
 *
 * Removing trailing silence prevents Whisper from hallucinating content
 * (filler phrases, closing remarks, garbled text) during the silent
 * portion at the end of a recording.
 *
 * Falls back to the original buffer silently if ffmpeg fails or is
 * unavailable, so transcription still works in degraded environments.
 */
export async function trimTrailingSilence(
    audioBuffer: Buffer,
    storagePath: string,
): Promise<Buffer> {
    const tmpDir = os.tmpdir();
    const id = crypto.randomBytes(8).toString("hex");
    const ext = path.extname(storagePath).toLowerCase() || ".mp3";
    const inputPath = path.join(tmpDir, `op-${id}-in${ext}`);
    const outputPath = path.join(tmpDir, `op-${id}-out${ext}`);

    try {
        await fs.writeFile(inputPath, audioBuffer);

        await new Promise<void>((resolve, reject) => {
            // -50 dB threshold: well below any real audio content (speech or
            // music) but reliably above the noise floor of a silent recording.
            // start_duration=0.5 means only silence longer than 0.5 s is removed,
            // so short natural pauses in speech are preserved.
            const proc = spawn(
                "ffmpeg",
                [
                    "-i",
                    inputPath,
                    "-af",
                    "areverse,silenceremove=start_periods=1:start_duration=0.5:start_threshold=-50dB,areverse",
                    "-y",
                    outputPath,
                ],
                { stdio: "ignore" },
            );

            // Scale timeout with file size: the double-reverse technique
            // must decode the entire audio twice, which takes ~2 s/MB.
            // Minimum 30 s; maximum 10 min to avoid hanging indefinitely.
            const timeoutMs = Math.min(
                600_000,
                Math.max(30_000, (audioBuffer.length / 1_000_000) * 2_000),
            );
            const timeout = setTimeout(() => {
                proc.kill();
                reject(new Error("ffmpeg timeout"));
            }, timeoutMs);

            proc.on("close", (code) => {
                clearTimeout(timeout);
                code === 0
                    ? resolve()
                    : reject(new Error(`ffmpeg exited with code ${code}`));
            });
            proc.on("error", (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });

        const outputBuffer = await fs.readFile(outputPath);
        // Guard against ffmpeg producing an empty file (e.g. the entire
        // recording is below the silence threshold — silenceremove strips
        // everything and exits 0). Fall back to the original audio.
        if (outputBuffer.length < 100) {
            console.warn(
                "[transcription] silence trim produced empty output, using original audio",
            );
            return audioBuffer;
        }
        return outputBuffer;
    } catch (err) {
        console.warn(
            "[transcription] silence trim failed, using original audio:",
            err instanceof Error ? err.message : err,
        );
        return audioBuffer;
    } finally {
        await Promise.all([
            fs.unlink(inputPath).catch(() => {}),
            fs.unlink(outputPath).catch(() => {}),
        ]);
    }
}
