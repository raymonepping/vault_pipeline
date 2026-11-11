#!/usr/bin/env bash
# scripts/probe-lib.sh: helpers for make probe. Source, do not execute.
# Tokens travel in a 0600 header file (curl -H @file), never on a command line.
# shellcheck source=scripts/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
PROBE_DIR="$BUILD_DIR/probe"
mkdir -p "$PROBE_DIR" && chmod 700 "$PROBE_DIR"
vault_cluster

# hdr <name> <token-file>: write a header file for that token.
hdr() { printf 'X-Vault-Token: %s\n' "$(cat "$2")" >"$PROBE_DIR/$1.hdr"; }
# hdr_value <name> <token>: the same for a token held in a variable.
hdr_value() { printf 'X-Vault-Token: %s\n' "$2" >"$PROBE_DIR/$1.hdr"; }

# vreq <hdr-name|-> <METHOD> <path> [json-body]: prints "<status> <body>".
vreq() {
  local h=$1 m=$2 p=$3 b=${4:-}
  local args=(-sS --cacert "$VAULT_CACERT" -X "$m" -w '\n%{http_code}')
  [ "$h" != - ] && args+=(-H "@$PROBE_DIR/$h.hdr")
  [ -n "$b" ] && args+=(-H 'Content-Type: application/json' --data-binary @-)
  local out
  out=$(printf '%s' "$b" | curl "${args[@]}" "$VAULT_ADDR/v1/$p")
  printf '%s %s\n' "$(tail -1 <<<"$out")" "$(sed '$d' <<<"$out")"
}
code() { cut -d' ' -f1 <<<"$1"; }
body() { cut -d' ' -f2- <<<"$1"; }

# jwt_claims <jwt>: header and claims, never the signature or the token.
jwt_claims() {
  node -e 'const [h,c]=process.argv[1].split(".");const d=(s)=>JSON.parse(Buffer.from(s,"base64url"));console.log(JSON.stringify({header:d(h),claims:d(c)}))' "$1"
}
