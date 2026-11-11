#!/usr/bin/env bash
# scripts/ask.sh <user> <question> (make ask): Act II from the terminal. The
# console logs that person in to Vault for this one question.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
q=${2:-What is Project Lighthouse?}
console_call "${1:?user}" POST /api/ask "$(jq -cn --arg q "$q" '{question: $q}')" | jq -rj '
  if .event == "token" then .text
  elif .event == "passages" then "found in \(.found | join(", ")); opened \(.opened | map(.doc_id) | unique | join(", "))\n"
  elif .event == "refused" then "Vault refused \(.doc_id) (\(.passages) passages): \(.vault_said)\n"
  elif .event == "done" then "\nsources: \(.sources | map("[\(.n)] \(.doc_id)") | join(" "))\n"
  elif .event == "error" then "ERROR \(.message)\n"
  else "\(.event) \(del(.event) | tostring)\n" end'
