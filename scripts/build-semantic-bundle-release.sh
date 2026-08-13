#!/usr/bin/env bash
# Build one signed, release-owned Linux semantic bundle from verified offline inputs.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 SOURCE_DIR DEST_DIR" >&2
  exit 2
fi

SOURCE_DIR="$1"
DEST_DIR="$2"
SIGNING_KEY_FILE="${DAM_HOPPER_SEMANTIC_BUNDLE_SIGNING_KEY_FILE:-}"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "semantic bundle source directory does not exist: $SOURCE_DIR" >&2
  exit 1
fi
if [[ -z "$SIGNING_KEY_FILE" || ! -r "$SIGNING_KEY_FILE" ]]; then
  echo "DAM_HOPPER_SEMANTIC_BUNDLE_SIGNING_KEY_FILE must name a readable Ed25519 private key" >&2
  exit 1
fi
if [[ -e "$DEST_DIR" ]]; then
  echo "refusing to overwrite existing semantic bundle destination: $DEST_DIR" >&2
  exit 1
fi

python3 - "$SOURCE_DIR" <<'PY'
import hashlib
import json
import os
import pathlib
import re
import sys

source = pathlib.Path(sys.argv[1]).resolve()
payload = source / "payload"
lock_path = source / "bundle-input.json"
sbom_path = source / "sbom.cdx.json"
licenses = source / "licenses"
hex_digest = re.compile(r"^[0-9a-f]{64}$")
max_compressed_bytes = 512 * 1024 * 1024
max_uncompressed_bytes = 4 * 1024 * 1024 * 1024

if not payload.is_dir() or not lock_path.is_file() or not sbom_path.is_file() or not licenses.is_dir():
    raise SystemExit("source directory requires payload/, bundle-input.json, sbom.cdx.json, and licenses/")
if any(path.is_symlink() for path in source.rglob("*")):
    raise SystemExit("semantic bundle inputs must not contain symlinks")

with lock_path.open(encoding="utf-8") as file:
    lock = json.load(file)
if set(lock) != {"schema_version", "sources", "descriptors"} or lock["schema_version"] != 2:
    raise SystemExit("bundle-input.json must use schema_version 2 with sources and descriptors")
if not isinstance(lock["sources"], list) or not lock["sources"]:
    raise SystemExit("bundle input lock must list verified source archives")
source_ids = set()
for item in lock["sources"]:
    if set(item) != {"id", "version", "url", "sha256", "path", "license_id"}:
        raise SystemExit("bundle source records have unsupported fields")
    if not isinstance(item["id"], str) or not item["id"] or item["id"] in source_ids or not isinstance(item["license_id"], str) or not item["license_id"]:
        raise SystemExit("bundle source IDs must be unique non-empty strings")
    source_ids.add(item["id"])
    if not isinstance(item["url"], str) or not item["url"].startswith("https://"):
        raise SystemExit("bundle source URLs must be pinned HTTPS URLs")
    if not isinstance(item["sha256"], str) or not hex_digest.fullmatch(item["sha256"].lower()):
        raise SystemExit("bundle source SHA-256 values must be lowercase hex")
    if not isinstance(item["path"], str) or pathlib.PurePosixPath(item["path"]).is_absolute() or ".." in pathlib.PurePosixPath(item["path"]).parts:
        raise SystemExit("bundle source archive paths must be relative and contained")
    archived = source / "sources" / item["path"]
    if not archived.is_file() or archived.is_symlink():
        raise SystemExit(f"bundle source archive is missing: {item['path']}")
    actual = hashlib.sha256(archived.read_bytes()).hexdigest()
    if actual != item["sha256"]:
        raise SystemExit(f"bundle source checksum mismatch: {item['id']}")

with sbom_path.open(encoding="utf-8") as file:
    sbom = json.load(file)
components = {component.get("name"): component for component in sbom.get("components", [])}
if set(components) != {"rust-analyzer", "node", "typescript", "typescript-language-server"} or not any(licenses.iterdir()):
    raise SystemExit("bundle SBOM and license records must match pinned sources")
for component in components.values():
    if not isinstance(component.get("licenses"), list) or not component["licenses"]:
        raise SystemExit("bundle SBOM components must declare licenses")

expected_entrypoints = {
    "rust-analyzer": "rust-analyzer",
    "typescript-language-server": "node/bin/node",
    "javascript-language-server": "node/bin/node",
}
expected_descriptors = {
    "rust-analyzer": ("native", "rust", "rust-analyzer"),
    "typescript-language-server": ("node", "typescript", "node"),
    "javascript-language-server": ("node", "javascript", "node"),
}
if not isinstance(lock["descriptors"], list) or not lock["descriptors"]:
    raise SystemExit("bundle input lock must list descriptors")
manifest_descriptors = []
seen_descriptors = set()
for descriptor in lock["descriptors"]:
    expected = {"descriptor_id", "runtime_id", "language", "version", "target", "artifact", "source_id"}
    if set(descriptor) != expected or descriptor["source_id"] not in source_ids:
        raise SystemExit("bundle descriptor is incomplete or refers to an unknown source")
    descriptor_id = descriptor["descriptor_id"]
    if descriptor_id not in expected_entrypoints or descriptor_id in seen_descriptors:
        raise SystemExit("bundle descriptor is not release-approved or is duplicated")
    seen_descriptors.add(descriptor_id)
    if (descriptor["runtime_id"], descriptor["language"], descriptor["source_id"]) != expected_descriptors[descriptor_id]:
        raise SystemExit(f"bundle descriptor identity is invalid: {descriptor_id}")
    target = descriptor["target"]
    if target != {"os": "linux", "architecture": "x86_64"}:
        raise SystemExit("Phase 5 accepts Linux x86_64 semantic descriptors only")
    artifact = descriptor["artifact"]
    expected_artifact = {"sha256", "license_id", "sbom_component", "compressed_size_bytes", "uncompressed_size_bytes"}
    if set(artifact) != expected_artifact or artifact["sbom_component"] not in components:
        raise SystemExit("bundle artifact must reference a declared SBOM component")
    source_record = next(item for item in lock["sources"] if item["id"] == descriptor["source_id"])
    if artifact["license_id"] != source_record["license_id"]:
        raise SystemExit(f"bundle artifact license does not match source: {descriptor_id}")
    sbom_license = components[artifact["sbom_component"]]["licenses"][0]["license"].get("id")
    if sbom_license != artifact["license_id"]:
        raise SystemExit(f"bundle artifact license does not match SBOM: {descriptor_id}")
    if not isinstance(artifact["compressed_size_bytes"], int) or not isinstance(artifact["uncompressed_size_bytes"], int) or artifact["compressed_size_bytes"] <= 0 or artifact["uncompressed_size_bytes"] < artifact["compressed_size_bytes"] or artifact["compressed_size_bytes"] > max_compressed_bytes or artifact["uncompressed_size_bytes"] > max_uncompressed_bytes:
        raise SystemExit("bundle artifact size metadata is invalid")
    entrypoint = payload / expected_entrypoints[descriptor_id]
    if not entrypoint.is_file() or entrypoint.is_symlink():
        raise SystemExit(f"bundle entrypoint is missing: {descriptor_id}")
    if hashlib.sha256(entrypoint.read_bytes()).hexdigest() != artifact["sha256"]:
        raise SystemExit(f"bundle entrypoint checksum mismatch: {descriptor_id}")
    if not os.access(entrypoint, os.X_OK):
        raise SystemExit(f"bundle entrypoint is not executable: {descriptor_id}")
    manifest_descriptors.append({key: descriptor[key] for key in expected - {"source_id"}})
if seen_descriptors != set(expected_descriptors):
    raise SystemExit("bundle descriptor set is incomplete")

module = payload / "typescript-language-server" / "lib" / "cli.mjs"
if not module.is_file() or module.is_symlink():
    raise SystemExit("bundled TypeScript language-server module is missing")

records = []
for path in payload.rglob("*"):
    if path.is_symlink() or (not path.is_file() and not path.is_dir()):
        raise SystemExit("bundle payload must contain only regular files and directories")
    if path.is_file():
        relative = path.relative_to(payload).as_posix()
        records.append((relative, hashlib.sha256(path.read_bytes()).hexdigest()))
if not records:
    raise SystemExit("bundle payload is empty")
tree = hashlib.sha256()
for relative, digest in sorted(records):
    tree.update(relative.encode("utf-8") + b"\0" + digest.encode("ascii") + b"\n")
payload_tree_sha256 = tree.hexdigest()
for descriptor in manifest_descriptors:
    descriptor["artifact"]["payload_tree_sha256"] = payload_tree_sha256

(source / ".generated-manifest.json").write_text(
    json.dumps({"schema_version": 2, "descriptors": manifest_descriptors}, sort_keys=True, separators=(",", ":")) + "\n",
    encoding="utf-8",
)
PY

cleanup() { rm -f "$SOURCE_DIR/.generated-manifest.json"; }
trap cleanup EXIT
install -d "$DEST_DIR"
install -m 0644 "$SOURCE_DIR/.generated-manifest.json" "$DEST_DIR/manifest.json"
cp -a "$SOURCE_DIR/payload" "$DEST_DIR/payload"
cp -a "$SOURCE_DIR/sbom.cdx.json" "$DEST_DIR/sbom.cdx.json"
cp -a "$SOURCE_DIR/licenses" "$DEST_DIR/licenses"
openssl pkeyutl -sign -rawin -inkey "$SIGNING_KEY_FILE" -in "$DEST_DIR/manifest.json" -out "$DEST_DIR/manifest.sig"
if [[ $(wc -c < "$DEST_DIR/manifest.sig") -ne 64 ]]; then
  echo "signing key did not produce an Ed25519 detached signature" >&2
  exit 1
fi
sha256sum "$DEST_DIR/manifest.json" | cut -d ' ' -f 1 > "$DEST_DIR/manifest.sha256"
echo "Built signed Linux x86_64 semantic bundle at $DEST_DIR"
