import { cn } from "@/lib/utils";

export function MetricCard({
    label,
    value,
    sub,
    accent,
}: {
    label: string;
    value: string | number;
    sub?: string;
    accent?: "danger" | "warning";
}) {
    return (
        <div className="border rounded-xl p-4 bg-card">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div
                className={cn(
                    "text-2xl font-semibold mt-1",
                    accent === "danger" && "text-red-600",
                    accent === "warning" && "text-amber-600",
                )}
            >
                {value}
            </div>
            {sub ? (
                <div className="text-xs text-muted-foreground mt-1">{sub}</div>
            ) : null}
        </div>
    );
}

export function formatBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
    return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatNumber(n: number): string {
    return new Intl.NumberFormat("en-US").format(n);
}

export function formatDate(d: Date | null | undefined): string {
    if (!d) return "—";
    return d.toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export function formatRelative(d: Date | null | undefined): string {
    if (!d) return "never";
    const diffMs = Date.now() - d.getTime();
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 48) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}d ago`;
    const mo = Math.floor(day / 30);
    return `${mo}mo ago`;
}
