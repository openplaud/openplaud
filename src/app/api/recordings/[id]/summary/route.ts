import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { OpenAI } from "openai";
import { db } from "@/db";
import {
    aiEnhancements,
    apiCredentials,
    recordings,
    transcriptions,
    userSettings,
} from "@/db/schema";
import {
    getDefaultSummaryPromptConfig,
    getSummaryPromptById,
    type SummaryPromptConfiguration,
} from "@/lib/ai/summary-presets";
import { auth } from "@/lib/auth";
import { decrypt } from "@/lib/encryption";

// POST - Generate summary
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
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

        const { id } = await params;
        const body = await request.json().catch(() => ({}));
        const presetId = (body.preset as string) || undefined;

        // Verify recording belongs to user
        const [recording] = await db
            .select()
            .from(recordings)
            .where(
                and(
                    eq(recordings.id, id),
                    eq(recordings.userId, session.user.id),
                ),
            )
            .limit(1);

        if (!recording) {
            return NextResponse.json(
                { error: "Recording not found" },
                { status: 404 },
            );
        }

        // Get transcription text
        const [transcription] = await db
            .select()
            .from(transcriptions)
            .where(eq(transcriptions.recordingId, id))
            .limit(1);

        if (!transcription) {
            return NextResponse.json(
                {
                    error: "No transcription available. Transcribe the recording first.",
                },
                { status: 400 },
            );
        }

        // Get user's summary prompt configuration
        const [userSettingsRow] = await db
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, session.user.id))
            .limit(1);

        let promptConfig: SummaryPromptConfiguration =
            getDefaultSummaryPromptConfig();
        if (userSettingsRow?.summaryPrompt) {
            const config =
                userSettingsRow.summaryPrompt as SummaryPromptConfiguration;
            promptConfig = {
                selectedPrompt: config.selectedPrompt || "general",
                customPrompts: config.customPrompts || [],
            };
        }

        // Determine which prompt to use (body override > user setting > default)
        const selectedPreset =
            presetId || promptConfig.selectedPrompt || "general";
        let promptTemplate = getSummaryPromptById(selectedPreset, promptConfig);

        if (!promptTemplate) {
            const defaultConfig = getDefaultSummaryPromptConfig();
            promptTemplate = getSummaryPromptById(
                defaultConfig.selectedPrompt,
                defaultConfig,
            );
            if (!promptTemplate) {
                return NextResponse.json(
                    { error: "Failed to load summary prompt" },
                    { status: 500 },
                );
            }
        }

        // Get AI credentials (prefer enhancement provider, fallback to transcription)
        const [enhancementCredentials] = await db
            .select()
            .from(apiCredentials)
            .where(
                and(
                    eq(apiCredentials.userId, session.user.id),
                    eq(apiCredentials.isDefaultEnhancement, true),
                ),
            )
            .limit(1);

        const [transcriptionCredentials] = await db
            .select()
            .from(apiCredentials)
            .where(
                and(
                    eq(apiCredentials.userId, session.user.id),
                    eq(apiCredentials.isDefaultTranscription, true),
                ),
            )
            .limit(1);

        const credentials = enhancementCredentials || transcriptionCredentials;

        if (!credentials) {
            return NextResponse.json(
                { error: "No AI provider configured" },
                { status: 400 },
            );
        }

        const apiKey = decrypt(credentials.apiKey);

        const openai = new OpenAI({
            apiKey,
            baseURL: credentials.baseUrl || undefined,
        });

        // Use a chat model, not whisper
        // If the configured model is a transcription-only model,
        // fall back to a reasonable chat model for the provider
        let model = credentials.defaultModel || "gpt-4o-mini";
        if (model.includes("whisper")) {
            // Pick a lightweight chat model appropriate for the provider
            const baseUrl = credentials.baseUrl || "";
            if (baseUrl.includes("groq")) {
                model = "llama-3.1-8b-instant";
            } else if (baseUrl.includes("together")) {
                model = "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo";
            } else if (baseUrl.includes("openrouter")) {
                model = "openai/gpt-4o-mini";
            } else {
                model = "gpt-4o-mini";
            }
        }

        // Truncate transcription if too long
        const maxLength = 8000;
        const truncatedTranscription =
            transcription.text.length > maxLength
                ? `${transcription.text.substring(0, maxLength)}...`
                : transcription.text;

        const prompt = promptTemplate.replace(
            "{transcription}",
            truncatedTranscription,
        );

        const response = await openai.chat.completions.create({
            model,
            messages: [
                {
                    role: "system",
                    content:
                        "You are a helpful assistant that summarizes audio transcriptions. Always respond with valid JSON only, no markdown formatting or code fences.",
                },
                {
                    role: "user",
                    content: prompt,
                },
            ],
            temperature: 0.5,
            max_tokens: 2000,
        });

        const rawContent = response.choices[0]?.message?.content?.trim() || "";

        // Parse the JSON response
        let summary = "";
        let keyPoints: string[] = [];
        let actionItems: string[] = [];

        try {
            // Strip markdown code fences if present
            const cleanContent = rawContent
                .replace(/^```(?:json)?\s*/i, "")
                .replace(/\s*```$/i, "")
                .trim();
            const parsed = JSON.parse(cleanContent);
            summary = parsed.summary || "";
            keyPoints = Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [];
            actionItems = Array.isArray(parsed.actionItems)
                ? parsed.actionItems
                : [];
        } catch {
            // Fallback: treat entire response as summary text
            summary = rawContent;
        }

        // Upsert into aiEnhancements
        const [existing] = await db
            .select()
            .from(aiEnhancements)
            .where(
                and(
                    eq(aiEnhancements.recordingId, id),
                    eq(aiEnhancements.userId, session.user.id),
                ),
            )
            .limit(1);

        if (existing) {
            await db
                .update(aiEnhancements)
                .set({
                    summary,
                    keyPoints,
                    actionItems,
                    provider: credentials.provider,
                    model,
                })
                .where(eq(aiEnhancements.id, existing.id));
        } else {
            await db.insert(aiEnhancements).values({
                recordingId: id,
                userId: session.user.id,
                summary,
                keyPoints,
                actionItems,
                provider: credentials.provider,
                model,
            });
        }

        return NextResponse.json({
            summary,
            keyPoints,
            actionItems,
            provider: credentials.provider,
            model,
        });
    } catch (error) {
        console.error("Error generating summary:", error);
        return NextResponse.json(
            { error: "Failed to generate summary" },
            { status: 500 },
        );
    }
}

// GET - Fetch existing summary
export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
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

        const { id } = await params;

        const [enhancement] = await db
            .select()
            .from(aiEnhancements)
            .where(
                and(
                    eq(aiEnhancements.recordingId, id),
                    eq(aiEnhancements.userId, session.user.id),
                ),
            )
            .limit(1);

        if (!enhancement) {
            return NextResponse.json({ summary: null });
        }

        return NextResponse.json({
            summary: enhancement.summary,
            keyPoints: enhancement.keyPoints,
            actionItems: enhancement.actionItems,
            provider: enhancement.provider,
            model: enhancement.model,
            createdAt: enhancement.createdAt,
        });
    } catch (error) {
        console.error("Error fetching summary:", error);
        return NextResponse.json(
            { error: "Failed to fetch summary" },
            { status: 500 },
        );
    }
}

// DELETE - Remove summary
export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
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

        const { id } = await params;

        await db
            .delete(aiEnhancements)
            .where(
                and(
                    eq(aiEnhancements.recordingId, id),
                    eq(aiEnhancements.userId, session.user.id),
                ),
            );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error deleting summary:", error);
        return NextResponse.json(
            { error: "Failed to delete summary" },
            { status: 500 },
        );
    }
}
