# Linux Release Manager (Manifest v2; manager state v2)

Status: Manifest v2 and manager-state v2 are current. Phase D06 adds the
owner-runner release assets, explicit plugin identities, tmpfiles provisioning,
matched host/plugin rollback, recovery, and LAN qualification.

The manager provides unprivileged acquisition, root-only staging, durable
activation, exact health gating, rollback, crash recovery, and the one-time
format-2 migration from the retired checkout runner.

This guide covers a downloaded bundle through committed release. Release
assembly and the v0.5.0/v0.5.1 advisory are in [Publisher and Bootstrap](./linux-release-publisher-bootstrap.md); manifest fields are in [Linux Release Manifest v2](./linux-release-manifest.md).

## Prerequisites and trust boundary

The v2 target profile is fixed:

| Requirement      | Value                                               |
| ---------------- | --------------------------------------------------- |
| Operating system | Linux                                               |
| CPU              | x86_64                                              |
| GNU target       | `x86_64-unknown-linux-gnu`                          |
| glibc            | 2.39 or newer                                       |
| systemd          | 245 or newer, running as the system manager (PID 1) |
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
- The API unit's exact final `User=`/`Group=` pair is the only runtime identity
  authority. The manager rejects root and requires `Group=` to be the user's
  primary group; it does not infer identity from the manifest, host selection,
  `SUDO_USER`, or a username-as-group fallback.
Plugin deployment is explicit: `--plugin-owner-user USER` selects the dedicated
non-root runner account and repeatable `--plugin-admin-subject SUBJECT` records
the subjects allowed to manage plugins. The owner must exist, have a valid
non-root primary group and safe home, and differ from the API/web identities.
On upgrades and role changes, omitted plugin arguments inherit `/etc/dam-hopper/host.toml`.

The one-time format-2 migration is part of this manager. It accepts only the
verified legacy layout described in [Linux systemd](./linux-systemd.md), stages
the new root beside `/opt/dam-hopper`, and retires the old runner after commit.

### API runtime reconciliation

The finalized `dam-hopper-api.service` unit has no `StateDirectory=` or
`StateDirectoryMode=` directives. Its one fixed privileged pre-start command is:

```text
ExecStartPre=+<release-root>/bin/dam-hopper-manager provision-api-runtime
```

The command has no operands and runs before every API start or restart. It
reparses the final unit, resolves its non-root numeric UID/GID, creates or
validates only these fixed paths, and reads the optional legacy config
without mutating it:

| Path | Required metadata |
| --- | --- |
| `/var` and `/var/lib` | `root:root`, directories `0755` |
| `/var/lib/dam-hopper` | API UID/GID, directory `0700` |
| `/var/lib/dam-hopper/.config` | API UID/GID, directory `0700` |
| `/var/lib/dam-hopper/.config/dam-hopper` | API UID/GID, directory `0700` |
| `/var/lib/dam-hopper/dam-hopper.toml` | API UID/GID, regular file `0600` |
| `/var/lib/dam-hopper/idle-suspend-audit.jsonl` | API UID/GID, regular file `0600` |
| `/etc/dam-hopper/dam-hopper.toml` | Optional migration source: `root:root`, regular file `0644`; read-only |

The canonical config and server audit are under `/var/lib/dam-hopper`. When the
canonical config is absent, the provisioner validates the optional legacy file
and publishes an exact-byte copy once; it never creates or repairs `/etc` or
the legacy tree. A valid canonical file takes precedence and prevents any
legacy inspection.

Pre-existing type, owner, group, or mode mismatches refuse without repair,
replacement, truncation, or content mutation. Failure cleanup removes only
empty objects created by the same call whose recorded identity still matches.
The API audit consumer never lazily creates or follows this file. See
[Linux API Runtime State Provisioning](./linux-release-runtime-provisioning.md)
for the decision table, descriptor walk, and publication refusal boundaries.
The same unit contract fixes one API command: the template uses
`@API_HOME@/dam-hopper.toml`; the checked-in production-default unit renders
`/opt/dam-hopper/current/bin/dam-hopper-server --config /var/lib/dam-hopper/dam-hopper.toml --host 0.0.0.0 --port 4801`.
It is a synchronized reference, not a second policy source.
`validate_api_unit_policy` requires exactly one `ExecStart` equal to the
rendered command and preserves exactly one zero-operand privileged prestart;
staging uses the same render → parse → policy path and fails closed on legacy,
alternate, duplicate, or extra command operands.

The Phase 02 canonical event writer is deliberately outside this provisioning
set. It requires an already-existing diagnostics parent and refuses a missing,
unsafe, or mismatched parent; the API pre-start gate does not create, repair,
or lazily initialize `idle-suspend-events-v1.jsonl`. Phase 03 passes the
optional writer from `AppState` into coordinator startup. If construction
fails, the API records a sanitized diagnostic and continues without semantic
event emission; the missing producer evidence is therefore partial rather than
silently redirected.

### Phase 03 preflight SQLite migration protection

`validate_candidate_preflight` and active-start preflight discover SQLite
holders only for `server`/`both`; `web` reads no API state. Discovery is
read-only and completes before quiesce, stop, or switch:

1. Inspect canonical `/var/lib/dam-hopper/dam-hopper.toml`, then extant
   `/etc/dam-hopper/dam-hopper.toml`, with no-follow open, descriptor `fstat`,
   regular-file check, 64 KiB bound, UTF-8 decode, and TOML parse.
2. Only `ENOENT` is absent. Links, special/unreadable/oversized/malformed
   files, or inspection errors refuse even when the other file is valid.
3. Resolve each `server.session_db_path` with API semantics: `~` and plain
   relative paths use fixed `/var/lib/dam-hopper` HOME/working directory;
   absolute paths remain unchanged; `~user` is rejected. A missing key uses
   that file's schema default.
4. If both TOMLs are absent, include
   `/var/lib/dam-hopper/.config/dam-hopper/sessions.db`; retain explicit
   `/etc/dam-hopper/sessions.db` during migration. Normalize and
   stable-deduplicate candidates.
5. Check each candidate plus `-wal`/`-shm` sidecars with the existing foreign
   holder verifier; only allowed API PIDs are exempt.

Preflight never creates, edits, chmods, chowns, or deletes config/database
files. Canonical TOML is startup authority; legacy TOML is safety coverage and
copy-once migration source only.

This is intentionally broader than provisioning: canonical presence suppresses
legacy copying in the runtime gate, but Phase 03 preflight still inspects an
extant legacy TOML for SQLite holder safety.

### Installer and reset ownership boundary

`dam-hopper-install.sh` verifies assets and stages a pending release only. It
does not provision/repair daemon TOML under `/etc` or `/var/lib`;
`server`/`both` first provision fixed state at explicit `sudo dam-hopper start`,
while `web` never invokes the provisioner.

Reset defaults to `/var/lib/dam-hopper/dam-hopper.toml`; explicit `--config`
is for controlled alternate layouts. It parses the installed API unit for the
exact non-root `User=`/`Group=`, refuses absent/link/non-regular or
wrong-owner/group/mode (`0600`) files, and never repairs those preconditions.
With safe metadata it drops to the API identity, same-directory atomically
replaces the file, verifies parseable TOML and
`server.idle_suspend.enabled = false`, and preserves helper/server audits and
foreign RTC alarms.

Operator repair: confirm no handoff; record canonical/legacy config and audit
paths; inspect `systemctl cat dam-hopper-api.service` and `stat`; restore
trusted content/metadata through a controlled API-identity procedure (reset
must not normalize mismatches); rerun
`./deploy/reset-linux-production.sh --dry-run`; then run live reset as root
and verify API `0600` ownership, parseable disabled TOML, preserved audits/RTC,
and stopped helper units before restarting the API.


## Bootstrap handoff (Phase 06)

The published `dam-hopper-install.sh` is a non-root wrapper around this
manager. It accepts `--version vX.Y.Z` or `--latest`, requires
`--role server|web|both`, and forwards optional `--service-user`,
`--plugin-owner-user`, repeatable `--plugin-admin-subject`, and
`--allow-web-origin` values to `install`; `--verify-attestation` adds
GitHub checks. It downloads and verifies the manifest/archive before using
`sudo`, extracts only `bin/dam-hopper-manager`, and leaves state at `PENDING`
without starting or activating services.

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
    [--service-user USER] [--plugin-owner-user USER]
    [--plugin-admin-subject SUBJECT ...] [--allow-web-origin ORIGIN ...]
sudo dam-hopper role set ROLE --bundle DIR
    [--service-user USER] [--plugin-owner-user USER]
    [--plugin-admin-subject SUBJECT ...] [--allow-web-origin ORIGIN ...]
sudo dam-hopper start
dam-hopper status [--json]
sudo dam-hopper rollback
sudo dam-hopper recover
dam-hopper version
dam-hopper validate --manifest PATH [--archive PATH]
dam-hopper diagnose --json
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
| `diagnose` | any      | Collect fixed local evidence; may return a partial bundle |

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
dam-hopper-vX.Y.Z-linux-x86_64-systemd.tar.gz
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
# First install: role and explicit API/runner identities
sudo dam-hopper install --bundle "$HOME/.cache/dam-hopper/v0.2.0" \
  --role server \
  --service-user dam-hopper \
  --plugin-owner-user advisor-owner \
  --plugin-admin-subject admin@example.test

# Change the recorded role and retain the configured plugin identities
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
alongside `dam-hopper-plugin-runner.service` and `dam-hopper-api.service`.
The helper name is the `HELPER_SERVICE_UNIT` constant; helper and runner are
included in `ALL_SERVICE_UNITS` when rendered. Server-role staging renders both
into the transaction's `pending-units-<tx-id>` directory; staging never starts
or enables services.

### Start order and non-fatal fallback

`sudo dam-hopper start` uses the same ordering for an ordinary start of a
committed release and for activation of a pending candidate:

1. When activating a candidate, install the rendered units and run
   `systemctl daemon-reload`.
2. If the selected role includes `server`, attempt the helper start; warning
   on failure and continue.
3. If the runner unit was rendered, attempt it after the helper; warning on
   failure and continue, then start `dam-hopper-api.service`.
4. If the selected role includes `web`, start
   `dam-hopper-web.service`.
5. Run the API/web health-stability gate. The helper has no HTTP probe target.

Helper and runner start failures are intentionally non-fatal. Hosts without
required suspend or plugin capability retain ordinary API operations;
idle-suspend requests or plugin operations fail closed until their companion
is available. Candidate activation still fails if API/web startup or health
verification fails. After a successful health gate, helper/runner enablement
is best-effort and warns without blocking API enablement or the commit.

### Stop, rollback, and recovery behavior

- Candidate activation first stops every unit in `ALL_SERVICE_UNITS`, including
  helper and the optional runner, and backs up installed units before replacing them.
- `sudo dam-hopper stop` iterates the same managed-unit list. A stop error is
  printed as a warning for that unit; the command continues stopping other
  units. `--clean` additionally removes the active view/state selected by the
  CLI, but does not broaden cleanup to unrelated paths.
- Automatic activation rollback stops helper/runner with the other managed units,
  restores transaction-owned unit/configuration backups, reloads systemd, and
  starts helper, runner, then API for a restored server role. Startup/enablement
  failures remain warnings; API/web restoration and health verification decide recovery.
- Manual rollback promotes the recorded `previous` release through the same
  activation transaction. The special imported format-2 path stops, disables,
  and removes all current managed v1 units, including helper/runner, before
  restoring the legacy unit.
- Boot recovery disables helper/runner with the API/web units while a `PENDING`
  candidate is retained. For an interrupted `QUIESCED`, `SWITCHED`, or `PROBING`
  transaction it invokes the backup restoration path.
- For a committed server role it repairs helper/runner enablement; an inconsistent
  state stops and disables every managed unit and returns `RECOVERY_REQUIRED`.

### Status inspection

`collect_all_services_status()` reports five managed units: API, helper, and
the optional runner under `role: "server"`, web under `role: "web"`, and
recovery under `role: "recovery"`. Each record contains the systemd active
result plus best-effort `pid` and `uid` process evidence.

```bash
dam-hopper status --json
systemctl status dam-hopper-plugin-runner.service
journalctl -u dam-hopper-plugin-runner.service --no-tail
test -S /run/dam-hopper/plugin-runner.sock
```

Runner socket inspection is separate evidence: status reports unit/process
state, while the health helper rejects missing, symlinked, non-socket, or
world-writable endpoints.

### Owner plugin runner and tmpfiles (Phase D06)

For a server or both role, staging renders `dam-hopper-plugin-runner.service`.
The unit runs the owner account with its primary group/home, passes the
immutable release root, `/run/dam-hopper/plugin-runner.sock`,
`@DAM_HOPPER_STATE_DIR@/plugins`, `@NODE_BIN@`, expected API UID, and the
hardening policy in [Linux systemd](./linux-systemd.md).
An omitted owner provisions the dedicated default account automatically.
`--plugin-owner-user` selects an existing account and rejects root/API/web
identities, missing accounts, zero primary GID, and unsafe homes.
Repeatable explicit `--plugin-admin-subject` values persist in
`/etc/dam-hopper/host.toml`; activation atomically synchronizes
`/etc/dam-hopper/plugin-admins.json`, including an empty deny-all policy.
Do not override the runner's admin-config path unless managing that policy
separately. Omitted owner/admin options independently retain recorded values.

Server staging writes the rendered `dam-hopper-plugin-runner.conf` beside
pending units. Activation installs the unit at `/etc/systemd/system/` and the
tmpfiles file at `/etc/dam-hopper/tmpfiles.d/`, then invokes
`systemd-tmpfiles --create` for that file:

```text
d /run/dam-hopper 3770 root @PLUGIN_SHARED_GROUP@ -
```

Each API/helper/runner unit invokes the installed tmpfiles file before startup.
No service manages this shared path with `RuntimeDirectory`, avoiding recursive
ownership changes and sibling socket removal. Activation starts helper and
runner before API. Runner provisioning/start/enable failures block activation;
runner unit and socket checks follow HTTP stabilization. Automatic rollback
also restarts and checks the runner. Web-only roles disable the runner.

## Verification and end-to-end coverage

The release-manager qualification gate covers rendered-unit policy,
descriptor-relative runtime provisioning, transaction-scoped staging, role
isolation, idle-suspend audit consumption, start/rollback/recovery ordering,
and read-only status inspection. Run focused checks from the repository root:

```bash
cd server
cargo test -p dam-hopper-server \
  --test linux_release_manifest \
  --test linux_release_manifest_errors \
  --test linux_release_unit_policy \
  --test linux_release_staging \
  --test linux_release_ownership \
  --test linux_release_state_machine \
  --test linux_release_publisher_contract \
  --test linux_release_preflight_sqlite
cargo test -p dam-hopper-server linux_release::api_runtime::tests
cargo test -p dam-hopper-server \
  idle_suspend::tests::test_server_audit_preprovisioned_contract
cargo test -p dam-hopper-server \
  idle_suspend::tests::test_helper_protocol_suspend_roundtrip
cd ..
pnpm release:verify
```

The publisher contract's migration fixture exercises manager-first ordering,
complete homogeneous v2 manager capability with v1 state, production
environment, release-bound forward/rollback manifest and archive bytes,
bounded timestamps, semantically older rollback ordering, and refusal of
mixed, stale, unsigned, schema-v1, path-unsafe, detached, and reused rollback
evidence. Runtime tests use isolated temp roots and injected syscall/starter
seams; they do not touch host systemd, RTC, suspend, or production paths.

The migration checker validates owner-supplied evidence structure and digest
binding. It does not embed a GitHub DSSE/certificate trust root or synthesize
target inventory. External attestation verification remains a prerequisite;
the protected stable publish job is held when migration evidence is absent.
The earlier bounded Phase 03 qualification (2026-09-13) recorded 84 passed, 0
failed, and 0 ignored across the seven release-manager integration suites
available at that time. `pnpm release:verify` passed, and the package's
`pnpm test:deploy` command invokes seven deployment journeys, including clean
install, security, and reset smoke. Re-run the focused commands and the
protected runtime matrix for current Phase 03 evidence; stable publication,
external trust-root verification, authoritative target-inventory integration,
and workflow deep validation remain separate gates.

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
version, the `linux-x86_64-systemd` profile, and release manifest schema `2`;
persisted manager state remains schema `1`.

### Production diagnostics (Phase 06)

Run the one-shot local collector:

```bash
dam-hopper diagnose --json
```

`--json` is required. No path, window, source, unit, URL, command, or
verbosity option is accepted. The command writes one bounded
`bundleSchemaVersion: 1` JSON bundle and prints exactly its absolute final path
plus newline on stdout; progress and warnings never share stdout.

Output location depends on EUID:

- Root: `/var/lib/dam-hopper-manager/diagnostics`.
- Non-root: `$XDG_STATE_HOME/dam-hopper/diagnostics`, else
  `$HOME/.local/state/dam-hopper/diagnostics`. There is no `/tmp` fallback.

The output directory must be an owned, non-symlink directory with mode `0700`.
The final file is named
`dam-hopper-diagnose-<generatedAtMs>-<bundleId>.json` and is mode `0600`.
The writer creates a same-directory exclusive no-follow temporary file, writes
and syncs the JSON, atomically renames it, and syncs the directory before
publishing the path.

Role-aware collection reads the role from `/etc/dam-hopper/host.toml`:

- `server` and `both` collect server events/audit, helper audit, backend
  diagnostics, fixed systemd/journal evidence, local idle status, and current
  host probes.
- `web` marks server-only sources `notApplicable` and does not invoke their
  host commands.
- Missing or unknown role remains unknown and prevents a complete historical
  result; it is not converted to `notApplicable`.

The host command adapter invokes only fixed `systemctl`, `journalctl`, and
`systemd-inhibit` forms. It uses locale `C`, null stdin, discarded stderr,
five-second deadlines, and bounded stdout. The local API adapter uses only
`http://127.0.0.1:4801/api/system/idle-suspend/v1/status` with token
`/var/lib/dam-hopper/.config/dam-hopper/server-token`, no redirects, a
five-second deadline, and a 256 KiB body cap. Probes are read-only and redact
journal message text, credentials, terminal data, arguments, and addresses.
Non-root collection never calls `sudo`, setuid helpers, or other escalation;
helper audit is `permissionDenied`, so an applicable non-root run is partial.

| Exit | Meaning |
| ---: | --- |
| `0` | Bundle written; all applicable required historical sources are complete. |
| `2` | Valid bundle written, but historical evidence is partial. |
| `1` | Serialization or secure output failure; no path is printed or bundle published. |

The collector never mutates RTC, suspend, systemd, configuration, enrollment,
source logs, sockets, or PID files. It is separate from the browser
`POST /api/diagnostics/export` flow.

## Filesystem layout

`Layout::new` uses the host root. Tests use `Layout::with_root` so all paths are
under a temporary root and no host files are changed.

| Path                                                           | Purpose                                   |
| -------------------------------------------------------------- | ----------------------------------------- |
| `/opt/dam-hopper/`                                             | Release installation root                 |
| `/opt/dam-hopper/.staging/<tx-id>/`                            | Root-private staging workspace (`0700`)   |
| `/opt/dam-hopper/releases/<tag>/<role>/`                       | Immutable unpacked role view              |
| `/opt/dam-hopper/current`                                      | Convenience active-view symlink           |
| `/etc/dam-hopper/host.toml`                                    | Role, API user, plugin owner/admin inputs |
| `/etc/dam-hopper/tmpfiles.d/dam-hopper-plugin-runner.conf`     | Rendered runner runtime directories       |
| `/var/lib/dam-hopper-plugin-runner/`                           | Runner-owned durable registry/state       |
| `/etc/dam-hopper/server.env` and `/etc/dam-hopper/web.env`      | Machine-local service environments        |
| `/etc/dam-hopper/dam-hopper.toml`                              | Legacy API registry; read-only migration source |
| `/var/lib/dam-hopper/`                                         | API-owned state root (`0700`, final API UID/GID) |
| `/var/lib/dam-hopper/dam-hopper.toml`                          | Canonical API registry (`0600`, final API UID/GID) |
| `/var/lib/dam-hopper/idle-suspend-audit.jsonl`                  | Server timing/manual audit (`0600`, final API UID/GID) |
| `/var/lib/dam-hopper-manager/pending-units-<tx_id>/`           | Rendered candidate units/sysusers/tmpfiles |
| `/var/lib/dam-hopper-manager/pending-host-config-<tx_id>.json` | Candidate public config                   |
| `/var/lib/dam-hopper-manager/state.json`                       | Authoritative state envelope (mode 0600)  |
| `/var/lib/dam-hopper-manager/backups/<tx-id>/`                 | Transaction-owned restore backups         |
| `/etc/systemd/system/`                                         | Concrete active unit destinations         |
| `/run/lock/dam-hopper/deploy.lock`                             | Nonblocking deployment serialization lock |

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

### Role-aware unit staging (Phase 02 and D06)

After role projection is extracted, `stage_units.rs` builds the transaction
unit set. Every role receives recovery; a `server` role also stages API,
helper, runner, and `dam-hopper-plugin-runner.conf` assets.

`render_helper_unit` and `render_runner_unit` substitute allowlisted release,
identity, registry, Node, and socket tokens, parse the units, and enforce their
policies. Both rendered files are hashed into pending state.

Production staging requires `systemd-analyze verify` before pending state is
committed; generic/local staging verifies when the binary is available.

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

Run focused release checks from `server/` and the repository root:

```bash
cargo test -p dam-hopper-server --test linux_release_plugin_runner
pnpm release:verify && pnpm test:deploy
```

D06 recorded 173/173 Linux-release tests, 9/9 deployment scripts, owner/rollback
smokes, and 5/5 synthetic LAN budgets over 10,000 history records. Physical
separate-machine HTTPS/LAN evidence and exact Node runtime selection remain
G0/G4 deployment inputs.
