#!/usr/bin/env bash
# scripts/identity-password.sh <user> (make identity-copy-password): put a
# person's password on the clipboard. Never printed.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
f="$VPIP_ROOT/.secrets/identity/users/${1:?user}"
[ -s "$f" ] || die "no password for $1 (make identity-up)"
tr -d '\n' <"$f" | pbcopy
echo "identity: $1's password is on the clipboard"
