#!/usr/bin/env bash
# scripts/backup.sh: Raft snapshots of vault-s and the cluster, plus .secrets,
# into backups/<timestamp>/ (0700). Scoped tokens only: ansible-seal and
# ansible-platform hold sys/storage/raft/snapshot read (bootstrap policies).
set -euo pipefail
umask 077
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VPIP_ROOT"

dest="backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$dest"
chmod 700 backups "$dest"
vault_node vault-s
vault_token ansible-seal
vault operator raft snapshot save "$dest/vault-s.snap"
unset VAULT_TOKEN
vault_active
vault_token ansible-platform
vault operator raft snapshot save "$dest/cluster.snap"
unset VAULT_TOKEN
tar -C "$VPIP_ROOT" -czf "$dest/secrets.tgz" .secrets
echo "backup: $dest (vault-s.snap, cluster.snap, secrets.tgz)"
du -sh "$dest" | awk '{print "backup: " $1}'
