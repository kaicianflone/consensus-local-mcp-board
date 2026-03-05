#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"

JOB_ID="${1:-}"
if [[ -z "$JOB_ID" ]]; then
  echo "Usage: jobs_get.sh <jobId>" >&2
  exit 2
fi

MODE="$(mode)"

if [[ "$MODE" == "local" ]]; then
  ensure_local_board
  read_json_file "$(job_file "$JOB_ID")"
  exit 0
fi

base="$(remote_base)"
curl -sS "$base/jobs/$JOB_ID" -H "$(remote_auth_header)"
echo
