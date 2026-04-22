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
import { useCallback, useEffect, useState } from "react";
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
    const [plaudEmail, setPlaudEmail] = useState("");
    const [otpCode, setOtpCode] = useState("");
    const [otpToken, setOtpToken] = useState("");
    const [plaudApiBase, setPlaudApiBase] = useState("");
    const [plaudStep, setPlaudStep] = useState<"email" | "code">("email");
    const [isLoading, setIsLoading] = useState(false);
    const [lastSentAt, setLastSentAt] = useState(0);
    const [hasPlaudConnection, setHasPlaudConnection] = useState(false);
    const [hasAiProvider, setHasAiProvider] = useState(false);

    const regionLabel = useCallback((base: string) => {
        if (base.includes("euc1")) return "EU (Frankfurt)";
        if (base.includes("apse1")) return "Asia Pacific (Singapore)";
        if (base.includes("api.plaud.ai")) return "Global";
        return base;
    }, []);

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
            setPlaudEmail("");
            setOtpCode("");
            setOtpToken("");
            setPlaudApiBase("");
            setPlaudStep("email");
            setIsLoading(false);
            setLastSentAt(0);
            setHasPlaudConnection(false);
            setHasAiProvider(false);
        }
    }, [open]);

    const handleSendCode = async () => {
        const trimmed = plaudEmail.trim();
        if (!trimmed) {
            toast.error("Please enter your Plaud email");
            return;
        }

        const now = Date.now();
        const COOLDOWN_MS = 30_000;
        if (now - lastSentAt < COOLDOWN_MS) {
            const secsLeft = Math.ceil(
                (COOLDOWN_MS - (now - lastSentAt)) / 1000,
            );
            toast.error(`Please wait ${secsLeft}s before resending`);
            return;
        }

        setIsLoading(true);
        try {
            const res = await fetch("/api/plaud/auth/send-code", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: trimmed }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to send code");

            setOtpToken(data.otpToken);
            setPlaudApiBase(data.apiBase);
            setLastSentAt(Date.now());
            setPlaudStep("code");
            toast.success("Verification code sent — check your email");
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : "Failed to send code",
            );
        } finally {
            setIsLoading(false);
        }
    };

    const handleVerifyCode = async () => {
        const trimmed = otpCode.trim();
        if (!trimmed) {
            toast.error("Please enter the verification code");
            return;
        }

        setIsLoading(true);
        try {
            const res = await fetch("/api/plaud/auth/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code: trimmed,
                    otpToken,
                    apiBase: plaudApiBase,
                    email: plaudEmail,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Verification failed");

            toast.success("Plaud account connected");
            setHasPlaudConnection(true);
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : "Verification failed",
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
                                            Connect Your Account
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-sm text-muted-foreground">
                                            Sign in with your Plaud email to
                                            sync recordings automatically
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
                                    Connect Your Plaud Account
                                </h3>
                                <p className="text-muted-foreground">
                                    Sign in with your Plaud email to sync
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
                                                    Your Plaud account is
                                                    connected
                                                </p>
                                            </div>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                    setHasPlaudConnection(
                                                        false,
                                                    );
                                                    setPlaudStep("email");
                                                    setOtpCode("");
                                                    setOtpToken("");
                                                }}
                                            >
                                                Reconnect
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            ) : (
                                <Card className="gap-0 py-4">
                                    <CardContent className="pt-6 space-y-4">
                                        {plaudStep === "email" ? (
                                            <>
                                                <div className="space-y-2">
                                                    <Label htmlFor="plaud-email">
                                                        Plaud Email
                                                    </Label>
                                                    <Input
                                                        id="plaud-email"
                                                        type="email"
                                                        placeholder="you@example.com"
                                                        value={plaudEmail}
                                                        onChange={(e) =>
                                                            setPlaudEmail(
                                                                e.target.value,
                                                            )
                                                        }
                                                        onKeyDown={(e) =>
                                                            e.key === "Enter" &&
                                                            handleSendCode()
                                                        }
                                                        disabled={isLoading}
                                                        autoFocus
                                                    />
                                                    <p className="text-xs text-muted-foreground">
                                                        The email you use to
                                                        sign in at plaud.ai.
                                                        We'll send a
                                                        verification code via
                                                        Plaud's servers.
                                                    </p>
                                                </div>

                                                <Button
                                                    onClick={handleSendCode}
                                                    disabled={
                                                        isLoading ||
                                                        !plaudEmail.trim()
                                                    }
                                                    className="w-full"
                                                >
                                                    {isLoading
                                                        ? "Sending code via plaud.ai…"
                                                        : "Send Verification Code"}
                                                </Button>

                                                <p className="text-[11px] text-muted-foreground/60 text-center leading-relaxed">
                                                    Your email is forwarded
                                                    directly to Plaud — never
                                                    stored by OpenPlaud.{" "}
                                                    <a
                                                        href="https://github.com/openplaud/openplaud/blob/main/src/app/api/plaud/auth/send-code/route.ts"
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="underline decoration-dotted underline-offset-2"
                                                    >
                                                        View source&nbsp;→
                                                    </a>
                                                </p>
                                            </>
                                        ) : (
                                            <>
                                                <div className="space-y-2">
                                                    <Label htmlFor="otp-code">
                                                        Verification Code
                                                    </Label>
                                                    <Input
                                                        id="otp-code"
                                                        type="text"
                                                        inputMode="numeric"
                                                        placeholder="000000"
                                                        value={otpCode}
                                                        onChange={(e) =>
                                                            setOtpCode(
                                                                e.target.value,
                                                            )
                                                        }
                                                        onKeyDown={(e) =>
                                                            e.key === "Enter" &&
                                                            handleVerifyCode()
                                                        }
                                                        disabled={isLoading}
                                                        className="font-mono text-lg tracking-[0.3em] text-center"
                                                        autoFocus
                                                        autoComplete="one-time-code"
                                                    />
                                                    <p className="text-xs text-muted-foreground">
                                                        Code sent to{" "}
                                                        <span className="font-mono">
                                                            {plaudEmail}
                                                        </span>
                                                        {plaudApiBase && (
                                                            <span>
                                                                {" "}
                                                                · Region:{" "}
                                                                {regionLabel(
                                                                    plaudApiBase,
                                                                )}
                                                            </span>
                                                        )}
                                                    </p>
                                                </div>

                                                <Button
                                                    onClick={handleVerifyCode}
                                                    disabled={
                                                        isLoading ||
                                                        !otpCode.trim()
                                                    }
                                                    className="w-full"
                                                >
                                                    {isLoading
                                                        ? "Verifying with plaud.ai…"
                                                        : "Connect Account"}
                                                </Button>

                                                <div className="flex items-center justify-between text-xs text-muted-foreground/60">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setPlaudStep(
                                                                "email",
                                                            );
                                                            setOtpCode("");
                                                        }}
                                                        className="underline decoration-dotted underline-offset-2 hover:text-muted-foreground transition-colors"
                                                    >
                                                        ← Different email
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={handleSendCode}
                                                        disabled={isLoading}
                                                        className="underline decoration-dotted underline-offset-2 hover:text-muted-foreground transition-colors disabled:opacity-50"
                                                    >
                                                        Resend code
                                                    </button>
                                                </div>
                                            </>
                                        )}
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
