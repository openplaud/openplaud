import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { auth } from "@/lib/auth";

// Default settings values
const DEFAULT_SETTINGS = {
    autoTranscribe: false,
    syncInterval: 300000, // 5 minutes in milliseconds
    autoSyncEnabled: true,
    syncOnMount: true,
    syncOnVisibilityChange: true,
    syncNotifications: true,
    defaultPlaybackSpeed: 1.0,
    defaultVolume: 75,
    autoPlayNext: false,
    defaultTranscriptionLanguage: null,
    transcriptionQuality: "balanced" as const,
    dateTimeFormat: "relative" as const,
    recordingListSortOrder: "newest" as const,
    itemsPerPage: 50,
    theme: "system" as const,
    autoDeleteRecordings: false,
    retentionDays: null,
    browserNotifications: true,
    emailNotifications: false,
    barkNotifications: false,
    notificationSound: true,
    notificationEmail: null,
    defaultExportFormat: "json" as const,
    autoExport: false,
    backupFrequency: null,
    defaultProviders: null,
    onboardingCompleted: false,
    autoGenerateTitle: true,
    syncTitleToPlaud: false,
    splitSegmentMinutes: 60,
} as const;

// Settings field names (excluding userId, id, createdAt, updatedAt)
const SETTINGS_FIELDS = [
    "autoTranscribe",
    "syncInterval",
    "autoSyncEnabled",
    "syncOnMount",
    "syncOnVisibilityChange",
    "syncNotifications",
    "defaultPlaybackSpeed",
    "defaultVolume",
    "autoPlayNext",
    "defaultTranscriptionLanguage",
    "transcriptionQuality",
    "dateTimeFormat",
    "recordingListSortOrder",
    "itemsPerPage",
    "theme",
    "autoDeleteRecordings",
    "retentionDays",
    "browserNotifications",
    "emailNotifications",
    "barkNotifications",
    "notificationSound",
    "notificationEmail",
    "defaultExportFormat",
    "autoExport",
    "backupFrequency",
    "defaultProviders",
    "onboardingCompleted",
    "autoGenerateTitle",
    "syncTitleToPlaud",
    "splitSegmentMinutes",
] as const;

// Extract settings from database row to response format
function extractSettings(settings: typeof userSettings.$inferSelect) {
    const result: Record<string, unknown> = {};
    for (const field of SETTINGS_FIELDS) {
        result[field] = settings[field];
    }
    // Include barkPushUrl in response
    result.barkPushUrl = settings.barkPushUrl || null;
    result.barkPushUrlSet = !!settings.barkPushUrl;
    return result;
}

// GET - Fetch user settings
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

        const [settings] = await db
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, session.user.id))
            .limit(1);

        // Get user email for default notification email
        const userEmail = session.user.email || "";

        // Return default settings if none exist
        if (!settings) {
            return NextResponse.json({
                ...DEFAULT_SETTINGS,
                titleGenerationPrompt: null,
                barkPushUrl: null,
                barkPushUrlSet: false,
                userEmail, // Include user email in response
            });
        }

        const settingsData = extractSettings(settings);
        // Include titleGenerationPrompt if it exists
        if (settings.titleGenerationPrompt) {
            settingsData.titleGenerationPrompt = settings.titleGenerationPrompt;
        }
        return NextResponse.json({
            ...settingsData,
            userEmail, // Include user email in response
        });
    } catch (error) {
        console.error("Error fetching user settings:", error);
        return NextResponse.json(
            { error: "Failed to fetch settings" },
            { status: 500 },
        );
    }
}

// PUT - Update user settings
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

        // Check if settings exist
        const [existing] = await db
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, session.user.id))
            .limit(1);

        // Build update/insert data from body, only including defined fields
        const updateData: Record<string, unknown> = { updatedAt: new Date() };
        const insertData: Record<string, unknown> = {
            userId: session.user.id,
        };

        for (const field of SETTINGS_FIELDS) {
            const value = body[field];
            if (value !== undefined) {
                updateData[field] = value;
                insertData[field] = value;
            } else if (!existing) {
                // Use default value for new settings
                insertData[field] = DEFAULT_SETTINGS[field];
            }
        }

        // Handle titleGenerationPrompt separately (jsonb field)
        if (body.titleGenerationPrompt !== undefined) {
            updateData.titleGenerationPrompt = body.titleGenerationPrompt;
            insertData.titleGenerationPrompt = body.titleGenerationPrompt;
        } else if (!existing) {
            insertData.titleGenerationPrompt = null;
        }

        // Handle barkPushUrl separately
        if (body.barkPushUrl !== undefined) {
            if (body.barkPushUrl === null || body.barkPushUrl === "") {
                // Clear the URL if null or empty string
                updateData.barkPushUrl = null;
                insertData.barkPushUrl = null;
            } else {
                // Store the URL as-is (no encryption needed)
                updateData.barkPushUrl = body.barkPushUrl;
                insertData.barkPushUrl = body.barkPushUrl;
            }
        } else if (!existing) {
            insertData.barkPushUrl = null;
        }

        if (existing) {
            // Update existing settings
            await db
                .update(userSettings)
                .set(updateData)
                .where(eq(userSettings.userId, session.user.id));
        } else {
            // Create new settings
            await db
                .insert(userSettings)
                .values(insertData as typeof userSettings.$inferInsert);
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error updating user settings:", error);
        return NextResponse.json(
            { error: "Failed to update settings" },
            { status: 500 },
        );
    }
}
