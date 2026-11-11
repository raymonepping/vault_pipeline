#!/usr/bin/env bash
# scripts/ansible.sh <playbook> [--check] [ansible-playbook args...]
# scripts/ansible.sh --version-check
#
# The only supported way to run Ansible here. Runs from the repo root with
# ansible.cfg. Ansible refuses non-blocking stdio (agent shells, some CI), so
# stdin comes from /dev/null and output goes through cat. Passes token file
# PATHS (vpip_tokens_dir), never a token, plus the non-secret lab settings in
# .build/ansible-vars.json. The vpip_stats callback writes the play recap
# counts to .build/ansible-stats/<playbook>[.check].json.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VPIP_ROOT"
export ANSIBLE_CONFIG="$VPIP_ROOT/ansible.cfg"

if [ "${1:-}" = --version-check ]; then
  v=$(ansible-playbook --version </dev/null 2>&1 | cat | head -1)
  echo "$v"
  [[ "$v" == *"core 2.2"[1-9]* ]] || die "ansible-core 2.21 or later is required"
  exit 0
fi

playbook=${1:?Usage: ansible.sh <playbook> [--check] [args]}
shift
playbook=${playbook%.yml}
[ -f "ansible/$playbook.yml" ] || die "ansible: unknown playbook ansible/$playbook.yml"

mkdir -p "$BUILD_DIR/ansible-stats"
jq -n \
  --arg root "$VPIP_ROOT" \
  --arg tokens "$VPIP_STATE/tokens" \
  --arg state "$VPIP_STATE" \
  --arg ca "$VAULT_CACERT" \
  --arg seal "https://127.0.0.1:$(vpip_conf VPIP_PORT_VAULT_S)" \
  --argjson nodes "$(for n in vault-1 vault-2 vault-3; do jq -n --arg n "$n" --arg a "https://127.0.0.1:$(vault_port_of "$n")" '{($n): $a}'; done | jq -s add)" \
  --arg keycloak "http://127.0.0.1:$(vpip_conf VPIP_PORT_KEYCLOAK)" \
  --arg web "https://localhost:$(vpip_conf VPIP_PORT_WEB)" \
  --argjson wrap_ttl "$(vpip_conf VPIP_WRAP_TTL)" \
  --argjson svid_ttl "$(vpip_conf VPIP_SVID_TTL)" \
  --argjson person_ttl "$(vpip_conf VPIP_PERSON_TTL)" \
  --arg trust_domain "$(vpip_conf VPIP_TRUST_DOMAIN)" \
  --arg subnet "$(vpip_conf VPIP_SUBNET)" \
  --arg embed_model "$(vpip_conf VPIP_EMBED_MODEL)" \
  --arg chat_model "$(vpip_conf VPIP_CHAT_MODEL)" \
  --arg embed_id "$(vpip_conf VPIP_EMBED_MODEL_ID)" \
  --arg chat_id "$(vpip_conf VPIP_CHAT_MODEL_ID)" \
  --argjson ips "$(for w in scribe keeper librarian console; do jq -n --arg w "$w" --arg a "$(vpip_conf "VPIP_IP_$(tr '[:lower:]' '[:upper:]' <<<"$w")")" '{($w): $a}'; done | jq -s add)" \
  --argjson session_idle "$(vpip_conf VPIP_SESSION_IDLE)" \
  --argjson session_max "$(vpip_conf VPIP_SESSION_MAX)" \
  '{vpip_root: $root, vpip_tokens_dir: $tokens, vpip_state_dir: $state, vpip_ca: $ca,
    vpip_seal_addr: $seal, vpip_node_addrs: $nodes, vpip_cluster_addr: $nodes["vault-1"],
    vpip_keycloak_addr: $keycloak, vpip_web_url: $web,
    vpip_wrap_ttl: $wrap_ttl, vpip_svid_ttl: $svid_ttl, vpip_person_ttl: $person_ttl,
    vpip_trust_domain: $trust_domain, vpip_subnet: $subnet, vpip_workload_ips: $ips,
    vpip_models: [{name: $embed_model, id: $embed_id}, {name: $chat_model, id: $chat_id}],
    vpip_session_idle: $session_idle, vpip_session_max: $session_max}' >"$BUILD_DIR/ansible-vars.json"

# A user-run make root-regen leaves a root token file; bootstrap phases may
# use it (never revoke it: make root-revoke does) to re-apply a policy change.
if [ -n "${VPIP_ROOT_FILE:-}" ]; then
  [ -s "$VPIP_ROOT_FILE" ] || die "VPIP_ROOT_FILE=$VPIP_ROOT_FILE is not a file"
  jq --arg f "$(cd "$(dirname "$VPIP_ROOT_FILE")" && pwd)/$(basename "$VPIP_ROOT_FILE")" '. + {vpip_root_file: $f}' \
    "$BUILD_DIR/ansible-vars.json" >"$BUILD_DIR/ansible-vars.json.tmp" && mv "$BUILD_DIR/ansible-vars.json.tmp" "$BUILD_DIR/ansible-vars.json"
fi

export VPIP_PHASE="$playbook" VPIP_STATS_DIR="$BUILD_DIR/ansible-stats"
set -o pipefail
ansible-playbook "ansible/$playbook.yml" -e "@$BUILD_DIR/ansible-vars.json" "$@" </dev/null 2>&1 | cat
