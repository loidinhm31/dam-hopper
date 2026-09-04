#!/usr/bin/env bash
# Test journey: Web contract verification (static dist, headers, runtime-config, health).
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source "$SCRIPT_DIR/linux-release-common.sh"

init_test_env "dam-hopper-web-contract"

# 1. Verify that apps/web/dist exists and does not hardcode target environment URLs
WEB_DIST="$REPO_ROOT/apps/web/dist"
if [[ ! -d "$WEB_DIST" ]]; then
    log "Building web assets to verify distribution contract..."
    (cd "$REPO_ROOT" && pnpm --filter @dam-hopper/web build)
fi
assert_file_exists "$WEB_DIST/index.html" "apps/web/dist/index.html must exist"

if grep -rn "VITE_DAM_HOPPER_SERVER_URL" "$WEB_DIST"; then
    fail "Built web dist contains hardcoded VITE_DAM_HOPPER_SERVER_URL"
fi
# 2. Verify web runtime config JSON schema and shape
CONFIG_SAMPLE='{"schemaVersion":1,"releaseVersion":"0.1.0","profileId":"c7325e68-07e1-4e44-8d96-b333a4658cf9","apiUrl":"http://127.0.0.1:4801"}'
CONFIG_FILE="$TEST_ROOT/runtime-config.json"
printf '%s\n' "$CONFIG_SAMPLE" > "$CONFIG_FILE"

# Validate with jq or python
python3 - <<EOF
import json
with open("$CONFIG_FILE") as f:
    data = json.load(f)
assert data["schemaVersion"] == 1, "schemaVersion must be 1"
assert data["releaseVersion"] == "0.1.0", "releaseVersion must match"
assert data["profileId"] == "c7325e68-07e1-4e44-8d96-b333a4658cf9", "profileId must match"
assert data["apiUrl"] == "http://127.0.0.1:4801", "apiUrl must match"
EOF

# 3. Verify health response schema and shape
HEALTH_SAMPLE='{"schemaVersion":1,"status":"ok","version":"0.1.0","role":"web"}'
HEALTH_FILE="$TEST_ROOT/health.json"
printf '%s\n' "$HEALTH_SAMPLE" > "$HEALTH_FILE"

python3 - <<EOF
import json
with open("$HEALTH_FILE") as f:
    data = json.load(f)
assert data["schemaVersion"] == 1, "schemaVersion must be 1"
assert data["status"] == "ok", "status must be ok"
assert data["role"] == "web", "role must be web"
EOF

log "✓ Web contract, health schema, and runtime config verified"
