import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { notionConfig } from "@/db/schema";
import { auth } from "@/lib/auth";
import { decrypt, encrypt } from "@/lib/encryption";

// GET - Return notion config (token masked)
export async function GET(request: Request) {
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

        const [config] = await db
            .select()
            .from(notionConfig)
            .where(eq(notionConfig.userId, session.user.id))
            .limit(1);

        if (!config) {
            return NextResponse.json({ config: null });
        }

        // Mask the token - show only last 4 chars
        let maskedToken = "••••••••";
        try {
            const decrypted = decrypt(config.encryptedToken);
            if (decrypted.length >= 4) {
                maskedToken = `••••••••${decrypted.slice(-4)}`;
            }
        } catch {
            // If decryption fails, just use the default mask
        }

        return NextResponse.json({
            config: {
                id: config.id,
                databaseId: config.databaseId,
                enabled: config.enabled,
                autoSave: config.autoSave,
                defaultTags: config.defaultTags,
                includeActionItems: config.includeActionItems,
                includeSummary: config.includeSummary,
                language: config.language,
                maskedToken,
                createdAt: config.createdAt,
                updatedAt: config.updatedAt,
            },
        });
    } catch (error) {
        console.error("Error fetching notion config:", error);
        return NextResponse.json(
            { error: "Failed to fetch Notion configuration" },
            { status: 500 },
        );
    }
}

// PUT - Create or update notion config
export async function PUT(request: Request) {
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

        const body = await request.json();
        const {
            token,
            databaseId,
            enabled,
            autoSave,
            defaultTags,
            includeActionItems,
            includeSummary,
            language,
        } = body;

        // Check if config exists
        const [existing] = await db
            .select()
            .from(notionConfig)
            .where(eq(notionConfig.userId, session.user.id))
            .limit(1);

        if (existing) {
            // Update existing config
            const updates: Record<string, unknown> = {
                updatedAt: new Date(),
            };

            if (token) updates.encryptedToken = encrypt(token);
            if (databaseId !== undefined) updates.databaseId = databaseId;
            if (enabled !== undefined) updates.enabled = enabled;
            if (autoSave !== undefined) updates.autoSave = autoSave;
            if (defaultTags !== undefined) updates.defaultTags = defaultTags;
            if (includeActionItems !== undefined)
                updates.includeActionItems = includeActionItems;
            if (includeSummary !== undefined)
                updates.includeSummary = includeSummary;
            if (language !== undefined) updates.language = language;

            await db
                .update(notionConfig)
                .set(updates)
                .where(eq(notionConfig.id, existing.id));

            return NextResponse.json({ success: true });
        }

        // Create new config - token and databaseId are required
        if (!token || !databaseId) {
            return NextResponse.json(
                { error: "Token and database ID are required" },
                { status: 400 },
            );
        }

        await db.insert(notionConfig).values({
            userId: session.user.id,
            encryptedToken: encrypt(token),
            databaseId,
            enabled: enabled ?? true,
            autoSave: autoSave ?? true,
            defaultTags: defaultTags ?? ["Knowledge"],
            includeActionItems: includeActionItems ?? true,
            includeSummary: includeSummary ?? true,
            language: language ?? "nl",
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error saving notion config:", error);
        return NextResponse.json(
            { error: "Failed to save Notion configuration" },
            { status: 500 },
        );
    }
}

// DELETE - Remove notion config
export async function DELETE(request: Request) {
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

        await db
            .delete(notionConfig)
            .where(eq(notionConfig.userId, session.user.id));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error deleting notion config:", error);
        return NextResponse.json(
            { error: "Failed to delete Notion configuration" },
            { status: 500 },
        );
    }
}
