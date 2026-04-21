import { Terminal } from "lucide-react";

export function Deploy() {
    return (
        <section className="py-20 bg-zinc-950 text-zinc-50 relative overflow-hidden">
            <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-5" />
            <div className="container mx-auto px-4 relative z-10">
                <div className="flex flex-col lg:flex-row items-center gap-12">
                    <div className="lg:w-1/2 space-y-6">
                        <div className="inline-flex items-center rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-400">
                            <Terminal className="mr-2 size-3" />
                            Zero Config Deployment
                        </div>
                        <h2 className="text-3xl font-bold tracking-tight">
                            Deploy in Seconds
                        </h2>
                        <p className="text-zinc-400 text-lg">
                            Get up and running instantly with Docker Compose.
                            Includes PostgreSQL database and automatic
                            migrations.
                        </p>
                        <div className="flex flex-wrap gap-4">
                            <div className="flex items-center gap-2 text-sm text-zinc-500">
                                <div className="size-2 rounded-full bg-green-500" />
                                Docker
                            </div>
                            <div className="flex items-center gap-2 text-sm text-zinc-500">
                                <div className="size-2 rounded-full bg-blue-500" />
                                Next.js 15
                            </div>
                            <div className="flex items-center gap-2 text-sm text-zinc-500">
                                <div className="size-2 rounded-full bg-yellow-500" />
                                TypeScript
                            </div>
                        </div>
                    </div>
                    <div className="lg:w-1/2 w-full">
                        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 backdrop-blur shadow-2xl overflow-hidden">
                            <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-zinc-900">
                                <div className="flex gap-1.5">
                                    <div className="size-3 rounded-full bg-red-500/20 border border-red-500/50" />
                                    <div className="size-3 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
                                    <div className="size-3 rounded-full bg-green-500/20 border border-green-500/50" />
                                </div>
                                <div className="text-xs font-mono text-zinc-500 ml-2">
                                    bash — 80x24
                                </div>
                            </div>
                            <div className="p-6 font-mono text-sm overflow-x-auto">
                                <div className="flex gap-2">
                                    <span className="text-purple-400">git</span>
                                    <span className="text-zinc-300">
                                        clone
                                        https://github.com/openplaud/openplaud.git
                                    </span>
                                </div>
                                <div className="flex gap-2 mt-2">
                                    <span className="text-purple-400">cd</span>
                                    <span className="text-zinc-300">
                                        openplaud
                                    </span>
                                </div>
                                <div className="flex gap-2 mt-2">
                                    <span className="text-blue-400">
                                        docker
                                    </span>
                                    <span className="text-zinc-300">
                                        compose up -d
                                    </span>
                                </div>
                                <div className="mt-4 text-green-400">
                                    ➜ Container openplaud-web-1 Started
                                    <br />➜ Container openplaud-db-1 Started
                                    <br />➜ App running at http://localhost:3000
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
