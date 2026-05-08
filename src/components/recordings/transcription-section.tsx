"use client";

import {
    ChevronDown,
    ChevronUp,
    ListChecks,
    Loader2,
    RefreshCw,
    Sparkles,
    Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { LEDIndicator } from "@/components/led-indicator";
import { MetalButton } from "@/components/metal-button";
import { Panel } from "@/components/panel";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useTranscriptionPolling } from "@/hooks/use-transcription-polling";
import { SUMMARY_PRESETS } from "@/lib/ai/summary-presets";

interface SummaryData {
    summary: string | null;
    keyPoints: string[] | null;
    actionItems: string[] | null;
    provider?: string;
    model?: string;
}

interface TranscriptionSectionProps {
    recordingId: string;
    initialTranscription?: string;
    initialLanguage?: string | null;
    initialType?: string | null;
}

export function TranscriptionSection({
    recordingId,
    initialTranscription,
    initialLanguage,
    initialType,
}: TranscriptionSectionProps) {
    const [transcription, setTranscription] = useState(initialTranscription);
    const [detectedLanguage, setDetectedLanguage] = useState(initialLanguage);
    const [transcriptionType, setTranscriptionType] = useState(initialType);

    // Summary state
    const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [summaryExpanded, setSummaryExpanded] = useState(true);
    const [summaryPreset, setSummaryPreset] = useState("general");

    // Key to force re-fetch summary (e.g. after re-transcribe)
    const [summaryFetchKey, setSummaryFetchKey] = useState(0);

    const {
        transcriptionText: liveTranscription,
        isPolling,
        startTranscription,
        cancelTranscription,
    } = useTranscriptionPolling(recordingId, {
        onCompleted: (data) => {
            setTranscription(data.text ?? undefined);
            setDetectedLanguage(data.detectedLanguage || null);
            setTranscriptionType("server");
            setSummaryData(null);
            setSummaryFetchKey((k) => k + 1);
            toast.success("Transcription complete");
        },
        onFailed: (data) => {
            toast.error(data.errorMessage || "Transcription failed");
        },
    });

    // Fetch existing summary on mount / after re-transcribe
    // biome-ignore lint/correctness/useExhaustiveDependencies: summaryFetchKey is an intentional re-fetch trigger
    useEffect(() => {
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

    const handleTranscribe = async () => {
        try {
            await startTranscription();
        } catch {
            toast.error("Transcription failed. Please try again.");
        }
    };

    const handleCancel = async () => {
        try {
            await cancelTranscription();
            toast.success("Transcription cancelled");
        } catch {
            toast.error("Failed to cancel");
        }
    };

    const handleSummarize = useCallback(async () => {
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
                const data = await response.json();
                setSummaryData(data);
                toast.success("Summary generated");
            } else {
                const error = await response.json();
                toast.error(error.error || "Summary generation failed");
            }
        } catch {
            toast.error("Failed to generate summary");
        } finally {
            setIsSummarizing(false);
        }
    }, [recordingId, summaryPreset]);

    const handleDeleteSummary = useCallback(async () => {
        // Optimistic delete
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

    return (
        <div className="space-y-6">
            {/* Transcription Panel */}
            <Panel>
                <div className="space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div className="flex flex-wrap items-center gap-3">
                            <h2 className="text-xl font-bold">Transcription</h2>
                            {detectedLanguage && (
                                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panel-inset">
                                    <LEDIndicator
                                        active
                                        status="active"
                                        size="sm"
                                    />
                                    <span className="text-label text-xs">
                                        Lang:{" "}
                                        <span className="font-mono uppercase text-accent-cyan">
                                            {detectedLanguage}
                                        </span>
                                    </span>
                                </div>
                            )}
                            {transcriptionType && (
                                <span className="text-label text-xs px-3 py-1.5 rounded-lg bg-panel-inset border border-panel-border">
                                    {transcriptionType}
                                </span>
                            )}
                        </div>
                        <MetalButton
                            onClick={
                                isPolling ? handleCancel : handleTranscribe
                            }
                            variant={isPolling ? "orange" : "cyan"}
                            className="w-full md:w-auto"
                        >
                            {isPolling
                                ? "Cancel"
                                : transcription || liveTranscription
                                  ? "Re-transcribe"
                                  : "Transcribe"}
                        </MetalButton>
                    </div>

                    {isPolling ? (
                        <div className="flex flex-col items-center justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mb-4" />
                            <p className="text-muted-foreground mb-2">
                                Transcribing…
                            </p>
                        </div>
                    ) : transcription ? (
                        <div className="info-card">
                            <p className="whitespace-pre-wrap leading-relaxed">
                                {transcription}
                            </p>
                        </div>
                    ) : (
                        <Panel variant="inset" className="text-center py-12">
                            <LEDIndicator
                                active={false}
                                status="active"
                                size="md"
                                className="mx-auto mb-4"
                            />
                            <p className="text-muted-foreground mb-2">
                                No transcription yet
                            </p>
                            <p className="text-sm text-text-muted">
                                Click &quot;Transcribe&quot; to generate a
                                transcription
                            </p>
                        </Panel>
                    )}
                </div>
            </Panel>

            {/* Summary Panel — only show when transcription exists */}
            {transcription && (
                <Panel>
                    <div className="space-y-4">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <h2 className="text-xl font-bold">Summary</h2>
                            </div>
                            <div className="flex items-center gap-2">
                                {!isSummarizing && (
                                    <Select
                                        value={summaryPreset}
                                        onValueChange={setSummaryPreset}
                                    >
                                        <SelectTrigger className="w-[160px] h-8 text-xs">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {Object.values(SUMMARY_PRESETS).map(
                                                (preset) => (
                                                    <SelectItem
                                                        key={preset.id}
                                                        value={preset.id}
                                                    >
                                                        {preset.name}
                                                    </SelectItem>
                                                ),
                                            )}
                                        </SelectContent>
                                    </Select>
                                )}
                                <MetalButton
                                    onClick={handleSummarize}
                                    variant="cyan"
                                    disabled={isSummarizing}
                                    className="w-full md:w-auto"
                                >
                                    {isSummarizing ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin inline" />
                                            Generating...
                                        </>
                                    ) : summaryData ? (
                                        <>
                                            <RefreshCw className="w-4 h-4 mr-2 inline" />
                                            Re-generate
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles className="w-4 h-4 mr-2 inline" />
                                            Summarize
                                        </>
                                    )}
                                </MetalButton>
                            </div>
                        </div>

                        {isSummarizing ? (
                            <Panel variant="inset" className="text-center py-8">
                                <Loader2 className="w-8 h-8 animate-spin text-accent-cyan mx-auto mb-4" />
                                <p className="text-muted-foreground">
                                    Generating summary...
                                </p>
                            </Panel>
                        ) : summaryData?.summary ? (
                            <div className="space-y-4">
                                <button
                                    type="button"
                                    onClick={() =>
                                        setSummaryExpanded(!summaryExpanded)
                                    }
                                    className="flex items-center gap-1 text-sm font-medium hover:text-accent-cyan transition-colors"
                                >
                                    {summaryExpanded ? (
                                        <ChevronUp className="w-4 h-4" />
                                    ) : (
                                        <ChevronDown className="w-4 h-4" />
                                    )}
                                    {summaryExpanded
                                        ? "Collapse"
                                        : "Expand summary"}
                                </button>

                                {summaryExpanded && (
                                    <div className="space-y-4">
                                        <div className="info-card">
                                            <p className="leading-relaxed">
                                                {summaryData.summary}
                                            </p>
                                        </div>

                                        {summaryData.keyPoints &&
                                            summaryData.keyPoints.length >
                                                0 && (
                                                <div>
                                                    <h4 className="text-sm font-medium mb-2">
                                                        Key Points
                                                    </h4>
                                                    <ul className="space-y-1">
                                                        {summaryData.keyPoints.map(
                                                            (point) => {
                                                                const key = `kp-${point.slice(0, 32)}`;
                                                                return (
                                                                    <li
                                                                        key={
                                                                            key
                                                                        }
                                                                        className="text-sm text-muted-foreground flex items-start gap-2"
                                                                    >
                                                                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent-cyan shrink-0" />
                                                                        {point}
                                                                    </li>
                                                                );
                                                            },
                                                        )}
                                                    </ul>
                                                </div>
                                            )}

                                        {summaryData.actionItems &&
                                            summaryData.actionItems.length >
                                                0 && (
                                                <div>
                                                    <h4 className="text-sm font-medium mb-2">
                                                        Action Items
                                                    </h4>
                                                    <ul className="space-y-1">
                                                        {summaryData.actionItems.map(
                                                            (item) => {
                                                                const key = `ai-${item.slice(0, 32)}`;
                                                                return (
                                                                    <li
                                                                        key={
                                                                            key
                                                                        }
                                                                        className="text-sm text-muted-foreground flex items-start gap-2"
                                                                    >
                                                                        <ListChecks className="w-3.5 h-3.5 mt-0.5 text-accent-cyan shrink-0" />
                                                                        {item}
                                                                    </li>
                                                                );
                                                            },
                                                        )}
                                                    </ul>
                                                </div>
                                            )}

                                        <div className="flex items-center justify-between pt-2 border-t border-panel-border">
                                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                                {summaryData.provider && (
                                                    <span className="px-2 py-0.5 rounded bg-panel-inset">
                                                        {summaryData.provider}
                                                    </span>
                                                )}
                                                {summaryData.model && (
                                                    <span className="px-2 py-0.5 rounded bg-panel-inset font-mono">
                                                        {summaryData.model}
                                                    </span>
                                                )}
                                            </div>
                                            <MetalButton
                                                onClick={handleDeleteSummary}
                                                variant="cyan"
                                                className="text-xs"
                                            >
                                                <Trash2 className="w-3.5 h-3.5 mr-1 inline" />
                                                Delete
                                            </MetalButton>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <Panel variant="inset" className="text-center py-8">
                                <ListChecks className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                                <p className="text-sm text-muted-foreground">
                                    No summary yet. Click &quot;Summarize&quot;
                                    to generate one.
                                </p>
                            </Panel>
                        )}
                    </div>
                </Panel>
            )}
        </div>
    );
}
