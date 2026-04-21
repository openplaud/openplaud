import Link from "next/link";
import { Github } from "@/components/icons/icons";
import { Logo } from "@/components/icons/logo";
import { MetalButton } from "@/components/metal-button";
import { ThemeToggle } from "@/components/theme-toggle";

export function LandingNav() {
    return (
        <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
            <div className="container mx-auto flex h-16 items-center justify-between px-4">
                <Link
                    href="/"
                    className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                >
                    <Logo className="size-8" />
                    <span className="text-xl font-bold tracking-tight font-mono">
                        OpenPlaud
                    </span>
                </Link>
                <nav className="flex items-center gap-4">
                    <Link
                        href="https://github.com/openplaud/openplaud"
                        target="_blank"
                        className="hidden md:flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <Github className="size-4" />
                        GitHub
                    </Link>
                    <ThemeToggle />
                    <Link href="/login">
                        <MetalButton
                            size="sm"
                            className="bg-primary text-primary-foreground hover:bg-primary/90 border-primary/50 shadow-[0_0_10px_color-mix(in_oklch,var(--primary)_30%,transparent)]"
                        >
                            Login
                        </MetalButton>
                    </Link>
                </nav>
            </div>
        </header>
    );
}
