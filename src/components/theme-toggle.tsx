"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ToggleSwitch } from "./toggle-switch";

export function ThemeToggle({ className }: { className?: string }) {
    const { setTheme, resolvedTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) {
        return (
            <div className={cn("flex items-center gap-3", className)}>
                <div className="w-5 h-5" />
                <span className="text-sm font-medium">THEME</span>
                <div className="w-[52px] h-7" />
            </div>
        );
    }

    const isDark = resolvedTheme === "dark";

    const handleToggle = () => {
        if (isDark) {
            setTheme("light");
        } else {
            setTheme("dark");
        }
    };

    return (
        <div className={cn("flex items-center gap-3", className)}>
            {isDark ? (
                <Moon className="w-5 h-5 text-primary" />
            ) : (
                <Sun className="w-5 h-5 text-primary" />
            )}
            <span className="text-sm font-medium">THEME</span>
            <ToggleSwitch
                checked={isDark}
                onChange={handleToggle}
                className="flex-shrink-0"
            />
        </div>
    );
}
