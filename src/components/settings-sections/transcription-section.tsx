"use client";

import { FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";

const languageOptions = [
    { label: "Auto-detect", value: null },
    { label: "English", value: "en" },
    { label: "Spanish", value: "es" },
    { label: "French", value: "fr" },
    { label: "German", value: "de" },
    { label: "Italian", value: "it" },
    { label: "Portuguese", value: "pt" },
    { label: "Chinese", value: "zh" },
    { label: "Japanese", value: "ja" },
    { label: "Korean", value: "ko" },
    { label: "Russian", value: "ru" },
];

const qualityOptions = [
    {
        label: "Fast",
        value: "fast",
        description: "Faster transcription, lower accuracy",
    },
    {
        label: "Balanced",
        value: "balanced",
        description: "Good balance of speed and accuracy",
    },
    {
        label: "Accurate",
        value: "accurate",
        description: "Highest accuracy, slower transcription",
    },
];

export function TranscriptionSection() {
    const { isLoadingSettings, isSavingSettings, setIsLoadingSettings } =
        useSettings();
    const [autoTranscribe, setAutoTranscribe] = useState(false);
    const [defaultTranscriptionLanguage, setDefaultTranscriptionLanguage] =
        useState<string | null>(null);
    const [transcriptionQuality, setTranscriptionQuality] =
        useState("balanced");
    const [autoGenerateTitle, setAutoGenerateTitle] = useState(true);
    const [syncTitleToPlaud, setSyncTitleToPlaud] = useState(false);
    const [splitSegmentMinutes, setSplitSegmentMinutes] = useState(60);
    const [silenceThresholdDb, setSilenceThresholdDb] = useState(-40);
    const [silenceDurationSeconds, setSilenceDurationSeconds] = useState(1.0);
    const pendingChangesRef = useRef<Map<string, unknown>>(new Map());

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await fetch("/api/settings/user");
                if (response.ok) {
                    const data = await response.json();
                    setAutoTranscribe(data.autoTranscribe ?? false);
                    setDefaultTranscriptionLanguage(
                        data.defaultTranscriptionLanguage ?? null,
                    );
                    setTranscriptionQuality(
                        data.transcriptionQuality ?? "balanced",
                    );
                    setAutoGenerateTitle(data.autoGenerateTitle ?? true);
                    setSyncTitleToPlaud(data.syncTitleToPlaud ?? false);
                    setSplitSegmentMinutes(data.splitSegmentMinutes ?? 60);
                    setSilenceThresholdDb(data.silenceThresholdDb ?? -40);
                    setSilenceDurationSeconds(data.silenceDurationSeconds ?? 1.0);
                }
            } catch (error) {
                console.error("Failed to fetch settings:", error);
            } finally {
                setIsLoadingSettings(false);
            }
        };
        fetchSettings();
    }, [setIsLoadingSettings]);

    const handleAutoTranscribeChange = async (checked: boolean) => {
        const previous = autoTranscribe;
        setAutoTranscribe(checked);
        pendingChangesRef.current.set("autoTranscribe", previous);

        try {
            const response = await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ autoTranscribe: checked }),
            });

            if (!response.ok) {
                throw new Error("Failed to save settings");
            }

            pendingChangesRef.current.delete("autoTranscribe");
        } catch {
            setAutoTranscribe(previous);
            pendingChangesRef.current.delete("autoTranscribe");
            toast.error("Failed to save settings. Changes reverted.");
        }
    };

    const handleTranscriptionSettingChange = async (updates: {
        defaultTranscriptionLanguage?: string | null;
        transcriptionQuality?: string;
        autoGenerateTitle?: boolean;
        syncTitleToPlaud?: boolean;
    }) => {
        if (updates.defaultTranscriptionLanguage !== undefined) {
            const previous = defaultTranscriptionLanguage;
            setDefaultTranscriptionLanguage(
                updates.defaultTranscriptionLanguage,
            );
            pendingChangesRef.current.set(
                "defaultTranscriptionLanguage",
                previous,
            );
        }
        if (updates.transcriptionQuality !== undefined) {
            const previous = transcriptionQuality;
            setTranscriptionQuality(updates.transcriptionQuality);
            pendingChangesRef.current.set("transcriptionQuality", previous);
        }
        if (updates.autoGenerateTitle !== undefined) {
            const previous = autoGenerateTitle;
            setAutoGenerateTitle(updates.autoGenerateTitle);
            pendingChangesRef.current.set("autoGenerateTitle", previous);
        }
        if (updates.syncTitleToPlaud !== undefined) {
            const previous = syncTitleToPlaud;
            setSyncTitleToPlaud(updates.syncTitleToPlaud);
            pendingChangesRef.current.set("syncTitleToPlaud", previous);
        }

        try {
            const response = await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updates),
            });

            if (!response.ok) {
                throw new Error("Failed to save settings");
            }

            if (updates.defaultTranscriptionLanguage !== undefined) {
                pendingChangesRef.current.delete(
                    "defaultTranscriptionLanguage",
                );
            }
            if (updates.transcriptionQuality !== undefined) {
                pendingChangesRef.current.delete("transcriptionQuality");
            }
            if (updates.autoGenerateTitle !== undefined) {
                pendingChangesRef.current.delete("autoGenerateTitle");
            }
            if (updates.syncTitleToPlaud !== undefined) {
                pendingChangesRef.current.delete("syncTitleToPlaud");
            }
        } catch {
            if (updates.defaultTranscriptionLanguage !== undefined) {
                const previous = pendingChangesRef.current.get(
                    "defaultTranscriptionLanguage",
                );
                if (
                    previous !== undefined &&
                    (typeof previous === "string" || previous === null)
                ) {
                    setDefaultTranscriptionLanguage(previous);
                    pendingChangesRef.current.delete(
                        "defaultTranscriptionLanguage",
                    );
                }
            }
            if (updates.transcriptionQuality !== undefined) {
                const previous = pendingChangesRef.current.get(
                    "transcriptionQuality",
                );
                if (previous !== undefined && typeof previous === "string") {
                    setTranscriptionQuality(previous);
                    pendingChangesRef.current.delete("transcriptionQuality");
                }
            }
            if (updates.autoGenerateTitle !== undefined) {
                const previous =
                    pendingChangesRef.current.get("autoGenerateTitle");
                if (previous !== undefined && typeof previous === "boolean") {
                    setAutoGenerateTitle(previous);
                    pendingChangesRef.current.delete("autoGenerateTitle");
                }
            }
            if (updates.syncTitleToPlaud !== undefined) {
                const previous =
                    pendingChangesRef.current.get("syncTitleToPlaud");
                if (previous !== undefined && typeof previous === "boolean") {
                    setSyncTitleToPlaud(previous);
                    pendingChangesRef.current.delete("syncTitleToPlaud");
                }
            }
            toast.error("Failed to save settings. Changes reverted.");
        }
    };

    const handleSilenceSettingChange = async (updates: {
        silenceThresholdDb?: number;
        silenceDurationSeconds?: number;
    }) => {
        const previousThreshold = silenceThresholdDb;
        const previousDuration = silenceDurationSeconds;
        if (updates.silenceThresholdDb !== undefined) setSilenceThresholdDb(updates.silenceThresholdDb);
        if (updates.silenceDurationSeconds !== undefined) setSilenceDurationSeconds(updates.silenceDurationSeconds);
        try {
            const response = await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updates),
            });
            if (!response.ok) throw new Error("Failed to save settings");
        } catch {
            setSilenceThresholdDb(previousThreshold);
            setSilenceDurationSeconds(previousDuration);
            toast.error("Failed to save settings. Changes reverted.");
        }
    };

    const handleSplitSegmentMinutesChange = async (value: number) => {
        const previous = splitSegmentMinutes;
        setSplitSegmentMinutes(value);
        try {
            const response = await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ splitSegmentMinutes: value }),
            });
            if (!response.ok) {
                throw new Error("Failed to save settings");
            }
        } catch {
            setSplitSegmentMinutes(previous);
            toast.error("Failed to save settings. Changes reverted.");
        }
    };

    if (isLoadingSettings) {
        return (
            <div className="flex items-center justify-center py-8">
                <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <h2 className="text-lg font-semibold flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Transcription Settings
            </h2>
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div className="space-y-0.5 flex-1">
                        <Label htmlFor="auto-transcribe" className="text-base">
                            Auto-transcribe new recordings
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            Automatically transcribe recordings when they are
                            synced from your Plaud device
                        </p>
                    </div>
                    <Switch
                        id="auto-transcribe"
                        checked={autoTranscribe}
                        onCheckedChange={handleAutoTranscribeChange}
                        disabled={isSavingSettings}
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="transcription-language">
                        Default transcription language
                    </Label>
                    <Select
                        value={defaultTranscriptionLanguage || "auto"}
                        onValueChange={(value) => {
                            const lang = value === "auto" ? null : value;
                            setDefaultTranscriptionLanguage(lang);
                            handleTranscriptionSettingChange({
                                defaultTranscriptionLanguage: lang,
                            });
                        }}
                        disabled={isSavingSettings}
                    >
                        <SelectTrigger
                            id="transcription-language"
                            className="w-full"
                        >
                            <SelectValue>
                                {languageOptions.find(
                                    (opt) =>
                                        opt.value ===
                                        defaultTranscriptionLanguage,
                                )?.label || "Auto-detect"}
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                            {languageOptions.map((option) => (
                                <SelectItem
                                    key={option.value || "auto"}
                                    value={option.value || "auto"}
                                >
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        Language to use for transcription. Auto-detect will
                        identify the language automatically.
                    </p>
                </div>

                <div className="space-y-2">
                    <Label htmlFor="transcription-quality">
                        Transcription quality
                    </Label>
                    <Select
                        value={transcriptionQuality}
                        onValueChange={(value) => {
                            setTranscriptionQuality(value);
                            handleTranscriptionSettingChange({
                                transcriptionQuality: value,
                            });
                        }}
                        disabled={isSavingSettings}
                    >
                        <SelectTrigger
                            id="transcription-quality"
                            className="w-full"
                        >
                            <SelectValue>
                                {qualityOptions.find(
                                    (opt) => opt.value === transcriptionQuality,
                                )?.label || "Balanced"}
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                            {qualityOptions.map((option) => (
                                <SelectItem
                                    key={option.value}
                                    value={option.value}
                                >
                                    <div>
                                        <div>{option.label}</div>
                                        <div className="text-xs text-muted-foreground">
                                            {option.description}
                                        </div>
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        Balance between transcription speed and accuracy
                    </p>
                </div>

                <div className="flex items-center justify-between">
                    <div className="space-y-0.5 flex-1">
                        <Label
                            htmlFor="auto-generate-title"
                            className="text-base"
                        >
                            Auto-generate titles
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            Automatically generate descriptive titles from
                            transcriptions using AI
                        </p>
                    </div>
                    <Switch
                        id="auto-generate-title"
                        checked={autoGenerateTitle}
                        onCheckedChange={(checked) => {
                            setAutoGenerateTitle(checked);
                            handleTranscriptionSettingChange({
                                autoGenerateTitle: checked,
                            });
                        }}
                        disabled={isSavingSettings}
                    />
                </div>

                {autoGenerateTitle && (
                    <div className="flex items-center justify-between pl-4 border-l-2 border-primary/20">
                        <div className="space-y-0.5 flex-1">
                            <Label
                                htmlFor="sync-title-plaud"
                                className="text-base"
                            >
                                Sync titles to Plaud
                            </Label>
                            <p className="text-sm text-muted-foreground">
                                Update the filename in your Plaud device when
                                titles are generated
                            </p>
                        </div>
                        <Switch
                            id="sync-title-plaud"
                            checked={syncTitleToPlaud}
                            onCheckedChange={(checked) => {
                                setSyncTitleToPlaud(checked);
                                handleTranscriptionSettingChange({
                                    syncTitleToPlaud: checked,
                                });
                            }}
                            disabled={isSavingSettings}
                        />
                    </div>
                )}
                <div className="space-y-2">
                    <Label htmlFor="split-segment-minutes">
                        Recording split segment duration (minutes)
                    </Label>
                    <Input
                        id="split-segment-minutes"
                        type="number"
                        min={1}
                        max={360}
                        value={splitSegmentMinutes}
                        onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val) && val >= 1 && val <= 360) {
                                setSplitSegmentMinutes(val);
                            }
                        }}
                        onBlur={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val) && val >= 1 && val <= 360) {
                                handleSplitSegmentMinutesChange(val);
                            }
                        }}
                        disabled={isSavingSettings}
                        className="w-32"
                    />
                    <p className="text-xs text-muted-foreground">
                        When splitting a recording, each segment will be at most
                        this many minutes long. Default: 60 minutes.
                    </p>
                </div>

                <div className="space-y-2">
                    <Label htmlFor="silence-threshold-db">
                        Silence threshold (dB)
                    </Label>
                    <Input
                        id="silence-threshold-db"
                        type="number"
                        min={-60}
                        max={-10}
                        value={silenceThresholdDb}
                        onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val) && val >= -60 && val <= -10) {
                                setSilenceThresholdDb(val);
                            }
                        }}
                        onBlur={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val) && val >= -60 && val <= -10) {
                                handleSilenceSettingChange({ silenceThresholdDb: val });
                            }
                        }}
                        disabled={isSavingSettings}
                        className="w-32"
                    />
                    <p className="text-xs text-muted-foreground">
                        Audio below this level (in dBFS) is treated as silence.
                        Lower values (e.g. -50) are more aggressive; higher
                        values (e.g. -20) remove more. Default: -40 dB.
                    </p>
                </div>

                <div className="space-y-2">
                    <Label htmlFor="silence-duration-seconds">
                        Minimum silence duration (seconds)
                    </Label>
                    <Input
                        id="silence-duration-seconds"
                        type="number"
                        min={0.5}
                        max={30}
                        step={0.5}
                        value={silenceDurationSeconds}
                        onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val) && val >= 0.5 && val <= 30) {
                                setSilenceDurationSeconds(val);
                            }
                        }}
                        onBlur={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val) && val >= 0.5 && val <= 30) {
                                handleSilenceSettingChange({ silenceDurationSeconds: val });
                            }
                        }}
                        disabled={isSavingSettings}
                        className="w-32"
                    />
                    <p className="text-xs text-muted-foreground">
                        Only silence passages longer than this will be removed.
                        Default: 1.0 second.
                    </p>
                </div>
            </div>

            <div className="pt-4 border-t">
                <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Status</span>
                        <span
                            className={`font-medium ${
                                autoTranscribe
                                    ? "text-primary"
                                    : "text-muted-foreground"
                            }`}
                        >
                            {autoTranscribe ? "Enabled" : "Disabled"}
                        </span>
                    </div>
                    <p className="text-xs text-muted-foreground pt-2">
                        When enabled, new recordings will be automatically
                        transcribed using your default transcription provider
                        after syncing.
                    </p>
                </div>
            </div>
        </div>
    );
}
