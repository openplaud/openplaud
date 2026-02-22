/**
 * Post-processing for Whisper/faster-whisper transcription output.
 *
 * Whisper (and compatible models) can enter "hallucination loops" where
 * a phrase is repeated hundreds of times. Two complementary strategies
 * are applied:
 *
 * 1. Segment quality filtering: verbose_json segments include metrics
 *    (compression_ratio, avg_logprob, no_speech_prob) that reliably
 *    identify looping/hallucinating segments before they are joined.
 *
 * 2. Text-based repetition removal: a sliding-window scan detects
 *    consecutive phrase repetitions in the final text and truncates
 *    at the first loop, acting as a safety net when quality metrics
 *    are absent or insufficient.
 */

interface TranscriptionSegment {
    text: string;
    avg_logprob?: number;
    compression_ratio?: number;
    no_speech_prob?: number;
}

// Standard faster-whisper quality thresholds (same defaults as the
// upstream Whisper library: github.com/openai/whisper/blob/main/whisper/transcribe.py)
const COMPRESSION_RATIO_THRESHOLD = 2.4;
const AVG_LOGPROB_THRESHOLD = -1.0;
const NO_SPEECH_THRESHOLD = 0.6;

/**
 * Filters out segments that look like hallucination/repetition loops
 * based on the per-segment quality metrics from verbose_json.
 */
export function filterSegmentsByQuality(
    segments: TranscriptionSegment[],
): string {
    const validTexts: string[] = [];

    for (const seg of segments) {
        const cr = seg.compression_ratio ?? 0;
        const lp = seg.avg_logprob ?? 0;
        const ns = seg.no_speech_prob ?? 0;

        // High compression ratio = the segment text compresses very well
        // = it is highly repetitive (hallucination loop)
        if (cr > COMPRESSION_RATIO_THRESHOLD) continue;

        // Very negative log-probability = low-confidence output
        if (lp < AVG_LOGPROB_THRESHOLD) continue;

        // High no-speech probability combined with low confidence = silence
        // that was filled with hallucinated content
        if (ns > NO_SPEECH_THRESHOLD && lp < -0.5) continue;

        validTexts.push(seg.text);
    }

    return validTexts.join("").trim();
}

/**
 * Detects and removes trailing repetition loops from transcription text.
 *
 * Scans for a phrase that repeats consecutively N+ times and truncates
 * the text to keep only the first occurrence, discarding the loop.
 *
 * Works across different loop sizes (from single words to long sentences).
 */
export function removeRepetitions(text: string): string {
    if (!text || text.length < 20) return text;

    const words = text.trim().split(/\s+/);

    // Each tier: [min window size, max window size, min consecutive repeats]
    // Short phrases (1-3 words) need a very high threshold (15+) because
    // legitimate song refrains ("la la la", "na na na") can reach 6-8 consecutive
    // repetitions without being a loop. Whisper hallucination loops for short
    // syllables typically run into the hundreds, so 15 is still well below that.
    // The segment quality filter (compression_ratio) is the primary defence for
    // short-phrase loops; this text scan is a last-resort safety net.
    const tiers: Array<[number, number, number]> = [
        [1, 3, 15], // e.g. "la la la..." — 15+ to distinguish loop from refrain
        [4, 8, 4],  // e.g. "I get mad I get mad..." — 4+ consecutive
        [9, 20, 3], // e.g. "As the water falls down..." — 3+ consecutive
    ];

    for (const [minW, maxW, minReps] of tiers) {
        for (let w = minW; w <= maxW; w++) {
            if (words.length < w * minReps) continue;

            for (let start = 0; start <= words.length - w * minReps; start++) {
                const phrase = words
                    .slice(start, start + w)
                    .join(" ")
                    .toLowerCase();

                let reps = 1;
                let pos = start + w;

                while (pos + w <= words.length) {
                    const candidate = words
                        .slice(pos, pos + w)
                        .join(" ")
                        .toLowerCase();
                    if (candidate === phrase) {
                        reps++;
                        pos += w;
                    } else {
                        break;
                    }
                }

                if (reps >= minReps) {
                    // Keep only the first occurrence of the phrase, drop the loop
                    return words
                        .slice(0, start + w)
                        .join(" ")
                        .trim();
                }
            }
        }
    }

    return text;
}

/**
 * Main entry point: cleans a transcription by applying both the segment
 * quality filter (when segments are available) and the text-based
 * repetition detector.
 */
export function postProcessTranscription(
    rawText: string,
    segments?: TranscriptionSegment[],
): string {
    let text = rawText;

    if (segments && segments.length > 0) {
        const hasMetrics = segments.some(
            (s) =>
                s.compression_ratio !== undefined ||
                s.avg_logprob !== undefined,
        );

        if (hasMetrics) {
            const filtered = filterSegmentsByQuality(segments);
            // Only use filtered result if it retained a meaningful portion
            // of the original text (guards against over-aggressive filtering)
            if (filtered.length > 0 && filtered.length >= rawText.length * 0.2) {
                text = filtered;
            }
        }
    }

    // Always run the text-based detector as a final safety net
    return removeRepetitions(text);
}
