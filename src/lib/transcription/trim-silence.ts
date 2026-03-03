import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getAudioMimeType } from "@/lib/utils";

/**
 * Trims trailing silence from an audio file using a two-phase ffmpeg approach:
 *
 * Phase 1 — silencedetect (streaming, no large RAM usage):
 *   Scans the entire audio for silence periods.  A "silence_start" marker with
 *   no corresponding "silence_end" means the silence extends to the end of the
 *   file (trailing silence).
 *
 * Phase 2 — stream-copy trim:
 *   Cuts the file at the trailing-silence start using "-c copy" (no decode /
 *   encode — fast and lossless).
 *
 * This approach works for files of any duration because silencedetect is a
 * streaming filter that never loads the full decoded PCM into memory (unlike
 * the old double-reverse technique, which required ~110 MB of RAM per hour).
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

        const trailingSilenceStart = await detectTrailingSilence(
            inputPath,
            audioBuffer.length,
        );

        if (trailingSilenceStart === null) {
            // No trailing silence — return original unchanged
            return audioBuffer;
        }

        console.log(
            `[transcription] Trailing silence at ${trailingSilenceStart.toFixed(1)}s — trimming`,
        );

        // Trim at the silence boundary using stream copy (lossless, fast)
        await new Promise<void>((resolve, reject) => {
            const proc = spawn(
                "ffmpeg",
                [
                    "-i",
                    inputPath,
                    "-t",
                    trailingSilenceStart.toFixed(3),
                    "-c",
                    "copy",
                    "-y",
                    outputPath,
                ],
                { stdio: "ignore" },
            );

            const timeout = setTimeout(() => {
                proc.kill();
                reject(new Error("ffmpeg trim timeout"));
            }, 60_000);

            proc.on("close", (code) => {
                clearTimeout(timeout);
                if (code === 0) resolve();
                else reject(new Error(`ffmpeg trim exited with code ${code}`));
            });
            proc.on("error", (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });

        const outputBuffer = await fs.readFile(outputPath);
        // Guard against an empty output (e.g. the entire recording is silence)
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

/**
 * Normalizes audio for speaker diarization.
 *
 * onnx-diarization computes speaker embeddings from waveform energy patterns.
 * Low-level or unbalanced recordings cause the embeddings of different speakers
 * to overlap — making the model classify everything as one speaker.
 *
 * This function converts the audio to 16 kHz mono WAV and applies EBU R128
 * loudness normalization (ffmpeg loudnorm).  16 kHz mono WAV is the standard
 * input format for speech models (Whisper, pyannote, onnx-diarization).
 *
 * Falls back to the original buffer silently if ffmpeg fails.
 */
export async function normalizeForDiarization(
    audioBuffer: Buffer,
    storagePath: string,
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const tmpDir = os.tmpdir();
    const id = crypto.randomBytes(8).toString("hex");
    const ext = path.extname(storagePath).toLowerCase() || ".mp3";
    const inputPath = path.join(tmpDir, `op-${id}-norm-in${ext}`);
    const outputPath = path.join(tmpDir, `op-${id}-norm-out.wav`);

    const originalFallback = {
        buffer: audioBuffer,
        mimeType: getAudioMimeType(storagePath),
        filename: path.basename(storagePath),
    };

    try {
        await fs.writeFile(inputPath, audioBuffer);

        // Timeout proportional to file size (same headroom as detectTrailingSilence)
        const timeoutMs = Math.min(
            600_000,
            Math.max(60_000, (audioBuffer.length / 1_000_000) * 15_000),
        );

        await new Promise<void>((resolve, reject) => {
            const proc = spawn(
                "ffmpeg",
                [
                    "-i",
                    inputPath,
                    // EBU R128 loudness normalization — brings quiet/loud recordings
                    // to a consistent -23 LUFS target so speaker embeddings are
                    // computed from comparable energy levels.
                    "-af",
                    "loudnorm=I=-23:LRA=7:TP=-2",
                    // 16 kHz mono is the standard for speech/diarization models
                    "-ar",
                    "16000",
                    "-ac",
                    "1",
                    "-y",
                    outputPath,
                ],
                { stdio: "ignore" },
            );

            const timeout = setTimeout(() => {
                proc.kill();
                reject(new Error("ffmpeg loudnorm timeout"));
            }, timeoutMs);

            proc.on("close", (code) => {
                clearTimeout(timeout);
                if (code === 0) resolve();
                else
                    reject(
                        new Error(`ffmpeg loudnorm exited with code ${code}`),
                    );
            });
            proc.on("error", (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });

        const outputBuffer = await fs.readFile(outputPath);
        if (outputBuffer.length < 100) {
            console.warn(
                "[transcription] loudnorm produced empty output, using original",
            );
            return originalFallback;
        }

        console.log(
            `[transcription] Normalized for diarization: ${(audioBuffer.length / 1_048_576).toFixed(1)} MB → ${(outputBuffer.length / 1_048_576).toFixed(1)} MB (16kHz mono WAV)`,
        );

        return {
            buffer: outputBuffer,
            mimeType: "audio/wav",
            filename: "audio.wav",
        };
    } catch (err) {
        console.warn(
            "[transcription] loudnorm failed, using original audio:",
            err instanceof Error ? err.message : err,
        );
        return originalFallback;
    } finally {
        await Promise.all([
            fs.unlink(inputPath).catch(() => {}),
            fs.unlink(outputPath).catch(() => {}),
        ]);
    }
}

/**
 * Runs ffmpeg's silencedetect filter and returns the timestamp (seconds) at
 * which trailing silence begins, or null if none is found.
 *
 * silencedetect outputs to stderr:
 *   [silencedetect] silence_start: 18234.5
 *   [silencedetect] silence_end: 18300.0 | silence_duration: 65.5
 *
 * A silence_start with no subsequent silence_end means the silence runs to
 * the end of the file — exactly what we want to trim.
 */
async function detectTrailingSilence(
    inputPath: string,
    fileSize: number,
): Promise<number | null> {
    // silencedetect is a streaming filter — RAM usage is negligible regardless
    // of file size.  Timeout is based on real-time processing speed: at ~29 kbps
    // (Plaud bitrate), 1 MB ≈ 4.5 s of audio; allow ~9 s/MB (~2x headroom).
    const timeoutMs = Math.min(
        600_000,
        Math.max(60_000, (fileSize / 1_000_000) * 9_000),
    );

    return new Promise<number | null>((resolve, reject) => {
        let stderr = "";

        const proc = spawn(
            "ffmpeg",
            [
                "-i",
                inputPath,
                "-af",
                "silencedetect=noise=-50dB:d=0.5",
                "-f",
                "null",
                "/dev/null",
            ],
            { stdio: ["ignore", "ignore", "pipe"] },
        );

        if (!proc.stderr) {
            reject(new Error("silencedetect: no stderr pipe"));
            return;
        }
        proc.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
        });

        const timeout = setTimeout(() => {
            proc.kill();
            reject(new Error("silencedetect timeout"));
        }, timeoutMs);

        proc.on("close", () => {
            clearTimeout(timeout);

            const silenceStarts = [
                ...stderr.matchAll(/silence_start: ([-\d.e+]+)/g),
            ].map((m) => parseFloat(m[1]));

            const silenceEnds = [
                ...stderr.matchAll(/silence_end: ([-\d.e+]+)/g),
            ].map((m) => parseFloat(m[1]));

            if (silenceStarts.length === 0) {
                resolve(null);
                return;
            }

            // If the last silence_start has no corresponding silence_end the
            // silence runs all the way to the end of the file.
            if (silenceEnds.length < silenceStarts.length) {
                resolve(silenceStarts[silenceStarts.length - 1]);
            } else {
                resolve(null);
            }
        });

        proc.on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}
