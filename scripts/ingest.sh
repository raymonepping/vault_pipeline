#!/usr/bin/env bash
# scripts/ingest.sh <collection> [user] (make ingest): Act I from the terminal,
# through the console as an operator (default ada).
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
console_call "${2:-ada}" POST /api/acts/ingest "$(jq -cn --arg c "${1:?collection}" '{collection: $c}')" |
  jq -rc 'if .event == "document" then "\(.doc_id): \(.chunks) frames, data key \(.dek_fingerprint), \(.edk_prefix), keeper \(.keeper.status)"
          elif .event == "error" then "ERROR \(.message)" else "\(.event) \(del(.event) | tostring)" end'
