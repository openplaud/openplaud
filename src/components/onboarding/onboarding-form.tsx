"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { LEDIndicator } from "@/components/led-indicator";
import { MetalButton } from "@/components/metal-button";
import { Panel } from "@/components/panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

const PLAUD_SERVERS = [
    { label: "Global (api.plaud.ai)", value: "https://api.plaud.ai" },
    { label: "EU – Frankfurt (api-euc1.plaud.ai)", value: "https://api-euc1.plaud.ai" },
] as const;

type Step = "plaud" | "complete";

export function OnboardingForm() {
    const [step, setStep] = useState<Step>("plaud");
    const [bearerToken, setBearerToken] = useState("");
    const [apiBase, setApiBase] = useState<string>(PLAUD_SERVERS[0].value);
    const [isLoading, setIsLoading] = useState(false);
    const router = useRouter();

    const handlePlaudSetup = async () => {
        if (!bearerToken.trim()) {
            toast.error("Please enter your bearer token");
            return;
        }

        setIsLoading(true);
        try {
            const response = await fetch("/api/plaud/connect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bearerToken, apiBase }),
            });

            if (!response.ok) throw new Error("Failed to connect");

            toast.success("Plaud device connected");
            setStep("complete");
        } catch {
            toast.error("Failed to connect to Plaud");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Panel className="w-full max-w-2xl space-y-6">
            {/* Progress indicator */}
            <div className="flex items-center justify-center gap-8">
                <div className="flex items-center gap-2">
                    <LEDIndicator active={step === "plaud"} status="active" />
                    <span className="text-sm">Plaud Setup</span>
                </div>
                <div className="flex items-center gap-2">
                    <LEDIndicator
                        active={step === "complete"}
                        status="active"
                    />
                    <span className="text-sm">Complete</span>
                </div>
            </div>

            {step === "plaud" && (
                <div className="space-y-4">
                    <div>
                        <h2 className="text-xl font-bold">
                            Connect Your Plaud Device
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">
                            Get your bearer token from plaud.ai
                        </p>
                    </div>

                    <Panel variant="inset" className="space-y-3 text-sm">
                        <p className="font-semibold">
                            How to get your bearer token:
                        </p>
                        <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                            <li>Go to plaud.ai and log in</li>
                            <li>Open DevTools (F12) → Network tab</li>
                            <li>Refresh the page</li>
                            <li>Find any request to the Plaud API server</li>
                            <li>
                                Copy the Authorization header value (starts with
                                &quot;Bearer &quot;)
                            </li>
                        </ol>
                    </Panel>

                    <div className="space-y-2">
                        <Label htmlFor="apiBase">API Server</Label>
                        <Select value={apiBase} onValueChange={setApiBase}>
                            <SelectTrigger id="apiBase" disabled={isLoading}>
                                <SelectValue placeholder="Select API server" />
                            </SelectTrigger>
                            <SelectContent className="z-[200]">
                                {PLAUD_SERVERS.map((server) => (
                                    <SelectItem key={server.value} value={server.value}>
                                        {server.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            {apiBase === "https://api.plaud.ai"
                                ? "Global server — used by most accounts (api.plaud.ai)"
                                : "EU server — used by European accounts (api-euc1.plaud.ai)"}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="bearerToken">Bearer Token</Label>
                        <Input
                            id="bearerToken"
                            type="text"
                            placeholder="Bearer ..."
                            value={bearerToken}
                            onChange={(e) => setBearerToken(e.target.value)}
                            disabled={isLoading}
                            className="font-mono text-sm"
                        />
                    </div>

                    <MetalButton
                        onClick={handlePlaudSetup}
                        variant="cyan"
                        disabled={isLoading}
                        className="w-full"
                    >
                        {isLoading ? "Connecting..." : "Connect Device"}
                    </MetalButton>
                </div>
            )}

            {step === "complete" && (
                <div className="space-y-4 text-center">
                    <LEDIndicator
                        active
                        status="active"
                        size="lg"
                        pulse
                        className="mx-auto"
                    />
                    <div>
                        <h2 className="text-2xl font-bold">Setup Complete!</h2>
                        <p className="text-sm text-muted-foreground mt-1">
                            Your recordings will start syncing automatically
                        </p>
                    </div>
                    <MetalButton
                        onClick={() => router.push("/dashboard")}
                        variant="cyan"
                        className="w-full"
                    >
                        Go to Dashboard
                    </MetalButton>
                </div>
            )}
        </Panel>
    );
}
