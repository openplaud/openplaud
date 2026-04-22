import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { plaudConnections, plaudDevices } from "@/db/schema";
import { auth } from "@/lib/auth";
import { encrypt } from "@/lib/encryption";
import { plaudVerifyOtp } from "@/lib/plaud/auth";
import { PlaudClient } from "@/lib/plaud/client";

/**
 * POST /api/plaud/auth/verify
 *
 * Verifies the OTP code against Plaud's API, obtains access + refresh
 * tokens, encrypts them, and stores the connection.
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

        if (!code || !otpToken || !apiBase) {
            return NextResponse.json(
                { error: "Code, OTP token, and API base are required" },
                { status: 400 },
            );
        }

        const plaudEmail =
            typeof email === "string" && email.trim().length > 0
                ? email.trim().toLowerCase()
                : null;

        // Verify OTP with Plaud → get the (long-lived) access token
        const { accessToken } = await plaudVerifyOtp(code, otpToken, apiBase);

        // Validate the token actually works
        const client = new PlaudClient(accessToken, apiBase);
        const isValid = await client.testConnection();

        if (!isValid) {
            return NextResponse.json(
                { error: "Login succeeded but token validation failed" },
                { status: 400 },
            );
        }

        // Fetch devices
        const deviceList = await client.listDevices();

        const encryptedAccessToken = encrypt(accessToken);

        // Upsert connection
        const [existingConnection] = await db
            .select()
            .from(plaudConnections)
            .where(eq(plaudConnections.userId, session.user.id))
            .limit(1);

        if (existingConnection) {
            await db
                .update(plaudConnections)
                .set({
                    bearerToken: encryptedAccessToken,
                    apiBase,
                    plaudEmail,
                    updatedAt: new Date(),
                })
                .where(eq(plaudConnections.id, existingConnection.id));
        } else {
            await db.insert(plaudConnections).values({
                userId: session.user.id,
                bearerToken: encryptedAccessToken,
                apiBase,
                plaudEmail,
            });
        }

        // Upsert devices
        for (const device of deviceList.data_devices) {
            const [existingDevice] = await db
                .select()
                .from(plaudDevices)
                .where(eq(plaudDevices.serialNumber, device.sn))
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
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Verification failed",
            },
            { status: 400 },
        );
    }
}
