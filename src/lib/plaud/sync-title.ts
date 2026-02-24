/**
 * Returns true for recordings that were created locally (not synced from a
 * Plaud device), meaning they do not have a real Plaud file ID and cannot be
 * synced back to the device.
 *
 * Safe to import from client components — no server-side dependencies.
 */
export function isPlaudLocallyCreated(plaudFileId: string): boolean {
    return (
        plaudFileId.startsWith("split-") ||
        plaudFileId.startsWith("silence-removed-") ||
        plaudFileId.startsWith("uploaded-")
    );
}
