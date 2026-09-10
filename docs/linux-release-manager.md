# Linux Release Manager (Phases 02–07)

Status: Core release-manager Phases 02–07 are complete and reviewed
(2026-09-04). The production CLI idle-suspend helper/socket integration
(Phases 01–04) is complete and verified (2026-09-10). The manager provides
unprivileged acquisition, root-only staging, durable activation, exact health
gating, rollback, crash recovery, and the one-time format-2 migration from the
retired checkout runner for the Fedora 44 x86_64 systemd release profile.
Phase 03 adds the separate `dam-hopper-web` binary; Phase 04 defines role-aware
units and ownership; Phase 06 adds the central GitHub publisher and non-root
bootstrap; Phase 07 retires the old runner.

This guide documents the executable from downloaded bundle through committed
release. The manifest field contract remains in [Linux Release Manifest v1](./linux-release-manifest.md).

## Prerequisites and trust boundary

The v1 target profile is fixed:

| Requirement      | Value                                               |
| ---------------- | --------------------------------------------------- |
| Operating system | Fedora 44 (`ID=fedora`, `VERSION_ID=44`)            |
| CPU              | x86_64                                              |
| GNU target       | `x86_64-unknown-linux-gnu`                          |
| glibc            | 2.43 or newer                                       |
| systemd          | 259 or newer, running as the system manager (PID 1) |
| Network          | HTTPS access to the public DamHopper GitHub release |
| Optional tool    | `gh` for GitHub attestation verification only       |

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

The one-time format-2 migration is part of this manager. It accepts only the
verified legacy layout described in [Linux systemd](./linux-systemd.md), stages
the new root beside `/opt/dam-hopper`, and retires the old runner after commit.

## Bootstrap handoff (Phase 06)

The published `dam-hopper-install.sh` is a non-root wrapper around this
manager. It accepts `--version vX.Y.Z` or `--latest`, requires
`--role server|web|both`, and optionally accepts repeated `--allow-web-origin`
and `--verify-attestation` flags. It downloads the manifest/archive before
using `sudo`, verifies the archive SHA-256, optionally verifies GitHub
attestations for those two files, extracts only `bin/dam-hopper-manager`, and
invokes `install`. It never starts or activates services; successful handoff
leaves the manager state at `PENDING`.

```bash
bash dam-hopper-install.sh --version v0.2.0 --role server
sudo dam-hopper start
```

The current bootstrap grammar has no `--api-url`; web API origin setup remains
the client-side server-profile flow. For the complete publisher DAG, exact
asset set, reproducibility controls, and bootstrap security boundary, see
[Linux Release Publisher and Bootstrap](./linux-release-publisher-bootstrap.md).

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
dam-hopper validate --manifest PATH [--archive PATH]
```

`--version` and `--latest` conflict. The runtime requires one of them; omitting
both causes `fetch` to fail before a release is written. `--output` and
`--bundle` are required paths. `--allow-web-origin` may be repeated.

### Privilege matrix

| Command    | EUID     | Behavior                                                 |
| ---------- | -------- | -------------------------------------------------------- |
| `fetch`    | non-zero | Resolve/download/verify a release bundle                 |
| `install`  | 0        | Validate host, select/inherit role, stage a candidate    |
| `role set` | 0        | Change recorded role and stage that role's candidate     |
| `start`    | 0        | Activate pending candidate or start committed role units |
| `status`   | any      | Read host configuration and authoritative state          |
| `rollback` | 0        | Activate the recorded previous release                   |
| `recover`  | 0        | Reconcile crash/boot state (`--boot` for systemd)        |
| `version`  | any      | Print manager version, profile, and schema               |
| `validate` | any      | Validate manifest and optional archive without mutation  |

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

Install and role set stop at a durable pending candidate. They do **not**:

- switch `/opt/dam-hopper/current`;
- replace active/previous metadata;
- install, enable, start, stop, or reload systemd units;
- open listeners or run health probes; or
- remove the currently active release.

After staging, run `sudo dam-hopper start`. There is no separate `activate`
command: `start` owns both pending-release activation and ordinary startup.

### Dedicated web-role handoff (Phase 03)

A `web` or `both` role projection contains executable
`bin/dam-hopper-web` and the required `web/` asset directory. During `start`,
the manager installs the concrete candidate unit and runs the binary against
the immutable role-view asset root:

```bash
/opt/dam-hopper/releases/vX.Y.Z/web/bin/dam-hopper-web \
  --root /opt/dam-hopper/releases/vX.Y.Z/web/web \
  --port 4802
```

The binary defaults to `0.0.0.0:4802`, serves GET/HEAD static requests, and
reports web-role health at `/__dam-hopper/health`. The machine-local
runtime-config file supplies the exact API origin; it is not packaged.

## Helper service lifecycle (Production CLI Phase 03)

`dam-hopper-idle-suspend-helper.service` is a managed `server`-role unit
alongside `dam-hopper-api.service`. The unit name is the
`HELPER_SERVICE_UNIT` constant and is included in `ALL_SERVICE_UNITS`.
Server-role staging renders the helper into the transaction's
`pending-units-<tx-id>` directory; staging never starts or enables services.

### Start order and non-fatal fallback

`sudo dam-hopper start` uses the same ordering for an ordinary start of a
committed release and for activation of a pending candidate:

1. When activating a candidate, install the rendered units and run
   `systemctl daemon-reload`.
2. If the selected role includes `server`, attempt
   `systemctl start dam-hopper-idle-suspend-helper.service`.
3. If the helper start fails, log a warning and continue; then start
   `dam-hopper-api.service`.
4. If the selected role includes `web`, start
   `dam-hopper-web.service`.
5. Run the API/web health-stability gate. The helper has no HTTP probe target.

The helper start failure is intentionally non-fatal. Hosts without the
required suspend capability, or hosts where the helper cannot start, retain
ordinary API operations; idle-suspend requests fail closed until the helper is
available. Candidate activation still fails if API/web startup or health
verification fails. After a successful health gate, helper enablement is also
best-effort and warns without blocking API enablement or the commit.

### Stop, rollback, and recovery behavior

- Candidate activation first stops every unit in `ALL_SERVICE_UNITS`, including
  the helper, and backs up the installed unit files before replacing them.
- `sudo dam-hopper stop` iterates the same managed-unit list. A stop error is
  printed as a warning for that unit; the command continues stopping other
  units. `--clean` additionally removes the active view/state selected by the
  CLI, but does not broaden cleanup to unrelated paths.
- Automatic activation rollback stops the helper with the other managed units,
  restores transaction-owned unit/configuration backups, reloads systemd, and
  starts the helper before the API for a restored server role. Helper startup
  or enablement failure remains a warning; API/web restoration and health
  verification determine whether recovery succeeds.
- Manual rollback promotes the recorded `previous` release through the same
  activation transaction. The special imported format-2 path stops, disables,
  and removes all current managed v1 units, including the helper, before
  restoring the legacy unit.
- Boot recovery disables the helper with the API/web units while a
  `PENDING` candidate is retained. For an interrupted `QUIESCED`,
  `SWITCHED`, or `PROBING` transaction it invokes the backup restoration path.
  For a committed server role it repairs helper enablement; an inconsistent
  state stops and disables every managed unit and returns `RECOVERY_REQUIRED`.

### Status inspection

`collect_all_services_status()` reports four managed units: API and helper
under `role: "server"`, web under `role: "web"`, and recovery under
`role: "recovery"`. Each record contains the systemd active result plus
best-effort `pid` and `uid` process evidence; missing process evidence does not
make an inactive or stopped helper an error.

```bash
dam-hopper status
dam-hopper status --json
systemctl status dam-hopper-idle-suspend-helper.service
journalctl -u dam-hopper-idle-suspend-helper.service --no-tail
test -S /run/dam-hopper/idle-suspend.sock
```

Plaintext status groups the helper with server services. JSON status exposes the
same records in its `services` array, so automation can distinguish an active
API from an inactive helper. The socket check is separate evidence: status
reports unit/process state, not socket protocol readiness. The helper's socket
is `/run/dam-hopper/idle-suspend.sock`; it may be absent when helper startup
failed or the selected role does not include `server`.

## Verification and end-to-end coverage (Production CLI Phase 04)

The production CLI gate covers rendered-unit policy, transaction-scoped
staging, role isolation, idle-suspend integration, static boundary assertions,
and read-only status inspection. Run the focused checks from the repository
root:

```bash
cargo test --manifest-path server/Cargo.toml --test linux_release_staging
cargo test --manifest-path server/Cargo.toml --test linux_release_unit_policy
cargo test --manifest-path server/Cargo.toml --lib idle_suspend
cargo test --manifest-path server/Cargo.toml --test idle_suspend
./scripts/verify-idle-suspend-boundary.sh
cargo run --manifest-path server/Cargo.toml --bin dam-hopper -- status --json
```

Evidence recorded for this phase:

| Scope | Result |
| --- | ---: |
| `linux_release_staging` integration tests | 9/9 |
| `linux_release_unit_policy` rendered-unit tests | 10/10 |
| `idle_suspend` library tests | 69/69 |
| `idle_suspend` integration tests | 14/14 |
| Combined focused Rust tests | 102/102 |
| Boundary verifier | 14/14 checks |

`server/tests/linux_release_staging.rs` checks helper/API staging for a server
role, helper hardening and fixed socket/audit/enrolled-PID arguments, API
`PIDFile`/`ExecStartPost`/`ExecStopPost` hooks, and the absence of server units
in a web-only role. A `both` role must stage API, helper, web, and recovery
units. The same file verifies `HELPER_SERVICE_UNIT` registration and its
`server` status role.

Boundary check 13 asserts both API unit files contain
`PIDFile=/run/dam-hopper/server.pid`, an `ExecStartPost` `$MAINPID` write, and
an `ExecStopPost` PID cleanup. Check 14 asserts that the helper unit constant
is registered, staged, started by activation, and included in status
inspection. The boundary script passed 14/14 with zero failures.

`dam-hopper status` groups API and helper under `Server`; `status --json`
exposes API, helper, web, and recovery records in `services`, with active state
and best-effort PID/UID evidence. Status is read-only and does not prove socket
protocol readiness. Automated tests use temporary files/fakes and do not invoke
host suspend, logind, or real RTC hardware.

[Phase 04 test report](../plans/reports/tester-260910-0732-phase-04-boundary-verification.md)
and [review](../plans/reports/reviewer-260910-0733-phase-04-verification-boundary.md).

## Durable activation, rollback, and recovery (Phase 05)

The authoritative deployment state is one generation-numbered
`/var/lib/dam-hopper-manager/state.json` envelope containing `active`,
`previous`, `pending`, transaction phase/backup paths, and latest sanitized
failure. The convenience symlink `/opt/dam-hopper/current` is repaired after
commit and never decides which release is active.

```text
ABSENT | ACTIVE -> STAGED -> PENDING -> QUIESCED -> SWITCHED -> PROBING -> COMMITTED
```

`start` acquires the root deployment lock. With no pending candidate it starts
the recorded active role units. With a pending candidate it validates the old
and candidate views, stops the old/new role union, proves cgroups/listeners and
runtime SQLite holders are clear, backs up exact installed units/config,
installs candidate units, reloads systemd, starts the selected role, probes it,
updates enablement, then commits active/previous/pending state and repairs
`current`. Every durable boundary uses temp-file write, `fsync`, atomic rename,
and parent-directory sync.

### Health gate

For each selected API/web unit, the manager allows **20 seconds** for initial
readiness, then requires **20 consecutive 500 ms probes** (**10 seconds** of
uninterrupted stability). Each probe checks active `MainPID`, expected
executable/identity, exact listener (`4801` API or `4802` web), and loopback
JSON health (`/api/health` or `/__dam-hopper/health`) with schema `1`, status
`ok`, expected role/version, JSON content type, no redirects, and bounded body.
Transient failures reset the consecutive count; fatal identity, executable,
schema, role, or version mismatches fail immediately.

### Recovery unit and crash classification

`dam-hopper-recovery.service` is a root `Type=oneshot` unit running
`dam-hopper-manager recover --boot` after `local-fs.target` and before both
application units. API and web units require and follow this recovery unit.
Inconsistent state fails closed and disables app units.

| Durable point                                        | Recovery result                                          |
| ---------------------------------------------------- | -------------------------------------------------------- |
| `STAGED`/`PENDING`                                   | Leave old active release; keep candidate disabled        |
| `QUIESCED`/`SWITCHED`/`PROBING`                      | Restore exact transaction backups and verify old release |
| `COMMITTED`                                          | Keep committed release; repair enablement and `current`  |
| Missing/corrupt state or hash/ownership disagreement | `RECOVERY_REQUIRED`; app units blocked                   |

Automatic activation failure stops the candidate, restores transaction-owned
units/config/state, and reruns the same health gate. First-install failure
returns to no active release with app units disabled. Manual
`sudo dam-hopper rollback` promotes `previous` through the same transaction;
failure first attempts to restore the original active release, otherwise
returns `RECOVERY_REQUIRED`. Retention keeps active, one previous known-good,
pending/latest-failed, and transaction-referenced views, deleting only after
manifest and ownership verification.

### Status and version

```bash
dam-hopper status
dam-hopper status --json
dam-hopper version
```

Human-readable status reports the recorded role/origins and active, previous,
pending, transaction, and failure state. `status --json` emits `hostConfig` and
the authoritative `state` envelope; it must not expose environment files,
tokens, archive contents, or command output. `version` reports the Cargo package
version, `fedora44-x86_64-systemd` profile, and manifest schema version.

## Filesystem layout

`Layout::new` uses the host root. Tests use `Layout::with_root` so all paths are
under a temporary root and no host files are changed.

| Path                                                   | Purpose                                   |
| ------------------------------------------------------ | ----------------------------------------- |
| `/opt/dam-hopper/`                                     | Release installation root                 |
| `/opt/dam-hopper/.staging/<tx-id>/`                    | Root-private staging workspace (`0700`)   |
| `/opt/dam-hopper/releases/<tag>/<role>/`               | Immutable unpacked role view              |
| `/opt/dam-hopper/current`                              | Convenience active-view symlink           |
| `/etc/dam-hopper/host.toml`                            | Recorded role and exact web origins       |
| `/etc/dam-hopper/server.env`                           | Machine-local API environment             |
| `/etc/dam-hopper/web.env`                              | Machine-local web environment             |
| `/var/lib/dam-hopper-manager/pending-units-<tx_id>/`           | Rendered candidate units/sysusers         |
| `/var/lib/dam-hopper-manager/pending-host-config-<tx_id>.json` | Candidate public config                   |
| `/var/lib/dam-hopper-manager/state.json`                       | Authoritative state envelope (mode 0600)  |
| `/var/lib/dam-hopper-manager/backups/<tx-id>/`         | Transaction-owned restore backups         |
| `/etc/systemd/system/`                                 | Concrete active unit destinations         |
| `/run/lock/dam-hopper/deploy.lock`                     | Nonblocking deployment serialization lock |

The release path is derived only from the validated tag and selected role. A
role view contains manifest entries with `common` plus the selected role; a
`both` view includes all inventory entries. Runtime/configuration files are
forbidden by the manifest contract, so machine-local state stays outside the
release archive.

## Safe acquisition and staging architecture

The acquisition/staging transaction is deliberately separate from activation:

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
  └─ fsync and atomically update the `pending` field in state.json
```

### Role-aware unit staging (Phase 02)

After role projection is extracted, `stage_units.rs` builds the transaction-scoped unit set. Every role receives the recovery unit; a selected role that includes `server` also stages the API unit and `dam-hopper-idle-suspend-helper.service`. The helper is loaded from `systemd/dam-hopper-idle-suspend-helper.service.in` in the role view (or the checked-in template fallback used by local/test staging; a plain `.service` path is accepted as the bundle fallback).

`render_helper_unit` substitutes the allowlisted `@RELEASE_ROOT@` and `@API_GROUP@` values from `UnitRenderContext`, parses the rendered unit, and enforces `validate_helper_unit_policy`. Unknown or unresolved tokens and policy mismatches abort staging. The rendered helper is written under the transaction's `/var/lib/dam-hopper-manager/pending-units-<tx-id>/` directory using the `HELPER_SERVICE_UNIT` constant (`dam-hopper-idle-suspend-helper.service`).

Production staging requires `systemd-analyze` and runs `systemd-analyze verify` against all staged units before pending state is committed. Generic/local staging runs the same verification when the binary is available.

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

The authoritative `state.json` envelope records the exact pending tag, role,
RFC 3339 stage time, release path, manifest/archive digests, candidate unit
paths, and later transaction/failure records. It is written through a
same-directory temporary file, flushed and file-synced before rename, followed
by parent-directory sync. Active service ownership remains unchanged until
`start` runs the activation transaction.

Repeated staging of an already-existing `<tag>/<role>` destination currently
removes that destination before the final rename. Activation occurs only from
the explicit `start` command; operators should treat the bundle and validated
manifest as the source of truth for each staging attempt.

## Format-2 migration (Phase 07)

When `/opt/dam-hopper` is the exact known format-2 root, `install` creates a
same-filesystem sibling named `/opt/.dam-hopper-migration.<tx_id>`. The
canonical root remains untouched while the sibling receives:

```text
.migration-transaction
releases/imported-format-2/server/bin/dam-hopper-server
releases/imported-format-2/server/systemd/dam-hopper.service
releases/vX.Y.Z/<role>/...
```

The read-only verifier accepts only this legacy shape:

- root is an unlinked `0755` directory with exactly `.systemd-fresh-install`
  and `bin`;
- `bin/` is unlinked `0755` and contains only unlinked `0755`
  `dam-hopper-server`;
- marker is an unlinked `0700` directory containing only unlinked `0600`
  `manifest` and `nonce`;
- manifest has exactly four non-empty `key=value` lines, with
  `format=2`, a 32-character lowercase-hex nonce, and matching lowercase
  64-character binary/unit SHA-256 values;
- marker nonce and binary hash match the recorded values;
- `dam-hopper.service` is an unlinked UTF-8 `0644` file whose hash matches,
  has the two ordered `/home/loidinh/.config/dam-hopper/{server.env,
server-safety.env}` environment files and required `loidinh` API directives,
  and has no no-auth/web-dir override or `.service.d` drop-in; and
- `multi-user.target.wants/dam-hopper.service` is a symlink ending in the
  expected unit name.

The live inspection path additionally checks an active `dam-hopper.service`,
the `loidinh` process/executable, wildcard `0.0.0.0:4801`, free `4800`/`4802`,
and successful API health. Format 1 (`format=1` or `web.sha256`) and any
unknown, changed, partial, or ambiguous state fail closed. User runtime files,
repositories, containers, MongoDB, and SQLite are never copied or purged.

After `install`, manager state contains a `MigrationRecord` with both root
paths, old binary/unit hashes, exchange flag, backup unit path, and wants-link
path. Explicit `start` stops and proves the old service quiesced, sets the
sibling to `0755`, and atomically exchanges the two directories with Linux
`renameat2(RENAME_EXCHANGE)`. There is no copy/delete or cross-device fallback.
The candidate unit/configuration is installed only after exchange; normal
health-gated probing then commits the new release and records the imported
legacy release as `previous` (`imported-format-2`).

Failure or crash recovery exchanges the roots back when required, restores the
old unit from the durable imported copy, restores the wants symlink when
missing, reloads systemd, and starts the old service. Restoration failure is
`RECOVERY_REQUIRED`; evidence is retained rather than guessed or deleted.
Commit rechecks the imported binary hash, removes the migration marker, and
deletes the redundant exchanged root only after equivalence verification.

The old checkout runner is retired. `deploy/run-linux-production.sh`,
`deploy/reset-linux-production.sh`, `deploy/systemd/dam-hopper.service`,
`tests/deploy/linux-production-fixtures.sh`, and package aliases
`linux:production`/`linux:reset` are absent. Use the manager commands and
`tests/deploy/fedora44-format2-migration.sh`; do not restore those aliases.

## Failure handling and diagnostics

Failures are returned as typed `ReleaseError` values. Diagnostics identify only
contract fields, normalized relative paths, operation names, and bounded values;
they must not echo credentials, HTTP headers, or arbitrary file contents. Common
failure classes include unsupported host profile, wrong EUID, invalid origin,
missing role, role conflict, busy deployment lock, invalid bundle, archive
inventory mismatch, digest mismatch, acquisition failure, attestation failure,
activation/probe failure, rollback failure, and `RECOVERY_REQUIRED`.

A failed fetch may leave its caller-selected output directory for inspection;
staging cleanup is transaction-scoped. Migration failures retain the transaction
record until rollback or recovery completes; no candidate handoff is committed
unless `pending` records the staged release.

## Verification evidence

The Phase 02 focused release suites passed 45/45 tests across seven suites,
including CLI grammar/privilege checks, Fedora/profile and origin checks,
acquisition boundaries, archive traversal and role projection, staging,
deployment-lock contention, and pending-state persistence. The scoped manager
compile/check and reviewer gate were also approved. Run the focused suites from
`server/` when changing this contract; the full release validation gate belongs
to the release owner.
