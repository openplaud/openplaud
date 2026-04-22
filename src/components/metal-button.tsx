import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const metalButtonVariants = cva(
    "metal-button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold uppercase tracking-wider transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
    {
        variants: {
            variant: {
                default: "",
                cyan: "text-accent-cyan",
                pink: "text-accent-pink",
                orange: "text-accent-orange",
            },
            size: {
                default: "h-10 px-6 py-2",
                sm: "h-8 px-4 text-xs",
                lg: "h-12 px-8 text-base",
                icon: "h-10 w-10",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    },
);

export interface MetalButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof metalButtonVariants> {
    /**
     * When true, renders the child element with the MetalButton styles
     * instead of wrapping it in a `<button>`. Use with `<Link asChild>` to
     * avoid nesting interactive elements (`<a><button>` is invalid markup).
     */
    asChild?: boolean;
}

const MetalButton = React.forwardRef<HTMLButtonElement, MetalButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : "button";
        return (
            <Comp
                className={cn(
                    metalButtonVariants({ variant, size, className }),
                )}
                ref={ref}
                {...props}
            />
        );
    },
);
MetalButton.displayName = "MetalButton";

export { MetalButton, metalButtonVariants };
