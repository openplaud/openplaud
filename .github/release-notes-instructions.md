# Release Notes Style Guide

## About OpenPlaud
OpenPlaud is a self-hosted AI transcription interface for Plaud Note devices. Users self-host via Docker.

## Categories
Group entries under these headings (omit empty categories):
- **🎙️ New Features** — User-facing functionality
- **🐛 Bug Fixes** — Things that were broken and are now fixed
- **⚡ Improvements** — Performance, UX, or quality-of-life improvements
- **🔧 Internal** — Infra, deps, refactors (keep brief)

## What to Skip
Do NOT generate entries for:
- CI/CD-only changes
- Pure refactors with no user impact
- Test-only changes
- Lint/format fixes

## Style
- Write for self-hosters, not developers
- Present tense: "Add", "Fix", "Improve"
- Be specific but concise (one line per entry)
- Mention Docker/deployment impact if relevant (e.g. new env vars, migrations)
- If a DB migration is required, add a **⚠️ Migration Required** note at the top

## Entry Format
`<description> (#<pr_number>)`
