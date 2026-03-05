#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"

JOB_ID="${1:-}"
ARTIFACT_JSON="${2:-}"
SUMMARY="${3:-}"

if [[ -z "$JOB_ID" || -z "$ARTIFACT_JSON" ]]; then
  echo "Usage: submissions_create.sh <jobId> <artifact_json> [summary]" >&2
  echo "Example: submissions_create.sh job_... {\"toxic\":false,\"confidence\":0.98,\"brief_reason\":\"...\"}" >&2
  exit 2
fi

MODE="$(mode)"

if [[ "$MODE" == "local" ]]; then
  ensure_local_board
  ensure_job_dir "$JOB_ID"

  sid="$(rand_id "sub")"
  summary_json="$(json_escape "${SUMMARY:-}")"
  sub_json="$(cat <<JSON
{
  "id": "$sid",
  "jobId": "$JOB_ID",
  "artifact": $ARTIFACT_JSON,
  "summary": $summary_json,
  "createdAt": "$(now_iso)",
  "status": "VALID"
}
JSON
)"
  write_json_file "$(job_dir "$JOB_ID")/submissions/${sid}.json" "$sub_json"
  echo "$sub_json"
  exit 0
fi

base="$(remote_base)"
payload="$(cat <<JSON
{
  "artifact": $ARTIFACT_JSON,
  "summary": "${SUMMARY:-}"
}
JSON
)"
curl_json "POST" "$base/jobs/$JOB_ID/submissions" "$payload"
echo
