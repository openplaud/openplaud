/**
 * Next.js instrumentation hook.
 *
 * Runs once when the server starts. Boots the background transcription
 * worker and sweeps any rows left stuck in `processing` from a previous
 * crash. The worker runs in-process for self-host; architecture allows
 * extracting to a dedicated process later (see AGENTS.md hosted-mode
 * invariants).
 */
export async function register() {
    const { startWorker, runStartupRecovery } = await import(
        "@/lib/transcription/worker"
    );

    console.log("[Instrumentation] Running startup recovery sweep...");
    await runStartupRecovery();

    console.log("[Instrumentation] Starting transcription worker...");
    startWorker();
}
