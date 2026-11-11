#!/usr/bin/env bash
# scripts/unit-tests.sh: the workloads' unit tests, and their results as
# .build/unit-tests.json (names and pass or fail), which the console's Act III
# page shows: the badge verifier's refusals are proven here.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VPIP_ROOT"
mkdir -p "$BUILD_DIR"
tap=$(node --test --test-reporter=tap pipeline/test/*.test.js 2>&1) && rc=0 || rc=$?
printf '%s\n' "$tap" | grep -E '^# (pass|fail)|^not ok' || true
printf '%s\n' "$tap" | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const tests = [...s.matchAll(/^(ok|not ok) \d+ - (.+)$/gm)].map((m) => ({ name: m[2].trim(), pass: m[1] === "ok" }));
  const file = (n) => (/(badge|audience|minute|signature|issuer|kid|SPIFFE)/i.test(n) ? "pipeline/test/svid.test.js" : /guest|ping/i.test(n) ? "pipeline/test/http.test.js" : "pipeline/test/envelope.test.js");
  console.log(JSON.stringify({ ran_at: new Date().toISOString(), node: process.version, passed: tests.filter((t) => t.pass).length, failed: tests.filter((t) => !t.pass).length, tests: tests.map((t) => ({ ...t, file: file(t.name) })) }, null, 1));
});' >"$BUILD_DIR/unit-tests.json"
chmod 644 "$BUILD_DIR/unit-tests.json"
exit "$rc"
