"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export interface SummaryData {
    summary: string | null;
    keyPoints: string[] | null;
    actionItems: string[] | null;
    provider?: string;
    model?: string;
}

interface UseTranscriptionSummaryOptions {
    /** Recording id used for `/api/recordings/:id/summary` requests. */
    recordingId: string | null | undefined;
    /**
     * Latest transcription text. When this changes we drop the cached
     * summary (stale relative to the new text) and re-fetch -- the
     * server may have already auto-summarized after a re-transcribe.
     */
    transcriptionText: string | null | undefined;
}

/**
 * Shared summary state for the transcription views. Both the dashboard
 * (`TranscriptionPanel`) and the recording detail page
 * (`recordings/TranscriptionSection`) use the same endpoints with the
 * same expand/preset/optimistic-delete UX -- only the visual chrome
 * differs.
 *
 * Returns flat state + handlers; callers compose their own JSX so the
 * dashboard's shadcn `Card`/`Button` look and the recording page's
 * `Panel`/`MetalButton` look stay distinct on purpose.
 */
export function useTranscriptionSummary({
    recordingId,
    transcriptionText,
}: UseTranscriptionSummaryOptions) {
    const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [summaryExpanded, setSummaryExpanded] = useState(true);
    const [summaryPreset, setSummaryPreset] = useState("general");

    // Re-fetch trigger separate from the URL/id key so callers can
    // bump it imperatively (e.g. right after a re-transcribe finishes,
    // before the new text has propagated through props).
    const [summaryFetchKey, setSummaryFetchKey] = useState(0);

    // Detect when transcription text actually changes -> invalidate
    // the cached summary so the next fetch lands fresh. We compare
    // through a ref because the dashboard variant receives the text
    // via prop (parent-owned), and reading prop-vs-state isn't enough
    // to spot a stale summary.
    const transcriptionTextRef = useRef(transcriptionText);
    if (transcriptionText !== transcriptionTextRef.current) {
        transcriptionTextRef.current = transcriptionText;
        setSummaryFetchKey((k) => k + 1);
        setSummaryData(null);
    }

    // Fetch when recording id changes or the re-fetch key bumps.
    // biome-ignore lint/correctness/useExhaustiveDependencies: summaryFetchKey is an intentional re-fetch trigger
    useEffect(() => {
        if (!recordingId) {
            setSummaryData(null);
            return;
        }
        const controller = new AbortController();
        fetch(`/api/recordings/${recordingId}/summary`, {
            signal: controller.signal,
        })
            .then((res) => res.json())
            .then((data) => {
                if (data.summary) {
                    setSummaryData(data);
                } else {
                    setSummaryData(null);
                }
            })
            .catch(() => {});
        return () => controller.abort();
    }, [recordingId, summaryFetchKey]);

    const handleSummarize = useCallback(async () => {
        if (!recordingId) return;
        setIsSummarizing(true);
        try {
            const response = await fetch(
                `/api/recordings/${recordingId}/summary`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ preset: summaryPreset }),
                },
            );
            if (response.ok) {
                const data = (await response.json()) as SummaryData;
                setSummaryData(data);
                toast.success("Summary generated");
            } else {
                const error = await response.json().catch(() => ({}));
                toast.error(error.error || "Summary generation failed");
            }
        } catch {
            toast.error("Failed to generate summary");
        } finally {
            setIsSummarizing(false);
        }
    }, [recordingId, summaryPreset]);

    const handleDeleteSummary = useCallback(async () => {
        if (!recordingId) return;
        // Optimistic delete -- the summary disappears immediately and
        // only comes back if the server rejects the request.
        const previous = summaryData;
        setSummaryData(null);

        try {
            const response = await fetch(
                `/api/recordings/${recordingId}/summary`,
                { method: "DELETE" },
            );
            if (response.ok) {
                toast.success("Summary deleted");
            } else {
                setSummaryData(previous);
                toast.error("Failed to delete summary");
            }
        } catch {
            setSummaryData(previous);
            toast.error("Failed to delete summary");
        }
    }, [recordingId, summaryData]);

    /**
     * Imperative re-fetch trigger. Use after a re-transcribe call
     * where the server may already have re-summarized -- bumping the
     * key forces a GET without changing recordingId.
     */
    const refetchSummary = useCallback(() => {
        setSummaryData(null);
        setSummaryFetchKey((k) => k + 1);
    }, []);

    return {
        summaryData,
        isSummarizing,
        summaryExpanded,
        setSummaryExpanded,
        summaryPreset,
        setSummaryPreset,
        handleSummarize,
        handleDeleteSummary,
        refetchSummary,
    };
}
