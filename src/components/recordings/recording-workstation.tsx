"use client";

import { ArrowLeft, CloudUpload, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { RecordingPlayer } from "@/components/dashboard/recording-player";
import { TranscriptionPanel } from "@/components/dashboard/transcription-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Recording } from "@/types/recording";

interface Transcription {
    text?: string;
    detectedLanguage?: string;
    transcriptionType?: string;
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
    const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [editTitleValue, setEditTitleValue] = useState("");
    const [isSavingTitle, setIsSavingTitle] = useState(false);
    const [isSyncingToPlaud, setIsSyncingToPlaud] = useState(false);
    const cancelledRef = useRef(false);

    const anyBusy =
        isTranscribing ||
        isGeneratingTitle ||
        isEditingTitle ||
        isSavingTitle ||
        isSyncingToPlaud;

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
                setIsEditingTitle(false);
            }
        } catch {
            toast.error("Failed to save title");
            setIsEditingTitle(false);
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
                router.refresh();
            } else {
                const error = await response.json();
                toast.error(error.error || "Failed to sync title");
            }
        } catch {
            toast.error("Failed to sync title");
        } finally {
            setIsSyncingToPlaud(false);
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
                        <div className="flex items-center gap-1 min-w-0">
                            {isEditingTitle ? (
                                <Input
                                    value={editTitleValue}
                                    onChange={(e) =>
                                        setEditTitleValue(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            cancelledRef.current = false;
                                            e.currentTarget.blur();
                                        }
                                        if (e.key === "Escape") {
                                            cancelledRef.current = true;
                                            e.currentTarget.blur();
                                        }
                                    }}
                                    onBlur={() => {
                                        if (cancelledRef.current)
                                            setIsEditingTitle(false);
                                        else handleSaveTitle();
                                        cancelledRef.current = false;
                                    }}
                                    disabled={isSavingTitle}
                                    className="text-2xl font-bold h-auto py-0.5 flex-1"
                                    autoFocus
                                />
                            ) : (
                                <h1 className="text-3xl font-bold truncate flex-1">
                                    {recording.filename}
                                </h1>
                            )}
                            {!isEditingTitle && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="shrink-0"
                                    disabled={anyBusy}
                                    onClick={() => {
                                        cancelledRef.current = false;
                                        setEditTitleValue(recording.filename);
                                        setIsEditingTitle(true);
                                    }}
                                    title="Edit title"
                                >
                                    <Pencil className="w-4 h-4" />
                                </Button>
                            )}
                            {!recording.plaudFileId.startsWith("split-") &&
                                !recording.plaudFileId.startsWith(
                                    "silence-removed-",
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
                        isGeneratingTitle={isGeneratingTitle}
                        onGenerateTitle={handleGenerateTitle}
                        disabled={anyBusy}
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
                </div>
            </div>
        </div>
    );
}
