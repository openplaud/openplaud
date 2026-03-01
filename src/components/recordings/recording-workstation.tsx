"use client";

import {
    ArrowLeft,
    BookOpen,
    Check,
    ExternalLink,
    Loader2,
    RefreshCw,
    Settings,
    X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { RecordingPlayer } from "@/components/dashboard/recording-player";
import { TranscriptionPanel } from "@/components/dashboard/transcription-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Recording } from "@/types/recording";

interface Transcription {
    text?: string;
    detectedLanguage?: string;
    transcriptionType?: string;
}

interface RecordingWorkstationProps {
    recording: Recording;
    transcription?: Transcription;
    notionSyncStatus?: string | null;
    notionPageUrl?: string | null;
    notionSyncError?: string | null;
    notionConfigured?: boolean;
}

export function RecordingWorkstation({
    recording,
    transcription,
    notionSyncStatus: initialNotionSyncStatus,
    notionPageUrl: initialNotionPageUrl,
    notionSyncError: initialNotionSyncError,
    notionConfigured = false,
}: RecordingWorkstationProps) {
    const router = useRouter();
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [notionSyncStatus, setNotionSyncStatus] = useState(
        initialNotionSyncStatus,
    );
    const [notionPageUrl, setNotionPageUrl] = useState(initialNotionPageUrl);
    const [notionSyncError, setNotionSyncError] = useState(
        initialNotionSyncError,
    );
    const [isNotionSyncing, setIsNotionSyncing] = useState(false);

    const handleNotionSync = useCallback(async () => {
        setIsNotionSyncing(true);
        setNotionSyncStatus("syncing");
        setNotionSyncError(null);

        try {
            const response = await fetch(
                `/api/recordings/${recording.id}/notion`,
                { method: "POST" },
            );

            if (response.ok) {
                toast.success("Notion sync gestart");
                // Poll for completion
                const pollInterval = setInterval(async () => {
                    try {
                        const statusRes = await fetch(
                            `/api/recordings/${recording.id}/notion`,
                        );
                        if (statusRes.ok) {
                            const data = await statusRes.json();
                            setNotionSyncStatus(data.notionSyncStatus);
                            setNotionPageUrl(data.notionPageUrl);
                            setNotionSyncError(data.notionSyncError);

                            if (
                                data.notionSyncStatus === "synced" ||
                                data.notionSyncStatus === "failed"
                            ) {
                                clearInterval(pollInterval);
                                setIsNotionSyncing(false);
                                if (data.notionSyncStatus === "synced") {
                                    toast.success("Opgeslagen in Notion");
                                } else {
                                    toast.error(
                                        data.notionSyncError ||
                                            "Notion sync mislukt",
                                    );
                                }
                            }
                        }
                    } catch {
                        clearInterval(pollInterval);
                        setIsNotionSyncing(false);
                    }
                }, 2000);

                // Timeout after 60 seconds
                setTimeout(() => {
                    clearInterval(pollInterval);
                    setIsNotionSyncing(false);
                }, 60000);
            } else {
                const error = await response.json();
                toast.error(error.error || "Notion sync mislukt");
                setNotionSyncStatus("failed");
                setIsNotionSyncing(false);
            }
        } catch {
            toast.error("Notion sync mislukt");
            setNotionSyncStatus("failed");
            setIsNotionSyncing(false);
        }
    }, [recording.id]);

    const handleTranscribe = useCallback(async () => {
        setIsTranscribing(true);
        try {
            const response = await fetch(
                `/api/recordings/${recording.id}/transcribe`,
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
    }, [recording.id, router]);

    return (
        <div className="bg-background">
            <div className="container mx-auto px-4 py-6 max-w-4xl">
                {/* Header */}
                <div className="flex items-center gap-4 mb-6">
                    <Button
                        onClick={() => router.push("/dashboard")}
                        variant="outline"
                        size="icon"
                    >
                        <ArrowLeft className="w-4 h-4" />
                    </Button>
                    <div className="flex-1 min-w-0">
                        <h1 className="text-3xl font-bold truncate">
                            {recording.filename}
                        </h1>
                        <p className="text-muted-foreground text-sm mt-1">
                            {new Date(recording.startTime).toLocaleString()}
                        </p>
                    </div>
                </div>

                {/* Content */}
                <div className="space-y-6">
                    <RecordingPlayer recording={recording} />
                    <TranscriptionPanel
                        recording={recording}
                        transcription={transcription}
                        isTranscribing={isTranscribing}
                        onTranscribe={handleTranscribe}
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
                                    <div className="font-medium">
                                        {new Date(
                                            recording.startTime,
                                        ).toLocaleDateString()}
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Notion Sync */}
                    {transcription?.text && (
                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base flex items-center gap-2">
                                    <BookOpen className="w-4 h-4" />
                                    Notion
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {!notionConfigured ? (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Settings className="w-4 h-4" />
                                        <span>
                                            Notion niet geconfigureerd.{" "}
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    router.push(
                                                        "/dashboard#notion",
                                                    )
                                                }
                                                className="text-primary underline hover:no-underline"
                                            >
                                                Configureer in instellingen
                                            </button>
                                        </span>
                                    </div>
                                ) : notionSyncStatus === "synced" ? (
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-sm">
                                            <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
                                            <span className="text-green-600 dark:text-green-400">
                                                Opgeslagen in Notion
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {notionPageUrl && (
                                                <a
                                                    href={notionPageUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-sm text-primary hover:underline flex items-center gap-1"
                                                >
                                                    Bekijk in Notion
                                                    <ExternalLink className="w-3 h-3" />
                                                </a>
                                            )}
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={handleNotionSync}
                                                disabled={isNotionSyncing}
                                            >
                                                <RefreshCw className="w-3 h-3" />
                                                Opnieuw opslaan
                                            </Button>
                                        </div>
                                    </div>
                                ) : notionSyncStatus === "syncing" ||
                                  isNotionSyncing ? (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span>Opslaan naar Notion...</span>
                                    </div>
                                ) : notionSyncStatus === "failed" ? (
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                                            <X className="w-4 h-4" />
                                            <span>
                                                Notion sync mislukt
                                                {notionSyncError
                                                    ? `: ${notionSyncError}`
                                                    : ""}
                                            </span>
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handleNotionSync}
                                            disabled={isNotionSyncing}
                                        >
                                            <RefreshCw className="w-3 h-3" />
                                            Opnieuw proberen
                                        </Button>
                                    </div>
                                ) : (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleNotionSync}
                                        disabled={isNotionSyncing}
                                    >
                                        <BookOpen className="w-4 h-4" />
                                        Opslaan in Notion
                                    </Button>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
}
