#!/usr/bin/env bash
# scripts/app-up.sh [--recreate] (make app-up): the console. Builds missing
# images, delivers the console's secret zero (D9), recreates it so it opens
# that one, waits until both it and the web front are healthy.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VPIP_ROOT"
mkdir -p "$BUILD_DIR/logs"
prefix=$(vpip_conf VPIP_IMAGE_PREFIX)
tag=$(vpip_conf VPIP_IMAGE_TAG)
for t in worker web; do
  [ "$t" = web ] && [ ! -f web/Containerfile ] && continue
  podman image exists "$prefix/$t:$tag" || ./scripts/app-build.sh "$t"
done
./scripts/ansible.sh deliver -e deliver_only=console >"$BUILD_DIR/logs/deliver-console.log" 2>&1 ||
  { tail -20 "$BUILD_DIR/logs/deliver-console.log" >&2; die "app-up: deliver failed"; }
services=(console)
[ -f web/Containerfile ] && services+=(web)
./scripts/compose.sh app up -d --force-recreate "${services[@]}" >/dev/null
for c in vpip-console vpip-web; do
  [ "$c" = vpip-web ] && [ ! -f web/Containerfile ] && continue
  for _ in $(seq 1 45); do
    s=$(podman inspect "$c" --format '{{.State.Status}} {{.State.Health.Status}}' 2>/dev/null || echo gone)
    [[ "$s" == "running healthy" ]] && break
    [[ "$s" == exited* ]] && { podman logs --tail 5 "$c" >&2; die "app-up: $c exited"; }
    sleep 2
  done
  [[ "$s" == "running healthy" ]] || { podman logs --tail 10 "$c" >&2; die "app-up: $c is $s"; }
done
echo "app-up: console healthy (its own secret zero); open https://localhost:$(vpip_conf VPIP_PORT_WEB)/"
