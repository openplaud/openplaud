"use client";

import {
    ArrowDownAZ,
    Clock,
    FileText,
    HardDrive,
    Loader2,
    Mic,
    MoreHorizontal,
    Play,
    Rows3,
    Search,
    Sparkles,
    Trash2,
    X,
} from "lucide-react";
import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { dateGroupLabel, formatDateTime } from "@/lib/format-date";
import { formatDurationMs } from "@/lib/format-duration";
import { cn } from "@/lib/utils";
import type { DateTimeFormat } from "@/types/common";
import type { Recording } from "@/types/recording";

export type SortOrder = "newest" | "oldest" | "name";
export type ListDensity = "comfortable" | "compact";

export interface PendingUpload {
    id: string; // local nanoid-ish, "pending:..."
    filename: string;
    filesize: number;
}

interface TranscriptionData {
    text?: string;
    language?: string;
}

interface RecordingListProps {
    recordings: Recording[];
    transcriptions: Map<string, TranscriptionData>;
    currentRecording: Recording | null;
    pendingUploads: PendingUpload[];
    inFlightActions: Map<string, "transcribing" | "summarizing">;
    onSelect: (recording: Recording) => void;
    onDelete: (recording: Recording) => Promise<void>;
    initialDateTimeFormat: DateTimeFormat;
    initialSortOrder: SortOrder;
    initialDensity: ListDensity;
    initialChunkSize: number;
}

export interface RecordingListHandle {
    focusSearch: () => void;
    next: () => void;
    prev: () => void;
}

// Persist a single user-settings field. Best-effort; UI already changed.
function persistSetting(field: string, value: unknown) {
    fetch("/api/settings/user", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
    }).catch(() => {});
}

// Use the shared duration formatter so list rows automatically pick up
// the H:MM:SS layout for hour-plus recordings.
const formatDuration = formatDurationMs;

function formatSize(bytes: number) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const RecordingList = forwardRef<
    RecordingListHandle,
    RecordingListProps
>(function RecordingList(
    {
        recordings,
        transcriptions,
        currentRecording,
        pendingUploads,
        inFlightActions,
        onSelect,
        onDelete,
        initialDateTimeFormat,
        initialSortOrder,
        initialDensity,
        initialChunkSize,
    },
    ref,
) {
    const [dateTimeFormat] = useState<DateTimeFormat>(initialDateTimeFormat);
    const [sortOrder, setSortOrder] = useState<SortOrder>(initialSortOrder);
    const [density, setDensity] = useState<ListDensity>(initialDensity);
    const [query, setQuery] = useState("");
    const [visibleCount, setVisibleCount] = useState(initialChunkSize);
    const searchRef = useRef<HTMLInputElement>(null);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

    const setSortOrderPersisted = useCallback((next: SortOrder) => {
        setSortOrder(next);
        persistSetting("recordingListSortOrder", next);
    }, []);

    const setDensityPersisted = useCallback((next: ListDensity) => {
        setDensity(next);
        persistSetting("listDensity", next);
    }, []);

    // Filter (filename + transcript text), then sort.
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        const base = q
            ? recordings.filter((r) => {
                  if (r.filename.toLowerCase().includes(q)) return true;
                  const t = transcriptions.get(r.id);
                  return !!t?.text && t.text.toLowerCase().includes(q);
              })
            : recordings;

        const sorted = [...base];
        switch (sortOrder) {
            case "newest":
                sorted.sort(
                    (a, b) =>
                        new Date(b.startTime).getTime() -
                        new Date(a.startTime).getTime(),
                );
                break;
            case "oldest":
                sorted.sort(
                    (a, b) =>
                        new Date(a.startTime).getTime() -
                        new Date(b.startTime).getTime(),
                );
                break;
            case "name":
                sorted.sort((a, b) => a.filename.localeCompare(b.filename));
                break;
        }
        return sorted;
    }, [recordings, transcriptions, query, sortOrder]);

    const visible = filtered.slice(0, visibleCount);

    // Group adjacent rows by date bucket. Only meaningful when sorting
    // by time; for "name" we render a single ungrouped block.
    const grouped = useMemo(() => {
        if (sortOrder === "name") {
            return [{ label: null as string | null, items: visible }];
        }
        const groups: { label: string; items: Recording[] }[] = [];
        for (const r of visible) {
            const label = dateGroupLabel(r.startTime);
            const last = groups[groups.length - 1];
            if (last && last.label === label) {
                last.items.push(r);
            } else {
                groups.push({ label, items: [r] });
            }
        }
        return groups;
    }, [visible, sortOrder]);

    // Reset visibleCount when the filter changes so search results
    // aren't accidentally truncated.
    useEffect(() => {
        setVisibleCount(initialChunkSize);
    }, [initialChunkSize]);
    useEffect(() => {
        setVisibleCount((c) =>
            c > filtered.length
                ? Math.max(initialChunkSize, filtered.length)
                : c,
        );
    }, [filtered.length, initialChunkSize]);

    // Infinite-scroll sentinel
    useEffect(() => {
        const el = sentinelRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            (entries) => {
                for (const e of entries) {
                    if (e.isIntersecting) {
                        setVisibleCount((c) =>
                            Math.min(c + initialChunkSize, filtered.length),
                        );
                    }
                }
            },
            { rootMargin: "200px" },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [filtered.length, initialChunkSize]);

    // Imperative API for parent-driven keyboard nav.
    useImperativeHandle(
        ref,
        () => ({
            focusSearch: () => searchRef.current?.focus(),
            next: () => {
                const list = filtered;
                if (list.length === 0) return;
                const idx = currentRecording
                    ? list.findIndex((r) => r.id === currentRecording.id)
                    : -1;
                const nextIdx = Math.min(idx + 1, list.length - 1);
                const target = list[Math.max(0, nextIdx)];
                if (target) {
                    onSelect(target);
                    rowRefs.current
                        .get(target.id)
                        ?.scrollIntoView({ block: "nearest" });
                }
            },
            prev: () => {
                const list = filtered;
                if (list.length === 0) return;
                const idx = currentRecording
                    ? list.findIndex((r) => r.id === currentRecording.id)
                    : 0;
                const prevIdx = Math.max(0, idx - 1);
                const target = list[prevIdx];
                if (target) {
                    onSelect(target);
                    rowRefs.current
                        .get(target.id)
                        ?.scrollIntoView({ block: "nearest" });
                }
            },
        }),
        [filtered, currentRecording, onSelect],
    );

    const isCompact = density === "compact";
    const rowPadding = isCompact ? "px-4 py-2" : "px-4 py-3";

    return (
        <Card hasNoPadding>
            <CardContent className="p-0">
                {/* Header: search + sort + density */}
                <div className="flex flex-col gap-2 border-b p-3">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            ref={searchRef}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search recordings, transcripts..."
                            className="h-9 pl-8 pr-8"
                            aria-label="Search recordings"
                        />
                        {query && (
                            <button
                                type="button"
                                onClick={() => setQuery("")}
                                aria-label="Clear search"
                                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                            >
                                <X className="size-4" />
                            </button>
                        )}
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                            {filtered.length}
                            {query ? " matching" : ""} of {recordings.length}{" "}
                            recording
                            {recordings.length !== 1 ? "s" : ""}
                        </span>
                        <div className="flex items-center gap-1">
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 px-2 text-xs"
                                        aria-label="Sort"
                                    >
                                        <ArrowDownAZ className="size-3.5" />
                                        <span>
                                            {sortOrder === "newest"
                                                ? "Newest"
                                                : sortOrder === "oldest"
                                                  ? "Oldest"
                                                  : "Name"}
                                        </span>
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuLabel>
                                        Sort by
                                    </DropdownMenuLabel>
                                    <DropdownMenuRadioGroup
                                        value={sortOrder}
                                        onValueChange={(v) =>
                                            setSortOrderPersisted(
                                                v as SortOrder,
                                            )
                                        }
                                    >
                                        <DropdownMenuRadioItem value="newest">
                                            Newest first
                                        </DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="oldest">
                                            Oldest first
                                        </DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="name">
                                            Name
                                        </DropdownMenuRadioItem>
                                    </DropdownMenuRadioGroup>
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 px-2 text-xs"
                                        aria-label="Density"
                                    >
                                        <Rows3 className="size-3.5" />
                                        <span>
                                            {density === "compact"
                                                ? "Compact"
                                                : "Comfortable"}
                                        </span>
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuLabel>
                                        Density
                                    </DropdownMenuLabel>
                                    <DropdownMenuRadioGroup
                                        value={density}
                                        onValueChange={(v) =>
                                            setDensityPersisted(
                                                v as ListDensity,
                                            )
                                        }
                                    >
                                        <DropdownMenuRadioItem value="comfortable">
                                            Comfortable
                                        </DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="compact">
                                            Compact
                                        </DropdownMenuRadioItem>
                                    </DropdownMenuRadioGroup>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                </div>

                {/* Pending uploads (optimistic placeholders, always on top) */}
                {pendingUploads.length > 0 && (
                    <div className="divide-y bg-muted/30">
                        {pendingUploads.map((p) => (
                            <div
                                key={p.id}
                                className={cn(
                                    "flex items-center gap-3",
                                    rowPadding,
                                )}
                            >
                                <Loader2 className="size-4 animate-spin text-primary" />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-muted-foreground">
                                        {p.filename}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        Uploading… {formatSize(p.filesize)}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Grouped list */}
                <div>
                    {grouped.map((group, gi) => (
                        <div
                            key={group.label ?? `__ungrouped-${gi.toString()}`}
                        >
                            {group.label && (
                                <div className="sticky top-0 z-10 border-b border-t bg-background/95 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-background/60">
                                    {group.label}
                                </div>
                            )}
                            <div className="divide-y">
                                {group.items.map((recording) => {
                                    const isSelected =
                                        currentRecording?.id === recording.id;
                                    const inFlight = inFlightActions.get(
                                        recording.id,
                                    );
                                    const hasTranscript =
                                        recording.hasTranscript ||
                                        transcriptions.has(recording.id);
                                    const hasSummary = !!recording.hasSummary;
                                    return (
                                        <div
                                            key={recording.id}
                                            className={cn(
                                                "group/row relative",
                                                isSelected && "bg-accent",
                                            )}
                                        >
                                            <button
                                                ref={(el) => {
                                                    if (el)
                                                        rowRefs.current.set(
                                                            recording.id,
                                                            el,
                                                        );
                                                    else
                                                        rowRefs.current.delete(
                                                            recording.id,
                                                        );
                                                }}
                                                type="button"
                                                onClick={() =>
                                                    onSelect(recording)
                                                }
                                                className={cn(
                                                    "w-full text-left transition-colors hover:bg-accent/60",
                                                    rowPadding,
                                                )}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <Play className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <h3 className="truncate text-sm font-medium">
                                                                {
                                                                    recording.filename
                                                                }
                                                            </h3>
                                                            <div className="ml-auto flex shrink-0 items-center gap-1">
                                                                {inFlight ===
                                                                    "transcribing" && (
                                                                    <Loader2
                                                                        className="size-3.5 animate-spin text-primary"
                                                                        aria-label="Transcribing"
                                                                    />
                                                                )}
                                                                {inFlight ===
                                                                    "summarizing" && (
                                                                    <Loader2
                                                                        className="size-3.5 animate-spin text-primary"
                                                                        aria-label="Summarizing"
                                                                    />
                                                                )}
                                                                {!inFlight &&
                                                                    hasTranscript && (
                                                                        <FileText
                                                                            className="size-3.5 text-primary"
                                                                            aria-label="Has transcript"
                                                                        />
                                                                    )}
                                                                {!inFlight &&
                                                                    hasSummary && (
                                                                        <Sparkles
                                                                            className="size-3.5 text-primary"
                                                                            aria-label="Has summary"
                                                                        />
                                                                    )}
                                                            </div>
                                                        </div>
                                                        {!isCompact && (
                                                            <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                                                                <span className="inline-flex items-center gap-1">
                                                                    <Clock className="size-3" />
                                                                    {formatDuration(
                                                                        recording.duration,
                                                                    )}
                                                                </span>
                                                                <span className="inline-flex items-center gap-1">
                                                                    <HardDrive className="size-3" />
                                                                    {formatSize(
                                                                        recording.filesize,
                                                                    )}
                                                                </span>
                                                                <span>
                                                                    {formatDateTime(
                                                                        recording.startTime,
                                                                        dateTimeFormat,
                                                                    )}
                                                                </span>
                                                            </div>
                                                        )}
                                                        {isCompact && (
                                                            <p className="mt-0.5 text-xs text-muted-foreground">
                                                                {formatDuration(
                                                                    recording.duration,
                                                                )}{" "}
                                                                ·{" "}
                                                                {formatDateTime(
                                                                    recording.startTime,
                                                                    dateTimeFormat,
                                                                )}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            </button>
                                            <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger
                                                        asChild
                                                    >
                                                        <Button
                                                            variant="ghost"
                                                            size="icon-sm"
                                                            aria-label="Row actions"
                                                            onClick={(e) =>
                                                                e.stopPropagation()
                                                            }
                                                        >
                                                            <MoreHorizontal className="size-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem
                                                            onSelect={() =>
                                                                onSelect(
                                                                    recording,
                                                                )
                                                            }
                                                        >
                                                            <Play />
                                                            Open
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem
                                                            variant="destructive"
                                                            onSelect={async () => {
                                                                try {
                                                                    await onDelete(
                                                                        recording,
                                                                    );
                                                                } catch (err) {
                                                                    toast.error(
                                                                        err instanceof
                                                                            Error
                                                                            ? err.message
                                                                            : "Failed to delete",
                                                                    );
                                                                }
                                                            }}
                                                        >
                                                            <Trash2 />
                                                            Delete
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}

                    {filtered.length === 0 && pendingUploads.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-10 text-center">
                            <Mic className="mb-2 size-8 text-muted-foreground" />
                            <p className="text-sm text-muted-foreground">
                                {query
                                    ? "No recordings match your search."
                                    : "No recordings yet."}
                            </p>
                        </div>
                    )}

                    {/* Infinite-scroll sentinel */}
                    <div ref={sentinelRef} className="h-4" aria-hidden="true" />
                </div>
            </CardContent>
        </Card>
    );
});
