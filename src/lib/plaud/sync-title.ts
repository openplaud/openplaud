/**
 * Returns true when the plaudFileId belongs to a recording that was created
 * locally (upload, split, or silence-removal) rather than synced from the
 * Plaud cloud API.  Locally-created recordings cannot be synced back to Plaud
 * because they have no corresponding server-side file ID.
 */
export function isPlaudLocallyCreated(plaudFileId: string): boolean {
    return (
        plaudFileId.startsWith("uploaded-") ||
        plaudFileId.startsWith("split-") ||
        plaudFileId.startsWith("silence-removed-")
    );
}
