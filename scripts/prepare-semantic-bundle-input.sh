#!/usr/bin/env bash
# Download pinned public runtime archives and construct one Linux bundle input.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 LOCK_FILE DEST_DIR" >&2
  exit 2
fi

LOCK_FILE="$1"
DEST_DIR="$2"
if [[ ! -f "$LOCK_FILE" ]]; then
  echo "semantic bundle lock does not exist: $LOCK_FILE" >&2
  exit 1
fi
if [[ -e "$DEST_DIR" ]]; then
  echo "refusing to overwrite existing semantic bundle input: $DEST_DIR" >&2
  exit 1
fi

python3 - "$LOCK_FILE" "$DEST_DIR" <<'PY'
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zlib

MAX_SOURCE_BYTES = 512 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = 100_000
MAX_EXPANDED_BYTES = 4 * 1024 * 1024 * 1024
MAX_NPM_MEMBERS = 10_000
MAX_NPM_BYTES = 512 * 1024 * 1024

lock_path = pathlib.Path(sys.argv[1]).resolve()
dest = pathlib.Path(sys.argv[2]).resolve()
lock = json.loads(lock_path.read_text(encoding="utf-8"))
expected = {"schema_version", "target", "sources"}
if set(lock) != expected or lock["schema_version"] != 1:
    raise SystemExit("semantic bundle lock must use schema_version 1")
if lock["target"] != {"os": "linux", "architecture": "x86_64"}:
    raise SystemExit("only Linux x86_64 semantic bundles are supported")

sources = lock["sources"]
source_by_id = {source["id"]: source for source in sources}
required = {"rust-analyzer", "node", "typescript", "typescript-language-server"}
if set(source_by_id) != required or len(source_by_id) != len(sources):
    raise SystemExit("semantic bundle lock must pin Rust Analyzer, Node, TypeScript, and TS language server exactly once")
expected_pins = {
    "rust-analyzer": ("2026-08-10.1", "https://github.com/rust-lang/rust-analyzer/releases/download/2026-08-10.1/rust-analyzer-x86_64-unknown-linux-gnu.gz", "d42908a7dc7b89250ae881a0919e477296843665c98574ecc8fe16ba60cecefb"),
    "node": ("24.19.0", "https://nodejs.org/download/release/v24.19.0/node-v24.19.0-linux-x64.tar.xz", "14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647"),
    "typescript": ("6.0.3", "https://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz", "33cd0ee1beaa8c9e9d15a9da836c62ddea4c34a42d7c2d349dbc80d94165d22a"),
    "typescript-language-server": ("5.3.0", "https://registry.npmjs.org/typescript-language-server/-/typescript-language-server-5.3.0.tgz", "398cacc17fff2108652e7b4050e3182008d17063246b3fea7dcf5fae2ce1560e"),
}
for source in sources:
    if (source["version"], source["url"], source["sha256"].lower()) != expected_pins[source["id"]]:
        raise SystemExit(f"source pin differs from reviewed stable release: {source['id']}")
    if set(source) != {"id", "version", "url", "sha256", "license_id"}:
        raise SystemExit("semantic bundle source has unsupported fields")
    if not source["url"].startswith("https://") or not isinstance(source["sha256"], str) or len(source["sha256"]) != 64 or not all(byte in "0123456789abcdefABCDEF" for byte in source["sha256"]):
        raise SystemExit("semantic bundle source URL or SHA-256 is invalid")
    if not isinstance(source["version"], str) or not source["version"].strip() or not isinstance(source["license_id"], str) or not source["license_id"].strip():
        raise SystemExit("semantic bundle source metadata is invalid")

dest.mkdir(parents=True)
archives = dest / "sources"
archives.mkdir()
payload = dest / "payload"
payload.mkdir()
for source in sources:
    filename = source["url"].rsplit("/", 1)[-1]
    archive = archives / filename
    with urllib.request.urlopen(source["url"], timeout=120) as response, archive.open("wb") as output:
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) > MAX_SOURCE_BYTES:
            raise SystemExit(f"source archive exceeds compressed size limit: {source['id']}")
        total = 0
        while chunk := response.read(1024 * 1024):
            total += len(chunk)
            if total > MAX_SOURCE_BYTES:
                raise SystemExit(f"source archive exceeds compressed size limit: {source['id']}")
            output.write(chunk)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    if digest != source["sha256"]:
        raise SystemExit(f"download checksum mismatch: {source['id']}")

def validate_members(members, max_members, max_bytes, reject_links):
    if len(members) > max_members:
        raise SystemExit("source archive contains too many members")
    expanded = 0
    for member in members:
        relative = pathlib.PurePosixPath(member.name)
        if relative.is_absolute() or ".." in relative.parts:
            raise SystemExit("source archive contains a traversal path")
        if reject_links and (member.issym() or member.islnk() or member.isdev()):
            raise SystemExit("source archive contains a link or device entry")
        expanded += member.size
        if expanded > max_bytes:
            raise SystemExit("source archive expands beyond size limit")
    return members

def extract_single_gzip(archive, destination):
    if archive.stat().st_size > MAX_SOURCE_BYTES:
        raise SystemExit("Rust Analyzer archive exceeds compressed size limit")
    decoder = zlib.decompressobj(31)
    expanded = 0
    with archive.open("rb") as input_file, destination.open("wb") as output:
        while chunk := input_file.read(1024 * 1024):
            data = decoder.decompress(chunk, MAX_EXPANDED_BYTES - expanded + 1)
            expanded += len(data)
            if expanded > MAX_EXPANDED_BYTES or decoder.unconsumed_tail:
                raise SystemExit("Rust Analyzer archive expands beyond size limit")
            output.write(data)
        data = decoder.flush(MAX_EXPANDED_BYTES - expanded + 1)
        expanded += len(data)
        if expanded > MAX_EXPANDED_BYTES or not decoder.eof or decoder.unused_data:
            raise SystemExit("Rust Analyzer archive is malformed or multi-member")
        output.write(data)

rust_archive = next(archives.glob("rust-analyzer-*.gz"))
rust_binary = payload / "rust-analyzer"
extract_single_gzip(rust_archive, rust_binary)
rust_binary.chmod(0o755)

node_archive = next(archives.glob("node-*.tar.xz"))
with tarfile.open(node_archive, "r:xz") as archive:
    members = validate_members(archive.getmembers(), MAX_ARCHIVE_MEMBERS, MAX_EXPANDED_BYTES, False)
    root = pathlib.PurePosixPath(members[0].name).parts[0]
    wanted = [member for member in members if member.name in {f"{root}/bin/node", f"{root}/LICENSE"}]
    if len(wanted) != 2 or any(not member.isfile() for member in wanted):
        raise SystemExit("Node archive has invalid required payload entries")
    archive.extractall(dest / ".node", members=wanted, filter="data")
node_root = dest / ".node" / root
(payload / "node/bin").mkdir(parents=True)
shutil.move(node_root / "bin/node", payload / "node/bin/node")
(payload / "node/bin/node").chmod(0o755)

for package_id, package_dir in [("typescript-language-server", "typescript-language-server"), ("typescript", "typescript")]:
    archive = archives / source_by_id[package_id]["url"].rsplit("/", 1)[-1]
    target = payload / "typescript-language-server" / "node_modules" / package_dir
    if package_id == "typescript-language-server":
        target = payload / "typescript-language-server"
    target.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:gz") as tar:
        members = validate_members(tar.getmembers(), MAX_NPM_MEMBERS, MAX_NPM_BYTES, True)
        if any(not member.name.startswith("package/") for member in members):
            raise SystemExit(f"unexpected npm package layout: {package_id}")
        tar.extractall(target.parent, members=members, filter="data")
    extracted = target.parent / "package"
    extracted.rename(target)

licenses = dest / "licenses"
licenses.mkdir()
shutil.copy2(node_root / "LICENSE", licenses / "node-LICENSE")
for package_id, package_dir, license_file in [("typescript", "typescript", "LICENSE.txt"), ("typescript-language-server", "typescript-language-server", "LICENSE")]:
    source = payload / "typescript-language-server" / "node_modules" / package_dir / license_file
    if package_id == "typescript-language-server":
        source = payload / "typescript-language-server" / license_file
    shutil.copy2(source, licenses / f"{package_id}-LICENSE")
(licenses / "rust-analyzer-LICENSE.txt").write_text("MIT OR Apache-2.0; see upstream release provenance.\n", encoding="utf-8")
shutil.rmtree(dest / ".node")

def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def source_record(identifier):
    source = source_by_id[identifier]
    return {**source, "path": source["url"].rsplit("/", 1)[-1]}
def artifact(path, source_id, component):
    return {
        "sha256": sha256(path),
        "license_id": source_by_id[source_id]["license_id"],
        "sbom_component": component,
        "compressed_size_bytes": (archives / source_record(source_id)["path"]).stat().st_size,
        "uncompressed_size_bytes": max(path.stat().st_size, (archives / source_record(source_id)["path"]).stat().st_size),
    }
node = payload / "node/bin/node"
manifest_input = {
    "schema_version": 2,
    "sources": [source_record(source["id"]) for source in sources],
    "descriptors": [
        {"descriptor_id": "rust-analyzer", "runtime_id": "native", "language": "rust", "version": source_by_id["rust-analyzer"]["version"], "target": lock["target"], "artifact": artifact(payload / "rust-analyzer", "rust-analyzer", "rust-analyzer"), "source_id": "rust-analyzer"},
        {"descriptor_id": "typescript-language-server", "runtime_id": "node", "language": "typescript", "version": source_by_id["typescript-language-server"]["version"], "target": lock["target"], "artifact": artifact(node, "node", "node"), "source_id": "node"},
        {"descriptor_id": "javascript-language-server", "runtime_id": "node", "language": "javascript", "version": source_by_id["typescript-language-server"]["version"], "target": lock["target"], "artifact": artifact(node, "node", "node"), "source_id": "node"},
    ],
}
(dest / "bundle-input.json").write_text(json.dumps(manifest_input, sort_keys=True) + "\n", encoding="utf-8")
(dest / "sbom.cdx.json").write_text(json.dumps({"bomFormat": "CycloneDX", "specVersion": "1.5", "components": [{"type": "application", "name": source["id"], "version": source["version"], "licenses": [{"license": {"id": source["license_id"]}}]} for source in sources]}, sort_keys=True) + "\n", encoding="utf-8")
PY

echo "Prepared verified Linux semantic bundle input at $DEST_DIR"
