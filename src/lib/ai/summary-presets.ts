/**
 * Summary generation prompt presets
 */

export type SummaryPreset =
    | "general"
    | "meeting-notes"
    | "key-points"
    | "action-items";

export interface SummaryPromptConfig {
    id: SummaryPreset;
    name: string;
    description: string;
    prompt: string;
}

export interface CustomSummaryPrompt {
    id: string;
    name: string;
    prompt: string;
    createdAt: string;
}

export interface SummaryPromptConfiguration {
    selectedPrompt: string; // preset ID or custom prompt ID
    customPrompts: CustomSummaryPrompt[];
}

export const SUMMARY_PRESETS: Record<SummaryPreset, SummaryPromptConfig> = {
    general: {
        id: "general",
        name: "General Summary",
        description: "Concise summary of any audio transcription",
        prompt: `Provide a concise summary of this audio transcription. Then extract key points and action items if any exist.

Respond in the following JSON format (no markdown, no code fences):
{
  "summary": "A concise paragraph summarizing the transcription",
  "keyPoints": ["key point 1", "key point 2"],
  "actionItems": ["action item 1", "action item 2"]
}

If there are no key points or action items, return empty arrays.

Transcription:
{transcription}`,
    },
    "meeting-notes": {
        id: "meeting-notes",
        name: "Meeting Notes",
        description:
            "Structured meeting summary with attendees, decisions, and action items",
        prompt: `Summarize this meeting recording. Include attendees mentioned, decisions made, and action items.

Respond in the following JSON format (no markdown, no code fences):
{
  "summary": "A structured summary of the meeting including attendees and decisions",
  "keyPoints": ["decision 1", "decision 2", "key discussion point"],
  "actionItems": ["action item with owner if mentioned", "follow-up task"]
}

If there are no key points or action items, return empty arrays.

Transcription:
{transcription}`,
    },
    "key-points": {
        id: "key-points",
        name: "Key Points",
        description: "Extract the key points as a bullet list",
        prompt: `Extract the key points from this transcription. Focus on the most important information, facts, and insights.

Respond in the following JSON format (no markdown, no code fences):
{
  "summary": "A brief one-sentence overview of the transcription",
  "keyPoints": ["key point 1", "key point 2", "key point 3"],
  "actionItems": []
}

Transcription:
{transcription}`,
    },
    "action-items": {
        id: "action-items",
        name: "Action Items",
        description:
            "Extract all action items, tasks, and follow-ups mentioned",
        prompt: `Extract all action items, tasks, and follow-ups mentioned in this transcription. Include who is responsible if mentioned.

Respond in the following JSON format (no markdown, no code fences):
{
  "summary": "A brief overview of what was discussed",
  "keyPoints": [],
  "actionItems": ["action item 1 (owner if known)", "task 2", "follow-up 3"]
}

If there are no action items, return an empty array but still provide a summary.

Transcription:
{transcription}`,
    },
};

/**
 * Get the prompt for a given summary preset
 */
export function getSummaryPromptForPreset(preset: SummaryPreset): string {
    return SUMMARY_PRESETS[preset].prompt;
}

/**
 * Get default summary prompt config
 */
export function getDefaultSummaryPromptConfig(): SummaryPromptConfiguration {
    return {
        selectedPrompt: "general",
        customPrompts: [],
    };
}

/**
 * Get all available summary prompts (presets + custom)
 */
export function getAllSummaryPrompts(
    config: SummaryPromptConfiguration,
): Array<{
    id: string;
    name: string;
    description: string;
    prompt: string;
    isPreset: boolean;
}> {
    const presets = Object.values(SUMMARY_PRESETS).map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        prompt: p.prompt,
        isPreset: true,
    }));

    const customs = config.customPrompts.map((p) => ({
        id: p.id,
        name: p.name,
        description: "Custom prompt",
        prompt: p.prompt,
        isPreset: false,
    }));

    return [...presets, ...customs];
}

/**
 * Get summary prompt by ID (preset or custom)
 */
export function getSummaryPromptById(
    id: string,
    config: SummaryPromptConfiguration,
): string | null {
    if (id in SUMMARY_PRESETS) {
        return SUMMARY_PRESETS[id as SummaryPreset].prompt;
    }

    const custom = config.customPrompts.find((p) => p.id === id);
    return custom?.prompt || null;
}
