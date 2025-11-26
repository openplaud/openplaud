"use client";

import { Slot } from "@radix-ui/react-slot";
import { ChevronRight } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

function Breadcrumb({ className, ...props }: React.ComponentProps<"nav">) {
    return (
        <nav aria-label="breadcrumb" className={cn("", className)} {...props} />
    );
}

function BreadcrumbList({ className, ...props }: React.ComponentProps<"ol">) {
    return (
        <ol
            className={cn(
                "flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2.5",
                className,
            )}
            {...props}
        />
    );
}

function BreadcrumbItem({ className, ...props }: React.ComponentProps<"li">) {
    return (
        <li
            className={cn("inline-flex items-center gap-1.5", className)}
            {...props}
        />
    );
}

const BreadcrumbLink = React.forwardRef<
    React.ElementRef<"a">,
    React.ComponentPropsWithoutRef<"a"> & {
        asChild?: boolean;
    }
>(({ className, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "a";
    return (
        <Comp
            ref={ref}
            className={cn("transition-colors hover:text-foreground", className)}
            {...props}
        />
    );
});
BreadcrumbLink.displayName = "BreadcrumbLink";

function BreadcrumbPage({ className, ...props }: React.ComponentProps<"span">) {
    return (
        <span
            aria-current="page"
            className={cn("font-normal text-foreground", className)}
            {...props}
        />
    );
}

function BreadcrumbSeparator({
    className,
    ...props
}: React.ComponentProps<"li">) {
    return (
        <li
            role="presentation"
            aria-hidden="true"
            className={cn("[&>svg]:size-3.5", className)}
            {...props}
        >
            <ChevronRight />
        </li>
    );
}

export {
    Breadcrumb,
    BreadcrumbList,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbPage,
    BreadcrumbSeparator,
};
