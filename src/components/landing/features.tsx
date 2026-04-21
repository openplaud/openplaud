import { Cpu, Database, Download, Search, Shield, Zap } from "lucide-react";
import { Panel } from "@/components/panel";

export function Features() {
    return (
        <section className="py-24 bg-secondary/20 border-y border-border/40">
            <div className="container mx-auto px-4">
                <div className="text-center mb-16 max-w-3xl mx-auto">
                    <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
                        Why OpenPlaud?
                    </h2>
                    <p className="text-muted-foreground text-lg">
                        We built this because we wanted control over our own
                        data. Here is why you should switch.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <FeatureCard
                        icon={<Database className="size-6" />}
                        title="Your Data, Your Disk"
                        description="Recordings are stored on your local filesystem or your own S3 bucket. No vendor lock-in, no mysterious cloud storage."
                    />
                    <FeatureCard
                        icon={<Cpu className="size-6" />}
                        title="Bring Your Own AI"
                        description="Connect to OpenAI, Anthropic, Groq, or run local LLMs. Choose the model that fits your budget and privacy needs."
                    />
                    <FeatureCard
                        icon={<Search className="size-6" />}
                        title="Privacy First"
                        description="No telemetry, no tracking. Use browser-based transcription to keep your audio strictly on your device."
                    />
                    <FeatureCard
                        icon={<Zap className="size-6" />}
                        title="Lightning Fast Sync"
                        description="Background synchronization keeps your library up to date without you lifting a finger."
                    />
                    <FeatureCard
                        icon={<Download className="size-6" />}
                        title="Export Anywhere"
                        description="One-click export to Markdown, JSON, SRT, or VTT. Perfect for Notion, Obsidian, or video editors."
                    />
                    <FeatureCard
                        icon={<Shield className="size-6" />}
                        title="Open Source (AGPL-3.0)"
                        description="Audit the code yourself. Contribute features. The community drives the roadmap, not shareholders. Licensed under AGPL-3.0 for maximum freedom and transparency."
                    />
                </div>
            </div>
        </section>
    );
}

function FeatureCard({
    icon,
    title,
    description,
}: {
    icon: React.ReactNode;
    title: string;
    description: string;
}) {
    return (
        <Panel
            variant="default"
            className="space-y-4 hover:border-primary/50 transition-colors group h-full"
        >
            <div className="size-12 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20 group-hover:scale-105 transition-transform text-primary">
                {icon}
            </div>
            <h3 className="text-xl font-semibold">{title}</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
                {description}
            </p>
        </Panel>
    );
}
