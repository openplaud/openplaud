export const PLAUD_SERVERS = [
    {
        label: "Global (api.plaud.ai)",
        value: "https://api.plaud.ai",
        hint: "Global server — used by most accounts (api.plaud.ai)",
    },
    {
        label: "EU – Frankfurt (api-euc1.plaud.ai)",
        value: "https://api-euc1.plaud.ai",
        hint: "EU server — used by European accounts (api-euc1.plaud.ai)",
    },
] as const;

export const ALLOWED_PLAUD_HOSTS = new Set(
    PLAUD_SERVERS.map((s) => new URL(s.value).hostname),
);
