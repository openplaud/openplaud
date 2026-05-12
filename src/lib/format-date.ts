import {
    differenceInDays,
    format,
    formatDistanceToNow,
    isThisYear,
    isToday,
    isYesterday,
} from "date-fns";
import type { DateTimeFormat } from "@/types/common";

export type { DateTimeFormat };

export function formatDateTime(
    date: Date | string,
    formatType: DateTimeFormat = "relative",
): string {
    const dateObj = typeof date === "string" ? new Date(date) : date;

    switch (formatType) {
        case "relative":
            return formatDistanceToNow(dateObj, { addSuffix: true });
        case "absolute":
            return format(dateObj, "MMM d, yyyy h:mm a");
        case "iso":
            return dateObj.toISOString();
        default:
            return formatDistanceToNow(dateObj, { addSuffix: true });
    }
}

/**
 * Bucket a date into a human group label for the recording list.
 * Buckets are stable and ordered newest → oldest:
 *   Today | Yesterday | This week | Earlier this month |
 *   <Month> for older within this year | <Month YYYY> for previous years.
 * The current-year buckets omit the year because the section header
 * "this year" is implicit and adding `2025` to every label is noise.
 *
 * Callers should preserve their existing sort order; this function only
 * returns a label, it does not re-sort.
 */
export function dateGroupLabel(date: Date | string): string {
    const d = typeof date === "string" ? new Date(date) : date;
    if (isToday(d)) return "Today";
    if (isYesterday(d)) return "Yesterday";
    const now = new Date();
    const days = differenceInDays(now, d);
    if (days < 7) return "This week";
    if (
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear()
    ) {
        return "Earlier this month";
    }
    return isThisYear(d) ? format(d, "MMMM") : format(d, "MMMM yyyy");
}
