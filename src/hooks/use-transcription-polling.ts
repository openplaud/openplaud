"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface TranscriptionStatus {
    status: string | null;
    text: string | null;
    errorMessage: string | null;
    detectedLanguage?: string;
    provider?: string;
    model?: string;
    createdAt?: string;
}

interface UseTranscriptionPollingOptions {
    pollIntervalMs?: number;
    onCompleted?: (data: TranscriptionStatus) => void;
    onFailed?: (data: TranscriptionStatus) => void;
    autoStart?: boolean;
}

export function useTranscriptionPolling(
    recordingId: string | null,
    options: UseTranscriptionPollingOptions = {},
) {
    const {
        pollIntervalMs = 3000,
        onCompleted,
        onFailed,
        autoStart = true,
    } = options;

    const [status, setStatus] = useState<string | null>(null);
    const [transcriptionText, setTranscriptionText] = useState<string | null>(
        null,
    );
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isPolling, setIsPolling] = useState(false);

    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const fetchInFlightRef = useRef(false);
    const onCompletedRef = useRef(onCompleted);
    const onFailedRef = useRef(onFailed);

    // Sync callback refs so the polling loop always calls the latest callbacks
    useEffect(() => {
        onCompletedRef.current = onCompleted;
    }, [onCompleted]);

    useEffect(() => {
        onFailedRef.current = onFailed;
    }, [onFailed]);

    // Cleanup helper — clears interval and aborts in-flight fetch
    const stopPolling = useCallback(() => {
        if (intervalRef.current !== null) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        if (abortControllerRef.current !== null) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setIsPolling(false);
    }, []);

    // Reset all state to initial null values
    const resetState = useCallback(() => {
        setStatus(null);
        setTranscriptionText(null);
        setErrorMessage(null);
    }, []);

    // Kick off setInterval polling for a given recordingId.
    // Defined in component body so it always captures the current
    // pollIntervalMs. Callers must ensure old interval is cleared first.
    const startPolling = useCallback(
        (id: string) => {
            stopPolling();
            fetchInFlightRef.current = false;
            setIsPolling(true);

            const intervalId = setInterval(async () => {
                // Don't fire a new poll if the previous one hasn't returned yet
                if (fetchInFlightRef.current) return;
                fetchInFlightRef.current = true;

                const controller = new AbortController();
                abortControllerRef.current = controller;

                try {
                    const response = await fetch(
                        `/api/recordings/${id}/transcribe`,
                        { signal: controller.signal },
                    );

                    if (!response.ok) {
                        fetchInFlightRef.current = false;
                        return;
                    }

                    const data: TranscriptionStatus = await response.json();
                    fetchInFlightRef.current = false;

                    switch (data.status) {
                        case "completed": {
                            // Clear this specific interval — it matched `id`
                            if (intervalRef.current !== null) {
                                clearInterval(intervalRef.current);
                                intervalRef.current = null;
                            }
                            setIsPolling(false);
                            setTranscriptionText(data.text);
                            setStatus("completed");
                            onCompletedRef.current?.(data);
                            break;
                        }
                        case "failed": {
                            if (intervalRef.current !== null) {
                                clearInterval(intervalRef.current);
                                intervalRef.current = null;
                            }
                            setIsPolling(false);
                            setErrorMessage(data.errorMessage);
                            setStatus("failed");
                            onFailedRef.current?.(data);
                            break;
                        }
                        case "cancelled":
                        case null: {
                            if (intervalRef.current !== null) {
                                clearInterval(intervalRef.current);
                                intervalRef.current = null;
                            }
                            setIsPolling(false);
                            setStatus(null);
                            setTranscriptionText(null);
                            setErrorMessage(null);
                            break;
                        }
                        default:
                            // "pending" or "processing" — keep polling
                            setStatus(data.status);
                            break;
                    }
                } catch (err: unknown) {
                    fetchInFlightRef.current = false;
                    // Expected when we abort on unmount / recordingId change
                    if (
                        err instanceof DOMException &&
                        err.name === "AbortError"
                    ) {
                        return;
                    }
                }
            }, pollIntervalMs);

            intervalRef.current = intervalId;
        },
        [pollIntervalMs, stopPolling],
    );

    // ---- Lifecycle: mount / recordingId change ----
    useEffect(() => {
        const id = recordingId;

        // Tear down any previous polling
        stopPolling();
        fetchInFlightRef.current = false;
        resetState();

        if (!id) return;
        if (!autoStart) return;

        // Check current transcription status once on mount
        const checkStatus = async () => {
            const controller = new AbortController();
            abortControllerRef.current = controller;

            try {
                const res = await fetch(`/api/recordings/${id}/transcribe`, {
                    signal: controller.signal,
                });
                if (!res.ok) return;

                const data: TranscriptionStatus = await res.json();

                switch (data.status) {
                    case "pending":
                    case "processing":
                        setStatus(data.status);
                        startPolling(id);
                        break;
                    case "completed":
                        setStatus("completed");
                        setTranscriptionText(data.text);
                        break;
                    case "failed":
                        setStatus("failed");
                        setErrorMessage(data.errorMessage);
                        break;
                    // null or "cancelled" — leave state as reset
                }
            } catch (err: unknown) {
                if (err instanceof DOMException && err.name === "AbortError") {
                    return;
                }
            }
        };

        checkStatus();

        return () => {
            stopPolling();
        };
    }, [recordingId, autoStart, startPolling, stopPolling, resetState]);

    // ---- Actions ----

    const startTranscription = useCallback(async () => {
        if (!recordingId) return;

        const res = await fetch(`/api/recordings/${recordingId}/transcribe`, {
            method: "POST",
        });

        if (!res.ok) return;

        const data = await res.json();

        if (data.status === "pending" || data.status === "processing") {
            setStatus(data.status);
            startPolling(recordingId);
        }
    }, [recordingId, startPolling]);

    const cancelTranscription = useCallback(async () => {
        if (!recordingId) return;

        await fetch(`/api/recordings/${recordingId}/transcribe`, {
            method: "DELETE",
        });

        stopPolling();
        resetState();
    }, [recordingId, stopPolling, resetState]);

    return {
        status,
        transcriptionText,
        errorMessage,
        isPolling,
        startTranscription,
        cancelTranscription,
    };
}
