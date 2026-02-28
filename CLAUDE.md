# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
bun dev             # Start dev server
bun run type-check  # TypeScript check (tsc --noEmit)
bun run format-and-lint      # Biome linter (read-only)
bun run format-and-lint:fix  # Biome linter (auto-fix)
bun test            # Run unit tests (Vitest)
bun test:watch      # Watch mode

# Database
bun run db:generate  # Generate migration files from schema changes
bun run db:migrate   # Apply migrations
bun run db:studio    # Visual database browser
```

> Build/type-checking must be done inside the Docker container (`sudo docker exec openplaud-app <cmd>`) since `next` and `bun` are not available on the host.

## Architecture Overview

**OpenPlaud** is a self-hosted AI transcription interface for Plaud Note voice recorders. It replaces Plaud's cloud subscription by letting users connect their own AI API keys (OpenAI-compatible).

### Core Data Flow

1. **Sync**: Plaud API → download audio (MP3/OPUS) → upload to storage (local or S3) → index in `recordings` table
2. **Transcribe**: fetch audio from storage → send to OpenAI-compatible API → save in `transcriptions` table
3. **Enhance**: transcription text → LLM → generate title, save to `recordings.filename`
4. **Sync back**: optionally push the generated title back to the Plaud device via `plaudClient.updateFilename()`

### Route Layout

- `src/app/(app)/` — authenticated pages (dashboard, recording detail)
- `src/app/(auth)/` — public pages (login, register)
- `src/app/api/` — REST API endpoints

### Key Abstractions

**Storage (`src/lib/storage/`)**
- `StorageProvider` interface with `uploadFile`, `downloadFile`, `getSignedUrl`, `deleteFile`, `testConnection`
- `local-storage.ts` — filesystem (Docker: `/app/audio` volume)
- `s3-storage.ts` — any S3-compatible service (AWS, R2, MinIO, etc.)
- `factory.ts` — `createStorageProvider()` picks implementation from env

**Plaud client (`src/lib/plaud/client.ts`)**
- `PlaudClient` with exponential-backoff retry (handles 429 and 5xx)
- Supports regional API bases: `api.plaud.ai` (US) and `api-euc1.plaud.ai` (EU)
- Bearer tokens stored encrypted in `plaud_connections`

**Transcription (`src/lib/transcription/`)**
- `transcribe-recording.ts` — server-side via OpenAI SDK with custom `baseURL`
- `browser-transcriber.ts` + `worker.ts` — client-side via Transformers.js

**AI title generation (`src/lib/ai/generate-title.ts`)**
- Reads user's enhancement provider (prefers enhancement, falls back to transcription)
- Avoids Whisper models (audio-only) for chat calls
- 6 built-in prompt presets in `src/lib/ai/prompt-presets.ts`

**Encryption (`src/lib/encryption.ts`)**
- AES-256-GCM; format: `hex(IV):hex(authTag):hex(ciphertext)`
- Used for API keys, Plaud bearer tokens, S3 credentials
- Requires 64-hex-char `ENCRYPTION_KEY` env var

**Auth (`src/lib/auth.ts`)**
- Better Auth with Drizzle adapter (email/password, no OAuth)
- Server helpers in `src/lib/auth-server.ts`: `getSession()`, `requireAuth()`
- Client helpers in `src/lib/auth-client.ts`

### Database (PostgreSQL + Drizzle ORM)

Schema defined in `src/db/schema.ts`. Key tables:
- `recordings` — audio metadata, storage path, `plaudFileId`, `filenameModified`
- `transcriptions` — transcription text, provider, model, detected language
- `plaud_connections` — encrypted bearer token + regional API base per user
- `api_credentials` — encrypted API keys with `isDefaultTranscription` / `isDefaultEnhancement` flags
- `user_settings` — 30+ user preferences (sync, playback, notifications, AI)
- `storage_config` — per-user local vs S3 config

### Migrations

SQL files live in `src/db/migrations/`. **Every new migration requires both:**
1. A new SQL file: `src/db/migrations/NNNN_<slug>.sql`
2. A new entry in `src/db/migrations/meta/_journal.json`

Use `bun run db:generate` to produce both automatically from schema changes. The Docker entrypoint runs `migrate-idempotent.ts` (with advisory locks) on startup.

### `plaudFileId` Conventions

- Original Plaud files: numeric/UUID IDs
- Split segments: `split-{originalId}-part001`, `split-{originalId}-part002`, …
- Silence-removed copies: `silence-removed-{originalId}`

The UI and sync-title API use these prefixes to determine whether a recording can be synced back to the Plaud device.

### Environment Variables

Required: `DATABASE_URL`, `BETTER_AUTH_SECRET` (≥32 chars), `APP_URL`, `ENCRYPTION_KEY` (64 hex chars)

Optional: `SMTP_*` for email, `S3_*` for cloud storage, `LOCAL_STORAGE_PATH` (default: `./storage`)

See `.env.example` for the full list.
