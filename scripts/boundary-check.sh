#!/usr/bin/env bash
# scripts/boundary-check.sh (make boundary): prove the Terraform/Ansible
# boundary Vault enforces (golden_ticket's format). Each scoped token asks
# sys/capabilities-self what it may do on paths it must and must not touch.
# Never prints a token. Rows: token|vault|path|allow:cap or deny:cap.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"

checks=(
  # vault-s (prompt 02)
  "tf-seal|seal|sys/mounts/transit|allow:create"
  "tf-seal|seal|auth/token/roles/autounseal|allow:update"
  "tf-seal|seal|sys/audit/file|allow:sudo"
  "tf-seal|seal|auth/token/create/autounseal|deny:update"
  "tf-seal|seal|sys/policies/acl/vpip-tf-seal|deny:update"
  "ansible-seal|seal|auth/token/create/autounseal|allow:update"
  "ansible-seal|seal|auth/token/roles/autounseal|deny:update"
  "ansible-seal|seal|sys/policies/acl/autounseal|deny:update"
  "ansible-seal|seal|sys/mounts/transit|deny:create"
  "ansible-seal|seal|sys/policies/acl/vpip-ansible-seal|deny:update"
  # the cluster: the tools (prompt 02)
  "tf-platform|vault|sys/mounts/spiffe|allow:create"
  "tf-platform|vault|spiffe/role/scribe|allow:update"
  "tf-platform|vault|sys/policies/acl/vpip-wl-scribe|allow:update"
  "tf-platform|vault|database/config/pipeline|allow:update"
  "tf-platform|vault|transit/keys/board|deny:create"
  "tf-platform|vault|transit/keys/board/datakeys|deny:update"
  "tf-platform|vault|transit/decrypt/board|deny:update"
  "tf-platform|vault|spiffe/role/scribe/mintjwt|deny:update"
  "tf-platform|vault|database/creds/keeper|deny:read"
  "tf-platform|vault|auth/approle/role/vpip-scribe/secret-id|deny:update"
  "tf-platform|vault|sys/policies/acl/vpip-tf-platform|deny:update"
  "ansible-platform|vault|transit/keys/board|allow:create"
  "ansible-platform|vault|database/rotate-root/pipeline|allow:update"
  "ansible-platform|vault|auth/approle/role/vpip-scribe/secret-id|allow:update"
  "ansible-platform|vault|transit/keys/board/datakeys|deny:update"
  "ansible-platform|vault|transit/decrypt/board|deny:update"
  "ansible-platform|vault|transit/rewrap/board|deny:update"
  "ansible-platform|vault|spiffe/role/scribe/mintjwt|deny:update"
  "ansible-platform|vault|database/creds/keeper|deny:read"
  "ansible-platform|vault|sys/mounts/spiffe|deny:create"
  "ansible-platform|vault|sys/policies/acl/vpip-wl-scribe|deny:update"
  "ansible-platform|vault|sys/policies/acl/vpip-ansible-platform|deny:update"
)

fails=0
checked=0
skipped=0
for check in "${checks[@]}"; do
  IFS='|' read -r name cluster path expect <<<"$check"
  file="$VPIP_STATE/tokens/$name"
  if [ ! -s "$file" ]; then
    skipped=$((skipped + 1))
    continue
  fi
  if [ "$cluster" = seal ]; then vault_node vault-s; else vault_cluster; fi
  caps=$(curl -sS --cacert "$VAULT_CACERT" -H "X-Vault-Token: $(cat "$file")" \
    -X POST -d "{\"paths\":[\"$path\"]}" "$VAULT_ADDR/v1/sys/capabilities-self" |
    jq -r --arg p "$path" '(.data // .)[$p] // [] | join(",")')
  mode=${expect%%:*}
  cap=${expect#*:}
  has=no
  [[ ",$caps," == *",$cap,"* || ",$caps," == *",root,"* ]] && has=yes
  if { [ "$mode" = allow ] && [ "$has" = yes ]; } || { [ "$mode" = deny ] && [ "$has" = no ]; }; then
    printf '  \033[32mok\033[0m   %-17s %-5s %-6s %s\n' "$name" "$mode" "$cap" "$path"
  else
    printf '  \033[31mFAIL\033[0m %-17s %-5s %-6s %s (has: %s)\n' "$name" "$mode" "$cap" "$path" "${caps:-none}"
    fails=$((fails + 1))
  fi
  checked=$((checked + 1))
done
mkdir -p "$BUILD_DIR/gates"
jq -n --arg result "$([ "$fails" -eq 0 ] && echo pass || echo fail)" --argjson checked "$checked" \
  --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{gate: "boundary", result: $result, checks: $checked, at: $at}' >"$BUILD_DIR/gates/boundary.json"
[ "$fails" -eq 0 ] || die "$fails boundary check(s) failed."
[ "$checked" -gt 0 ] || die "no scoped token found: run make lab"
note=""
[ "$skipped" -eq 0 ] || note=", $skipped skipped: token not issued yet"
info "Token boundary holds ($checked checks$note)"
# The workloads and people, proven by their own tokens (prompt 07), once the
# console runs: the line view asks each workload's token.
if [ "$(vpip_container_state vpip-console)" = running ]; then
  "$VPIP_ROOT/scripts/boundary-workloads.sh"
else
  echo "  (workload and person checks skipped: the console is not running; make app-up)"
fi
