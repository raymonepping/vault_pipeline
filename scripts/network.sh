#!/bin/sh
# scripts/network.sh: create the shared network if it does not exist. The
# subnet is fixed because workload tokens are bound to their addresses (D9),
# and containers without a static address draw from the upper half only, so
# they can never take a workload's address.
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
subnet=$(grep -E '^VPIP_SUBNET=' "$root/.env" 2>/dev/null | tail -1 | cut -d= -f2-)
[ -n "$subnet" ] || subnet=$(grep -E '^VPIP_SUBNET=' "$root/config/defaults.conf" | tail -1 | cut -d= -f2-)
range=$(grep -E '^VPIP_IP_RANGE=' "$root/config/defaults.conf" | tail -1 | cut -d= -f2-)
if podman network exists vpip-internal; then
  have=$(podman network inspect vpip-internal --format '{{range .Subnets}}{{.Subnet}} {{.LeaseRange.StartIP}}{{end}}')
  want="$subnet $(echo "$range" | sed -E 's#\.128/25$#.129#')"  # the first lease after the range's network address
  [ "$have" = "$want" ] || { echo "vpip-internal is '$have', expected '$want': recreate it (make down, podman network rm vpip-internal)." >&2; exit 1; }
else
  podman network create --label io.vpip.project=vault_pipeline --subnet "$subnet" --ip-range "$range" vpip-internal >/dev/null
fi
