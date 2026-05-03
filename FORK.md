# Fork notes — `doskarj/openplaud`

Personal fork of [openplaud/openplaud](https://github.com/openplaud/openplaud).
This file documents what's different here, how images are built, and how to
keep the fork in sync with upstream.

> ⚠️ **Do not file issues or PRs against upstream from this fork's `doskarj/main` branch.**
> Use a clean topic branch off `main` (which mirrors upstream) for any contributions back.

---

## Branch model

| Branch | Purpose | Tracks |
|---|---|---|
| `main` | Clean mirror of upstream `main`. **No personal commits.** | `upstream/main` |
| `doskarj/main` | Working branch — upstream + personal patches | `origin/doskarj/main` |

The Docker image is built from tags placed on `doskarj/main` (see *Releases* below).
`main` is kept clean so upstream syncs are conflict-free fast-forwards.

## Image registry

Images are published to GitHub Container Registry by the Docker workflow at
`.github/workflows/docker.yml` (inherited from upstream, no edits required).

```
ghcr.io/doskarj/openplaud:<tag>
```

Pin a specific personal tag in your `compose.yml` — never use `latest` or
`dev` for production deployments.

## Tag scheme

```
v<UPSTREAM_VERSION>-doskarj-<PERSONAL_PATCH>
```

Example: `v0.2.1-doskarj-0.0.1` means

- Built on top of post-`v0.2.0` upstream `main` (so unreleased `0.2.1`-track),
- Personal patch series `0.0.1` (bump the patch on each new build).

GitHub Actions translates this into the GHCR tags via `docker/metadata-action`:

| Git tag | GHCR tags produced |
|---|---|
| `v0.2.1-doskarj-0.0.1` | `0.2.1-doskarj-0.0.1`, `0.2`, `latest` |

The `0.2` and `latest` tags are noisy side effects of the upstream workflow —
ignore them for your deployments and pin to the full tag.

## Custom changes vs upstream

Each entry below is a single commit/topic on `doskarj/main` that does not exist upstream.

### `fix(transcription): unblock OpenAI diarize models`

`gpt-4o-transcribe-diarize` requires the `chunking_strategy` parameter on
`POST /v1/audio/transcriptions`; upstream doesn't send it, so any user who
selects a diarize model gets `400 chunking_strategy is required for
diarization models` and the recording silently lands in the failed state.

Fix: when the configured model name contains `diarize`, send
`chunking_strategy: "auto"`. Other models (`whisper-1`, `gpt-4o-transcribe`,
…) are unaffected.

Upstream issue / PR: not yet filed (see *Contributing back*).

---

## Updating from upstream

Run this whenever upstream tags a new release (or whenever you want to pull
in `main`).

```bash
# 1. Sync the clean mirror
git checkout main
git fetch upstream
git merge --ff-only upstream/main
git push origin main

# 2. Rebase the working branch on top
git checkout doskarj/main
git rebase main
# resolve conflicts if any (FORK.md / README.md fork notice are the only
# touched files outside of code patches; the fix patch lives in
# src/lib/transcription/transcribe-recording.ts)
git push --force-with-lease origin doskarj/main
```

Use `--force-with-lease` (not `--force`) so you don't clobber a push made
from another machine.

## Cutting a new image build

```bash
# from doskarj/main, with all changes committed and pushed
git tag -a v0.2.1-doskarj-0.0.2 -m "doskarj: <one-line summary>"
git push origin v0.2.1-doskarj-0.0.2
```

GitHub Actions will build for `linux/amd64,linux/arm64` and publish to
`ghcr.io/doskarj/openplaud:0.2.1-doskarj-0.0.2`. Watch the run at
<https://github.com/doskarj/openplaud/actions>.

Then on the NAS edit `/volume1/docker/openplaud/.env`:

```env
OPENPLAUD_VERSION=0.2.1-doskarj-0.0.2
```

…and **Project → openplaud → Action → Build and run** in Container Manager.

## Making the GHCR package pullable from the NAS

By default a freshly created GHCR package is **private**. The NAS pulls
without GitHub credentials, so either:

1. Make the package public (recommended for personal use, the image only
   contains OSS code), or
2. Authenticate Docker on the NAS with a PAT that has `read:packages`.

For (1):

1. <https://github.com/users/doskarj/packages/container/openplaud/settings>
2. *Danger Zone* → *Change visibility* → **Public**.

You only need to do this once — subsequent tags inherit visibility.

## Contributing back

The `chunking_strategy` fix is a clean defect fix and should eventually go
upstream. To send a PR without leaking fork-only changes:

```bash
git checkout main
git pull upstream main
git checkout -b fix/diarize-chunking-strategy
git cherry-pick <fix commit sha from doskarj/main>
git push origin fix/diarize-chunking-strategy
gh pr create --repo openplaud/openplaud --base main \
  --head doskarj:fix/diarize-chunking-strategy
```
