#!/usr/bin/env bash
# scripts/pipeline-up.sh (make pipeline-up): deliver a fresh secret zero to
# the three workloads (D9), then recreate them so each opens its own, and
# wait until each is healthy. Builds the image if it is missing.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VPIP_ROOT"
img="$(vpip_conf VPIP_IMAGE_PREFIX)/worker:$(vpip_conf VPIP_IMAGE_TAG)"
podman image exists "$img" || ./scripts/app-build.sh worker
./scripts/ansible.sh deliver -e deliver_only=scribe,keeper,librarian >"$BUILD_DIR/logs/deliver-pipeline.log" 2>&1 ||
  { tail -20 "$BUILD_DIR/logs/deliver-pipeline.log" >&2; die "pipeline-up: deliver failed"; }
./scripts/compose.sh pipeline up -d --force-recreate >/dev/null
for w in keeper scribe librarian; do
  c="vpip-worker_$w"
  for _ in $(seq 1 45); do
    s=$(podman inspect "$c" --format '{{.State.Status}} {{.State.Health.Status}}' 2>/dev/null || echo gone)
    [[ "$s" == "running healthy" ]] && break
    [[ "$s" == exited* ]] && { podman logs --tail 5 "$c" >&2; die "pipeline-up: $c exited"; }
    sleep 2
  done
  [[ "$s" == "running healthy" ]] || { podman logs --tail 10 "$c" >&2; die "pipeline-up: $c is $s"; }
done
echo "pipeline-up: scribe, keeper and librarian healthy, each with its own secret zero"
