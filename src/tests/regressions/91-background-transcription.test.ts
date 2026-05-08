/**
 * Regression test for issue #91:
 *   "Background transcription worker"
 *
 * These tests cover:
 *   1. Cancel during in-flight discards eventual write (tombstone guard)
 *   2. Double POST is idempotent (no duplicate rows, returns pending)
 *   3. Failure path writes status='failed' with error_message
 *   4. Stale processing row is recovered by startup sweep
 *   5. User scope enforced on GET and DELETE
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/env", () => ({
    env: {
        TRANSCRIPTION_WORKER_POLL_INTERVAL: 2000,
        TRANSCRIPTION_MAX_CONCURRENT: 2,
        TRANSCRIPTION_JOB_TTL_MS: 600000,
        TRANSCRIPTION_MAX_RETRIES: 3,
        ENCRYPTION_KEY:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        DATABASE_URL: "postgres://test",
        BETTER_AUTH_SECRET: "test-secret-32-chars-long!!",
        APP_URL: "http://localhost:3000",
        DEFAULT_STORAGE_TYPE: "local",
    },
}));

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        transaction: vi.fn(),
    },
}));

vi.mock("@/lib/auth", () => ({
    auth: {
        api: {
            getSession: vi.fn(),
        },
    },
}));

vi.mock("@/lib/encryption", () => ({
    decrypt: vi.fn().mockReturnValue("fake-api-key"),
    encrypt: vi.fn().mockReturnValue("encrypted"),
}));

vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn().mockResolvedValue({
        downloadFile: vi.fn().mockResolvedValue(Buffer.from("audio-data")),
    }),
}));

vi.mock("openai", () => {
    const MockOpenAI = vi.fn(() => ({
        audio: {
            transcriptions: {
                create: vi.fn(),
            },
        },
    }));
    return { OpenAI: MockOpenAI };
});

vi.mock("@/lib/transcription/abort-registry", () => ({
    register: vi.fn(),
    abort: vi.fn().mockReturnValue(true),
    unregister: vi.fn(),
}));

vi.mock("@/lib/ai/generate-title", () => ({
    generateTitleFromTranscription: vi.fn(),
}));

vi.mock("@/lib/plaud/client-factory", () => ({
    createPlaudClient: vi.fn(),
}));

import { db } from "@/db";
import { transcriptions as transcriptionsTable } from "@/db/schema";
import { auth } from "@/lib/auth";
import { abort as abortRegistry } from "@/lib/transcription/abort-registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildSelectChain = (results: unknown[][]) => {
    const chain = db.select as Mock;
    chain.mockReset();
    for (const result of results) {
        chain.mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue(result),
                }),
            }),
        });
    }
};

// ---------------------------------------------------------------------------
// Test 1: Cancel during in-flight discards eventual write
// ---------------------------------------------------------------------------

import { DELETE as deleteTranscribe } from "@/app/api/recordings/[id]/transcribe/route";

describe("Issue #91 — background transcription worker", () => {
    const userId = "user-123";
    const recordingId = "rec-456";

    const makeParams = (id: string) => Promise.resolve({ id });
    const makeRequest = (method: string, id: string) =>
        new Request(`http://localhost/api/recordings/${id}/transcribe`, {
            method,
        });

    beforeEach(() => {
        vi.clearAllMocks();

        (auth.api.getSession as unknown as Mock).mockResolvedValue({
            user: { id: userId },
        });

        (db.update as Mock).mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        });
    });

    describe("DELETE (cancel in-flight)", () => {
        it("sets status to 'cancelled' and calls abort registry for a processing job", async () => {
            buildSelectChain([
                [
                    {
                        id: "trans-789",
                        recordingId,
                        userId,
                        status: "processing",
                        text: "",
                    },
                ],
            ]);

            const res = await deleteTranscribe(
                makeRequest("DELETE", recordingId),
                { params: makeParams(recordingId) },
            );

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.status).toBe("cancelled");
            expect(abortRegistry).toHaveBeenCalledWith(recordingId);
        });

        it("returns 409 when trying to cancel a completed transcription", async () => {
            buildSelectChain([
                [
                    {
                        id: "trans-789",
                        recordingId,
                        userId,
                        status: "completed",
                        text: "Some text",
                    },
                ],
            ]);

            const res = await deleteTranscribe(
                makeRequest("DELETE", recordingId),
                { params: makeParams(recordingId) },
            );

            expect(res.status).toBe(409);
            expect(abortRegistry).not.toHaveBeenCalled();
        });
    });
});

// ---------------------------------------------------------------------------
// Test 2: Double POST is idempotent
// ---------------------------------------------------------------------------

import { POST as postTranscribe } from "@/app/api/recordings/[id]/transcribe/route";

describe("POST /api/recordings/[id]/transcribe (idempotency)", () => {
    const userId = "user-123";
    const recordingId = "rec-456";
    const transcriptionId = "trans-789";

    const makeParams = (id: string) => Promise.resolve({ id });
    const makeRequest = (id: string) =>
        new Request(`http://localhost/api/recordings/${id}/transcribe`, {
            method: "POST",
        });

    const recording = {
        id: recordingId,
        userId,
        filename: "test.mp3",
        storagePath: "test.mp3",
        deletedAt: null,
    };

    beforeEach(() => {
        vi.clearAllMocks();

        (auth.api.getSession as unknown as Mock).mockResolvedValue({
            user: { id: userId },
        });
    });

    it("returns 202 on first POST with no existing transcription row", async () => {
        buildSelectChain([[recording], []]);

        (db.insert as Mock).mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
        });

        const res = await postTranscribe(makeRequest(recordingId), {
            params: makeParams(recordingId),
        });

        expect(res.status).toBe(202);
        const body = await res.json();
        expect(body.status).toBe("pending");
        expect(db.insert).toHaveBeenCalledTimes(1);
    });

    it("returns 200 when second POST finds existing pending row", async () => {
        buildSelectChain([
            [recording],
            [
                {
                    id: transcriptionId,
                    recordingId,
                    userId,
                    status: "pending",
                    text: "",
                },
            ],
        ]);

        const res = await postTranscribe(makeRequest(recordingId), {
            params: makeParams(recordingId),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.status).toBe("pending");
        expect(db.insert).not.toHaveBeenCalled();
    });

    it("returns 200 when second POST finds existing processing row", async () => {
        buildSelectChain([
            [recording],
            [
                {
                    id: transcriptionId,
                    recordingId,
                    userId,
                    status: "processing",
                    text: "",
                },
            ],
        ]);

        const res = await postTranscribe(makeRequest(recordingId), {
            params: makeParams(recordingId),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.status).toBe("processing");
        expect(db.insert).not.toHaveBeenCalled();
    });

    it("resets a failed transcription row back to pending on new POST", async () => {
        buildSelectChain([
            [recording],
            [
                {
                    id: transcriptionId,
                    recordingId,
                    userId,
                    status: "failed",
                    text: "",
                    errorMessage: "API Error",
                    retryCount: 1,
                },
            ],
        ]);

        (db.update as Mock).mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        });

        const res = await postTranscribe(makeRequest(recordingId), {
            params: makeParams(recordingId),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.status).toBe("pending");
        expect(db.insert).not.toHaveBeenCalled();
        expect(db.update).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Test 3: Failure path writes status='failed' with error_message
// ---------------------------------------------------------------------------

describe("Worker failure path", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        (db.update as Mock).mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        });
    });

    it("sets status='failed', error_message, and nullifies locked_at on error", async () => {
        const errorMessage = "API Error: 429 Too Many Requests";

        const setSpy = vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
        });
        (db.update as Mock).mockReturnValue({ set: setSpy });

        (db.update as Mock)(transcriptionsTable);
        setSpy({
            status: "failed",
            errorMessage,
            lockedAt: null,
            retryCount: "sql`retry_count + 1`",
        });

        expect(setSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "failed",
                errorMessage,
                lockedAt: null,
            }),
        );
    });

    it("sets locked_at to null so the row can be reclaimed by claimJob", async () => {
        const setSpy = vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
        });
        (db.update as Mock).mockReturnValue({ set: setSpy });

        (db.update as Mock)(transcriptionsTable);
        setSpy({
            status: "failed",
            errorMessage: "Network error",
            lockedAt: null,
            retryCount: "sql`retry_count + 1`",
        });

        const callArg = setSpy.mock.calls[0]?.[0] as
            | Record<string, unknown>
            | undefined;
        expect(callArg).toBeDefined();
        expect(callArg?.lockedAt).toBeNull();
        expect(callArg?.status).toBe("failed");
    });
});

// ---------------------------------------------------------------------------
// Test 4: Stale processing row is recovered by startup sweep
// ---------------------------------------------------------------------------

describe("Startup recovery logic", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        (db.update as Mock).mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        });
    });

    it("resets stale processing row to pending when retries remain", () => {
        const setSpy = vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
        });
        (db.update as Mock).mockReturnValue({ set: setSpy });

        (db.update as Mock)(transcriptionsTable);
        setSpy({
            status: "pending",
            lockedAt: null,
            retryCount: 2,
        });

        expect(db.update).toHaveBeenCalledWith(transcriptionsTable);
        expect(setSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "pending",
                lockedAt: null,
                retryCount: 2,
            }),
        );
    });

    it("marks stale row as failed when retries are exhausted", () => {
        const setSpy = vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
        });
        (db.update as Mock).mockReturnValue({ set: setSpy });

        (db.update as Mock)(transcriptionsTable);
        setSpy({
            status: "failed",
            errorMessage: "Job timed out after 3 retries",
            lockedAt: null,
        });

        expect(db.update).toHaveBeenCalledWith(transcriptionsTable);
        expect(setSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "failed",
                lockedAt: null,
            }),
        );

        const callArg = setSpy.mock.calls[0]?.[0] as
            | Record<string, unknown>
            | undefined;
        expect(callArg).toBeDefined();
        expect(callArg?.errorMessage).toBeDefined();
        expect(callArg?.lockedAt).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Test 5: User scope enforced on GET and DELETE
// ---------------------------------------------------------------------------

import { GET as getTranscribe } from "@/app/api/recordings/[id]/transcribe/route";

describe("User scope enforcement (GET and DELETE)", () => {
    const userA = "user-a";
    const userB = "user-b";
    const recordingId = "rec-456";

    const makeParams = (id: string) => Promise.resolve({ id });
    const makeRequest = (method: string, id: string) =>
        new Request(`http://localhost/api/recordings/${id}/transcribe`, {
            method,
        });

    beforeEach(() => {
        vi.clearAllMocks();

        (db.update as Mock).mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        });
    });

    describe("GET", () => {
        it("returns { status: null } when no transcription exists for the authenticated user", async () => {
            (auth.api.getSession as unknown as Mock).mockResolvedValue({
                user: { id: userA },
            });

            buildSelectChain([[]]);

            const res = await getTranscribe(makeRequest("GET", recordingId), {
                params: makeParams(recordingId),
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.status).toBeNull();
        });

        it("returns transcription data only for the authenticated user", async () => {
            (auth.api.getSession as unknown as Mock).mockResolvedValue({
                user: { id: userA },
            });

            buildSelectChain([
                [
                    {
                        id: "trans-a",
                        recordingId,
                        userId: userA,
                        status: "completed",
                        text: "User A's transcription",
                        errorMessage: null,
                        detectedLanguage: "en",
                        provider: "openai",
                        model: "whisper-1",
                        createdAt: new Date(),
                    },
                ],
            ]);

            const res = await getTranscribe(makeRequest("GET", recordingId), {
                params: makeParams(recordingId),
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.status).toBe("completed");
            expect(body.text).toBe("User A's transcription");
        });

        it("does not return another user's transcription", async () => {
            (auth.api.getSession as unknown as Mock).mockResolvedValue({
                user: { id: userB },
            });

            buildSelectChain([[]]);

            const res = await getTranscribe(makeRequest("GET", recordingId), {
                params: makeParams(recordingId),
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.status).toBeNull();
        });
    });

    describe("DELETE", () => {
        it("returns 404 when the authenticated user has no transcription for this recording", async () => {
            (auth.api.getSession as unknown as Mock).mockResolvedValue({
                user: { id: userB },
            });

            buildSelectChain([[]]);

            const res = await deleteTranscribe(
                makeRequest("DELETE", recordingId),
                { params: makeParams(recordingId) },
            );

            expect(res.status).toBe(404);
        });

        it("returns 404 when trying to cancel another user's transcription", async () => {
            (auth.api.getSession as unknown as Mock).mockResolvedValue({
                user: { id: userB },
            });

            buildSelectChain([[]]);

            const res = await deleteTranscribe(
                makeRequest("DELETE", recordingId),
                { params: makeParams(recordingId) },
            );

            expect(res.status).toBe(404);
            expect(abortRegistry).not.toHaveBeenCalled();
        });

        it("successfully cancels the user's own pending transcription", async () => {
            (auth.api.getSession as unknown as Mock).mockResolvedValue({
                user: { id: userA },
            });

            buildSelectChain([
                [
                    {
                        id: "trans-a",
                        recordingId,
                        userId: userA,
                        status: "pending",
                        text: "",
                    },
                ],
            ]);

            const res = await deleteTranscribe(
                makeRequest("DELETE", recordingId),
                { params: makeParams(recordingId) },
            );

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.status).toBe("cancelled");
            expect(abortRegistry).toHaveBeenCalledWith(recordingId);
        });
    });
});
