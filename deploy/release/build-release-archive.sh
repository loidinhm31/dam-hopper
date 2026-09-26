#!/usr/bin/env bash
set -euo pipefail

# Deterministic single-archive packager for DamHopper Linux releases.
# Assembles dam-hopper-vX.Y.Z-fedora44-x86_64-systemd.tar.gz with normalized
# permissions, timestamps, file ordering, and GNU tar options.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

VERSION=""
TARGET_DIR=""
WEB_DIST=""
OUTPUT_DIR="${REPO_ROOT}/artifacts/release"
EPOCH="${SOURCE_DATE_EPOCH:-}"

usage() {
    cat <<EOF
Usage: $0 --version <vX.Y.Z|X.Y.Z> [options]

Options:
  --version <ver>         Release version tag (e.g. v0.1.0 or 0.1.0) [required]
  --target-dir <dir>      Directory containing built Rust binaries
  --web-dist <dir>        Directory containing built apps/web/dist
  --output-dir <dir>      Output directory for release archive (default: artifacts/release)
  --source-date-epoch <n> Deterministic Unix timestamp for file mtimes
  -h, --help              Show this help message
EOF
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --version)
            VERSION="$2"
            shift 2
            ;;
        --target-dir)
            TARGET_DIR="$2"
            shift 2
            ;;
        --web-dist)
            WEB_DIST="$2"
            shift 2
            ;;
        --output-dir)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --source-date-epoch)
            EPOCH="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Error: Unknown argument '$1'" >&2
            usage
            ;;
    esac
done

if [[ -z "${VERSION}" ]]; then
    echo "Error: --version is required" >&2
    usage
fi

# Normalize tag and version
if [[ "${VERSION}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    TAG="${VERSION}"
    SEMVER="${VERSION#v}"
elif [[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    TAG="v${VERSION}"
    SEMVER="${VERSION}"
else
    echo "Error: Version '${VERSION}' must follow SemVer format (e.g. v0.1.0 or 0.1.0)" >&2
    exit 1
fi

# Auto-locate target dir if omitted
if [[ -z "${TARGET_DIR}" ]]; then
    if [[ -d "${REPO_ROOT}/server/target/x86_64-unknown-linux-gnu/release" ]]; then
        TARGET_DIR="${REPO_ROOT}/server/target/x86_64-unknown-linux-gnu/release"
    elif [[ -d "${REPO_ROOT}/server/target/release" ]]; then
        TARGET_DIR="${REPO_ROOT}/server/target/release"
    else
        echo "Error: Could not locate built release binaries. Pass --target-dir." >&2
        exit 1
    fi
fi

# Auto-locate web dist if omitted
if [[ -z "${WEB_DIST}" ]]; then
    WEB_DIST="${REPO_ROOT}/apps/web/dist"
fi

# Determine deterministic timestamp
if [[ -z "${EPOCH}" ]]; then
    if git -C "${REPO_ROOT}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        EPOCH="$(git -C "${REPO_ROOT}" log -1 --pretty=%ct 2>/dev/null || echo 1700000000)"
    else
        EPOCH="1700000000"
    fi
fi

# Validate prerequisites
MGR_BIN=""
if [[ -f "${TARGET_DIR}/dam-hopper" ]]; then
    MGR_BIN="${TARGET_DIR}/dam-hopper"
elif [[ -f "${TARGET_DIR}/dam-hopper-manager" ]]; then
    MGR_BIN="${TARGET_DIR}/dam-hopper-manager"
else
    echo "Error: Neither 'dam-hopper' nor 'dam-hopper-manager' binary found in '${TARGET_DIR}'" >&2
    exit 1
fi

SERVER_BIN="${TARGET_DIR}/dam-hopper-server"
if [[ ! -f "${SERVER_BIN}" ]]; then
    echo "Error: 'dam-hopper-server' binary not found in '${TARGET_DIR}'" >&2
    exit 1
fi

HELPER_BIN="${TARGET_DIR}/dam-hopper-idle-suspend-helper"
if [[ ! -f "${HELPER_BIN}" ]]; then
    echo "Error: 'dam-hopper-idle-suspend-helper' binary not found in '${TARGET_DIR}'" >&2
    exit 1
fi

WEB_BIN="${TARGET_DIR}/dam-hopper-web"
if [[ ! -f "${WEB_BIN}" ]]; then
    echo "Error: 'dam-hopper-web' binary not found in '${TARGET_DIR}'" >&2
    exit 1
fi
RUNNER_BIN="${TARGET_DIR}/dam-hopper-plugin-runner"
if [[ ! -f "${RUNNER_BIN}" ]]; then
    echo "Error: 'dam-hopper-plugin-runner' binary not found in '${TARGET_DIR}'" >&2
    exit 1
fi

# Ship the worker runtime; service accounts must not depend on an operator's PATH.
NODE_BIN="${NODE_BIN:-$(command -v node)}"
NODE_BIN="$(readlink -f "${NODE_BIN}")"
NODE_LICENSE="${NODE_LICENSE:-$(dirname "$(dirname "${NODE_BIN}")")/LICENSE}"
if [[ ! -x "${NODE_BIN}" || ! -f "${NODE_LICENSE}" ]]; then
    echo "Error: Node distribution executable and LICENSE are required (NODE_BIN/NODE_LICENSE)" >&2
    exit 1
fi
"${NODE_BIN}" -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (process.platform !== "linux" || process.arch !== "x64" || major < 22 || (major === 22 && minor < 19)) process.exit(1)'


if [[ ! -d "${WEB_DIST}" || ! -f "${WEB_DIST}/index.html" ]]; then
    echo "Error: Web dist directory '${WEB_DIST}' does not exist or lacks index.html" >&2
    exit 1
fi

API_SERVICE_IN="${REPO_ROOT}/deploy/systemd/dam-hopper-api.service.in"
WEB_SERVICE_IN="${REPO_ROOT}/deploy/systemd/dam-hopper-web.service.in"
RECOVERY_SERVICE_IN="${REPO_ROOT}/deploy/systemd/dam-hopper-recovery.service.in"
SYSUSERS_CONF="${REPO_ROOT}/deploy/sysusers.d/dam-hopper-web.conf"
LICENSE_FILE="${REPO_ROOT}/LICENSE"
HELPER_SERVICE_IN="${REPO_ROOT}/deploy/systemd/dam-hopper-idle-suspend-helper.service.in"
RUNNER_SERVICE_IN="${REPO_ROOT}/deploy/systemd/dam-hopper-plugin-runner.service.in"
RUNNER_TMPFILES_IN="${REPO_ROOT}/deploy/tmpfiles.d/dam-hopper-plugin-runner.conf.in"

for req_file in "${API_SERVICE_IN}" "${WEB_SERVICE_IN}" "${RECOVERY_SERVICE_IN}" \
    "${HELPER_SERVICE_IN}" "${RUNNER_SERVICE_IN}" "${RUNNER_TMPFILES_IN}" \
    "${SYSUSERS_CONF}" "${LICENSE_FILE}"; do
    if [[ ! -f "${req_file}" ]]; then
        echo "Error: Required asset file '${req_file}' not found" >&2
        exit 1
    fi
done

ARCHIVE_NAME="dam-hopper-${TAG}-linux-x86_64-systemd.tar.gz"
mkdir -p "${OUTPUT_DIR}"

TMP_STAGE="$(mktemp -d -t dam-hopper-stage-XXXXXXXX)"
chmod 0700 "${TMP_STAGE}"
trap 'rm -rf "${TMP_STAGE}"' EXIT

# Create staged hierarchy
mkdir -p "${TMP_STAGE}/bin"
mkdir -p "${TMP_STAGE}/systemd"
mkdir -p "${TMP_STAGE}/sysusers.d"
mkdir -p "${TMP_STAGE}/tmpfiles.d"
mkdir -p "${TMP_STAGE}/web"

# Copy binaries
cp -p "${MGR_BIN}" "${TMP_STAGE}/bin/dam-hopper-manager"
chmod 0755 "${TMP_STAGE}/bin/dam-hopper-manager"

cp -p "${SERVER_BIN}" "${TMP_STAGE}/bin/dam-hopper-server"
chmod 0755 "${TMP_STAGE}/bin/dam-hopper-server"

cp -p "${WEB_BIN}" "${TMP_STAGE}/bin/dam-hopper-web"
chmod 0755 "${TMP_STAGE}/bin/dam-hopper-web"

cp -p "${HELPER_BIN}" "${TMP_STAGE}/bin/dam-hopper-idle-suspend-helper"
chmod 0755 "${TMP_STAGE}/bin/dam-hopper-idle-suspend-helper"

cp -p "${RUNNER_BIN}" "${TMP_STAGE}/bin/dam-hopper-plugin-runner"
chmod 0755 "${TMP_STAGE}/bin/dam-hopper-plugin-runner"

cp -p "${NODE_BIN}" "${TMP_STAGE}/bin/node"
chmod 0755 "${TMP_STAGE}/bin/node"
cp -p "${NODE_LICENSE}" "${TMP_STAGE}/NOTICES"
chmod 0644 "${TMP_STAGE}/NOTICES"
# Copy systemd units and sysusers
cp -p "${API_SERVICE_IN}" "${TMP_STAGE}/systemd/dam-hopper-api.service"
chmod 0644 "${TMP_STAGE}/systemd/dam-hopper-api.service"

cp -p "${WEB_SERVICE_IN}" "${TMP_STAGE}/systemd/dam-hopper-web.service"
chmod 0644 "${TMP_STAGE}/systemd/dam-hopper-web.service"

cp -p "${RECOVERY_SERVICE_IN}" "${TMP_STAGE}/systemd/dam-hopper-recovery.service"
chmod 0644 "${TMP_STAGE}/systemd/dam-hopper-recovery.service"

cp -p "${HELPER_SERVICE_IN}" "${TMP_STAGE}/systemd/dam-hopper-idle-suspend-helper.service"
chmod 0644 "${TMP_STAGE}/systemd/dam-hopper-idle-suspend-helper.service"

cp -p "${SYSUSERS_CONF}" "${TMP_STAGE}/sysusers.d/dam-hopper-web.conf"
chmod 0644 "${TMP_STAGE}/sysusers.d/dam-hopper-web.conf"

cp -p "${RUNNER_SERVICE_IN}" "${TMP_STAGE}/systemd/dam-hopper-plugin-runner.service"
chmod 0644 "${TMP_STAGE}/systemd/dam-hopper-plugin-runner.service"

cp -p "${RUNNER_TMPFILES_IN}" "${TMP_STAGE}/tmpfiles.d/dam-hopper-plugin-runner.conf"
chmod 0644 "${TMP_STAGE}/tmpfiles.d/dam-hopper-plugin-runner.conf"


# Copy LICENSE
cp -p "${LICENSE_FILE}" "${TMP_STAGE}/LICENSE"
chmod 0644 "${TMP_STAGE}/LICENSE"

# Copy web assets
cp -r "${WEB_DIST}/." "${TMP_STAGE}/web/"

# Fix directory and file permissions throughout
find "${TMP_STAGE}" -type d -exec chmod 0755 {} +
find "${TMP_STAGE}" -type f ! -path "${TMP_STAGE}/bin/*" -exec chmod 0644 {} +
find "${TMP_STAGE}/bin" -type f -exec chmod 0755 {} +

# Normalize mtimes deterministically
find "${TMP_STAGE}" -exec touch -h -d "@${EPOCH}" {} +

# Generate sorted file list
FILE_LIST="${TMP_STAGE}/_filelist.txt"
(cd "${TMP_STAGE}" && find . -mindepth 1 ! -name "_filelist.txt" \( -type f -o -path "./web*" -type d \) | sed 's|^\./||' | LC_ALL=C sort) > "${FILE_LIST}"

TMP_TAR="${TMP_STAGE}/archive.tar"
tar --sort=name \
    --format=posix \
    --owner=0 --group=0 --numeric-owner \
    --mtime="@${EPOCH}" \
    --pax-option=exthdr.name=%d/PaxHeaders/%f,delete=atime,delete=ctime \
    --no-recursion \
    -cf "${TMP_TAR}" \
    -C "${TMP_STAGE}" \
    -T "${FILE_LIST}"

FINAL_ARCHIVE="${OUTPUT_DIR}/${ARCHIVE_NAME}"
gzip -n -9 < "${TMP_TAR}" > "${FINAL_ARCHIVE}"

ARCHIVE_SIZE=$(wc -c < "${FINAL_ARCHIVE}" | tr -d ' ')
ARCHIVE_SHA256=$(sha256sum "${FINAL_ARCHIVE}" | awk '{print $1}')

echo "✓ Created deterministic release archive:"
echo "  File:   ${FINAL_ARCHIVE}"
echo "  Size:   ${ARCHIVE_SIZE} bytes"
echo "  SHA256: ${ARCHIVE_SHA256}"
echo "  Tag:    ${TAG}"
