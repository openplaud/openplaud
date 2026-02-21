import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { plaudConnections, plaudDevices } from "@/db/schema";
import { auth } from "@/lib/auth";
import { encrypt } from "@/lib/encryption";
import { DEFAULT_PLAUD_API_BASE, PlaudClient } from "@/lib/plaud/client";

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

        const { bearerToken, apiBase: rawApiBase } = await request.json();

        if (!bearerToken) {
            return NextResponse.json(
                { error: "Bearer token is required" },
                { status: 400 },
            );
        }

        const apiBase = rawApiBase ?? DEFAULT_PLAUD_API_BASE;
        const client = new PlaudClient(bearerToken, apiBase);
        const isValid = await client.testConnection();

        if (!isValid) {
            return NextResponse.json(
                { error: "Invalid bearer token" },
                { status: 400 },
            );
        }

        const deviceList = await client.listDevices();

        const encryptedToken = encrypt(bearerToken);

        const [existingConnection] = await db
            .select()
            .from(plaudConnections)
            .where(eq(plaudConnections.userId, session.user.id))
            .limit(1);

        if (existingConnection) {
            await db
                .update(plaudConnections)
                .set({ bearerToken: encryptedToken, apiBase, updatedAt: new Date() })
                .where(eq(plaudConnections.id, existingConnection.id));
        } else {
            await db.insert(plaudConnections).values({
                userId: session.user.id,
                bearerToken: encryptedToken,
                apiBase,
            });
        }

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
        console.error("Error connecting to Plaud:", error);
        return NextResponse.json(
            { error: "Failed to connect to Plaud" },
            { status: 500 },
        );
    }
}
