#!/usr/bin/env bash
# scripts/show-ready.sh (make show-ready): before the talk. Clock, up, an empty
# story, the boundary, and the console's address.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VPIP_ROOT"
./scripts/up.sh
CONFIRM=yes ./scripts/story-reset.sh
./scripts/boundary-workloads.sh >/dev/null && echo "show-ready: every workload's boundary holds"
echo "show-ready: start at https://localhost:$(vpip_conf VPIP_PORT_WEB)/#/line, signed in as ada (make identity-copy-password U=ada)"
