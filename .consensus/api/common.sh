#!/usr/bin/env bash
set -euo pipefail

# --------- helpers ----------
now_iso() { date -Iseconds; }

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env var: $name" >&2
    exit 2
  fi
}

mode() { echo "${CONSENSUS_MODE:-local}"; }

local_root() {
  require_env "CONSENSUS_ROOT"
  echo "$CONSENSUS_ROOT"
}

ensure_local_board() {
  local root; root="$(local_root)"
  mkdir -p "$root/jobs"
  [[ -f "$root/ledger.json" ]] || echo "[]" > "$root/ledger.json"
}

rand_id() {
  # readable ids; good enough for local / scripting
  echo "${1}_$(date +%s)_$RANDOM"
}

json_escape() {
  # Safely JSON-escape an arbitrary string.
  # Requires python3 (common on dev machines).
  python3 - <<'PY' "$1"
import json,sys
print(json.dumps(sys.argv[1]))
PY
}

# --------- remote request ----------
remote_base() {
  require_env "CONSENSUS_URL"
  require_env "CONSENSUS_BOARD_ID"
  echo "${CONSENSUS_URL%/}/v1/boards/${CONSENSUS_BOARD_ID}"
}

api_key_env() {
  echo "${CONSENSUS_API_KEY_ENV:-CONSENSUS_API_KEY}"
}

remote_auth_header() {
  local name; name="$(api_key_env)"
  require_env "$name"
  echo "Authorization: Bearer ${!name}"
}

curl_json() {
  # curl_json METHOD URL JSON_BODY
  local method="$1"
  local url="$2"
  local body="$3"

  curl -sS -X "$method" "$url" \
    -H "$(remote_auth_header)" \
    -H "Content-Type: application/json" \
    -d "$body"
}

# --------- local IO ----------
job_file() {
  local root; root="$(local_root)"
  echo "$root/jobs/${1}.json"
}

job_dir() {
  local root; root="$(local_root)"
  echo "$root/jobs/${1}"
}

ensure_job_dir() {
  local d; d="$(job_dir "$1")"
  mkdir -p "$d/submissions" "$d/votes"
}

write_json_file() {
  local path="$1"
  local contents="$2"
  mkdir -p "$(dirname "$path")"
  printf "%s\n" "$contents" > "$path"
}

read_json_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "Not found: $path" >&2
    exit 1
  fi
  cat "$path"
}
