# Linux Release Publisher and Bootstrap

Status: Phase 06 complete (2026-09-04). This guide describes the central GitHub
publisher and the non-root bootstrap for the Fedora 44 x86_64 systemd release.
The runtime manifest and manager rules remain authoritative in [Linux Release
Manifest v1](./linux-release-manifest.md) and [Linux Release Manager](./linux-release-manager.md).

## Release boundary

The protected stable tag `vX.Y.Z` is the release identity. The publisher checks
that the tag, `server/Cargo.toml`, and `apps/web/package.json` are the same
stable `MAJOR.MINOR.PATCH`; optional `--bin` checks also require each compiled
binary's `--version` output to contain that version. The product profile declared
by the generated manifest is:

| Field           | Value                                                        |
| --------------- | ------------------------------------------------------------ |
| Archive         | `dam-hopper-vX.Y.Z-fedora44-x86_64-systemd.tar.gz`           |
| Target          | `x86_64-unknown-linux-gnu`                                   |
| OS/ABI contract | Fedora 44, glibc >= 2.43, systemd >= 259                     |
| Roles           | `server`, `web`, `both` projections                          |
| Authority       | protected `vX.Y.Z` tag; no `latest` asset or mutable pointer |

The desktop workflow is isolated under `desktop-v*`. It may create a desktop
draft release, but it is not the stable Linux publisher. The stable workflow
owns only exact SemVer tags after its metadata gate.

## Publisher DAG

`.github/workflows/release-linux.yml` is the central publisher. It keeps build
jobs read-only, carries final bytes between jobs, and grants `contents: write`
only to the final publish job:

```text
vX.Y.Z push or manual tag input
          |
          v
validate-metadata
  exact tag regex + Cargo/web version alignment
       /                         \
      v                           v
build-rust                    build-web
three vendored Rust bins      frozen pnpm9/Node20 web dist
      \                         /
       v                       v
package-release
  download inputs -> archive twice -> compare SHA-256
  -> generate manifest + SPDX SBOM -> stage installer
  -> local exact-four-asset gate -> upload one artifact
          |
          v
attest-release
  GitHub build provenance for all four final subjects
          |
          v
publish-release (linux-release environment approval)
  create draft -> query remote assets -> exact remote gate -> undraft once
```

A dry run (`workflow_dispatch` with `dry_run=true`) executes through packaging,
local gate, and attestation; `publish-release` is skipped. A stable push has the
same graph and publishes only after the protected `linux-release` environment
approves. External repository settings must still enforce protected stable tags
and immutable releases; the workflow does not itself change those settings.

## Final public asset set

The draft and public release must contain exactly these non-empty files, sorted by
name by `check-release-assets.mjs`:

| Name                                                  | Contents                      | Provenance       |
| ----------------------------------------------------- | ----------------------------- | ---------------- |
| `dam-hopper-install.sh`                               | caller-side bootstrap script  | attested subject |
| `dam-hopper-vX.Y.Z-fedora44-x86_64-systemd.tar.gz`    | one immutable runtime archive | attested subject |
| `release-manifest.json`                               | external Manifest v1 metadata | attested subject |
| `dam-hopper-vX.Y.Z-fedora44-x86_64-systemd.spdx.json` | SPDX 2.3 SBOM                 | attested subject |

The manifest is intentionally outside the archive. It contains the archive
filename, size, and digest, so embedding it would create a digest cycle. GitHub
generated source archives are not product assets and are not consumed by the
manager or bootstrap.

## Build inputs and checks

### Metadata and binaries

`validate-metadata` resolves `github.ref_name` (or the manual `tag` input),
requires `^v[0-9]+\.[0-9]+\.[0-9]+$`, and runs:

```bash
node deploy/release/check-version-alignment.mjs vX.Y.Z
```

`build-rust` builds all three binaries with release optimizations, the
`vendored` feature, and target `x86_64-unknown-linux-gnu`, then runs each
binary's `--version`. `build-web` installs with `pnpm install --frozen-lockfile`
using pnpm 9 and Node 20, builds `@dam-hopper/web`, requires `apps/web/dist/index.html`,
and rejects the host-specific `VITE_DAM_HOPPER_SERVER_URL` string in the output.

### Archive assembly

`deploy/release/build-release-archive.sh` takes `--version`, `--target-dir`,
`--web-dist`, `--output-dir`, and `--source-date-epoch`. It stages only:

- `bin/dam-hopper-manager` (from `dam-hopper` or `dam-hopper-manager`),
  `bin/dam-hopper-server`, and `bin/dam-hopper-web`;
- API, web, and recovery systemd templates under `systemd/`;
- `sysusers.d/dam-hopper-web.conf`;
- `LICENSE`; and
- the built web tree under `web/`.

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
parses a bounded Manifest v1 payload, applies cross-field invariants, then
inspects every gzip/tar entry for exact path set, kind, mode, size, and digest.

The generated inventory maps manager and recovery assets to `common`, API
assets to `server`, and web binary/assets, web unit, and sysusers input to
`web`. `server` projects `common + server`; `web` projects `common + web`; and
`both` includes the complete inventory. No machine-local environment, token,
credential, mutable URL, or application database may enter the archive.

## Asset gates and attestations

`deploy/release/check-release-assets.mjs` supports a local directory gate and a
remote GitHub release gate:

- local mode requires exactly the four expected filenames, rejects extra visible
  files and empty files, computes each local size/SHA-256, checks manifest tag,
  archive name/size/digest, checks bootstrap `bash -n`, and requires SBOM
  `spdxVersion` `SPDX-2.3`;
- remote mode reads GitHub asset metadata (via `gh api` or `--assets-json`),
  requires exactly those names, `state: uploaded`, nonzero size, and sizes that
  match local outputs.

The workflow runs the local gate before uploading the final artifact and reruns
both local and remote checks after creating the private draft. The attestation
job uses `actions/attest-build-provenance` for the installer, archive, manifest,
and SBOM. Attestation verification is an additional authenticity check; the
manifest/archive SHA-256 comparison remains mandatory for the manager.

The current remote gate compares the API-reported asset names, upload state, and
sizes; it does not fetch every remote byte to recompute a remote digest. The
local digest checks and GitHub provenance attestations are the corresponding
content and provenance checks.

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
pnpm release:verify
```

The publisher contract integration test exercises real archive creation, Node
manifest generation, role projections, tamper rejection, prohibited-file
rejection, and Rust manager validation. Phase 06 review recorded 24/24 focused
Rust tests and `pnpm release:verify` passing with no compiler or syntax errors.

## Known release boundaries

- The manifest profile is Fedora 44/glibc 2.43/systemd 259, but the current
  `build-rust` job runs on `ubuntu-latest`; protected Fedora-host and dynamic
  glibc evidence remains a later release gate.
- The workflow pins checkout, setup, artifact, and attestation Actions to full
  commit SHAs. `dtolnay/rust-toolchain@stable` and `Swatinem/rust-cache@v2`
  remain mutable review follow-ups.
- Archive reproducibility is enforced with the workflow's fixed epoch. The
  manifest itself has no timestamp; the SBOM uses `SOURCE_DATE_EPOCH` only when
  that variable is present during generation and otherwise records current time.
- Published installer provenance is attested by the publisher, while bootstrap
  verification currently checks manifest and archive attestations only.

For systemd ownership, activation, rollback, and recovery, see [Linux systemd](./linux-systemd.md).
