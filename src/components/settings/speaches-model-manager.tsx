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

    // Clear poll on unmount
    useEffect(() => {
        return () => {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        };
    }, []);

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
        try {
            const models = await fetchInstalledSilent();
            setInstalledModels(models);
        } catch {
            toast.error("Failed to load installed models");
        } finally {
            setIsLoadingInstalled(false);
        }
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

    useEffect(() => {
        if (open) {
            fetchInstalled();
            fetchRegistry();
        }
        // biome-ignore lint/correctness/useExhaustiveDependencies: fetch fns are stable within render
    }, [open, baseUrl]);

    // Always refresh the parent list when the dialog closes
    const handleOpenChange = (isOpen: boolean) => {
        if (!isOpen) {
            onModelsChanged();
        }
        onOpenChange(isOpen);
    };

    const handleInstall = async (modelId: string) => {
        setInstallingId(modelId);

        // Polling promise: resolves as soon as the model appears in the
        // installed list. This lets us clear the loading state immediately
        // even if the POST connection is still open.
        const pollPromise = new Promise<void>((resolve) => {
            pollIntervalRef.current = setInterval(async () => {
                const models = await fetchInstalledSilent();
                setInstalledModels(models);
                if (models.some((m) => m.id === modelId)) {
                    clearInterval(pollIntervalRef.current!);
                    pollIntervalRef.current = null;
                    resolve();
                }
            }, 2500);
        });

        // POST promise: resolves when the server confirms the download.
        const installPromise = fetch(
            `/api/speaches/models?baseUrl=${encodeURIComponent(baseUrl)}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ modelId }),
            },
        ).then((res) => {
            if (!res.ok) throw new Error("Failed to install");
        });

        try {
            // Whichever signal arrives first unblocks the UI
            await Promise.race([pollPromise, installPromise]);
            toast.success(`Model installed: ${modelId}`);
            await fetchInstalled();
            onModelsChanged();
        } catch {
            toast.error("Failed to install model");
        } finally {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
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

    const installedIds = new Set(installedModels.map((m) => m.id));
    const availableToInstall = registryModels.filter(
        (m) => !installedIds.has(m.id),
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
                        <h3 className="text-sm font-medium">Installed Models</h3>
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
                                        installingId === model.id;
                                    return (
                                        <div
                                            key={model.id}
                                            className={`flex items-center justify-between gap-2 py-1.5 px-3 rounded-md border bg-card ${isInstalling ? "border-primary/40 bg-primary/5" : ""}`}
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
