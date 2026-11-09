#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PREFLIGHT_SCRIPT="$REPO_ROOT/deploy/release/preflight-release-draft.sh"

TEST_TMP="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP"' EXIT

MOCK_BIN="$TEST_TMP/bin"
mkdir -p "$MOCK_BIN"
MOCK_GH="$MOCK_BIN/gh"
export PATH="$MOCK_BIN:$PATH"

LOG_FILE="$TEST_TMP/gh-invocations.log"

run_scenario() {
  local scenario_name="$1"
  local mock_behavior="$2"
  local expected_exit="$3"
  local expected_output_pattern="$4"
  local should_have_deleted="$5"

  rm -f "$LOG_FILE"
  cat <<EOF > "$MOCK_GH"
#!/usr/bin/env bash
echo "\$@" >> "$LOG_FILE"
$mock_behavior
EOF
  chmod +x "$MOCK_GH"

  set +e
  OUTPUT=$(bash "$PREFLIGHT_SCRIPT" "v1.2.3" "test-org/test-repo" 2>&1)
  ACTUAL_EXIT=$?
  set -e

  if [ "$ACTUAL_EXIT" -ne "$expected_exit" ]; then
    echo "FAILED: $scenario_name: Expected exit code $expected_exit, got $ACTUAL_EXIT" >&2
    echo "Output: $OUTPUT" >&2
    exit 1
  fi

  if ! echo "$OUTPUT" | grep -Eq "$expected_output_pattern"; then
    echo "FAILED: $scenario_name: Output does not match pattern '$expected_output_pattern'" >&2
    echo "Output: $OUTPUT" >&2
    exit 1
  fi

  local deleted=false
  if [ -f "$LOG_FILE" ] && grep -Eq "api -X DELETE|release delete" "$LOG_FILE"; then
    deleted=true
  fi

  if [ "$should_have_deleted" = "true" ] && [ "$deleted" != "true" ]; then
    echo "FAILED: $scenario_name: Expected deletion command in gh invocations, but none found." >&2
    exit 1
  elif [ "$should_have_deleted" = "false" ] && [ "$deleted" = "true" ]; then
    echo "FAILED: $scenario_name: Expected NO deletion, but deletion command was recorded." >&2
    exit 1
  fi

  echo "✓ PASSED: $scenario_name"
}

echo "=== Running Preflight Release Draft Unit Tests ==="

# 1. Published release exists
run_scenario \
  "Published release exists (isDraft=false)" \
  'if [ "$1" = "release" ] && [ "$2" = "view" ]; then echo "{\"id\": 12345, \"isDraft\": false}"; exit 0; fi' \
  1 \
  "already published" \
  false

# 2. Draft release exists (isDraft=true)
run_scenario \
  "Draft release exists (isDraft=true) - deletes by ID" \
  'if [ "$1" = "release" ] && [ "$2" = "view" ]; then echo "{\"id\": 54321, \"isDraft\": true}"; exit 0; fi; if [ "$1" = "api" ] && [ "$2" = "-X" ] && [ "$3" = "DELETE" ]; then exit 0; fi' \
  0 \
  "Cleaning up stale draft release" \
  true

# 3. Release does not exist ("release not found")
run_scenario \
  "Release does not exist (HTTP 404 / release not found)" \
  'if [ "$1" = "release" ] && [ "$2" = "view" ]; then echo "release not found" >&2; exit 1; fi' \
  0 \
  "Confirmed release v1.2.3 does not exist yet" \
  false

# 4. Auth or network failure
run_scenario \
  "Auth failure / network error (fail-closed)" \
  'if [ "$1" = "release" ] && [ "$2" = "view" ]; then echo "HTTP 401: Bad credentials" >&2; exit 1; fi' \
  1 \
  "Failed to inspect release status" \
  false

# 5. Malformed response
run_scenario \
  "Malformed response (missing boolean isDraft)" \
  'if [ "$1" = "release" ] && [ "$2" = "view" ]; then echo "{\"unexpected\": \"data\"}"; exit 0; fi' \
  1 \
  "Unexpected isDraft value" \
  false

echo "=== All 5 preflight unit test scenarios passed successfully! ==="
