"use client";

import {
    ArrowLeft,
    ArrowRight,
    Bot,
    CheckCircle2,
    Mic,
    Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/onboarding-dialog-base";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

type OnboardingStep = "welcome" | "plaud" | "ai-provider" | "complete";

interface OnboardingDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onComplete: () => void;
}

export function OnboardingDialog({
    open,
    onOpenChange,
    onComplete,
}: OnboardingDialogProps) {
    const router = useRouter();
    const [step, setStep] = useState<OnboardingStep>("welcome");
    const [bearerToken, setBearerToken] = useState("");
    const [apiBase, setApiBase] = useState<string>(PLAUD_SERVERS[0].value);
    const [isLoading, setIsLoading] = useState(false);
    const [hasPlaudConnection, setHasPlaudConnection] = useState(false);
    const [hasAiProvider, setHasAiProvider] = useState(false);

    useEffect(() => {
        if (open && step === "plaud") {
            fetch("/api/plaud/connection")
                .then((res) => res.json())
                .then((data) => {
                    if (data.connected) {
                        setHasPlaudConnection(true);
                    }
                })
                .catch(() => {});
        }
    }, [open, step]);

    useEffect(() => {
        if (open && step === "ai-provider") {
            fetch("/api/settings/ai/providers")
                .then((res) => res.json())
                .then((data) => {
                    if (data.providers && data.providers.length > 0) {
                        setHasAiProvider(true);
                    }
                })
                .catch(() => {});
        }
    }, [open, step]);

    useEffect(() => {
        if (!open) {
            setStep("welcome");
            setBearerToken("");
            setApiBase(PLAUD_SERVERS[0].value);
            setIsLoading(false);
            setHasPlaudConnection(false);
            setHasAiProvider(false);
        }
    }, [open]);

    const handlePlaudConnect = async () => {
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

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || "Failed to connect");
            }

            toast.success("Plaud device connected");
            setHasPlaudConnection(true);
            setBearerToken("");
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to connect to Plaud",
            );
        } finally {
            setIsLoading(false);
        }
    };

    const handleSkipPlaud = () => {
        setStep("ai-provider");
    };

    const handleSkipAiProvider = () => {
        setStep("complete");
    };

    const handleComplete = async () => {
        try {
            await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ onboardingCompleted: true }),
            });
            onComplete();
            onOpenChange(false);
            router.refresh();
        } catch {
            toast.error("Failed to complete onboarding");
        }
    };

    const getStepIndex = () => {
        const steps: OnboardingStep[] = [
            "welcome",
            "plaud",
            "ai-provider",
            "complete",
        ];
        return steps.indexOf(step);
    };

    const isStepCompleted = (stepIndex: number) => {
        const currentIndex = getStepIndex();
        return stepIndex < currentIndex;
    };

    const isStepCurrent = (stepIndex: number) => {
        const currentIndex = getStepIndex();
        return stepIndex === currentIndex;
    };

    const canSkipStep = () => {
        if (step === "plaud") return true;
        if (step === "ai-provider") return true;
        return false;
    };

    const getNextStep = (): OnboardingStep | null => {
        if (step === "welcome") return "plaud";
        if (step === "plaud") return "ai-provider";
        if (step === "ai-provider") return "complete";
        return null;
    };

    const getPrevStep = (): OnboardingStep | null => {
        if (step === "plaud") return "welcome";
        if (step === "ai-provider") return "plaud";
        if (step === "complete") return "ai-provider";
        return null;
    };

    const handleNext = () => {
        const next = getNextStep();
        if (next) setStep(next);
    };

    const handlePrev = () => {
        const prev = getPrevStep();
        if (prev) setStep(prev);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle className="text-2xl" hidden>
                        Welcome to OpenPlaud
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-6">
                    {step === "welcome" && (
                        <div className="space-y-6">
                            <div className="text-center space-y-2">
                                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Mic className="w-8 h-8 text-primary" />
                                </div>
                                <h3 className="text-xl font-semibold">
                                    Your AI-Powered Recording Hub
                                </h3>
                                <p className="text-muted-foreground">
                                    OpenPlaud helps you manage, transcribe, and
                                    enhance your Plaud recordings with AI. Let's
                                    set up your account.
                                </p>
                            </div>

                            <div className="grid gap-4">
                                <Card className="gap-0 py-4">
                                    <CardHeader>
                                        <CardTitle className="text-base flex items-center gap-2">
                                            <Mic className="w-4 h-4" />
                                            Connect Your Device
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-sm text-muted-foreground">
                                            Link your Plaud device to start
                                            syncing recordings automatically
                                        </p>
                                    </CardContent>
                                </Card>

                                <Card className="gap-0 py-4">
                                    <CardHeader>
                                        <CardTitle className="text-base flex items-center gap-2">
                                            <Bot className="w-4 h-4" />
                                            Set Up AI Provider
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-sm text-muted-foreground">
                                            Configure an AI provider for
                                            automatic transcriptions
                                        </p>
                                    </CardContent>
                                </Card>

                                <Card className="gap-0 py-4">
                                    <CardHeader>
                                        <CardTitle className="text-base flex items-center gap-2">
                                            <Sparkles className="w-4 h-4" />
                                            Start Recording
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-sm text-muted-foreground">
                                            You're all set! Start recording and
                                            let AI do the work
                                        </p>
                                    </CardContent>
                                </Card>
                            </div>
                        </div>
                    )}

                    {step === "plaud" && (
                        <div className="space-y-6">
                            <div className="text-center space-y-2">
                                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Mic className="w-8 h-8 text-primary" />
                                </div>
                                <h3 className="text-xl font-semibold">
                                    Connect Your Plaud Device
                                </h3>
                                <p className="text-muted-foreground">
                                    Enter your Plaud bearer token to sync
                                    recordings automatically
                                </p>
                            </div>

                            {hasPlaudConnection ? (
                                <Card className="border-primary/50 bg-primary/5 py-3">
                                    <CardContent className="px-4">
                                        <div className="flex items-center gap-3">
                                            <CheckCircle2 className="w-5 h-5 text-primary" />
                                            <div className="flex-1">
                                                <p className="font-medium">
                                                    Device Connected
                                                </p>
                                                <p className="text-sm text-muted-foreground">
                                                    Your Plaud device is already
                                                    connected
                                                </p>
                                            </div>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setHasPlaudConnection(false)}
                                            >
                                                Reconnect
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            ) : (
                                <Card className="gap-0 py-4">
                                    <CardContent className="pt-6 space-y-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="api-server">
                                                API Server
                                            </Label>
                                            <Select value={apiBase} onValueChange={setApiBase}>
                                                <SelectTrigger id="api-server" disabled={isLoading}>
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
                                            <Label htmlFor="bearer-token">
                                                Bearer Token
                                            </Label>
                                            <Input
                                                id="bearer-token"
                                                type="password"
                                                placeholder="Enter your Plaud bearer token"
                                                value={bearerToken}
                                                onChange={(e) =>
                                                    setBearerToken(
                                                        e.target.value,
                                                    )
                                                }
                                                disabled={isLoading}
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                Open plaud.ai in a browser, log in, open DevTools (F12) → Network tab, refresh and copy the Authorization header value from any request to the Plaud API server.
                                            </p>
                                        </div>

                                        <Button
                                            onClick={handlePlaudConnect}
                                            disabled={
                                                isLoading || !bearerToken.trim()
                                            }
                                            className="w-full"
                                        >
                                            {isLoading
                                                ? "Connecting..."
                                                : "Connect Device"}
                                        </Button>
                                    </CardContent>
                                </Card>
                            )}
                        </div>
                    )}

                    {step === "ai-provider" && (
                        <div className="space-y-6">
                            <div className="text-center space-y-2">
                                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Bot className="w-8 h-8 text-primary" />
                                </div>
                                <h3 className="text-xl font-semibold">
                                    Set Up AI Provider
                                </h3>
                                <p className="text-muted-foreground">
                                    Configure an AI provider to enable automatic
                                    transcriptions
                                </p>
                            </div>

                            {hasAiProvider ? (
                                <Card className="border-primary/50 bg-primary/5 py-3">
                                    <CardContent>
                                        <div className="flex items-center gap-3">
                                            <CheckCircle2 className="w-5 h-5 text-primary" />
                                            <div className="flex-1">
                                                <p className="font-medium">
                                                    AI Provider Configured
                                                </p>
                                                <p className="text-sm text-muted-foreground">
                                                    You already have an AI
                                                    provider set up
                                                </p>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            ) : (
                                <Card className="gap-0 py-4">
                                    <CardContent className="pt-6 space-y-4">
                                        <p className="text-sm text-muted-foreground">
                                            You can set up an AI provider later
                                            in Settings. This enables automatic
                                            transcription of your recordings.
                                        </p>
                                        <Button
                                            onClick={() => {
                                                onOpenChange(false);
                                                window.location.href =
                                                    "/dashboard?settings=providers";
                                            }}
                                            variant="outline"
                                            className="w-full"
                                        >
                                            Go to Settings
                                        </Button>
                                    </CardContent>
                                </Card>
                            )}
                        </div>
                    )}

                    {step === "complete" && (
                        <div className="space-y-6">
                            <div className="text-center space-y-2">
                                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <CheckCircle2 className="w-8 h-8 text-primary" />
                                </div>
                                <h3 className="text-xl font-semibold">
                                    You're All Set!
                                </h3>
                                <p className="text-muted-foreground">
                                    Start recording and let OpenPlaud handle the
                                    rest
                                </p>
                            </div>

                            <Card className="gap-0 py-4">
                                <CardContent>
                                    <div className="space-y-3">
                                        <div className="flex items-start gap-3">
                                            <CheckCircle2 className="w-5 h-5 text-primary mt-0.5" />
                                            <div>
                                                <p className="font-medium">
                                                    Recordings sync
                                                    automatically
                                                </p>
                                                <p className="text-sm text-muted-foreground">
                                                    Your Plaud device will sync
                                                    recordings in the background
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-start gap-3">
                                            <CheckCircle2 className="w-5 h-5 text-primary mt-0.5" />
                                            <div>
                                                <p className="font-medium">
                                                    AI-powered transcriptions
                                                </p>
                                                <p className="text-sm text-muted-foreground">
                                                    Set up an AI provider to
                                                    transcribe recordings
                                                    automatically
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-start gap-3">
                                            <CheckCircle2 className="w-5 h-5 text-primary mt-0.5" />
                                            <div>
                                                <p className="font-medium">
                                                    Customize your experience
                                                </p>
                                                <p className="text-sm text-muted-foreground">
                                                    Adjust settings anytime from
                                                    the Settings menu
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    <DialogFooter className="gap-2 sm:gap-3 relative">
                        <div className="flex gap-2 flex-1">
                            {getPrevStep() && (
                                <Button variant="outline" onClick={handlePrev}>
                                    <ArrowLeft className="w-4 h-4 mr-2" />
                                    Previous
                                </Button>
                            )}
                        </div>

                        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 mt-0.5">
                            {[1, 2, 3, 4].map((stepNum, index) => {
                                const completed = isStepCompleted(index);
                                const current = isStepCurrent(index);
                                return (
                                    <div
                                        key={stepNum}
                                        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                                            completed || current
                                                ? "bg-primary text-primary-foreground"
                                                : "border-2 border-muted-foreground/30 text-muted-foreground"
                                        }`}
                                    >
                                        {stepNum}
                                    </div>
                                );
                            })}
                        </div>

                        <div className="flex gap-2 flex-1 justify-end">
                            {canSkipStep() && step !== "complete" && (
                                <Button
                                    variant="ghost"
                                    onClick={() => {
                                        if (step === "plaud") handleSkipPlaud();
                                        if (step === "ai-provider")
                                            handleSkipAiProvider();
                                    }}
                                >
                                    Skip
                                </Button>
                            )}
                            {step === "complete" ? (
                                <Button onClick={handleComplete}>
                                    Get Started
                                    <ArrowRight className="w-4 h-4 ml-2" />
                                </Button>
                            ) : (
                                getNextStep() && (
                                    <Button onClick={handleNext}>
                                        Next
                                        <ArrowRight className="w-4 h-4 ml-2" />
                                    </Button>
                                )
                            )}
                        </div>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
}
