/**
 * Client-side waveform peak extraction.
 *
 * Pipeline:
 *   1. Caller fetches the audio bytes (typically by tee-ing the existing
 *      playback `<audio>` source — see use-waveform.ts for that piece).
 *   2. We decode via the browser's AudioContext.decodeAudioData().
 *   3. We downsample to N buckets, taking max(|sample|) per bucket so
 *      the result hugs the envelope rather than averaging to mush.
 *   4. We normalize peaks into [0, 1] so the rendered waveform fills the
 *      canvas regardless of the source's mastering level.
 *
 * Why client-side: no server-side audio toolchain (ffmpeg, decoder
 * WASM) is required. The browser already supports every codec Plaud
 * emits. Cost is paid by the listener, only on content that's actually
 * played. See AGENTS-discussed tradeoffs.
 */

export const DEFAULT_BUCKETS = 500;

/**
 * Upper bound on automatic decode duration. Above this, the player
 * should show a manual "Generate waveform" button instead of decoding
 * the moment the user hits play. 30 minutes covers the vast majority
 * of Plaud recordings without risking 600+ MB of transient PCM RAM
 * for a 1-hour podcast.
 */
export const AUTO_DECODE_MAX_MS = 30 * 60 * 1000;

let sharedCtx: AudioContext | null = null;

/**
 * Lazily-instantiated, lifecycle-bound AudioContext. Some browsers
 * (notably Safari) limit total active contexts; we share one and never
 * close it for the page lifetime. Decode operations are independent
 * even on a shared context.
 */
function getAudioContext(): AudioContext {
    if (sharedCtx) return sharedCtx;
    // Older Safari ships `webkitAudioContext` only. lib.dom doesn't
    // include the vendor prefix, so read it off `window` via an
    // index lookup rather than narrowing the whole `Window` type.
    const Ctx: typeof AudioContext | undefined =
        typeof AudioContext !== "undefined"
            ? AudioContext
            : ((window as unknown as Record<string, unknown>)
                  .webkitAudioContext as typeof AudioContext | undefined);
    if (!Ctx) {
        throw new Error("Web Audio API not available");
    }
    sharedCtx = new Ctx();
    return sharedCtx;
}

export interface PeaksResult {
    peaks: number[];
    /**
     * Per-channel frame count (i.e. `audio.length`). Multiply by
     * `numberOfChannels` if you need total decoded samples — we don't
     * surface channel count separately because the only consumer
     * (waveform render) doesn't need it.
     */
    sampleCount: number;
    /** Decoded audio length in seconds. */
    durationSeconds: number;
}

/**
 * Decode an audio buffer and return normalized envelope peaks.
 * Throws if the buffer is not decodable by the browser (rare codec,
 * truncated download). Callers should always be ready to fall back to
 * a plain progress bar.
 */
export async function decodePeaks(
    arrayBuffer: ArrayBuffer,
    buckets: number = DEFAULT_BUCKETS,
): Promise<PeaksResult> {
    if (buckets < 32 || buckets > 2048) {
        // Mirror the server-side bounds so the network round-trip never
        // surprises the user with a 400.
        throw new Error("buckets must be between 32 and 2048");
    }

    const ctx = getAudioContext();
    // decodeAudioData returns the decoded PCM in an AudioBuffer. Modern
    // browsers run this off the main thread; older ones block.
    const audio = await ctx.decodeAudioData(arrayBuffer);

    const channelCount = audio.numberOfChannels;
    const length = audio.length;

    // Mix-down to mono on the fly while computing per-bucket max.
    // Avoids allocating a full Float32Array copy for the average.
    const peaks = new Float32Array(buckets);
    const samplesPerBucket = Math.max(1, Math.floor(length / buckets));

    // Cache channel data references to avoid getChannelData() in the
    // inner loop — that call is cheap but not free on Chromium.
    const channels: Float32Array[] = [];
    for (let c = 0; c < channelCount; c++) {
        channels.push(audio.getChannelData(c));
    }

    for (let b = 0; b < buckets; b++) {
        const start = b * samplesPerBucket;
        const end = Math.min(start + samplesPerBucket, length);
        let peak = 0;
        for (let i = start; i < end; i++) {
            let sum = 0;
            for (let c = 0; c < channelCount; c++) {
                sum += channels[c][i];
            }
            const v = Math.abs(sum / channelCount);
            if (v > peak) peak = v;
        }
        peaks[b] = peak;
    }

    // Normalize so the loudest bucket hits 1.0. Empty/silent files
    // (peak == 0) fall through with all-zero peaks, which renders as a
    // flat line — visually distinct from "no data" (which falls back
    // to the slider).
    let maxPeak = 0;
    for (let i = 0; i < buckets; i++) {
        if (peaks[i] > maxPeak) maxPeak = peaks[i];
    }

    const out = new Array<number>(buckets);
    if (maxPeak > 0) {
        const inv = 1 / maxPeak;
        for (let i = 0; i < buckets; i++) {
            out[i] = peaks[i] * inv;
        }
    } else {
        for (let i = 0; i < buckets; i++) {
            out[i] = 0;
        }
    }

    return {
        peaks: out,
        sampleCount: length,
        durationSeconds: audio.duration,
    };
}
