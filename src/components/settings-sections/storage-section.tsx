"use client";

import { HardDrive } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SettingsSectionHeader } from "@/components/settings/section-header";
import { SettingsCard } from "@/components/settings/settings-card";
import { BreakdownBar } from "@/components/settings-sections/storage/breakdown-bar";
import { LargestRecordings } from "@/components/settings-sections/storage/largest-recordings";
import { UsageHero } from "@/components/settings-sections/storage/usage-hero";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";

interface StorageSectionProps {
    isHosted?: boolean;
}

interface StorageUsage {
    storageType: string;
    usedBytes: number;
    recordingCount: number;
    totalDurationMs: number;
    largest: {
        id: string;
        filename: string;
        filesize: number;
        duration: number;
        startTime: string;
    }[];
    diskFreeBytes: number | null;
    quotaBytes: number | null;
}

export function StorageSection({ isHosted = false }: StorageSectionProps) {
    const { isLoadingSettings, isSavingSettings, setIsLoadingSettings } =
        useSettings();
    const [autoDeleteRecordings, setAutoDeleteRecordings] = useState(false);
    const [retentionDays, setRetentionDays] = useState<number | null>(null);
    const [usage, setUsage] = useState<StorageUsage | null>(null);
    const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
    // Tracks a retention-days edit that was scheduled but not yet sent.
    // Used to flush the pending save on unmount so closing the settings
    // dialog inside the debounce window doesn't drop the user's edit.
    const pendingRetentionRef = useRef<number | null | undefined>(undefined);

    useEffect(() => {
        const controller = new AbortController();
        let cancelled = false;

        const fetchSettings = async () => {
            try {
                const response = await fetch("/api/settings/user", {
                    signal: controller.signal,
                });
                if (cancelled) return;
                if (response.ok) {
                    const data = await response.json();
                    if (cancelled) return;
                    setAutoDeleteRecordings(data.autoDeleteRecordings ?? false);
                    setRetentionDays(data.retentionDays ?? null);
                }
            } catch (error) {
                if (cancelled) return;
                if ((error as { name?: string })?.name === "AbortError") return;
                console.error("Failed to fetch settings:", error);
            } finally {
                if (!cancelled) setIsLoadingSettings(false);
            }
        };
        fetchSettings();

        fetch("/api/settings/storage", { signal: controller.signal })
            .then(async (res) => {
                if (!res.ok) return null;
                const data = (await res.json()) as Partial<StorageUsage>;
                // Defensive shape check — only the fields the UI actually
                // reads. Missing optional fields fall back to safe zeros.
                if (
                    typeof data?.usedBytes === "number" &&
                    typeof data?.recordingCount === "number" &&
                    Array.isArray(data?.largest)
                ) {
                    return {
                        storageType: data.storageType ?? "local",
                        usedBytes: data.usedBytes,
                        recordingCount: data.recordingCount,
                        totalDurationMs: data.totalDurationMs ?? 0,
                        largest: data.largest,
                        diskFreeBytes: data.diskFreeBytes ?? null,
                        quotaBytes: data.quotaBytes ?? null,
                    } satisfies StorageUsage;
                }
                return null;
            })
            .then((data) => {
                if (cancelled) return;
                setUsage(data);
            })
            .catch((err) => {
                if (cancelled) return;
                if ((err as { name?: string })?.name === "AbortError") return;
                setUsage(null);
            });

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [setIsLoadingSettings]);

    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
                saveTimeoutRef.current = undefined;
            }
            const pending = pendingRetentionRef.current;
            if (pending !== undefined) {
                pendingRetentionRef.current = undefined;
                // Fire-and-forget so a pending edit isn't lost when the
                // settings dialog closes inside the debounce window. We can't
                // use handleStorageSettingChange here because it touches
                // unmounted React state on rollback; we accept the trade-off
                // of no error toast in this rare edge case.
                void fetch("/api/settings/user", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ retentionDays: pending }),
                }).catch(() => {});
            }
        };
    }, []);

    const cancelPendingRetentionSave = () => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = undefined;
        }
        pendingRetentionRef.current = undefined;
    };

    const flushPendingRetentionSave = () => {
        const pending = pendingRetentionRef.current;
        cancelPendingRetentionSave();
        if (pending === undefined) return;
        handleStorageSettingChange({ retentionDays: pending });
    };

    const handleStorageSettingChange = async (updates: {
        autoDeleteRecordings?: boolean;
        retentionDays?: number | null;
    }) => {
        const previousValues: Record<string, unknown> = {};
        if (updates.autoDeleteRecordings !== undefined) {
            previousValues.autoDeleteRecordings = autoDeleteRecordings;
            setAutoDeleteRecordings(updates.autoDeleteRecordings);
        }
        if (updates.retentionDays !== undefined) {
            previousValues.retentionDays = retentionDays;
            setRetentionDays(updates.retentionDays);
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
        } catch {
            if (updates.autoDeleteRecordings !== undefined) {
                const prev = previousValues.autoDeleteRecordings;
                if (typeof prev === "boolean") setAutoDeleteRecordings(prev);
            }
            if (updates.retentionDays !== undefined) {
                const prev = previousValues.retentionDays;
                if (typeof prev === "number" || prev === null)
                    setRetentionDays(prev);
            }
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
            <SettingsSectionHeader
                title="Storage"
                description="Where OpenPlaud keeps the audio files behind your recordings."
                icon={HardDrive}
            />

            <UsageHero
                usedBytes={usage?.usedBytes ?? 0}
                recordingCount={usage?.recordingCount ?? 0}
                totalDurationMs={usage?.totalDurationMs ?? 0}
                diskFreeBytes={usage?.diskFreeBytes ?? null}
                quotaBytes={usage?.quotaBytes ?? null}
            />

            {usage && usage.largest.length > 0 && (
                <div className="space-y-3">
                    <BreakdownBar
                        segments={usage.largest.map((r) => ({
                            id: r.id,
                            bytes: r.filesize,
                        }))}
                        totalBytes={usage.usedBytes}
                    />
                    <LargestRecordings items={usage.largest} />
                </div>
            )}

            {!isHosted && (
                <div className="rounded-lg border bg-card/40 px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Backend</span>
                        <span className="font-medium capitalize">
                            {usage?.storageType ?? "local"}
                        </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Storage backend is configured at the instance level via
                        environment variables.
                    </p>
                </div>
            )}

            <SettingsCard
                title="Auto-delete old recordings"
                description="Automatically delete recordings older than the retention period."
                action={
                    <Switch
                        id="auto-delete"
                        checked={autoDeleteRecordings}
                        onCheckedChange={(checked) => {
                            // The toggle settles retentionDays itself, so any
                            // debounced retention edit is now stale and must
                            // not be flushed on unmount.
                            cancelPendingRetentionSave();
                            setAutoDeleteRecordings(checked);
                            if (!checked) {
                                setRetentionDays(null);
                            }
                            handleStorageSettingChange({
                                autoDeleteRecordings: checked,
                                retentionDays: checked ? retentionDays : null,
                            });
                        }}
                        disabled={isSavingSettings}
                    />
                }
            >
                {autoDeleteRecordings && (
                    <div className="space-y-2">
                        <Label htmlFor="retention-days">
                            Retention period (days)
                        </Label>
                        <Input
                            id="retention-days"
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={365}
                            step={1}
                            value={retentionDays || ""}
                            onChange={(e) => {
                                const raw = e.target.value;
                                if (raw === "") {
                                    setRetentionDays(null);
                                    if (saveTimeoutRef.current) {
                                        clearTimeout(saveTimeoutRef.current);
                                        saveTimeoutRef.current = undefined;
                                    }
                                    pendingRetentionRef.current = undefined;
                                    handleStorageSettingChange({
                                        retentionDays: null,
                                    });
                                    return;
                                }
                                const value = Number(raw);
                                if (
                                    !Number.isInteger(value) ||
                                    value < 1 ||
                                    value > 365
                                ) {
                                    // Reject non-integer or out-of-range
                                    // values silently. Previously parseInt
                                    // would silently floor "1.5" to 1 and
                                    // save it; we now require an integer.
                                    return;
                                }
                                setRetentionDays(value);
                                if (saveTimeoutRef.current) {
                                    clearTimeout(saveTimeoutRef.current);
                                }
                                pendingRetentionRef.current = value;
                                saveTimeoutRef.current = setTimeout(() => {
                                    saveTimeoutRef.current = undefined;
                                    pendingRetentionRef.current = undefined;
                                    handleStorageSettingChange({
                                        retentionDays: value,
                                    });
                                }, 500);
                            }}
                            onBlur={flushPendingRetentionSave}
                            placeholder="30"
                        />
                        <p className="text-xs text-muted-foreground">
                            Recordings older than this will be automatically
                            deleted (1-365 days)
                        </p>
                    </div>
                )}
            </SettingsCard>
        </div>
    );
}
