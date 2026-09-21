# Windows Release Asset Packaging and Bootstrap Installer (Phases 01–02)

Status: Phase 01 asset packaging and Phase 02 PowerShell bootstrap installer complete.

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
| `pnpm release:windows-installer-test` | Run the fixture-backed PowerShell installer integration harness (14 scenarios; Windows only). |
| `pnpm release:verify-windows` | Run Node syntax checks plus PowerShell parser checks for the Windows release scripts. |
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

## PowerShell bootstrap installer (Phase 02)

The published `dam-hopper-install.ps1` is a non-admin, direct-server bootstrap.
It downloads the exact Windows ZIP selected from GitHub release metadata,
checks its positive size and SHA-256 digest, validates the four expected root
files, stages the replacement privately, and never starts the server or
registers a Windows service. The default destination is
`%LOCALAPPDATA%\Programs\dam-hopper`; `bin\dam-hopper-server.exe`, notices,
and the example TOML are installed there. An existing
`dam-hopper.toml` is preserved on upgrades.

Download the script from the same release as the ZIP, inspect it according to
your organization's script trust policy, then invoke it with PowerShell:

```powershell
$tag = "vX.Y.Z"
$installer = Join-Path $env:TEMP "dam-hopper-install.ps1"
Invoke-WebRequest `
  "https://github.com/loidinhm31/dam-hopper/releases/download/$tag/dam-hopper-install.ps1" `
  -OutFile $installer

# Exact release, default per-user destination
powershell -NoProfile -ExecutionPolicy Bypass -File $installer -Version $tag

# Latest stable release and optional User PATH update
powershell -NoProfile -ExecutionPolicy Bypass -File $installer -Latest -AddToPath
```

Supported command parameters:

| Parameter | Meaning |
| --- | --- |
| `-Version vX.Y.Z` | Install one stable `vMAJOR.MINOR.PATCH` release. Mutually exclusive with `-Latest`. |
| `-Latest` | Resolve the latest stable release. Mutually exclusive with `-Version`. |
| `-InstallDir <absolute-path>` | Override the default `%LOCALAPPDATA%\Programs\dam-hopper` destination. |
| `-AddToPath` | Add `<InstallDir>\bin` to the invoking user's PATH, without elevation or Machine PATH changes. Open a new shell after a change. |
| `-VerifyAttestation` | Require `gh` and verify the downloaded ZIP; when published, also verify the installer asset. A missing/failed attestation aborts before install. |
| `-DryRun` | Resolve metadata, download, hash, and inspect the archive, then report paths without writing files, config, PATH, or processes. |
| `-?` / `-Help` | Show usage. |

Examples for a custom destination, provenance check, and no-write check:

```powershell
# Install to an absolute custom directory
powershell -NoProfile -ExecutionPolicy Bypass -File $installer `
  -Version $tag -InstallDir "C:\Tools\dam-hopper"

# Require GitHub artifact attestations (requires gh in PATH)
powershell -NoProfile -ExecutionPolicy Bypass -File $installer `
  -Version $tag -VerifyAttestation

# Verify the release without changing the destination or User PATH
powershell -NoProfile -ExecutionPolicy Bypass -File $installer `
  -Version $tag -InstallDir "C:\Tools\dam-hopper" -DryRun
```

After installation, launch the server explicitly with the generated config:

```powershell
$installDir = Join-Path $env:LOCALAPPDATA "Programs\dam-hopper"
& "$installDir\bin\dam-hopper-server.exe" `
  --config "$installDir\dam-hopper.toml"
```

The installer uses the release asset's metadata as the digest authority and
does not trust a checksum embedded only inside the ZIP. It accepts
`GITHUB_REPOSITORY=OWNER/REPO` only when it matches the validated owner/name
shape. The loopback API override used by tests is not an end-user option.
Windows direct-server operation is intentionally separate from Linux systemd,
Manifest v2, manager migration, and suspend workflows.

## Installer and fixture verification

Run the focused integration harness on Windows PowerShell 5.1 (the installer
syntax remains PowerShell 7-compatible) with Node 20+ and pnpm available:

```powershell
# Local loopback fixture; no production release or external network is used
pnpm release:windows-installer-test

# Node syntax plus PowerShell parser checks for the Windows release scripts
pnpm release:verify-windows
```

`release:windows-installer-test` invokes
`tests/deploy/windows-release-install.ps1`, which creates a temporary
loopback fixture using
`tests/deploy/windows-release-install-fixture.mjs`. It covers 14 scenarios:
clean install, upgrade/config preservation, `-Latest`, `-DryRun`, digest and
size mismatch, traversal/directory/extra/missing ZIP members, invalid
arguments, User PATH idempotence, non-loopback HTTP rejection, and locked
binary upgrade cleanup. The harness restores User PATH, stops the fixture, and
removes its temporary workspace in `finally` cleanup.

For the package contract and reproducibility checks, also run
`pnpm release:windows-check-assets`, `pnpm release:windows-package-twice`,
and the focused asset-gate test documented above. `release:verify-windows` is a
syntax gate; it does not prove a live installation.

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
