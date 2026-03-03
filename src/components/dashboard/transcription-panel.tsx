"use client";

import {
    FileText,
    Languages,
    Sparkles,
    Tag,
    Trash2,
    Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Recording } from "@/types/recording";
import type { DiarizedSegment } from "@/types/transcription";

interface Transcription {
    text?: string;
    language?: string;
    speakersJson?: DiarizedSegment[];
}

interface TranscriptionPanelProps {
    recording: Recording;
    transcription?: Transcription;
    isTranscribing: boolean;
    onTranscribe: () => void;
    isDeletingTranscription?: boolean;
    onDeleteTranscription?: () => void;
    isGeneratingTitle?: boolean;
    onGenerateTitle?: () => void;
    /** When true, disables all action buttons to prevent concurrent mutations */
    disabled?: boolean;
    /** Live text being streamed during Speaches transcription */
    streamingText?: string;
    /** Status message showing the current processing step */
    statusMessage?: string;
    /** Show "Generate with Speakers" button */
    supportsDiarization?: boolean;
    /** Called when user clicks "Generate with Speakers" */
    onTranscribeDiarized?: () => void;
    /** Diarized speaker segments — shown instead of plain text when present */
    speakersJson?: DiarizedSegment[];
}

const SPEAKER_COLORS = [
    "bg-blue-100 border-blue-300 dark:bg-blue-900/30 dark:border-blue-700",
    "bg-orange-100 border-orange-300 dark:bg-orange-900/30 dark:border-orange-700",
    "bg-green-100 border-green-300 dark:bg-green-900/30 dark:border-green-700",
    "bg-purple-100 border-purple-300 dark:bg-purple-900/30 dark:border-purple-700",
    "bg-red-100 border-red-300 dark:bg-red-900/30 dark:border-red-700",
    "bg-yellow-100 border-yellow-300 dark:bg-yellow-900/30 dark:border-yellow-700",
    "bg-pink-100 border-pink-300 dark:bg-pink-900/30 dark:border-pink-700",
    "bg-cyan-100 border-cyan-300 dark:bg-cyan-900/30 dark:border-cyan-700",
];

const SPEAKER_LABEL_COLORS = [
    "text-blue-700 dark:text-blue-300",
    "text-orange-700 dark:text-orange-300",
    "text-green-700 dark:text-green-300",
    "text-purple-700 dark:text-purple-300",
    "text-red-700 dark:text-red-300",
    "text-yellow-700 dark:text-yellow-300",
    "text-pink-700 dark:text-pink-300",
    "text-cyan-700 dark:text-cyan-300",
];

interface SpeakerGroup {
    speaker: string;
    text: string;
    start?: number;
}

function groupConsecutiveSpeakers(segments: DiarizedSegment[]): SpeakerGroup[] {
    const groups: SpeakerGroup[] = [];
    for (const seg of segments) {
        const last = groups[groups.length - 1];
        if (last && last.speaker === seg.speaker) {
            last.text += ` ${seg.text}`;
        } else {
            groups.push({
                speaker: seg.speaker,
                text: seg.text,
                start: seg.start,
            });
        }
    }
    return groups;
}

function formatTimestamp(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getSpeakerNumber(
    speakerMap: Map<string, number>,
    speaker: string,
): number {
    if (!speakerMap.has(speaker)) {
        speakerMap.set(speaker, speakerMap.size);
    }
    // biome-ignore lint/style/noNonNullAssertion: just set above
    return speakerMap.get(speaker)!;
}

export function TranscriptionPanel({
    recording: _recording,
    transcription,
    isTranscribing,
    onTranscribe,
    isDeletingTranscription,
    onDeleteTranscription,
    isGeneratingTitle,
    onGenerateTitle,
    disabled,
    streamingText,
    statusMessage,
    supportsDiarization,
    onTranscribeDiarized,
    speakersJson,
}: TranscriptionPanelProps) {
    // Use speakersJson from props (local state during transcription) or from
    // the transcription record (persisted data). Props take precedence because
    // they reflect the most recently completed diarized transcription before
    // router.refresh() delivers the updated server data.
    const activeSpeakersJson = speakersJson ?? transcription?.speakersJson;

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                        <FileText className="w-5 h-5" />
                        Transcription
                        {activeSpeakersJson &&
                            activeSpeakersJson.length > 0 && (
                                <span className="text-xs font-normal text-muted-foreground flex items-center gap-1">
                                    <Users className="w-3 h-3" />
                                    Speaker detection
                                </span>
                            )}
                    </CardTitle>
                    {transcription?.text && (
                        <div className="flex items-center gap-2">
                            {onGenerateTitle && (
                                <Button
                                    onClick={onGenerateTitle}
                                    variant="outline"
                                    size="sm"
                                    disabled={isGeneratingTitle || disabled}
                                >
                                    <Tag className="w-4 h-4 mr-2" />
                                    {isGeneratingTitle
                                        ? "Generating..."
                                        : "Generate Title"}
                                </Button>
                            )}
                            {onDeleteTranscription && (
                                <Button
                                    onClick={onDeleteTranscription}
                                    variant="outline"
                                    size="sm"
                                    disabled={
                                        isDeletingTranscription || disabled
                                    }
                                    className="text-destructive hover:text-destructive"
                                >
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    {isDeletingTranscription
                                        ? "Removing..."
                                        : "Remove Transcription"}
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            </CardHeader>
            <CardContent>
                {isTranscribing ? (
                    streamingText ? (
                        <div className="space-y-3">
                            <div className="bg-muted rounded-lg p-4 max-h-96 overflow-y-auto">
                                <p className="text-sm whitespace-pre-wrap leading-relaxed">
                                    {streamingText}
                                </p>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span className="animate-pulse inline-block w-2 h-2 bg-primary rounded-full" />
                                <span>Transcribing...</span>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-12">
                            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mb-4" />
                            <p className="text-sm text-muted-foreground">
                                {statusMessage || "Transcribing audio..."}
                            </p>
                        </div>
                    )
                ) : transcription?.text ? (
                    <div className="space-y-4">
                        {activeSpeakersJson && activeSpeakersJson.length > 0 ? (
                            <SpeakerView segments={activeSpeakersJson} />
                        ) : (
                            <div className="bg-muted rounded-lg p-4 max-h-96 overflow-y-auto">
                                <p className="text-sm whitespace-pre-wrap leading-relaxed">
                                    {transcription.text}
                                </p>
                            </div>
                        )}
                        <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
                            {transcription.language && (
                                <div className="flex items-center gap-1">
                                    <Languages className="w-3 h-3" />
                                    <span>
                                        Language: {transcription.language}
                                    </span>
                                </div>
                            )}
                            <div>
                                {transcription.text.split(/\s+/).length} words
                            </div>
                            <div>{transcription.text.length} characters</div>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <FileText className="w-12 h-12 text-muted-foreground mb-4" />
                        <p className="text-sm text-muted-foreground mb-4">
                            No transcription available
                        </p>
                        <div className="flex flex-col items-center gap-2">
                            <Button
                                onClick={onTranscribe}
                                size="sm"
                                disabled={disabled}
                            >
                                <Sparkles className="w-4 h-4 mr-2" />
                                Generate Transcription
                            </Button>
                            {supportsDiarization && onTranscribeDiarized && (
                                <Button
                                    onClick={onTranscribeDiarized}
                                    variant="outline"
                                    size="sm"
                                    disabled={disabled}
                                >
                                    <Users className="w-4 h-4 mr-2" />
                                    Generate with Speakers
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function SpeakerView({ segments }: { segments: DiarizedSegment[] }) {
    const speakerMap = new Map<string, number>();
    const groups = groupConsecutiveSpeakers(segments);

    return (
        <div className="max-h-96 overflow-y-auto pr-1">
            {groups.map((group, idx) => {
                const speakerIdx =
                    getSpeakerNumber(speakerMap, group.speaker) %
                    SPEAKER_COLORS.length;
                const colorClass = SPEAKER_COLORS[speakerIdx];
                const labelClass = SPEAKER_LABEL_COLORS[speakerIdx];
                const speakerLabel = `Speaker ${speakerIdx + 1}`;

                return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static list, no reordering
                    <div key={idx}>
                        {/* Blank-line separator: a <br> between block-level
                            cards produces an empty line in copy-paste output. */}
                        {idx > 0 && (
                            <br
                                style={{ lineHeight: 0, fontSize: 0 }}
                                aria-hidden="true"
                            />
                        )}
                        <div
                            className={`rounded-lg border p-3 ${colorClass} ${idx > 0 ? "mt-3" : ""}`}
                        >
                            <div
                                className={`text-xs font-semibold mb-1 ${labelClass}`}
                            >
                                {group.start !== undefined && (
                                    <>
                                        <span className="font-mono font-normal text-muted-foreground">
                                            {formatTimestamp(group.start)}
                                        </span>
                                        {"  "}
                                    </>
                                )}
                                <span>{speakerLabel}</span>
                            </div>
                            <div className="text-sm leading-relaxed">
                                {group.text}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
