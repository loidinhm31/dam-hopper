# Windows Release Asset Packaging (Phase 01)

Status: Phase 01 asset specification and packaging script complete.

This guide defines the direct-server Windows release package. It is separate from
the Linux systemd release: Windows assets do not install or manage systemd units,
and they do not carry Linux Manifest v2 metadata.

## Asset contract

A Windows release is identified by a protected `vX.Y.Z` tag and contains exactly
two public assets:

| Asset | Contract |
| --- | --- |
| `dam-hopper-install.ps1` | PowerShell bootstrap installer; the publication gate parses its syntax. |
| `dam-hopper-vX.Y.Z-windows-x86_64.zip` | Deterministic server package. |

The ZIP must contain exactly these four root-level regular files, with no nested
paths, duplicate names, traversal components, comments, or trailing bytes:

- `dam-hopper-server.exe`
- `dam-hopper.example.toml`
- `LICENSE`
- `README.md`

The archive is a direct-server package. It has no `systemd/` units, Linux role
projection, `release-manifest.json`, or SPDX release SBOM. Windows packaging
therefore does not claim Linux Manifest v2 compatibility or native/Tauri S13
runtime qualification.

When one publication directory carries both platform profiles, the `all`
profile requires this exact six-asset union:

- `dam-hopper-install.sh`
- `dam-hopper-vX.Y.Z-linux-x86_64-systemd.tar.gz`
- `release-manifest.json`
- `dam-hopper-vX.Y.Z-linux-x86_64-systemd.spdx.json`
- `dam-hopper-install.ps1`
- `dam-hopper-vX.Y.Z-windows-x86_64.zip`

Missing or extra visible files fail closed. Hidden entries must also be regular
files; non-regular entries are rejected.

## Asset checker profiles

`deploy/release/check-release-assets.mjs` defaults to the Linux profile. Use
`--profile <linux|windows|all>` to select the contract:

```powershell
# Windows local gate: exact two-asset set, ZIP contents, and PS1 syntax
node deploy/release/check-release-assets.mjs `
  --profile windows --tag vX.Y.Z --dir artifacts/windows

# Combined publication directory: exact Linux + Windows six-asset set
node deploy/release/check-release-assets.mjs `
  --profile all --tag vX.Y.Z --dir artifacts/final
```

The checker supports local directory and remote GitHub metadata gates. Remote
metadata must have unique names, `state: uploaded`, positive sizes, and
SHA-256 values matching local files when local output is supplied. Migration
evidence is a Linux Manifest v2 gate; it is rejected for `--profile windows`.
For `--profile all`, Linux migration requirements still apply when the
publication environment enables the migration gate.

Windows ZIP inspection is bounded and verifies exact member count and names,
root-file paths, compressed/uncompressed bounds, CRC-32, deflate decoding,
central-directory/EOCD boundaries, and absence of trailing bytes. The gate also
runs PowerShell's parser against `dam-hopper-install.ps1`; it does not execute
the installer.

## Packaging and verification commands

The root `package.json` exposes these focused commands:

| Command | Purpose |
| --- | --- |
| `pnpm release:windows-archive -- --tag vX.Y.Z` | Build one deterministic ZIP. Forward `--binary`, `--config-example`, `--license`, `--readme`, `--output-dir`, or `--epoch` when defaults are unsuitable. |
| `pnpm release:windows-check-assets -- --tag vX.Y.Z --dir artifacts/windows` | Run the Windows two-asset gate (`--profile windows` is supplied by the script). |
| `pnpm release:windows-package-twice -- -Version vX.Y.Z` | Run the PowerShell reproducibility harness, then stage and gate the final two assets. |
| `pnpm release:verify-windows` | Node syntax check for the Windows packager and profile-aware asset checker. |
| `pnpm release:verify` | Existing cross-platform release syntax/version checks; it is not a substitute for the Windows package-twice gate. |

`tests/deploy/windows-release-package-twice.ps1` builds the same inputs twice
with one epoch, requires byte-for-byte and SHA-256 equality, confirms a changed
epoch changes the digest, and invokes the Windows asset gate. It uses an
existing Windows release binary when available and otherwise creates a
short-lived deterministic dummy binary for packaging verification only.

The focused JavaScript contract harness covers valid assets, missing/extra ZIP
members, traversal and nested paths, CRC and trailing-byte corruption, malformed
PowerShell, profile rejection of migration evidence, Linux default behavior,
the exact six-asset `all` contract, reproducibility, remote metadata, and paths
containing spaces:

```powershell
node tests/deploy/windows-release-asset-gate.test.mjs
```

## Boundaries and handoff

- The archive is immutable after creation; use one explicit `--epoch` for
  reproducible reruns.
- The packager writes through a temporary file and renames it into the output
  directory, avoiding a partially written final archive.
- The asset gate checks publication bytes and metadata only. It does not start
  the server, install Windows services, configure firewall rules, or verify a
  native desktop/WebView2 runtime.
- Keep Windows direct-server assets distinct from Linux systemd assets. Do not
  add `release-manifest.json`, Linux SBOM, or systemd files to the Windows ZIP.

Linux publisher/bootstrap workflow, Manifest v2, and systemd ownership remain
documented in [Linux Release Publisher and Bootstrap](./linux-release-publisher-bootstrap.md).
