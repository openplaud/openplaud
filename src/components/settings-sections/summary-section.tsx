"use client";

import { ListChecks } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useSettings } from "@/hooks/use-settings";
import {
    SUMMARY_PRESETS,
    type SummaryPromptConfiguration,
} from "@/lib/ai/summary-presets";

export function SummarySection() {
    const { isLoadingSettings, isSavingSettings, setIsLoadingSettings } =
        useSettings();
    const [selectedPrompt, setSelectedPrompt] = useState("general");

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await fetch("/api/settings/user");
                if (response.ok) {
                    const data = await response.json();
                    const config =
                        data.summaryPrompt as SummaryPromptConfiguration | null;
                    if (config?.selectedPrompt) {
                        setSelectedPrompt(config.selectedPrompt);
                    }
                }
            } catch (error) {
                console.error("Failed to fetch settings:", error);
            } finally {
                setIsLoadingSettings(false);
            }
        };
        fetchSettings();
    }, [setIsLoadingSettings]);

    const handlePresetChange = async (value: string) => {
        const previous = selectedPrompt;
        setSelectedPrompt(value);

        try {
            const response = await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    summaryPrompt: {
                        selectedPrompt: value,
                        customPrompts: [],
                    },
                }),
            });

            if (!response.ok) {
                throw new Error("Failed to save settings");
            }
        } catch {
            setSelectedPrompt(previous);
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
                <ListChecks className="w-5 h-5" />
                Summary Settings
            </h2>
            <div className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="summary-preset">
                        Default summary prompt
                    </Label>
                    <Select
                        value={selectedPrompt}
                        onValueChange={handlePresetChange}
                        disabled={isSavingSettings}
                    >
                        <SelectTrigger id="summary-preset" className="w-full">
                            <SelectValue>
                                {SUMMARY_PRESETS[
                                    selectedPrompt as keyof typeof SUMMARY_PRESETS
                                ]?.name || "General Summary"}
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                            {Object.values(SUMMARY_PRESETS).map((preset) => (
                                <SelectItem key={preset.id} value={preset.id}>
                                    <div>
                                        <div>{preset.name}</div>
                                        <div className="text-xs text-muted-foreground">
                                            {preset.description}
                                        </div>
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        The default prompt preset used when generating
                        summaries. You can override this per-recording.
                    </p>
                </div>
            </div>
        </div>
    );
}
