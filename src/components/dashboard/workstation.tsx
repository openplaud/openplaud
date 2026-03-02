"use client";

import {
    Mic,
    RefreshCw,
    Scissors,
    Settings,
    Trash2,
    Upload,
    VolumeX,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { OnboardingDialog } from "@/components/onboarding-dialog";
import { SettingsDialog } from "@/components/settings-dialog";
import { SyncStatus } from "@/components/sync-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAutoSync } from "@/hooks/use-auto-sync";
import {
    requestNotificationPermission,
    showNewRecordingNotification,
    showSyncCompleteNotification,
} from "@/lib/notifications/browser";
import { getSyncSettings, SYNC_CONFIG } from "@/lib/sync-config";
import type { Recording } from "@/types/recording";
import type { DiarizedSegment } from "@/types/transcription";
import { RecordingList } from "./recording-list";
import { RecordingPlayer } from "./recording-player";
import { TranscriptionPanel } from "./transcription-panel";

interface TranscriptionData {
    text?: string;
    language?: string;
    speakersJson?: DiarizedSegment[];
}

interface WorkstationProps {
    recordings: Recording[];
    transcriptions: Map<string, TranscriptionData>;
}

export function Workstation({ recordings, transcriptions }: WorkstationProps) {
    const router = useRouter();
    const [currentRecording, setCurrentRecording] = useState<Recording | null>(
        () => {
            const savedId =
                typeof window !== "undefined"
                    ? sessionStorage.getItem("dashboard-selected-id")
                    : null;
            return (
                (savedId ? recordings.find((r) => r.id === savedId) : null) ??
                (recordings.length > 0 ? recordings[0] : null)
            );
        },
    );
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [isDeletingTranscription, setIsDeletingTranscription] =
        useState(false);
    const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
    const [isSplitting, setIsSplitting] = useState(false);
    const [splitConflict, setSplitConflict] = useState<number | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isRemovingSilence, setIsRemovingSilence] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [editTitleValue, setEditTitleValue] = useState("");
    const [isSavingTitle, setIsSavingTitle] = useState(false);
    const [isSyncingToPlaud, setIsSyncingToPlaud] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [streamingText, setStreamingText] = useState("");
    const [localTranscription, setLocalTranscription] = useState<
        string | undefined
    >(undefined);
    const [localSpeakersJson, setLocalSpeakersJson] = useState<
        DiarizedSegment[] | undefined
    >(undefined);
    const [transcriptionProvider, setTranscriptionProvider] = useState<
        string | null
    >(null);
    const streamingAccumulatorRef = useRef("");
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const transcribeAbortRef = useRef<AbortController | null>(null);
    // Polling interval used when the SSE stream closes before the done event
    // (e.g. proxy timeout). We keep isTranscribing=true and poll
    // router.refresh() until the transcription appears in the page props.
    const transcribePollRef = useRef<ReturnType<typeof setInterval> | null>(
        null,
    );
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [onboardingOpen, setOnboardingOpen] = useState(false);
    const [providers, setProviders] = useState<
        Array<{
            id: string;
            provider: string;
            baseUrl: string | null;
            defaultModel: string | null;
            isDefaultTranscription: boolean;
            isDefaultEnhancement: boolean;
            createdAt: Date;
        }>
    >([]);
    const [syncSettings, setSyncSettings] = useState<{
        syncInterval: number;
        autoSyncEnabled: boolean;
        syncOnMount: boolean;
        syncOnVisibilityChange: boolean;
        syncNotifications: boolean;
    } | null>(null);
    const [notificationPrefs, setNotificationPrefs] = useState<{
        browserNotifications: boolean;
    } | null>(null);
    const [splitSegmentMinutes, setSplitSegmentMinutes] = useState(60);

    const currentTranscription = currentRecording
        ? transcriptions.get(currentRecording.id)
        : undefined;

    // Keep currentRecording in sync with the recordings prop (updated after router.refresh()).
    // If the previously-selected recording is no longer present (e.g. just deleted),
    // clear the selection rather than holding a stale reference.
    useEffect(() => {
        setCurrentRecording((prev) => {
            if (!prev) return prev;
            const updated = recordings.find((r) => r.id === prev.id);
            return updated ?? null;
        });
    }, [recordings]);

    // Reset per-recording state whenever the selected recording changes.
    // Without this, localTranscription from the previous recording stays
    // visible when switching to a recording that has no transcription yet,
    // and title-editing UI from the old recording would bleed through.
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — only runs on id change
    useEffect(() => {
        setIsEditingTitle(false);
        setEditTitleValue("");
        setSplitConflict(null);
        setLocalTranscription(undefined);
        setLocalSpeakersJson(undefined);
        setStreamingText("");
        streamingAccumulatorRef.current = "";
    }, [currentRecording?.id]);

    useEffect(() => {
        getSyncSettings().then(setSyncSettings);
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
        if (currentTranscription?.text && transcribePollRef.current) {
            clearInterval(transcribePollRef.current);
            transcribePollRef.current = null;
            setIsTranscribing(false);
            setStreamingText("");
        }
        if (currentTranscription?.text) {
            setLocalSpeakersJson(undefined);
        }
    }, [currentTranscription?.text]);

    useEffect(() => {
        const fetchNotificationPrefs = async () => {
            try {
                const res = await fetch("/api/settings/user");
                if (!res.ok) return;
                const data = await res.json();
                setNotificationPrefs({
                    browserNotifications: data.browserNotifications ?? true,
                });
                setSplitSegmentMinutes(data.splitSegmentMinutes ?? 60);
            } catch {
                // best-effort; ignore
            }
        };

        fetchNotificationPrefs();
    }, []);

    useEffect(() => {
        if (!settingsOpen) {
            getSyncSettings().then(setSyncSettings);
        }
    }, [settingsOpen]);

    // Fetch the default transcription provider on mount so we know whether
    // to show the "Generate with Speakers" button (Speaches-only feature).
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

    const {
        isAutoSyncing,
        lastSyncTime,
        nextSyncTime,
        lastSyncResult,
        manualSync,
    } = useAutoSync({
        interval: syncSettings?.syncInterval ?? SYNC_CONFIG.defaultInterval,
        minInterval: SYNC_CONFIG.minInterval,
        syncOnMount: syncSettings?.syncOnMount ?? SYNC_CONFIG.syncOnMount,
        syncOnVisibilityChange:
            syncSettings?.syncOnVisibilityChange ??
            SYNC_CONFIG.syncOnVisibilityChange,
        enabled: syncSettings?.autoSyncEnabled ?? true,
        onSuccess: (newRecordings) => {
            if (syncSettings?.syncNotifications !== false) {
                if (newRecordings > 0) {
                    toast.success(
                        `Synced ${newRecordings} new recording${newRecordings !== 1 ? "s" : ""}`,
                    );
                } else {
                    toast.success("Sync complete - no new recordings");
                }
            }

            if (notificationPrefs?.browserNotifications) {
                (async () => {
                    const granted = await requestNotificationPermission();
                    if (!granted) return;

                    if (newRecordings > 0) {
                        showNewRecordingNotification(newRecordings);
                    } else {
                        showSyncCompleteNotification();
                    }
                })();
            }
        },
        onError: (error) => {
            toast.error(error);
        },
    });

    const handleSync = useCallback(async () => {
        await manualSync();
    }, [manualSync]);

    useEffect(() => {
        if (settingsOpen) {
            fetch("/api/settings/ai/providers")
                .then((res) => res.json())
                .then((data) => setProviders(data.providers || []))
                .catch(() => setProviders([]));
        }
    }, [settingsOpen]);

    const runTranscription = useCallback(
        async (diarize: boolean) => {
            if (!currentRecording) return;

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
                    ? `/api/recordings/${currentRecording.id}/transcribe?diarize=true`
                    : `/api/recordings/${currentRecording.id}/transcribe`;
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
                                    streamingAccumulatorRef.current +=
                                        event.text;
                                    setStreamingText(
                                        (prev) => prev + event.text,
                                    );
                                } else if (event.type === "done") {
                                    receivedDone = true;
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
                        keepTranscribing = true;
                        router.refresh();
                        transcribePollRef.current = setInterval(() => {
                            router.refresh();
                        }, 10_000);
                        return;
                    }

                    if (!receivedDone) {
                        // Stream closed without done event — start polling.
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
                }
            }
        },
        [currentRecording, router],
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
        if (!currentRecording) return;

        setIsDeletingTranscription(true);
        try {
            const response = await fetch(
                `/api/recordings/${currentRecording.id}/transcribe`,
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
    }, [currentRecording, router]);

    const handleGenerateTitle = useCallback(async () => {
        if (!currentRecording) return;

        setIsGeneratingTitle(true);
        try {
            const response = await fetch(
                `/api/recordings/${currentRecording.id}/generate-title`,
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
    }, [currentRecording, router]);

    const handleSaveTitle = useCallback(async () => {
        if (!currentRecording) return;
        const trimmed = editTitleValue.trim();
        if (!trimmed || trimmed === currentRecording.filename) {
            setIsEditingTitle(false);
            return;
        }

        setIsSavingTitle(true);
        try {
            const response = await fetch(
                `/api/recordings/${currentRecording.id}`,
                {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ filename: trimmed }),
                },
            );

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
    }, [currentRecording, editTitleValue, router]);

    const handleSyncToPlaud = useCallback(async () => {
        if (!currentRecording) return;

        setIsSyncingToPlaud(true);
        try {
            const response = await fetch(
                `/api/recordings/${currentRecording.id}/sync-title`,
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
    }, [currentRecording]);

    const handleUpload = useCallback(
        async (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file) return;
            e.target.value = "";

            setIsUploading(true);
            try {
                const formData = new FormData();
                formData.append("file", file);

                const response = await fetch("/api/recordings/upload", {
                    method: "POST",
                    body: formData,
                });

                if (response.ok) {
                    const data = await response.json();
                    toast.success(`"${data.filename}" uploaded`);
                    router.refresh();
                } else {
                    const error = await response.json();
                    toast.error(error.error || "Upload failed");
                }
            } catch {
                toast.error("Failed to upload recording");
            } finally {
                setIsUploading(false);
            }
        },
        [router],
    );

    const runSplit = useCallback(
        async (force: boolean) => {
            if (!currentRecording) return;

            setIsSplitting(true);
            try {
                const url = `/api/recordings/${currentRecording.id}/split${force ? "?force=true" : ""}`;
                const response = await fetch(url, { method: "POST" });

                if (response.ok) {
                    const data = await response.json();
                    setSplitConflict(null);
                    toast.success(
                        `Recording split into ${data.segmentCount} segments`,
                    );
                    router.refresh();
                } else if (response.status === 409) {
                    const data = await response.json();
                    setSplitConflict(data.existingCount as number);
                } else {
                    // Clear any stale conflict banner so it doesn't show stale
                    // data after a failed force re-split.
                    setSplitConflict(null);
                    const error = await response.json();
                    toast.error(error.error || "Failed to split recording");
                }
            } catch {
                toast.error("Failed to split recording");
            } finally {
                setIsSplitting(false);
            }
        },
        [currentRecording, router],
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
        isDeletingTranscription;

    const handleDelete = useCallback(async () => {
        if (!currentRecording) return;

        setIsDeleting(true);
        try {
            const response = await fetch(
                `/api/recordings/${currentRecording.id}`,
                { method: "DELETE" },
            );

            if (response.ok) {
                toast.success("Recording deleted");
                setCurrentRecording(null);
                router.refresh();
            } else {
                const error = await response.json();
                toast.error(error.error || "Failed to delete recording");
            }
        } catch {
            toast.error("Failed to delete recording");
        } finally {
            setIsDeleting(false);
        }
    }, [currentRecording, router]);

    const handleRemoveSilence = useCallback(async () => {
        if (!currentRecording) return;

        setIsRemovingSilence(true);
        try {
            const response = await fetch(
                `/api/recordings/${currentRecording.id}/remove-silence`,
                { method: "POST" },
            );

            if (response.ok) {
                const data = await response.json();
                toast.success(
                    `Silence removed — ${data.originalSizeMb} MB → ${data.newSizeMb} MB (${data.reductionPercent}% smaller)`,
                );
                router.refresh();
            } else {
                const error = await response.json();
                toast.error(error.error || "Failed to remove silence");
            }
        } catch {
            toast.error("Failed to remove silence");
        } finally {
            setIsRemovingSilence(false);
        }
    }, [currentRecording, router]);

    return (
        <>
            <div className="bg-background">
                <div className="container mx-auto px-4 py-6 max-w-7xl">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h1 className="text-3xl font-bold">Recordings</h1>
                            <p className="text-muted-foreground text-sm mt-1">
                                {recordings.length} recording
                                {recordings.length !== 1 ? "s" : ""}
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            <SyncStatus
                                lastSyncTime={lastSyncTime}
                                nextSyncTime={nextSyncTime}
                                isAutoSyncing={isAutoSyncing}
                                lastSyncResult={lastSyncResult}
                                className="hidden md:flex"
                            />
                            <Button
                                onClick={handleSync}
                                disabled={isAutoSyncing}
                                variant="outline"
                                size="sm"
                                className="h-9"
                            >
                                {isAutoSyncing ? (
                                    <>
                                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                        Syncing...
                                    </>
                                ) : (
                                    <>
                                        <RefreshCw className="w-4 h-4 mr-2" />
                                        Sync Device
                                    </>
                                )}
                            </Button>
                            <input
                                ref={uploadInputRef}
                                type="file"
                                accept="audio/*"
                                className="hidden"
                                onChange={handleUpload}
                            />
                            <Button
                                onClick={() => uploadInputRef.current?.click()}
                                disabled={isUploading}
                                variant="outline"
                                size="sm"
                                className="h-9"
                            >
                                <Upload className="w-4 h-4 mr-2" />
                                {isUploading ? "Uploading..." : "Upload Audio"}
                            </Button>
                            <Button
                                onClick={() => setSettingsOpen(true)}
                                variant="outline"
                                size="icon"
                            >
                                <Settings className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>

                    {recordings.length === 0 ? (
                        <Card>
                            <CardContent className="flex flex-col items-center justify-center py-16">
                                <Mic className="w-16 h-16 text-muted-foreground mb-4" />
                                <h3 className="text-lg font-semibold mb-2">
                                    No recordings yet
                                </h3>
                                <p className="text-muted-foreground text-sm mb-6 text-center max-w-md">
                                    Sync your Plaud device to import your
                                    recordings and start transcribing them.
                                </p>
                                <Button
                                    onClick={handleSync}
                                    disabled={isAutoSyncing}
                                >
                                    {isAutoSyncing ? (
                                        <>
                                            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                            Syncing...
                                        </>
                                    ) : (
                                        <>
                                            <RefreshCw className="w-4 h-4 mr-2" />
                                            Sync Device
                                        </>
                                    )}
                                </Button>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div className="lg:col-span-1">
                                <RecordingList
                                    recordings={recordings}
                                    currentRecording={currentRecording}
                                    onSelect={(r) => {
                                        setSplitConflict(null);
                                        setCurrentRecording(r);
                                        sessionStorage.setItem(
                                            "dashboard-selected-id",
                                            r.id,
                                        );
                                    }}
                                />
                            </div>

                            <div className="lg:col-span-2 space-y-6">
                                {currentRecording ? (
                                    <>
                                        <div className="space-y-2">
                                            {splitConflict !== null && (
                                                <div className="flex items-center justify-end gap-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
                                                    <span className="text-destructive">
                                                        {splitConflict === 1
                                                            ? "1 existing segment"
                                                            : `${splitConflict} existing segments`}{" "}
                                                        will be deleted.
                                                        Continue?
                                                    </span>
                                                    <Button
                                                        onClick={() =>
                                                            setSplitConflict(
                                                                null,
                                                            )
                                                        }
                                                        variant="outline"
                                                        size="sm"
                                                    >
                                                        Cancel
                                                    </Button>
                                                    <Button
                                                        onClick={
                                                            handleSplitForce
                                                        }
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
                                            <div className="flex justify-end gap-2 flex-wrap">
                                                <Button
                                                    onClick={
                                                        handleRemoveSilence
                                                    }
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={isProcessing}
                                                >
                                                    <VolumeX className="w-4 h-4 mr-2" />
                                                    {isRemovingSilence
                                                        ? "Processing..."
                                                        : "Remove Silence"}
                                                </Button>
                                                {currentRecording.duration >
                                                    splitSegmentMinutes *
                                                        60 *
                                                        1000 && (
                                                    <Button
                                                        onClick={handleSplit}
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={
                                                            isProcessing ||
                                                            splitConflict !==
                                                                null
                                                        }
                                                    >
                                                        <Scissors className="w-4 h-4 mr-2" />
                                                        {isSplitting
                                                            ? "Splitting..."
                                                            : "Split Recording"}
                                                    </Button>
                                                )}
                                                {(currentRecording.plaudFileId.startsWith(
                                                    "split-",
                                                ) ||
                                                    currentRecording.plaudFileId.startsWith(
                                                        "silence-removed-",
                                                    ) ||
                                                    currentRecording.plaudFileId.startsWith(
                                                        "uploaded-",
                                                    )) && (
                                                    <Button
                                                        onClick={handleDelete}
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={isProcessing}
                                                        className="text-destructive hover:text-destructive"
                                                    >
                                                        <Trash2 className="w-4 h-4 mr-2" />
                                                        {isDeleting
                                                            ? "Deleting..."
                                                            : "Delete"}
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                        <RecordingPlayer
                                            recording={currentRecording}
                                            onEditTitle={() => {
                                                setEditTitleValue(
                                                    currentRecording.filename,
                                                );
                                                setIsEditingTitle(true);
                                            }}
                                            isEditingTitle={isEditingTitle}
                                            editTitleValue={editTitleValue}
                                            onEditTitleChange={
                                                setEditTitleValue
                                            }
                                            onSaveTitle={handleSaveTitle}
                                            onCancelEdit={() =>
                                                setIsEditingTitle(false)
                                            }
                                            isSavingTitle={isSavingTitle}
                                            onSyncToPlaud={handleSyncToPlaud}
                                            isSyncingToPlaud={isSyncingToPlaud}
                                            onEnded={() => {
                                                const currentIndex =
                                                    recordings.findIndex(
                                                        (r) =>
                                                            r.id ===
                                                            currentRecording.id,
                                                    );
                                                if (
                                                    currentIndex >= 0 &&
                                                    currentIndex <
                                                        recordings.length - 1
                                                ) {
                                                    setCurrentRecording(
                                                        recordings[
                                                            currentIndex + 1
                                                        ],
                                                    );
                                                }
                                            }}
                                        />
                                        <TranscriptionPanel
                                            recording={currentRecording}
                                            transcription={
                                                currentTranscription?.text
                                                    ? currentTranscription
                                                    : localTranscription
                                                      ? {
                                                            text: localTranscription,
                                                        }
                                                      : undefined
                                            }
                                            isTranscribing={isTranscribing}
                                            onTranscribe={handleTranscribe}
                                            isDeletingTranscription={
                                                isDeletingTranscription
                                            }
                                            onDeleteTranscription={
                                                handleDeleteTranscription
                                            }
                                            isGeneratingTitle={
                                                isGeneratingTitle
                                            }
                                            onGenerateTitle={
                                                handleGenerateTitle
                                            }
                                            streamingText={streamingText}
                                            supportsDiarization={
                                                transcriptionProvider ===
                                                "Speaches"
                                            }
                                            onTranscribeDiarized={
                                                handleTranscribeDiarized
                                            }
                                            speakersJson={
                                                currentTranscription?.speakersJson ??
                                                localSpeakersJson
                                            }
                                        />
                                    </>
                                ) : (
                                    <Card>
                                        <CardContent className="py-16 text-center">
                                            <p className="text-muted-foreground">
                                                Select a recording to view
                                                details and transcription
                                            </p>
                                        </CardContent>
                                    </Card>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <SettingsDialog
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                initialProviders={providers}
                onReRunOnboarding={() => {
                    setSettingsOpen(false);
                    setOnboardingOpen(true);
                }}
            />

            <OnboardingDialog
                open={onboardingOpen}
                onOpenChange={setOnboardingOpen}
                onComplete={() => {
                    setOnboardingOpen(false);
                    router.refresh();
                }}
            />
        </>
    );
}
