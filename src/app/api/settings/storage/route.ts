import { promises as fsp } from "node:fs";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
// `sql` is retained for the totals aggregate; the monthly series was
// dropped after v1 dogfooding showed a near-flat chart for typical
// usage. Re-add when there's a real signal to surface.
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { decryptText } from "@/lib/encryption/fields";
import { env } from "@/lib/env";
import { apiHandler } from "@/lib/errors";

/**
 * Storage usage endpoint backing the Settings → Storage section.
 *
 * Shape is shared between self-host (local / S3) and hosted. Internal
 * API — not a contract; the only caller is `storage-section.tsx`.
 *
 * Field design notes:
 * - `storageType` is "hosted" when IS_HOSTED is true. Hosted users
 *   shouldn't see whether the backend is local or S3 (irrelevant to
 *   them and a minor cross-tenant info hint).
 * - `diskFreeBytes` is set only for self-host + local; null elsewhere.
 *   Sourced from fs.statfs on the configured LOCAL_STORAGE_PATH.
 * - `quotaBytes` is always null today. Reserved as the seam for a
 *   future per-account quota; the client capacity-bar lights up when
 *   it becomes a number.
 * - `largestRecordings` decrypts filenames at the edge (same as
 *   /api/recordings) since they're encrypted at rest.
 */
export const GET = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);
    const userId = session.user.id;

    const activeRecording = and(
        eq(recordings.userId, userId),
        isNull(recordings.deletedAt),
    );

    // Totals — single aggregate query instead of pulling rows into JS.
    const [totals] = await db
        .select({
            usedBytes: sql<number>`coalesce(sum(${recordings.filesize}), 0)::bigint`,
            recordingCount: sql<number>`count(*)::int`,
            totalDurationMs: sql<number>`coalesce(sum(${recordings.duration}), 0)::bigint`,
        })
        .from(recordings)
        .where(activeRecording);

    // Top 5 largest active recordings. Surfaced so users can act on
    // storage from this page (the link target is the recording detail).
    const largestRows = await db
        .select({
            id: recordings.id,
            filename: recordings.filename,
            filesize: recordings.filesize,
            duration: recordings.duration,
            startTime: recordings.startTime,
        })
        .from(recordings)
        .where(activeRecording)
        .orderBy(desc(recordings.filesize))
        .limit(5);
    const largest = largestRows.map((r) => ({
        ...r,
        filename: decryptText(r.filename),
    }));

    // Disk-free is meaningful only for self-host + local. Reading the
    // host disk on hosted would leak cross-tenant capacity hints and is
    // useless to hosted users anyway.
    let diskFreeBytes: number | null = null;
    let storageType: string = env.DEFAULT_STORAGE_TYPE;
    if (env.IS_HOSTED) {
        storageType = "hosted";
    } else if (env.DEFAULT_STORAGE_TYPE === "local") {
        try {
            const stat = await fsp.statfs(env.LOCAL_STORAGE_PATH);
            diskFreeBytes = Number(stat.bavail) * Number(stat.bsize);
            if (!Number.isFinite(diskFreeBytes) || diskFreeBytes < 0) {
                diskFreeBytes = null;
            }
        } catch {
            // Path may not exist yet (no recordings synced) or statfs
            // unsupported. Hide the capacity bar rather than failing.
            diskFreeBytes = null;
        }
    }

    return NextResponse.json({
        storageType,
        usedBytes: Number(totals?.usedBytes ?? 0),
        recordingCount: Number(totals?.recordingCount ?? 0),
        totalDurationMs: Number(totals?.totalDurationMs ?? 0),
        largest,
        diskFreeBytes,
        // Seam for future per-account quotas. Always null today; copy
        // and layout deliberately avoid hinting at plans/tiers.
        quotaBytes: null as number | null,
    });
});
