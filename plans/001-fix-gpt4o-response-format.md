# Plan 001: Fix gpt-4o response format bug (#20)

## Problem
On-demand transcribe route (`src/app/api/recordings/[id]/transcribe/route.ts`) hardcodes `response_format: "verbose_json"` which causes a 400 error with gpt-4o models. The background sync path (`src/lib/transcription/transcribe-recording.ts`) already handles this correctly.

## Files to change

### 1. Create shared helper — `src/lib/transcription/format.ts` (new)
- `getResponseFormat(model: string)` → `"diarized_json" | "json" | "verbose_json"`
  - `model.includes("diarize")` → `"diarized_json"`
  - `model.startsWith("gpt-4o")` → `"json"`
  - else → `"verbose_json"`
- `parseTranscriptionResponse(transcription, responseFormat)` → `{ text: string, detectedLanguage: string | null }`
  - Handles diarized (speaker segments), verbose (text + language), and plain json (text only)
- Logic already exists in `transcribe-recording.ts` lines 101-135, just extract it

### 2. Update on-demand route — `src/app/api/recordings/[id]/transcribe/route.ts`
- Import `getResponseFormat` + `parseTranscriptionResponse` from `@/lib/transcription/format`
- Replace hardcoded `response_format: "verbose_json"` with `getResponseFormat(model)`
- Replace inline `VerboseTranscription` type and manual parsing with `parseTranscriptionResponse()`

### 3. Update background sync — `src/lib/transcription/transcribe-recording.ts`
- Import and use the same shared helpers (single source of truth)
- Remove the inline format logic (lines 101-135)

### 4. Test
- Run `pnpm test`
- Verify type-check passes: `pnpm type-check`
- Verify lint passes: `pnpm format-and-lint`

## Estimated time
30 minutes

## Closes
- Issue #20
