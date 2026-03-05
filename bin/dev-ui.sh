#!/usr/bin/env bash
# dev-ui.sh — launcher for dev:ui with optional --verbose logging
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/.dev-logs"
VERBOSE=0
KILL_PORTS=0

for arg in "$@"; do
  case "$arg" in
    --verbose|-v) VERBOSE=1 ;;
    --kill-ports)  KILL_PORTS=1 ;;
  esac
done

# ── Kill stale processes on ports 4010/5000/5001 if requested ──
kill_ports() {
  local ports=(4010 5000 5001 5002 5003)
  for p in "${ports[@]}"; do
    local pids
    pids=$(lsof -ti:"$p" 2>/dev/null || true)
    if [[ -n "$pids" ]]; then
      echo "[dev-ui] killing pid(s) on port $p: $pids"
      echo "$pids" | xargs kill -9 2>/dev/null || true
    fi
  done
  sleep 1
}

# Always kill stale ports before starting (avoids EADDRINUSE)
kill_ports

# ── Ensure shared/dist exists ──
if [[ ! -f "$ROOT/shared/dist/index.js" ]]; then
  echo "[dev-ui] building shared package (dist missing)..."
  npm --prefix "$ROOT" --workspace shared run build
fi

if [[ "$VERBOSE" -eq 1 ]]; then
  mkdir -p "$LOG_DIR"
  TIMESTAMP=$(date +%Y%m%d-%H%M%S)
  LOGFILE="$LOG_DIR/dev-ui-$TIMESTAMP.log"
  echo "[dev-ui] verbose mode — logging to $LOGFILE"
  echo "=== dev:ui started at $(date) ===" > "$LOGFILE"

  # Run concurrently, tee combined output to both terminal and log file
  cd "$ROOT"
  VERBOSE=1 npx concurrently \
    --names "shared,server,web" \
    --prefix-colors "cyan,yellow,green" \
    --timestamp-format "HH:mm:ss" \
    --prefix "[{name}]" \
    "npm --workspace shared run build:watch" \
    "VERBOSE=1 npm --workspace server run dev" \
    "npm --workspace web run dev" \
    2>&1 | tee -a "$LOGFILE"
else
  cd "$ROOT"
  npx concurrently \
    --names "shared,server,web" \
    --prefix-colors "cyan,yellow,green" \
    --prefix "[{name}]" \
    "npm --workspace shared run build:watch" \
    "npm --workspace server run dev" \
    "npm --workspace web run dev"
fi
