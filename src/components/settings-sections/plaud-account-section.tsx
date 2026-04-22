"use client";

import { CheckCircle2, Link2Off, Mic, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PlaudOtpFlow } from "@/components/plaud/plaud-otp-flow";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import type { PlaudServerKey } from "@/lib/plaud/servers";

interface ConnectionInfo {
    connected: boolean;
    server?: PlaudServerKey;
    plaudEmail?: string | null;
    createdAt?: string;
    updatedAt?: string;
    apiBase?: string;
}

function regionLabel(server: PlaudServerKey | undefined, apiBase?: string) {
    if (!server) return "Unknown";
    if (server === "custom") return apiBase ?? "Custom";
    // PLAUD_SERVERS labels include the hostname; keep them short for the card
    if (server === "global") return "Global";
    if (server === "eu") return "EU (Frankfurt)";
    if (server === "apse1") return "Asia Pacific (Singapore)";
    return server;
}

export function PlaudAccountSection() {
    const [info, setInfo] = useState<ConnectionInfo | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [confirmOpen, setConfirmOpen] = useState<
        null | "switch" | "disconnect"
    >(null);
    const [switchOtpOpen, setSwitchOtpOpen] = useState(false);
    const [isDisconnecting, setIsDisconnecting] = useState(false);

    const fetchConnection = useCallback(async () => {
        try {
            const res = await fetch("/api/plaud/connection");
            if (!res.ok) throw new Error("Failed to load connection");
            const data: ConnectionInfo = await res.json();
            setInfo(data);
        } catch (error) {
            console.error("Failed to load Plaud connection:", error);
            setInfo({ connected: false });
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchConnection();
    }, [fetchConnection]);

    const handleDisconnect = async () => {
        setIsDisconnecting(true);
        try {
            const res = await fetch("/api/plaud/connection", {
                method: "DELETE",
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || "Failed to disconnect");
            }
            toast.success("Plaud account disconnected");
            setConfirmOpen(null);
            await fetchConnection();
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : "Failed to disconnect",
            );
        } finally {
            setIsDisconnecting(false);
        }
    };

    const handleSwitchConfirmed = () => {
        setConfirmOpen(null);
        setSwitchOtpOpen(true);
    };

    const handleSwitchSuccess = async () => {
        setSwitchOtpOpen(false);
        await fetchConnection();
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-8">
                <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
        );
    }

    const currentEmail = info?.plaudEmail ?? null;
    const currentEmailDisplay = currentEmail ?? "email unknown";

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Mic className="w-5 h-5" />
                    Plaud Account
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                    The Plaud account OpenPlaud pulls recordings from. Switching
                    accounts keeps your existing recordings — only future syncs
                    change.
                </p>
            </div>

            {info?.connected ? (
                <Card className="py-4">
                    <CardContent className="space-y-4">
                        <div className="flex items-start gap-3">
                            <CheckCircle2 className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">
                                    {currentEmail ? (
                                        <span className="font-mono">
                                            {currentEmail}
                                        </span>
                                    ) : (
                                        <span className="text-muted-foreground">
                                            Connected (email unknown)
                                        </span>
                                    )}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    Region:{" "}
                                    {regionLabel(info.server, info.apiBase)}
                                    {!currentEmail && (
                                        <>
                                            {" · "}
                                            <span>
                                                Reconnect below to display the
                                                email
                                            </span>
                                        </>
                                    )}
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="outline"
                                onClick={() => setConfirmOpen("switch")}
                            >
                                <RefreshCw className="w-4 h-4 mr-2" />
                                Switch account
                            </Button>
                            <Button
                                variant="ghost"
                                onClick={() => setConfirmOpen("disconnect")}
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                                <Link2Off className="w-4 h-4 mr-2" />
                                Disconnect
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <Card className="py-4">
                    <CardContent className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            No Plaud account connected. Sign in below to start
                            syncing recordings.
                        </p>
                        <PlaudOtpFlow
                            onSuccess={() => fetchConnection()}
                            compact
                        />
                    </CardContent>
                </Card>
            )}

            {/* Confirm: switch or disconnect */}
            <Dialog
                open={confirmOpen !== null}
                onOpenChange={(open) => !open && setConfirmOpen(null)}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {confirmOpen === "switch"
                                ? "Switch Plaud account?"
                                : "Disconnect Plaud account?"}
                        </DialogTitle>
                        <DialogDescription asChild>
                            <div className="space-y-2 pt-2">
                                {confirmOpen === "switch" ? (
                                    <p>
                                        This will unlink{" "}
                                        <span className="font-mono text-foreground">
                                            {currentEmailDisplay}
                                        </span>{" "}
                                        and let you sign in with a different
                                        Plaud account. Your existing recordings
                                        stay — only future syncs will come from
                                        the new account.
                                    </p>
                                ) : (
                                    <p>
                                        This will unlink{" "}
                                        <span className="font-mono text-foreground">
                                            {currentEmailDisplay}
                                        </span>
                                        . Your existing recordings stay, but
                                        sync will stop until you reconnect.
                                    </p>
                                )}
                            </div>
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setConfirmOpen(null)}
                            disabled={isDisconnecting}
                        >
                            Cancel
                        </Button>
                        {confirmOpen === "switch" ? (
                            <Button onClick={handleSwitchConfirmed}>
                                Continue
                            </Button>
                        ) : (
                            <Button
                                variant="destructive"
                                onClick={handleDisconnect}
                                disabled={isDisconnecting}
                            >
                                {isDisconnecting
                                    ? "Disconnecting…"
                                    : "Disconnect"}
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Switch: OTP dialog */}
            <Dialog
                open={switchOtpOpen}
                onOpenChange={(open) => setSwitchOtpOpen(open)}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Sign in to new Plaud account</DialogTitle>
                        <DialogDescription>
                            Enter the email for the Plaud account you want to
                            link. You'll receive a verification code from Plaud.
                        </DialogDescription>
                    </DialogHeader>
                    {switchOtpOpen && (
                        <PlaudOtpFlow onSuccess={handleSwitchSuccess} compact />
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
