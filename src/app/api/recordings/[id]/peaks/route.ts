import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

type IdContext = { params: Promise<{ id: string }> };

// Hard caps on the payload — peaks are a visualization aid, not a
// general-purpose blob store. 8 KB JSON is plenty for 1000 floats
// rounded to 3 decimals.
const MAX_PEAKS = 2048;
const MIN_PEAKS = 32;

/**
 * Store waveform peaks for a recording, decoded client-side on first
 * listen. Idempotent: the write is gated on `waveform_peaks IS NULL`,
 * so two tabs racing both POST the same value but only the first
 * commits. Subsequent POSTs return 200 with `{ stored: false }` rather
 * than overwriting — the client renders the existing peaks anyway.
 *
 * User-scoped: the `userId` predicate is the only thing preventing a
 * malicious client from poisoning another user's waveform. Do not
 * remove it.
 */
export const POST = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        throw new AppError(ErrorCode.INVALID_INPUT, "Invalid JSON body", 400);
    }

    const peaks =
        body && typeof body === "object" && "peaks" in body
            ? (body as { peaks: unknown }).peaks
            : null;

    if (!Array.isArray(peaks)) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "Expected { peaks: number[] }",
            400,
        );
    }

    if (peaks.length < MIN_PEAKS || peaks.length > MAX_PEAKS) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            `peaks must contain between ${MIN_PEAKS} and ${MAX_PEAKS} values`,
            400,
        );
    }

    // Normalize + validate every entry. Out-of-range or non-finite values
    // suggest a buggy or malicious client; reject the whole payload.
    const normalized: number[] = [];
    for (const v of peaks) {
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                "peaks must be finite numbers in [0, 1]",
                400,
            );
        }
        // Round to 3 decimals to keep the JSON compact. Visually
        // indistinguishable; cuts payload size roughly in half.
        normalized.push(Math.round(v * 1000) / 1000);
    }

    // Verify the recording exists and belongs to the caller before
    // attempting the conditional update. The combined predicate also
    // serves as the user-scope guard.
    const [recording] = await db
        .select({ id: recordings.id, waveformPeaks: recordings.waveformPeaks })
        .from(recordings)
        .where(
            and(
                eq(recordings.id, id),
                eq(recordings.userId, session.user.id),
                isNull(recordings.deletedAt),
            ),
        )
        .limit(1);

    if (!recording) {
        throw new AppError(
            ErrorCode.RECORDING_NOT_FOUND,
            "Recording not found",
            404,
        );
    }

    if (recording.waveformPeaks) {
        // Already populated — treat as success but signal we kept the
        // existing data. Client can simply ignore the response body.
        return NextResponse.json({ stored: false });
    }

    // Conditional write: only set peaks if still NULL **and** the
    // recording hasn't been deleted in the meantime. Both predicates
    // sit on the UPDATE itself so a concurrent DELETE that flips
    // `deletedAt` between our SELECT above and this UPDATE simply
    // matches zero rows — we never resurrect a tombstoned recording
    // by writing peaks to it. No transaction needed; one statement
    // does the check-and-write atomically.
    const result = await db
        .update(recordings)
        .set({ waveformPeaks: normalized, updatedAt: new Date() })
        .where(
            and(
                eq(recordings.id, id),
                eq(recordings.userId, session.user.id),
                isNull(recordings.deletedAt),
                sql`${recordings.waveformPeaks} is null`,
            ),
        );

    // postgres-js / drizzle update returns no rowCount by default on
    // some drivers; just treat the call as success either way. The
    // client never depends on which branch ran.
    void result;

    return NextResponse.json({ stored: true });
});
