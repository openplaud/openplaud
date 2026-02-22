"use client";

import { RefreshCw, Shield } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MetalButton } from "@/components/metal-button";
import { Panel } from "@/components/panel";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { SpeachesModelManager } from "./speaches-model-manager";

interface Provider {
    id: string;
    provider: string;
    baseUrl: string | null;
    defaultModel: string | null;
    isDefaultTranscription: boolean;
    isDefaultEnhancement: boolean;
}

interface EditProviderDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    provider: Provider | null;
    onSuccess: () => void;
}

const providerPresets = [
    {
        name: "OpenAI",
        baseUrl: "",
        placeholder: "sk-...",
        defaultModel: "whisper-1",
        localProvider: false,
    },
    {
        name: "Groq",
        baseUrl: "https://api.groq.com/openai/v1",
        placeholder: "gsk_...",
        defaultModel: "whisper-large-v3-turbo",
        localProvider: false,
    },
    {
        name: "Together AI",
        baseUrl: "https://api.together.xyz/v1",
        placeholder: "...",
        defaultModel: "whisper-large-v3",
        localProvider: false,
    },
    {
        name: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        placeholder: "sk-or-...",
        defaultModel: "whisper-1",
        localProvider: false,
    },
    {
        name: "LM Studio",
        baseUrl: "http://localhost:1234/v1",
        placeholder: "lm-studio",
        defaultModel: "",
        localProvider: true,
    },
    {
        name: "Ollama",
        baseUrl: "http://localhost:11434/v1",
        placeholder: "ollama",
        defaultModel: "",
        localProvider: true,
    },
    {
        name: "Speaches",
        baseUrl: "http://localhost:8000/v1",
        placeholder: "speaches",
        defaultModel: "",
        localProvider: true,
    },
    {
        name: "Custom",
        baseUrl: "",
        placeholder: "Your API key",
        defaultModel: "",
        localProvider: false,
    },
];

interface SpeachesModel {
    id: string;
}

export function EditProviderDialog({
    open,
    onOpenChange,
    provider,
    onSuccess,
}: EditProviderDialogProps) {
    const [providerName, setProviderName] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [baseUrl, setBaseUrl] = useState("");
    const [defaultModel, setDefaultModel] = useState("");
    const [isDefaultTranscription, setIsDefaultTranscription] = useState(false);
    const [isDefaultEnhancement, setIsDefaultEnhancement] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [speachesModels, setSpeachesModels] = useState<SpeachesModel[]>([]);
    const [isLoadingModels, setIsLoadingModels] = useState(false);
    const [showModelManager, setShowModelManager] = useState(false);

    const isSpeaches = providerName === "Speaches";

    const fetchSpeachesModels = async (url: string) => {
        setIsLoadingModels(true);
        try {
            const res = await fetch(
                `/api/speaches/models?baseUrl=${encodeURIComponent(url)}`,
            );
            if (!res.ok) throw new Error("Failed to fetch");
            const data = await res.json();
            setSpeachesModels(data.data || []);
        } catch {
            setSpeachesModels([]);
        } finally {
            setIsLoadingModels(false);
        }
    };

    useEffect(() => {
        if (open && provider) {
            setProviderName(provider.provider);
            setBaseUrl(provider.baseUrl || "");
            setDefaultModel(provider.defaultModel || "");
            setIsDefaultTranscription(provider.isDefaultTranscription);
            setIsDefaultEnhancement(provider.isDefaultEnhancement);
            setApiKey("");

            if (provider.provider === "Speaches") {
                fetchSpeachesModels(
                    provider.baseUrl || "http://localhost:8000/v1",
                );
            }
        } else if (!open) {
            setProviderName("");
            setApiKey("");
            setBaseUrl("");
            setDefaultModel("");
            setIsDefaultTranscription(false);
            setIsDefaultEnhancement(false);
            setSpeachesModels([]);
        }
        // biome-ignore lint/correctness/useExhaustiveDependencies: fetchSpeachesModels is stable within render
    }, [open, provider]);

    const handleProviderChange = (value: string) => {
        setProviderName(value);
        const preset = providerPresets.find((p) => p.name === value);
        if (preset) {
            setBaseUrl(preset.baseUrl);
            setDefaultModel(preset.defaultModel);
            if (value === "Speaches") {
                fetchSpeachesModels(preset.baseUrl);
            }
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!providerName) {
            toast.error("Provider name is required");
            return;
        }

        if (!provider?.id) {
            toast.error("Provider ID is missing");
            return;
        }

        setIsLoading(true);
        try {
            const updateData: {
                baseUrl: string | null;
                defaultModel: string | null;
                isDefaultTranscription: boolean;
                isDefaultEnhancement: boolean;
                apiKey?: string;
            } = {
                baseUrl: baseUrl || null,
                defaultModel: defaultModel || null,
                isDefaultTranscription,
                isDefaultEnhancement,
            };

            if (apiKey.trim()) {
                updateData.apiKey = apiKey;
            }

            const response = await fetch(
                `/api/settings/ai/providers/${provider.id}`,
                {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(updateData),
                },
            );

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || "Failed to update provider");
            }

            toast.success("AI provider updated successfully");
            onSuccess();
            onOpenChange(false);

            setProviderName("");
            setApiKey("");
            setBaseUrl("");
            setDefaultModel("");
            setIsDefaultTranscription(false);
            setIsDefaultEnhancement(false);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to update AI provider",
            );
        } finally {
            setIsLoading(false);
        }
    };

    const selectedPreset = providerPresets.find((p) => p.name === providerName);

    if (!open || !provider) return null;

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange} key={provider.id}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Edit AI Provider</DialogTitle>
                    </DialogHeader>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label>Provider</Label>
                            <Select
                                value={providerName}
                                onValueChange={handleProviderChange}
                                disabled={isLoading}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select a provider" />
                                </SelectTrigger>
                                <SelectContent>
                                    {providerPresets.map((preset) => (
                                        <SelectItem
                                            key={preset.name}
                                            value={preset.name}
                                        >
                                            {preset.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="apiKey">
                                API Key{" "}
                                {selectedPreset?.localProvider && (
                                    <span className="font-normal text-muted-foreground">
                                        (optional)
                                    </span>
                                )}
                            </Label>
                            <Input
                                id="apiKey"
                                type="password"
                                placeholder={
                                    selectedPreset?.localProvider
                                        ? `Leave blank to keep current key`
                                        : "Enter a new key to replace the current one"
                                }
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                disabled={isLoading}
                                className="font-mono text-sm"
                            />
                            <div className="text-xs text-muted-foreground flex items-center gap-2">
                                <Shield className="w-3.5 h-3.5 shrink-0" />
                                <span>
                                    {selectedPreset?.localProvider
                                        ? "No API key needed for local providers. Leave blank to keep the current value."
                                        : "For security, the saved API key is never shown. Leave this blank to keep your current key, or enter a new key to replace it."}
                                </span>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="baseUrl">Base URL (Optional)</Label>
                            <Input
                                id="baseUrl"
                                type="text"
                                placeholder="https://api.example.com/v1"
                                value={baseUrl}
                                onChange={(e) => setBaseUrl(e.target.value)}
                                onBlur={(e) => {
                                    if (isSpeaches)
                                        fetchSpeachesModels(e.target.value);
                                }}
                                disabled={isLoading}
                                className="font-mono text-sm"
                            />
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="defaultModel">
                                    Default Model (Optional)
                                </Label>
                                {isSpeaches && (
                                    <button
                                        type="button"
                                        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                                        onClick={() =>
                                            setShowModelManager(true)
                                        }
                                    >
                                        Manage Models
                                    </button>
                                )}
                            </div>
                            {isSpeaches ? (
                                <div className="flex gap-1">
                                <Select
                                    value={defaultModel}
                                    onValueChange={setDefaultModel}
                                    disabled={isLoading || isLoadingModels}
                                >
                                    <SelectTrigger className="font-mono text-sm">
                                        <SelectValue
                                            placeholder={
                                                isLoadingModels
                                                    ? "Loading models…"
                                                    : speachesModels.length ===
                                                        0
                                                      ? "No models installed"
                                                      : "Select a model"
                                            }
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {speachesModels.map((m) => (
                                            <SelectItem key={m.id} value={m.id}>
                                                {m.id}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <button
                                    type="button"
                                    aria-label="Refresh model list"
                                    disabled={isLoadingModels}
                                    onClick={() =>
                                        fetchSpeachesModels(
                                            baseUrl ||
                                                "http://localhost:8000/v1",
                                        )
                                    }
                                    className="shrink-0 flex items-center justify-center h-10 w-10 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                                >
                                    <RefreshCw
                                        className={`h-4 w-4 ${isLoadingModels ? "animate-spin" : ""}`}
                                    />
                                </button>
                                </div>
                            ) : (
                                <Input
                                    id="defaultModel"
                                    type="text"
                                    placeholder="whisper-1, gpt-4o, etc."
                                    value={defaultModel}
                                    onChange={(e) =>
                                        setDefaultModel(e.target.value)
                                    }
                                    disabled={isLoading}
                                    className="font-mono text-sm"
                                />
                            )}
                        </div>

                        <Panel variant="inset" className="space-y-2 text-sm">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={isDefaultTranscription}
                                    onChange={(e) =>
                                        setIsDefaultTranscription(
                                            e.target.checked,
                                        )
                                    }
                                    disabled={isLoading}
                                />
                                <span>Use for transcription</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={isDefaultEnhancement}
                                    onChange={(e) =>
                                        setIsDefaultEnhancement(e.target.checked)
                                    }
                                    disabled={isLoading}
                                />
                                <span>Use for AI enhancements</span>
                            </label>
                        </Panel>

                        <div className="flex gap-2">
                            <MetalButton
                                type="button"
                                onClick={() => onOpenChange(false)}
                                disabled={isLoading}
                                className="flex-1"
                            >
                                Cancel
                            </MetalButton>
                            <MetalButton
                                type="submit"
                                disabled={isLoading}
                                className="flex-1"
                            >
                                {isLoading ? "Updating..." : "Update Provider"}
                            </MetalButton>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>

            {isSpeaches && (
                <SpeachesModelManager
                    open={showModelManager}
                    onOpenChange={setShowModelManager}
                    baseUrl={baseUrl || "http://localhost:8000/v1"}
                    onModelsChanged={() =>
                        fetchSpeachesModels(
                            baseUrl || "http://localhost:8000/v1",
                        )
                    }
                />
            )}
        </>
    );
}
