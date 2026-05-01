import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { plaudConnections, plaudDevices } from "@/db/schema";
import { auth } from "@/lib/auth";
import { encrypt } from "@/lib/encryption";
import { plaudVerifyOtp } from "@/lib/plaud/auth";
import { PlaudClient } from "@/lib/plaud/client";
import { isValidPlaudApiUrl } from "@/lib/plaud/servers";
import {
    listPlaudWorkspaces,
    pickPersonalWorkspaceId,
} from "@/lib/plaud/workspace";

/**
 * POST /api/plaud/auth/verify
 *
 * Verifies the OTP code against Plaud's API, obtains a long-lived access
 * token, encrypts it, and stores the connection.
 *
 * Source: https://github.com/openplaud/openplaud/blob/main/src/app/api/plaud/auth/verify/route.ts
 */
export async function POST(request: Request) {
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

        const { code, otpToken, apiBase, email } = await request.json();

        if (
            typeof code !== "string" ||
            typeof otpToken !== "string" ||
            typeof apiBase !== "string" ||
            !code ||
            !otpToken ||
            !apiBase
        ) {
            return NextResponse.json(
                { error: "Code, OTP token, and API base are required" },
                { status: 400 },
            );
        }

        // SSRF guard: the client sends apiBase back to us (originally obtained
        // via the regional -302 redirect in send-code). Restrict to plaud.ai
        // hosts so a tampered client cannot point the server at an arbitrary
        // URL and coerce it into an internal-network request.
        if (!isValidPlaudApiUrl(apiBase)) {
            return NextResponse.json(
                { error: "Invalid API base" },
                { status: 400 },
            );
        }

        const plaudEmail =
            typeof email === "string" && email.trim().length > 0
                ? email.trim().toLowerCase()
                : null;

        // Verify OTP with Plaud → get the (long-lived) user token (UT)
        const { accessToken } = await plaudVerifyOtp(code, otpToken, apiBase);

        // Discover the personal workspace ID up front so we can persist it
        // alongside the connection. We deliberately don't mint a WT here —
        // PlaudClient mints lazily on the listDevices() call below, which
        // both validates end-to-end and gives us exactly one WT mint per
        // verify (vs. minting once here and again inside the client).
        let resolvedWorkspaceId: string | null = null;
        try {
            const list = await listPlaudWorkspaces(accessToken, apiBase);
            resolvedWorkspaceId = pickPersonalWorkspaceId(list);
        } catch (err) {
            // Don't fail the whole connect — fall through and let the client
            // fall back to the UT (preserves behavior for any server that
            // doesn't expose the workspace endpoints). Logged for diagnosis.
            console.warn(
                "[plaud/verify] workspace discovery failed:",
                err instanceof Error ? err.message : err,
            );
        }

        // Validate the token works against a real recording endpoint. With
        // resolvedWorkspaceId in hand the client mints a WT internally on
        // first use; without it the client falls back to the UT.
        const client = new PlaudClient(
            accessToken,
            apiBase,
            resolvedWorkspaceId,
        );

        let deviceList: Awaited<ReturnType<typeof client.listDevices>>;
        try {
            deviceList = await client.listDevices();
        } catch (err) {
            console.warn(
                "[plaud/verify] device list validation failed:",
                err instanceof Error ? err.message : err,
            );
            return NextResponse.json(
                { error: "Login succeeded but token validation failed" },
                { status: 400 },
            );
        }

        const encryptedAccessToken = encrypt(accessToken);

        // Upsert connection
        const [existingConnection] = await db
            .select()
            .from(plaudConnections)
            .where(eq(plaudConnections.userId, session.user.id))
            .limit(1);

        if (existingConnection) {
            // Always re-scope by userId on UPDATE/DELETE of user-owned rows
            // (defense-in-depth alongside the userId-scoped lookup above).
            await db
                .update(plaudConnections)
                .set({
                    bearerToken: encryptedAccessToken,
                    apiBase,
                    plaudEmail,
                    workspaceId: resolvedWorkspaceId,
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(plaudConnections.id, existingConnection.id),
                        eq(plaudConnections.userId, session.user.id),
                    ),
                );
        } else {
            await db.insert(plaudConnections).values({
                userId: session.user.id,
                bearerToken: encryptedAccessToken,
                apiBase,
                plaudEmail,
                workspaceId: resolvedWorkspaceId,
            });
        }

        // Upsert devices — always scope the lookup by (userId, serialNumber)
        // so we never touch another user's device row (the schema has a
        // unique constraint on this pair).
        for (const device of deviceList.data_devices) {
            const [existingDevice] = await db
                .select()
                .from(plaudDevices)
                .where(
                    and(
                        eq(plaudDevices.userId, session.user.id),
                        eq(plaudDevices.serialNumber, device.sn),
                    ),
                )
                .limit(1);

            if (existingDevice) {
                await db
                    .update(plaudDevices)
                    .set({
                        name: device.name,
                        model: device.model,
                        versionNumber: device.version_number,
                        updatedAt: new Date(),
                    })
                    .where(eq(plaudDevices.id, existingDevice.id));
            } else {
                await db.insert(plaudDevices).values({
                    userId: session.user.id,
                    serialNumber: device.sn,
                    name: device.name,
                    model: device.model,
                    versionNumber: device.version_number,
                });
            }
        }

        return NextResponse.json({
            success: true,
            devices: deviceList.data_devices,
        });
    } catch (error) {
        console.error("Error verifying Plaud OTP:", error);
        // User-actionable errors (invalid code, expired OTP, rate-limited,
        // bad API base) pass through unchanged and return 400. Anything
        // else (DB errors, network blowups) is treated as an internal bug
        // — generic message, 500 status — so we don't leak implementation
        // details and so clients can distinguish "user's fault" from
        // "our fault".
        if (error instanceof Error && isUserFacingPlaudError(error.message)) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        return NextResponse.json(
            { error: "Verification failed" },
            { status: 500 },
        );
    }
}

/**
 * User-actionable errors we're willing to surface verbatim:
 * - `Plaud API error: ...` thrown by PlaudClient.request and by the Plaud
 *   auth helpers (plaudVerifyOtp etc).
 * - `Invalid API base` thrown by our own SSRF guard above.
 */
function isUserFacingPlaudError(msg: string): boolean {
    return msg.startsWith("Plaud API error") || msg === "Invalid API base";
}
