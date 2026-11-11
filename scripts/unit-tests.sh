#!/usr/bin/env bash
# scripts/unit-tests.sh: the workloads' unit tests, run file by file, and the
# results as .build/console/unit-tests.json (file, name, pass or fail), which
# the console's Act III page shows: the badge verifier's refusals are proven
# here. Only .build/console/ is mounted into the console.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VPIP_ROOT"
mkdir -p "$BUILD_DIR/console"
rc=0
all='[]'
for f in pipeline/test/*.test.js; do
  tap=$(node --test --test-reporter=tap "$f" 2>&1) || rc=1
  all=$(node -e '
    const [prev, file, tap] = process.argv.slice(1);
    const tests = [...tap.matchAll(/^(ok|not ok) \d+ - (.+)$/gm)].map((m) => ({ file, name: m[2].trim(), pass: m[1] === "ok" }));
    console.log(JSON.stringify([...JSON.parse(prev), ...tests]));' "$all" "$f" "$tap")
done
jq -n --argjson t "$all" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg node "$(node --version)" \
  '{ran_at: $at, node: $node, passed: ($t | map(select(.pass)) | length), failed: ($t | map(select(.pass | not)) | length), tests: $t}' \
  >"$BUILD_DIR/console/unit-tests.json"
chmod 644 "$BUILD_DIR/console/unit-tests.json"
jq -r '"# pass \(.passed)\n# fail \(.failed)"' "$BUILD_DIR/console/unit-tests.json"
jq -r '.tests[] | select(.pass | not) | "not ok \(.file): \(.name)"' "$BUILD_DIR/console/unit-tests.json"
exit "$rc"
