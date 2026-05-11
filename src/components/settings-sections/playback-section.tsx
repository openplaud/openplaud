"use client";

import { AudioWaveform, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";

const playbackSpeedOptions = [
    { label: "0.5x", value: 0.5 },
    { label: "0.75x", value: 0.75 },
    { label: "1x", value: 1.0 },
    { label: "1.25x", value: 1.25 },
    { label: "1.5x", value: 1.5 },
    { label: "2x", value: 2.0 },
];

export function PlaybackSection() {
    const { isLoadingSettings, isSavingSettings, setIsLoadingSettings } =
        useSettings();
    const [defaultPlaybackSpeed, setDefaultPlaybackSpeed] = useState(1.0);
    const [defaultVolume, setDefaultVolume] = useState(75);
    const [autoPlayNext, setAutoPlayNext] = useState(false);
    const [playerScrubber, setPlayerScrubber] = useState<"waveform" | "slider">(
        "waveform",
    );
    const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await fetch("/api/settings/user");
                if (response.ok) {
                    const data = await response.json();
                    setDefaultPlaybackSpeed(data.defaultPlaybackSpeed ?? 1.0);
                    setDefaultVolume(data.defaultVolume ?? 75);
                    setAutoPlayNext(data.autoPlayNext ?? false);
                    setPlayerScrubber(
                        data.playerScrubber === "slider"
                            ? "slider"
                            : "waveform",
                    );
                }
            } catch (error) {
                console.error("Failed to fetch settings:", error);
            } finally {
                setIsLoadingSettings(false);
            }
        };
        fetchSettings();
    }, [setIsLoadingSettings]);

    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
        };
    }, []);

    const handlePlaybackSettingChange = async (
        updates: {
            defaultPlaybackSpeed?: number;
            defaultVolume?: number;
            autoPlayNext?: boolean;
            playerScrubber?: "waveform" | "slider";
        },
        debounceMs?: number,
    ) => {
        const previousValues: Record<string, unknown> = {};
        if (updates.defaultPlaybackSpeed !== undefined) {
            previousValues.defaultPlaybackSpeed = defaultPlaybackSpeed;
            setDefaultPlaybackSpeed(updates.defaultPlaybackSpeed);
        }
        if (updates.defaultVolume !== undefined) {
            previousValues.defaultVolume = defaultVolume;
            setDefaultVolume(updates.defaultVolume);
        }
        if (updates.autoPlayNext !== undefined) {
            previousValues.autoPlayNext = autoPlayNext;
            setAutoPlayNext(updates.autoPlayNext);
        }
        if (updates.playerScrubber !== undefined) {
            previousValues.playerScrubber = playerScrubber;
            setPlayerScrubber(updates.playerScrubber);
        }

        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        const performSave = async () => {
            try {
                const response = await fetch("/api/settings/user", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(updates),
                });

                if (!response.ok) {
                    throw new Error("Failed to save settings");
                }
            } catch {
                if (updates.defaultPlaybackSpeed !== undefined) {
                    const prev = previousValues.defaultPlaybackSpeed;
                    if (typeof prev === "number") setDefaultPlaybackSpeed(prev);
                }
                if (updates.defaultVolume !== undefined) {
                    const prev = previousValues.defaultVolume;
                    if (typeof prev === "number") setDefaultVolume(prev);
                }
                if (updates.autoPlayNext !== undefined) {
                    const prev = previousValues.autoPlayNext;
                    if (typeof prev === "boolean") setAutoPlayNext(prev);
                }
                if (updates.playerScrubber !== undefined) {
                    const prev = previousValues.playerScrubber;
                    if (prev === "waveform" || prev === "slider") {
                        setPlayerScrubber(prev);
                    }
                }
                toast.error("Failed to save settings. Changes reverted.");
            }
        };

        if (debounceMs) {
            saveTimeoutRef.current = setTimeout(performSave, debounceMs);
        } else {
            performSave();
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
                <Play className="w-5 h-5" />
                Playback Settings
            </h2>
            <div className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="playback-speed">
                        Default playback speed
                    </Label>
                    <Select
                        value={defaultPlaybackSpeed.toString()}
                        onValueChange={(value) => {
                            const speed = parseFloat(value);
                            setDefaultPlaybackSpeed(speed);
                            handlePlaybackSettingChange({
                                defaultPlaybackSpeed: speed,
                            });
                        }}
                        disabled={isSavingSettings}
                    >
                        <SelectTrigger id="playback-speed" className="w-full">
                            <SelectValue>
                                {playbackSpeedOptions.find(
                                    (opt) => opt.value === defaultPlaybackSpeed,
                                )?.label || "1x"}
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                            {playbackSpeedOptions.map((option) => (
                                <SelectItem
                                    key={option.value}
                                    value={option.value.toString()}
                                >
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        Default playback speed for new recordings
                    </p>
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="default-volume">Default volume</Label>
                        <span className="text-sm text-muted-foreground">
                            {defaultVolume}%
                        </span>
                    </div>
                    <Slider
                        id="default-volume"
                        value={[defaultVolume]}
                        onValueChange={(value) => {
                            const volume = value[0] ?? 75;
                            setDefaultVolume(volume);
                            handlePlaybackSettingChange(
                                { defaultVolume: volume },
                                500,
                            );
                        }}
                        min={0}
                        max={100}
                        step={1}
                    />
                    <p className="text-xs text-muted-foreground">
                        Default volume level for audio playback
                    </p>
                </div>

                <div className="flex items-center justify-between">
                    <div className="space-y-0.5 flex-1">
                        <Label htmlFor="auto-play-next" className="text-base">
                            Auto-play next recording
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            Automatically play the next recording when the
                            current one ends
                        </p>
                    </div>
                    <Switch
                        id="auto-play-next"
                        checked={autoPlayNext}
                        onCheckedChange={(checked) => {
                            setAutoPlayNext(checked);
                            handlePlaybackSettingChange({
                                autoPlayNext: checked,
                            });
                        }}
                        disabled={isSavingSettings}
                    />
                </div>

                <div className="space-y-2">
                    <Label
                        htmlFor="player-scrubber"
                        className="flex items-center gap-2"
                    >
                        <AudioWaveform className="size-4" />
                        Scrubber style
                    </Label>
                    <Select
                        value={playerScrubber}
                        onValueChange={(value) => {
                            const next =
                                value === "slider" ? "slider" : "waveform";
                            handlePlaybackSettingChange({
                                playerScrubber: next,
                            });
                        }}
                        disabled={isSavingSettings}
                    >
                        <SelectTrigger id="player-scrubber" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="waveform">
                                Waveform (default)
                            </SelectItem>
                            <SelectItem value="slider">Progress bar</SelectItem>
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        Waveform shows audio amplitude and decodes in-browser on
                        first listen. Progress bar is the plain horizontal
                        slider with no decoding cost.
                    </p>
                </div>
            </div>

            <div className="pt-4 border-t">
                <div className="space-y-2">
                    <Label className="text-base">Keyboard Shortcuts</Label>
                    <div className="space-y-1.5 text-sm">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Space</span>
                            <span>Play/Pause</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">
                                Arrow Left
                            </span>
                            <span>Seek backward 5s</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">
                                Arrow Right
                            </span>
                            <span>Seek forward 5s</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">
                                Arrow Up
                            </span>
                            <span>Increase volume</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">
                                Arrow Down
                            </span>
                            <span>Decrease volume</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
