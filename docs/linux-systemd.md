# Linux systemd deployment

Status: Phase 07 (format-2 migration and checkout-runner retirement) is
implemented and documented (2026-09-04). The supported production path is the
Rust `dam-hopper` release manager and its Manifest v1 role units. The old
checkout-built production runner, reset script, fixed unit, and fixture have
been retired; do not recreate or invoke them.

## Supported deployment boundary

The published Fedora 44 x86_64 release contains the manager, API, web host,
unit templates, recovery unit, and web sysusers input. A target host needs
Fedora 44, x86_64, glibc >= 2.43, systemd >= 259, and HTTPS access to the
release. It does not need a repository checkout, Node.js, pnpm, Cargo, or Rust.
`gh` is optional and is used only when attestation verification is requested.

Manifest v1 has independent service roles:

| Unit | Identity | Listener | Purpose |
| --- | --- | --- | --- |
| `dam-hopper-recovery.service` | `root:root` | none | Run `dam-hopper recover --boot` before app units |
| `dam-hopper-api.service` | `root:root` | `0.0.0.0:4801` | API and WebSocket service |
| `dam-hopper-web.service` | `dam-hopper-web:dam-hopper-web` | `0.0.0.0:4802` | Read-only release web host |

The API identity is an accepted v1 owner decision, not a least-privilege
recommendation. The web process has no API token, database, project, upload,
manager-state, or write path. API and web units do not depend on each other;
both require and follow the recovery unit. Wildcard listeners require host
firewall and Tailscale ACL restrictions.

`dam-hopper-server` is API-only unless an operator explicitly supplies
`--web-dir` (Docker's combined mode on port 4800). The dedicated web host is
the normal release frontend. The legacy nohup process on port 4800 remains an
unsupported, separately owned recovery path; it must not share application
SQLite files with a systemd deployment.

See [Linux Release Manifest v1](./linux-release-manifest.md) for the archive
contract, [Linux Release Manager](./linux-release-manager.md) for command
grammar and state, and [Linux Release Publisher and Bootstrap](./linux-release-publisher-bootstrap.md)
for the publisher/bootstrap boundary.

## Manager workflow

The manager commands and privilege boundary are:

| Command | EUID | Effect |
| --- | --- | --- |
| `fetch` | non-root | Resolve/download an exact release and verify its archive digest |
| `install` | root | Validate host and stage a role candidate at `PENDING` |
| `role set` | root | Stage an explicit role change at `PENDING` |
| `start` | root | Activate pending state, or start the committed role |
| `status`, `version`, `validate` | any | Read-only state/contract checks |
| `rollback`, `recover` | root | Restore a recorded previous state or reconcile a crash |

Typical bootstrap handoff:

```bash
bash dam-hopper-install.sh --version vX.Y.Z --role server
sudo dam-hopper start
dam-hopper status --json
```

`install` and `role set` never stop the active service, switch
`/opt/dam-hopper/current`, install or start units, open listeners, or delete
runtime data. They persist the candidate and (for migration) its transaction
record. `start` is the sole activation boundary.

## Durable state and paths

The valid forward graph is:

```text
ABSENT | ACTIVE -> STAGED -> PENDING -> QUIESCED -> SWITCHED -> PROBING -> COMMITTED
```

Every state/config/link boundary uses a same-directory temporary file, write,
`fsync`, atomic rename, and parent-directory sync. The generation-numbered
`/var/lib/dam-hopper-manager/state.json` envelope is authoritative; the
`/opt/dam-hopper/current` symlink is repairable convenience state.

| Path | Contract |
| --- | --- |
| `/opt/dam-hopper/releases/<tag>/<role>/` | Immutable validated role view |
| `/opt/dam-hopper/.staging/<tx_id>/` | Root-private archive staging (`0700`) |
| `/var/lib/dam-hopper-manager/pending-units/` | Candidate unit/sysusers files |
| `/var/lib/dam-hopper-manager/pending-host-config.json` | Candidate public web config |
| `/var/lib/dam-hopper-manager/backups/<tx_id>/` | Transaction-owned restore copies |
| `/var/lib/dam-hopper-manager/state.json` | Active/previous/pending/transaction/failure state |
| `/etc/dam-hopper/host.toml` | Recorded role and exact web origins |
| `/etc/dam-hopper/host-config.json` | Committed public runtime config |
| `/etc/systemd/system/` | Concrete active unit destinations |
| `/run/lock/dam-hopper/deploy.lock` | Nonblocking deployment serialization |

Runtime configuration, tokens, session/telemetry SQLite, repositories,
containers, and MongoDB remain outside release archives and migration
mutation sets.

## Activation, health, rollback, and recovery

Under the deployment lock, `start` validates the old and candidate views,
proves selected old services' cgroups, listeners, and SQLite holders are
clear, backs up concrete units/configuration, installs candidates, daemon
reloads, starts selected roles, and enters `PROBING`. Each selected service
must become ready within 20 seconds, then pass 20 consecutive probes at
500 ms (10 seconds uninterrupted). A probe checks active `MainPID`, expected
executable and identity, exact listener (`4801` API or `4802` web), and
loopback JSON with schema `1`, `status: "ok"`, expected role/version, JSON
content type, no redirects, and a bounded body. Transient failures reset the
window; identity, listener, schema, role, or version mismatches fail
immediately.

On success the manager enables selected units, disables removed roles,
commits active/previous state, clears pending transaction state, repairs
`current`, and retains only verified referenced/rollback trees. On candidate
failure it stops the candidate, restores exact unit/config/state backups, and
runs the same health gate. First-install failure leaves application units
stopped/disabled with no active release. Manual `sudo dam-hopper rollback`
promotes the recorded previous release through the same transaction. A failed
restore or corrupt/unowned/hash-mismatched state is
`RECOVERY_REQUIRED`, and recovery disables application units rather than
guessing.

`dam-hopper-recovery.service` is a root oneshot ordered after
`local-fs.target` and before both application units. At boot it leaves
`STAGED`/`PENDING` candidates disabled, restores transaction backups for
`QUIESCED`/`SWITCHED`/`PROBING`, repairs enablement and `current` for
`COMMITTED`, and blocks missing or inconsistent state.

## Phase 07: format-2 migration

Migration is a one-time compatibility path from the exact known checkout-runner
layout to Manifest v1. It does not import format 1, infer ownership from
`current`, copy user runtime data, or perform a reset/purge. Unknown, changed,
partial, or ambiguous state fails before mutation.

### Read-only format-2 verification invariants

The verifier reads the existing root, marker, unit, wants link, and (when
requested) live process. It does not write, rename, stop, enable, disable, or
delete anything. A migration is eligible only when all required checks pass:

| Object | Required invariant |
| --- | --- |
| Canonical root | `/opt/dam-hopper` is a directory, not a symlink, mode `0755`; root-owned when running the root trust check |
| Root inventory | Exactly `.systemd-fresh-install` and `bin`; a `web` entry is explicit format-1 rejection |
| `bin/` | Unlinked directory, mode `0755`; exactly one unlinked regular file named `dam-hopper-server`, mode `0755` |
| Marker directory | `.systemd-fresh-install` is an unlinked mode-`0700` directory |
| Marker inventory | Exactly regular files `manifest` and `nonce`; `web.sha256` and any extra/link entry reject as format 1 or drift |
| Marker files | `manifest` and `nonce` are unlinked regular files, mode `0600`; root-owned when required |
| Manifest grammar | Exactly four non-empty `key=value` lines (order-independent): `format=2`, `nonce`, `binary_sha256`, and `unit_sha256`; no duplicate/unknown key, whitespace, malformed key, or uppercase/invalid digest |
| Nonce/digest values | Nonce is 32 lowercase hexadecimal characters; each SHA-256 is 64 lowercase hexadecimal characters; marker nonce equals manifest nonce; binary bytes hash to `binary_sha256` |
| Unit file | `/etc/systemd/system/dam-hopper.service` is an unlinked UTF-8 regular file, mode `0644`, hash equals `unit_sha256`; root-owned when required |
| Unit environment | Exactly ordered `EnvironmentFile=/home/loidinh/.config/dam-hopper/server.env` then `EnvironmentFile=/home/loidinh/.config/dam-hopper/server-safety.env` |
| Unit directives | Required `User=loidinh`, `Group=loidinh`, `WorkingDirectory=/home/loidinh`, `Environment=HOME=/home/loidinh`, `Environment=XDG_CONFIG_HOME=/home/loidinh/.config`, `Environment=RUST_ENV=production`, `ExecStart=/opt/dam-hopper/bin/dam-hopper-server --config /home/loidinh/.config/dam-hopper/dam-hopper.toml --host 0.0.0.0 --port 4801`, `Restart=on-failure`, `KillSignal=SIGTERM`, `UMask=0077`, `NoNewPrivileges=false`, and `StandardOutput/Error=journal` |
| Unit exclusions | `--no-auth`, `DAM_HOPPER_NO_AUTH=`, and `DAM_HOPPER_WEB_DIR=` are forbidden; a `.service.d` drop-in directory is forbidden |
| Enablement | `multi-user.target.wants/dam-hopper.service` is a symlink whose destination ends with `dam-hopper.service`; ownership is checked in the root trust check |

The live inspection path additionally requires `systemctl is-active`, an
existing main process, and an executable ending in `dam-hopper-server`. Under
the root trust check, when the `loidinh` account exists, the process UID must
match that account; the inspector records the process UID/GID but does not
invent a GID rule. It also requires wildcard `0.0.0.0:4801`, free legacy `4800`
and web `4802`, and successful API health JSON (`status: "ok"`). These checks
are read-only evidence; the manager must not bless an unhealthy or foreign
process as a rollback target.

Format 1 is identified by `format=1` or `web.sha256` and returns an explicit
unsupported-migration error. Format-2 parser errors include missing/duplicate
keys, wrong line count/version, nonce mismatch, digest mismatch, links,
unexpected entries, ownership/mode drift, invalid unit directives, and invalid
wants/drop-in state.

### Side-stage and pending handoff

The complete candidate root is built beside the canonical root, on the same
filesystem:

```text
/opt/dam-hopper                         untouched format-2 root
/opt/.dam-hopper-migration.<tx_id>      root-private sibling, initially 0700
  .migration-transaction                tx id/role marker
  releases/imported-format-2/server/   copied old binary and unit
  releases/vX.Y.Z/<role>/              selected Manifest v1 candidate
/var/lib/dam-hopper-manager/state.json  PENDING migration transaction
```

The workspace name is exactly `.dam-hopper-migration.<tx_id>`. Creation first
proves the canonical root and its parent have the same device ID, then creates
the sibling mode `0700` workspace and `.migration-transaction` marker. It never
adds `.staging` inside the exact format-2 root. The old binary/unit are copied
with `0755`/`0644` modes and rehashed; the candidate archive is validated and
extracted into the sibling. The pending record stores the target release,
role, paths, hashes, and a `MigrationRecord` containing both roots, old
binary/unit hashes, exchanged flag, backup unit path, and wants-link path.

After `install`, the canonical root, old unit bytes, old marker, old process,
listener, health, and user runtime tree remain unchanged. Only manager-owned
side-stage, pending units/config, and durable manager state are added.

### Atomic exchange and commit

On explicit `sudo dam-hopper start`, after lock acquisition and durable
`QUIESCED`:

1. Stop/quiesce the old service and prove cgroups, listeners, and SQLite
   holders are clear; preserve exact unit/enablement backups.
2. Set the sibling workspace mode to `0755`.
3. Call Linux `renameat2(RENAME_EXCHANGE)` on
   `/opt/dam-hopper` and `/opt/.dam-hopper-migration.<tx_id>`. This is a
   same-filesystem directory exchange, not a copy/delete switch. Hosts without
   this Linux capability fail closed; there is no non-atomic fallback.
4. Record `exchanged=true`, remove the old fixed unit from the concrete systemd
   directory, install the selected Manifest v1 units/config, daemon-reload,
   start, and run the normal 20-second plus 10-second health gate.
5. Record the candidate as `active` and the imported old state as
   `previous` with tag `imported-format-2`. Repair `current` only after the
   durable commit.

`renameat2(RENAME_EXCHANGE)` leaves the former canonical root at the sibling
path, so a crash can identify both sides by the transaction marker and
`MigrationRecord`; path guessing is not recovery.

### Rollback restoration and cleanup

If candidate activation or probing fails after exchange, or recovery observes
an interrupted `QUIESCED`, `SWITCHED`, or `PROBING` migration, rollback:

1. Exchanges the canonical and sibling roots back when the migration record says
   exchange occurred or the canonical root carries the transaction marker.
2. Restores the exact old `dam-hopper.service` unit from the durable imported
   previous copy (with the recorded backup path as the first source).
3. Recreates the old `multi-user.target.wants` symlink only when missing,
   daemon-reloads, and starts the legacy unit.
4. Rechecks old executable identity, wildcard `4801`, and API health; any
   inability to restore the old state returns `RECOVERY_REQUIRED` and retains
   both roots.

On successful commit, the imported previous binary is rehashed against the
recorded legacy digest, the canonical migration marker is removed, and the
exchanged redundant old root is deleted only after equivalence verification.
The imported `previous` release remains available for one rollback generation;
normal retention may remove it later only when it is unreferenced and its
manifest/ownership/path checks pass. The user-owned
`/home/loidinh/.config/dam-hopper` tree, repositories, containers, MongoDB,
SQLite files, and runtime environment are never copied or purged.

## Retired checkout runner

Phase 07 removed the checkout-dependent production path:

- `deploy/run-linux-production.sh` (build/install/start/status/rollback state machine)
- `deploy/reset-linux-production.sh` (destructive checkout reset)
- `deploy/systemd/dam-hopper.service` (fixed single unit)
- `tests/deploy/linux-production-fixtures.sh` (superseded runner fixture)
- package aliases `linux:production` and `linux:reset`

These paths are absent, not deprecated aliases. Do not document or invoke
`pnpm linux:production`, `pnpm linux:reset`, the fixed `dam-hopper.service`, or
checkout-built `/opt/dam-hopper/bin` assets. Use the release manager and the
focused migration coverage instead. `deploy/run-linux-nohup.sh`, where present,
is a separate unsupported recovery script and is not a migration mechanism.

## Verification

The focused Rust migration coverage is:

```bash
cargo test --manifest-path server/Cargo.toml \
  --test linux_release_format2_migration_fixture \
  --test linux_release_format2_migration_drift \
  --test linux_release_format2_migration_exchange
```

The suites cover the exact fixture, ten drift/tamper rejections, import,
same-device side-stage, atomic exchange, rollback exchange, commit cleanup,
and imported-format-2 retention. The administrator rehearsal uses a clean
temporary tree and real Linux `renameat2(RENAME_EXCHANGE)` calls:

```bash
bash tests/deploy/fedora44-format2-migration.sh
```

The rehearsal proves side-staging leaves the canonical root untouched,
exchanges both directories, restores the old root, and preserves the format-2
fixture. It is a filesystem rehearsal, not proof of a live production
service, firewall/ACL policy, SELinux labels, or host-specific account state.

For normal release validation use `pnpm release:verify` and the commands in
[Linux Release Publisher and Bootstrap](./linux-release-publisher-bootstrap.md).
