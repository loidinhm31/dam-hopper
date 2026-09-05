#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"

VERSION=""
TARGET_DIR=""
WEB_DIST=""
OUTPUT_DIR="${REPO_ROOT}/artifacts/package-twice"
SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-1700000000}"

usage() {
    cat <<'EOF'
Usage: linux-release-package-twice.sh --version <vX.Y.Z> [options]

Options:
  --version <tag>         Release tag (for example v0.1.0) [required]
  --target-dir <dir>      Directory containing dam-hopper binaries
  --web-dist <dir>        Built apps/web/dist directory
  --output-dir <dir>      Destination for the verified four release assets
  --source-date-epoch <n> Deterministic archive timestamp
EOF
    exit 2
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --) shift ;;
        --version) VERSION="${2:?missing value for --version}"; shift 2 ;;
        --target-dir) TARGET_DIR="${2:?missing value for --target-dir}"; shift 2 ;;
        --web-dist) WEB_DIST="${2:?missing value for --web-dist}"; shift 2 ;;
        --output-dir) OUTPUT_DIR="${2:?missing value for --output-dir}"; shift 2 ;;
        --source-date-epoch) SOURCE_DATE_EPOCH="${2:?missing value for --source-date-epoch}"; shift 2 ;;
        -h|--help) usage ;;
        *) printf 'Unknown argument: %s\n' "$1" >&2; usage ;;
    esac
done

if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf 'Error: --version must be a stable vMAJOR.MINOR.PATCH tag\n' >&2
    exit 1
fi

if [[ -z "$TARGET_DIR" ]]; then
    if [[ -d "$REPO_ROOT/server/target/x86_64-unknown-linux-gnu/release" ]]; then
        TARGET_DIR="$REPO_ROOT/server/target/x86_64-unknown-linux-gnu/release"
    else
        TARGET_DIR="$REPO_ROOT/server/target/release"
    fi
fi
WEB_DIST="${WEB_DIST:-$REPO_ROOT/apps/web/dist}"

for binary in dam-hopper dam-hopper-server dam-hopper-web; do
    if [[ ! -f "$TARGET_DIR/$binary" || ! -x "$TARGET_DIR/$binary" ]]; then
        printf 'Error: required executable is missing or not executable: %s/%s\n' "$TARGET_DIR" "$binary" >&2
        exit 1
    fi
done
if [[ ! -f "$WEB_DIST/index.html" ]]; then
    printf 'Error: web dist is missing index.html: %s\n' "$WEB_DIST" >&2
    exit 1
fi

TEST_ROOT="$(mktemp -d -t dam-hopper-package-twice-XXXXXXXX)"
chmod 0700 "$TEST_ROOT"
trap 'rm -rf -- "$TEST_ROOT"' EXIT

build_archive() {
    local run_dir="$1"
    bash "$REPO_ROOT/deploy/release/build-release-archive.sh" \
        --version "$VERSION" \
        --target-dir "$TARGET_DIR" \
        --web-dist "$WEB_DIST" \
        --output-dir "$run_dir" \
        --source-date-epoch "$SOURCE_DATE_EPOCH"
}

build_archive "$TEST_ROOT/run1"
build_archive "$TEST_ROOT/run2"
ARCHIVE_NAME="dam-hopper-${VERSION}-linux-x86_64-systemd.tar.gz"
ARCHIVE_ONE="$TEST_ROOT/run1/$ARCHIVE_NAME"
ARCHIVE_TWO="$TEST_ROOT/run2/$ARCHIVE_NAME"

DIGEST_ONE="$(sha256sum "$ARCHIVE_ONE" | awk '{print $1}')"
DIGEST_TWO="$(sha256sum "$ARCHIVE_TWO" | awk '{print $1}')"
if [[ "$DIGEST_ONE" != "$DIGEST_TWO" ]] || ! cmp -s "$ARCHIVE_ONE" "$ARCHIVE_TWO"; then
    printf 'Error: deterministic package mismatch (run1=%s run2=%s)\n' "$DIGEST_ONE" "$DIGEST_TWO" >&2
    exit 1
fi

COMMIT_SHA="${RELEASE_COMMIT:-$(git -C "$REPO_ROOT" rev-parse HEAD)}"
if [[ ! "$COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    printf 'Error: RELEASE_COMMIT must be a 40-character lowercase commit SHA\n' >&2
    exit 1
fi
FINAL_DIR="$TEST_ROOT/final"
mkdir -p "$FINAL_DIR"
cp -- "$ARCHIVE_ONE" "$FINAL_DIR/"
node "$REPO_ROOT/deploy/release/generate-release-manifest.mjs" \
    --archive "$FINAL_DIR/$ARCHIVE_NAME" \
    --tag "$VERSION" \
    --commit "$COMMIT_SHA" \
    --output-dir "$FINAL_DIR"
cp -- "$REPO_ROOT/deploy/release/dam-hopper-install.sh" "$FINAL_DIR/"
chmod 0755 "$FINAL_DIR/dam-hopper-install.sh"
node "$REPO_ROOT/deploy/release/check-release-assets.mjs" \
    --tag "$VERSION" \
    --dir "$FINAL_DIR"

mkdir -p "$OUTPUT_DIR"
cp -- "$FINAL_DIR"/* "$OUTPUT_DIR/"
printf 'Verified deterministic package twice: %s (sha256 %s)\n' "$ARCHIVE_NAME" "$DIGEST_ONE"
