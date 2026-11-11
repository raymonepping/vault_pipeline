#!/usr/bin/env bash
# scripts/clean-slate.sh: DESTRUCTIVE. Removes this lab's containers and
# volumes (vpip- only) and moves its Vault credentials, Terraform state, the
# identity, data and workload secrets aside to .secrets/legacy/<timestamp>/. Keeps
# the lab CA, the licence and the images. Type DELETE (or CONFIRM=DELETE).
# Back up first (make backup).
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VPIP_ROOT"

answer=${CONFIRM:-}
if [ "$answer" != DELETE ]; then
  printf 'This removes every vpip- container and volume (Vault data, audit logs, the realm) and moves credentials aside. Type DELETE: '
  read -r answer
fi
[ "$answer" = DELETE ] || {
  echo "Aborted."
  exit 1
}
for stack in app identity vault seal; do
  "$VPIP_ROOT/scripts/compose.sh" "$stack" down -v --remove-orphans 2>/dev/null || true
done
# Anything left with the prefix (one-shot containers, external volumes).
podman ps -a --filter name=^vpip- --format '{{.Names}}' | xargs -r podman rm -f >/dev/null
# The models volume is kept (1.3 GB to pull again, no story state in it):
# CLEAN_MODELS=1 removes it too.
podman volume ls -q --filter name=^vpip- | { if [ "${CLEAN_MODELS:-0}" = 1 ]; then cat; else grep -vx vpip-ollama_models || true; fi; } | xargs -r podman volume rm -f >/dev/null
podman network exists vpip-internal && podman network rm vpip-internal >/dev/null
legacy=".secrets/legacy/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$legacy"
for p in .secrets/vault/seal-init.json .secrets/vault/vault-init.json .secrets/vault/seal .secrets/vault/tokens \
  .secrets/terraform .secrets/identity .secrets/data .secrets/workloads; do
  [ -e "$p" ] && mv "$p" "$legacy/"
done
echo "clean-slate: containers, volumes and network removed; credentials moved to $legacy"
echo "clean-slate: start again with make lab"
