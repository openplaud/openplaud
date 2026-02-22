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
 * 2. Trailing hallucination removal: two passes over the final segments.
 *    Pass 1 detects consecutive duplicate segment texts (mini-loop) and
 *    removes everything from the start of that run to the end. Pass 2
 *    then removes any remaining tail segments with very negative
 *    avg_logprob (model was highly uncertain), which catches short
 *    nonsensical phrases that follow the mini-loop.
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

// Whisper reliably hallucinates one of these closing phrases when the audio
// ends or fades out. Every phrase the model produces ends with one of these
// patterns, making them safe to strip from the tail of any transcription.
const CLOSING_HALLUCINATION_PATTERNS = [
    /\bthank\s+you\b\.?\s*$/i,
    /\bthanks?\s+for\s+(watching|listening|joining|your\s+time)\b/i,
    /\bplease\s+(like\s+and\s+)?subscribe\b/i,
    /\bsee\s+you\s+(next\s+time|later|soon)\b/i,
    /\bgoodbye\b\.?\s*$/i,
    /\bbye[-\s]*bye\b\.?\s*$/i,
    // Short non-verbal filler sounds Whisper generates during end-of-audio silence
    /^(m{2,}|h?m{2,}|u+h*|u+m+|a+h+)\.?\s*$/i,
];

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
 * Removes trailing hallucination segments using three passes.
 *
 * Pass 1 – Mini-loop detection: scans the last few segments for a
 * consecutive pair with identical text. When found, everything from the
 * start of that duplicate run to the end is removed.
 *
 * Pass 2 – Low-confidence sweep: removes remaining tail segments with
 * avg_logprob < -1.5 (model was highly uncertain).
 *
 * Pass 3 – Closing phrase detection: removes segments whose text ends
 * with a known Whisper end-of-audio hallucination phrase ("Thank you",
 * "Thanks for watching", etc.).
 */
function removeTrailingHallucinations(
    segments: TranscriptionSegment[],
): TranscriptionSegment[] {
    const TAIL_WINDOW = 8;
    let end = segments.length;

    // Pass 1: find the first consecutive duplicate pair in the tail window
    // and truncate everything from the start of that run to the end.
    const scanFrom = Math.max(0, end - TAIL_WINDOW);
    for (let i = scanFrom; i < end - 1; i++) {
        const a = segments[i].text.trim();
        const b = segments[i + 1].text.trim();
        if (a.length > 0 && a === b) {
            // Walk back to include all leading repetitions of the same text
            let runStart = i;
            while (
                runStart > 0 &&
                segments[runStart - 1].text.trim() === a
            ) {
                runStart--;
            }
            end = runStart;
            break;
        }
    }

    // Pass 2: remove any remaining tail segments where the model was
    // highly uncertain (avg_logprob very negative).
    while (end > 0) {
        const lp = segments[end - 1].avg_logprob ?? 0;
        if (lp < -1.5) {
            end--;
        } else {
            break;
        }
    }

    // Pass 3: remove segments whose text ends with a known Whisper
    // end-of-audio hallucination phrase, regardless of logprob.
    while (end > 0) {
        const text = segments[end - 1].text.trim();
        if (CLOSING_HALLUCINATION_PATTERNS.some((p) => p.test(text))) {
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
    const cleaned = removeTrailingHallucinations(beforeLoop);
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
