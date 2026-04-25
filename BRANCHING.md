# Branching & Release Model

OpenPlaud uses a **rolling-trunk + tagged-release** model. Self-hosters consume releases, not branches.

## Branches

| Branch | What it is | Who uses it |
|--------|------------|-------------|
| `main` | Rolling integration branch. Feature branches squash-merge here as they land. May be broken at any commit. | Contributors, CI, the `dev` Docker tag |
| `feature/*`, `fix/*`, etc. | Short-lived branches that open PRs into `main`. | Contributors |

**`main` is not a deployment target.** Do not `git clone && docker compose up --build` against `main` for production use.

## Releases

Stable versions are cut as **git tags** (`v0.1.0`, `v0.2.0`, …) from `main` when the tree is in a known-good state. Tagging triggers two workflows:

- **`docker.yml`** — builds multi-arch images on `ghcr.io/openplaud/openplaud` and tags them `:X.Y.Z`, `:X.Y`, and `:latest`.
- **`release.yml`** — drafts a GitHub Release with generated notes and attaches `docker-compose.yml` + `.env.example` as install artifacts.

Every push to `main` additionally publishes `:dev` — opt-in rolling image for users who explicitly want the bleeding edge. `:latest` deliberately does **not** track `main`.

## Cutting a release

1. Land the last PR into `main`. CI must be green.
2. Update `CHANGELOG.md`: move items from `[Unreleased]` into a new `[X.Y.Z]` section with today's date. Commit to `main`.
3. Tag and push:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
4. Wait for `docker.yml` and `release.yml` to finish.
5. Review the draft release on GitHub, edit notes if needed, publish.

## Hotfixes (when needed)

If a released version has an urgent bug and `main` has already diverged with unrelated changes:

1. Fix the bug on `main` first.
2. Branch from the release tag: `git checkout -b release-0.1 v0.1.0`.
3. Cherry-pick the fix. Push.
4. Tag `v0.1.1` from that branch and push.

If `main` is still shippable, just cut a normal release from `main` instead.
