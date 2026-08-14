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

for required in manifest.json manifest.sig manifest.sha256 sbom.cdx.json; do
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

KEY_DIR="$(mktemp -d)"
trap 'rm -rf "$KEY_DIR"' EXIT
# Ed25519 SubjectPublicKeyInfo DER prefix followed by the raw 32-byte key.
printf '302a300506032b6570032100' | xxd -r -p > "$KEY_DIR/public-key.der"
printf '%s' "$PUBLIC_KEY" | xxd -r -p >> "$KEY_DIR/public-key.der"
openssl pkey -pubin -inform DER -in "$KEY_DIR/public-key.der" \
  -pubout -out "$KEY_DIR/public-key.pem" >/dev/null 2>&1
if ! openssl pkeyutl -verify -rawin -pubin \
  -inkey "$KEY_DIR/public-key.pem" -in "$SOURCE_DIR/manifest.json" \
  -sigfile "$SOURCE_DIR/manifest.sig" >/dev/null 2>&1; then
  echo "manifest.sig does not verify with DAM_HOPPER_SEMANTIC_BUNDLE_PUBLIC_KEY" >&2
  exit 1
fi

if [[ ! -d "$SOURCE_DIR/payload" || ! -d "$SOURCE_DIR/licenses" ]]; then
  echo "semantic bundle requires payload/ and licenses/ directories" >&2
  exit 1
fi
if find "$SOURCE_DIR" -type l -print -quit | grep -q .; then
  echo "semantic bundle must not contain symbolic links" >&2
  exit 1
fi

python3 - "$SOURCE_DIR" <<'PY'
import hashlib
import json
import os
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1]).resolve()
payload = root / "payload"
if not payload.is_dir():
    raise SystemExit("semantic bundle payload directory is missing")
with (root / "manifest.json").open(encoding="utf-8") as file:
    manifest = json.load(file)
if set(manifest) != {"schema_version", "descriptors"} or manifest["schema_version"] != 2:
    raise SystemExit("semantic bundle manifest schema is invalid")
expected = {
    "rust-analyzer": ("native", "rust", "payload/rust-analyzer", "MIT OR Apache-2.0", "rust-analyzer"),
    "typescript-language-server": ("node", "typescript", "payload/node/bin/node", "MIT", "node"),
    "javascript-language-server": ("node", "javascript", "payload/node/bin/node", "MIT", "node"),
}
if not isinstance(manifest["descriptors"], list) or {d.get("descriptor_id") for d in manifest["descriptors"]} != set(expected):
    raise SystemExit("semantic bundle descriptor set is invalid")
files = []
total_bytes = 0
for path in payload.rglob("*"):
    if path.is_symlink() or (not path.is_file() and not path.is_dir()):
        raise SystemExit("semantic bundle payload contains an unsafe entry")
    if path.is_file():
        file_size = path.stat().st_size
        if file_size > 4 * 1024 * 1024 * 1024:
            raise SystemExit("semantic bundle payload file exceeds size limit")
        total_bytes += file_size
        if total_bytes > 4 * 1024 * 1024 * 1024:
            raise SystemExit("semantic bundle payload exceeds size limit")
        files.append(path)
if not files or len(files) > 100_000:
    raise SystemExit("semantic bundle payload file count is invalid")
records = []
for path in sorted(files):
    relative = path.relative_to(payload).as_posix()
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    records.append((relative, digest))
tree = hashlib.sha256()
for relative, digest in records:
    tree.update(relative.encode() + b"\0" + digest.encode() + b"\n")
payload_tree = tree.hexdigest()
seen = set()
for descriptor in manifest["descriptors"]:
    if set(descriptor) != {"descriptor_id", "runtime_id", "language", "version", "target", "artifact"}:
        raise SystemExit("semantic bundle descriptor fields are invalid")
    descriptor_id = descriptor["descriptor_id"]
    runtime_id, language, entrypoint, license_id, sbom_component = expected[descriptor_id]
    if not isinstance(descriptor["version"], str) or not descriptor["version"].strip():
        raise SystemExit(f"semantic bundle descriptor version is invalid: {descriptor_id}")
    if (descriptor["runtime_id"], descriptor["language"], descriptor["target"]) != (runtime_id, language, {"os": "linux", "architecture": "x86_64"}):
        raise SystemExit(f"semantic bundle descriptor identity is invalid: {descriptor_id}")
    artifact = descriptor["artifact"]
    if set(artifact) != {"sha256", "license_id", "sbom_component", "compressed_size_bytes", "uncompressed_size_bytes", "payload_tree_sha256"}:
        raise SystemExit("semantic bundle artifact fields are invalid")
    if not isinstance(artifact["compressed_size_bytes"], int) or not isinstance(artifact["uncompressed_size_bytes"], int) or artifact["compressed_size_bytes"] <= 0 or artifact["uncompressed_size_bytes"] < artifact["compressed_size_bytes"] or artifact["compressed_size_bytes"] > 1024 * 1024 * 1024 or artifact["uncompressed_size_bytes"] > 4 * 1024 * 1024 * 1024:
        raise SystemExit(f"semantic bundle artifact size metadata is invalid: {descriptor_id}")
    if artifact["license_id"] != license_id or artifact["sbom_component"] != sbom_component:
        raise SystemExit(f"semantic bundle provenance metadata is invalid: {descriptor_id}")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", artifact["sha256"]) or artifact["payload_tree_sha256"] != payload_tree:
        raise SystemExit(f"semantic bundle payload digest is invalid: {descriptor_id}")
    file_path = root / entrypoint
    if not file_path.is_file() or file_path.is_symlink() or hashlib.sha256(file_path.read_bytes()).hexdigest() != artifact["sha256"]:
        raise SystemExit(f"semantic bundle entrypoint is invalid: {descriptor_id}")
    if not os.access(file_path, os.X_OK):
        raise SystemExit(f"semantic bundle entrypoint is not executable: {descriptor_id}")
    seen.add(descriptor_id)
with (root / "sbom.cdx.json").open(encoding="utf-8") as file:
    sbom = json.load(file)
components = {component.get("name"): component for component in sbom.get("components", [])}
if set(components) != {"rust-analyzer", "node", "typescript", "typescript-language-server"}:
    raise SystemExit("semantic bundle SBOM component set is invalid")
for component in components.values():
    if not isinstance(component.get("version"), str) or not component["version"].strip():
        raise SystemExit("semantic bundle SBOM component versions are invalid")
    licenses_field = component.get("licenses")
    if not isinstance(licenses_field, list) or not licenses_field:
        raise SystemExit("semantic bundle SBOM license records are invalid")
    if not isinstance(component.get("version"), str) or not component["version"].strip():
        raise SystemExit("semantic bundle SBOM component versions are invalid")
license_files = {path.name for path in (root / "licenses").iterdir() if path.is_file()}
if {"node-LICENSE", "rust-analyzer-LICENSE.txt", "typescript-LICENSE", "typescript-language-server-LICENSE"} - license_files:
    raise SystemExit("semantic bundle license records are incomplete")
for required in ("payload/node/bin/node", "payload/typescript-language-server/lib/cli.mjs", "payload/typescript-language-server/node_modules/typescript/lib/tsserver.js"):
    if not (root / required).is_file():
        raise SystemExit(f"semantic bundle required runtime file is missing: {required}")
PY

for entry in "$SOURCE_DIR"/*; do
  [[ -e "$entry" ]] || continue
  case "$(basename "$entry")" in
    manifest.json|manifest.sig|manifest.sha256|sbom.cdx.json|payload|licenses) ;;
    *) echo "semantic bundle contains an unexpected top-level entry: $(basename "$entry")" >&2; exit 1 ;;
  esac
done

if find "$SOURCE_DIR/payload" -type f -perm /111 ! -path "$SOURCE_DIR/payload/rust-analyzer" ! -path "$SOURCE_DIR/payload/node/bin/node" ! -path "$SOURCE_DIR/payload/typescript-language-server/node_modules/typescript/bin/tsserver" ! -path "$SOURCE_DIR/payload/typescript-language-server/node_modules/typescript/bin/tsc" -print -quit | grep -q .; then
  echo "semantic bundle contains an unexpected executable payload" >&2
  exit 1
fi

if [[ -e "$DEST_DIR" ]]; then
  echo "refusing to overwrite existing semantic bundle destination: $DEST_DIR" >&2
  exit 1
fi

install -d "$DEST_DIR"
for required in manifest.json manifest.sig manifest.sha256 sbom.cdx.json; do
  install -m 0644 "$SOURCE_DIR/$required" "$DEST_DIR/$required"
done
cp -a "$SOURCE_DIR/payload" "$DEST_DIR/payload"
cp -a "$SOURCE_DIR/licenses" "$DEST_DIR/licenses"

echo "Prepared signed semantic bundle at $DEST_DIR"
