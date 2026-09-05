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
SERVICE_USER=""
REINSTALL=0

usage() {
    cat <<EOF
Usage: $0 (--version <vX.Y.Z> | --latest) --role <server|web|both> [options]

Options:
  --version <tag>         Exact release version tag to install (e.g. v0.1.0)
  --latest                Resolve and install the latest stable release
  --role <role>           Target host role: 'server', 'web', or 'both' [required]
  --reinstall             Stop running services and overwrite existing installation for this version
  --allow-web-origin <url> Allowed web origin for CORS (may be specified multiple times)
  --service-user <user>   Dedicated non-root user to run the API service
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
        --reinstall)
            REINSTALL=1
            shift
            ;;
        --allow-web-origin)
            ALLOW_ORIGINS+=("$2")
            shift 2
            ;;
        --service-user)
            SERVICE_USER="$2"
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

# Host ABI check
if command -v getconf >/dev/null 2>&1; then
    GLIBC_VER_STR="$(getconf GNU_LIBC_VERSION 2>/dev/null || true)"
    GLIBC_VER="${GLIBC_VER_STR#glibc }"
    if [[ "${GLIBC_VER}" =~ ^([0-9]+)\.([0-9]+) ]]; then
        MAJOR="${BASH_REMATCH[1]}"
        MINOR="${BASH_REMATCH[2]}"
        if (( MAJOR < 2 || (MAJOR == 2 && MINOR < 39) )); then
            echo "Error: glibc version '${GLIBC_VER}' is too low (minimum required: 2.39)" >&2
            exit 1
        fi
    fi
fi

# Resolve release tag
TAG=""
if [[ ${LATEST} -eq 1 ]]; then
    echo "Resolving latest stable release for ${REPO_OWNER}/${REPO_NAME}..."
    LATEST_JSON=$(curl -fsSL -H "Accept: application/vnd.github+json" "${API_BASE}/releases/latest" 2>/dev/null || true)
    if [[ -n "${LATEST_JSON}" ]]; then
        TAG=$(echo "${LATEST_JSON}" | awk -F'"' '/"tag_name":/ { print $4; exit }')
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

ARCHIVE_NAME="dam-hopper-${TAG}-linux-x86_64-systemd.tar.gz"
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
    FALLBACK_ARCHIVE="dam-hopper-${TAG}-fedora44-x86_64-systemd.tar.gz"
    echo "Primary archive not found, trying fallback: ${FALLBACK_ARCHIVE}..."
    ARCHIVE_NAME="${FALLBACK_ARCHIVE}"
    ARCHIVE_FILE="${BUNDLE_DIR}/${ARCHIVE_NAME}"
    if ! curl -fsSL --connect-timeout 15 --max-time 300 \
        "${DOWNLOAD_URL_BASE}/${ARCHIVE_NAME}" -o "${ARCHIVE_FILE}"; then
        echo "Error: Failed to download release archive for ${TAG}" >&2
        exit 1
    fi
fi

# Parse expected sha256 from manifest
EXPECTED_SHA=$(awk -F'"' '/"archive"/,/\}/ { if ($2 == "sha256") { print $4; exit } }' "${MANIFEST_FILE}")
if [[ -z "${EXPECTED_SHA}" ]]; then
    EXPECTED_SHA=$(awk -F'"' '/"sha256":/ { print $4; exit }' "${MANIFEST_FILE}")
fi
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

# Extract only the manager member, without honoring archive ownership,
# permissions, recursive directory contents, or directory symlinks.
MGR_EXTRACT_DIR="${TMP_DIR}/mgr"
mkdir -p "${MGR_EXTRACT_DIR}"
echo "Extracting release manager..."
tar --extract --gzip --file "${ARCHIVE_FILE}" \
    --directory "${MGR_EXTRACT_DIR}" \
    --no-same-owner --no-same-permissions --no-recursion \
    --keep-directory-symlink \
    -- "bin/dam-hopper-manager"

MANAGER_BIN="${MGR_EXTRACT_DIR}/bin/dam-hopper-manager"
if [[ -L "${MGR_EXTRACT_DIR}/bin" || ! -d "${MGR_EXTRACT_DIR}/bin" ]]; then
    echo "Error: Archive extracted a non-directory manager parent" >&2
    exit 1
fi
if [[ -L "${MANAGER_BIN}" || ! -f "${MANAGER_BIN}" ]]; then
    echo "Error: Extracted manager binary is not a regular file: ${MANAGER_BIN}" >&2
    exit 1
fi
chmod 0755 "${MANAGER_BIN}"
if [[ ! -x "${MANAGER_BIN}" ]]; then
    echo "Error: Extracted manager binary is not executable: ${MANAGER_BIN}" >&2
    exit 1
fi
MANAGER_MODE="$(stat -c '%a' "${MANAGER_BIN}" 2>/dev/null || stat -f '%Lp' "${MANAGER_BIN}")"
if [[ "${MANAGER_MODE}" != "755" ]]; then
    echo "Error: Extracted manager binary has unsafe mode ${MANAGER_MODE}" >&2
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
if [[ -n "${SERVICE_USER}" ]]; then
    INSTALL_CMD+=("--service-user" "${SERVICE_USER}")
fi
if [[ -d "/opt/dam-hopper/releases/${TAG}/${ROLE}" && ${REINSTALL} -eq 0 ]]; then
    echo "Release ${TAG} for role '${ROLE}' is already installed at /opt/dam-hopper/releases/${TAG}/${ROLE}."
    REINSTALL_CONFIRMED=""
    if [[ -t 0 ]]; then
        read -r -p "Do you want to reinstall and replace it? [y/N] " REINSTALL_CONFIRMED || true
    elif [[ -e /dev/tty ]]; then
        read -r -p "Do you want to reinstall and replace it? [y/N] " REINSTALL_CONFIRMED < /dev/tty || true
    fi
    if [[ "${REINSTALL_CONFIRMED}" =~ ^[Yy]$ || "${REINSTALL_CONFIRMED}" =~ ^[Yy][Ee][Ss]$ ]]; then
        REINSTALL=1
    else
        echo "Aborting install. To replace the existing installation, rerun with --reinstall" >&2
        exit 1
    fi
fi

if [[ ${REINSTALL} -eq 1 ]]; then
    INSTALL_CMD+=("--reinstall")
    echo "Stopping existing services and clearing old release directory for clean reinstall..."
    systemctl stop dam-hopper-api dam-hopper-web dam-hopper-recovery 2>/dev/null || sudo systemctl stop dam-hopper-api dam-hopper-web dam-hopper-recovery 2>/dev/null || true
    if [[ -d "/opt/dam-hopper/releases/${TAG}/${ROLE}" ]]; then
        rm -rf "/opt/dam-hopper/releases/${TAG}/${ROLE}" 2>/dev/null || sudo rm -rf "/opt/dam-hopper/releases/${TAG}/${ROLE}" 2>/dev/null || true
    fi
fi
echo ""
echo "============================================================"
echo "Staging release ${TAG} for role '${ROLE}' (requires sudo)..."
echo "============================================================"

if [[ ! -f /etc/dam-hopper/dam-hopper.toml ]]; then
    if [[ $EUID -eq 0 ]]; then
        mkdir -p -m 0755 /etc/dam-hopper
        cat > /etc/dam-hopper/dam-hopper.toml <<'EOF'
[workspace]
name = "default"
EOF
        chmod 0644 /etc/dam-hopper/dam-hopper.toml
    else
        sudo mkdir -p -m 0755 /etc/dam-hopper
        sudo tee /etc/dam-hopper/dam-hopper.toml >/dev/null <<'EOF'
[workspace]
name = "default"
EOF
        sudo chmod 0644 /etc/dam-hopper/dam-hopper.toml
    fi
fi

if [[ $EUID -eq 0 ]]; then
    "${INSTALL_CMD[@]}"
    mkdir -p -m 0755 /usr/local/bin
    install -m 0755 "${MANAGER_BIN}" /usr/local/bin/dam-hopper
else
    sudo "${INSTALL_CMD[@]}"
    sudo mkdir -p -m 0755 /usr/local/bin
    sudo install -m 0755 "${MANAGER_BIN}" /usr/local/bin/dam-hopper
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
