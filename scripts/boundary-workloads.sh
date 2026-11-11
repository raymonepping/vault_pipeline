#!/usr/bin/env bash
# scripts/boundary-workloads.sh (part of make boundary once the console runs):
# each workload's powers as its OWN token reports them (sys/capabilities-self,
# asked through the console's line view), and a person's Vault login from the
# host, which Vault must refuse: the person role is bound to the console's
# and the librarian's addresses (D13, probe P6). Prints names, never tokens.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VPIP_ROOT"
line=$(console_call ada GET /api/line) || die "boundary: the console does not answer (make app-up)"
checks=(
  "scribe|transit/datakeys/plaintext/board|allow"  "scribe|transit/decrypt/board|deny"  "scribe|transit/rewrap/board|deny"
  "scribe|database/creds/keeper|deny"  "scribe|spiffe/role/keeper/mintjwt|deny"
  "keeper|database/creds/keeper|allow"  "keeper|transit/rewrap/board|allow"  "keeper|transit/decrypt/board|deny"
  "keeper|transit/datakeys/plaintext/board|deny"  "keeper|spiffe/role/scribe/mintjwt|deny"
  "librarian|spiffe/role/librarian/mintjwt|allow"  "librarian|transit/decrypt/board|deny"  "librarian|transit/decrypt/handbook|deny"
  "librarian|database/creds/keeper|deny"
  "console|transit/keys/board/rotate|allow"  "console|transit/decrypt/board|deny"  "console|transit/datakeys/plaintext/board|deny"
  "console|database/creds/keeper|deny"  "console|spiffe/role/scribe/mintjwt|deny"
)
fails=0
for c in "${checks[@]}"; do
  IFS='|' read -r wl path want <<<"$c"
  caps=$(jq -r --arg w "$wl" --arg p "$path" '.workloads[] | select(.name == $w) | .powers[]? | select(.path == $p) | .capabilities | join(",")' <<<"$line")
  [ -n "$caps" ] || caps=missing
  has=deny
  [[ ",$caps," == *",update,"* || ",$caps," == *",read,"* ]] && has=allow
  if [ "$has" = "$want" ]; then printf '  \033[32mok\033[0m   %-10s %-5s %s\n' "$wl" "$want" "$path"
  else printf '  \033[31mFAIL\033[0m %-10s %-5s %s (has: %s)\n' "$wl" "$want" "$path" "$caps"; fails=$((fails + 1)); fi
done
vault_cluster
if out=$(person_login vera 2>&1); then
  printf '  \033[31mFAIL\033[0m person login from the host was accepted\n'; fails=$((fails + 1))
else printf '  \033[32mok\033[0m   person     deny  auth/jwt/login from the host (%s)\n' "${out#person_login: }"; fi
[ "$fails" -eq 0 ] || die "$fails workload boundary check(s) failed."
info "Workload boundary holds ($((${#checks[@]} + 1)) checks)"
