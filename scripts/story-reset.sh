#!/usr/bin/env bash
# scripts/story-reset.sh (make story-reset): forget the stored documents so
# Act I starts empty. The collection keys keep their versions (a rotation
# cannot be undone, and Act IV rotates again from wherever it is), and the
# custody log keeps every row: the keeper's database role cannot delete one.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
if [ "${CONFIRM:-}" != yes ]; then
  printf 'Forget every stored document (custody and keys stay)? Type yes: '
  read -r a
  [ "$a" = yes ] || die "story-reset: nothing changed"
fi
console_call ada POST /api/acts/reset '{}' | jq -r '"story-reset: \(.forgotten) documents forgotten"'
