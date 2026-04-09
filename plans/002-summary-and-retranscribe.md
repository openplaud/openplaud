# Plan 002: Summary + Re-transcribe feature (#41, #32)

## Problem
Users want to:
1. Re-transcribe recordings with a different model/provider
2. Generate summaries from transcription text using an LLM
3. Store and view summaries alongside transcriptions

## Key discovery
The `aiEnhancements` table already exists in the schema with `summary`, `actionItems`, `keyPoints` columns — it's never been wired up. No migration needed for the core feature.

## Steps

### Step 1: Re-transcribe API
**File**: `src/app/api/recordings/[id]/transcribe/route.ts`

The route already upserts (checks for existing transcription, updates if found). Re-transcribe works by calling the same endpoint again.

Changes:
- Accept optional `model` and `providerId` in the request body to override defaults
- If provided, look up that specific provider's credentials instead of the default
- Return the new transcription text + metadata

No new endpoint needed — just extend the existing one.

### Step 2: Summary API (new)
**File**: `src/app/api/recordings/[id]/summary/route.ts`

- `POST`: Generate summary
  - Fetch transcription text for the recording
  - Get enhancement provider credentials (fallback to transcription provider — same pattern as `generate-title.ts`)
  - Send to LLM with summary prompt
  - Parse response into summary, key points, action items
  - Upsert into `aiEnhancements` table
  - Return the summary data

- `GET`: Return existing summary for a recording
  - Query `aiEnhancements` by `recordingId` + `userId`
  - Return summary, actionItems, keyPoints, provider, model, createdAt

- `DELETE`: Remove summary (allows re-generation)
  - Delete from `aiEnhancements` by `recordingId` + `userId`

### Step 3: Summary prompt presets (new)
**File**: `src/lib/ai/summary-presets.ts`

Default presets:
- **Meeting Notes** — "Summarize this meeting recording. Include attendees mentioned, decisions made, and action items."
- **Key Points** — "Extract the key points from this transcription as a bullet list."
- **Action Items** — "Extract all action items, tasks, and follow-ups mentioned in this transcription."
- **General Summary** — "Provide a concise summary of this audio transcription."

Custom prompt support with `{transcription}` placeholder (same pattern as `src/lib/ai/prompt-presets.ts` for title generation).

### Step 4: User settings for summary
**Migration**: Add `summaryPrompt` jsonb column to `userSettings` table
- Same structure as `titleGenerationPrompt`: `{ selectedPrompt: string, customPrompts: CustomPrompt[] }`

**File**: `src/db/schema.ts` — add column to `userSettings`
**File**: `src/db/migrations/` — new migration file

### Step 5: Frontend — Transcription panel
**File**: `src/components/recordings/transcription-panel.tsx`

Add below existing transcription display:
- **"Re-transcribe" button** — calls POST `/api/recordings/[id]/transcribe`, refreshes panel
  - Optional: dropdown to pick a different provider/model before re-transcribing
- **"Summarize" button** — calls POST `/api/recordings/[id]/summary`
  - Prompt preset dropdown (from summary-presets.ts)
  - Loading state while generating
- **Summary section** (collapsible, below transcription):
  - Summary text
  - Key points (bullet list)
  - Action items (bullet list)
  - Provider/model badge
  - "Re-generate" button
  - "Delete summary" button

### Step 6: Frontend — Dashboard workstation
**File**: `src/components/dashboard/workstation.tsx`

Mirror the same re-transcribe + summary UI from the transcription panel.

### Step 7: Settings UI
**File**: `src/components/settings-sections/` (or existing settings component)

Add summary configuration:
- Default summary prompt preset dropdown
- Custom prompt editor (textarea)
- Same UX pattern as existing title generation prompt settings

## DB changes
- `aiEnhancements` table: **already exists** — no migration needed
- `userSettings.summaryPrompt`: 1 new jsonb column — 1 migration

## Dependencies
- Plan 001 should land first (shared transcription format helper)
- Enhancement provider credentials must be configured by user (fallback to transcription provider)

## Estimated time
1-2 days

## Closes
- Issue #41
- Issue #32 (points 2 and 3)
