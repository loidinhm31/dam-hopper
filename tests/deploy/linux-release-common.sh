#!/usr/bin/env bash
# Shared test utilities and assertions for DamHopper Linux release deployment tests.
# Strict POSIX/Bash error handling and safe disposable directory isolation.
set -Eeuo pipefail

COMMON_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="${REPO_ROOT:-$(cd -- "$COMMON_SCRIPT_DIR/../.." && pwd -P)}"

TEST_ROOT=""
CLEANUP_CALLED=0

log() {
    printf '[test:%s] %s\n' "$(basename "${BASH_SOURCE[1]:-$0}" .sh)" "$*"
}

fail() {
    printf '[test:%s:FAIL] %s\n' "$(basename "${BASH_SOURCE[1]:-$0}" .sh)" "$*" >&2
    exit 1
}

assert_true() {
    local desc="$1"
    shift
    if ! "$@"; then
        fail "assertion failed ($desc): $*"
    fi
}

assert_eq() {
    local expected="$1"
    local actual="$2"
    local desc="${3:-values must match}"
    if [[ "$expected" != "$actual" ]]; then
        fail "$desc: expected '$expected', got '$actual'"
    fi
}

assert_file_exists() {
    local path="$1"
    local desc="${2:-file must exist}"
    if [[ ! -e "$path" ]]; then
        fail "$desc: '$path' does not exist"
    fi
}

assert_file_not_exists() {
    local path="$1"
    local desc="${2:-file must not exist}"
    if [[ -e "$path" ]]; then
        fail "$desc: '$path' exists but should not"
    fi
}

assert_file_mode() {
    local path="$1"
    local expected_mode="$2"
    local actual_mode
    actual_mode="$(stat -c '%a' "$path" 2>/dev/null || stat -f '%Lp' "$path")"
    if [[ "$actual_mode" != "$expected_mode" ]]; then
        fail "file mode mismatch on '$path': expected $expected_mode, got $actual_mode"
    fi
}

init_test_env() {
    local prefix="${1:-dam-hopper-deploy-test}"
    TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${prefix}.XXXXXX")"
    
    # Verify safety of directory before registering cleanup
    if [[ -z "$TEST_ROOT" || "$TEST_ROOT" == "/" || "$TEST_ROOT" == "/tmp" ]]; then
        printf 'Error: unsafe TEST_ROOT: %s\n' "$TEST_ROOT" >&2
        exit 1
    fi

    trap cleanup EXIT INT TERM
    log "Initialized isolated test environment at $TEST_ROOT"
}

cleanup() {
    if [[ $CLEANUP_CALLED -eq 1 ]]; then
        return 0
    fi
    CLEANUP_CALLED=1
    if [[ -n "$TEST_ROOT" && -d "$TEST_ROOT" ]]; then
        # Extra safety check before recursive delete
        case "$TEST_ROOT" in
            /tmp/*|/var/tmp/*|*/dam-hopper-*)
                rm -rf -- "$TEST_ROOT"
                ;;
            *)
                printf 'Warning: TEST_ROOT path unrecognized, skipping automatic rm: %s\n' "$TEST_ROOT" >&2
                ;;
        esac
    fi
}

# Create a mock release tarball and manifest for a given version tag.
create_mock_release_bundle() {
    local tag="$1"
    local out_dir="$2"
    local ver="${tag#v}"

    mkdir -p "$out_dir/staging/bin" "$out_dir/staging/systemd" "$out_dir/staging/sysusers.d" "$out_dir/staging/web"

    local manager_bin="$out_dir/staging/bin/dam-hopper-manager"
    local server_bin="$out_dir/staging/bin/dam-hopper-server"
    local web_bin="$out_dir/staging/bin/dam-hopper-web"

    printf '#!/bin/sh\necho manager %s\n' "$ver" > "$manager_bin"
    printf '#!/bin/sh\necho server %s\n' "$ver" > "$server_bin"
    printf '#!/bin/sh\necho web %s\n' "$ver" > "$web_bin"
    chmod 755 "$manager_bin" "$server_bin" "$web_bin"

    cp "$REPO_ROOT/deploy/systemd/dam-hopper-api.service.in" \
        "$out_dir/staging/systemd/dam-hopper-api.service"
    cp "$REPO_ROOT/deploy/systemd/dam-hopper-web.service.in" \
        "$out_dir/staging/systemd/dam-hopper-web.service"
    cp "$REPO_ROOT/deploy/systemd/dam-hopper-recovery.service.in" \
        "$out_dir/staging/systemd/dam-hopper-recovery.service"
    cp "$REPO_ROOT/deploy/sysusers.d/dam-hopper-web.conf" \
        "$out_dir/staging/sysusers.d/dam-hopper-web.conf"
    printf '<!doctype html><html><body>DamHopper %s</body></html>\n' "$ver" > "$out_dir/staging/web/index.html"
    printf 'MIT License\n' > "$out_dir/staging/LICENSE"
    chmod 644 "$out_dir/staging/systemd/"* "$out_dir/staging/sysusers.d/"* "$out_dir/staging/web/"* "$out_dir/staging/LICENSE"

    local archive_name="dam-hopper-${tag}-linux-x86_64-systemd.tar.gz"
    local archive_path="$out_dir/${archive_name}"

    tar --sort=name --mtime='@1700000000' --owner=0 --group=0 --numeric-owner \
        -czf "$archive_path" -C "$out_dir/staging" \
        bin systemd sysusers.d web LICENSE

    local archive_sha
    archive_sha="$(sha256sum "$archive_path" | awk '{print $1}')"
    local archive_size
    archive_size="$(stat -c '%s' "$archive_path" 2>/dev/null || stat -f '%z' "$archive_path")"

    # Compute entry SHA256s
    local mgr_sha srv_sha web_sha api_unit_sha web_unit_sha recovery_unit_sha sysusers_sha html_sha lic_sha
    mgr_sha="$(sha256sum "$manager_bin" | awk '{print $1}')"
    srv_sha="$(sha256sum "$server_bin" | awk '{print $1}')"
    web_sha="$(sha256sum "$web_bin" | awk '{print $1}')"
    api_unit_sha="$(sha256sum "$out_dir/staging/systemd/dam-hopper-api.service" | awk '{print $1}')"
    web_unit_sha="$(sha256sum "$out_dir/staging/systemd/dam-hopper-web.service" | awk '{print $1}')"
    recovery_unit_sha="$(sha256sum "$out_dir/staging/systemd/dam-hopper-recovery.service" | awk '{print $1}')"
    sysusers_sha="$(sha256sum "$out_dir/staging/sysusers.d/dam-hopper-web.conf" | awk '{print $1}')"
    html_sha="$(sha256sum "$out_dir/staging/web/index.html" | awk '{print $1}')"
    lic_sha="$(sha256sum "$out_dir/staging/LICENSE" | awk '{print $1}')"

    local manifest_path="$out_dir/release-manifest.json"
    cat > "$manifest_path" <<EOF
{
  "schemaVersion": 1,
  "release": {
    "tag": "$tag",
    "version": "$ver",
    "commitSha": "0123456789abcdef0123456789abcdef01234567"
  },
  "profile": {
    "id": "linux-x86_64-systemd",
    "osId": "linux",
    "osVersion": "any",
    "arch": "x86_64",
    "target": "x86_64-unknown-linux-gnu",
    "glibcMin": "2.39",
    "systemdMin": 245
  },
  "archive": {
    "name": "$archive_name",
    "size": $archive_size,
    "sha256": "$archive_sha"
  },
  "components": {
    "cli": { "version": "$ver" },
    "api": { "version": "$ver" },
    "webHost": { "version": "$ver" },
    "webAssets": { "version": "$ver" }
  },
  "inventory": [
    { "path": "bin/dam-hopper-manager", "kind": "file", "roles": ["common"], "mode": 493, "size": $(stat -c '%s' "$manager_bin"), "sha256": "$mgr_sha" },
    { "path": "bin/dam-hopper-server", "kind": "file", "roles": ["server"], "mode": 493, "size": $(stat -c '%s' "$server_bin"), "sha256": "$srv_sha" },
    { "path": "bin/dam-hopper-web", "kind": "file", "roles": ["web"], "mode": 493, "size": $(stat -c '%s' "$web_bin"), "sha256": "$web_sha" },
    { "path": "systemd/dam-hopper-api.service", "kind": "file", "roles": ["server"], "mode": 420, "size": $(stat -c '%s' "$out_dir/staging/systemd/dam-hopper-api.service"), "sha256": "$api_unit_sha" },
    { "path": "systemd/dam-hopper-recovery.service", "kind": "file", "roles": ["common"], "mode": 420, "size": $(stat -c '%s' "$out_dir/staging/systemd/dam-hopper-recovery.service"), "sha256": "$recovery_unit_sha" },
    { "path": "systemd/dam-hopper-web.service", "kind": "file", "roles": ["web"], "mode": 420, "size": $(stat -c '%s' "$out_dir/staging/systemd/dam-hopper-web.service"), "sha256": "$web_unit_sha" },
    { "path": "sysusers.d/dam-hopper-web.conf", "kind": "file", "roles": ["web"], "mode": 420, "size": $(stat -c '%s' "$out_dir/staging/sysusers.d/dam-hopper-web.conf"), "sha256": "$sysusers_sha" },
    { "path": "web", "kind": "dir", "roles": ["web"], "mode": 493 },
    { "path": "web/index.html", "kind": "file", "roles": ["web"], "mode": 420, "size": $(stat -c '%s' "$out_dir/staging/web/index.html"), "sha256": "$html_sha" },
    { "path": "LICENSE", "kind": "file", "roles": ["common"], "mode": 420, "size": $(stat -c '%s' "$out_dir/staging/LICENSE"), "sha256": "$lic_sha" }
  ],
  "services": {
    "api": {
      "unitName": "dam-hopper-api.service",
      "identity": "root",
      "bindHost": "0.0.0.0",
      "port": 4801,
      "healthPath": "/api/health"
    },
    "web": {
      "unitName": "dam-hopper-web.service",
      "identity": "dam-hopper-web",
      "bindHost": "0.0.0.0",
      "port": 4802,
      "healthPath": "/__dam-hopper/health"
    }
  },
  "rollback": {
    "previousReleaseCompatible": true,
    "stateCompatibility": "n-1"
  }
}
EOF

    # Copy bootstrap installer
    cp "$REPO_ROOT/deploy/release/dam-hopper-install.sh" "$out_dir/dam-hopper-install.sh"
    chmod 755 "$out_dir/dam-hopper-install.sh"

    # Dummy SBOM
    printf '{"spdxVersion":"SPDX-2.3","name":"dam-hopper","version":"%s"}\n' "$ver" > "$out_dir/dam-hopper-${tag}-linux-x86_64-systemd.spdx.json"

    rm -rf "$out_dir/staging"
    log "Generated valid mock bundle in $out_dir for $tag"
}
