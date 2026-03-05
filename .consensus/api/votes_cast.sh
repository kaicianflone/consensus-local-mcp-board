#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"

JOB_ID="${1:-}"
TARGET_TYPE="${2:-}"   # SUBMISSION or CHOICE
TARGET_ID="${3:-}"     # submission id or choice key
WEIGHT="${4:-1}"

if [[ -z "$JOB_ID" || -z "$TARGET_TYPE" || -z "$TARGET_ID" ]]; then
  echo "Usage: votes_cast.sh <jobId> <targetType:SUBMISSION|CHOICE> <targetId> [weight]" >&2
  echo "Example: votes_cast.sh job_... SUBMISSION sub_... 1" >&2
  echo "Example: votes_cast.sh job_... CHOICE TOXIC_FALSE 1" >&2
  exit 2
fi

MODE="$(mode)"

if [[ "$MODE" == "local" ]]; then
  ensure_local_board
  ensure_job_dir "$JOB_ID"

  vid="$(rand_id "vote")"
  vote_json="$(cat <<JSON
{
  "id": "$vid",
  "jobId": "$JOB_ID",
  "targetType": "$TARGET_TYPE",
  "targetId": "$TARGET_ID",
  "weight": $WEIGHT,
  "createdAt": "$(now_iso)"
}
JSON
)"
  write_json_file "$(job_dir "$JOB_ID")/votes/${vid}.json" "$vote_json"
  echo "$vote_json"
  exit 0
fi

base="$(remote_base)"
payload="$(cat <<JSON
{
  "targetType": "$TARGET_TYPE",
  "targetId": "$TARGET_ID",
  "weight": $WEIGHT
}
JSON
)"
curl_json "POST" "$base/jobs/$JOB_ID/votes" "$payload"
echo
