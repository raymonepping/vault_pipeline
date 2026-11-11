#!/usr/bin/env bash
# scripts/data-up.sh (make data-up): Postgres (pgvector) and Ollama, then wait
# until both answer. The models volume is created here (labelled as data) so
# compose can use it as external; Ansible models fills it.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VPIP_ROOT"
./scripts/data-secrets.sh
./scripts/network.sh
podman volume exists vpip-ollama_models || podman volume create --label io.vpip.data=true vpip-ollama_models >/dev/null
./scripts/compose.sh data up -d >/dev/null
for svc in postgres ollama; do
  for _ in $(seq 1 60); do
    [ "$(podman inspect "vpip-$svc" --format '{{.State.Health.Status}}' 2>/dev/null)" = healthy ] && break
    sleep 2
  done
  [ "$(podman inspect "vpip-$svc" --format '{{.State.Health.Status}}')" = healthy ] || die "data-up: vpip-$svc is not healthy (podman logs vpip-$svc)"
done
echo "data-up: postgres and ollama healthy (nothing published on the host)"
