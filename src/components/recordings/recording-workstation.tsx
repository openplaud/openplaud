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
import { isPlaudLocallyCreated } from "@/lib/plaud/sync-title";
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
    const [isDeletingTranscription, setIsDeletingTranscription] =
        useState(false);
    const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [editTitleValue, setEditTitleValue] = useState("");
    const [isSavingTitle, setIsSavingTitle] = useState(false);
    const [isSyncingToPlaud, setIsSyncingToPlaud] = useState(false);
    const [isSplitting, setIsSplitting] = useState(false);
    const [splitConflict, setSplitConflict] = useState<number | null>(null);
    const cancelledRef = useRef(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isRemovingSilence, setIsRemovingSilence] = useState(false);
    const [splitSegmentMinutes, setSplitSegmentMinutes] = useState(60);

    const anyBusy =
        isTranscribing ||
        isDeletingTranscription ||
        isGeneratingTitle ||
        isSavingTitle ||
        isSyncingToPlaud ||
        isSplitting ||
        isDeleting ||
        isRemovingSilence;

    useEffect(() => {
        fetch("/api/settings/user")
            .then((res) => {
                if (!res.ok) throw new Error("Failed to fetch user settings");
                return res.json();
            })
            .then((data) =>
                setSplitSegmentMinutes(data.splitSegmentMinutes ?? 60),
            )
            .catch((err) => {
                console.error("Failed to load user settings:", err);
                setSplitSegmentMinutes(60); // fallback so Split button is not permanently hidden
            });
    }, []);

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

    const handleDeleteTranscription = useCallback(async () => {
        setIsDeletingTranscription(true);
        try {
            const response = await fetch(
                `/api/recordings/${recording.id}/transcribe`,
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
                            {!isPlaudLocallyCreated(recording.plaudFileId) &&
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
                    <Button
                        onClick={handleRemoveSilence}
                        variant="outline"
                        disabled={isRemovingSilence}
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
                                        disabled={isSplitting}
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
                                disabled={isSplitting}
                            >
                                <Scissors className="w-4 h-4 mr-2" />
                                {isSplitting
                                    ? "Splitting..."
                                    : "Split Recording"}
                            </Button>
                        </div>
                    )}
                    {isPlaudLocallyCreated(recording.plaudFileId) && (
                        <Button
                            onClick={handleDelete}
                            variant="outline"
                            disabled={isDeleting}
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
                        transcription={transcription}
                        isTranscribing={isTranscribing}
                        onTranscribe={handleTranscribe}
                        isDeletingTranscription={isDeletingTranscription}
                        onDeleteTranscription={handleDeleteTranscription}
                        isGeneratingTitle={isGeneratingTitle}
                        onGenerateTitle={handleGenerateTitle}
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
