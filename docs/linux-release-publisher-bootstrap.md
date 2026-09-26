# Linux Release Publisher and Bootstrap

Status: Phase 03 cross-platform Release CI and guidance are complete
(2026-09-21); Phase 06 Linux migration-gate qualification was approved on
2026-09-13. This guide describes the central GitHub publisher and the non-root
bootstrap for the Linux x86_64 systemd release.
The runtime manifest and manager rules remain authoritative in [Linux Release
Manifest v2](./linux-release-manifest.md) and [Linux Release Manager](./linux-release-manager.md).

## Release boundary

The protected stable tag `vX.Y.Z` is the release identity. The publisher checks
that the tag, `server/Cargo.toml`, and `apps/web/package.json` are the same
stable `MAJOR.MINOR.PATCH`; optional `--bin` checks also require each compiled
binary's `--version` output to contain that version. The product profile declared
by the generated manifest is:

| Field           | Value                                                        |
| --------------- | ------------------------------------------------------------ |
| Archive         | `dam-hopper-vX.Y.Z-linux-x86_64-systemd.tar.gz`              |
| Target          | `x86_64-unknown-linux-gnu`                                   |
| OS/ABI contract | Linux, glibc >= 2.39, systemd >= 245                        |
| Roles           | `server`, `web`, `both` projections                          |
| Authority       | protected `vX.Y.Z` tag; no `latest` asset or mutable pointer |

The desktop workflow is isolated under `desktop-v*`. It may create a desktop
draft release, but it is not the stable Linux publisher. The stable workflow
owns only exact SemVer tags after its metadata gate.

## Publisher DAG

`.github/workflows/release-linux.yml` is the central publisher for both Linux and Windows x86_64 release assets. It keeps build and packaging jobs read-only, carries immutable artifact bytes between jobs, and grants `contents: write` only to the final publish job:

```text
vX.Y.Z push or manual tag input
          |
          v
validate-metadata
  exact tag regex + Cargo/web version alignment
       /                               \
      v                                 v
build-rust + build-web             build-rust-windows
  Linux bins + web dist             dam-hopper-server.exe
      |                                 |
      v                                 v
package-release                     package-windows-release
  profile=linux (exact 4)           profile=windows (exact 2)
  archive twice + manifest/SBOM     archive twice + PS1 installer
       \                               /
        v                             v
       attest-release
         GitHub build provenance for all six final subjects
                    |
                    v
       publish-release (linux-release environment approval)
         merge artifacts -> profile=all local/remote gate -> undraft
```

A dry run (`workflow_dispatch` with `dry_run=true`) executes through packaging,
local profile gates, and attestation; `publish-release` is skipped. A stable push has the
same graph and publishes only after the protected `linux-release` environment
approves. External repository settings must still enforce protected stable tags
and immutable releases; the workflow does not itself change those settings.

## Final public asset set

The draft and public release must contain exactly these non-empty files, sorted by
name by `check-release-assets.mjs`:

| Name                                                  | Contents                      | Provenance       |
| ----------------------------------------------------- | ----------------------------- | ---------------- |
| `dam-hopper-install.sh`                               | caller-side bootstrap script  | attested subject |
| `dam-hopper-vX.Y.Z-linux-x86_64-systemd.tar.gz`       | one immutable runtime archive | attested subject |
| `release-manifest.json`                               | external Manifest v2 metadata | attested subject |
| `dam-hopper-vX.Y.Z-linux-x86_64-systemd.spdx.json`    | SPDX 2.3 SBOM                 | attested subject |

The manifest is intentionally outside the archive. It contains the archive
filename, size, and digest, so embedding it would create a digest cycle. GitHub
generated source archives are not product assets and are not consumed by the
manager or bootstrap.

### Windows direct-server profile and bootstrap installer (Phases 01–03)

The Windows release is a separate direct-server package, not a systemd or
Manifest v2 projection. It contains exactly two public assets:

| Name | Contents |
| --- | --- |
| `dam-hopper-install.ps1` | PowerShell bootstrap script; syntax-checked, not executed by the gate |
| `dam-hopper-vX.Y.Z-windows-x86_64.zip` | Deterministic ZIP with exactly four root files |

The ZIP members are `dam-hopper-server.exe`, `dam-hopper.example.toml`,
`LICENSE`, and `README.md`. It must not contain Linux units,
`release-manifest.json`, or an SPDX SBOM. A combined publication uses
`--profile all` and must contain the exact six-asset union: these two Windows
assets plus the four Linux assets above. See
[Windows Release Asset Packaging](./windows-release-packaging.md) for the
profile grammar, package scripts, ZIP checks, and reproducibility harness.

The Windows package does not claim native/Tauri S13 runtime qualification.


The Windows profile is a direct-server installation, not a Linux role or
systemd deployment. Its PowerShell bootstrap accepts exactly one release
selector and keeps all writes user-scoped:

```text
dam-hopper-install.ps1 (-Version vX.Y.Z | -Latest)
  [-InstallDir <absolute-path>]
  [-AddToPath]
  [-VerifyAttestation]
  [-DryRun]
```

`-InstallDir` defaults to `%LOCALAPPDATA%\Programs\dam-hopper`.
`-AddToPath` changes only the invoking user's PATH and requires a new shell;
`-VerifyAttestation` requires `gh`; and `-DryRun` performs metadata/archive
verification without changing files, config, PATH, or processes. The installer
preserves an existing `dam-hopper.toml`, does not start the server, and checks
the release asset's size and SHA-256 before extraction. See
[Windows Release Asset Packaging](./windows-release-packaging.md) for
copyable commands, launch/config behavior, and focused installer tests.

The local Windows harness is:

```powershell
pnpm release:windows-gate-test
pnpm release:windows-installer-test
pnpm release:verify-windows
```

The first command checks the profile-aware asset contract locally; the second
uses a loopback Node fixture and temporary artifacts without contacting a
production release. The third is a syntax/parser gate.

## Build inputs and checks

### Metadata and binaries

`validate-metadata` resolves `github.ref_name` (or the manual `tag` input),
requires `^v[0-9]+\.[0-9]+\.[0-9]+$`, and runs:

```bash
node deploy/release/check-version-alignment.mjs vX.Y.Z
```

`build-rust` invokes Cargo's `--bins` build with release optimizations, the
`vendored` feature, and target `x86_64-unknown-linux-gnu`. The workflow checks
`--version` output and uploads all five Linux release binaries, including
`dam-hopper-plugin-runner`; downloaded binaries have executable mode restored
before packaging. `build-web` installs with
`pnpm install --frozen-lockfile` using pnpm 10 and Node 24, builds
`@dam-hopper/web`, requires `apps/web/dist/index.html`, and rejects the
host-specific `VITE_DAM_HOPPER_SERVER_URL` string in the output.

### Archive assembly

`deploy/release/build-release-archive.sh` takes `--version`, `--target-dir`,
`--web-dist`, `--output-dir`, and `--source-date-epoch`. It stages:

- `bin/dam-hopper-manager` (from `dam-hopper` or `dam-hopper-manager`),
  `bin/dam-hopper-server`, `bin/dam-hopper-web`,
  `bin/dam-hopper-idle-suspend-helper`, and
  `bin/dam-hopper-plugin-runner`;
- API, web, recovery, helper, and plugin-runner systemd files under `systemd/`;
- `tmpfiles.d/dam-hopper-plugin-runner.conf`;
- `sysusers.d/dam-hopper-web.conf`;
- `LICENSE`; and
- the built web tree under `web/`.

The stable release packager requires and copies the helper binary and service;
local checked-in template fallbacks do not make release assets optional. The
helper socket unit remains an optional archive asset.

The plugin-runner binary, service, and tmpfiles input are mandatory in every
Linux archive. The packager preflights them before staging and copies them
unconditionally: the binary is mode `0755`, and the service/tmpfiles files are
mode `0644`. `check-release-assets.mjs` requires all three inventory paths,
their `server` role and regular-file kind, and an execute bit on the binary.
The archive contains these `server`-role entries for every release; the
`server` and `both` role projections include them, while `web` excludes them
when the manager extracts a role view.

The package also includes `bin/node` (server role, `0755`) and its distribution
license in `NOTICES` (common role, `0644`). The Linux packaging job selects Node
`24.16.0`; local builders can supply `NODE_BIN` and `NODE_LICENSE`, or use their
active Linux x64 Node distribution (minimum 22.19). Both files are mandatory
publisher inventory entries. Rendered runner units use the absolute release
Node path, so service users need no separately installed Node or shell PATH.


Staged directories are `0755`, binaries `0755`, and other regular files `0644`.
The script sets every mtime to the selected epoch, sorts the file list under
`LC_ALL=C`, and creates a GNU tar archive with numeric uid/gid zero,
`--format=posix`, `--sort=name`, fixed `--mtime`, deleted atime/ctime PAX
metadata, and `--no-recursion`. `gzip -n -9` removes the gzip timestamp. The
archive is therefore independent of staging directory names, owner names,
filesystem traversal order, and wall-clock time when the same inputs and epoch
are used.

The release workflow runs the script twice in separate output directories with
`SOURCE_DATE_EPOCH=1700000000` and blocks unless the two archive SHA-256 values
are identical. Local invocations use an explicit epoch for the same guarantee;
when omitted, the script uses the latest repository commit timestamp (or a
fixed fallback outside a Git worktree).

### Manifest and SBOM

After the final archive bytes exist,
`deploy/release/generate-release-manifest.mjs`:

1. hashes the archive and records its exact byte size;
2. extracts it into a temporary directory and inspects `tar -ztvf` output with
   `LC_ALL=C`;
3. rejects disallowed runtime/database names (`.env*`, `server.env`, tokens,
   TOML runtime config, SQLite/DB suffixes), skips packaging-only parent
   directories, rejects duplicate paths, and assigns every entry a role;
4. sorts inventory entries by path and writes LF-terminated pretty JSON; and
5. writes an SPDX 2.3 JSON document listing the archive package and SHA-256
   checksums for inventory files.

The manifest fixes profile, component, service, and rollback values and writes
`release-manifest.json` plus the tag-specific SBOM into the output directory.
The Rust manager remains the second validator: `validate_manifest_and_archive`
parses a bounded Manifest v2 payload, applies cross-field invariants, then
inspects every gzip/tar entry for exact path set, kind, mode, size, and digest.

The generated inventory maps manager and recovery assets to `common`, API
assets to `server`, and web binary/assets, web unit, and sysusers input to
`web`. `server` projects `common + server`; `web` projects `common + web`; and
`both` includes the complete inventory. No machine-local environment, token,
credential, mutable URL, or application database may enter the archive.

## Asset gates and attestations

`deploy/release/check-release-assets.mjs` supports local and remote GitHub
asset gates for Linux, Windows, or the combined publication set. The
`--profile <linux|windows|all>` flag selects the exact contract and defaults
to `linux`:

- `linux` requires exactly the four Linux filenames, validates shallow Manifest
  v2 structure and whole-file digests, checks the Bash bootstrap with `bash -n`,
  and requires SBOM `spdxVersion` `SPDX-2.3`;
- `windows` requires exactly `dam-hopper-install.ps1` and
  `dam-hopper-vX.Y.Z-windows-x86_64.zip`, validates PowerShell syntax and the
  ZIP's exact four root members, CRC, bounds, and EOCD/trailing-byte rules;
- `all` requires the exact six-name union and applies Linux migration checks
  when migration evidence is requested or required.

Remote mode reads GitHub asset metadata (via `gh api` or `--assets-json`) and
requires unique names, `state: uploaded`, positive sizes, and matching
SHA-256 values. Migration evidence is rejected for the Windows-only profile.

- migration mode requires `--migration-evidence PATH --require-migration-gate`
  and `--dir` so evidence binds to real publication bytes. The evidence
  environment is fixed to `production`, expires within 24 hours, and contains
  1..1,024 unique manager targets (Manifest v2 plus manager-state v1), with
  manager IDs bounded to 128 UTF-8 bytes. Its forward manifest and archive
  must resolve to the exact local release files. Its rollback manifest and
  archive must be separate files in one publication directory, describe a
  semantically older release, match their declared archive bytes, and differ
  from the source manifest bytes. Manager attestation digests must match the
  published manager inventory entry. Active v2 assets cannot be paired with a
  manager downgrade.


The checker is a bounded shallow publication gate: it validates evidence
structure, release identity, manifest structure, whole-file digests, and path
binding, but does not inspect archive entries against manifest inventory. The
Rust manager's `validate_manifest_and_archive` deep archive validator must run
before release approval. The `verified` and `signed` fields are not a
cryptographic trust root: an operator or external verifier must produce them.
The repository does not yet embed a GitHub DSSE/certificate trust root or an
authoritative target-inventory feed, so the checker does not claim to
authenticate those records independently. Missing external evidence therefore
remains a release-blocking condition.

The release owner can verify release assets using profile-specific commands or the combined publication gate:

```bash
# Verify Linux profile (exact 4 assets)
node deploy/release/check-release-assets.mjs --profile linux --tag vX.Y.Z --dir artifacts/final

# Verify Windows profile (exact 2 assets)
node deploy/release/check-release-assets.mjs --profile windows --tag vX.Y.Z --dir artifacts/final

# Verify combined release (exact 6 assets, with optional Linux migration gate)
node deploy/release/check-release-assets.mjs \
  --profile all \
  --tag vX.Y.Z \
  --dir artifacts/final \
  --migration-evidence path/to/migration-evidence.json \
  --require-migration-gate
```

In the protected `publish-release` job, the checker runs with `--profile all` and verifies that all six local and remote release assets match in name, positive size, and SHA-256 digest before undrafting.

The attestation job uses `actions/attest-build-provenance` for all six published release subjects: the Linux installer, runtime archive, manifest, and SPDX SBOM, plus the Windows installer and deterministic ZIP archive. Target-manager capability evidence and the forward/rollback migration records remain separate owner inputs until an external verifier and authoritative inventory source are integrated.

## Release operator checklist and v0.5.1 advisory

### v0.5.1 release checklist

The published v0.5.0 Linux archive contains
`systemd/dam-hopper-plugin-runner.service` but omits its
`bin/dam-hopper-plugin-runner` `ExecStart` target. Staging `server` or `both`
fails closed at `systemd-analyze verify`; the `web` role is unaffected. Source
fixes cannot repair the already-published archive.

Before publishing the required patch release:

1. Set `server/Cargo.toml` and `apps/web/package.json` to `0.5.1`; confirm the
   release tag and both package versions align.
2. Run the local release checks and deterministic package gate with the actual
   Linux build outputs:

   ```bash
   node deploy/release/check-version-alignment.mjs v0.5.1
   pnpm release:verify
   pnpm release:package-twice --version v0.5.1 \
     --target-dir artifacts/bin \
     --web-dist apps/web/dist \
     --output-dir artifacts/final
   node deploy/release/check-release-assets.mjs \
     --profile linux --tag v0.5.1 --dir artifacts/final
   ```

3. Confirm the archive has `bin/dam-hopper-plugin-runner` mode `0755`,
   `systemd/dam-hopper-plugin-runner.service` and
   `tmpfiles.d/dam-hopper-plugin-runner.conf` mode `0644`, and all three
   `server`-role inventory entries. Missing any path must block packaging or
   the asset gate.
4. Run the tagged release workflow's dry run, then publish the protected
   `v0.5.1` release only after its package-twice, manifest, asset, and
   attestation gates pass. The normal publisher owns the immutable release
   asset set; do not reuse `v0.5.0` or replace its archive/digest.
5. Publish an operator notice with the patch release:

   > Linux v0.5.0 omitted `bin/dam-hopper-plugin-runner` although its systemd
   > unit was present. Linux `server` and `both` staging fails unit verification.
   > Use v0.5.1 or later for these roles; web-only installs are unaffected.

Until v0.5.1 is published, operators must not use v0.5.0 for Linux `server` or
`both` installations. After publication, stage the exact v0.5.1 bundle using
the normal [Linux Release Manager](./linux-release-manager.md) install/upgrade
flow; do not hand-edit the unit or substitute an unversioned runner binary.

## Bootstrap installer

`deploy/release/dam-hopper-install.sh` downloads as the invoking user and uses
`sudo` only for the manager staging operation. It requires `curl`, `sha256sum`,
and `tar`; `gh` is required only when `--verify-attestation` is selected.

```bash
# Download the exact release's bootstrap, then stage the server role.
curl -fsSL https://github.com/loidinhm31/dam-hopper/releases/download/v0.2.0/dam-hopper-install.sh \
  -o /tmp/dam-hopper-install.sh
bash /tmp/dam-hopper-install.sh --version v0.2.0 --role server

# The script can resolve the latest stable release itself.
bash /tmp/dam-hopper-install.sh --latest --role web \
  --allow-web-origin https://damhopper.example.com \
  --allow-web-origin http://localhost:4802

# Optional provenance verification (requires gh).
bash /tmp/dam-hopper-install.sh --version v0.2.0 --role both \
  --verify-attestation
```

Supported grammar is:

```text
dam-hopper-install.sh (--version vX.Y.Z | --latest)
  --role server|web|both
  [--allow-web-origin ORIGIN ...]
  [--verify-attestation]
```

`--version` and `--latest` conflict; `--role` is always required. The current
bootstrap does not accept `--api-url`; web API origin setup remains the existing
client-side server-profile flow. `GITHUB_REPOSITORY=owner/name` may override the
repository default for controlled mirrors.

The execution sequence is:

1. resolve an exact stable tag (`--latest` uses GitHub's latest-release API);
2. download only `release-manifest.json` and the exact profile archive into a
   mode-`0700` temporary directory;
3. compare archive SHA-256 with the manifest's declared digest;
4. when requested, run `gh attestation verify` for the manifest and archive
   against the selected repository;
5. extract only `bin/dam-hopper-manager` to a private temporary directory;
6. invoke `dam-hopper install --bundle ... --role ...` through interactive
   `sudo`, forwarding origins and attestation mode; and
7. remove temporary files with a trap and report the candidate as `PENDING`.

Bootstrap never starts, enables, reloads, or health-probes application units. On
success run:

```bash
sudo dam-hopper start
dam-hopper status --json
```

The manager then performs host platform checks, strict manifest/archive
validation, role projection, and durable pending-state writes. `fetch` remains
the non-root manager-native alternative when a bundle should be acquired before
root staging.

## Local checks

The root `package.json` exposes focused release commands:

```bash
pnpm release:check-version [vX.Y.Z]
pnpm release:archive -- --version vX.Y.Z --target-dir ... --web-dist ...
pnpm release:manifest -- --archive ... --tag vX.Y.Z --commit <40-char-sha>
pnpm release:check-assets -- --dir ... --tag vX.Y.Z
pnpm release:check-assets -- --profile all --dir ... --tag vX.Y.Z
pnpm release:check-assets -- --dir ... --tag vX.Y.Z \
  --migration-evidence path/to/migration-evidence.json \
  --require-migration-gate
pnpm release:windows-archive -- --tag vX.Y.Z
pnpm release:windows-check-assets -- --tag vX.Y.Z --dir artifacts/windows
pnpm release:windows-package-twice -- -Version vX.Y.Z
pnpm release:verify-windows
pnpm release:verify
```

`release:windows-package-twice` builds the Windows ZIP twice, compares bytes
and SHA-256, confirms an altered epoch changes the digest, stages the two
Windows assets, and runs the Windows profile gate. `release:verify-windows`
checks Node syntax for the Windows packager and profile-aware checker.

The publisher contract integration test exercises real archive creation, Node
manifest generation, role projections, tamper rejection, prohibited-file
rejection, Rust manager validation, and the migration gate's fresh
manager-first evidence. The Phase 03 fixture rejects mixed manager capability,
stale or unsigned evidence, schema-v1 manifests, and reused rollback bytes.
The final bounded Phase 03 qualification (2026-09-13) recorded 84 passed, 0
failed, and 0 ignored across the seven focused Rust integration suites.
`pnpm release:verify` passed, and `pnpm test:deploy` passed all six deployment
journeys. This evidence qualifies the bounded checker and runtime path only; it
does not establish stable publication, external trust-root verification,
authoritative target-inventory integration, or workflow deep validation.

## Known release boundaries

- The manifest profile is Linux/glibc 2.39/systemd 245, while the current
  `build-rust` job runs on `ubuntu-latest`; target-host and dynamic glibc
  evidence remains a later release gate.
- The workflow pins checkout, setup, artifact, and attestation Actions to full
  commit SHAs. `dtolnay/rust-toolchain@stable` and `Swatinem/rust-cache@v2`
  remain mutable review follow-ups.
- Archive reproducibility is enforced with the workflow's fixed epoch. The
  manifest itself has no timestamp; the SBOM uses `SOURCE_DATE_EPOCH` only when
  that variable is present during generation and otherwise records current time.
- Published installer provenance is attested by the publisher, while bootstrap
  verification currently checks manifest and archive attestations only.

For systemd ownership, activation, rollback, and recovery, see [Linux systemd](./linux-systemd.md).
