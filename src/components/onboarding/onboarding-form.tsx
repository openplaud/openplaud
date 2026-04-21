"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { LEDIndicator } from "@/components/led-indicator";
import { MetalButton } from "@/components/metal-button";
import { Panel } from "@/components/panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Step = "email" | "code" | "complete";

const RESEND_COOLDOWN_MS = 30_000;
const GITHUB_REPO = "https://github.com/openplaud/openplaud";
const SEND_CODE_SOURCE = `${GITHUB_REPO}/blob/main/src/app/api/plaud/auth/send-code/route.ts`;
const VERIFY_SOURCE = `${GITHUB_REPO}/blob/main/src/app/api/plaud/auth/verify/route.ts`;

export function OnboardingForm() {
    const [step, setStep] = useState<Step>("email");
    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [otpToken, setOtpToken] = useState("");
    const [apiBase, setApiBase] = useState("");
    const [detectedRegion, setDetectedRegion] = useState("");
    const [lastSentAt, setLastSentAt] = useState(0);
    const router = useRouter();

    const regionLabel = useCallback((base: string) => {
        if (base.includes("euc1")) return "EU (Frankfurt)";
        if (base.includes("apse1")) return "Asia Pacific (Singapore)";
        if (base.includes("api.plaud.ai")) return "Global";
        return base;
    }, []);

    const handleSendCode = async () => {
        const trimmed = email.trim();
        if (!trimmed) {
            toast.error("Please enter your Plaud email");
            return;
        }

        const now = Date.now();
        if (now - lastSentAt < RESEND_COOLDOWN_MS) {
            const secsLeft = Math.ceil(
                (RESEND_COOLDOWN_MS - (now - lastSentAt)) / 1000,
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
            setApiBase(data.apiBase);
            setDetectedRegion(regionLabel(data.apiBase));
            setLastSentAt(Date.now());
            setStep("code");
            toast.success("Verification code sent — check your email");
        } catch (err) {
            toast.error(
                err instanceof Error ? err.message : "Failed to send code",
            );
        } finally {
            setIsLoading(false);
        }
    };

    const handleVerifyCode = async () => {
        const trimmed = code.trim();
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
                    apiBase,
                }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Verification failed");

            toast.success("Plaud account connected");
            setStep("complete");
        } catch (err) {
            toast.error(
                err instanceof Error ? err.message : "Verification failed",
            );
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Panel className="w-full max-w-2xl space-y-6">
            {/* Progress indicator */}
            <div className="flex items-center justify-center gap-8">
                <div className="flex items-center gap-2">
                    <LEDIndicator active={step === "email"} status="active" />
                    <span className="text-sm">Sign In</span>
                </div>
                <div className="flex items-center gap-2">
                    <LEDIndicator active={step === "code"} status="active" />
                    <span className="text-sm">Verify</span>
                </div>
                <div className="flex items-center gap-2">
                    <LEDIndicator
                        active={step === "complete"}
                        status="active"
                    />
                    <span className="text-sm">Complete</span>
                </div>
            </div>

            {/* ── Step 1: Email ── */}
            {step === "email" && (
                <div className="space-y-4">
                    <div>
                        <h2 className="text-xl font-bold">
                            Connect Your Plaud Account
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">
                            Sign in with the email you use on{" "}
                            <a
                                href="https://plaud.ai"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline decoration-dotted underline-offset-2"
                            >
                                plaud.ai
                            </a>
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="plaudEmail">Plaud Email</Label>
                        <Input
                            id="plaudEmail"
                            type="email"
                            placeholder="you@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            onKeyDown={(e) =>
                                e.key === "Enter" && handleSendCode()
                            }
                            disabled={isLoading}
                            autoFocus
                        />
                    </div>

                    <MetalButton
                        onClick={handleSendCode}
                        variant="cyan"
                        disabled={isLoading}
                        className="w-full"
                    >
                        {isLoading
                            ? "Sending code via plaud.ai…"
                            : "Send Verification Code"}
                    </MetalButton>

                    {/* Trust signal — inline, unobtrusive */}
                    <p className="text-xs text-muted-foreground/70 text-center leading-relaxed">
                        Your email is sent directly to Plaud's servers to
                        request a login code — it is never stored by OpenPlaud.{" "}
                        <a
                            href={SEND_CODE_SOURCE}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline decoration-dotted underline-offset-2 hover:text-muted-foreground transition-colors"
                        >
                            Read the source&nbsp;→
                        </a>
                    </p>
                </div>
            )}

            {/* ── Step 2: OTP Code ── */}
            {step === "code" && (
                <div className="space-y-4">
                    <div>
                        <h2 className="text-xl font-bold">
                            Enter Verification Code
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">
                            Plaud sent a code to{" "}
                            <span className="font-mono text-foreground">
                                {email}
                            </span>
                        </p>
                    </div>

                    {detectedRegion && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                            <LEDIndicator active status="active" size="sm" />
                            <span>Account region: {detectedRegion}</span>
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label htmlFor="otpCode">Verification Code</Label>
                        <Input
                            id="otpCode"
                            type="text"
                            inputMode="numeric"
                            placeholder="000000"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            onKeyDown={(e) =>
                                e.key === "Enter" && handleVerifyCode()
                            }
                            disabled={isLoading}
                            className="font-mono text-lg tracking-[0.3em] text-center"
                            autoFocus
                            autoComplete="one-time-code"
                        />
                    </div>

                    <MetalButton
                        onClick={handleVerifyCode}
                        variant="cyan"
                        disabled={isLoading}
                        className="w-full"
                    >
                        {isLoading
                            ? "Verifying with plaud.ai…"
                            : "Connect Account"}
                    </MetalButton>

                    <div className="flex items-center justify-between text-xs text-muted-foreground/70">
                        <button
                            type="button"
                            onClick={() => {
                                setStep("email");
                                setCode("");
                            }}
                            className="underline decoration-dotted underline-offset-2 hover:text-muted-foreground transition-colors"
                        >
                            ← Use a different email
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

                    <p className="text-xs text-muted-foreground/70 text-center leading-relaxed">
                        Your code is forwarded to Plaud to obtain an access
                        token, which is then encrypted (AES-256-GCM) and stored
                        only on this instance.{" "}
                        <a
                            href={VERIFY_SOURCE}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline decoration-dotted underline-offset-2 hover:text-muted-foreground transition-colors"
                        >
                            Read the source&nbsp;→
                        </a>
                    </p>
                </div>
            )}

            {/* ── Step 3: Complete ── */}
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

            {/* ── How this works (collapsed by default) ── */}
            {step !== "complete" && (
                <details className="group">
                    <summary className="text-xs text-muted-foreground/60 cursor-pointer hover:text-muted-foreground transition-colors select-none">
                        How does this work?
                    </summary>
                    <Panel
                        variant="inset"
                        className="mt-2 space-y-2 text-xs text-muted-foreground leading-relaxed"
                    >
                        <p>
                            OpenPlaud sends your email to Plaud's own servers (
                            <span className="font-mono">api.plaud.ai</span>) to
                            request a login code — the same way the official
                            Plaud app does. Your email and code are forwarded
                            directly and never stored.
                        </p>
                        <p>
                            After login, your access token is encrypted with
                            AES-256-GCM and stored only on this self-hosted
                            instance. No data leaves your server.
                        </p>
                        <p>
                            This is open source software — every line is
                            available for inspection:{" "}
                            <a
                                href={GITHUB_REPO}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline decoration-dotted underline-offset-2 hover:text-muted-foreground/90 transition-colors"
                            >
                                GitHub&nbsp;→
                            </a>
                        </p>
                    </Panel>
                </details>
            )}
        </Panel>
    );
}
