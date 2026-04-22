## Agent info

Generally speaking, you should browse the codebase to figure out what is going on.

We have a few "philosophies" I want to make sure we honor throughout development:

### 1. Performance above all else

When in doubt, do the thing that makes the app feel the fastest to use.

This includes things like

- Optimistic updates
- Using the custom data loader patterns and custom link components with prewarm on hover
- Avoiding waterfalls in anything from js to file fetching

### 2. Good defaults

Users should expect things to behave well by default. Less config is best.

### 3. Convenience

We should not compromise on simplicity and good ux. We want to be pleasant to use with as little friction as possible. This means things like:

- All links are "share" links by default
- Getting from homepage to latest video should always be fewer than 4 clicks
- Minimize blocking states to let users get into app asap

### 4. Security

We want to make things convenient, but we don't want to be insecure. Be thoughtful about how things are implemented. Check team status and user status before committing changes. Be VERY thoughtful about endpoints exposed "publicly". Use auth and auth checks where they make sense to.

## Database migrations

**Always** use `bun db:generate` to create migrations. Never hand-write `.sql` files in `src/db/migrations/`.

Hand-written migrations skip the drizzle-kit meta snapshot, causing future `db:generate` runs to re-emit columns that already exist in the DB (because drizzle diffs against the last snapshot it knows about, not the actual DB state). This silently corrupts migration history.

Workflow:
1. Edit `src/db/schema.ts`
2. Run `bun db:generate --name <descriptive_name>` (or `bunx drizzle-kit generate --name <name>`)
3. Review the generated SQL + snapshot in `src/db/migrations/`
4. Run `bun db:migrate` to apply

If drizzle-kit generates SQL that re-adds already-applied columns, it means the meta snapshots are out of sync with the DB — fix the snapshot drift, don't hand-edit around it.

## Plaud API notes

- **No refresh tokens.** The OTP login flow returns only `access_token` (long-lived, ~300 day JWT expiry per observed claims). Do not add refresh-token plumbing — when tokens eventually expire, users re-authenticate via the reconnect UI.
- Region handling: `/auth/otp-send-code` returns `status: -302` with `data.domains.api` when the user's account lives on a different regional server. `plaudSendCode` already retries against the correct base.
