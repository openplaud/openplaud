import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { OpenAI } from "openai";
import { db } from "@/db";
import {
    apiCredentials,
    recordings,
    transcriptions,
    userSettings,
} from "@/db/schema";
import { decrypt } from "@/lib/encryption";
import { env } from "@/lib/env";
import { createUserStorageProvider } from "@/lib/storage/factory";
import { register, unregister } from "@/lib/transcription/abort-registry";
import {
    getResponseFormat,
    parseTranscriptionResponse,
} from "@/lib/transcription/format";
import { postProcessTranscription } from "@/lib/transcription/transcribe-recording";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClaimedJob {
    transcriptionId: string;
    recordingId: string;
    userId: string;
}

// ---------------------------------------------------------------------------
// Poll-loop state
// ---------------------------------------------------------------------------

let pollIntervalId: ReturnType<typeof setInterval> | null = null;
let running = false;

// ---------------------------------------------------------------------------
// Public API — lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the Postgres-backed background transcription worker.
 *
 * Safe to call multiple times (redundant calls are no-ops). Fires the first
 * tick immediately, then polls on an interval controlled by
 * {@link env.TRANSCRIPTION_WORKER_POLL_INTERVAL}.
 */
export function startWorker(): void {
    if (pollIntervalId !== null) return;

    console.log(
        `[TranscriptionWorker] Starting — poll every ${env.TRANSCRIPTION_WORKER_POLL_INTERVAL}ms, max ${env.TRANSCRIPTION_MAX_CONCURRENT} concurrent per user`,
    );

    pollIntervalId = setInterval(tick, env.TRANSCRIPTION_WORKER_POLL_INTERVAL);

    // Fire the first tick immediately so a freshly-booted instance doesn't
    // wait a full poll interval before processing jobs.
    void tick();
}

/**
 * Ensure the worker is running. Safe to call from any context (route
 * handler, instrumentation, etc). Redundant calls are no-ops.
 *
 * This is the primary mechanism for starting the worker in case the
 * instrumentation hook doesn't fire (e.g. during dev).
 */
let workerStarted = false;
export function ensureWorkerStarted(): void {
    if (workerStarted) return;
    workerStarted = true;

    console.log("[TranscriptionWorker] Ensuring worker is started...");
    runStartupRecovery()
        .then(() => startWorker())
        .catch((err) => {
            console.error("[TranscriptionWorker] Failed to start:", err);
            workerStarted = false;
        });
}

/**
 * Stop the background transcription worker (graceful shutdown).
 */
export function stopWorker(): void {
    if (pollIntervalId === null) return;
    clearInterval(pollIntervalId);
    pollIntervalId = null;
    console.log("[TranscriptionWorker] Stopped");
}

// ---------------------------------------------------------------------------
// Startup recovery
// ---------------------------------------------------------------------------

/**
 * Sweep rows that were left stuck in `processing` status by a previous
 * process crash or timeout.
 *
 * - Rows whose `locked_at` is older than {@link env.TRANSCRIPTION_JOB_TTL_MS}
 *   are considered stale.
 * - If `retry_count >=` {@link env.TRANSCRIPTION_MAX_RETRIES} the row is
 *   marked permanently `failed`.
 * - Otherwise it is reset to `pending` so the normal poll loop picks it up.
 */
export async function runStartupRecovery(): Promise<void> {
    const staleAt = new Date(Date.now() - env.TRANSCRIPTION_JOB_TTL_MS);

    const stale = await db
        .select()
        .from(transcriptions)
        .where(
            and(
                eq(transcriptions.status, "processing"),
                lt(transcriptions.lockedAt, staleAt),
            ),
        );

    if (stale.length === 0) {
        console.log(
            "[TranscriptionWorker] Startup recovery: no stale jobs found",
        );
        return;
    }

    console.log(
        `[TranscriptionWorker] Startup recovery: found ${stale.length} stale job(s)`,
    );

    for (const row of stale) {
        if (row.retryCount >= env.TRANSCRIPTION_MAX_RETRIES) {
            await db
                .update(transcriptions)
                .set({
                    status: "failed",
                    errorMessage: `Job timed out after ${row.retryCount} retries`,
                    lockedAt: null,
                })
                .where(eq(transcriptions.id, row.id));

            console.log(
                `[TranscriptionWorker] Recovery: job ${row.id} permanently failed (${row.retryCount} retries)`,
            );
        } else {
            const newRetryCount = row.retryCount + 1;
            await db
                .update(transcriptions)
                .set({
                    status: "pending",
                    lockedAt: null,
                    retryCount: newRetryCount,
                })
                .where(eq(transcriptions.id, row.id));

            console.log(
                `[TranscriptionWorker] Recovery: job ${row.id} reset to pending (retry ${newRetryCount}/${env.TRANSCRIPTION_MAX_RETRIES})`,
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------

/**
 * Single poll tick. Claims one job and processes it. Uses a `running` guard
 * so that long-running ticks don't pile up (setInterval is fire-and-forget).
 */
async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
        const job = await claimJob();
        if (!job) return;
        await processJob(job);
    } catch (error) {
        console.error("[TranscriptionWorker] Tick error:", error);
    } finally {
        running = false;
    }
}

// ---------------------------------------------------------------------------
// Claim — SELECT … FOR UPDATE SKIP LOCKED
// ---------------------------------------------------------------------------

/**
 * Atomically claim the oldest eligible transcription job.
 *
 * Eligible jobs are:
 * - `status = 'pending'`, OR
 * - `status = 'failed'` AND `retry_count < MAX_RETRIES`
 *
 * AND the parent recording is not tombstoned.
 *
 * Per-user concurrency is enforced: if the user already has
 * `MAX_CONCURRENT` rows in `processing` status the claim is skipped and
 * the lock released so another user's job can be picked up.
 */
async function claimJob(): Promise<ClaimedJob | null> {
    return db.transaction(async (tx) => {
        const rows = await tx
            .select({
                id: transcriptions.id,
                recordingId: transcriptions.recordingId,
                userId: transcriptions.userId,
            })
            .from(transcriptions)
            .innerJoin(
                recordings,
                and(
                    eq(transcriptions.recordingId, recordings.id),
                    isNull(recordings.deletedAt),
                ),
            )
            .where(
                and(
                    isNull(transcriptions.lockedAt),
                    or(
                        eq(transcriptions.status, "pending"),
                        and(
                            eq(transcriptions.status, "failed"),
                            lt(
                                transcriptions.retryCount,
                                env.TRANSCRIPTION_MAX_RETRIES,
                            ),
                        ),
                    ),
                ),
            )
            .orderBy(asc(transcriptions.createdAt))
            .limit(1)
            .for("update", { skipLocked: true });

        if (rows.length === 0) return null;

        const job = rows[0];

        // Per-user concurrency cap — count processing rows for this user.
        // The row we locked is still pending/failed so it won't inflate the
        // count.
        const processing = await tx
            .select({ count: sql<number>`count(*)` })
            .from(transcriptions)
            .where(
                and(
                    eq(transcriptions.userId, job.userId),
                    eq(transcriptions.status, "processing"),
                ),
            );

        if (
            Number(processing[0]?.count ?? 0) >=
            env.TRANSCRIPTION_MAX_CONCURRENT
        ) {
            return null; // releasing the lock (transaction rollback)
        }

        // Atomically mark the job as processing within the same transaction
        // so no other worker can grab it.
        await tx
            .update(transcriptions)
            .set({ status: "processing", lockedAt: new Date() })
            .where(
                and(
                    eq(transcriptions.id, job.id),
                    or(
                        eq(transcriptions.status, "pending"),
                        eq(transcriptions.status, "failed"),
                    ),
                ),
            );

        console.log(
            `[TranscriptionWorker] Claimed job ${job.id} → recording ${job.recordingId} (user ${job.userId})`,
        );

        return {
            transcriptionId: job.id,
            recordingId: job.recordingId,
            userId: job.userId,
        };
    });
}

// ---------------------------------------------------------------------------
// Process — the core transcription pipeline
// ---------------------------------------------------------------------------

async function processJob(job: ClaimedJob): Promise<void> {
    const { transcriptionId, recordingId, userId } = job;

    const controller = new AbortController();
    register(recordingId, controller);

    try {
        const [recording] = await db
            .select()
            .from(recordings)
            .where(
                and(
                    eq(recordings.id, recordingId),
                    eq(recordings.userId, userId),
                ),
            )
            .limit(1);

        if (!recording) throw new Error("Recording not found");

        const [credentials] = await db
            .select()
            .from(apiCredentials)
            .where(
                and(
                    eq(apiCredentials.userId, userId),
                    eq(apiCredentials.isDefaultTranscription, true),
                ),
            )
            .limit(1);

        if (!credentials) throw new Error("No transcription API configured");

        const [settings] = await db
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, userId))
            .limit(1);

        const defaultLanguage =
            settings?.defaultTranscriptionLanguage ?? undefined;

        const apiKey = decrypt(credentials.apiKey);
        const openai = new OpenAI({
            apiKey,
            baseURL: credentials.baseUrl || undefined,
        });

        console.log(
            `[TranscriptionWorker] Downloading audio for recording ${recordingId}`,
        );
        const storage = await createUserStorageProvider(userId);
        const audioBuffer = await storage.downloadFile(recording.storagePath);

        // Detect format from magic bytes (direct Buffer access, no copies)
        const isOgg =
            audioBuffer[0] === 0x4f &&
            audioBuffer[1] === 0x67 &&
            audioBuffer[2] === 0x67 &&
            audioBuffer[3] === 0x53;
        const audioBlob = new Blob([audioBuffer as unknown as BlobPart], {
            type: isOgg ? "audio/ogg" : "audio/mpeg",
        });

        const model = credentials.defaultModel || "whisper-1";
        const responseFormat = getResponseFormat(model);

        console.log(
            `[TranscriptionWorker] Calling ${model} for recording ${recordingId}`,
        );

        const transcription = await openai.audio.transcriptions.create(
            {
                file: audioBlob,
                model,
                response_format: responseFormat,
                ...(defaultLanguage ? { language: defaultLanguage } : {}),
            },
            { signal: controller.signal },
        );

        if (controller.signal.aborted) {
            console.log(
                `[TranscriptionWorker] Job ${transcriptionId} cancelled during API call`,
            );
            unregister(recordingId);
            return;
        }

        const { text: transcriptionText, detectedLanguage } =
            parseTranscriptionResponse(transcription, responseFormat);

        console.log(
            `[TranscriptionWorker] Got ${transcriptionText.length} chars of text for recording ${recordingId}`,
        );

        let wrote = false;
        await db.transaction(async (tx) => {
            // FOR UPDATE lock on the recording row to serialize with
            // concurrent DELETE (PR #72 pattern).
            const [active] = await tx
                .select({ id: recordings.id })
                .from(recordings)
                .where(
                    and(
                        eq(recordings.id, recordingId),
                        eq(recordings.userId, userId),
                        isNull(recordings.deletedAt),
                    ),
                )
                .for("update")
                .limit(1);

            if (!active) {
                console.log(
                    `[TranscriptionWorker] Recording ${recordingId} tombstoned — discarding result`,
                );
                return;
            }

            const [currentJob] = await tx
                .select({ status: transcriptions.status })
                .from(transcriptions)
                .where(eq(transcriptions.id, transcriptionId))
                .limit(1);

            if (!currentJob || currentJob.status !== "processing") {
                console.log(
                    `[TranscriptionWorker] Job ${transcriptionId} status is '${currentJob?.status ?? "gone"}' — discarding result`,
                );
                return;
            }

            await tx
                .update(transcriptions)
                .set({
                    text: transcriptionText,
                    detectedLanguage,
                    transcriptionType: "server",
                    provider: credentials.provider,
                    model,
                    status: "completed",
                    lockedAt: null,
                    createdAt: new Date(),
                })
                .where(eq(transcriptions.id, transcriptionId));

            wrote = true;
        });

        if (!wrote) return;

        unregister(recordingId);

        await postProcessTranscription(userId, recordingId, transcriptionText);

        console.log(
            `[TranscriptionWorker] Completed job ${transcriptionId} for recording ${recordingId}`,
        );
    } catch (error) {
        unregister(recordingId);

        if (controller.signal.aborted) {
            console.log(
                `[TranscriptionWorker] Job ${transcriptionId} cancelled`,
            );
            return;
        }

        const message =
            error instanceof Error
                ? error.message
                : "Unknown transcription error";

        console.error(
            `[TranscriptionWorker] Job ${transcriptionId} failed: ${message}`,
        );

        await db
            .update(transcriptions)
            .set({
                status: "failed",
                errorMessage: message,
                lockedAt: null,
                retryCount: sql`retry_count + 1`,
            })
            .where(eq(transcriptions.id, transcriptionId));
    }
}
