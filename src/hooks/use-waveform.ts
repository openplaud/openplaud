"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    AUTO_DECODE_MAX_MS,
    DEFAULT_BUCKETS,
    decodePeaks,
} from "@/lib/audio/waveform";

type Status = "idle" | "decoding" | "ready" | "error" | "skipped";

interface UseWaveformArgs {
    recordingId: string;
    durationMs: number;
    /** Peaks already known server-side. When truthy, we skip decode. */
    initialPeaks: number[] | null;
    /**
     * When false, decode does not auto-start regardless of duration.
     * Used while the user has the manual button visible for long
     * recordings.
     */
    autoStart?: boolean;
}

interface UseWaveformResult {
    peaks: number[] | null;
    status: Status;
    /** Trigger decode manually (long recordings or after a prior failure). */
    decode: () => void;
}

/**
 * Decode + cache the waveform for a single recording. Idempotent across
 * tab focus changes and recording switches; in-flight network fetches
 * are aborted via AbortController on switch / unmount, but the CPU-bound
 * `decodePeaks()` itself is not interruptible — once decoding starts we
 * let it finish and drop the result if the recording id has changed or
 * the component unmounted (the stale-result guards below). In practice
 * the decode is bounded by AUTO_DECODE_MAX_MS and runs off-main-thread
 * in modern browsers, so the wasted work is small.
 */
export function useWaveform({
    recordingId,
    durationMs,
    initialPeaks,
    autoStart = true,
}: UseWaveformArgs): UseWaveformResult {
    const [peaks, setPeaks] = useState<number[] | null>(initialPeaks);
    const [status, setStatus] = useState<Status>(
        initialPeaks ? "ready" : "idle",
    );

    // Track the in-flight recording id so a late-arriving decode result
    // for a previously-selected recording doesn't clobber the current
    // one's peaks.
    const currentIdRef = useRef(recordingId);
    const abortRef = useRef<AbortController | null>(null);

    // Reset state when the selected recording changes. The previous
    // decode (if any) is aborted to free CPU + memory. We intentionally
    // omit `initialPeaks` from the dep list — its identity changes per
    // render but its value is a stable per-recording server response;
    // reacting to it would loop after we POST peaks back and the
    // parent's router.refresh() re-supplies them.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
    useEffect(() => {
        currentIdRef.current = recordingId;
        abortRef.current?.abort();
        abortRef.current = null;
        setPeaks(initialPeaks);
        setStatus(initialPeaks ? "ready" : "idle");
    }, [recordingId]);

    // Unmount cleanup: abort any in-flight fetch so we don't keep
    // bytes flowing into a component that's gone. The recording-switch
    // effect above only fires on dep change — it does not run on the
    // final unmount, so without this hook a decode started seconds
    // before unmount would still resolve and call setPeaks on a
    // dead component (React 19 swallows the warning, but the network
    // and CPU work is still wasted).
    useEffect(() => {
        return () => {
            abortRef.current?.abort();
            abortRef.current = null;
        };
    }, []);

    const runDecode = useCallback(async () => {
        const id = recordingId;
        const controller = new AbortController();
        abortRef.current?.abort();
        abortRef.current = controller;

        setStatus("decoding");
        try {
            const res = await fetch(`/api/recordings/${id}/audio`, {
                signal: controller.signal,
            });
            if (!res.ok) throw new Error(`Audio fetch failed: ${res.status}`);
            const buf = await res.arrayBuffer();
            if (controller.signal.aborted) return;

            const { peaks: decoded } = await decodePeaks(buf, DEFAULT_BUCKETS);
            if (controller.signal.aborted) return;
            // Stale-result guard: if the user switched recordings while
            // we were decoding, drop the result rather than overwrite
            // the new selection's peaks.
            if (currentIdRef.current !== id) return;

            setPeaks(decoded);
            setStatus("ready");

            // Best-effort persistence. Failures here are harmless — the
            // user sees the waveform this session; the next listener
            // will redecode. Don't surface to the UI.
            fetch(`/api/recordings/${id}/peaks`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ peaks: decoded }),
            }).catch(() => {});
        } catch (err) {
            if (controller.signal.aborted) return;
            if (currentIdRef.current !== id) return;
            // Log to console for self-host debugging but never toast —
            // waveform absence is a graceful degradation, not an error
            // the user needs to act on.
            console.warn("Waveform decode failed:", err);
            setStatus("error");
        }
    }, [recordingId]);

    // Auto-start: short recordings decode automatically; longer ones
    // wait for a user gesture (the "Generate waveform" button).
    useEffect(() => {
        if (!autoStart) return;
        if (peaks) return;
        if (status !== "idle") return;
        if (durationMs > AUTO_DECODE_MAX_MS) {
            setStatus("skipped");
            return;
        }
        runDecode();
    }, [autoStart, peaks, status, durationMs, runDecode]);

    return { peaks, status, decode: runDecode };
}
