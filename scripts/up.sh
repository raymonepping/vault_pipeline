#!/usr/bin/env bash
# scripts/up.sh (make up): the daily start after make down or a reboot. Each
# step waits on state: the VM clock, vault-s (unsealed with its saved key),
# the cluster (auto-unseal), identity, data, then the workloads and the
# console, each with a freshly delivered secret zero (D9).
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VPIP_ROOT"
t0=$(date +%s)
./scripts/clock-sync.sh
./scripts/network.sh
./scripts/vault-up.sh
./scripts/identity-up.sh >/dev/null
./scripts/data-up.sh
./scripts/pipeline-up.sh
./scripts/app-up.sh
info "up: the lab is up in $(($(date +%s) - t0)) s; open https://localhost:$(vpip_conf VPIP_PORT_WEB)/"
