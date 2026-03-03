/**
 * Post-processing for Whisper/faster-whisper transcription output.
 *
 * Whisper (and compatible models) can enter "hallucination loops" where
 * a phrase is repeated hundreds of times. Three complementary strategies
 * are applied:
 *
 * 1. Segment loop truncation: verbose_json segments include a
 *    compression_ratio metric that spikes sharply (5+) at the point
 *    where Whisper enters a hallucination loop. Everything from the
 *    first loop segment onwards is discarded; content before it is kept.
 *
 * 2. Trailing hallucination removal: two signal-based passes over the
 *    final segments:
 *    Pass 1 – consecutive duplicate text (mini-loop detection).
 *    Pass 2 – very negative avg_logprob (high model uncertainty).
 *    Pass 3 – low speech density: segments that span many seconds but
 *    contain very few words indicate the model was filling silence.
 *    Normal speech runs at ~1.5–3 words/second; trailing hallucinations
 *    during end-of-audio silence are typically well below 0.5 w/s.
 *
 * 3. Text-based repetition removal: a sliding-window scan detects
 *    consecutive phrase repetitions in the final text and truncates
 *    at the first loop, acting as a safety net when quality metrics
 *    are absent or insufficient.
 */

interface TranscriptionSegment {
    text: string;
    start?: number;
    end?: number;
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
        if (
            (segments[i].compression_ratio ?? 0) >
            LOOP_COMPRESSION_RATIO_THRESHOLD
        ) {
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
 * Pass 3 – Speech density: removes tail segments where the model
 * generated very few words over a long time span (< 0.5 words/second
 * over at least 5 seconds), which indicates hallucination during
 * end-of-audio silence or music.
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
            while (runStart > 0 && segments[runStart - 1].text.trim() === a) {
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

    // Pass 3: remove tail segments with abnormally low speech density.
    // Only applies to very short phrases (≤ 4 words): legitimate song
    // endings almost always contain more words than hallucinated fillers
    // ("For Three", "Thank you", "Mmm"). A slow singer can produce 6 words
    // in 12 seconds (0.5 w/s) — the same density as silence hallucinations
    // — so we must not penalise longer phrases.
    while (end > 0) {
        const seg = segments[end - 1];
        const segStart = seg.start;
        const segEnd = seg.end;
        if (segStart !== undefined && segEnd !== undefined) {
            const duration = segEnd - segStart;
            const wordCount = seg.text
                .trim()
                .split(/\s+/)
                .filter((w) => w.length > 0).length;
            if (wordCount <= 4 && duration >= 5 && wordCount / duration < 0.5) {
                end--;
                continue;
            }
        }
        break;
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
    return cleaned
        .map((s) => s.text)
        .join("")
        .trim();
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
        [4, 8, 4], // medium phrases      — require 4+ consecutive repetitions
        [9, 20, 3], // long phrases        — require 3+ consecutive repetitions
    ];

    for (const [minW, maxW, minReps] of tiers) {
        for (let w = minW; w <= maxW; w++) {
            if (words.length < w * minReps) continue;

            // Scan from the end of the text so we find the last (trailing)
            // repetition loop first. This avoids false-positive truncation
            // of legitimate repeated content earlier in the text.
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

                if (reps >= minReps && pos >= words.length - w) {
                    // Keep only the first occurrence; the loop reaches the end
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
                s.avg_logprob !== undefined ||
                s.start !== undefined,
        );

        if (hasMetrics) {
            const filtered = filterSegmentsByQuality(segments);
            // Fall back to rawText if the segment quality filter discards
            // everything (e.g. the very first segment has compression_ratio > 5).
            // An empty transcription is far less useful than a potentially
            // hallucination-containing one that the user can review manually.
            text = filtered.length > 0 ? filtered : rawText;
        }
    }

    // Always run the text-based detector as a final safety net
    return removeRepetitions(text);
}
