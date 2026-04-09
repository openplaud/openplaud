export const PLAUD_SERVERS = {
    global: {
        label: "Global (api.plaud.ai)",
        description: "Global server — used by most accounts (api.plaud.ai)",
        apiBase: "https://api.plaud.ai",
    },
    eu: {
        label: "EU – Frankfurt (api-euc1.plaud.ai)",
        description:
            "EU server — used by European accounts (api-euc1.plaud.ai)",
        apiBase: "https://api-euc1.plaud.ai",
    },
    apse1: {
        label: "Asia Pacific – Singapore (api-apse1.plaud.ai)",
        description:
            "Asia Pacific server — used by APAC accounts (api-apse1.plaud.ai)",
        apiBase: "https://api-apse1.plaud.ai",
    },
    custom: {
        label: "Custom",
        description:
            "Enter a custom Plaud API server URL (e.g. https://api-xxx.plaud.ai)",
        apiBase: "",
    },
} as const;

export type PlaudServerKey = keyof typeof PLAUD_SERVERS;
export const DEFAULT_SERVER_KEY: PlaudServerKey = "global";

/**
 * Validate that a URL is a legitimate Plaud API server.
 * Must be HTTPS and on a plaud.ai subdomain.
 */
export function isValidPlaudApiUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return (
            parsed.protocol === "https:" &&
            (parsed.hostname === "plaud.ai" ||
                parsed.hostname.endsWith(".plaud.ai"))
        );
    } catch {
        return false;
    }
}

/**
 * Resolve a server key (and optional custom URL) to an API base URL.
 * Returns null if the input is invalid.
 */
export function resolveApiBase(
    serverKey: string,
    customApiBase?: string,
): string | null {
    if (serverKey === "custom") {
        if (!customApiBase || !isValidPlaudApiUrl(customApiBase)) return null;
        // Normalize: strip trailing slash
        return customApiBase.replace(/\/+$/, "");
    }
    if (!Object.hasOwn(PLAUD_SERVERS, serverKey)) return null;
    return PLAUD_SERVERS[serverKey as Exclude<PlaudServerKey, "custom">]
        .apiBase;
}

/**
 * Find the server key for a stored apiBase URL.
 * Returns the key if it matches a known server, otherwise "custom".
 */
export function serverKeyFromApiBase(apiBase: string): PlaudServerKey {
    const entry = (
        Object.entries(PLAUD_SERVERS) as [
            PlaudServerKey,
            (typeof PLAUD_SERVERS)[PlaudServerKey],
        ][]
    ).find(([key, s]) => key !== "custom" && s.apiBase === apiBase);
    return entry?.[0] ?? "custom";
}
