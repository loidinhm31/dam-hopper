#!/usr/bin/env bash
set -euo pipefail

# DamHopper Linux non-root bootstrap installer.
# Fetches verified release assets from GitHub, checks SHA-256 integrity against
# the authoritative release manifest, optionally verifies GitHub attestations,
# extracts the verified manager, and stages the candidate release via sudo.
# Does NOT start or activate services.

REPO_PATH="${GITHUB_REPOSITORY:-loidinhm31/dam-hopper}"
REPO_OWNER="${REPO_PATH%/*}"
REPO_NAME="${REPO_PATH#*/}"
GITHUB_BASE="https://github.com/${REPO_OWNER}/${REPO_NAME}"
API_BASE="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}"

VERSION=""
LATEST=0
ROLE=""
ALLOW_ORIGINS=()
VERIFY_ATTESTATION=0

usage() {
    cat <<EOF
Usage: $0 (--version <vX.Y.Z> | --latest) --role <server|web|both> [options]

Options:
  --version <tag>         Exact release version tag to install (e.g. v0.1.0)
  --latest                Resolve and install the latest stable release
  --role <role>           Target host role: 'server', 'web', or 'both' [required]
  --allow-web-origin <url> Allowed web origin for CORS (may be specified multiple times)
  --verify-attestation    Verify GitHub artifact attestations using the 'gh' CLI
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
        --latest)
            LATEST=1
            shift
            ;;
        --role)
            ROLE="$2"
            shift 2
            ;;
        --allow-web-origin)
            ALLOW_ORIGINS+=("$2")
            shift 2
            ;;
        --verify-attestation)
            VERIFY_ATTESTATION=1
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Error: Unknown option '$1'" >&2
            usage
            ;;
    esac
done

if [[ -z "${ROLE}" ]]; then
    echo "Error: --role <server|web|both> is required" >&2
    usage
fi

if [[ "${ROLE}" != "server" && "${ROLE}" != "web" && "${ROLE}" != "both" ]]; then
    echo "Error: --role must be one of: server, web, both" >&2
    exit 1
fi

if [[ -z "${VERSION}" && ${LATEST} -eq 0 ]]; then
    echo "Error: Either --version <vX.Y.Z> or --latest is required" >&2
    usage
fi

if [[ -n "${VERSION}" && ${LATEST} -eq 1 ]]; then
    echo "Error: Cannot specify both --version and --latest" >&2
    usage
fi

# Dependency check
for cmd in curl sha256sum tar; do
    if ! command -v "${cmd}" >/dev/null 2>&1; then
        echo "Error: Required command '${cmd}' not found on host" >&2
        exit 1
    fi
done

# Resolve release tag
TAG=""
if [[ ${LATEST} -eq 1 ]]; then
    echo "Resolving latest stable release for ${REPO_OWNER}/${REPO_NAME}..."
    LATEST_JSON=$(curl -fsSL -H "Accept: application/vnd.github+json" "${API_BASE}/releases/latest" 2>/dev/null || true)
    if [[ -n "${LATEST_JSON}" ]]; then
        TAG=$(echo "${LATEST_JSON}" | grep -o '"tag_name": *"[^"]*"' | head -n1 | cut -d'"' -f4)
    fi
    if [[ -z "${TAG}" ]]; then
        echo "Error: Could not resolve latest stable release tag from GitHub API" >&2
        exit 1
    fi
    echo "Resolved latest release: ${TAG}"
else
    TAG="${VERSION}"
fi

if [[ ! "${TAG}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: Tag '${TAG}' does not match expected format vMAJOR.MINOR.PATCH" >&2
    exit 1
fi

ARCHIVE_NAME="dam-hopper-${TAG}-fedora44-x86_64-systemd.tar.gz"
DOWNLOAD_URL_BASE="${GITHUB_BASE}/releases/download/${TAG}"

TMP_DIR="$(mktemp -d -t dam-hopper-bootstrap-XXXXXXXX)"
chmod 0700 "${TMP_DIR}"
trap 'rm -rf "${TMP_DIR}"' EXIT

BUNDLE_DIR="${TMP_DIR}/bundle"
mkdir -p "${BUNDLE_DIR}"

MANIFEST_FILE="${BUNDLE_DIR}/release-manifest.json"
ARCHIVE_FILE="${BUNDLE_DIR}/${ARCHIVE_NAME}"

echo "Downloading release manifest: ${TAG}..."
if ! curl -fsSL --connect-timeout 15 --max-time 60 \
    "${DOWNLOAD_URL_BASE}/release-manifest.json" -o "${MANIFEST_FILE}"; then
    echo "Error: Failed to download release-manifest.json for ${TAG}" >&2
    exit 1
fi

echo "Downloading release archive: ${ARCHIVE_NAME}..."
if ! curl -fsSL --connect-timeout 15 --max-time 300 \
    "${DOWNLOAD_URL_BASE}/${ARCHIVE_NAME}" -o "${ARCHIVE_FILE}"; then
    echo "Error: Failed to download ${ARCHIVE_NAME}" >&2
    exit 1
fi

# Parse expected sha256 from manifest
EXPECTED_SHA=$(grep -o '"sha256": *"[^"]*"' "${MANIFEST_FILE}" | head -n1 | cut -d'"' -f4)
if [[ -z "${EXPECTED_SHA}" || ${#EXPECTED_SHA} -ne 64 ]]; then
    echo "Error: Could not extract valid archive SHA-256 from release-manifest.json" >&2
    exit 1
fi

echo "Verifying SHA-256 checksum..."
ACTUAL_SHA=$(sha256sum "${ARCHIVE_FILE}" | awk '{print $1}')
if [[ "${ACTUAL_SHA}" != "${EXPECTED_SHA}" ]]; then
    echo "Error: Checksum mismatch for ${ARCHIVE_NAME}!" >&2
    echo "  Expected: ${EXPECTED_SHA}" >&2
    echo "  Actual:   ${ACTUAL_SHA}" >&2
    exit 1
fi
echo "✓ Checksum verified: ${ACTUAL_SHA}"

# Optional GitHub attestation check
if [[ ${VERIFY_ATTESTATION} -eq 1 ]]; then
    if command -v gh >/dev/null 2>&1; then
        echo "Verifying GitHub artifact attestations for manifest and archive..."
        if ! gh attestation verify "${MANIFEST_FILE}" --repo "${REPO_OWNER}/${REPO_NAME}"; then
            echo "Error: GitHub artifact attestation verification failed for release-manifest.json!" >&2
            exit 1
        fi
        if ! gh attestation verify "${ARCHIVE_FILE}" --repo "${REPO_OWNER}/${REPO_NAME}"; then
            echo "Error: GitHub artifact attestation verification failed for ${ARCHIVE_NAME}!" >&2
            exit 1
        fi
        echo "✓ GitHub artifact attestations verified successfully."
    else
        echo "Error: --verify-attestation requested but 'gh' CLI is not installed" >&2
        exit 1
    fi
fi

# Extract manager binary to execute staging
MGR_EXTRACT_DIR="${TMP_DIR}/mgr"
mkdir -p "${MGR_EXTRACT_DIR}"
echo "Extracting release manager..."
tar -xzf "${ARCHIVE_FILE}" -C "${MGR_EXTRACT_DIR}" bin/dam-hopper-manager

MANAGER_BIN="${MGR_EXTRACT_DIR}/bin/dam-hopper-manager"
if [[ ! -x "${MANAGER_BIN}" ]]; then
    echo "Error: Extracted manager binary is not executable: ${MANAGER_BIN}" >&2
    exit 1
fi

# Execute manager install via sudo
INSTALL_CMD=("${MANAGER_BIN}" "install" "--bundle" "${BUNDLE_DIR}" "--role" "${ROLE}")
if [[ ${VERIFY_ATTESTATION} -eq 1 ]]; then
    INSTALL_CMD+=("--verify-attestation")
fi
for origin in "${ALLOW_ORIGINS[@]}"; do
    INSTALL_CMD+=("--allow-web-origin" "${origin}")
done

echo ""
echo "============================================================"
echo "Staging release ${TAG} for role '${ROLE}' (requires sudo)..."
echo "============================================================"

if [[ $EUID -eq 0 ]]; then
    "${INSTALL_CMD[@]}"
else
    sudo "${INSTALL_CMD[@]}"
fi

echo ""
echo "============================================================"
echo "✓ Candidate release ${TAG} staged successfully."
echo "State: PENDING (units installed, services not yet started)"
echo ""
echo "To activate candidate release and start services, run:"
echo "  sudo dam-hopper start"
echo ""
echo "To check installation status, run:"
echo "  dam-hopper status"
echo "============================================================"
