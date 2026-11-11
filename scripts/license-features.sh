#!/usr/bin/env bash
# scripts/license-features.sh: which licensed features this lab needs, and
# whether the cluster's autoloaded licence has them. Read-only. Prints feature
# names and the expiry date, never the licence itself. Prompt 03 (P1) records
# which features gate the SPIFFE engine and Transit data keys.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"

vault_cluster
vault_token ansible-platform
status=$(vault read -format=json sys/license/status)
version=$(vault_json | jq -r .version)
unset VAULT_TOKEN
features=$(jq -r '.data.autoloaded.features[]' <<<"$status")

echo "cluster licence: expires $(jq -r '.data.autoloaded.expiration_time' <<<"$status" | cut -c1-10), Vault $version"
case "$version" in *+ent*) ;; *)
  echo "  NOT Enterprise: the SPIFFE engine and Transit envelope encryption need it." >&2
  exit 1
  ;;
esac
echo "  The SPIFFE secrets engine and Transit datakeys are Enterprise features;"
echo "  docs/capabilities.md (P1) says whether a licence feature gates them."
echo
echo "Feature names in the licence:"
sed 's/^/  - /' <<<"$features"
