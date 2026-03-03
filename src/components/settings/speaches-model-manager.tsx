"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MetalButton } from "@/components/metal-button";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const normalizeModelId = (id: string) => id.toLowerCase().trim();

interface SpeachesModel {
    id: string;
    object?: string;
    created?: number;
    owned_by?: string;
}

interface RegistryModel {
    id: string;
    task?: string;
}

interface SpeachesModelManagerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    baseUrl: string;
    onModelsChanged: () => void;
}

export function SpeachesModelManager({
    open,
    onOpenChange,
    baseUrl,
    onModelsChanged,
}: SpeachesModelManagerProps) {
    const [installedModels, setInstalledModels] = useState<SpeachesModel[]>([]);
    const [registryModels, setRegistryModels] = useState<RegistryModel[]>([]);
    const [isLoadingInstalled, setIsLoadingInstalled] = useState(false);
    const [isLoadingRegistry, setIsLoadingRegistry] = useState(false);
    const [installingId, setInstallingId] = useState<string | null>(null);
    const [removingId, setRemovingId] = useState<string | null>(null);
    const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Prevents duplicate success toasts when both the poll and the safety-net
    // useEffect detect the model at the same time.
    const installSuccessShownRef = useRef(false);

    // Clear poll on unmount
    useEffect(() => {
        return () => {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            if (pollTimeoutRef.current) {
                clearTimeout(pollTimeoutRef.current);
                pollTimeoutRef.current = null;
            }
        };
    }, []);

    // Safety net: when the model being installed appears in installedModels,
    // clear the flag regardless of whether the polling promise resolved.
    // This handles edge cases where the ID comparison in the poll fails
    // (e.g. Speaches returns a slightly different ID format than the registry).
    // biome-ignore lint/correctness/useExhaustiveDependencies: only react when installedModels changes
    useEffect(() => {
        if (
            installingId !== null &&
            installedModels.some(
                (m) =>
                    normalizeModelId(m.id) === normalizeModelId(installingId),
            )
        ) {
            if (!installSuccessShownRef.current) {
                toast.success(`Model installed: ${installingId}`);
                installSuccessShownRef.current = true;
            }
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
            }
            if (pollTimeoutRef.current) {
                clearTimeout(pollTimeoutRef.current);
                pollTimeoutRef.current = null;
            }
            setInstallingId(null);
            onModelsChanged();
        }
    }, [installedModels]);

    const fetchInstalledSilent = async (): Promise<SpeachesModel[]> => {
        try {
            const res = await fetch(
                `/api/speaches/models?baseUrl=${encodeURIComponent(baseUrl)}`,
            );
            if (!res.ok) return [];
            const data = await res.json();
            return data.data || [];
        } catch {
            return [];
        }
    };

    const fetchInstalled = async () => {
        setIsLoadingInstalled(true);
        // fetchInstalledSilent always returns [] on error and never throws,
        // so no catch block is needed here.
        const models = await fetchInstalledSilent();
        setInstalledModels(models);
        setIsLoadingInstalled(false);
    };

    const fetchRegistry = async () => {
        setIsLoadingRegistry(true);
        try {
            const res = await fetch(
                `/api/speaches/registry?baseUrl=${encodeURIComponent(baseUrl)}`,
            );
            if (!res.ok) throw new Error("Failed to fetch");
            const data = await res.json();
            setRegistryModels(data.data || []);
        } catch {
            toast.error("Failed to load model registry");
        } finally {
            setIsLoadingRegistry(false);
        }
    };

    // biome-ignore lint/correctness/useExhaustiveDependencies: fetchInstalled and fetchRegistry are stable by intent — only re-run when open changes
    useEffect(() => {
        if (open) {
            fetchInstalled();
            fetchRegistry();
        }
    }, [open]);

    // Always refresh the parent list when the dialog closes
    const handleOpenChange = (isOpen: boolean) => {
        if (!isOpen) {
            // Prevent closing while a download is in progress.
            // Escape key and overlay clicks both fire onOpenChange(false).
            if (installingId !== null) return;
            onModelsChanged();
        }
        onOpenChange(isOpen);
    };

    const handleInstall = async (modelId: string) => {
        installSuccessShownRef.current = false;
        setInstallingId(modelId);

        // Poll every 2.5 s until the model appears in the installed list.
        // The POST only queues the download on the Speaches side and returns
        // immediately, so polling is the only reliable completion signal.
        const POLL_TIMEOUT_MS = 30 * 60 * 1000; // 30-minute hard limit (large models can take a while)

        try {
            // Trigger the download. Await only to catch immediate errors
            // (e.g. network failure, 4xx). The response returns before the
            // model is fully downloaded, so we rely on polling for completion.
            const res = await fetch(
                `/api/speaches/models?baseUrl=${encodeURIComponent(baseUrl)}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ modelId }),
                },
            );
            if (!res.ok) throw new Error("Failed to install");

            // Start polling only after the POST succeeds to avoid unhandled
            // promise rejections when the POST itself fails.
            const pollPromise = new Promise<void>((resolve, reject) => {
                pollTimeoutRef.current = setTimeout(() => {
                    if (pollIntervalRef.current) {
                        clearInterval(pollIntervalRef.current);
                        pollIntervalRef.current = null;
                    }
                    pollTimeoutRef.current = null;
                    reject(
                        new Error("Model install timed out after 30 minutes"),
                    );
                }, POLL_TIMEOUT_MS);
                pollIntervalRef.current = setInterval(async () => {
                    const models = await fetchInstalledSilent();
                    setInstalledModels(models);
                    if (
                        models.some(
                            (m) =>
                                normalizeModelId(m.id) ===
                                normalizeModelId(modelId),
                        )
                    ) {
                        if (pollIntervalRef.current)
                            clearInterval(pollIntervalRef.current);
                        pollIntervalRef.current = null;
                        if (pollTimeoutRef.current) {
                            clearTimeout(pollTimeoutRef.current);
                            pollTimeoutRef.current = null;
                        }
                        resolve();
                    }
                }, 2500);
            });

            // Wait until polling confirms the model is installed.
            await pollPromise;
            if (!installSuccessShownRef.current) {
                toast.success(`Model installed: ${modelId}`);
                installSuccessShownRef.current = true;
            }
            await fetchInstalled();
            onModelsChanged();
        } catch {
            toast.error("Failed to install model");
        } finally {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
            }
            if (pollTimeoutRef.current) {
                clearTimeout(pollTimeoutRef.current);
                pollTimeoutRef.current = null;
            }
            setInstallingId(null);
        }
    };

    const handleRemove = async (modelId: string) => {
        setRemovingId(modelId);
        try {
            const res = await fetch(
                `/api/speaches/models?baseUrl=${encodeURIComponent(baseUrl)}&modelId=${encodeURIComponent(modelId)}`,
                { method: "DELETE" },
            );
            if (!res.ok) throw new Error("Failed to remove");
            toast.success(`Removed ${modelId}`);
            await fetchInstalled();
            onModelsChanged();
        } catch {
            toast.error("Failed to remove model");
        } finally {
            setRemovingId(null);
        }
    };

    const installedIds = new Set(
        installedModels.map((m) => normalizeModelId(m.id)),
    );
    const availableToInstall = registryModels.filter(
        (m) => !installedIds.has(normalizeModelId(m.id)),
    );

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Manage Speaches Models</DialogTitle>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto space-y-6 py-2">
                    {/* Installed models */}
                    <div className="space-y-2">
                        <h3 className="text-sm font-medium">
                            Installed Models
                        </h3>
                        {isLoadingInstalled ? (
                            <p className="text-sm text-muted-foreground">
                                Loading…
                            </p>
                        ) : installedModels.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                No models installed yet.
                            </p>
                        ) : (
                            <div className="space-y-1">
                                {installedModels.map((model) => (
                                    <div
                                        key={model.id}
                                        className="flex items-center justify-between gap-2 py-1.5 px-3 rounded-md border bg-card"
                                    >
                                        <span className="font-mono text-xs truncate">
                                            {model.id}
                                        </span>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="shrink-0 text-destructive hover:text-destructive"
                                            disabled={removingId === model.id}
                                            onClick={() =>
                                                handleRemove(model.id)
                                            }
                                        >
                                            {removingId === model.id
                                                ? "Removing…"
                                                : "Remove"}
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Available to install */}
                    <div className="space-y-2">
                        <h3 className="text-sm font-medium">
                            Available to Install
                        </h3>
                        {isLoadingRegistry ? (
                            <p className="text-sm text-muted-foreground">
                                Loading registry…
                            </p>
                        ) : availableToInstall.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                {registryModels.length === 0
                                    ? "Registry unavailable."
                                    : "All registry models are installed."}
                            </p>
                        ) : (
                            <div className="space-y-1">
                                {availableToInstall.map((model) => {
                                    const isInstalling =
                                        installingId !== null &&
                                        normalizeModelId(installingId) ===
                                            normalizeModelId(model.id);
                                    return (
                                        <div
                                            key={model.id}
                                            className={cn(
                                                "flex items-center justify-between gap-2 py-1.5 px-3 rounded-md border",
                                                isInstalling
                                                    ? "border-primary/40 bg-primary/5"
                                                    : "bg-card",
                                            )}
                                        >
                                            <span
                                                className={`font-mono text-xs truncate ${isInstalling ? "text-muted-foreground" : ""}`}
                                            >
                                                {model.id}
                                            </span>
                                            {isInstalling ? (
                                                <div className="flex items-center gap-1.5 shrink-0 text-muted-foreground text-xs">
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    <span>Downloading…</span>
                                                </div>
                                            ) : (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    disabled={
                                                        installingId !== null
                                                    }
                                                    onClick={() =>
                                                        handleInstall(model.id)
                                                    }
                                                >
                                                    Install
                                                </Button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                <div className="pt-2">
                    <MetalButton
                        disabled={installingId !== null}
                        onClick={() => handleOpenChange(false)}
                        className="w-full"
                    >
                        {installingId !== null ? (
                            <span className="flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Downloading model…
                            </span>
                        ) : (
                            "Close"
                        )}
                    </MetalButton>
                </div>
            </DialogContent>
        </Dialog>
    );
}
