"use client";

import { Command } from "cmdk";
import {
    FileText,
    Keyboard,
    Mic,
    Monitor,
    Moon,
    RefreshCw,
    Settings,
    Sun,
    Upload,
} from "lucide-react";
import { useEffect } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { Recording } from "@/types/recording";
import "@/components/dashboard/command-palette.css";

interface CommandPaletteProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    recordings: Recording[];
    onSelectRecording: (r: Recording) => void;
    onSync: () => void;
    onUpload: () => void;
    onOpenSettings: () => void;
    onOpenShortcuts: () => void;
    onSetTheme: (t: "light" | "dark" | "system") => void;
}

export function CommandPalette({
    open,
    onOpenChange,
    recordings,
    onSelectRecording,
    onSync,
    onUpload,
    onOpenSettings,
    onOpenShortcuts,
    onSetTheme,
}: CommandPaletteProps) {
    // Close on Escape is handled by Dialog; cmdk's own handlers stay disabled
    // because we wrap in Radix Dialog.
    useEffect(() => {
        if (!open) return;
    }, [open]);

    const run = (fn: () => void) => () => {
        onOpenChange(false);
        // Defer so the dialog has a tick to start its close transition
        // before mounting whatever the action opens (settings dialog, etc.).
        setTimeout(fn, 0);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-w-xl p-0 overflow-hidden gap-0"
                showCloseButton={false}
            >
                <DialogTitle className="sr-only">Command palette</DialogTitle>
                <Command className="command-palette" label="Command palette">
                    <div className="border-b px-3">
                        <Command.Input
                            placeholder="Type a command or search recordings..."
                            className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
                        />
                    </div>
                    <Command.List className="max-h-[60vh] overflow-y-auto p-2">
                        <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
                            No results found.
                        </Command.Empty>

                        <Command.Group heading="Actions">
                            <Command.Item onSelect={run(onSync)}>
                                <RefreshCw className="mr-2 h-4 w-4" />
                                Sync device
                            </Command.Item>
                            <Command.Item onSelect={run(onUpload)}>
                                <Upload className="mr-2 h-4 w-4" />
                                Upload audio
                            </Command.Item>
                            <Command.Item onSelect={run(onOpenSettings)}>
                                <Settings className="mr-2 h-4 w-4" />
                                Open settings
                            </Command.Item>
                            <Command.Item onSelect={run(onOpenShortcuts)}>
                                <Keyboard className="mr-2 h-4 w-4" />
                                Keyboard shortcuts
                            </Command.Item>
                        </Command.Group>

                        <Command.Group heading="Theme">
                            <Command.Item
                                onSelect={run(() => onSetTheme("light"))}
                            >
                                <Sun className="mr-2 h-4 w-4" />
                                Light theme
                            </Command.Item>
                            <Command.Item
                                onSelect={run(() => onSetTheme("dark"))}
                            >
                                <Moon className="mr-2 h-4 w-4" />
                                Dark theme
                            </Command.Item>
                            <Command.Item
                                onSelect={run(() => onSetTheme("system"))}
                            >
                                <Monitor className="mr-2 h-4 w-4" />
                                System theme
                            </Command.Item>
                        </Command.Group>

                        {recordings.length > 0 && (
                            <Command.Group heading="Jump to recording">
                                {recordings.slice(0, 50).map((r) => (
                                    <Command.Item
                                        key={r.id}
                                        value={`${r.filename} ${r.id}`}
                                        onSelect={run(() =>
                                            onSelectRecording(r),
                                        )}
                                    >
                                        {r.hasTranscript ? (
                                            <FileText className="mr-2 h-4 w-4 text-primary" />
                                        ) : (
                                            <Mic className="mr-2 h-4 w-4 text-muted-foreground" />
                                        )}
                                        <span className="truncate">
                                            {r.filename}
                                        </span>
                                    </Command.Item>
                                ))}
                            </Command.Group>
                        )}
                    </Command.List>
                </Command>
            </DialogContent>
        </Dialog>
    );
}
