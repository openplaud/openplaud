"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "openplaud:theme";

function resolveSystem(): "light" | "dark" {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
}

function applyTheme(theme: Theme) {
    if (typeof document === "undefined") return;
    const effective = theme === "system" ? resolveSystem() : theme;
    const root = document.documentElement;
    if (effective === "dark") {
        root.classList.add("dark");
    } else {
        root.classList.remove("dark");
    }
}

/**
 * Tiny theme manager — applies a `dark` class to <html>, mirrors the
 * setting to localStorage for instant first-paint on subsequent loads,
 * and lazily persists the choice to userSettings.theme via the existing
 * /api/settings/user PUT endpoint.
 *
 * We deliberately avoid `next-themes` to skip an extra dependency; this
 * file is the entire integration.
 */
export function useTheme(initial: Theme) {
    const [theme, setThemeState] = useState<Theme>(() => {
        if (typeof window === "undefined") return initial;
        const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
        return stored ?? initial;
    });

    // Apply on mount + whenever the choice changes.
    useEffect(() => {
        applyTheme(theme);
        if (typeof window !== "undefined") {
            window.localStorage.setItem(STORAGE_KEY, theme);
        }
    }, [theme]);

    // If user picked "system", re-apply on OS-level changes.
    useEffect(() => {
        if (theme !== "system" || typeof window === "undefined") return;
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const handler = () => applyTheme("system");
        mq.addEventListener("change", handler);
        return () => mq.removeEventListener("change", handler);
    }, [theme]);

    const setTheme = useCallback((next: Theme) => {
        setThemeState(next);
        // Best-effort persistence to the server; failures are silent —
        // the UI already reflects the change via localStorage.
        fetch("/api/settings/user", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ theme: next }),
        }).catch(() => {});
    }, []);

    return { theme, setTheme } as const;
}
