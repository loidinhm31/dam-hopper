# Linux Release Manifest v2

Status: Manifest v2 and manager-state v1 are the current release contracts.
This document defines the v2 metadata consumed by acquisition, staging, and
durable activation. The v2 hard cutover removes API identity from the manifest:
the finalized API unit is the sole runtime identity authority. Legacy format-2
migration remains a separate one-time compatibility boundary.

The Rust validator is the runtime authority. The publisher-facing JSON Schema
must remain structurally equivalent to the Rust types and must reject anything
outside this specification:

- Rust types and validation: `server/src/linux_release/`
- Publisher schema: `deploy/release/release-manifest.schema.json`
- Focused contract tests: `server/tests/linux_release_manifest.rs` and
  `server/tests/linux_release_manifest_errors.rs`

## Publisher and bootstrap boundary (Phase 03 cross-platform release; Phase 06 Linux runtime)

The central publisher's Linux profile emits four external, attested assets: the
executable `dam-hopper-install.sh`, one profile archive, `release-manifest.json`,
and the tag-specific SPDX 2.3 SBOM. The manifest stays outside the archive
because it declares the archive's own size and SHA-256. The publisher assembles
the archive with normalized modes, sorted paths, fixed ownership/mtime, POSIX tar
headers, and timestamp-free gzip, then runs the Rust validator before publication.

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
dam-hopper-vX.Y.Z-linux-x86_64-systemd.tar.gz
```

### Manifest Scope and Windows Asset Boundary

`release-manifest.json` is strictly scoped to the Linux `x86_64-unknown-linux-gnu` systemd profile. It is consumed solely by the Linux bootstrap installer and runtime manager.

The Windows release (`dam-hopper-vX.Y.Z-windows-x86_64.zip` and `dam-hopper-install.ps1`) is completely external to Manifest v2:
- **No Windows schema fields:** Do not add Windows fields, files, or profiles to `release-manifest.json` or its schema. The schema continues to reject unknown fields.
- **Windows verification:** The Windows bootstrap installer verifies the ZIP archive's SHA-256 and byte size against the GitHub Release API asset metadata, and optionally verifies build provenance via `gh attestation verify`.
- **Combined publication:** In a combined release (`--profile all`), `release-manifest.json` is published alongside the Windows assets, but only describes the Linux runtime components.

The protected Git tag `vX.Y.Z` is the release authority. Checked-in Cargo and
web package versions are mirrors and must match the tag before publishing; they
are not independent version channels.

`release` contains:

| Field       | Contract                                                                |
| ----------- | ----------------------------------------------------------------------- |
| `tag`       | `v` followed by stable SemVer, for example `v0.2.0`                     |
| `version`   | Stable `MAJOR.MINOR.PATCH` SemVer, without prerelease or build metadata |
| `commitSha` | Exactly 40 lowercase hexadecimal characters                             |

The four component versions (`cli`, `api`, `webHost`, `webAssets`) must all
exactly equal `release.version`. A version or tag drift is a release failure,
not a warning.

## Manifest shape

The root object uses camelCase JSON names and has exactly these required fields:

| Field           | Contents                                                    |
| --------------- | ----------------------------------------------------------- |
| `schemaVersion` | Integer `2`                                                 |
| `release`       | Tag, stable version, and commit SHA                         |
| `profile`       | Target operating-system and service profile                 |
| `archive`       | Archive filename, positive byte size, and lowercase SHA-256 |
| `components`    | Lockstep versions for CLI, API, web host, and web assets    |
| `inventory`     | Every packaged directory and regular file                   |
| `services`      | API and web systemd contracts                               |
| `rollback`      | Previous-release and state compatibility declaration        |

All objects reject unknown fields. Required fields are not optional. Duplicate
JSON fields, absent fields, wrong scalar types, unsupported enum values, and
non-canonical values must fail before an archive is extracted.

### Target profile

The v2 profile is fixed to the Linux x86_64 systemd target:

| Field        | Required value                      |
| ------------ | ----------------------------------- |
| `id`         | `linux-x86_64-systemd`              |
| `osId`       | `linux`                             |
| `osVersion`  | `any`                               |
| `arch`       | `x86_64`                            |
| `target`     | `x86_64-unknown-linux-gnu`          |
| `glibcMin`   | `2.39`                              |
| `systemdMin` | Exactly `245` at the publication gate |

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

| Target role | Included entries      |
| ----------- | --------------------- |
| `server`    | `common` or `server`  |
| `web`       | `common` or `web`     |
| `both`      | All inventory entries |

`both` is a projection, not a separately versioned component. Archive entries
must be regular files or directories; links, devices, sockets, FIFOs, and other
special entries cannot be represented.

### Required paths and activation assets

The inventory must contain the required release paths below with the stated
role and kind. The recovery template is validated as a `common` asset when
packaged; `stage_units.rs` always stages a recovery unit for activation and
uses its checked-in template fallback when the archive omits that asset.
Current publisher archives also carry the server-role helper service (and may
carry the optional helper socket); the validator enforces regular-file kind and
server-role assignment for those entries, while local/test staging can use the
checked-in helper template fallback. Executable binaries must have at least one
execute bit.

| Path                                             | Kind      | Required role | Additional requirement                    |
| ------------------------------------------------ | --------- | ------------- | ----------------------------------------- |
| `bin/dam-hopper-manager`                         | file      | `common`      | executable                                |
| `bin/dam-hopper-server`                          | file      | `server`      | executable                                |
| `bin/dam-hopper-web`                             | file      | `web`         | executable                                |
| `systemd/dam-hopper-recovery.service`            | file      | `common`      | boot recovery unit template when packaged |
| `systemd/dam-hopper-api.service`                 | file      | `server`      | unit template                             |
| `systemd/dam-hopper-idle-suspend-helper.service` | file      | `server`      | helper unit template when packaged        |
| `systemd/dam-hopper-web.service`                 | file      | `web`         | unit template                             |
| `sysusers.d/dam-hopper-web.conf`                 | file      | `web`         | sysusers input                            |
| `web`                                            | directory | `web`         | web payload has `web` role                |
| `LICENSE` or `NOTICES`                           | file      | `common`      | at least one is required                  |

The helper socket unit is a separate optional server-role archive asset. The
release manager directly manages the helper service and must not enable both
direct-binding service mode and socket activation for the same socket path.

The publisher must compute exact inventory set equality for each projection; a
prefix check is not sufficient. Runtime/configuration material is forbidden,
including `.env` and `.env.*`, `server.env`, `server-safety.env`,
`dam-hopper.toml`, `config.toml`, `server-token`, `*.sqlite`,
`*.sqlite-wal`, `*.sqlite-shm`, and `*.db` (case-insensitive basename/suffix
matching as applicable).

## Service and rollback contracts

Both service objects are required even when a role projection will not install
the corresponding service.

| Service | `unitName`               | `identity`                  | `bindHost` | `port` | `healthPath`           |
| ------- | ------------------------ | --------------------------- | ---------- | -----: | ---------------------- |
| `api`   | `dam-hopper-api.service` | not present in Manifest v2  | `0.0.0.0`  | `4801` | `/api/health`          |
| `web`   | `dam-hopper-web.service` | `dam-hopper-web`             | `0.0.0.0`  | `4802` | `/__dam-hopper/health` |

The finalized API unit's exact `User=`/`Group=` pair is the sole runtime
identity authority. The manager reparses that pair, resolves the numeric UID
and primary GID, rejects root, and uses the result for API health expectations
and runtime provisioning. Manifest v2 has no API identity field.

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

| Route                                   | Contract                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET /__dam-hopper/health`              | `{ "schemaVersion": 1, "status": "ok", "version": "...", "role": "web" }`              |
| `GET /__dam-hopper/runtime-config.json` | `{ "schemaVersion": 1, "releaseVersion": "...", "profileId": "...", "apiUrl": "..." }` |

Both responses are JSON with `Cache-Control: no-store`; HEAD responses carry no
body. Static serving allows only GET/HEAD, rejects unsafe paths and symlinks,
and applies no-cache to root/index, immutable one-year caching to content-
hashed assets, and one-hour public caching to other assets. Runtime config is
machine-local and bounded at 4 KiB; it is never included in the archive.

## Canonicalization and validation

The release generator emits UTF-8, LF-terminated, deterministic pretty JSON in
the contract field order. The publication checker parses externally supplied
manifest bytes and validates their complete v2 structure and digest bindings;
it does not reserialize or canonicalize those bytes. Release JSON contains no
credentials, mutable URLs, timestamps, or `latest` pointer. The checker bounds
Manifest v2 and migration-evidence JSON to 1 MiB, SBOM JSON to 16 MiB, other
release assets to 500 MiB (matching the manager's downloaded archive cap),
manager inventory to 1,024 targets, and manager IDs to 128 UTF-8 bytes.

The Rust archive inspector's separate 512 MiB bound applies to uncompressed
inspection, not downloaded archive bytes.

`ReleaseManifest::parse_and_validate` rejects a payload larger than 1 MiB before
JSON decoding. The validator then applies schema-version, SemVer/tag, commit,
profile, archive, component, service, rollback, path, inventory, and required-
asset checks. Diagnostics identify contract fields or normalized relative paths
only; they must never echo credentials, headers, or arbitrary file contents.

The checked-in JSON Schema is intended to cover structural constraints
(`additionalProperties: false`, required fields, enums, patterns, constants,
numeric limits, and inventory bounds), but it still contains legacy Fedora
profile/archive alternatives and is not a standalone approval gate for the
Linux-only v2 cutover. The owner must synchronize the schema, generator, Rust
acceptance, and installer before unblocking stable publication. Rust
cross-field validation remains authoritative for equality and required-path
rules; keep both descriptions synchronized whenever v2 changes. Do not add
compatibility fields or a second API identity authority.

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

## Manager consumption (Manifest v2; manager state v1)

The Rust manager is the runtime consumer of Manifest v2:

- `fetch` resolves an exact stable tag, downloads `release-manifest.json` and
  the one expected archive, and requires archive SHA-256 equality.
- `install` and `role set` parse and validate the manifest before role-view
  extraction. They inspect every archive entry against exact inventory and
  extract only `common` plus the selected role (`both` includes all entries).
- Staging persists the pending candidate in
  `/var/lib/dam-hopper-manager/state.json` only after the role view is renamed
  into the release directory. This manager state remains schema v1 and is
  independent from the release manifest schema.
- `start` reparses the final API unit, provisions its fixed runtime paths, and
  starts the API only after the pre-start provisioner succeeds. It commits only
  after exact API/web health remains stable for 20 consecutive 500 ms probes.
- `rollback` and `recover` use recorded transaction backups and state; they do
  not reconstruct units or choose a release from `/opt/dam-hopper/current`.
  For managed active/previous release trees referenced by manager state, the
  manager dual-reads Manifest v1 (`schemaVersion: 1`, legacy API `identity: "root"`)
  or v2, ensuring safe rollback to installed v0.2.0 releases while external candidate
  publication and staging remain strictly Manifest v2.
The manager guide documents the command grammar, state machine, health gate,
rollback semantics, recovery unit, and filesystem layout:
[Linux Release Manager](./linux-release-manager.md).

## Format-2 compatibility boundary

Manifest v2 is distinct from the legacy format-2 marker. The one-time
format-2 verifier uses an exact read-only layout check, side staging workspace,
atomic exchange, and rollback semantics specified in [Linux systemd](./linux-systemd.md).
Format 1 and unknown layouts fail closed. The format-2 verifier is not a
publisher input and must not be treated as a v2 archive or manifest.

After a successful migration, the checkout-built runner, fixed legacy unit, and
their package aliases are retired. An `imported-format-2` record may be kept as
the previous rollback source, but it is not a release-manifest compatibility
channel.

## Verification

Run the focused contract suites while changing this specification:

```bash
cd server
cargo test -p dam-hopper-server \
  --test linux_release_manifest \
  --test linux_release_manifest_errors \
  --test linux_release_unit_policy \
  --test linux_release_staging \
  --test linux_release_ownership \
  --test linux_release_state_machine \
  --test linux_release_publisher_contract
cargo test -p dam-hopper-server linux_release::api_runtime::tests
cargo test -p dam-hopper-server \
  idle_suspend::tests::test_server_audit_preprovisioned_contract
cargo test -p dam-hopper-server \
  idle_suspend::tests::test_helper_protocol_suspend_roundtrip
```

The publisher contract includes the migration gate fixture. It requires a
complete, fresh manager inventory with v2-manifest/v1-state capability,
manager-first ordering, production environment, release-bound forward and
rollback manifest/archive bytes, semantically older rollback version, and
bounded timestamps. Missing, stale, mixed-version, unsigned, schema-v1,
path-unsafe, detached, or reused rollback evidence fails closed before
publication. The `verified` and `signed` markers are required evidence fields;
external attestation verification and the authoritative target inventory remain
release-owner prerequisites rather than claims made by this structural checker.
The final bounded Phase 03 qualification (2026-09-13) recorded 84 passed, 0
failed, and 0 ignored across the seven focused Rust integration suites listed
above. `pnpm release:verify` passed, and `pnpm test:deploy` passed all six
deployment journeys. This evidence qualifies the bounded checker and runtime
path only; it does not establish stable publication, external trust-root
verification, authoritative target-inventory integration, or workflow deep
validation.

The root release verification command checks version alignment, shell syntax,
and Node syntax:

```bash
pnpm release:verify
```
