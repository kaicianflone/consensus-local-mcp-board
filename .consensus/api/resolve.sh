#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"

JOB_ID="${1:-}"
if [[ -z "$JOB_ID" ]]; then
  echo "Usage: resolve.sh <jobId>" >&2
  exit 2
fi

MODE="$(mode)"

if [[ "$MODE" == "local" ]]; then
  ensure_local_board
  ensure_job_dir "$JOB_ID"

  # Local resolution policy: HIGHEST_CONFIDENCE_SINGLE for SUBMISSION jobs.
  # We pick the submission with max artifact.confidence if present.
  # If missing, we fall back to the most recent submission.

  dir="$(job_dir "$JOB_ID")/submissions"
  if ! ls "$dir"/*.json >/dev/null 2>&1; then
    echo "No submissions found for $JOB_ID" >&2
    exit 1
  fi

  python3 - <<'PY' "$JOB_ID" "$dir" | tee "$(job_dir "$JOB_ID")/result.json"
import json,glob,sys,os
job_id=sys.argv[1]; d=sys.argv[2]
subs=[]
for p in glob.glob(os.path.join(d,"*.json")):
    with open(p,"r") as f:
        s=json.load(f)
    conf=None
    try:
        conf=float(s.get("artifact",{}).get("confidence"))
    except Exception:
        conf=None
    subs.append((conf,s.get("createdAt",""),s,p))
# sort: confidence desc (None last), then createdAt desc
def key(t):
    conf,created,_,_ = t
    return (conf is not None, conf if conf is not None else -1.0, created)
subs_sorted=sorted(subs, key=key, reverse=True)
conf,created,s,p=subs_sorted[0]
result={
  "jobId": job_id,
  "mode": "SUBMISSION",
  "selectedSubmissionId": s.get("id"),
  "selectedSubmissionPath": p,
  "resolvedAt": __import__("datetime").datetime.utcnow().isoformat()+"Z",
  "artifact": s.get("artifact"),
  "summary": s.get("summary","")
}
print(json.dumps(result, indent=2))
PY

  exit 0
fi

base="$(remote_base)"
curl -sS -X POST "$base/jobs/$JOB_ID/resolve" -H "$(remote_auth_header)"
echo
