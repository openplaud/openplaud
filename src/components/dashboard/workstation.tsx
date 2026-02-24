"use client";

import {
    Mic,
    RefreshCw,
    Scissors,
    Settings,
    Trash2,
    VolumeX,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
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
import { RecordingList } from "./recording-list";
import { RecordingPlayer } from "./recording-player";
import { TranscriptionPanel } from "./transcription-panel";

interface TranscriptionData {
    text?: string;
    language?: string;
}

interface WorkstationProps {
    recordings: Recording[];
    transcriptions: Map<string, TranscriptionData>;
}

export function Workstation({ recordings, transcriptions }: WorkstationProps) {
    const router = useRouter();
    const [currentRecording, setCurrentRecording] = useState<Recording | null>(
        recordings.length > 0 ? recordings[0] : null,
    );
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [isDeletingTranscription, setIsDeletingTranscription] =
        useState(false);
    const [isSplitting, setIsSplitting] = useState(false);
    const [splitConflict, setSplitConflict] = useState<number | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isRemovingSilence, setIsRemovingSilence] = useState(false);
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

    const isProcessing =
        isSplitting ||
        isDeleting ||
        isRemovingSilence ||
        isTranscribing ||
        isDeletingTranscription;

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

    useEffect(() => {
        getSyncSettings().then(setSyncSettings);
    }, []);

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

    const handleTranscribe = useCallback(async () => {
        if (!currentRecording) return;

        setIsTranscribing(true);
        try {
            const response = await fetch(
                `/api/recordings/${currentRecording.id}/transcribe`,
                {
                    method: "POST",
                },
            );

            if (response.ok) {
                toast.success("Transcription complete");
                router.refresh();
            } else {
                const error = await response.json();
                toast.error(error.error || "Transcription failed");
            }
        } catch {
            toast.error("Failed to transcribe recording");
        } finally {
            setIsTranscribing(false);
        }
    }, [currentRecording, router]);

    const handleDeleteTranscription = useCallback(async () => {
        if (!currentRecording) return;
        if (
            !window.confirm(
                "Remove the transcription? Re-transcribing costs API credits.",
            )
        )
            return;

        setIsDeletingTranscription(true);
        try {
            const response = await fetch(
                `/api/recordings/${currentRecording.id}/transcribe`,
                { method: "DELETE" },
            );

            if (response.ok) {
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

    const handleDelete = useCallback(async () => {
        if (!currentRecording) return;

        // Confirm before irreversibly deleting
        if (
            !window.confirm(
                `Are you sure you want to delete "${currentRecording.filename}"? This cannot be undone.`,
            )
        ) {
            return;
        }

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
                                                        disabled={isProcessing}
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
                                            transcription={currentTranscription}
                                            isTranscribing={isTranscribing}
                                            onTranscribe={handleTranscribe}
                                            isDeletingTranscription={
                                                isDeletingTranscription
                                            }
                                            onDeleteTranscription={
                                                handleDeleteTranscription
                                            }
                                            disabled={isProcessing}
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
