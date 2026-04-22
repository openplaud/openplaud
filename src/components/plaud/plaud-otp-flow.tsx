"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface PlaudOtpFlowSuccess {
    plaudEmail: string;
    apiBase: string;
}

interface PlaudOtpFlowProps {
    /** Called after a successful OTP verification. */
    onSuccess: (result: PlaudOtpFlowSuccess) => void;
    /** Prefill the email field (e.g. when reconnecting / switching accounts). */
    initialEmail?: string;
    /** Compact form — no trust-signal footnote, slightly tighter spacing. */
    compact?: boolean;
}

const RESEND_COOLDOWN_MS = 30_000;
const SEND_CODE_SOURCE =
    "https://github.com/openplaud/openplaud/blob/main/src/app/api/plaud/auth/send-code/route.ts";

function regionLabel(base: string) {
    if (base.includes("euc1")) return "EU (Frankfurt)";
    if (base.includes("apse1")) return "Asia Pacific (Singapore)";
    if (base.includes("api.plaud.ai")) return "Global";
    return base;
}

/**
 * Reusable two-step Plaud OTP flow (email → code → verified).
 *
 * Owns all OTP-related state and API calls. Parents decide the chrome
 * around it (dialog, card, inline panel, etc.) and what happens on success.
 */
export function PlaudOtpFlow({
    onSuccess,
    initialEmail = "",
    compact = false,
}: PlaudOtpFlowProps) {
    const [step, setStep] = useState<"email" | "code">("email");
    const [email, setEmail] = useState(initialEmail);
    const [code, setCode] = useState("");
    const [otpToken, setOtpToken] = useState("");
    const [apiBase, setApiBase] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [lastSentAt, setLastSentAt] = useState(0);

    const handleSendCode = useCallback(async () => {
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
            setLastSentAt(Date.now());
            setStep("code");
            toast.success("Verification code sent — check your email");
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : "Failed to send code",
            );
        } finally {
            setIsLoading(false);
        }
    }, [email, lastSentAt]);

    const handleVerifyCode = useCallback(async () => {
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
                    email,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Verification failed");

            toast.success("Plaud account connected");
            onSuccess({ plaudEmail: email.trim(), apiBase });
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : "Verification failed",
            );
        } finally {
            setIsLoading(false);
        }
    }, [code, otpToken, apiBase, email, onSuccess]);

    const gapClass = compact ? "space-y-3" : "space-y-4";

    if (step === "email") {
        return (
            <div className={gapClass}>
                <div className="space-y-2">
                    <Label htmlFor="plaud-otp-email">Plaud Email</Label>
                    <Input
                        id="plaud-otp-email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleSendCode();
                        }}
                        disabled={isLoading}
                        autoFocus
                    />
                    <p className="text-xs text-muted-foreground">
                        The email you use to sign in at plaud.ai. We'll send a
                        verification code via Plaud's servers.
                    </p>
                </div>

                <Button
                    onClick={handleSendCode}
                    disabled={isLoading || !email.trim()}
                    className="w-full"
                >
                    {isLoading
                        ? "Sending code via plaud.ai…"
                        : "Send Verification Code"}
                </Button>

                {!compact && (
                    <p className="text-[11px] text-muted-foreground/60 text-center leading-relaxed">
                        Your email is forwarded directly to Plaud — never stored
                        by OpenPlaud.{" "}
                        <a
                            href={SEND_CODE_SOURCE}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline decoration-dotted underline-offset-2"
                        >
                            View source&nbsp;→
                        </a>
                    </p>
                )}
            </div>
        );
    }

    return (
        <div className={gapClass}>
            <div className="space-y-2">
                <Label htmlFor="plaud-otp-code">Verification Code</Label>
                <Input
                    id="plaud-otp-code"
                    type="text"
                    inputMode="numeric"
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") handleVerifyCode();
                    }}
                    disabled={isLoading}
                    className="font-mono text-lg tracking-[0.3em] text-center"
                    autoFocus
                    autoComplete="one-time-code"
                />
                <p className="text-xs text-muted-foreground">
                    Code sent to <span className="font-mono">{email}</span>
                    {apiBase && <span> · Region: {regionLabel(apiBase)}</span>}
                </p>
            </div>

            <Button
                onClick={handleVerifyCode}
                disabled={isLoading || !code.trim()}
                className="w-full"
            >
                {isLoading ? "Verifying with plaud.ai…" : "Connect Account"}
            </Button>

            <div className="flex items-center justify-between text-xs text-muted-foreground/60">
                <button
                    type="button"
                    onClick={() => {
                        setStep("email");
                        setCode("");
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
        </div>
    );
}
