import {
    ArrowRight,
    Clock,
    Download,
    FileText,
    HardDrive,
    Languages,
    Pause,
    Play,
    RefreshCw,
    Settings,
    Sparkles,
} from "lucide-react";
import Link from "next/link";
import { Github } from "@/components/icons/icons";
import { MetalButton } from "@/components/metal-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function Hero() {
    return (
        <section className="relative pt-20 pb-16 md:pt-32 md:pb-24 overflow-hidden">
            <div className="absolute inset-0 -z-10 bg-[radial-gradient(45%_40%_at_50%_60%,color-mix(in_oklch,var(--primary)_10%,transparent),transparent)]" />

            <div className="container mx-auto px-4 text-center relative z-10">
                <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm font-medium text-primary mb-8 backdrop-blur-sm">
                    <span className="flex h-2 w-2 rounded-full bg-primary mr-2 animate-pulse shadow-[0_0_8px_color-mix(in_oklch,var(--primary)_80%,transparent)]"></span>
                    v1.0 Production Ready
                </div>

                <h1 className="text-4xl md:text-7xl font-bold tracking-tighter mb-6 text-foreground">
                    The Professional Interface
                    <br />
                    <span className="text-foreground">for Plaud Note</span>
                </h1>

                <p className="max-w-2xl mx-auto text-lg md:text-xl text-muted-foreground mb-10 leading-relaxed">
                    Stop paying monthly subscriptions. Use your own API keys,
                    store your data locally, and get professional transcriptions
                    with complete privacy.
                </p>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20">
                    <Link href="/register" className="w-full sm:w-auto">
                        <MetalButton
                            size="lg"
                            className="w-full sm:w-auto gap-2 bg-primary text-primary-foreground hover:bg-primary/90 border-primary/50 h-14 px-8 text-lg shadow-[0_0_20px_color-mix(in_oklch,var(--primary)_30%,transparent)]"
                        >
                            Get Started <ArrowRight className="size-5" />
                        </MetalButton>
                    </Link>
                    <Link
                        href="https://github.com/openplaud/openplaud"
                        target="_blank"
                        className="w-full sm:w-auto"
                    >
                        <MetalButton
                            size="lg"
                            variant="default"
                            className="w-full sm:w-auto gap-2 bg-background/50 backdrop-blur hover:bg-background/80 h-14 px-8 text-lg"
                        >
                            <Github className="size-5" /> View Source
                        </MetalButton>
                    </Link>
                </div>

                <DashboardMockup />
            </div>
        </section>
    );
}

function DashboardMockup() {
    return (
        <div className="mx-auto max-w-6xl relative">
            <div className="absolute -inset-4 bg-gradient-to-t from-primary/20 to-transparent opacity-20 blur-3xl -z-10 rounded-full" />
            <div className="relative rounded-xl border bg-background/50 backdrop-blur shadow-2xl overflow-hidden">
                {/* Mock Browser/App Header */}
                <div className="h-12 border-b bg-muted/30 flex items-center px-4 gap-2">
                    <div className="flex gap-1.5">
                        <div className="size-3 rounded-full bg-red-500/20 border border-red-500/50" />
                        <div className="size-3 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
                        <div className="size-3 rounded-full bg-green-500/20 border border-green-500/50" />
                    </div>
                    <div className="flex-1 text-center text-xs font-mono text-muted-foreground opacity-50">
                        OpenPlaud - Dashboard
                    </div>
                </div>

                {/* Mock Dashboard Content */}
                <div className="p-6 bg-background/95">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h1 className="text-2xl font-bold">Recordings</h1>
                            <p className="text-muted-foreground text-sm mt-1">
                                3 recordings
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md border bg-card text-xs text-muted-foreground">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                </span>
                                Synced just now
                            </div>
                            <Button variant="outline" size="sm" className="h-9">
                                <RefreshCw className="w-4 h-4 mr-2" />
                                Sync Device
                            </Button>
                            <Button variant="outline" size="icon">
                                <Settings className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-left">
                        {/* Left: Recording List */}
                        <div className="lg:col-span-1">
                            <Card hasNoPadding>
                                <CardContent className="p-0">
                                    <div className="divide-y">
                                        {[
                                            {
                                                id: 1,
                                                filename:
                                                    "Weekly Team Sync.mp3",
                                                time: "10:00 AM",
                                                duration: "45:20",
                                                size: "24.5 MB",
                                                active: true,
                                            },
                                            {
                                                id: 2,
                                                filename: "Product Roadmap.mp3",
                                                time: "Yesterday",
                                                duration: "1:15:00",
                                                size: "42.1 MB",
                                                active: false,
                                            },
                                            {
                                                id: 3,
                                                filename:
                                                    "Client Interview.mp3",
                                                time: "2 days ago",
                                                duration: "22:15",
                                                size: "12.8 MB",
                                                active: false,
                                            },
                                        ].map((rec) => (
                                            <div
                                                key={rec.id}
                                                className={`w-full p-4 transition-colors border-l-2 ${
                                                    rec.active
                                                        ? "bg-accent border-l-primary"
                                                        : "hover:bg-accent/50 border-l-transparent"
                                                }`}
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <Play className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                                            <h3 className="font-medium truncate text-sm">
                                                                {rec.filename}
                                                            </h3>
                                                        </div>
                                                        <div className="flex items-center gap-4 text-xs text-muted-foreground ml-6">
                                                            <div className="flex items-center gap-1">
                                                                <Clock className="w-3 h-3" />
                                                                <span>
                                                                    {
                                                                        rec.duration
                                                                    }
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-1">
                                                                <HardDrive className="w-3 h-3" />
                                                                <span>
                                                                    {rec.size}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Right: Player & Transcription */}
                        <div className="lg:col-span-2 space-y-6">
                            <Card>
                                <CardHeader className="pb-4">
                                    <CardTitle className="text-lg">
                                        Weekly Team Sync.mp3
                                    </CardTitle>
                                    <p className="text-xs text-muted-foreground">
                                        Today at 10:00 AM
                                    </p>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="flex items-center gap-4">
                                        <Button
                                            size="lg"
                                            className="w-12 h-12 rounded-full shrink-0"
                                        >
                                            <Pause className="w-5 h-5" />
                                        </Button>
                                        <div className="flex-1 space-y-2">
                                            <div className="h-10 flex items-center gap-0.5 opacity-80">
                                                {Array.from({ length: 60 }).map(
                                                    (_, i) => {
                                                        const height =
                                                            20 +
                                                            Math.random() * 80;
                                                        return (
                                                            <div
                                                                key={`waveform-${i}-${height}`}
                                                                className={`flex-1 rounded-full ${
                                                                    i < 25
                                                                        ? "bg-primary"
                                                                        : "bg-primary/20"
                                                                }`}
                                                                style={{
                                                                    height: `${height}%`,
                                                                }}
                                                            />
                                                        );
                                                    },
                                                )}
                                            </div>
                                            <div className="flex justify-between text-xs text-muted-foreground">
                                                <span>12:45</span>
                                                <span>45:20</span>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="pb-2">
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="flex items-center gap-2 text-base">
                                            <FileText className="w-4 h-4" />
                                            Transcription
                                        </CardTitle>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-8 text-xs"
                                            >
                                                <Download className="w-3 h-3 mr-1" />
                                                Export
                                            </Button>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <div className="bg-muted/50 rounded-lg p-4">
                                        <p className="text-sm leading-relaxed text-muted-foreground">
                                            <span className="text-foreground font-medium">
                                                Speaker A:
                                            </span>{" "}
                                            Alright, let's get started. The main
                                            goal for this week is to finalize
                                            the Q3 roadmap.
                                            <br />
                                            <br />
                                            <span className="text-foreground font-medium">
                                                Speaker B:
                                            </span>{" "}
                                            I've updated the Jira board with the
                                            new feature requests from the
                                            customer calls.
                                            <br />
                                            <br />
                                            <span className="text-foreground font-medium">
                                                Speaker A:
                                            </span>{" "}
                                            Great. Specifically, we need to
                                            focus on the API integration
                                            stability. It's been a recurring
                                            issue...
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-4 text-xs text-muted-foreground pt-3 border-t mt-3">
                                        <div className="flex items-center gap-1">
                                            <Languages className="w-3 h-3" />
                                            <span>Language: English</span>
                                        </div>
                                        <div>4,281 words</div>
                                        <div className="flex items-center gap-1 ml-auto text-primary">
                                            <Sparkles className="w-3 h-3" />
                                            <span>AI Summary Ready</span>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
