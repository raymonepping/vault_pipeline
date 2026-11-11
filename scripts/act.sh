#!/usr/bin/env bash
# scripts/act.sh ingest|ask|badges|backup (make act-*): the terminal version of
# each act's button, through the console, as ada (an operator) unless AS= says
# otherwise. Prints what the console streams.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VPIP_ROOT"
who=${AS:-ada}
case "${1:?ingest|ask|badges|backup}" in
ingest) for c in handbook board; do ./scripts/ingest.sh "$c" "$who"; done ;;
ask)
  for u in vera ada; do echo "--- $u: What is Project Lighthouse?"; ./scripts/ask.sh "$u" "What is Project Lighthouse?"; done
  ;;
badges)
  console_call "$who" GET /api/acts/badges | jq -r '
    (.guest_lists[] | "\(.workload): " + ([.doors[] | "\(.op) <- \(.guests | join(","))"] | join("; "))),
    "unit tests: \(.unit_tests.passed) passed, \(.unit_tests.failed) failed (pipeline/test/svid.test.js proves the refusals)"'
  ;;
backup) console_call "$who" POST /api/acts/backup '{}' | jq -c . ;;
*) die "act: unknown act $1" ;;
esac
