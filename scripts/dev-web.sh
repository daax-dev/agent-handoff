#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Auto-setup on first run
if [ ! -d "$ROOT/.work" ]; then
  echo "→ First run — running setup..."
  bun "$ROOT/scripts/setup.ts"
fi

# Find the next available port in a range
find_port() {
  local start=$1 end=$2
  for port in $(seq "$start" "$end"); do
    if ! lsof -ti:"$port" >/dev/null 2>&1; then
      echo "$port"
      return 0
    fi
  done
  return 1
}

API_PORT=$(find_port 4000 4009) || { echo "✗ All API ports 4000–4009 are in use. Free one and retry."; exit 1; }
UI_PORT=$(find_port 5173 5182)  || { echo "✗ All UI ports 5173–5182 are in use. Free one and retry."; exit 1; }

export PORT="$API_PORT"
export VITE_API_PORT="$API_PORT"
export VITE_UI_PORT="$UI_PORT"

# Start API server
bun run "$ROOT/src/api/server.ts" &
API_PID=$!

# Start UI dev server
(cd "$ROOT/ui" && bun run dev) &
UI_PID=$!

# Clean shutdown on Ctrl-C
cleanup() {
  echo ""
  echo "→ Shutting down..."
  kill "$API_PID" "$UI_PID" 2>/dev/null || true
  # Give processes 3s to exit gracefully before SIGKILL
  local deadline=$((SECONDS + 3))
  while kill -0 "$API_PID" 2>/dev/null || kill -0 "$UI_PID" 2>/dev/null; do
    [ "$SECONDS" -ge "$deadline" ] && { kill -9 "$API_PID" "$UI_PID" 2>/dev/null || true; break; }
    sleep 0.1
  done
  exit 0
}
trap cleanup INT TERM

# Wait for processes to start then print info
sleep 1.5

API_NOTE=""; [ "$API_PORT" != "4000" ] && API_NOTE="  (4000 in use)"
UI_NOTE="";  [ "$UI_PORT"  != "5173" ] && UI_NOTE="  (5173 in use)"

echo ""
echo "  ─────────────────────────────────────────"
echo "    Local SDLC — Dev Stack"
echo "    API  →  http://localhost:${API_PORT}${API_NOTE}"
echo "    UI   →  http://localhost:${UI_PORT}${UI_NOTE}"
echo "    MCP  →  stdio  (bun run src/index.ts)"
echo "  ─────────────────────────────────────────"
echo ""

# Health check
if curl -sf "http://localhost:${API_PORT}/api/health" >/dev/null 2>&1; then
  echo "  ✓ API health check passed"
else
  echo "  ⚠ API health check pending (still starting up)"
fi
echo ""

wait
