"use client";

/**
 * Shared building blocks for the command palette. Lives next to
 * `command-palette.tsx` so all the groups (Recordings/Actions/Theme)
 * and the footer can share the same Row/Kbd primitives without
 * either component re-exporting things from the other.
 */

import { Command } from "cmdk";
import {
    FileText,
    Keyboard,
    Loader2,
    Mic,
    Monitor,
    Moon,
    RefreshCw,
    Settings,
    Sparkles,
    Sun,
    Upload,
} from "lucide-react";
import type { ReactNode } from "react";
import { type DateTimeFormat, formatDateTime } from "@/lib/format-date";
import { formatDurationMs } from "@/lib/format-duration";
import type { Recording } from "@/types/recording";

export const RECORDING_CAP = 200;

interface TranscriptionData {
    text?: string;
    language?: string;
}

/**
 * Strip transcript noise (timecodes, speaker labels, redundant
 * whitespace) into a single-line snippet usable as both a row
 * subtitle and a fuzzy-search target. Kept in sync with the helper
 * of the same name in `recording-list.tsx`; we duplicate rather
 * than import-cross because the list's helper is module-local
 * there and we don't want to widen its surface for one caller.
 */
export function transcriptSnippet(
    text: string | undefined,
    maxChars = 140,
): string | null {
    if (!text) return null;
    const stripped = text
        .replace(/\[[^\]]+\]/g, " ")
        .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!stripped) return null;
    if (stripped.length <= maxChars) return stripped;
    return `${stripped.slice(0, maxChars - 1).trimEnd()}…`;
}

/**
 * Generic two-line row used by every cmdk item in the palette so
 * icon weight, alignment, and accessory placement stay consistent
 * across groups (recordings, actions, theme).
 */
export function Row({
    icon,
    title,
    subtitle,
    accessory,
}: {
    icon: ReactNode;
    title: ReactNode;
    subtitle?: ReactNode;
    accessory?: ReactNode;
}) {
    return (
        <>
            <span aria-hidden="true" className="shrink-0">
                {icon}
            </span>
            <span className="cmd-body">
                <span className="cmd-title">{title}</span>
                {subtitle ? (
                    <span className="cmd-subtitle">{subtitle}</span>
                ) : null}
            </span>
            {accessory ? (
                <span className="cmd-accessory">{accessory}</span>
            ) : null}
        </>
    );
}

export function Kbd({ children }: { children: ReactNode }) {
    return <kbd className="cmd-kbd">{children}</kbd>;
}

/**
 * Recordings group. Renders the recent list with state-aware leading
 * icons, transcript-snippet subtitles, and an inline Transcribe quick
 * action on rows without a transcript. The Transcribe button calls
 * onTranscribe (not onSelect) so it doesn't change the active row.
 */
export function RecordingsGroup({
    recordings,
    transcriptions,
    currentRecording,
    inFlightActions,
    dateTimeFormat,
    onSelectRecording,
    onTranscribeRecording,
    runAction,
}: {
    recordings: Recording[];
    transcriptions: Map<string, TranscriptionData>;
    currentRecording: Recording | null;
    inFlightActions: Map<string, "transcribing" | "summarizing">;
    dateTimeFormat: DateTimeFormat;
    onSelectRecording: (r: Recording) => void;
    onTranscribeRecording: (id: string) => void;
    runAction: (fn: () => void) => () => void;
}) {
    if (recordings.length === 0) return null;
    const overflowCount = Math.max(0, recordings.length - RECORDING_CAP);

    return (
        <Command.Group heading="Recent">
            {recordings.map((r) => {
                const snippet = transcriptSnippet(
                    transcriptions.get(r.id)?.text,
                );
                const inFlight = inFlightActions.get(r.id);
                const isCurrent = currentRecording?.id === r.id;

                // Leading icon doubles as a state indicator so the user
                // can scan and immediately tell which recordings are
                // audio-only, transcribed, or fully processed. In-flight
                // wins because it's the most actionable state ("don't
                // trigger this again").
                let stateIcon: ReactNode;
                let stateLabel: string;
                if (inFlight) {
                    stateIcon = (
                        <Loader2 className="size-4 animate-spin text-primary" />
                    );
                    stateLabel =
                        inFlight === "transcribing"
                            ? "Transcribing"
                            : "Summarizing";
                } else if (!r.hasTranscript) {
                    stateIcon = (
                        <Mic className="size-4 text-muted-foreground" />
                    );
                    stateLabel = "Audio only";
                } else if (!r.hasSummary) {
                    stateIcon = (
                        <FileText className="size-4 text-foreground/70" />
                    );
                    stateLabel = "Transcribed";
                } else {
                    stateIcon = <Sparkles className="size-4 text-primary" />;
                    stateLabel = "Transcribed & summarized";
                }

                // Null/undefined check -- a 0 ms duration is real (treat
                // as "0:00") and should still render.
                const durationText =
                    r.duration != null ? formatDurationMs(r.duration) : null;
                const timeText = formatDateTime(r.startTime, dateTimeFormat);
                const subtitle: ReactNode = snippet
                    ? snippet
                    : durationText
                      ? `${durationText} · ${timeText}`
                      : timeText;

                // Search value bakes in transcript text so cmdk's fuzzy
                // matcher finds recordings by content, not just filename.
                const searchValue = [r.filename, r.id, snippet ?? ""].join(" ");

                let accessory: ReactNode = null;
                if (inFlight === "transcribing") {
                    accessory = (
                        <span className="cmd-pill">
                            <Loader2 className="size-3 animate-spin" />
                            Transcribing
                        </span>
                    );
                } else if (inFlight === "summarizing") {
                    accessory = (
                        <span className="cmd-pill">
                            <Loader2 className="size-3 animate-spin" />
                            Summarizing
                        </span>
                    );
                } else if (!r.hasTranscript) {
                    // Inline quick action: kicks off transcription
                    // without changing the current selection.
                    // stopPropagation on both pointerdown and click is
                    // intentional -- cmdk treats a pointerdown anywhere
                    // inside an item as selection intent, which would
                    // fire the row's "open recording" handler too.
                    // We don't close the palette after click so the user
                    // can queue several transcribes in succession; the
                    // row's accessory flips to "Transcribing" the moment
                    // markAction lands.
                    accessory = (
                        <button
                            type="button"
                            className="cmd-row-action"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                                e.stopPropagation();
                                onTranscribeRecording(r.id);
                            }}
                            aria-label={`Transcribe ${r.filename}`}
                        >
                            <Sparkles className="size-3" aria-hidden="true" />
                            Transcribe
                        </button>
                    );
                } else if (isCurrent) {
                    accessory = (
                        <span className="cmd-pill">
                            <span
                                aria-hidden="true"
                                className="inline-block size-1.5 rounded-full bg-primary"
                            />
                            Selected
                        </span>
                    );
                }
                // No fallback accessory -- "healthy rows are silent."

                return (
                    <Command.Item
                        key={r.id}
                        value={searchValue}
                        onSelect={runAction(() => onSelectRecording(r))}
                    >
                        <Row
                            icon={
                                <span title={stateLabel} aria-hidden="true">
                                    {stateIcon}
                                </span>
                            }
                            title={r.filename}
                            subtitle={subtitle}
                            accessory={accessory}
                        />
                    </Command.Item>
                );
            })}
            {overflowCount > 0 && (
                <div className="cmd-more-hint">
                    +{overflowCount} more · refine your search to narrow the
                    list
                </div>
            )}
        </Command.Group>
    );
}

/**
 * Static actions group (sync / upload / settings / shortcuts).
 * runAction wraps each handler so the palette closes before the
 * action runs.
 */
export function ActionsGroup({
    onSync,
    onUpload,
    onOpenSettings,
    onOpenShortcuts,
    runAction,
}: {
    onSync: () => void;
    onUpload: () => void;
    onOpenSettings: () => void;
    onOpenShortcuts: () => void;
    runAction: (fn: () => void) => () => void;
}) {
    return (
        <Command.Group heading="Actions">
            <Command.Item onSelect={runAction(onSync)}>
                <Row
                    icon={
                        <RefreshCw className="size-4 text-muted-foreground" />
                    }
                    title="Sync device"
                />
            </Command.Item>
            <Command.Item onSelect={runAction(onUpload)}>
                <Row
                    icon={<Upload className="size-4 text-muted-foreground" />}
                    title="Upload audio"
                />
            </Command.Item>
            <Command.Item onSelect={runAction(onOpenSettings)}>
                <Row
                    icon={<Settings className="size-4 text-muted-foreground" />}
                    title="Open settings"
                    accessory={<Kbd>,</Kbd>}
                />
            </Command.Item>
            <Command.Item onSelect={runAction(onOpenShortcuts)}>
                <Row
                    icon={<Keyboard className="size-4 text-muted-foreground" />}
                    title="Keyboard shortcuts"
                    accessory={<Kbd>?</Kbd>}
                />
            </Command.Item>
        </Command.Group>
    );
}

/**
 * Theme picker group. Active theme is shown via an "Active" accessory
 * pill, matching the rest of the palette's selected-state convention.
 */
export function ThemeGroup({
    currentTheme,
    onSetTheme,
    runAction,
}: {
    currentTheme: "light" | "dark" | "system";
    onSetTheme: (t: "light" | "dark" | "system") => void;
    runAction: (fn: () => void) => () => void;
}) {
    return (
        <Command.Group heading="Theme">
            <Command.Item onSelect={runAction(() => onSetTheme("light"))}>
                <Row
                    icon={<Sun className="size-4 text-muted-foreground" />}
                    title="Light"
                    accessory={
                        currentTheme === "light" ? (
                            <span className="cmd-pill">Active</span>
                        ) : null
                    }
                />
            </Command.Item>
            <Command.Item onSelect={runAction(() => onSetTheme("dark"))}>
                <Row
                    icon={<Moon className="size-4 text-muted-foreground" />}
                    title="Dark"
                    accessory={
                        currentTheme === "dark" ? (
                            <span className="cmd-pill">Active</span>
                        ) : null
                    }
                />
            </Command.Item>
            <Command.Item onSelect={runAction(() => onSetTheme("system"))}>
                <Row
                    icon={<Monitor className="size-4 text-muted-foreground" />}
                    title="Auto"
                    accessory={
                        currentTheme === "system" ? (
                            <span className="cmd-pill">Active</span>
                        ) : null
                    }
                />
            </Command.Item>
        </Command.Group>
    );
}

/**
 * Footer keyboard hints. Only renders the transcribe hint when at
 * least one row in the palette would respond to it -- otherwise it's
 * noise.
 */
export function PaletteFooter({
    showTranscribeHint,
}: {
    showTranscribeHint: boolean;
}) {
    return (
        <div className="cmd-footer">
            <div className="cmd-footer-group">
                <span className="cmd-footer-hint">
                    <Kbd>↑</Kbd>
                    <Kbd>↓</Kbd>
                    navigate
                </span>
                <span className="cmd-footer-hint">
                    <Kbd>↵</Kbd>
                    select
                </span>
                <span className="cmd-footer-hint">
                    <Kbd>esc</Kbd>
                    close
                </span>
                {showTranscribeHint && (
                    <span className="cmd-footer-hint">
                        <Kbd>⌘</Kbd>
                        <Kbd>↵</Kbd>
                        transcribe
                    </span>
                )}
            </div>
            <span className="cmd-footer-hint">
                <Kbd>⌘K</Kbd>
                toggle
            </span>
        </div>
    );
}
