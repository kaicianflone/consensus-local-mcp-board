#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"

TITLE="${1:-}"
DESC="${2:-}"
INPUT="${3:-}"

if [[ -z "$TITLE" ]]; then
  echo "Usage: jobs_post.sh <title> [desc] [input]" >&2
  exit 2
fi

POLICY="${CONSENSUS_DEFAULT_POLICY:-HIGHEST_CONFIDENCE_SINGLE}"
REWARD="${CONSENSUS_DEFAULT_REWARD:-8}"
STAKE="${CONSENSUS_DEFAULT_STAKE:-4}"
LEASE_SECONDS="${CONSENSUS_DEFAULT_LEASE_SECONDS:-180}"
MODE="$(mode)"

if [[ "$MODE" == "local" ]]; then
  ensure_local_board
  local id; id="$(rand_id "job")"

  local title_json desc_json input_json
  title_json="$(json_escape "$TITLE")"
  desc_json="$(json_escape "${DESC:-}")"
  input_json="$(json_escape "${INPUT:-}")"

  local job_json
  job_json="$(cat <<JSON
{
  "id": "$id",
  "title": $title_json,
  "desc": $desc_json,
  "input": $input_json,
  "mode": "SUBMISSION",
  "policyKey": "$POLICY",
  "rewardAmount": $REWARD,
  "stakeAmount": $STAKE,
  "leaseSeconds": $LEASE_SECONDS,
  "status": "OPEN",
  "createdAt": "$(now_iso)"
}
JSON
)"
  write_json_file "$(job_file "$id")" "$job_json"
  ensure_job_dir "$id"
  echo "$job_json"
  exit 0
fi

# remote
base="$(remote_base)"
payload="$(cat <<JSON
{
  "title": "$TITLE",
  "desc": "${DESC:-}",
  "input": "${INPUT:-}",
  "mode": "SUBMISSION",
  "policyKey": "$POLICY",
  "rewardAmount": $REWARD,
  "stakeAmount": $STAKE,
  "leaseSeconds": $LEASE_SECONDS
}
JSON
)"
curl_json "POST" "$base/jobs" "$payload"
echo
