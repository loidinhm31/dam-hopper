#!/usr/bin/env bash
# Exercise the real pinned Linux bundle producer, signer, staging verifier, and LSP smoke gate.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
INPUT="$TMP/input"
BUNDLE="$TMP/bundle"
STAGED="$TMP/staged"

"$ROOT/scripts/prepare-semantic-bundle-input.sh" \
  "$ROOT/release/semantic-bundle-input.lock.json" "$INPUT"
openssl genpkey -algorithm ED25519 -out "$TMP/signing-key.pem" >/dev/null 2>&1
DAM_HOPPER_SEMANTIC_BUNDLE_SIGNING_KEY_FILE="$TMP/signing-key.pem" \
  "$ROOT/scripts/build-semantic-bundle-release.sh" "$INPUT" "$BUNDLE"

PUBLIC_KEY="$(openssl pkey -in "$TMP/signing-key.pem" -pubout -outform DER | tail -c 32 | xxd -p -c 256)"
DAM_HOPPER_SEMANTIC_BUNDLE_PUBLIC_KEY="$PUBLIC_KEY" \
  "$ROOT/scripts/prepare-semantic-bundle-release.sh" "$BUNDLE" "$STAGED"
"$ROOT/scripts/test-semantic-runtime-initialization.sh" "$STAGED/payload"

test "$(wc -c < "$STAGED/manifest.sig")" -eq 64
printf 'tamper' >> "$BUNDLE/payload/rust-analyzer"
if DAM_HOPPER_SEMANTIC_BUNDLE_PUBLIC_KEY="$PUBLIC_KEY" \
  "$ROOT/scripts/prepare-semantic-bundle-release.sh" "$BUNDLE" "$TMP/tampered-payload" >/dev/null 2>&1; then
  echo "staging accepted a tampered payload" >&2
  exit 1
fi
: > "$BUNDLE/manifest.sig"
if DAM_HOPPER_SEMANTIC_BUNDLE_PUBLIC_KEY="$PUBLIC_KEY" \
  "$ROOT/scripts/prepare-semantic-bundle-release.sh" "$BUNDLE" "$TMP/tampered-staged" >/dev/null 2>&1; then
  echo "staging accepted a tampered manifest signature" >&2
  exit 1
fi

printf 'real pinned semantic bundle release: PASS\n'
