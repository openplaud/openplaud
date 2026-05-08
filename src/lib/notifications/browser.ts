/**
 * Browser notification utilities
 */

export async function requestNotificationPermission(): Promise<boolean> {
    if (!("Notification" in window)) {
        return false;
    }

    if (Notification.permission === "granted") {
        return true;
    }

    if (Notification.permission === "default") {
        const permission = await Notification.requestPermission();
        return permission === "granted";
    }

    return false;
}

export function showBrowserNotification(
    title: string,
    options?: NotificationOptions,
): void {
    if (!("Notification" in window)) {
        return;
    }

    if (Notification.permission === "granted") {
        new Notification(title, {
            icon: "/favicon.ico",
            badge: "/favicon.ico",
            ...options,
        });
    }
}

export function showNewRecordingNotification(count: number): void {
    const title =
        count === 1 ? "New recording synced" : `${count} new recordings synced`;

    showBrowserNotification(title, {
        body:
            count === 1
                ? "A new recording has been synced from your Plaud device"
                : `${count} new recordings have been synced from your Plaud device`,
        tag: "new-recording",
    });
}

export function showSyncCompleteNotification(): void {
    showBrowserNotification("Sync complete", {
        body: "Your recordings have been synced successfully",
        tag: "sync-complete",
    });
}

export function showTranscriptionCompleteNotification(
    filename: string,
    snippet: string,
): void {
    showBrowserNotification("Transcription complete", {
        body: `"${filename}" — ${snippet}`,
        tag: "transcription-complete",
    });
}
