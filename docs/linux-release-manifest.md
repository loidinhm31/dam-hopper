# Linux Release Manifest v1

Status: Phases 01–07 implementation complete and reviewed (2026-09-04). This
document defines Manifest v1 metadata consumed by acquisition, staging, and
durable activation. Phase 03 adds the dedicated web-host binary and
runtime-origin contract; Phase 04 defines role-aware units; Phase 05 adds
health-gated activation, rollback, and crash recovery; Phase 06 adds the
central publisher and bootstrap boundary; Phase 07 keeps legacy format-2
migration as a separate one-time compatibility boundary.

The Rust validator is the runtime authority. The publisher-facing JSON Schema
must remain structurally equivalent to the Rust types and must reject anything
outside this specification:

- Rust types and validation: `server/src/linux_release/`
- Publisher schema: `deploy/release/release-manifest.schema.json`
- Focused contract tests: `server/tests/linux_release_manifest.rs` and
  `server/tests/linux_release_manifest_errors.rs`

## Publisher and bootstrap boundary (Phase 06)

The central publisher emits four external, attested assets: the executable
`dam-hopper-install.sh`, one profile archive, `release-manifest.json`, and the
tag-specific SPDX 2.3 SBOM. The manifest stays outside the archive because it
declares the archive's own size and SHA-256. The publisher assembles the archive
with normalized modes, sorted paths, fixed ownership/mtime, POSIX tar headers,
and timestamp-free gzip, then runs the Rust validator before publication.

The bootstrap downloads the manifest and exact archive as the invoking user,
checks the declared archive digest, optionally verifies GitHub attestations,
extracts only `bin/dam-hopper-manager` into a private temporary directory, and
invokes `install` through `sudo`. It requires an explicit `server`, `web`, or
`both` role and stops at `PENDING`; `--api-url` is not a supported installer
flag, and activation remains an explicit `sudo dam-hopper start`. See [Linux
Release Publisher and Bootstrap](./linux-release-publisher-bootstrap.md) for
the workflow DAG, artifact gate, reproducibility details, and exact grammar.

## Release identity

Phase 01 defines one immutable archive per release:

```text
dam-hopper-vX.Y.Z-fedora44-x86_64-systemd.tar.gz
```

The protected Git tag `vX.Y.Z` is the release authority. Checked-in Cargo and
web package versions are mirrors and must match the tag before publishing; they
are not independent version channels.

`release` contains:

| Field | Contract |
| --- | --- |
| `tag` | `v` followed by stable SemVer, for example `v0.2.0` |
| `version` | Stable `MAJOR.MINOR.PATCH` SemVer, without prerelease or build metadata |
| `commitSha` | Exactly 40 lowercase hexadecimal characters |

The four component versions (`cli`, `api`, `webHost`, `webAssets`) must all
exactly equal `release.version`. A version or tag drift is a release failure,
not a warning.

## Manifest shape

The root object uses camelCase JSON names and has exactly these required fields:

| Field | Contents |
| --- | --- |
| `schemaVersion` | Integer `1` |
| `release` | Tag, stable version, and commit SHA |
| `profile` | Target operating-system and service profile |
| `archive` | Archive filename, positive byte size, and lowercase SHA-256 |
| `components` | Lockstep versions for CLI, API, web host, and web assets |
| `inventory` | Every packaged directory and regular file |
| `services` | API and web systemd contracts |
| `rollback` | Previous-release and state compatibility declaration |

All objects reject unknown fields. Required fields are not optional. Duplicate
JSON fields, absent fields, wrong scalar types, unsupported enum values, and
non-canonical values must fail before an archive is extracted.

### Target profile

The v1 profile is fixed to Fedora 44 on x86_64:

| Field | Required value |
| --- | --- |
| `id` | `fedora44-x86_64-systemd` |
| `osId` | `fedora` |
| `osVersion` | `44` |
| `arch` | `x86_64` |
| `target` | `x86_64-unknown-linux-gnu` |
| `glibcMin` | `2.43` |
| `systemdMin` | At least `259` |

### Archive metadata

`archive.name` must be the exact name generated from `release.tag` and the
profile. `archive.size` is greater than zero. `archive.sha256` is exactly 64
lowercase hexadecimal characters.

## Inventory

`inventory` has at most 20,000 entries. Each `path` is a normalized, relative,
forward-slash UTF-8 path no longer than 255 bytes. Reject empty, absolute,
leading/trailing-slash, repeated-separator, `.` or `..` components, backslash,
and NUL-containing paths. Normalized paths must be unique.

Only two entry kinds are representable:

- `file`: requires non-negative `size` and lowercase 64-character `sha256`.
- `dir`: must not include `size` or `sha256`.

`mode` is an integer permission value from `0` through octal `07777`. The
canonical JSON representation is an integer (for example, decimal `493` for
`0755`); publishers must not emit an octal string. The Rust decoder currently
accepts a legacy `"0o755"` string for compatibility, but that form does not
pass the publisher schema.

Roles are the set `{common, server, web}`. An entry must have at least one
role. A target projection includes:

| Target role | Included entries |
| --- | --- |
| `server` | `common` or `server` |
| `web` | `common` or `web` |
| `both` | All inventory entries |

`both` is a projection, not a separately versioned component. Archive entries
must be regular files or directories; links, devices, sockets, FIFOs, and other
special entries cannot be represented.

### Required paths and activation assets

The inventory must contain the required release paths below with the stated
role and kind. The recovery template is validated as a `common` asset when
packaged; `stage_units.rs` always stages a recovery unit for activation and
uses its checked-in template fallback when the archive omits that asset.
Executable binaries must have at least one execute bit.

| Path | Kind | Required role | Additional requirement |
| --- | --- | --- | --- |
| `bin/dam-hopper-manager` | file | `common` | executable |
| `bin/dam-hopper-server` | file | `server` | executable |
| `bin/dam-hopper-web` | file | `web` | executable |
| `systemd/dam-hopper-recovery.service` | file | `common` | boot recovery unit template when packaged |
| `systemd/dam-hopper-api.service` | file | `server` | unit template |
| `systemd/dam-hopper-web.service` | file | `web` | unit template |
| `sysusers.d/dam-hopper-web.conf` | file | `web` | sysusers input |
| `web` | directory | `web` | web payload has `web` role |
| `LICENSE` or `NOTICES` | file | `common` | at least one is required |

The publisher must compute exact inventory set equality for each projection; a
prefix check is not sufficient. Runtime/configuration material is forbidden,
including `.env` and `.env.*`, `server.env`, `server-safety.env`,
`dam-hopper.toml`, `config.toml`, `server-token`, `*.sqlite`,
`*.sqlite-wal`, `*.sqlite-shm`, and `*.db` (case-insensitive basename/suffix
matching as applicable).

## Service and rollback contracts

Both service objects are required even when a role projection will not install
the corresponding service.

| Service | `unitName` | `identity` | `bindHost` | `port` | `healthPath` |
| --- | --- | --- | --- | ---: | --- |
| `api` | `dam-hopper-api.service` | `root` | `0.0.0.0` | `4801` | `/api/health` |
| `web` | `dam-hopper-web.service` | `dam-hopper-web` | `0.0.0.0` | `4802` | `/__dam-hopper/health` |

The API identity is `root` for the v1 MVP owner decision. This is a contract
value, not a general recommendation to run arbitrary services as root.

`rollback` must be exactly:

```json
{
  "previousReleaseCompatible": true,
  "stateCompatibility": "n-1"
}
```

## Phase 03 web runtime contract

The `web` role carries `bin/dam-hopper-web` and the immutable `web/` asset
directory. Its dedicated host defaults to `0.0.0.0:4802` and reserves:

| Route | Contract |
| --- | --- |
| `GET /__dam-hopper/health` | `{ "schemaVersion": 1, "status": "ok", "version": "...", "role": "web" }` |
| `GET /__dam-hopper/runtime-config.json` | `{ "schemaVersion": 1, "releaseVersion": "...", "profileId": "...", "apiUrl": "..." }` |

Both responses are JSON with `Cache-Control: no-store`; HEAD responses carry no
body. Static serving allows only GET/HEAD, rejects unsafe paths and symlinks,
and applies no-cache to root/index, immutable one-year caching to content-
hashed assets, and one-hour public caching to other assets. Runtime config is
machine-local and bounded at 4 KiB; it is never included in the archive.

## Canonicalization and validation

Release JSON is UTF-8, LF-terminated, deterministic, and emitted in the
contract field order. It contains no credentials, mutable URLs, timestamps,
or `latest` pointer. The publisher should serialize once, append the LF, and
hash/sign the resulting archive and manifest inputs without reformatting.

`ReleaseManifest::parse_and_validate` rejects a payload larger than 1 MiB before
JSON decoding. The validator then applies schema-version, SemVer/tag, commit,
profile, archive, component, service, rollback, path, inventory, and required-
asset checks. Diagnostics identify contract fields or normalized relative paths
only; they must never echo credentials, headers, or arbitrary file contents.

The JSON Schema covers structural constraints (`additionalProperties: false`,
required fields, enums, patterns, constants, numeric limits, and inventory
bounds). Rust cross-field validation remains authoritative for equality and
required-path rules. Keep both descriptions synchronized whenever v1 changes;
do not guess at unsupported v2 fields.

Role views are intended to live at:

```text
/opt/dam-hopper/releases/<tag>/<role>/
```

A server-only view contains common + server paths, a web-only view contains
common + web paths, and a both view contains the complete inventory. Each view
is immutable; a role change creates a new same-version view rather than
mutating an existing one.

The Phase 02 staging implementation preserves this post-commit view shape but
replaces an existing same-tag/same-role destination before a repeated final
rename. Phase 05 activates only the validated immutable view and records the
result in the manager's authoritative state envelope.

## Manager consumption (Phases 02–07)

The Rust manager is the runtime consumer of Manifest v1:

- `fetch` resolves an exact stable tag, downloads `release-manifest.json` and
  the one expected archive, and requires archive SHA-256 equality.
- `install` and `role set` parse and validate the manifest before role-view
  extraction. They inspect every archive entry against exact inventory and
  extract only `common` plus the selected role (`both` includes all entries).
- Staging persists the pending candidate in
  `/var/lib/dam-hopper-manager/state.json` only after the role view is renamed
  into the release directory.
- `start` validates the pending view, installs concrete units, and commits only
  after exact API/web health remains stable for 20 consecutive 500 ms probes
  following the 20-second startup deadline.
- `rollback` and `recover` use recorded transaction backups and state; they do
  not reconstruct units or choose a release from `/opt/dam-hopper/current`.

The manager guide documents the command grammar, state machine, health gate,
rollback semantics, recovery unit, and filesystem layout:
[Linux Release Manager](./linux-release-manager.md).

## Format-2 compatibility boundary

The v1 release manifest is distinct from the legacy format-2 marker. Phase 07
uses an exact read-only format-2 verifier for one-time migration only; its
static/live checks, side staging workspace, atomic exchange, and rollback
semantics are specified in [Linux systemd](./linux-systemd.md). Format 1 and
unknown layouts fail closed.

After a successful migration, the checkout-built runner, fixed legacy unit, and
their package aliases are retired. An `imported-format-2` record may be kept as
the previous rollback source, but it is not publisher input and must not be
treated as a v1 archive or manifest.

## Verification

Run the focused contract suites while changing this specification:

```bash
cargo test --manifest-path server/Cargo.toml \
  --test linux_release_manifest --test linux_release_manifest_errors
cargo test --manifest-path server/Cargo.toml linux_release
```

The suites cover round-trip parsing, role projections, bounds, unknown fields,
version/profile/component drift, service and rollback invariants, duplicate and
unsafe paths, required assets, file/directory metadata, and disallowed runtime
files. The full server validation gate remains the release-owner responsibility.

Phase 02 manager evidence:

```bash
cargo test --manifest-path server/Cargo.toml \
  --test linux_release_cli --test linux_release_platform \
  --test linux_release_acquisition --test linux_release_archive \
  --test linux_release_staging --test linux_release_manifest \
  --test linux_release_manifest_errors
```

The focused release suites passed 45/45 tests across seven suites. Manifest
contract tests remain authoritative for metadata rules; CLI, platform,
acquisition, archive, and staging suites cover the manager consumer boundary.

Phase 06 publisher evidence adds
`cargo test --test linux_release_publisher_contract` (7/7 in the focused
publisher suite) plus archive/manifest script syntax and alignment checks. The
publisher guide records the broader 24/24 release-matrix result and workflow
limitations; this document remains the runtime metadata authority.
