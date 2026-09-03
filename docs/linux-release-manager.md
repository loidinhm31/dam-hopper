# Linux Release Manager (Phase 02)

Status: Phase 02 implementation complete and reviewed (2026-09-03). The
manager provides unprivileged acquisition and root-only validation/staging for
the Fedora 44 x86_64 systemd release profile. Activation, unit installation,
health checks, rollback, and crash recovery remain later-phase behavior.

This guide documents the executable and the safe handoff between a downloaded
bundle and a pending role view. The manifest field contract remains in
[Linux Release Manifest v1](./linux-release-manifest.md).

## Prerequisites and trust boundary

The v1 target profile is fixed:

| Requirement | Value |
| --- | --- |
| Operating system | Fedora 44 (`ID=fedora`, `VERSION_ID=44`) |
| CPU | x86_64 |
| GNU target | `x86_64-unknown-linux-gnu` |
| glibc | 2.43 or newer |
| systemd | 259 or newer, running as the system manager (PID 1) |
| Network | HTTPS access to the public DamHopper GitHub release |
| Optional tool | `gh` for GitHub attestation verification only |

A target host does not need the repository checkout, Node.js, pnpm, Cargo, or
Rust. The manager contains the HTTP, gzip/tar, manifest, and SHA-256 logic. The
`gh` executable is never required for ordinary checksum verification.

Acquisition and installation have intentionally different privilege boundaries:

- `fetch` must run as a non-root user. Network access, GitHub JSON parsing, and
  downloads therefore do not run with host privileges.
- `install` and `role set` run as root and copy already-downloaded bytes into a
  root-only transaction directory. The manager reopens bundle inputs without
  following symlinks, hashes the copied archive, validates the manifest and
  archive, and extracts only the requested role projection.
- `status` and `version` are read-only and may run under either EUID.
- The API unit is specified as running as `root` for the v1 MVP owner decision;
  the dedicated web unit uses the unprivileged `dam-hopper-web` identity. This
  is a release contract, not a general recommendation for host services.

The existing guarded systemd runner and its format-2 server-only marker remain
separate from this manager. See [Linux systemd](./linux-systemd.md) for that
legacy deployment boundary.

## Command grammar

The packaged executable is invoked as `dam-hopper` (the release inventory names
its common binary `bin/dam-hopper-manager`). The source binary can be exercised
from a checkout with:

```bash
cargo run --manifest-path server/Cargo.toml --bin dam-hopper -- ...
```

```text
dam-hopper fetch (--version vX.Y.Z | --latest) --output DIR [--verify-attestation]
sudo dam-hopper install --bundle DIR [--role server|web|both]
    [--allow-web-origin ORIGIN ...] [--verify-attestation]
sudo dam-hopper role set ROLE --bundle DIR
    [--allow-web-origin ORIGIN ...] [--verify-attestation]
sudo dam-hopper start
dam-hopper status [--json]
sudo dam-hopper rollback
sudo dam-hopper recover
dam-hopper version
```

`--version` and `--latest` conflict. The runtime requires one of them; omitting
both causes `fetch` to fail before a release is written. `--output` and
`--bundle` are required paths. `--allow-web-origin` may be repeated.

### Privilege matrix

| Command | EUID | Phase 02 behavior |
| --- | --- | --- |
| `fetch` | non-zero | Resolve/download/verify a release bundle |
| `install` | 0 | Validate host, select/inherit role, stage a candidate |
| `role set` | 0 | Change recorded role and stage that role's candidate |
| `start` | 0 | Grammar exists; activation/start is deferred to Phase 05 |
| `status` | any | Read host and pending metadata |
| `rollback` | 0 | Grammar exists; rollback is deferred to Phase 05 |
| `recover` | 0 | Grammar exists; recovery is deferred to Phase 05 |
| `version` | any | Print manager version, profile, and schema |

The parser has no `--api-url` or separate `activate` command. Web and both-role
installs leave server URL setup to the existing client-side server-profile
flow.

### Fetch

```bash
dam-hopper fetch --version v0.2.0 --output "$HOME/.cache/dam-hopper/v0.2.0"
# or
dam-hopper fetch --latest --output "$HOME/.cache/dam-hopper/latest" \
  --verify-attestation
```

`--latest` is resolved once through the GitHub Releases API to an exact stable
`vX.Y.Z` tag. Drafts and prereleases are rejected. The manager then downloads
`release-manifest.json` and the exact archive named by the manifest contract:

```text
dam-hopper-vX.Y.Z-fedora44-x86_64-systemd.tar.gz
```

The manifest is bounded to 1 MiB and the archive response to 500 MiB. Requests
use HTTPS, a five-redirect maximum, a 10-second connect deadline, and a
300-second request deadline. Initial and redirected hosts must be in the
GitHub-related allowlist enforced by the acquisition client.

The manager parses and validates the manifest before accepting the archive. It
hashes the downloaded archive with SHA-256 and requires equality with
`manifest.archive.sha256`. On success, the output directory contains:

- `release-manifest.json` — validated metadata;
- the exact `.tar.gz` archive; and
- `acquisition.json` — tag, repository, manifest/archive digests, fetch time,
  and whether attestation verification succeeded.

With `--verify-attestation`, the manager executes `gh attestation verify` for
both files, using the fixed repository `loidinhm31/dam-hopper`, a cleared
environment, a fixed `PATH`, and closed stdin. Attestation is optional; the
manifest/archive SHA-256 comparison is mandatory.

### Install and role set

```bash
# First install: role is required.
sudo dam-hopper install --bundle "$HOME/.cache/dam-hopper/v0.2.0" \
  --role server

# A web role can have more than one exact browser origin.
sudo dam-hopper install --bundle /var/tmp/dam-hopper-bundle \
  --role web \
  --allow-web-origin https://damhopper.example.com \
  --allow-web-origin http://localhost:4802

# Change the recorded role explicitly.
sudo dam-hopper role set both --bundle /var/tmp/dam-hopper-bundle
```

A fresh `install` requires `--role server|web|both`. Once `host.toml` records a
role, an upgrade without `--role` inherits it; `install --role` cannot silently
change that role. `role set` is the explicit role-change path. Existing origins
are retained unless one or more `--allow-web-origin` values are supplied.

An origin must be an exact `http://` or `https://` origin. Userinfo, paths other
than `/`, query strings, fragments, wildcards, empty hosts, invalid ports, and
duplicates are rejected. Values are trimmed and normalized before persistence.

Phase 02 install only creates a pending candidate. It does **not**:

- switch `/opt/dam-hopper/current`;
- modify active or rollback metadata;
- install, enable, start, stop, or reload systemd units;
- open listeners or perform health probes; or
- remove the currently active release.

The dispatcher prints the later `sudo dam-hopper start` handoff after a
successful stage. The current `start`, `rollback`, and `recover` handlers are
placeholders until their Phase 05 state machine lands.

### Status and version

```bash
dam-hopper status
dam-hopper status --json
dam-hopper version
```

Human-readable status reports the recorded role/origins and pending tag/role/
stage time. `status --json` emits only `hostConfig` and `pending` metadata; it
must not expose environment files, tokens, archive contents, or command output.
`version` reports the Cargo package version, `fedora44-x86_64-systemd` profile,
and manifest schema version.

## Filesystem layout

`Layout::new` uses the host root. Tests use `Layout::with_root` so all paths are
under a temporary root and no host files are changed.

| Path | Purpose | Phase 02 ownership/behavior |
| --- | --- | --- |
| `/opt/dam-hopper/` | Release installation root | Contains staging, views, and active link |
| `/opt/dam-hopper/.staging/<tx-id>/` | Private transaction workspace | Fresh UUID directory; transaction mode is `0700` |
| `/opt/dam-hopper/releases/<tag>/<role>/` | Unpacked role projection | Destination for the candidate view |
| `/opt/dam-hopper/current` | Active-view symlink | Not touched by Phase 02 |
| `/etc/dam-hopper/host.toml` | Recorded role and exact web origins | Atomically replaced by role resolution |
| `/etc/dam-hopper/server.env` | Machine-local API environment | Reserved; never copied from a release bundle |
| `/etc/dam-hopper/web.env` | Machine-local web environment | Reserved; never copied from a release bundle |
| `/var/lib/dam-hopper/pending.json` | Pending candidate handoff | Written only after staged rename; file and parent are synced |
| `/var/lib/dam-hopper/active.json` | Active release metadata | Reserved for activation phases |
| `/var/lib/dam-hopper/rollback.json` | Previous-release metadata | Reserved for rollback phases |
| `/run/lock/dam-hopper/deploy.lock` | Deployment serialization lock | Nonblocking exclusive `flock` held for staging |

The release path is derived only from the validated tag and selected role. A
role view contains manifest entries with `common` plus the selected role; a
`both` view includes all inventory entries. Runtime/configuration files are
forbidden by the manifest contract, so machine-local state stays outside the
release archive.

## Safe acquisition and staging architecture

The transaction boundary is deliberately narrow:

```text
non-root fetch
  └─ HTTPS GitHub API/assets → manifest + archive + acquisition record
                                   │
                                   ▼
root install / role set
  ├─ acquire deploy.lock (nonblocking)
  ├─ open manifest/archive with no-follow checks
  ├─ parse and validate manifest
  ├─ optional gh attestation verification
  ├─ stream-copy archive to .staging/<tx-id>/ while hashing
  ├─ compare copied SHA-256 with manifest archive digest
  ├─ inspect every gzip/tar entry against exact manifest inventory
  ├─ extract only selected role to .staging/<tx-id>/release/
  ├─ rename transaction release to releases/<tag>/<role>
  └─ fsync and atomically replace pending.json
```

The archive inspector rejects normalized-path violations, duplicate entries,
manifest-set mismatches, disallowed runtime/configuration names, links,
devices, FIFOs, other special entries, wrong file/directory kinds, mode drift,
size drift, and file digest drift. `archive_extract` does not use permissive
`Archive::unpack`; it creates only manifest-declared directories and regular
files, uses `create_new` for files, applies manifest modes, and extracts inside
the newly created transaction tree.

Input manifest and archive paths are checked with `symlink_metadata` and opened
with `O_NOFOLLOW`. The archive is hashed while it is copied into the root stage,
then the staged copy is rewound for independent inventory inspection and role
extraction. A failed transaction removes only its own transaction directory;
it does not follow links or clean unrelated paths.

`pending.json` records the exact tag, role, RFC 3339 stage time, release path,
manifest SHA-256, and archive SHA-256. It is written through a same-directory
temporary file, flushed and file-synced before rename, followed by a best-effort
parent-directory sync. The current active pointer and service ownership remain
unchanged until a later activation command commits them.

Repeated staging of an already-existing `<tag>/<role>` destination currently
removes that destination before the final rename. Activation still does not
occur, but operators should treat a bundle directory and its validated manifest
as the source of truth for each staging attempt.

## Failure handling and diagnostics

Failures are returned as typed `ReleaseError` values. Diagnostics identify only
contract fields, normalized relative paths, operation names, and bounded values;
they must not echo credentials, HTTP headers, or arbitrary file contents. Common
failure classes include unsupported host profile, wrong EUID, invalid origin,
missing role, role conflict, busy deployment lock, invalid bundle, archive
inventory mismatch, digest mismatch, acquisition failure, and attestation
failure.

A failed fetch may leave its caller-selected output directory for inspection;
install cleanup is transaction-scoped. If `pending.json` is absent after an
install error, no candidate handoff was committed. The legacy systemd runner is
not automatically migrated or stopped by Phase 02.

## Verification evidence

The Phase 02 focused release suites passed 45/45 tests across seven suites,
including CLI grammar/privilege checks, Fedora/profile and origin checks,
acquisition boundaries, archive traversal and role projection, staging,
deployment-lock contention, and pending-state persistence. The scoped manager
compile/check and reviewer gate were also approved. Run the focused suites from
`server/` when changing this contract; the full release validation gate belongs
to the release owner.
