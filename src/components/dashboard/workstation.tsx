"use client";

import { Command, Mic, RefreshCw, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CommandPalette } from "@/components/dashboard/command-palette";
import {
    type PendingUpload,
    RecordingList,
    type RecordingListHandle,
} from "@/components/dashboard/recording-list";
import { RecordingPlayer } from "@/components/dashboard/recording-player";
import { ShortcutsDialog } from "@/components/dashboard/shortcuts-dialog";
import { TranscriptionPanel } from "@/components/dashboard/transcription-panel";
import { UserMenu } from "@/components/dashboard/user-menu";
import { OnboardingDialog } from "@/components/onboarding-dialog";
import { SettingsDialog } from "@/components/settings-dialog";
import { SyncStatus } from "@/components/sync-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAutoSync } from "@/hooks/use-auto-sync";
import { useListKeyboardNav } from "@/hooks/use-list-keyboard-nav";
import { useTheme } from "@/hooks/use-theme";
import {
    requestNotificationPermission,
    showNewRecordingNotification,
    showSyncCompleteNotification,
} from "@/lib/notifications/browser";
import { SYNC_CONFIG } from "@/lib/sync-config";
import type { Recording } from "@/types/recording";

interface TranscriptionData {
    text?: string;
    language?: string;
}

interface InitialSettings {
    dateTimeFormat: "relative" | "absolute" | "iso";
    recordingListSortOrder: "newest" | "oldest" | "name";
    itemsPerPage: number;
    listDensity: "comfortable" | "compact";
    theme: "light" | "dark" | "system";
    defaultPlaybackSpeed: number;
    defaultVolume: number;
    autoPlayNext: boolean;
    playerScrubber: "waveform" | "slider";
    syncInterval: number;
    autoSyncEnabled: boolean;
    syncOnMount: boolean;
    syncOnVisibilityChange: boolean;
    syncNotifications: boolean;
    browserNotifications: boolean;
}

interface WorkstationProps {
    recordings: Recording[];
    transcriptions: Map<string, TranscriptionData>;
    /**
     * When true, an admin shortcut appears in the avatar menu. Set by the
     * server-rendered page based on env.ADMIN_EMAILS membership; never
     * trusted client-side — the actual /admin gate runs server-side.
     */
    isAdmin?: boolean;
    initialSettings: InitialSettings;
}

export function Workstation({
    recordings,
    transcriptions,
    isAdmin = false,
    initialSettings,
}: WorkstationProps) {
    const router = useRouter();
    const [currentRecording, setCurrentRecording] = useState<Recording | null>(
        recordings.length > 0 ? recordings[0] : null,
    );
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [onboardingOpen, setOnboardingOpen] = useState(false);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
    const [inFlightActions, setInFlightActions] = useState<
        Map<string, "transcribing" | "summarizing">
    >(new Map());
    const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
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

    const { setTheme } = useTheme(initialSettings.theme);

    const listRef = useRef<RecordingListHandle>(null);

    // Filter out optimistically-hidden (deleted) rows.
    const visibleRecordings = useMemo(
        () => recordings.filter((r) => !hiddenIds.has(r.id)),
        [recordings, hiddenIds],
    );

    const currentTranscription = currentRecording
        ? transcriptions.get(currentRecording.id)
        : undefined;

    const isProcessing = isTranscribing || isUploading;

    // Keep currentRecording in sync with the recordings prop (updated
    // after router.refresh()). If the previously-selected recording is no
    // longer present (e.g. just deleted), clear the selection.
    useEffect(() => {
        setCurrentRecording((prev) => {
            if (!prev) return prev;
            const updated = recordings.find((r) => r.id === prev.id);
            return updated ?? null;
        });
        // When server data comes back, clear any optimistic hides whose
        // rows no longer exist server-side (deletion confirmed).
        setHiddenIds((prev) => {
            if (prev.size === 0) return prev;
            const next = new Set<string>();
            const ids = new Set(recordings.map((r) => r.id));
            for (const id of prev) {
                if (ids.has(id)) next.add(id); // still present → keep hidden until confirmed
            }
            return next.size === prev.size ? prev : next;
        });
    }, [recordings]);

    const {
        isAutoSyncing,
        lastSyncTime,
        nextSyncTime,
        lastSyncResult,
        manualSync,
    } = useAutoSync({
        interval: initialSettings.syncInterval ?? SYNC_CONFIG.defaultInterval,
        minInterval: SYNC_CONFIG.minInterval,
        syncOnMount: initialSettings.syncOnMount,
        syncOnVisibilityChange: initialSettings.syncOnVisibilityChange,
        enabled: initialSettings.autoSyncEnabled,
        onSuccess: (newRecordings) => {
            if (initialSettings.syncNotifications !== false) {
                if (newRecordings > 0) {
                    toast.success(
                        `Synced ${newRecordings} new recording${newRecordings !== 1 ? "s" : ""}`,
                    );
                } else {
                    toast.success("Sync complete - no new recordings");
                }
            }
            if (initialSettings.browserNotifications) {
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

    const markAction = useCallback(
        (id: string, kind: "transcribing" | "summarizing" | null) => {
            setInFlightActions((prev) => {
                const next = new Map(prev);
                if (kind === null) next.delete(id);
                else next.set(id, kind);
                return next;
            });
        },
        [],
    );

    const handleTranscribe = useCallback(async () => {
        if (!currentRecording) return;
        const id = currentRecording.id;
        markAction(id, "transcribing");
        setIsTranscribing(true);
        try {
            const response = await fetch(`/api/recordings/${id}/transcribe`, {
                method: "POST",
            });
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
            markAction(id, null);
        }
    }, [currentRecording, router, markAction]);

    const handleUpload = useCallback(
        async (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file) return;
            e.target.value = "";

            // Optimistic placeholder in the list.
            const placeholderId = `pending:${Date.now()}:${Math.random()
                .toString(36)
                .slice(2)}`;
            setPendingUploads((prev) => [
                ...prev,
                {
                    id: placeholderId,
                    filename: file.name,
                    filesize: file.size,
                },
            ]);

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
                setPendingUploads((prev) =>
                    prev.filter((p) => p.id !== placeholderId),
                );
            }
        },
        [router],
    );

    const handleDelete = useCallback(
        async (recording: Recording) => {
            const id = recording.id;
            // Optimistic hide.
            setHiddenIds((prev) => new Set(prev).add(id));
            const wasCurrent = currentRecording?.id === id;
            if (wasCurrent) {
                const idx = visibleRecordings.findIndex((r) => r.id === id);
                const next =
                    visibleRecordings[idx + 1] ??
                    visibleRecordings[idx - 1] ??
                    null;
                setCurrentRecording(next);
            }
            try {
                const res = await fetch(`/api/recordings/${id}`, {
                    method: "DELETE",
                });
                if (!res.ok) throw new Error("Delete failed");
                toast.success("Recording deleted");
                router.refresh();
            } catch (err) {
                // Rollback
                setHiddenIds((prev) => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                });
                if (wasCurrent) setCurrentRecording(recording);
                throw err;
            }
        },
        [currentRecording, visibleRecordings, router],
    );

    const triggerUpload = useCallback(() => {
        uploadInputRef.current?.click();
    }, []);

    // Keyboard shortcuts (global).
    useListKeyboardNav({
        onNext: () => listRef.current?.next(),
        onPrev: () => listRef.current?.prev(),
        onFocusSearch: () => listRef.current?.focusSearch(),
        onOpenPalette: () => setPaletteOpen(true),
        onOpenShortcuts: () => setShortcutsOpen(true),
        onOpenSettings: () => setSettingsOpen(true),
        enabled: !settingsOpen && !onboardingOpen && !paletteOpen,
    });

    return (
        <>
            <div className="bg-background">
                <div className="container mx-auto max-w-7xl px-4 py-6">
                    <div className="sticky top-0 z-30 -mx-4 mb-6 flex flex-col gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 md:flex-row md:items-center md:justify-between">
                        <div className="flex items-baseline gap-3">
                            <h1 className="text-2xl font-bold leading-tight md:text-3xl">
                                Recordings
                            </h1>
                            <p className="text-sm text-muted-foreground">
                                {visibleRecordings.length} recording
                                {visibleRecordings.length !== 1 ? "s" : ""}
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <SyncStatus
                                lastSyncTime={lastSyncTime}
                                nextSyncTime={nextSyncTime}
                                isAutoSyncing={isAutoSyncing}
                                lastSyncResult={lastSyncResult}
                                className="hidden md:flex"
                            />
                            <Button
                                onClick={() => setPaletteOpen(true)}
                                variant="outline"
                                size="sm"
                                className="hidden h-9 md:inline-flex"
                                aria-label="Open command palette"
                                title="Command palette (⌘K)"
                            >
                                <Command className="mr-2 size-4" />
                                <span>Search</span>
                                <kbd className="ml-2 hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground lg:inline">
                                    ⌘K
                                </kbd>
                            </Button>
                            <Button
                                onClick={handleSync}
                                disabled={isAutoSyncing}
                                variant="outline"
                                size="sm"
                                className="h-9"
                            >
                                {isAutoSyncing ? (
                                    <>
                                        <RefreshCw className="mr-2 size-4 animate-spin" />
                                        Syncing...
                                    </>
                                ) : (
                                    <>
                                        <RefreshCw className="mr-2 size-4" />
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
                                onClick={triggerUpload}
                                disabled={isProcessing}
                                variant="outline"
                                size="sm"
                                className="h-9"
                            >
                                <Upload className="mr-2 size-4" />
                                {isUploading ? "Uploading..." : "Upload Audio"}
                            </Button>
                            <UserMenu
                                isAdmin={isAdmin}
                                initialTheme={initialSettings.theme}
                                onOpenSettings={() => setSettingsOpen(true)}
                                onOpenShortcuts={() => setShortcutsOpen(true)}
                            />
                        </div>
                    </div>

                    {visibleRecordings.length === 0 &&
                    pendingUploads.length === 0 ? (
                        <Card>
                            <CardContent className="flex flex-col items-center justify-center py-16">
                                <Mic className="mb-4 size-16 text-muted-foreground" />
                                <h3 className="mb-2 text-lg font-semibold">
                                    No recordings yet
                                </h3>
                                <p className="mb-6 max-w-md text-center text-sm text-muted-foreground">
                                    Sync your Plaud device to import your
                                    recordings and start transcribing them.
                                </p>
                                <div className="flex gap-2">
                                    <Button
                                        onClick={handleSync}
                                        disabled={isAutoSyncing}
                                    >
                                        {isAutoSyncing ? (
                                            <>
                                                <RefreshCw className="mr-2 size-4 animate-spin" />
                                                Syncing...
                                            </>
                                        ) : (
                                            <>
                                                <RefreshCw className="mr-2 size-4" />
                                                Sync Device
                                            </>
                                        )}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={triggerUpload}
                                    >
                                        <Upload className="mr-2 size-4" />
                                        Upload Audio
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                            <div className="lg:col-span-1">
                                <RecordingList
                                    ref={listRef}
                                    recordings={visibleRecordings}
                                    transcriptions={transcriptions}
                                    currentRecording={currentRecording}
                                    pendingUploads={pendingUploads}
                                    inFlightActions={inFlightActions}
                                    onSelect={setCurrentRecording}
                                    onDelete={handleDelete}
                                    initialDateTimeFormat={
                                        initialSettings.dateTimeFormat
                                    }
                                    initialSortOrder={
                                        initialSettings.recordingListSortOrder
                                    }
                                    initialDensity={initialSettings.listDensity}
                                    initialChunkSize={
                                        initialSettings.itemsPerPage
                                    }
                                />
                            </div>

                            <div className="space-y-6 lg:col-span-2">
                                {currentRecording ? (
                                    <>
                                        <RecordingPlayer
                                            recording={currentRecording}
                                            initialPlaybackSpeed={
                                                initialSettings.defaultPlaybackSpeed
                                            }
                                            initialVolume={
                                                initialSettings.defaultVolume
                                            }
                                            initialAutoPlayNext={
                                                initialSettings.autoPlayNext
                                            }
                                            scrubberStyle={
                                                initialSettings.playerScrubber
                                            }
                                            onEnded={() => {
                                                const currentIndex =
                                                    visibleRecordings.findIndex(
                                                        (r) =>
                                                            r.id ===
                                                            currentRecording.id,
                                                    );
                                                if (
                                                    currentIndex >= 0 &&
                                                    currentIndex <
                                                        visibleRecordings.length -
                                                            1
                                                ) {
                                                    setCurrentRecording(
                                                        visibleRecordings[
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

            <CommandPalette
                open={paletteOpen}
                onOpenChange={setPaletteOpen}
                recordings={visibleRecordings}
                onSelectRecording={setCurrentRecording}
                onSync={handleSync}
                onUpload={triggerUpload}
                onOpenSettings={() => setSettingsOpen(true)}
                onOpenShortcuts={() => setShortcutsOpen(true)}
                onSetTheme={setTheme}
            />

            <ShortcutsDialog
                open={shortcutsOpen}
                onOpenChange={setShortcutsOpen}
            />

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
