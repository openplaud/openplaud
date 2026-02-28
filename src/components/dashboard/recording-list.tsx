"use client";

import { Clock, HardDrive, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import type { DateTimeFormat } from "@/types/common";
import type { Recording } from "@/types/recording";

interface RecordingListProps {
    recordings: Recording[];
    currentRecording: Recording | null;
    onSelect: (recording: Recording) => void;
}

export function RecordingList({
    recordings,
    currentRecording,
    onSelect,
}: RecordingListProps) {
    const [dateTimeFormat, setDateTimeFormat] =
        useState<DateTimeFormat>("relative");
    const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "name">(
        "newest",
    );
    const [itemsPerPage, setItemsPerPage] = useState(50);
    const [currentPage, setCurrentPage] = useState(1);

    useEffect(() => {
        fetch("/api/settings/user")
            .then((res) => res.json())
            .then((data) => {
                if (data.dateTimeFormat) setDateTimeFormat(data.dateTimeFormat);
                if (data.recordingListSortOrder)
                    setSortOrder(data.recordingListSortOrder);
                if (data.itemsPerPage) setItemsPerPage(data.itemsPerPage);
            })
            .catch(() => {});
    }, []);

    const sortedAndPaginatedRecordings = useMemo(() => {
        const sorted = [...recordings];

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

        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        return sorted.slice(startIndex, endIndex);
    }, [recordings, sortOrder, itemsPerPage, currentPage]);

    const totalPages = Math.ceil(recordings.length / itemsPerPage);

    const formatDuration = (ms: number) => {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    };

    return (
        <Card hasNoPadding>
            <CardContent className="p-0">
                <div className="divide-y">
                    {sortedAndPaginatedRecordings.map((recording) => {
                        const isSelected =
                            currentRecording?.id === recording.id;
                        return (
                            <button
                                key={recording.id}
                                type="button"
                                onClick={() => onSelect(recording)}
                                className={cn(
                                    "w-full text-left p-4 hover:bg-accent transition-colors",
                                    isSelected && "bg-accent",
                                )}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <Play className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                            <h3 className="font-medium truncate">
                                                {recording.filename}
                                            </h3>
                                        </div>
                                        <div className="flex items-center gap-4 text-sm text-muted-foreground ml-6">
                                            <div className="flex items-center gap-1">
                                                <Clock className="w-3 h-3" />
                                                <span>
                                                    {formatDuration(
                                                        recording.duration,
                                                    )}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <HardDrive className="w-3 h-3" />
                                                <span>
                                                    {(
                                                        recording.filesize /
                                                        (1024 * 1024)
                                                    ).toFixed(1)}{" "}
                                                    MB
                                                </span>
                                            </div>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-1 ml-6">
                                            {formatDateTime(
                                                recording.startTime,
                                                dateTimeFormat,
                                            )}
                                        </p>
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
                {totalPages > 1 && (
                    <div className="flex items-center justify-between p-4 border-t">
                        <button
                            type="button"
                            onClick={() =>
                                setCurrentPage((p) => Math.max(1, p - 1))
                            }
                            disabled={currentPage === 1}
                            className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
                        >
                            Previous
                        </button>
                        <span className="text-sm text-muted-foreground">
                            Page {currentPage} of {totalPages}
                        </span>
                        <button
                            type="button"
                            onClick={() =>
                                setCurrentPage((p) =>
                                    Math.min(totalPages, p + 1),
                                )
                            }
                            disabled={currentPage === totalPages}
                            className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
                        >
                            Next
                        </button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
