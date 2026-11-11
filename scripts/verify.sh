#!/usr/bin/env bash
# scripts/verify.sh (make verify): every check that needs the running lab:
# lint, unit tests, the boundary (tools, workloads, people), every Terraform
# plan empty, and the rehearsal.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VPIP_ROOT"
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
step lint && ./scripts/lint.sh
step "unit tests" && node --test scripts/*.test.js >/dev/null && ./scripts/unit-tests.sh
step boundary && ./scripts/boundary-check.sh
step "terraform plans" && make --no-print-directory tf-plan-all
step rehearsal && ./scripts/rehearsal.sh
info "verify: all green"
