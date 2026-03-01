"use client";

import { BookOpen, Mic, RefreshCw, Settings } from "lucide-react";
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
    notionSyncStatuses?: Map<string, string>;
}

export function Workstation({
    recordings,
    transcriptions,
    notionSyncStatuses,
}: WorkstationProps) {
    const router = useRouter();
    const [currentRecording, setCurrentRecording] = useState<Recording | null>(
        recordings.length > 0 ? recordings[0] : null,
    );
    const [isTranscribing, setIsTranscribing] = useState(false);
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
    const [notionConfigured, setNotionConfigured] = useState(false);

    const currentTranscription = currentRecording
        ? transcriptions.get(currentRecording.id)
        : undefined;

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
            } catch {
                // best-effort; ignore
            }
        };

        fetchNotificationPrefs();
    }, []);

    useEffect(() => {
        fetch("/api/settings/notion")
            .then((res) => res.json())
            .then((data) => {
                setNotionConfigured(!!data.config?.enabled);
            })
            .catch(() => {});
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
                            {notionConfigured && (
                                <div
                                    className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground"
                                    title="Notion integration active"
                                >
                                    <BookOpen className="w-3.5 h-3.5" />
                                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                </div>
                            )}
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
                                    onSelect={setCurrentRecording}
                                    notionSyncStatuses={notionSyncStatuses}
                                />
                            </div>

                            <div className="lg:col-span-2 space-y-6">
                                {currentRecording ? (
                                    <>
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
