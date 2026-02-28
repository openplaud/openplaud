"use client";

import { Calendar, FileText, Link, Unlink } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";

interface ConnectionStatus {
    connected: boolean;
    calendarId?: string | null;
    databaseName?: string | null;
    databaseId?: string | null;
    connectedAt?: string | null;
}

export function IntegrationsSection() {
    const { isLoadingSettings, setIsLoadingSettings } = useSettings();

    // Google Calendar state
    const [calendarStatus, setCalendarStatus] = useState<ConnectionStatus>({
        connected: false,
    });
    const [calendarLoading, setCalendarLoading] = useState(false);

    // Notion state
    const [notionStatus, setNotionStatus] = useState<ConnectionStatus>({
        connected: false,
    });
    const [notionApiKey, setNotionApiKey] = useState("");
    const [notionDatabaseId, setNotionDatabaseId] = useState("");
    const [notionLoading, setNotionLoading] = useState(false);

    // Settings state
    const [autoSyncToNotion, setAutoSyncToNotion] = useState(false);
    const [useTitleFromCalendar, setUseTitleFromCalendar] = useState(false);

    // Fetch connection statuses and settings
    useEffect(() => {
        const fetchAll = async () => {
            try {
                const [calendarRes, notionRes, settingsRes] = await Promise.all(
                    [
                        fetch("/api/integrations/google-calendar/connection"),
                        fetch("/api/integrations/notion/connection"),
                        fetch("/api/settings/user"),
                    ],
                );

                if (calendarRes.ok) {
                    setCalendarStatus(await calendarRes.json());
                }
                if (notionRes.ok) {
                    setNotionStatus(await notionRes.json());
                }
                if (settingsRes.ok) {
                    const settings = await settingsRes.json();
                    setAutoSyncToNotion(settings.autoSyncToNotion ?? false);
                    setUseTitleFromCalendar(
                        settings.useTitleFromCalendar ?? false,
                    );
                }
            } catch (error) {
                console.error("Failed to fetch integration status:", error);
            } finally {
                setIsLoadingSettings(false);
            }
        };
        fetchAll();
    }, [setIsLoadingSettings]);

    // Google Calendar connect
    const handleCalendarConnect = async () => {
        setCalendarLoading(true);
        try {
            const res = await fetch(
                "/api/integrations/google-calendar/connect",
            );
            const data = await res.json();

            if (data.authUrl) {
                window.location.href = data.authUrl;
            } else {
                toast.error(data.error || "Failed to start Google connection");
            }
        } catch {
            toast.error("Failed to connect Google Calendar");
        } finally {
            setCalendarLoading(false);
        }
    };

    // Google Calendar disconnect
    const handleCalendarDisconnect = async () => {
        try {
            const res = await fetch(
                "/api/integrations/google-calendar/connection",
                { method: "DELETE" },
            );
            if (res.ok) {
                setCalendarStatus({ connected: false });
                toast.success("Google Calendar disconnected");
            }
        } catch {
            toast.error("Failed to disconnect Google Calendar");
        }
    };

    // Notion connect
    const handleNotionConnect = async () => {
        if (!notionApiKey || !notionDatabaseId) {
            toast.error("Please fill in both the API key and Database ID");
            return;
        }

        setNotionLoading(true);
        try {
            const res = await fetch("/api/integrations/notion/connect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    apiKey: notionApiKey,
                    databaseId: notionDatabaseId,
                }),
            });

            const data = await res.json();

            if (data.success) {
                setNotionStatus({
                    connected: true,
                    databaseName: data.databaseName,
                    databaseId: notionDatabaseId,
                });
                setNotionApiKey("");
                setNotionDatabaseId("");
                toast.success(
                    `Connected to Notion database: ${data.databaseName}`,
                );
            } else {
                toast.error(data.error || "Failed to connect Notion");
            }
        } catch {
            toast.error("Failed to connect Notion");
        } finally {
            setNotionLoading(false);
        }
    };

    // Notion disconnect
    const handleNotionDisconnect = async () => {
        try {
            const res = await fetch("/api/integrations/notion/connection", {
                method: "DELETE",
            });
            if (res.ok) {
                setNotionStatus({ connected: false });
                toast.success("Notion disconnected");
            }
        } catch {
            toast.error("Failed to disconnect Notion");
        }
    };

    // Save integration settings
    const handleSettingChange = async (updates: {
        autoSyncToNotion?: boolean;
        useTitleFromCalendar?: boolean;
    }) => {
        if (updates.autoSyncToNotion !== undefined)
            setAutoSyncToNotion(updates.autoSyncToNotion);
        if (updates.useTitleFromCalendar !== undefined)
            setUseTitleFromCalendar(updates.useTitleFromCalendar);

        try {
            const res = await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updates),
            });

            if (!res.ok) throw new Error("Failed to save");
        } catch {
            // Revert on error
            if (updates.autoSyncToNotion !== undefined)
                setAutoSyncToNotion(!updates.autoSyncToNotion);
            if (updates.useTitleFromCalendar !== undefined)
                setUseTitleFromCalendar(!updates.useTitleFromCalendar);
            toast.error("Failed to save settings. Changes reverted.");
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
        <div className="space-y-8">
            {/* Google Calendar */}
            <div className="space-y-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Calendar className="w-5 h-5" />
                    Google Calendar
                </h2>
                <p className="text-sm text-muted-foreground">
                    Connect your Google Calendar to automatically use your
                    meeting title in recording names.
                </p>

                {calendarStatus.connected ? (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                            <Link className="w-4 h-4 text-green-500" />
                            <span className="text-sm text-green-700 dark:text-green-400">
                                Connected
                                {calendarStatus.calendarId &&
                                calendarStatus.calendarId !== "primary"
                                    ? ` (${calendarStatus.calendarId})`
                                    : " (Primary calendar)"}
                            </span>
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5 flex-1">
                                <Label
                                    htmlFor="use-calendar-title"
                                    className="text-base"
                                >
                                    Use calendar event for title
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                    Include your calendar event name in
                                    auto-generated recording titles
                                </p>
                            </div>
                            <Switch
                                id="use-calendar-title"
                                checked={useTitleFromCalendar}
                                onCheckedChange={(checked) =>
                                    handleSettingChange({
                                        useTitleFromCalendar: checked,
                                    })
                                }
                            />
                        </div>

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleCalendarDisconnect}
                            className="text-destructive"
                        >
                            <Unlink className="w-4 h-4 mr-2" />
                            Disconnect
                        </Button>
                    </div>
                ) : (
                    <Button
                        onClick={handleCalendarConnect}
                        disabled={calendarLoading}
                    >
                        <Calendar className="w-4 h-4 mr-2" />
                        {calendarLoading
                            ? "Connecting..."
                            : "Connect Google Calendar"}
                    </Button>
                )}
            </div>

            <hr className="border-border" />

            {/* Notion */}
            <div className="space-y-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    Notion
                </h2>
                <p className="text-sm text-muted-foreground">
                    Connect Notion to automatically push transcriptions to your
                    database after each recording.
                </p>

                {notionStatus.connected ? (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                            <Link className="w-4 h-4 text-green-500" />
                            <span className="text-sm text-green-700 dark:text-green-400">
                                Connected to &quot;
                                {notionStatus.databaseName || "Untitled"}
                                &quot;
                            </span>
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5 flex-1">
                                <Label
                                    htmlFor="auto-sync-notion"
                                    className="text-base"
                                >
                                    Auto-sync to Notion
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                    Automatically push transcriptions to Notion
                                    after each recording is transcribed
                                </p>
                            </div>
                            <Switch
                                id="auto-sync-notion"
                                checked={autoSyncToNotion}
                                onCheckedChange={(checked) =>
                                    handleSettingChange({
                                        autoSyncToNotion: checked,
                                    })
                                }
                            />
                        </div>

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleNotionDisconnect}
                            className="text-destructive"
                        >
                            <Unlink className="w-4 h-4 mr-2" />
                            Disconnect
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="notion-api-key">
                                Notion Integration Token
                            </Label>
                            <Input
                                id="notion-api-key"
                                type="password"
                                placeholder="ntn_..."
                                value={notionApiKey}
                                onChange={(e) =>
                                    setNotionApiKey(e.target.value)
                                }
                            />
                            <p className="text-xs text-muted-foreground">
                                Create an internal integration at{" "}
                                <a
                                    href="https://www.notion.so/my-integrations"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline"
                                >
                                    notion.so/my-integrations
                                </a>{" "}
                                and share your database with it.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="notion-database-id">
                                Database ID
                            </Label>
                            <Input
                                id="notion-database-id"
                                placeholder="abc123def456..."
                                value={notionDatabaseId}
                                onChange={(e) =>
                                    setNotionDatabaseId(e.target.value)
                                }
                            />
                            <p className="text-xs text-muted-foreground">
                                Open your database in Notion, copy the URL. The
                                database ID is the long string between the last
                                slash and the question mark.
                            </p>
                        </div>

                        <Button
                            onClick={handleNotionConnect}
                            disabled={
                                notionLoading ||
                                !notionApiKey ||
                                !notionDatabaseId
                            }
                        >
                            <FileText className="w-4 h-4 mr-2" />
                            {notionLoading ? "Connecting..." : "Connect Notion"}
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
