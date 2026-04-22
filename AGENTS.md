# OpenPlaud — Agent Guidelines

## What This Is

OpenPlaud is a self-hosted interface for Plaud Note voice recorders. It replaces Plaud's $20/month AI subscription with a user-controlled setup: the user brings their own OpenAI-compatible API keys (OpenAI, Groq, LM Studio, Ollama, etc.), and OpenPlaud handles syncing recordings from Plaud devices, transcription, AI summaries/titles, storage, export, and notifications.

Users authenticate against Plaud's API via OTP (email verification code), then OpenPlaud pulls recordings from the regional Plaud server on a schedule. The app runs as a Next.js app behind Docker — locally, on a VPS, or as a hosted SaaS.

## 🚨 We Have Real Users

OpenPlaud is live and in use. This is not a toy project or a pre-launch experiment — people depend on it to access their recordings, their transcripts, and their storage. Every decision should be weighed against that:

- **Backwards compatibility matters.** Existing DB rows, stored tokens, synced recordings, and user settings must keep working across deploys. Schema changes are additive by default; destructive migrations need an explicit user-impact assessment.
- **Don't break the sync loop.** If sync stops working, users stop trusting the product. Test against a real Plaud account before shipping anything that touches `src/lib/sync/` or `src/lib/plaud/`.
- **Don't break existing integrations.** Users have configured AI providers, storage backends, SMTP, Bark — changes to those surfaces need deprecation paths, not flag-day rewrites.
- **Ship incrementally; fail loudly.** Add logging + Sentry context when changing hot paths so regressions surface fast instead of silently corrupting user data.
- **Communicate breaking changes** in `CHANGELOG.md` with a migration note — self-hosters read this to decide when to upgrade.

When in doubt, ask: *"If this goes wrong, how many users notice, and how fast can they recover?"*

## Positioning

OpenPlaud is **open source (AGPL-3.0)** and targets **anyone who owns a Plaud device** (Plaud Note, Note Pro, or NotePin) and doesn't want to pay Plaud's AI subscription. Within that audience, the landing copy speaks to two positioning slices with different decision drivers:

### Slice 1 — Cost-conscious Plaud users (default path)

The hero, The Math, and Reddit-quotes sections target this slice. Message: *"Plaud charges $XX/month. We charge $0."* These users were sold on the hardware, then surprised by the subscription. Evidence lives on r/PlaudNoteUsers threads about canceling the sub. They mostly want cheap + reliable, don't care deeply where the code runs.

### Slice 2 — Privacy / compliance professionals (`for-professionals.tsx`)

Explicitly named: **lawyers, journalists, consultants, researchers**. Decision driver is sovereignty — their conversations are privileged, regulated, or source-protected. They default to **self-host + local AI** (Whisper / Llama via Ollama). They care about auditability (AGPL), infrastructure control, and being able to show clients exactly what processes their recordings.

> Note on compliance: we do **not** self-attest HIPAA. The compliance claim belongs to the user's AI provider. We provide the knobs (self-host + pluggable AI), they own the story. Never add copy that implies otherwise.

### Delivery tiers

The same product is delivered via three surfaces:

- **Self-host (Free, forever)** — AGPL source, `docker compose up`, unlimited everything bounded only by user hardware + their own API keys. ✅ Implemented. The default for Slice 2.
- **Hosted Free ($0/mo, with caps)** — zero-setup onboarding. 500 min/mo transcription, 10 GB storage, one device, bring-your-own AI keys. ⚠️ **Landing-page positioning only** — no billing, no plan enforcement, no caps in code.
- **Hosted Pro ($5/mo, unlimited)** — same product, unlimited everything, priority sync/backups/support. ⚠️ **Landing-page positioning only.**

All three serve the same audience; they differ only on who runs the server. Conversion logic is friction vs control, not features: a Slice 1 user who doesn't want to think about infra defaults to Hosted; a Slice 2 user defaults to Self-host.

### Open source posture

**Everything is open** — dashboard, sync, transcription, storage adapters, the Plaud API client. Being AGPL is a feature, not a moat: the core value is giving Plaud-device owners an escape hatch from vendor lock-in. Hosted tiers exist to monetise convenience, not gated features. **Do not add proprietary-only features.** Anything shipped to hosted should also work on self-host.

### The marketing-vs-product gap

OpenPlaud has a "marketing ahead of code" state in several places. Things you may see that are **NOT actually shipped**:

- **Hosted Free / Hosted Pro tiers** on `src/components/landing/pricing.tsx` — no billing integration (no Stripe, no webhook), no `plan` column on users, no subscriptions table, no caps enforcement anywhere. The pricing file itself comments `"sensible placeholders. Adjust as hosted-infra economics settle."`
- **Plaud refresh-token handling** was removed in `bed9cd3` after a HAR capture confirmed Plaud issues only long-lived access tokens (~300 day JWT expiry). Do not re-add it.
- The landing page references a "Switch Plaud account" flow that isn't wired yet (Phase 2 follow-up).

**Always cross-check claims in changelog / landing / pricing pages against actual code before designing features that depend on them.**

### Implications for engineering decisions

- **Self-host users are first-class.** Features cannot require hosted-only infrastructure. If it won't run in `docker compose up`, it doesn't ship. Slice 2 literally cannot use it otherwise.
- **Local-AI path must keep working.** Browser transcription (Transformers.js) and Ollama-style local providers are the privacy-critical path. Don't regress them in pursuit of "better" cloud-provider features.
- **No vendor lock-in inside OpenPlaud either.** Storage is pluggable (local / S3-compatible). AI providers are pluggable (any OpenAI-compatible). Don't hardcode to one, don't add a "default cloud" fallback that silently leaks data.
- **Export parity is non-negotiable.** Full backup (one-archive export → restore elsewhere) is the proof that users can leave. It must stay complete: every recording, transcript, summary. Do not ship a feature that can't be backed up.
- **Never claim compliance we don't own.** HIPAA, SOC2, attorney-client, etc. — the claim belongs to the user's AI provider + their self-host setup, not to OpenPlaud. Marketing copy and product copy must both stay honest here.
- **Target UX comparisons:** Plaud's own web app (the thing we're replacing), plus polished SaaS like Linear / Vercel dashboards as the UX bar.
- **NOT target comparisons:** generic self-host transcription stacks (Whisper + a script). OpenPlaud must feel like a product, not a pile of utilities.
- **Community contributions are welcome** (`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`), but the core team is small — write internal docs as internal engineering notes, not contributor pitches.

## Product Principles

These guide the "in-doubt, do this" decisions. In priority order:

### 1. Performance above all else

When in doubt, do the thing that makes the app feel the fastest.

- Optimistic updates everywhere writes happen
- Custom data-loader patterns + link prewarm on hover
- No JS or data waterfalls — parallelize fetches, colocate loaders
- Minimize blocking onboarding states — users should reach "recordings list" ASAP

### 2. Good defaults

Less config is best. Users should expect things to work out of the box:

- Sensible sync intervals, sensible retention, sensible storage paths
- Auto-detect the Plaud region via the `-302` redirect in `plaudSendCode`
- Default to browser transcription (zero API cost) when no AI provider is configured

### 3. Convenience

No friction, pleasant to use:

- All shareable URLs are share-ready by default
- Homepage → latest recording should be ≤ 4 clicks
- Re-auth flows (when they eventually happen) should be a modal, not a full onboarding reset

### 4. Security

Convenient ≠ insecure:

- AES-256-GCM encryption for all stored tokens (Plaud bearer, AI keys, SMTP creds)
- Check `userId` on every query that touches user data — never trust route params
- Be very thoughtful about "public" endpoints — most everything should require an authed session
- Path-traversal protection in local storage, range-header validation on audio streaming

## Tech Stack

- **Next.js 16** (App Router) + **TypeScript** (strict)
- **Tailwind CSS v4** + **shadcn/ui** (Radix primitives)
- **PostgreSQL** + **Drizzle ORM**
- **Better Auth** for session auth (email + password)
- **Next.js route handlers** for the API (no separate API framework)
- **Cloudflare R2 / AWS S3 / MinIO** (S3-compatible) or local filesystem for audio storage
- **Transformers.js** (`@xenova/transformers`) for in-browser Whisper transcription
- **OpenAI-compatible HTTP** for server-side transcription + LLM calls (any provider)
- **nodemailer** for SMTP notifications; Bark for iOS push
- **Biome** for linting + formatting
- **pnpm** for package management, **Bun** for running scripts (`bun db:migrate`, etc.)
- **Vitest** for unit + integration tests

## Project Layout

```
src/
├── app/
│   ├── (app)/          # Authed dashboard (dashboard, recordings, settings, onboarding)
│   ├── (auth)/         # Login / register
│   ├── api/            # Route handlers (plaud, recordings, settings, backup, export, dev, health)
│   ├── layout.tsx      # Root layout
│   └── page.tsx        # Landing page (sections composed from components/landing/*)
├── components/
│   ├── landing/        # Marketing page sections (hero, pricing, features, FAQ, etc.)
│   ├── settings/       # Settings dialog + sections
│   ├── recordings/     # Recording workstation UI
│   ├── dashboard/      # Authed shell
│   ├── onboarding/     # OTP + initial setup flows
│   └── ui/             # shadcn primitives
├── db/
│   ├── schema.ts       # All Drizzle tables in one file
│   ├── migrations/     # Generated migrations + meta snapshots
│   ├── migrate.ts      # Runs pending migrations (used by `bun db:migrate`)
│   └── index.ts        # Drizzle client
├── hooks/              # React hooks (use-settings, use-auto-sync, etc.)
├── lib/
│   ├── plaud/          # Plaud API client + auth + server regions
│   ├── sync/           # Recording sync worker + config
│   ├── transcription/  # Server-side transcription pipeline
│   ├── ai/             # AI provider abstraction (OpenAI-compatible)
│   ├── storage/        # Local + S3 storage adapters (pluggable)
│   ├── notifications/  # Email + Bark
│   ├── encryption.ts   # AES-256-GCM for tokens/keys
│   ├── env.ts          # Zod-validated env schema
│   └── auth.ts         # Better Auth config
├── tests/              # Vitest unit + integration tests
└── types/              # Shared TypeScript types (plaud, settings, etc.)
```

## Code Conventions

- Prefer **server components**; use `"use client"` only for interactivity
- Route handlers live under `src/app/api/` using Next.js conventions — one `route.ts` per endpoint
- Database access through Drizzle; queries may live inline in route handlers for now (no enforced `queries/` layer yet)
- **Validate user ownership on every query** that touches a user-scoped row — `where(eq(table.userId, session.user.id))` is not optional
- Environment variables are validated via Zod in `src/lib/env.ts` — add new vars there and access via the validated `env` object, never `process.env.X` directly in feature code
- Toasts via `sonner`; no `alert()` or custom toast systems
- Encrypt sensitive values at rest (`src/lib/encryption.ts`) — never store plaintext bearer tokens, refresh tokens (where applicable), or API keys
- Client components that fetch from our own API should use the existing `/api/...` routes — no duplicate client-side Plaud API calls

## Git & PRs

- **Squash-merge feature branches.** Scoped features land on `main` as a single commit; scaffolding commits on the branch are noise.
- **Regular-merge long-lived branches** (investigation work, multi-phase refactors, anything where the individual commits carry meaningful context worth preserving in history).
- Commit prefix conventions: `feat:`, `fix:`, `refactor:`, `chore:`, `perf:`, `docs:` (Conventional Commits-ish).
- Mixed-concern branches are OK short-term, but split at PR time when themes are unrelated — easier review, cleaner revert.

## Database

| Command | What it does |
|---------|-------------|
| `bun db:migrate` | Run pending migrations |
| `bun run db:generate` (or `pnpm db:generate`) | Generate a new migration from schema changes |
| `bun run db:studio` | Open Drizzle Studio GUI |

Schema lives in `src/db/schema.ts`. Migrations are in `src/db/migrations/`.

**⚠️ NEVER hand-write migration files.** Always edit `src/db/schema.ts` first, then run `bun run db:generate` to produce the migration. Drizzle tracks migrations via snapshot files in `src/db/migrations/meta/` — hand-written SQL files won't generate snapshots, which causes future `db:generate` runs to re-emit already-applied columns (silent history corruption).

If drizzle-kit generates SQL that re-adds columns that already exist in the DB, it means meta snapshots are out of sync with reality — fix the drift, don't hand-edit around it. Migrations `0010-0012` are historical examples of this drift; `0013+` are clean.

## Environment

Copy `.env.example` → `.env.local`. Key vars (validated in `src/lib/env.ts`):

- `DATABASE_URL` — PostgreSQL connection string
- `BETTER_AUTH_SECRET` — auth secret (`openssl rand -hex 32`)
- `ENCRYPTION_KEY` — AES-256-GCM key for tokens (`openssl rand -hex 32`)
- `APP_URL` — canonical app URL (used for auth callbacks, emails, etc.)
- `DEFAULT_STORAGE_TYPE` — `local` (default) or `s3`
- `LOCAL_STORAGE_PATH` — where recordings go when `DEFAULT_STORAGE_TYPE=local`
- S3 creds (when using S3): standard AWS-SDK envs
- `SMTP_*` — optional, for email notifications

## Testing Locally

```
bun dev              # Next.js dev server
bun test             # Vitest once
bun run test:watch   # Vitest watch mode
bun run type-check   # tsc --noEmit
bun run format-and-lint      # Biome check
bun run format-and-lint:fix  # Biome autofix
```

To test the full Plaud sync flow end-to-end you need a real Plaud account + device. The integration test (`src/tests/plaud.integration.test.ts`) requires a live bearer token and is skipped without it.

Dev diagnostics: Settings → Developer Tools (dev-only, hidden in production builds) exposes `/api/dev/plaud/info` which probes the stored Plaud connection and reports device + recording counts. Useful for "is the connection actually working" checks without digging into the DB.

## Issue Tracking

We use **GitHub Issues** as the primary way to track features, bugs, and tasks. Three templates, two audiences:

| Template | For | Audience |
|---|---|---|
| `bug_report.yml` | External bug reports from users | Public contributors |
| `feature_request.yml` | External feature suggestions | Public contributors |
| `task.yml` | Internal work items (agent-handoff format) | Us + AI agents |

### Task template (internal)

Written so an agent in a fresh session can pick it up cold and ship a PR without asking clarifying questions. Three required blocks:

1. **Context** — why this matters + current state. One paragraph. Mention which audience Slice it serves (cost-conscious vs professional) if relevant.
2. **Acceptance Criteria** — concrete, verifiable outcomes. So the agent knows when to stop.
3. **Relevant files** (optional) — pointers to where changes likely happen. Saves repo grepping.

Keep descriptions factual. Avoid vague asks like "improve onboarding" — say what specifically should change and how to verify it shipped.

### Title prefixes

Matches our commit prefixes:

| Prefix | Use for | Example |
|--------|---------|---------|
| `feat:` | New features or capabilities | `feat: switch Plaud account without losing recordings` |
| `fix:` | Bug fixes | `fix: sync stalls when Plaud returns 429 mid-page` |
| `refactor:` | Code restructuring, no behavior change | `refactor: extract OTP flow into reusable component` |
| `chore:` | Maintenance, deps, CI | `chore: bump Drizzle to 0.45` |
| `perf:` | Performance improvements | `perf: parallelize recording + transcription fetches` |
| `docs:` | Documentation changes | `docs: document local Whisper setup in README` |

### Labels

- `bug` — broken behavior (auto-applied by bug template alongside `triage`)
- `enhancement` — new feature or improvement (auto-applied by feature template)
- `task` — internal agent-handoff work item (auto-applied by task template)
- `triage` — awaiting initial review / prioritization
- `good first issue` — small, well-scoped, ideal for a single agent session or outside contributor
- `documentation`, `help wanted`, `question`, `duplicate`, `invalid`, `wontfix` — standard GitHub defaults

Additional labels will be added as patterns emerge — don't invent ad-hoc labels without a clear recurring use case.

### Workflow

1. Create an issue using the right template
2. Agent (or human) picks it up, implements on a branch, opens a PR
3. Reference the issue number in the commit / PR body (e.g. `feat: dedup imports, closes #42`)
4. After shipping, create follow-up issues for anything deferred — don't let TODOs live only in code comments or in `plans/*.md`

`plans/` and `todo.md` are fine for investigation notes and in-flight design work, but anything that needs to be remembered *across sessions* belongs in a GitHub Issue.

## Plaud API Notes

These are non-obvious facts about Plaud's server that must be respected:

- **No refresh tokens.** The OTP login flow returns only `access_token` — a long-lived JWT (~300 day expiry observed). Do not re-add refresh-token plumbing; when access tokens eventually expire, the user re-authenticates via the reconnect UI.
- **Regional servers.** `api.plaud.ai` is the global endpoint; accounts may live on `api-euc1.plaud.ai` (EU) or `api-apse1.plaud.ai` (APAC). `/auth/otp-send-code` returns `status: -302` with `data.domains.api` when the user's account lives on a different region. `plaudSendCode` handles this redirect automatically.
- **Rate limiting.** `PlaudClient` has built-in retry-with-backoff on 429 + 5xx responses (`src/lib/plaud/client.ts`). Respect the Retry-After header.
- **Bearer tokens are encrypted at rest** in `plaudConnections.bearerToken` via `src/lib/encryption.ts`. Decrypt only at the moment of HTTP request construction.

## Architecture Notes

- **Sync is pull-based.** The client polls Plaud's API on a user-configured interval; Plaud has no push. The sync worker (`src/lib/sync/sync-recordings.ts`) is idempotent and paginated.
- **Transcription runs in two places:** (1) in-browser via Transformers.js for zero-cost, or (2) server-side via any OpenAI-compatible provider the user configured. The choice is per-recording and can be changed from the recording workstation.
- **Storage is pluggable.** Local filesystem and S3 adapters live behind a common interface in `src/lib/storage/`. New backends should implement the `StorageProvider` interface; don't branch on storage type in feature code.
- **AI providers are pluggable.** All LLM/STT calls go through the abstraction in `src/lib/ai/`. Any OpenAI-compatible endpoint works — don't hardcode OpenAI-specific behavior.
