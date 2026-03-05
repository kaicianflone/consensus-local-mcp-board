#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"

JOB_ID="${1:-}"
if [[ -z "$JOB_ID" ]]; then
  echo "Usage: votes_list.sh <jobId>" >&2
  exit 2
fi

MODE="$(mode)"

if [[ "$MODE" == "local" ]]; then
  ensure_local_board
  ensure_job_dir "$JOB_ID"
  ls -1 "$(job_dir "$JOB_ID")/votes"/*.json 2>/dev/null | xargs -I{} cat "{}" || true
  exit 0
fi

base="$(remote_base)"
curl -sS "$base/jobs/$JOB_ID/votes" -H "$(remote_auth_header)"
echo
