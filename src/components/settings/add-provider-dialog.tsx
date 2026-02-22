"use client";

import { RefreshCw } from "lucide-react";
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

interface AddProviderDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
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

export function AddProviderDialog({
    open,
    onOpenChange,
    onSuccess,
}: AddProviderDialogProps) {
    const [provider, setProvider] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [baseUrl, setBaseUrl] = useState("");
    const [defaultModel, setDefaultModel] = useState("");
    const [isDefaultTranscription, setIsDefaultTranscription] = useState(false);
    const [isDefaultEnhancement, setIsDefaultEnhancement] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [speachesModels, setSpeachesModels] = useState<SpeachesModel[]>([]);
    const [isLoadingModels, setIsLoadingModels] = useState(false);
    const [showModelManager, setShowModelManager] = useState(false);

    const isSpeaches = provider === "Speaches";

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
        if (isSpeaches && open) {
            fetchSpeachesModels(baseUrl || "http://localhost:8000/v1");
        }
        // biome-ignore lint/correctness/useExhaustiveDependencies: fetchSpeachesModels is stable within render
    }, [isSpeaches, open]);

    const handleProviderChange = (value: string) => {
        setProvider(value);
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

        if (!provider) {
            toast.error("Please select a provider");
            return;
        }

        const isLocalProvider = selectedPreset?.localProvider ?? false;
        if (!isLocalProvider && !apiKey) {
            toast.error("API key is required for this provider");
            return;
        }

        // For local providers without auth, use the placeholder as a dummy key
        const effectiveApiKey =
            apiKey.trim() || selectedPreset?.placeholder || "none";

        setIsLoading(true);
        try {
            const response = await fetch("/api/settings/ai/providers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    provider,
                    apiKey: effectiveApiKey,
                    baseUrl: baseUrl || null,
                    defaultModel: defaultModel || null,
                    isDefaultTranscription,
                    isDefaultEnhancement,
                }),
            });

            if (!response.ok) throw new Error("Failed to add provider");

            toast.success("AI provider added successfully");
            onSuccess();
            onOpenChange(false);

            setProvider("");
            setApiKey("");
            setBaseUrl("");
            setDefaultModel("");
            setIsDefaultTranscription(false);
            setIsDefaultEnhancement(false);
            setSpeachesModels([]);
        } catch {
            toast.error("Failed to add AI provider");
        } finally {
            setIsLoading(false);
        }
    };

    const selectedPreset = providerPresets.find((p) => p.name === provider);

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Add AI Provider</DialogTitle>
                    </DialogHeader>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label>Provider</Label>
                            <Select
                                value={provider}
                                onValueChange={handleProviderChange}
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
                                        ? `Leave blank or enter a value (e.g. "${selectedPreset.placeholder}")`
                                        : (selectedPreset?.placeholder ?? "Your API key")
                                }
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                disabled={isLoading}
                                className="font-mono text-sm"
                            />
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
                                variant="cyan"
                                disabled={isLoading}
                                className="flex-1"
                            >
                                {isLoading ? "Adding..." : "Add Provider"}
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
