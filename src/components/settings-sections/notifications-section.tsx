"use client";

import { Bell, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";
import { requestNotificationPermission } from "@/lib/notifications/browser";

export function NotificationsSection() {
    const {
        isLoadingSettings,
        isSavingSettings,
        setIsLoadingSettings,
        debouncedSave,
    } = useSettings();

    const [browserNotifications, setBrowserNotifications] = useState(true);
    const [emailNotifications, setEmailNotifications] = useState(false);
    const [barkNotifications, setBarkNotifications] = useState(false);
    const [notificationSound, setNotificationSound] = useState(true);
    const [notificationEmail, setNotificationEmail] = useState<string>("");
    const [barkPushUrl, setBarkPushUrl] = useState<string>("");
    const [, setBarkPushUrlSet] = useState(false);
    const [userEmail, setUserEmail] = useState<string>("");
    const [isSendingTestEmail, setIsSendingTestEmail] = useState(false);
    const [testEmailStatus, setTestEmailStatus] = useState<{
        type: "success" | "error" | null;
        message: string;
    }>({ type: null, message: "" });

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await fetch("/api/settings/user");
                if (response.ok) {
                    const data = await response.json();
                    setBrowserNotifications(data.browserNotifications ?? true);
                    setEmailNotifications(data.emailNotifications ?? false);
                    setBarkNotifications(data.barkNotifications ?? false);
                    setNotificationSound(data.notificationSound ?? true);
                    setUserEmail(data.userEmail ?? "");
                    setNotificationEmail(
                        data.notificationEmail || data.userEmail || "",
                    );
                    setBarkPushUrl(data.barkPushUrl || "");
                    setBarkPushUrlSet(data.barkPushUrlSet ?? false);
                }
            } catch (err) {
                console.error("Failed to fetch settings:", err);
            } finally {
                setIsLoadingSettings(false);
            }
        };
        fetchSettings();
    }, [setIsLoadingSettings]);

    const handleChange = (updates: Record<string, unknown>) => {
        debouncedSave(updates);
    };

    const handleBrowserNotificationsChange = (checked: boolean) => {
        setBrowserNotifications(checked);
        handleChange({ browserNotifications: checked });

        if (checked) {
            // Best-effort permission request; ignore result here
            void requestNotificationPermission();
        }
    };

    const handleEmailNotificationsChange = (checked: boolean) => {
        setEmailNotifications(checked);
        if (checked && !notificationEmail && userEmail) {
            setNotificationEmail(userEmail);
            handleChange({
                emailNotifications: checked,
                notificationEmail: userEmail,
            });
        } else {
            handleChange({ emailNotifications: checked });
        }
    };

    const handleNotificationEmailChange = (email: string) => {
        setNotificationEmail(email);
        debouncedSave({ notificationEmail: email || undefined });
    };

    const handleBarkNotificationsChange = (checked: boolean) => {
        setBarkNotifications(checked);
        handleChange({ barkNotifications: checked });
    };

    const handleBarkPushUrlChange = (url: string) => {
        setBarkPushUrl(url);
        if (url) {
            setBarkPushUrlSet(true);
        } else {
            // If user clears the input, mark as unset
            setBarkPushUrlSet(false);
        }
        debouncedSave({ barkPushUrl: url || null });
    };

    const handleSendTestEmail = async () => {
        const emailToTest = notificationEmail || userEmail;
        if (!emailToTest) {
            setTestEmailStatus({
                type: "error",
                message: "Please enter an email address first",
            });
            return;
        }

        setIsSendingTestEmail(true);
        setTestEmailStatus({ type: null, message: "" });

        try {
            const response = await fetch("/api/settings/test-email", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ email: emailToTest }),
            });

            const data = await response.json();

            if (response.ok) {
                setTestEmailStatus({
                    type: "success",
                    message: `Test email sent successfully to ${emailToTest}`,
                });
            } else {
                setTestEmailStatus({
                    type: "error",
                    message: data.error || "Failed to send test email",
                });
            }
        } catch (err) {
            console.error("Error sending test email:", err);
            setTestEmailStatus({
                type: "error",
                message: "Failed to send test email. Please try again.",
            });
        } finally {
            setIsSendingTestEmail(false);
        }
    };

    if (isLoadingSettings) {
        return (
            <div className="flex items-center justify-center py-8">
                <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <h2 className="text-lg font-semibold flex items-center gap-2">
                <Bell className="w-5 h-5" />
                Notification Settings
            </h2>
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div className="space-y-0.5 flex-1">
                        <Label
                            htmlFor="browser-notifications"
                            className="text-base"
                        >
                            Browser notifications
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            Show browser notifications for new recordings and
                            sync events
                        </p>
                    </div>
                    <Switch
                        id="browser-notifications"
                        checked={browserNotifications}
                        onCheckedChange={handleBrowserNotificationsChange}
                        disabled={isSavingSettings}
                    />
                </div>

                <div className="flex items-center justify-between">
                    <div className="space-y-0.5 flex-1">
                        <Label
                            htmlFor="email-notifications"
                            className="text-base"
                        >
                            Email notifications
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            Send email notifications for new recordings
                        </p>
                    </div>
                    <Switch
                        id="email-notifications"
                        checked={emailNotifications}
                        onCheckedChange={handleEmailNotificationsChange}
                        disabled={isSavingSettings}
                    />
                </div>

                {emailNotifications && (
                    <div className="space-y-2">
                        <Label htmlFor="notification-email">
                            Email address
                        </Label>
                        <Input
                            id="notification-email"
                            type="email"
                            value={notificationEmail}
                            onChange={(e) =>
                                handleNotificationEmailChange(e.target.value)
                            }
                            placeholder={userEmail || "your@email.com"}
                        />
                        <p className="text-xs text-muted-foreground">
                            {userEmail && notificationEmail === userEmail
                                ? "Using your account email. You can change this to a different address if needed."
                                : "Email address to receive notifications"}
                        </p>
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleSendTestEmail}
                                disabled={
                                    isSendingTestEmail ||
                                    !(notificationEmail || userEmail)
                                }
                            >
                                <Mail className="w-4 h-4" />
                                {isSendingTestEmail
                                    ? "Sending..."
                                    : "Send test email"}
                            </Button>
                            {testEmailStatus.type && (
                                <p
                                    className={`text-xs ${
                                        testEmailStatus.type === "success"
                                            ? "text-green-600 dark:text-green-400"
                                            : "text-red-600 dark:text-red-400"
                                    }`}
                                >
                                    {testEmailStatus.message}
                                </p>
                            )}
                        </div>
                    </div>
                )}

                <div className="flex items-center justify-between">
                    <div className="space-y-0.5 flex-1">
                        <Label
                            htmlFor="bark-notifications"
                            className="text-base"
                        >
                            Bark push notifications
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            Send push notifications via Bark for new recordings
                        </p>
                    </div>
                    <Switch
                        id="bark-notifications"
                        checked={barkNotifications}
                        onCheckedChange={handleBarkNotificationsChange}
                        disabled={isSavingSettings}
                    />
                </div>

                {barkNotifications && (
                    <div className="space-y-2">
                        <Label htmlFor="bark-push-url">Bark push URL</Label>
                        <Input
                            id="bark-push-url"
                            type="url"
                            value={barkPushUrl}
                            onChange={(e) =>
                                handleBarkPushUrlChange(e.target.value)
                            }
                            placeholder="https://api.day.app/your_key"
                        />
                        <p className="text-xs text-muted-foreground">
                            Copy the full push URL from the Bark app (e.g.,
                            https://api.day.app/your_key)
                        </p>
                    </div>
                )}

                <div className="flex items-center justify-between">
                    <div className="space-y-0.5 flex-1">
                        <Label
                            htmlFor="notification-sound"
                            className="text-base"
                        >
                            Notification sound
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            Play a sound when notifications are received
                        </p>
                    </div>
                    <Switch
                        id="notification-sound"
                        checked={notificationSound}
                        onCheckedChange={(checked) => {
                            setNotificationSound(checked);
                            handleChange({ notificationSound: checked });
                        }}
                        disabled={isSavingSettings}
                    />
                </div>
            </div>
        </div>
    );
}
