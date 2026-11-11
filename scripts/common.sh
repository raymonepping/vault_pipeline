#!/usr/bin/env bash
# scripts/common.sh: shared, host-side helpers. Source, do not execute.
#
# Host tooling talks to the Vault nodes on their published loopback ports and
# verifies TLS against the lab CA; nothing here uses -tls-skip-verify.
# No helper here uses a root token: after bootstrap there is none (D6).
set -euo pipefail
umask 077
VPIP_ROOT=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
VPIP_STATE="$VPIP_ROOT/.secrets/vault"
# shellcheck disable=SC2034  # used by the scripts that source this file
BUILD_DIR="$VPIP_ROOT/.build"
export VAULT_CACERT="$VPIP_ROOT/vault-tls/ca-chain.pem"
unset VAULT_SKIP_VERIFY VAULT_NAMESPACE VAULT_TOKEN VAULT_TLS_SERVER_NAME
export VAULT_CONFIG_PATH="$VPIP_ROOT/scripts/vault-cli.hcl"

VPIP_CLUSTER_NODES="vault-1 vault-2 vault-3"

# Effective config value: .env overrides config/defaults.conf.
vpip_conf() {
  local name=$1 v=""
  [ -f "$VPIP_ROOT/.env" ] && v=$(grep -E "^${name}=" "$VPIP_ROOT/.env" | tail -1 | cut -d= -f2- || true)
  [ -n "$v" ] || v=$(grep -E "^${name}=" "$VPIP_ROOT/config/defaults.conf" | tail -1 | cut -d= -f2- || true)
  printf '%s' "$v"
}

# Cluster a node belongs to: "seal" (vault-s) or "vault" (vault-1..3).
vault_cluster_of() {
  case "$1" in
  vault-s) echo seal ;;
  vault-1 | vault-2 | vault-3) echo vault ;;
  *)
    echo "Unknown Vault node: $1" >&2
    return 1
    ;;
  esac
}

# Container names keep one dash, after the prefix; the service's own dashes
# become underscores (vault-1 -> vpip-vault_1) so Podman tools show the whole
# name. Hostnames (DNS, TLS, retry_join) stay vault-1.
vault_container() { printf 'vpip-%s' "${1//-/_}"; }

vault_port_of() {
  case "$1" in
  vault-s) vpip_conf VPIP_PORT_VAULT_S ;;
  vault-1) vpip_conf VPIP_PORT_VAULT_1 ;;
  vault-2) vpip_conf VPIP_PORT_VAULT_2 ;;
  vault-3) vpip_conf VPIP_PORT_VAULT_3 ;;
  *)
    echo "Unknown Vault node: $1" >&2
    return 1
    ;;
  esac
}

# Point VAULT_ADDR at one node's published port.
vault_node() {
  local port
  port=$(vault_port_of "$1")
  VAULT_ADDR="https://127.0.0.1:$port"
  export VAULT_ADDR
}

# Point VAULT_ADDR at the cluster: the first node that answers unsealed.
# Standbys forward requests to the active node, so any unsealed node works.
vault_cluster() {
  local n
  for n in $VPIP_CLUSTER_NODES; do
    vault_node "$n"
    if vault_json 2>/dev/null | jq -e '.initialized and (.sealed | not)' >/dev/null 2>&1; then
      return 0
    fi
  done
  vault_node vault-1
}

# Point VAULT_ADDR at the active node (writes that must not be forwarded,
# reading which node logged what).
vault_active() {
  local n
  for n in $VPIP_CLUSTER_NODES; do
    vault_node "$n"
    if curl -sf --cacert "$VAULT_CACERT" "$VAULT_ADDR/v1/sys/leader" | jq -e '.is_self' >/dev/null 2>&1; then
      return 0
    fi
  done
  echo "No active node in vault-1..3." >&2
  return 1
}

# `vault status` exits 2 when sealed; that is still a valid answer.
vault_json() {
  local code=0
  vault status -format=json || code=$?
  [ "$code" -eq 0 ] || [ "$code" -eq 2 ]
}

# vault_wait reachable|unsealed|active [attempts]
vault_wait() {
  local mode=$1 max=${2:-60} attempt state
  for ((attempt = 0; attempt < max; attempt++)); do
    if state=$(vault_json 2>/dev/null); then
      case "$mode" in
      reachable) return 0 ;;
      unsealed) jq -e '.initialized and (.sealed | not)' <<<"$state" >/dev/null && return 0 ;;
      active) jq -e '.initialized and (.sealed | not)' <<<"$state" >/dev/null &&
        curl -sf --cacert "$VAULT_CACERT" "$VAULT_ADDR/v1/sys/leader" | jq -e '.is_self' >/dev/null && return 0 ;;
      esac
    fi
    sleep 2
  done
  echo "Timed out waiting for $VAULT_ADDR ($mode)." >&2
  return 1
}

# Read one field from .secrets/vault/<cluster>-init.json.
vault_init_field() {
  jq -er "$2" "$VPIP_STATE/$1-init.json"
}

# Export a scoped token (D7): tf-seal, ansible-seal, tf-platform, ansible-platform
# (and probe, during prompt 03 only).
vault_token() {
  local file="$VPIP_STATE/tokens/$1"
  [ -s "$file" ] || {
    echo "Scoped token '$1' not found at ${file#"$VPIP_ROOT"/}. Run make lab (phases seal-init and bootstrap mint them)." >&2
    return 1
  }
  VAULT_TOKEN=$(cat "$file")
  export VAULT_TOKEN
  # Periodic tokens live as long as they are used: renew on every use (best
  # effort; it fails harmlessly when VAULT_ADDR points at the other cluster).
  vault token renew >/dev/null 2>&1 || true
}

# The first 8 hex characters of SHA-256: how this lab shows a secret.
fingerprint() {
  printf '%s' "$1" | shasum -a 256 | cut -c1-8
}

vpip_container_state() {
  podman container inspect "$1" --format '{{.State.Status}}' 2>/dev/null || echo "not created"
}

info() { printf '\033[32m%s\033[0m\n' "$*" >&2; }
die() {
  printf '\033[31m%s\033[0m\n' "$*" >&2
  exit 1
}

# phases [tool]: scripts/phases.txt without comments, "<tool> <name>" per line
# (or only the names of one tool). The only phase list (golden_ticket).
phases() {
  local want="${1:-}" tool name _rest
  while read -r tool name _rest; do
    [[ -z "$tool" || "$tool" == \#* ]] && continue
    [[ "$_rest" == *"# pending"* ]] && continue
    if [[ -z "$want" ]]; then printf '%s %s\n' "$tool" "$name"
    elif [[ "$tool" == "$want" ]]; then printf '%s\n' "$name"; fi
  done <"$VPIP_ROOT/scripts/phases.txt"
}

# person_tokens <user>: a person's Keycloak tokens (JSON) by direct grant on
# the lab-only client pipeline-e2e. The password goes to curl on stdin, never
# on its command line. Capture it in a variable; never print it.
person_tokens() {
  local kc
  kc="http://127.0.0.1:$(vpip_conf VPIP_PORT_KEYCLOAK)/realms/pipeline/protocol/openid-connect/token"
  tr -d '\n' <"$VPIP_ROOT/.secrets/identity/users/$1" | curl -sf "$kc" -d grant_type=password \
    -d client_id=pipeline-e2e -d scope=openid --data-urlencode "username=$1" --data-urlencode "password@-"
}

# person_login <user>: Vault auth/jwt/login role person with that person's
# access token (D13); exports VAULT_TOKEN for this shell. Never printed.
person_login() {
  local at
  at=$(person_tokens "$1" | jq -er .access_token) || {
    echo "person_login: Keycloak refused $1" >&2
    return 1
  }
  VAULT_TOKEN=$(curl -sf --cacert "$VAULT_CACERT" "$VAULT_ADDR/v1/auth/jwt/login" \
    -d "$(jq -n --arg j "$at" '{role: "person", jwt: $j}')" | jq -er '.auth.client_token') || {
    echo "person_login: Vault refused $1's token" >&2
    return 1
  }
  export VAULT_TOKEN
}

# console_call <user> <METHOD> <path> [json]: the console API as that person
# (a Keycloak access token by direct grant on pipeline-e2e, sent as Bearer).
# Prints the response body (JSON or NDJSON); the token is never printed.
console_call() {
  local at
  at=$(person_tokens "$1" | jq -er .access_token) || { echo "console_call: Keycloak refused $1" >&2; return 1; }
  printf 'Authorization: Bearer %s\n' "$at" | curl -sS -N --cacert "$VAULT_CACERT" -X "$2" -H @- \
    ${4:+-H 'content-type: application/json' --data-binary "$4"} \
    "https://localhost:$(vpip_conf VPIP_PORT_API)$3"
}
