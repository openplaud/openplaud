"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
    requestNotificationPermission,
    showTranscriptionCompleteNotification,
} from "@/lib/notifications/browser";

interface TranscriptionEvent {
    transcriptionId: string;
    recordingId: string;
    filename: string;
    snippet: string;
}

const POLL_INTERVAL_MS = 5000;

export function TranscriptionNotifications() {
    const hasPermissionRef = useRef(false);
    const lastPollTimeRef = useRef(Date.now() - 30000);

    useEffect(() => {
        const poll = async () => {
            try {
                const since = new Date(lastPollTimeRef.current).toISOString();
                const res = await fetch(
                    `/api/me/transcription-events?since=${encodeURIComponent(since)}`,
                    { cache: "no-store" },
                );
                if (!res.ok) return;

                const data = await res.json();
                const events: TranscriptionEvent[] = data.events ?? [];

                // Advance the cursor before processing so the next poll
                // doesn't re-fetch these same events even if notification
                // rendering is slow.
                lastPollTimeRef.current = Date.now();

                if (events.length === 0) return;

                if (!hasPermissionRef.current) {
                    hasPermissionRef.current =
                        await requestNotificationPermission();
                }

                for (const event of events) {
                    toast.success(`Transcription complete: ${event.filename}`);

                    if (hasPermissionRef.current) {
                        showTranscriptionCompleteNotification(
                            event.filename,
                            event.snippet,
                        );
                    }
                }
            } catch {
                // Best-effort
            }
        };

        poll();
        const intervalId = setInterval(poll, POLL_INTERVAL_MS);
        return () => clearInterval(intervalId);
    }, []);

    return null;
}
