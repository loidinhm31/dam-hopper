#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 SOURCE_DIR DEST_DIR" >&2
  exit 2
fi

SOURCE_DIR="$1"
DEST_DIR="$2"
PUBLIC_KEY="${DAM_HOPPER_SEMANTIC_BUNDLE_PUBLIC_KEY:-}"

if [[ ! "$PUBLIC_KEY" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "DAM_HOPPER_SEMANTIC_BUNDLE_PUBLIC_KEY must be exactly 32 bytes of hex" >&2
  exit 1
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "semantic bundle source directory does not exist: $SOURCE_DIR" >&2
  exit 1
fi

for required in manifest.json manifest.sig manifest.sha256; do
  if [[ ! -f "$SOURCE_DIR/$required" ]]; then
    echo "semantic bundle is missing $required" >&2
    exit 1
  fi
done

EXPECTED_DIGEST="$(tr -d '[:space:]' < "$SOURCE_DIR/manifest.sha256")"
if [[ ! "$EXPECTED_DIGEST" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "manifest.sha256 must contain exactly one SHA-256 digest" >&2
  exit 1
fi

ACTUAL_DIGEST="$(sha256sum "$SOURCE_DIR/manifest.json" | cut -d ' ' -f 1)"
if [[ "${ACTUAL_DIGEST,,}" != "${EXPECTED_DIGEST,,}" ]]; then
  echo "manifest.sha256 does not match manifest.json" >&2
  exit 1
fi

if [[ -e "$DEST_DIR" ]]; then
  echo "refusing to overwrite existing semantic bundle destination: $DEST_DIR" >&2
  exit 1
fi

install -d "$DEST_DIR"
cp -a "$SOURCE_DIR/." "$DEST_DIR/"

echo "Prepared signed semantic bundle at $DEST_DIR"
