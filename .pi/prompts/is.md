---
description: Analyze GitHub issues (bugs or feature requests)
argument-hint: "<issue>"
---
Analyze GitHub issue(s): $ARGUMENTS

For each issue:

1. Read the issue in full, including all comments and linked issues/PRs (`gh issue view <n> --json title,body,comments,labels,state`).
2. Do not trust analysis written in the issue. Independently verify behavior and derive your own analysis from the code and execution path.

3. **For bugs**:
   - Ignore any root cause analysis in the issue (likely wrong)
   - Read all related code files in full (no truncation, Read tool only — never `cat`/`sed`)
   - Trace the code path and identify the actual root cause
   - Pay attention to user-scoped query checks (`eq(table.userId, session.user.id)`) and encryption-at-rest boundaries when relevant — see AGENTS.md
   - Propose a fix

4. **For feature requests**:
   - Do not trust implementation proposals in the issue without verification
   - Read all related code files in full
   - Cross-check against AGENTS.md "Marketing-vs-product gap" — confirm the feature isn't predicated on something that doesn't actually exist in code (hosted tiers, etc.)
   - Propose the most concise implementation approach
   - List affected files and changes needed
   - Flag deploy-surface impact (schema, env vars, docker-compose) explicitly

Do NOT implement unless explicitly asked. Analyze and propose only.
