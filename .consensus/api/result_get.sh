#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"

JOB_ID="${1:-}"
if [[ -z "$JOB_ID" ]]; then
  echo "Usage: result_get.sh <jobId>" >&2
  exit 2
fi

MODE="$(mode)"

if [[ "$MODE" == "local" ]]; then
  ensure_local_board
  path="$(job_dir "$JOB_ID")/result.json"
  read_json_file "$path"
  exit 0
fi

base="$(remote_base)"
curl -sS "$base/jobs/$JOB_ID/result" -H "$(remote_auth_header)"
echo
