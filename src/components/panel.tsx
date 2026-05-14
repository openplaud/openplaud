import type * as React from "react";
import { cn } from "@/lib/utils";

interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: "default" | "inset" | "glass";
    ref?: React.Ref<HTMLDivElement>;
}

function Panel({ className, variant = "default", ref, ...props }: PanelProps) {
    const variantClass =
        variant === "inset"
            ? "panel-inset"
            : variant === "glass"
              ? "glass-panel"
              : "panel";

    return (
        <div
            ref={ref}
            className={cn(variantClass, "rounded-lg p-6", className)}
            {...props}
        />
    );
}

export { Panel };
