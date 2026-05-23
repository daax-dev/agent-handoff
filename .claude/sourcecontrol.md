# Source Control

---

## Repository
- Host: GitHub — `github.com/daax-dev/agent-handoff`
- Default branch: main
- All work lands via PR. No direct commits to main.

---

## Branch Naming
- Feature: `feature/<short-topic>`
- Bug fix: `fix/<short-topic>`
- Docs: `docs/<short-topic>`
- Chore / tooling: `chore/<short-topic>`
- Claude Code sessions: harness-assigned name (e.g., `claude/<task>-<id>`). Do not rename mid-session.
- Lowercase, hyphen-separated. Keep names short.

---

## Commits
- Imperative mood, present tense: "add X", not "added X" or "adds X".
- Subject line <= 72 characters.
- Body explains the **why**. The diff shows the what.
- One logical change per commit. Mixed-purpose commits get rejected at review.
- Do not amend a commit that has already been pushed unless explicitly asked.

---

## Pull Requests
- Open a PR as soon as the branch has a meaningful commit. Draft is fine.
- PR title = leading commit subject line.
- CI (`.github/workflows/ci.yml`) runs typecheck → test → build on every PR to `main`; it must be green before merge.
- PR body must include:
  - Problem statement.
  - Approach taken and alternatives considered.
  - Test evidence (commands run, output).
  - Which model produced and which model validated (if AI-assisted).
- Never merge your own PR unless explicitly authorized by the operator.
- Squash-merge by default unless the branch history is intentionally curated.

---

## Worktrees
- Long-running parallel work uses `git worktree` rather than branch-switching in place.
- Worktree paths live outside the primary checkout.
- Worktrees are disposable. Clean them up when the branch lands.
- Note: the orchestrator itself creates runtime worktrees under `.work/` (gitignored) — keep those separate from developer worktrees.

---

## What Never Gets Committed
- Secrets, tokens, keys, connection strings.
- `.env` / `.env.local` files with live values.
- Build output (`dist/`), runtime artifacts (`.work/`), logs (`.logs/`), SQLite files (`*.db`, `*.db-wal`, `*.db-shm`), coverage, and packed tarballs (`*.tgz`) — all gitignored.
- `bun.lock` is currently gitignored, yet CI installs with `--frozen-lockfile` and no lockfile is committed — a known inconsistency to reconcile separately. Do not force-add the lockfile without operator approval.
- IDE / OS noise (`.DS_Store`, `Thumbs.db`) — add to `.gitignore`.

---

## Destructive Operations
- Force-push to a shared branch requires explicit operator authorization.
- `git reset --hard`, branch deletion, and history rewrites require confirmation when recovery is uncertain.
- Treat destructive git operations as high-risk: pause, verify the target, get confirmation.

---

## Tags and Releases
- Tag scheme: semver `vX.Y.Z` (existing tags v0.1.4–v0.1.6).
- Release: publishing a GitHub Release triggers `publish.yml`, which syncs the package version from the tag and runs `npm publish`. The workflow declares `id-token: write` (anticipating OIDC trusted publishing) but currently authenticates with a token (`NODE_AUTH_TOKEN: secrets.NPM_SECRET`), not OIDC.
