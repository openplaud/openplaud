import Link from "next/link";
import { MetalButton } from "@/components/metal-button";

export function FinalCTA() {
    return (
        <section className="container mx-auto px-4 py-24">
            <div className="bg-primary/5 rounded-3xl p-8 md:p-16 text-center relative overflow-hidden border border-primary/10">
                <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklch,var(--primary)_10%,transparent),transparent_70%)]" />
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-6 relative z-10">
                    Ready to take ownership?
                </h2>
                <p className="text-muted-foreground max-w-xl mx-auto mb-8 relative z-10">
                    Join the community of audio professionals and developers who
                    prefer open, transparent, and private tools.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center relative z-10">
                    <Link href="/register">
                        <MetalButton
                            size="lg"
                            className="bg-primary text-primary-foreground hover:bg-primary/90 border-primary/50 w-full sm:w-auto"
                        >
                            Create Account
                        </MetalButton>
                    </Link>
                    <Link
                        href="https://github.com/openplaud/openplaud"
                        target="_blank"
                    >
                        <MetalButton
                            size="lg"
                            variant="default"
                            className="bg-background/50 w-full sm:w-auto"
                        >
                            Star on GitHub
                        </MetalButton>
                    </Link>
                </div>
            </div>
        </section>
    );
}
