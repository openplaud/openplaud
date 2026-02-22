/**
 * Post-processing for Whisper/faster-whisper transcription output.
 *
 * Whisper (and compatible models) can enter "hallucination loops" where
 * a phrase is repeated hundreds of times. Two complementary strategies
 * are applied:
 *
 * 1. Segment loop truncation: verbose_json segments include a
 *    compression_ratio metric that spikes sharply (5+) at the point
 *    where Whisper enters a hallucination loop. Everything from the
 *    first loop segment onwards is discarded; content before it is kept.
 *
 * 2. Trailing hallucination removal: segments at the end of the audio
 *    with both high no_speech_prob and very negative avg_logprob are
 *    stripped. This catches the single nonsensical phrases Whisper
 *    generates when audio ends with silence or low-energy content.
 *
 * 3. Text-based repetition removal: a sliding-window scan detects
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

// A compression_ratio this high reliably indicates a hallucination loop
// (normal speech segments stay well below 3; looping segments jump to 5+).
// Using a high threshold avoids false-positives on legitimately repetitive
// content such as refrains that might reach cr ~2.5–3.0.
const LOOP_COMPRESSION_RATIO_THRESHOLD = 5.0;

/**
 * Finds the index of the first segment that looks like the start of a
 * hallucination loop, based on an unusually high compression ratio.
 * Returns segments.length when no loop is detected.
 */
function findLoopStartIndex(segments: TranscriptionSegment[]): number {
    for (let i = 0; i < segments.length; i++) {
        if ((segments[i].compression_ratio ?? 0) > LOOP_COMPRESSION_RATIO_THRESHOLD) {
            return i;
        }
    }
    return segments.length;
}

/**
 * Removes trailing segments that are almost certainly hallucinated during
 * end-of-audio silence or low-energy audio. These segments typically have
 * both a high no_speech_prob (model thinks there is no speech) and a very
 * negative avg_logprob (model was very uncertain about what it generated).
 */
function removeTrailingNoSpeechSegments(
    segments: TranscriptionSegment[],
): TranscriptionSegment[] {
    let end = segments.length;
    while (end > 0) {
        const seg = segments[end - 1];
        const ns = seg.no_speech_prob ?? 0;
        const lp = seg.avg_logprob ?? 0;
        if (ns > 0.6 && lp < -1.0) {
            end--;
        } else {
            break;
        }
    }
    return segments.slice(0, end);
}

/**
 * Truncates the segment list at the first detected hallucination loop,
 * then strips any trailing end-of-audio hallucination segments.
 */
export function filterSegmentsByQuality(
    segments: TranscriptionSegment[],
): string {
    const loopStart = findLoopStartIndex(segments);
    const beforeLoop = segments.slice(0, loopStart);
    const cleaned = removeTrailingNoSpeechSegments(beforeLoop);
    return cleaned.map((s) => s.text).join("").trim();
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
    // legitimate repeated syllables or refrains can reach 6-8 consecutive
    // repetitions without being a loop. Whisper hallucination loops for short
    // syllables typically run into the hundreds, so 15 is still well below that.
    // The segment quality filter (compression_ratio) is the primary defence for
    // short-phrase loops; this text scan is a last-resort safety net.
    const tiers: Array<[number, number, number]> = [
        [1, 3, 15], // short filler syllables — require 15+ consecutive repetitions
        [4, 8, 4],  // medium phrases      — require 4+ consecutive repetitions
        [9, 20, 3], // long phrases        — require 3+ consecutive repetitions
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
            text = filterSegmentsByQuality(segments);
        }
    }

    // Always run the text-based detector as a final safety net
    return removeRepetitions(text);
}
