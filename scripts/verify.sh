#!/usr/bin/env bash
# Manual acceptance verification for PRD-022 (Clean Install + Dev Setup).
# Run from repo root: bash scripts/verify.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PASS=0
FAIL=0
SKIP=0

green()  { printf '\033[32m✓\033[0m %s\n' "$*"; }
red()    { printf '\033[31m✗\033[0m %s\n' "$*"; }
yellow() { printf '\033[33m⚠\033[0m %s\n' "$*"; }
header() { printf '\n\033[1m%s\033[0m\n' "$*"; }

pass() { green "$1"; PASS=$((PASS + 1)); }
fail() { red   "$1"; FAIL=$((FAIL + 1)); }
skip() { yellow "$1 (skipped)"; SKIP=$((SKIP + 1)); }

# ─────────────────────────────────────────────────────────────
header "PRD-022 — Verify: Clean Install + Dev Setup"
# ─────────────────────────────────────────────────────────────

# ── 1. Automated unit tests ──────────────────────────────────
header "1. Automated tests"

cd "$ROOT"
if bun test > /tmp/ah-test.log 2>&1; then
  pass "bun test — all tests pass"
else
  fail "bun test — failures detected (see /tmp/ah-test.log)"
fi

if bun run typecheck > /tmp/ah-typecheck-backend.log 2>&1; then
  pass "bun run typecheck — backend clean"
else
  fail "bun run typecheck — backend has type errors (see /tmp/ah-typecheck-backend.log)"
fi

if (cd "$ROOT/ui" && bun run typecheck > /tmp/ah-typecheck-ui.log 2>&1); then
  pass "cd ui && bun run typecheck — frontend clean"
else
  fail "cd ui && bun run typecheck — frontend has type errors (see /tmp/ah-typecheck-ui.log)"
fi

# ── 2. Setup script ──────────────────────────────────────────
header "2. Setup script (bun run setup)"

cd "$ROOT"
if bun run setup > /tmp/ah-setup.log 2>&1; then
  pass "bun run setup exits 0"
else
  fail "bun run setup failed — see /tmp/ah-setup.log"
fi

for dir in tasks logs worktrees specs; do
  if [ -d "$ROOT/.work/$dir" ]; then
    pass ".work/$dir exists"
  else
    fail ".work/$dir missing"
  fi
done

if [ -f "$ROOT/.work/agent-handoff.db" ]; then
  pass ".work/agent-handoff.db exists"
else
  fail ".work/agent-handoff.db missing"
fi

if [ -f "$ROOT/.env.local" ]; then
  pass ".env.local exists"
else
  fail ".env.local missing"
fi

# ── 3. Idempotent setup ──────────────────────────────────────
header "3. Idempotent setup (run twice)"

ENV_BEFORE=$(cat "$ROOT/.env.local" 2>/dev/null || echo "")
if bun run setup > /tmp/ah-setup2.log 2>&1; then
  ENV_AFTER=$(cat "$ROOT/.env.local" 2>/dev/null || echo "")
  if [ "$ENV_BEFORE" = "$ENV_AFTER" ]; then
    pass "Second bun run setup exits 0 and does not overwrite .env.local"
  else
    fail ".env.local was overwritten on second run"
  fi
else
  fail "Second bun run setup failed — see /tmp/ah-setup2.log"
fi

# ── 4. Port conflict detection ───────────────────────────────
header "4. Port conflict detection"

# Start a listener on port 4000
nc -l 4000 &
NC_PID=$!
sleep 0.2

DEV_OUTPUT=$(timeout 8 bash "$ROOT/scripts/dev-web.sh" 2>&1 || true)
kill "$NC_PID" 2>/dev/null || true

if echo "$DEV_OUTPUT" | grep -q "4001"; then
  pass "Port 4000 occupied → API moved to 4001"
else
  fail "Port conflict not handled — expected 4001 in output"
  echo "  Output was:"
  echo "$DEV_OUTPUT" | sed 's/^/    /'
fi

if echo "$DEV_OUTPUT" | grep -q "4000 in use"; then
  pass "Output explains why port shifted"
else
  fail "No '4000 in use' message in output"
fi

# ── 5. API health check ──────────────────────────────────────
header "5. API health check"

# Start API in background
PORT=4099 bun run "$ROOT/src/api/server.ts" &
API_PID=$!
sleep 1.2

if curl -sf "http://localhost:4099/api/health" > /tmp/ah-health.json 2>&1; then
  pass "GET /api/health returns 200"
  if grep -q '"ok":true' /tmp/ah-health.json; then
    pass "Health response contains ok:true"
  else
    fail "Health response missing ok:true"
  fi
else
  fail "GET /api/health failed"
fi

kill "$API_PID" 2>/dev/null || true

# ── 6. .env.local not in git ─────────────────────────────────
header "6. .gitignore coverage"

if git -C "$ROOT" check-ignore -q "$ROOT/.env.local" 2>/dev/null; then
  pass ".env.local is gitignored"
else
  fail ".env.local is NOT gitignored"
fi

for pattern in "*.db" ".work/"; do
  if grep -q "$pattern" "$ROOT/.gitignore"; then
    pass ".gitignore contains $pattern"
  else
    fail ".gitignore missing $pattern"
  fi
done

# ── Summary ──────────────────────────────────────────────────
header "Summary"
printf "  Pass: %d   Fail: %d   Skip: %d\n" "$PASS" "$FAIL" "$SKIP"

if [ "$FAIL" -gt 0 ]; then
  red "Some checks failed."
  exit 1
else
  green "All checks passed."
fi
