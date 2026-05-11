/**
 * Format a duration in seconds for display in the player, list, and
 * tooltips. Adapts the precision to the length so we don't pad short
 * recordings with leading zeros, but switch to H:MM:SS the moment we
 * cross the hour boundary.
 *
 *   < 1 hour  -> "M:SS"   (e.g. "0:42", "5:23")
 *   >= 1 hour -> "H:MM:SS" (e.g. "1:05:23", "12:00:00")
 *
 * Non-finite or negative inputs collapse to "0:00" so we never render
 * "NaN:NaN" while metadata is loading.
 */
export function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad2 = (n: number) => n.toString().padStart(2, "0");
    if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`;
    return `${m}:${pad2(s)}`;
}

/** Convenience wrapper for callers that hold a milliseconds value. */
export function formatDurationMs(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return "0:00";
    return formatDuration(ms / 1000);
}
