/**
 * In-memory AbortController registry for cross-request cancellation.
 *
 * When a transcription job is being processed (OpenAI call in flight),
 * the worker registers its AbortController keyed by recordingId. The
 * DELETE handler on the transcribe route calls abort() to signal the
 * in-flight request, then sets the DB row to 'cancelled' so the worker
 * detects the cancelled status on next checkpoint.
 *
 * This only works within the same process. Cross-process cancellation
 * relies on the worker detecting status='cancelled' at its next DB
 * checkpoint.
 */

const controllers = new Map<string, AbortController>();

/**
 * Register an AbortController for a recording's in-flight transcription.
 * Overwrites any previous controller for the same recordingId.
 */
export function register(
    recordingId: string,
    controller: AbortController,
): void {
    controllers.set(recordingId, controller);
}

/**
 * Abort the in-flight transcription for a recording.
 * Returns true if a controller was found and aborted, false otherwise.
 */
export function abort(recordingId: string): boolean {
    const controller = controllers.get(recordingId);
    if (!controller) return false;
    controller.abort();
    return true;
}

/**
 * Remove a controller from the registry after the transcription completes
 * or errors out (the worker should call this before exiting).
 */
export function unregister(recordingId: string): void {
    controllers.delete(recordingId);
}
