#!/usr/bin/env bash
# scripts/doctor.sh (make doctor): what is wrong, and the command that fixes
# it. Read-only. Never prints a secret.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VPIP_ROOT"
problems=0
fine() { printf '  \033[32mok\033[0m   %s\n' "$*"; }
fix() { printf '  \033[31mfix\033[0m  %s\n       -> %s\n' "$1" "$2"; problems=$((problems + 1)); }

echo "Host"
skew=$(( $(date +%s) - $(podman machine ssh date +%s 2>/dev/null | tr -d '\r' | tail -1 || date +%s) ))
[ "${skew#-}" -le 5 ] && fine "VM clock within ${skew#-} s" || fix "VM clock off by ${skew#-} s (SVIDs live 60 s)" "make clock-sync"
free=$(df -g / | awk 'NR==2 {print $4}')
[ "$free" -ge 8 ] && fine "Mac disk: $free GiB free" || fix "Mac disk: $free GiB free" "free space before make up (a full disk breaks the VM's overlay)"

echo "Containers"
for c in vpip-vault_s vpip-vault_1 vpip-vault_2 vpip-vault_3 vpip-openldap vpip-keycloak vpip-postgres vpip-ollama vpip-worker_scribe vpip-worker_keeper vpip-worker_librarian vpip-console vpip-web; do
  s=$(podman inspect "$c" --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>/dev/null || echo missing)
  case "$s" in
  "running healthy" | "running ") fine "$c" ;;
  "exited "*) case "$c" in vpip-worker_* | vpip-console) fix "$c exited (a workload cannot restart: its secret zero is spent)" "make pipeline-up (workers) or make app-up (console)" ;; *) fix "$c exited" "make up" ;; esac ;;
  missing) fix "$c does not exist" "make lab" ;;
  *) fix "$c is $s" "podman logs $c, then make up" ;;
  esac
done

echo "Vault"
vault_cluster
if st=$(vault_json 2>/dev/null) && jq -e '.initialized and (.sealed | not)' <<<"$st" >/dev/null; then fine "cluster unsealed ($(jq -r .version <<<"$st"))"; else fix "the cluster is sealed or down" "make up"; fi
if exp=$(vault_token ansible-platform 2>/dev/null && vault read -format=json sys/license/status 2>/dev/null | jq -r '.data.autoloaded.expiration_time'); then
  fine "licence expires ${exp:0:10}"
else fix "licence status unreadable" "make license-features"; fi
unset VAULT_TOKEN
./scripts/seal-token-status.sh >/dev/null 2>&1 && fine "seal tokens accepted by vault-s" || fix "a seal token is not accepted" "make seal-token-status, then make seal-token-rotate NODE=..."

echo "Data"
if podman exec vpip-ollama ollama list 2>/dev/null | grep -q "$(vpip_conf VPIP_CHAT_MODEL)"; then fine "models present"; else fix "a model is missing" "make models"; fi
db=$(podman exec vpip-worker_keeper node -e "fetch('https://localhost:8443/healthz').then(r=>r.json()).then(j=>console.log(j.db_user||''))" 2>/dev/null || true)
[ -n "$db" ] && fine "the keeper holds a database credential from Vault" || fix "the keeper has no database credential" "make pipeline-up"

echo
[ "$problems" -eq 0 ] && info "doctor: nothing to fix" || die "doctor: $problems thing(s) to fix"
