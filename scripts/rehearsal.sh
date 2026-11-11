#!/usr/bin/env bash
# scripts/rehearsal.sh (make rehearsal): the whole story through the console,
# unattended, each act with its positive and its negative check. Starts with a
# story reset (the stored documents are forgotten; the keys keep their
# versions and custody keeps its history). Results in .build/rehearsal.json.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VPIP_ROOT"
results=()
fails=0
check() { # id what expect-regex got
  local ok=false
  if [[ "$4" =~ $3 ]]; then ok=true; printf '  \033[32mok\033[0m   %-4s %s\n' "$1" "$2"
  else printf '  \033[31mFAIL\033[0m %-4s %s: want /%s/, got: %s\n' "$1" "$2" "$3" "${4:0:300}"; fails=$((fails + 1)); fi
  results+=("$(jq -cn --arg id "$1" --arg what "$2" --argjson ok "$ok" '{id: $id, what: $what, ok: $ok}')")
}
ask() { console_call "$1" POST /api/ask "$(jq -cn --arg q "$2" '{question: $q}')"; }
answer() { jq -rj 'select(.event == "token") | .text' <<<"$1"; }
t0=$(date +%s)

echo "Prologue: the line"
out=$(scripts/boundary-workloads.sh 2>&1 || true)
check P0 "every workload's powers from its own token, a person's host login refused" 'Workload boundary holds' "$out"

echo "Reset"
check R0 "the console forgets the stored documents" '"forgotten":[0-9]+' "$(console_call ada POST /api/acts/reset '{}')"

echo "I: Into the Pipe"
for c in handbook board; do
  out=$(console_call ada POST /api/acts/ingest "$(jq -cn --arg c "$c" '{collection: $c}')")
  check "I-$c" "$c sealed: three documents stored by the keeper" '^3$' "$(jq -s '[.[] | select(.event == "document" and .keeper.status == 200)] | length' <<<"$out")"
  printf '%s\n' "$out" | jq -r 'select(.event == "document") | .dek_fingerprint' >>"$BUILD_DIR/rehearsal-fps.tmp"
done
check I1 "six different data keys" '^6$' "$(sort -u "$BUILD_DIR/rehearsal-fps.tmp" | wc -l | tr -d ' ')"
rm -f "$BUILD_DIR/rehearsal-fps.tmp"
check I2 "a viewer cannot press ingest" 'not_an_operator' "$(console_call vera POST /api/acts/ingest '{"collection":"board"}')"
check I3 "frames refuse tampering, reordering, truncation (unit tests)" '"failed": 0' "$(cat "$BUILD_DIR/unit-tests.json")"

echo "II: The Librarian"
out=$(ask vera "What is Project Lighthouse?")
check II1 "vera on the board: Vault refuses the board documents" '"event":"refused".*permission denied' "$(tr -d '\n' <<<"$out")"
check II2 "vera on the board: no answer from other passages" 'Vault will not open for you' "$(answer "$out")"
check II3 "vera's token revoked after the answer" '"revoked":true' "$out"
check II4 "vera on the handbook: answered" '30' "$(answer "$(ask vera "How many days do I have to file a travel expense?")")"
check II5 "ada on the board: answered" 'Saltmere' "$(answer "$(ask ada "What is Project Lighthouse?")")"

echo "III: The Badge Check"
b=$(console_call vera GET /api/acts/badges)
check III1 "the keeper's store door admits the scribe only" '^scribe$' "$(jq -r '.guest_lists[] | select(.workload == "keeper") | .doors[] | select(.op == "store") | .guests | join(",")' <<<"$b")"
check III2 "the badge verifier's refusals pass their unit tests" '^0 [1-9]' "$(jq -r '"\(.unit_tests.failed) \([.unit_tests.tests[] | select(.file | test("svid"))] | length)"' <<<"$b")"

echo "IV: The Lost Backup"
out=$(console_call ada POST /api/acts/backup '{}')
check IV1 "the backup holds no text" '^0$' "$(jq -r 'select(.event == "backup") | .text_hits' <<<"$out")"
check IV2 "the console's own token may not decrypt" 'deny' "$(jq -r 'select(.event == "console_powers") | .capabilities | join(",")' <<<"$out")"
check IV3 "a person's token is bound to the console and the librarian" '10\.89\.230\.13.*10\.89\.230\.14' "$(jq -c 'select(.event == "binding") | .bound_cidrs' <<<"$out")"
vault_cluster
check IV4 "a person's login from the host is refused" 'refused' "$(person_login vera 2>&1 || true)"
check IV5 "rotate, rewrap: every board key moves up" '^3$' "$(jq -r 'select(.event == "rewrapped") | [.rewrapped[] | select(.to > .from)] | length' <<<"$out")"
check IV6 "the backup's old key is refused" 'too old' "$(jq -r 'select(.event == "old_key_checked") | .vault_said' <<<"$out")"
check IV7 "ada is still answered after the rotation" 'Saltmere' "$(answer "$(ask ada "What is Project Lighthouse?")")"

echo "Epilogue: the custody log"
c=$(console_call ada GET '/api/custody?doc=board-2026-10')
check E1 "board-2026-10: stored, searched, rewrapped" 'stored.*searched.*rewrapped|stored.*rewrapped.*searched' "$(jq -r '[.custody[].action] | join(" ")' <<<"$c")"

secs=$(($(date +%s) - t0))
printf '%s\n' "${results[@]}" | jq -s --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson s "$secs" '{at: $at, seconds: $s, passed: map(select(.ok)) | length, failed: map(select(.ok | not)) | length, checks: .}' >"$BUILD_DIR/rehearsal.json"
[ "$fails" -eq 0 ] || die "rehearsal: $fails check(s) failed ($secs s)"
info "rehearsal: ${#results[@]} checks passed in $secs s"
