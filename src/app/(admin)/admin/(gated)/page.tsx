import { fleetOverview } from "@/lib/admin/queries";
import { formatBytes, formatNumber, MetricCard } from "./_components/metrics";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
    const stats = await fleetOverview();

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-semibold">Fleet overview</h1>
                <p className="text-sm text-muted-foreground">
                    Cost-shaped metrics. All counts exclude tombstoned
                    recordings.
                </p>
            </div>

            <section>
                <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-2">
                    Users
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <MetricCard
                        label="Total users"
                        value={formatNumber(stats.userTotal)}
                    />
                    <MetricCard
                        label="Active 7d"
                        value={formatNumber(stats.activeUsers7d)}
                        sub="synced in last 7 days"
                    />
                    <MetricCard
                        label="Active 30d"
                        value={formatNumber(stats.activeUsers30d)}
                    />
                    <MetricCard
                        label="Suspended"
                        value={formatNumber(stats.suspendedUsers)}
                        accent={
                            stats.suspendedUsers > 0 ? "warning" : undefined
                        }
                    />
                </div>
            </section>

            <section>
                <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-2">
                    Recordings & storage
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <MetricCard
                        label="Total recordings"
                        value={formatNumber(stats.recordingTotal)}
                    />
                    <MetricCard
                        label="Total storage"
                        value={formatBytes(stats.storageBytes)}
                    />
                    <MetricCard
                        label="New 7d"
                        value={formatNumber(stats.recordingsLast7)}
                        sub={formatBytes(stats.bytesLast7)}
                    />
                    <MetricCard
                        label="Avg / recording"
                        value={
                            stats.recordingTotal > 0
                                ? formatBytes(
                                      stats.storageBytes / stats.recordingTotal,
                                  )
                                : "—"
                        }
                    />
                </div>
            </section>

            <section>
                <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-2">
                    Transcription
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <MetricCard
                        label="Server-side (30d)"
                        value={formatNumber(stats.serverTranscriptionsLast30)}
                        sub="our cost"
                    />
                    <MetricCard
                        label="Server (all-time)"
                        value={formatNumber(
                            stats.transcriptionByType.server ?? 0,
                        )}
                    />
                    <MetricCard
                        label="Browser (all-time)"
                        value={formatNumber(
                            stats.transcriptionByType.browser ?? 0,
                        )}
                        sub="zero cost"
                    />
                    <MetricCard
                        label="AI enhancements"
                        value={formatNumber(stats.enhancementTotal)}
                    />
                </div>
            </section>
        </div>
    );
}
