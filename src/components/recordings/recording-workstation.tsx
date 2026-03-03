"use client";

import {
    ArrowLeft,
    CloudUpload,
    Pencil,
    Scissors,
    Trash2,
    VolumeX,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RecordingPlayer } from "@/components/dashboard/recording-player";
import { TranscriptionPanel } from "@/components/dashboard/transcription-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Recording } from "@/types/recording";
import type { DiarizedSegment } from "@/types/transcription";

interface Transcription {
    text?: string;
    detectedLanguage?: string;
    transcriptionType?: string;
    speakersJson?: DiarizedSegment[];
}

interface RecordingWorkstationProps {
    recording: Recording;
    transcription?: Transcription;
}

export function RecordingWorkstation({
    recording,
    transcription,
}: RecordingWorkstationProps) {
    const router = useRouter();
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [streamingText, setStreamingText] = useState("");
    const [statusMessage, setStatusMessage] = useState("");
    // Transcription received directly in the SSE done event — used to show
    // the result immediately without waiting for router.refresh() to complete.
    const [localTranscription, setLocalTranscription] = useState<
        string | undefined
    >(undefined);
    const [localSpeakersJson, setLocalSpeakersJson] = useState<
        DiarizedSegment[] | undefined
    >(undefined);
    const [transcriptionProvider, setTranscriptionProvider] = useState<
        string | null
    >(null);
    // Client-side accumulator for streamed chunks — used as fallback when
    // event.transcription is absent or empty in the done event.
    const streamingAccumulatorRef = useRef("");
    const [isDeletingTranscription, setIsDeletingTranscription] =
        useState(false);
    const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [editTitleValue, setEditTitleValue] = useState("");
    const [isSavingTitle, setIsSavingTitle] = useState(false);
    const [isSyncingToPlaud, setIsSyncingToPlaud] = useState(false);
    const [isSplitting, setIsSplitting] = useState(false);
    const [splitConflict, setSplitConflict] = useState<number | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isRemovingSilence, setIsRemovingSilence] = useState(false);
    const [splitSegmentMinutes, setSplitSegmentMinutes] = useState(60);
    const titleEditCancelledRef = useRef(false);
    const transcribeAbortRef = useRef<AbortController | null>(null);
    // Polling interval used when the SSE stream closes before the done event
    // (e.g. proxy timeout). We keep isTranscribing=true and poll
    // router.refresh() until the transcription appears in the page props.
    const transcribePollRef = useRef<ReturnType<typeof setInterval> | null>(
        null,
    );

    useEffect(() => {
        fetch("/api/settings/user")
            .then((res) => {
                if (!res.ok) throw new Error("Failed to fetch user settings");
                return res.json();
            })
            .then((data) =>
                setSplitSegmentMinutes(data.splitSegmentMinutes ?? 60),
            )
            .catch(() => {});
    }, []);

    useEffect(() => {
        fetch("/api/settings/ai/providers")
            .then((r) => r.json())
            .then((data) => {
                const defaultProvider = (
                    data.providers as Array<{
                        provider: string;
                        isDefaultTranscription: boolean;
                    }>
                )?.find((p) => p.isDefaultTranscription);
                setTranscriptionProvider(defaultProvider?.provider ?? null);
            })
            .catch(() => {});
    }, []);

    // Abort any in-progress transcription stream when the component unmounts
    useEffect(() => {
        return () => {
            transcribeAbortRef.current?.abort();
            if (transcribePollRef.current)
                clearInterval(transcribePollRef.current);
        };
    }, []);

    // When the transcription prop arrives from the server (via router.refresh),
    // stop polling and clear the transcribing state. Also clear the local
    // speaker data since the server version is now authoritative.
    useEffect(() => {
        if (transcription?.text && transcribePollRef.current) {
            clearInterval(transcribePollRef.current);
            transcribePollRef.current = null;
            setIsTranscribing(false);
            setStreamingText("");
        }
        if (transcription?.text) {
            setLocalSpeakersJson(undefined);
        }
    }, [transcription?.text]);

    const runTranscription = useCallback(
        async (diarize: boolean) => {
            const controller = new AbortController();
            transcribeAbortRef.current = controller;
            setIsTranscribing(true);
            setLocalTranscription(undefined);
            setLocalSpeakersJson(undefined);
            streamingAccumulatorRef.current = "";
            // Flag: when true the finally block leaves isTranscribing alone so
            // the polling useEffect can clear it once the result arrives.
            let keepTranscribing = false;
            try {
                const url = diarize
                    ? `/api/recordings/${recording.id}/transcribe?diarize=true`
                    : `/api/recordings/${recording.id}/transcribe`;
                const response = await fetch(url, {
                    method: "POST",
                    signal: controller.signal,
                });

                const contentType = response.headers.get("content-type");
                if (contentType?.includes("text/event-stream")) {
                    // Speaches streaming / diarization SSE path
                    const reader = response.body?.getReader();
                    if (!reader)
                        throw new Error("Response body is not readable");
                    const decoder = new TextDecoder();
                    let buffer = "";
                    let receivedDone = false;
                    let receivedServerError = false;
                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;

                            buffer += decoder.decode(value, { stream: true });
                            const blocks = buffer.split("\n\n");
                            buffer = blocks.pop() ?? "";

                            for (const block of blocks) {
                                const line = block.trim();
                                if (!line.startsWith("data:")) continue;
                                const jsonStr = line.slice(5).trim();
                                if (!jsonStr) continue;

                                let event: {
                                    type: string;
                                    text?: string;
                                    transcription?: string;
                                    speakersJson?: DiarizedSegment[];
                                    message?: string;
                                };
                                try {
                                    event = JSON.parse(jsonStr);
                                } catch {
                                    continue;
                                }

                                if (event.type === "chunk" && event.text) {
                                    setStatusMessage("");
                                    streamingAccumulatorRef.current +=
                                        event.text;
                                    setStreamingText(
                                        (prev) => prev + event.text,
                                    );
                                } else if (event.type === "status") {
                                    setStatusMessage(
                                        event.message ?? "",
                                    );
                                } else if (event.type === "done") {
                                    receivedDone = true;
                                    setStatusMessage("");
                                    // Show result immediately from the done event so
                                    // the UI doesn't flash blank while router.refresh()
                                    // fetches the updated page from the server.
                                    const finalText =
                                        event.transcription ||
                                        streamingAccumulatorRef.current;
                                    if (finalText) {
                                        setLocalTranscription(finalText);
                                    }
                                    if (
                                        diarize &&
                                        event.speakersJson &&
                                        event.speakersJson.length > 0
                                    ) {
                                        setLocalSpeakersJson(
                                            event.speakersJson,
                                        );
                                    }
                                    streamingAccumulatorRef.current = "";
                                    toast.success("Transcription complete");
                                    router.refresh();
                                    return;
                                } else if (event.type === "error") {
                                    receivedServerError = true;
                                    throw new Error(
                                        event.message ?? "Transcription failed",
                                    );
                                }
                                // "ping" events (heartbeat) are ignored
                            }
                        }
                    } catch (streamErr) {
                        if (
                            streamErr instanceof Error &&
                            streamErr.name === "AbortError"
                        ) {
                            throw streamErr;
                        }
                        if (receivedServerError) {
                            throw streamErr;
                        }
                        // Network/connection drop — server still processing.
                        console.warn(
                            "[transcribe] SSE read error — starting polling",
                            streamErr,
                        );
                        keepTranscribing = true;
                        router.refresh();
                        transcribePollRef.current = setInterval(() => {
                            router.refresh();
                        }, 10_000);
                        return;
                    }

                    if (!receivedDone) {
                        console.warn(
                            "[transcribe] SSE stream closed without done — starting polling",
                        );
                        keepTranscribing = true;
                        router.refresh();
                        transcribePollRef.current = setInterval(() => {
                            router.refresh();
                        }, 10_000);
                    }
                } else if (response.ok) {
                    toast.success("Transcription complete");
                    router.refresh();
                } else {
                    let errorData: { error?: string } | null = null;
                    try {
                        errorData = await response.json();
                    } catch {
                        /* non-JSON body — proxy error, fall through to polling */
                    }
                    if (errorData) {
                        toast.error(errorData.error || "Transcription failed");
                    } else {
                        keepTranscribing = true;
                        router.refresh();
                        transcribePollRef.current = setInterval(() => {
                            router.refresh();
                        }, 10_000);
                    }
                }
            } catch (err) {
                if (err instanceof Error && err.name === "AbortError") return;
                // A TypeError usually means the proxy closed the connection
                // before sending a proper response — start polling.
                if (err instanceof TypeError) {
                    keepTranscribing = true;
                    router.refresh();
                    transcribePollRef.current = setInterval(() => {
                        router.refresh();
                    }, 10_000);
                    return;
                }
                toast.error(
                    err instanceof Error
                        ? err.message
                        : "Failed to transcribe recording",
                );
            } finally {
                if (!keepTranscribing) {
                    setIsTranscribing(false);
                    setStreamingText("");
                    setStatusMessage("");
                }
            }
        },
        [recording.id, router],
    );

    const handleTranscribe = useCallback(
        () => runTranscription(false),
        [runTranscription],
    );

    const handleTranscribeDiarized = useCallback(
        () => runTranscription(true),
        [runTranscription],
    );

    const handleDeleteTranscription = useCallback(async () => {
        setIsDeletingTranscription(true);
        try {
            const response = await fetch(
                `/api/recordings/${recording.id}/transcribe`,
                { method: "DELETE" },
            );

            if (response.ok) {
                // Clear local state immediately so the UI shows "no transcription"
                // without waiting for router.refresh() to deliver the server update.
                setLocalTranscription(undefined);
                setLocalSpeakersJson(undefined);
                toast.success("Transcription removed");
                router.refresh();
            } else {
                const error = await response.json();
                toast.error(error.error || "Failed to remove transcription");
            }
        } catch {
            toast.error("Failed to remove transcription");
        } finally {
            setIsDeletingTranscription(false);
        }
    }, [recording.id, router]);

    const handleGenerateTitle = useCallback(async () => {
        setIsGeneratingTitle(true);
        try {
            const response = await fetch(
                `/api/recordings/${recording.id}/generate-title`,
                { method: "POST" },
            );

            if (response.ok) {
                const data = await response.json();
                toast.success(`Title generated: "${data.title}"`);
                router.refresh();
            } else {
                const error = await response.json();
                toast.error(error.error || "Failed to generate title");
            }
        } catch {
            toast.error("Failed to generate title");
        } finally {
            setIsGeneratingTitle(false);
        }
    }, [recording.id, router]);

    const handleSaveTitle = useCallback(async () => {
        if (titleEditCancelledRef.current) {
            titleEditCancelledRef.current = false;
            return;
        }
        const trimmed = editTitleValue.trim();
        if (!trimmed || trimmed === recording.filename) {
            setIsEditingTitle(false);
            return;
        }

        setIsSavingTitle(true);
        try {
            const response = await fetch(`/api/recordings/${recording.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filename: trimmed }),
            });

            if (response.ok) {
                setIsEditingTitle(false);
                router.refresh();
            } else {
                const error = await response.json();
                toast.error(error.error || "Failed to save title");
            }
        } catch {
            toast.error("Failed to save title");
        } finally {
            setIsSavingTitle(false);
        }
    }, [editTitleValue, recording.filename, recording.id, router]);

    const handleSyncToPlaud = useCallback(async () => {
        setIsSyncingToPlaud(true);
        try {
            const response = await fetch(
                `/api/recordings/${recording.id}/sync-title`,
                { method: "POST" },
            );

            if (response.ok) {
                toast.success("Title synced to Plaud");
            } else {
                const error = await response.json();
                toast.error(error.error || "Failed to sync title");
            }
        } catch {
            toast.error("Failed to sync title");
        } finally {
            setIsSyncingToPlaud(false);
        }
    }, [recording.id]);

    const runSplit = useCallback(
        async (force: boolean) => {
            setIsSplitting(true);
            try {
                const url = `/api/recordings/${recording.id}/split${force ? "?force=true" : ""}`;
                const response = await fetch(url, { method: "POST" });

                if (response.ok) {
                    const data = await response.json();
                    setSplitConflict(null);
                    toast.success(
                        `Recording split into ${data.segmentCount} segments`,
                    );
                    router.push("/dashboard");
                } else if (response.status === 409) {
                    const data = await response.json();
                    setSplitConflict(data.existingCount as number);
                } else {
                    const error = await response.json();
                    toast.error(error.error || "Failed to split recording");
                }
            } catch {
                toast.error("Failed to split recording");
            } finally {
                setIsSplitting(false);
            }
        },
        [recording.id, router],
    );

    const handleSplit = useCallback(() => runSplit(false), [runSplit]);
    const handleSplitForce = useCallback(() => runSplit(true), [runSplit]);

    // True whenever any mutating operation is in flight — used to disable all
    // action buttons and prevent concurrent conflicting requests.
    const isProcessing =
        isSplitting ||
        isDeleting ||
        isRemovingSilence ||
        isTranscribing ||
        isDeletingTranscription ||
        isGeneratingTitle ||
        isSyncingToPlaud;

    const handleDelete = useCallback(async () => {
        setIsDeleting(true);
        try {
            const response = await fetch(`/api/recordings/${recording.id}`, {
                method: "DELETE",
            });

            if (response.ok) {
                toast.success("Recording deleted");
                router.push("/dashboard");
            } else {
                const error = await response.json();
                toast.error(error.error || "Failed to delete recording");
            }
        } catch {
            toast.error("Failed to delete recording");
        } finally {
            setIsDeleting(false);
        }
    }, [recording.id, router]);

    const handleRemoveSilence = useCallback(async () => {
        setIsRemovingSilence(true);
        try {
            const response = await fetch(
                `/api/recordings/${recording.id}/remove-silence`,
                { method: "POST" },
            );

            if (response.ok) {
                const data = await response.json();
                toast.success(
                    `Silence removed — ${data.originalSizeMb} MB → ${data.newSizeMb} MB (${data.reductionPercent}% smaller)`,
                );
                router.push("/dashboard");
            } else {
                const error = await response.json();
                toast.error(error.error || "Failed to remove silence");
            }
        } catch {
            toast.error("Failed to remove silence");
        } finally {
            setIsRemovingSilence(false);
        }
    }, [recording.id, router]);

    return (
        <div className="bg-background">
            <div className="container mx-auto px-4 py-6 max-w-4xl">
                {/* Header */}
                <div className="flex items-center gap-4 mb-6">
                    <Button
                        onClick={() => router.back()}
                        variant="outline"
                        size="icon"
                    >
                        <ArrowLeft className="w-4 h-4" />
                    </Button>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 min-w-0">
                            {isEditingTitle ? (
                                <Input
                                    value={editTitleValue}
                                    onChange={(e) =>
                                        setEditTitleValue(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.currentTarget.blur();
                                        }
                                        if (e.key === "Escape") {
                                            titleEditCancelledRef.current = true;
                                            setIsEditingTitle(false);
                                        }
                                    }}
                                    onBlur={handleSaveTitle}
                                    disabled={isSavingTitle}
                                    className="text-2xl font-bold h-auto py-0.5 flex-1"
                                    autoFocus
                                />
                            ) : (
                                <h1 className="text-3xl font-bold truncate flex-1">
                                    {recording.filename}
                                </h1>
                            )}
                            <Button
                                variant="ghost"
                                size="icon"
                                className="shrink-0"
                                onClick={() => {
                                    setEditTitleValue(recording.filename);
                                    setIsEditingTitle(true);
                                }}
                                title="Edit title"
                            >
                                <Pencil className="w-4 h-4" />
                            </Button>
                            {!recording.plaudFileId.startsWith("split-") &&
                                !recording.plaudFileId.startsWith(
                                    "silence-removed-",
                                ) &&
                                !recording.plaudFileId.startsWith(
                                    "uploaded-",
                                ) &&
                                recording.filenameModified && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="shrink-0"
                                        onClick={handleSyncToPlaud}
                                        disabled={isSyncingToPlaud}
                                        title="Sync title to Plaud device"
                                    >
                                        <CloudUpload className="w-4 h-4" />
                                    </Button>
                                )}
                        </div>
                        {/* suppressHydrationWarning: date formatting is locale-dependent
                            (Docker locale ≠ browser locale → React #418 mismatch) */}
                        <p
                            className="text-muted-foreground text-sm mt-1"
                            suppressHydrationWarning
                        >
                            {new Date(recording.startTime).toLocaleString()}
                        </p>
                    </div>
                    <Button
                        onClick={handleRemoveSilence}
                        variant="outline"
                        disabled={isProcessing}
                    >
                        <VolumeX className="w-4 h-4 mr-2" />
                        {isRemovingSilence ? "Processing..." : "Remove Silence"}
                    </Button>
                    {recording.duration > splitSegmentMinutes * 60 * 1000 && (
                        <div className="flex flex-col items-end gap-2">
                            {splitConflict !== null && (
                                <div className="flex items-center gap-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
                                    <span className="text-destructive">
                                        {splitConflict === 1
                                            ? "1 existing segment"
                                            : `${splitConflict} existing segments`}{" "}
                                        will be deleted. Continue?
                                    </span>
                                    <Button
                                        onClick={() => setSplitConflict(null)}
                                        variant="outline"
                                        size="sm"
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        onClick={handleSplitForce}
                                        variant="destructive"
                                        size="sm"
                                        disabled={isProcessing}
                                    >
                                        {isSplitting
                                            ? "Splitting..."
                                            : "Delete & Re-split"}
                                    </Button>
                                </div>
                            )}
                            <Button
                                onClick={handleSplit}
                                variant="outline"
                                disabled={
                                    isProcessing || splitConflict !== null
                                }
                            >
                                <Scissors className="w-4 h-4 mr-2" />
                                {isSplitting
                                    ? "Splitting..."
                                    : "Split Recording"}
                            </Button>
                        </div>
                    )}
                    {(recording.plaudFileId.startsWith("split-") ||
                        recording.plaudFileId.startsWith("silence-removed-") ||
                        recording.plaudFileId.startsWith("uploaded-")) && (
                        <Button
                            onClick={handleDelete}
                            variant="outline"
                            disabled={isProcessing}
                            className="text-destructive hover:text-destructive"
                        >
                            <Trash2 className="w-4 h-4 mr-2" />
                            {isDeleting ? "Deleting..." : "Delete"}
                        </Button>
                    )}
                </div>

                {/* Content */}
                <div className="space-y-6">
                    <RecordingPlayer recording={recording} />
                    <TranscriptionPanel
                        recording={recording}
                        transcription={
                            // Prefer server-side transcription from props when it has
                            // actual text (authoritative). Fall back to the text received
                            // in the SSE done event so the result is visible immediately
                            // while router.refresh() is in flight.
                            // NOTE: use ?.text check, not ??, because an existing record
                            // with empty text ({ text: "" }) is not null/undefined but
                            // must still be treated as "no transcription" for display.
                            transcription?.text
                                ? transcription
                                : localTranscription
                                  ? { text: localTranscription }
                                  : undefined
                        }
                        isTranscribing={isTranscribing}
                        onTranscribe={handleTranscribe}
                        isDeletingTranscription={isDeletingTranscription}
                        onDeleteTranscription={handleDeleteTranscription}
                        isGeneratingTitle={isGeneratingTitle}
                        onGenerateTitle={handleGenerateTitle}
                        disabled={isProcessing}
                        streamingText={streamingText}
                        statusMessage={statusMessage}
                        supportsDiarization={
                            transcriptionProvider === "Speaches"
                        }
                        onTranscribeDiarized={handleTranscribeDiarized}
                        speakersJson={
                            transcription?.speakersJson ?? localSpeakersJson
                        }
                    />

                    {/* Metadata */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Details</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                <div>
                                    <div className="text-muted-foreground text-xs mb-1">
                                        Duration
                                    </div>
                                    <div className="font-medium">
                                        {Math.floor(recording.duration / 60000)}
                                        :
                                        {((recording.duration % 60000) / 1000)
                                            .toFixed(0)
                                            .padStart(2, "0")}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-muted-foreground text-xs mb-1">
                                        File Size
                                    </div>
                                    <div className="font-medium">
                                        {(
                                            recording.filesize /
                                            (1024 * 1024)
                                        ).toFixed(2)}{" "}
                                        MB
                                    </div>
                                </div>
                                <div>
                                    <div className="text-muted-foreground text-xs mb-1">
                                        Device
                                    </div>
                                    <div className="font-mono text-xs truncate">
                                        {recording.deviceSn}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-muted-foreground text-xs mb-1">
                                        Date
                                    </div>
                                    {/* suppressHydrationWarning: locale-dependent */}
                                    <div
                                        className="font-medium"
                                        suppressHydrationWarning
                                    >
                                        {new Date(
                                            recording.startTime,
                                        ).toLocaleDateString()}
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
