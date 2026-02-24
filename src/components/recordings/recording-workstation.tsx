"use client";

import { ArrowLeft, Scissors, Trash2, VolumeX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
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
}

export function RecordingWorkstation({
    recording,
    transcription,
}: RecordingWorkstationProps) {
    const router = useRouter();
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [isSplitting, setIsSplitting] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isRemovingSilence, setIsRemovingSilence] = useState(false);
    const [splitSegmentMinutes, setSplitSegmentMinutes] = useState<
        number | null
    >(null);

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

    const handleSplit = useCallback(async () => {
        setIsSplitting(true);
        try {
            const response = await fetch(
                `/api/recordings/${recording.id}/split`,
                { method: "POST" },
            );

            if (response.ok) {
                const data = await response.json();
                toast.success(
                    `Recording split into ${data.segmentCount} segments`,
                );
                router.push("/dashboard");
            } else {
                const error = await response.json();
                toast.error(error.error || "Failed to split recording");
            }
        } catch {
            toast.error("Failed to split recording");
        } finally {
            setIsSplitting(false);
        }
    }, [recording.id, router]);

    const handleDelete = useCallback(async () => {
        if (!window.confirm("Are you sure you want to delete this recording?"))
            return;
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

    const isProcessing =
        isDeleting || isRemovingSilence || isSplitting || isTranscribing;

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
                        <h1 className="text-3xl font-bold truncate">
                            {recording.filename}
                        </h1>
                        <p className="text-muted-foreground text-sm mt-1">
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
                    {splitSegmentMinutes !== null &&
                        recording.duration >
                            splitSegmentMinutes * 60 * 1000 && (
                            <Button
                                onClick={handleSplit}
                                variant="outline"
                                disabled={isProcessing}
                            >
                                <Scissors className="w-4 h-4 mr-2" />
                                {isSplitting
                                    ? "Splitting..."
                                    : "Split Recording"}
                            </Button>
                        )}
                    {(recording.plaudFileId.startsWith("split-") ||
                        recording.plaudFileId.startsWith(
                            "silence-removed-",
                        )) && (
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
                </div>
            </div>
        </div>
    );
}
