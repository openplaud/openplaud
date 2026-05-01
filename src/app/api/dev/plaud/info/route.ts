import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { plaudConnections } from "@/db/schema";
import { auth } from "@/lib/auth";
import { createPlaudClient } from "@/lib/plaud/client-factory";
import { serverKeyFromApiBase } from "@/lib/plaud/servers";

/**
 * Dev-only introspection endpoint.
 * Returns stored Plaud connection metadata plus live counts from the Plaud API.
 * Disabled in production builds.
 */
export async function GET(request: Request) {
    if (process.env.NODE_ENV === "production") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const [connection] = await db
            .select()
            .from(plaudConnections)
            .where(eq(plaudConnections.userId, session.user.id))
            .limit(1);

        if (!connection) {
            return NextResponse.json({ connected: false });
        }

        const client = await createPlaudClient(
            connection.bearerToken,
            connection.apiBase,
            connection.workspaceId,
        );

        const startedAt = Date.now();
        let reachable = false;
        let deviceCount: number | null = null;
        let activeRecordingCount: number | null = null;
        let trashedRecordingCount: number | null = null;
        let errorMessage: string | null = null;

        try {
            const [devices, active, trash] = await Promise.all([
                client.listDevices(),
                client.getRecordings(0, 1, 0),
                client.getRecordings(0, 1, 1),
            ]);
            reachable = true;
            deviceCount = devices.data_devices?.length ?? 0;
            activeRecordingCount =
                active.data_file_total ?? active.data_file_list?.length ?? 0;
            trashedRecordingCount =
                trash.data_file_total ?? trash.data_file_list?.length ?? 0;
        } catch (err) {
            errorMessage = err instanceof Error ? err.message : String(err);
        }

        const latencyMs = Date.now() - startedAt;

        return NextResponse.json({
            connected: true,
            reachable,
            latencyMs,
            error: errorMessage,
            connection: {
                id: connection.id,
                apiBase: connection.apiBase,
                server: serverKeyFromApiBase(connection.apiBase),
                plaudEmail: connection.plaudEmail,
                workspaceId: client.workspaceId ?? connection.workspaceId,
                // "cache"      = used the stored workspaceId as-is
                // "resolved"   = client discovered or replaced it (cache empty
                //                or stale-cache rescue picked a different id)
                // "unresolved" = nothing stored and nothing resolved (the UT
                //                fallback path)
                workspaceIdSource:
                    client.workspaceId &&
                    client.workspaceId !== connection.workspaceId
                        ? "resolved"
                        : connection.workspaceId
                          ? "cache"
                          : client.workspaceId
                            ? "resolved"
                            : "unresolved",
                workspaceTokenFallback: client.usingUserTokenFallback,
                createdAt: connection.createdAt,
                updatedAt: connection.updatedAt,
            },
            stats: {
                deviceCount,
                activeRecordingCount,
                trashedRecordingCount,
            },
        });
    } catch (error) {
        console.error("[dev/plaud/info] error:", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to load dev info",
            },
            { status: 500 },
        );
    }
}
