#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"

MODE="$(mode)"

if [[ "$MODE" == "local" ]]; then
  ensure_local_board
  root="$(local_root)"
  ls -1 "$root/jobs"/*.json 2>/dev/null | sed "s#.*/##" | sed "s#\.json$##" || true
  exit 0
fi

base="$(remote_base)"
# Optional: pass query string as $1, e.g. "status=OPEN&mode=SUBMISSION"
QS="${1:-}"
url="$base/jobs"
if [[ -n "$QS" ]]; then
  url="$url?$QS"
fi
curl -sS "$url" -H "$(remote_auth_header)"
echo
