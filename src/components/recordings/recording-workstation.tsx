"use client";

import { ArrowLeft } from "lucide-react";
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
}

export function RecordingWorkstation({
    recording,
    transcription,
}: RecordingWorkstationProps) {
    const router = useRouter();
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [isDeletingTranscription, setIsDeletingTranscription] =
        useState(false);

    const anyBusy = isTranscribing || isDeletingTranscription;

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
        if (
            !window.confirm(
                "Remove the transcription? Re-transcribing costs API credits.",
            )
        )
            return;
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
                        isDeletingTranscription={isDeletingTranscription}
                        onDeleteTranscription={handleDeleteTranscription}
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
