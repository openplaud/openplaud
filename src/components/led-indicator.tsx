import { cn } from "@/lib/utils";

interface LEDIndicatorProps {
    active?: boolean;
    status?: "active" | "warning" | "error";
    size?: "sm" | "md" | "lg";
    pulse?: boolean;
    className?: string;
}

const sizeMap = {
    sm: "size-2",
    md: "size-3",
    lg: "size-4",
};

export function LEDIndicator({
    active = false,
    status = "active",
    size = "md",
    pulse = false,
    className,
}: LEDIndicatorProps) {
    const statusClass = active
        ? status === "active"
            ? "led-active"
            : status === "warning"
              ? "led-warning"
              : "led-error"
        : "bg-metal-dark";

    return (
        <div
            className={cn(
                "led-indicator",
                sizeMap[size],
                statusClass,
                pulse && active && "animate-pulse",
                className,
            )}
        />
    );
}
