---
description: Finish the current task end-to-end with commit and push
argument-hint: "[instructions]"
---
Wrap it.

Additional instructions: $ARGUMENTS

Determine context from the conversation history first.

Context detection:
- If the conversation already mentions a GitHub issue or PR, use that existing context.
- If the work came from `/is` or `/pr`, the issue/PR context is already known from prior analysis.
- If there is no GitHub issue or PR in the conversation history, treat this as non-GitHub work.

Unless I explicitly override something in this request, do the following in order:

1. **Do not touch `CHANGELOG.md`.** It's maintainer-curated at release time per AGENTS.md. Skip this step entirely unless I explicitly say "update changelog" or "we're cutting a release."
2. If this task is tied to a GitHub issue or PR and a final comment has not already been posted in this session, draft it in my tone (concise, technical, no emojis, no fluff), write it to a temp file, preview it, and post exactly one final comment via `gh issue comment --body-file` / `gh pr comment --body-file`.
3. If code changed (not docs only), run `pnpm format-and-lint:fix && pnpm type-check` and fix all errors and warnings. If a test file was created or modified, run it and iterate until it passes. Capture full output — no `| tail` / `| head`.
4. `git status` — verify only files I changed this session would be staged.
5. `git add <specific-paths>` — never `git add -A` or `git add .`. Track exactly what I touched.
6. Commit. If tied to exactly one issue, include `closes #<n>` (or `fixes #<n>` for bugs). If tied to multiple issues, stop and ask which one. If not tied to an issue, no `closes`/`fixes`. Use Conventional-Commits prefix (`feat:`, `fix:`, `refactor:`, `chore:`, `perf:`, `docs:`).
7. Check the current git branch. If it is not `main`, stop and ask what to do. Do not push from another branch unless I explicitly say so.
8. `git pull --rebase` if needed, then `git push`. Never `--force` / `--force-with-lease`. Never `--no-verify` on the commit.

Constraints:
- Never stage unrelated files.
- Never use `git add .` or `git add -A`.
- Never run forbidden git ops: `reset --hard`, `checkout .`, `clean -fd`, `stash`, `--force`, `--no-verify`.
- Do not open a PR unless I explicitly ask.
- If this is not GitHub issue or PR work, do not post a GitHub comment.
- If a final issue or PR comment was already posted in this session, do not post another one unless I explicitly ask.
