import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Returns the duration of an audio file in milliseconds using ffprobe.
 * Tries the stream-level duration first, then falls back to the format-level
 * duration. Returns 0 if neither is available or if ffprobe fails.
 */
export async function getAudioDurationMs(filePath: string): Promise<number> {
    // Try stream duration first, fall back to format duration
    for (const flag of ["-show_streams", "-show_format"]) {
        try {
            const { stdout } = await execFileAsync(
                "ffprobe",
                ["-v", "quiet", "-print_format", "json", flag, filePath],
                { timeout: 30_000 },
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
