/**
 * Single source of truth for the typed `InitialSettings` shape that
 * server components feed into Workstation / RecordingWorkstation, plus
 * the row → shape adapter.
 *
 * Why this exists: the same defaults used to live inline in
 * `src/app/(app)/dashboard/page.tsx` and (partially) in
 * `src/app/(app)/recordings/[id]/page.tsx`, while the API route
 * `src/app/api/settings/user/route.ts` owns a separate
 * `DEFAULT_SETTINGS` constant for its GET fallback. Keeping these in
 * lockstep by hand was already drifting (e.g. `playerScrubber` was
 * added in the dashboard page but the detail page fell back to a
 * hard-coded `"waveform"`). Centralizing here means a new preference
 * defaults in exactly one place.
 *
 * The API route's `DEFAULT_SETTINGS` covers a wider surface
 * (notifications, encryption envelopes, export presets) — this module
 * intentionally only mirrors the slice the dashboard UI consumes. If a
 * new field starts being rendered from `initialSettings`, add it here
 * and to the route's defaults together.
 */

import type { userSettings } from "@/db/schema";

export interface InitialSettings {
    dateTimeFormat: "relative" | "absolute" | "iso";
    recordingListSortOrder: "newest" | "oldest" | "name";
    itemsPerPage: number;
    listDensity: "comfortable" | "compact";
    theme: "light" | "dark" | "system";
    defaultPlaybackSpeed: number;
    defaultVolume: number;
    autoPlayNext: boolean;
    playerScrubber: "waveform" | "slider";
    syncInterval: number;
    autoSyncEnabled: boolean;
    syncOnMount: boolean;
    syncOnVisibilityChange: boolean;
    syncNotifications: boolean;
    browserNotifications: boolean;
}

export const INITIAL_SETTINGS_DEFAULTS: InitialSettings = {
    dateTimeFormat: "relative",
    recordingListSortOrder: "newest",
    itemsPerPage: 50,
    listDensity: "comfortable",
    theme: "system",
    defaultPlaybackSpeed: 1.0,
    defaultVolume: 75,
    autoPlayNext: false,
    playerScrubber: "waveform",
    syncInterval: 300_000, // 5 minutes
    autoSyncEnabled: true,
    syncOnMount: true,
    syncOnVisibilityChange: true,
    syncNotifications: true,
    browserNotifications: true,
};

type Row = typeof userSettings.$inferSelect | undefined | null;

/**
 * Coalesce a `user_settings` row into a fully-typed `InitialSettings`,
 * falling back to `INITIAL_SETTINGS_DEFAULTS` for any null/missing
 * field. Narrows the wide enum strings stored as varchar back into the
 * literal-union types the UI expects.
 */
export function initialSettingsFromRow(row: Row): InitialSettings {
    const r = row ?? undefined;
    return {
        dateTimeFormat: (r?.dateTimeFormat ??
            INITIAL_SETTINGS_DEFAULTS.dateTimeFormat) as InitialSettings["dateTimeFormat"],
        recordingListSortOrder: (r?.recordingListSortOrder ??
            INITIAL_SETTINGS_DEFAULTS.recordingListSortOrder) as InitialSettings["recordingListSortOrder"],
        itemsPerPage: r?.itemsPerPage ?? INITIAL_SETTINGS_DEFAULTS.itemsPerPage,
        listDensity: (r?.listDensity ??
            INITIAL_SETTINGS_DEFAULTS.listDensity) as InitialSettings["listDensity"],
        theme: (r?.theme ??
            INITIAL_SETTINGS_DEFAULTS.theme) as InitialSettings["theme"],
        defaultPlaybackSpeed:
            r?.defaultPlaybackSpeed ??
            INITIAL_SETTINGS_DEFAULTS.defaultPlaybackSpeed,
        defaultVolume:
            r?.defaultVolume ?? INITIAL_SETTINGS_DEFAULTS.defaultVolume,
        autoPlayNext: r?.autoPlayNext ?? INITIAL_SETTINGS_DEFAULTS.autoPlayNext,
        playerScrubber: (r?.playerScrubber ??
            INITIAL_SETTINGS_DEFAULTS.playerScrubber) as InitialSettings["playerScrubber"],
        syncInterval: r?.syncInterval ?? INITIAL_SETTINGS_DEFAULTS.syncInterval,
        autoSyncEnabled:
            r?.autoSyncEnabled ?? INITIAL_SETTINGS_DEFAULTS.autoSyncEnabled,
        syncOnMount: r?.syncOnMount ?? INITIAL_SETTINGS_DEFAULTS.syncOnMount,
        syncOnVisibilityChange:
            r?.syncOnVisibilityChange ??
            INITIAL_SETTINGS_DEFAULTS.syncOnVisibilityChange,
        syncNotifications:
            r?.syncNotifications ?? INITIAL_SETTINGS_DEFAULTS.syncNotifications,
        browserNotifications:
            r?.browserNotifications ??
            INITIAL_SETTINGS_DEFAULTS.browserNotifications,
    };
}
