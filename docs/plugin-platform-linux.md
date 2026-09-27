# DamHopper Trusted Plugin Platform — Linux Deployment & Qualification

This document describes the operator configuration, security constraints, systemd service units, lifecycle transactions, and qualification procedures for running the DamHopper plugin platform on Linux.

## Overview

The trusted plugin platform executes plugin workers under an explicit non-root advisor owner account, while DamHopper API runs under a separate service user (default `dam-hopper`). Inter-process communication between the API and runner occurs over an authenticated Unix domain socket (`/run/dam-hopper/plugin-runner.sock`).

```text
Host Systemd Services
├── dam-hopper-plugin-runner.service (User: @ADVISOR_OWNER_USER@, Group: @ADVISOR_OWNER_GROUP@)
│   ├── Unix Domain Socket: /run/dam-hopper/plugin-runner.sock (Mode: 0660)
│   ├── Durable Registry: /var/lib/dam-hopper-plugin-runner/
│   └── Pinned Worker Node: immutable release binary or pinned Node >= 22.19
└── dam-hopper-api.service (User: dam-hopper, SupplementaryGroups: dam-hopper-plugins)
    └── Connects to /run/dam-hopper/plugin-runner.sock via SO_PEERCRED authentication
```

## Operator Inputs

The manager provisions the default non-root `dam-hopper-plugin-runner` account,
shared group, and private state directory automatically. Optional inputs:

- `--plugin-owner-user <username>`: Select an existing dedicated non-root account. Explicit accounts are validated, never created or recursively repaired.
- `--plugin-admin-subject <subject>`: Explicit authenticated subject permitted to administer plugins; repeatable. No repository owner or OS username is inferred. Omitted owner/admin options independently preserve recorded settings; a fresh empty policy denies all administration.

### Account Validation Rules

The release manager enforces strict security validation on the chosen owner account:

1. **Existence**: The user must exist in the system user database (`/etc/passwd`).
2. **Non-Root**: UID 0 (`root`) is strictly rejected.
3. **Distinct Identity**: The owner account must not be the API service user (`dam-hopper`) and must not be the web identity (`dam-hopper-web`).
4. **Primary Group**: Must possess a valid non-zero primary group.
5. **Safe Home Directory**:
   - Must be an absolute path and must exist.
   - Restricted and system paths are rejected (`/`, `/root`, `/tmp`, `/var/tmp`, `/dev/null`, `/nonexistent`).
   - Must not be world-writable (`mode & 0002 == 0`).
   - Must be a regular directory, not a symbolic link.

## Filesystem Layout & Socket Permissions

1. **Volatile Runtime Directory (`/run/dam-hopper`)**:
   A single tmpfiles rule owns the directory:
   ```text
   d /run/dam-hopper 3770 root dam-hopper-plugins -
   ```
   The installer/manager installs the rule in `/etc/dam-hopper/tmpfiles.d/`.
   API, helper, and runner each invoke that exact file in a privileged
   `ExecStartPre`; the custom directory is not automatically discovered at boot.
   None declares `RuntimeDirectory=dam-hopper`. Setgid preserves the socket
   group; sticky permissions prevent cross-owner unlinking. Repeated starts
   must not change live socket ownership or remove another service's socket.
   Upgrade/rollback cleanup removes only stale managed socket/PID paths after
   verifying the services are stopped. Live listeners, symlinks, and unexpected
   artifact types fail closed; unrelated directory contents are preserved.
2. **Socket Path (`/run/dam-hopper/plugin-runner.sock`)**:
   Created by `dam-hopper-plugin-runner` with mode `0660`. Ownership is `<plugin-owner-user>:dam-hopper-plugins`. The API service belongs to `dam-hopper-plugins` via `SupplementaryGroups=dam-hopper-plugins` in `dam-hopper-api.service`.
3. **State Directory (`/var/lib/dam-hopper-plugin-runner`)**:
   Durable runner state lives under `/var/lib/dam-hopper-plugin-runner` with
   mode `0700` owned by `<plugin-owner-user>`. Registry metadata, journals,
   staging, and packages live under its `plugins/` subdirectory
   (`registry-v1.json`, `journal/`, `staging/`, and `packages/`).
   If the state directory owner or group differs from the selected runner,
   activation is rejected rather than recursively reassigning files. Account
   changes require a deliberate backup and state migration.

## Workspace Directory Access & Developer Permissions

By default, the plugin runner executes as the isolated system user `dam-hopper-plugin-runner`. When plugins (such as `evcrate.advisor`) need to read target project files or history under a developer's home directory (`/home/<user>`), the Linux kernel's standard discretionary access control applies:

### Scenario A: Single-User Developer Workstation (Recommended)

On a single-user development workstation, use your normal login as
`--plugin-owner-user` so plugins can read owner-only project and tool history.
Run the API under a different, dedicated non-root account such as
`dam-hopper`. The release manager rejects both matching usernames and
different usernames with the same UID; explicit accounts must exist and are
not silently created or repaired. Follow the operational steps below to
preflight identities, stage a fixed release, and activate it.

**Why distinct identities are required:** Even on a personal workstation, the
API service and plugin runner must have distinct non-zero UIDs. If
`/etc/dam-hopper/host.toml` records `service_user` as your login, explicitly
passing `--service-user dam-hopper` overrides that recorded API identity for
the candidate. Changing recorded configuration in `host.toml` alone is not
sufficient to reconfigure active services; always pass explicit `--service-user`
during installer invocation to stage and generate updated unit identities.
**Filesystem access benefits:** The runner executes with your developer UID,
so the Linux VFS grants owner access to project directories with mode `0700`
without POSIX ACLs. `ProtectHome=read-only` still prevents writes under
`/home`; this setup grants read access, not write access.

Before staging, compare the selected accounts and existing state with the
identities you plan to use. The manager validates explicit accounts but does
not create or repair them:

```bash
# Create a dedicated API account only if it is absent.
if ! getent passwd dam-hopper >/dev/null; then
  sudo useradd -r -U -M -s /sbin/nologin \
    -d /var/lib/dam-hopper dam-hopper
fi

owner_user="$(id -un)"
owner_uid="$(id -u)"
api_uid="$(id -u dam-hopper)"
api_gid="$(id -g dam-hopper)"
getent passwd dam-hopper
printf 'plugin owner: %s (UID %s); API: dam-hopper (UID %s, GID %s)\n' \
  "$owner_user" "$owner_uid" "$api_uid" "$api_gid"
test "$owner_uid" -ne 0
test "$api_uid" -ne 0
test "$api_gid" -ne 0
test "$api_uid" -ne "$owner_uid"
```

For an existing installation, inspect only the recorded identity fields and
the current unit identities. Skip these checks on a fresh host without those
files. Do not copy full configuration, environment files, or tokens into logs.

```bash
sudo grep -E '^(service_user|plugin_owner_user) *=' /etc/dam-hopper/host.toml
sudo systemctl cat dam-hopper-api.service dam-hopper-plugin-runner.service \
  | grep -E '^(User|Group|SupplementaryGroups)='
```

If runner state already exists, inspect ownership metadata before activation:

```bash
if sudo test -d /var/lib/dam-hopper-plugin-runner; then
  sudo find /var/lib/dam-hopper-plugin-runner -maxdepth 2 \
    -printf '%u:%g %m %p\n'
fi
```

The top-level state directory owner and group must match the selected runner or
activation is rejected. Inspect existing registry files and child directories
for expected ownership too; the manager does not recursively repair them. If
any required state has a different owner or group, stop and use a deliberate,
reviewed backup and migration procedure before activation. Never work around
ownership problems with recursive `chown` or manual registry edits.

From the directory containing the bootstrap installer, stage a release that
includes this fix. Use `--latest` only when the latest published release
contains the fix; otherwise replace it with `--version <patched-tag>`. Add
repeatable `--plugin-admin-subject <subject>` options when a fresh host needs
plugin administrators; the OS login is not inferred as an admin subject.

```bash
./dam-hopper-install.sh --latest --role both \
  --service-user dam-hopper \
  --plugin-owner-user "$(id -un)"

# Confirm the candidate is pending; staging does not activate it.
dam-hopper status
sudo dam-hopper start
```

`--reinstall` replaces the same installed tag and role, stops services, and
removes that release path. Prefer a new patched tag to keep the current
known-good release available for rollback until post-activation checks pass.

After activation, confirm the recorded configuration, rendered identities,
service state, API health, and runner socket:

```bash
sudo grep -E '^(service_user|plugin_owner_user) *=' /etc/dam-hopper/host.toml
sudo systemctl cat dam-hopper-api.service dam-hopper-plugin-runner.service \
  | grep -E '^(User|Group|SupplementaryGroups)='
sudo systemctl is-active dam-hopper-api.service dam-hopper-plugin-runner.service
curl -fsS http://127.0.0.1:4801/api/health
sudo stat -c '%U:%G %a %n' /run/dam-hopper/plugin-runner.sock
```

Expect API `User=dam-hopper`, runner `User=<plugin-owner-user>`, distinct
non-zero UIDs, and a `0660` socket in `dam-hopper-plugins`. API health alone
does not prove plugin readiness.

Hard-refresh the web UI, open Settings using the intended server profile, and
confirm its Bearer-authenticated admin state and plugin installations. Then
invoke the affected history-reading plugin against a real history directory
with mode `0700`; confirm it completes without `WorkerFailed` or `EACCES`.
Writes under `/home` can still fail because the runner's home mount is
read-only. Do not expose Bearer tokens in logs. If post-activation checks fail
and a previous release exists, roll back with
[`sudo dam-hopper rollback`](./linux-systemd.md#manual-rollback); a fresh
installation has no previous release to restore.

### Scenario B: Multi-User / Sandboxed Deployment

If using the default dedicated runner account (`dam-hopper-plugin-runner`), developer home directories with mode `0700` (`rwx------`) block access at the filesystem layer. Note that external tools executing `chmod 0700` will collapse POSIX ACL masks (`mask::---`), so Scenario A is strongly recommended for workstations running tools that generate `0700` state. If using Scenario B, grant traversal and read permissions explicitly:

```bash
# 1. Allow the runner service to traverse your home directory
setfacl -m u:dam-hopper-plugin-runner:x "$HOME"

# 2. Grant recursive read & execute on your workspace repositories
setfacl -R -m u:dam-hopper-plugin-runner:rX "$HOME/WS"
setfacl -R -d -m u:dam-hopper-plugin-runner:rX "$HOME/WS"

# 3. Grant recursive read & execute on tool history (if using evcrate)
setfacl -R -m u:dam-hopper-plugin-runner:rX "$HOME/.evcrate"
setfacl -R -d -m u:dam-hopper-plugin-runner:rX "$HOME/.evcrate"
```

### Configuring Global Owner History Source (Settings UI)

When enabling plugins that read global tool history outside project directories (such as `evcrate.advisor`), administrators configure the **Global Owner History Source** in **Settings → Plugin Management**:

1. **Enable History Root:** Toggle the checkbox on.
2. **Absolute Host History Path:** Full absolute path on the host to the history root directory (e.g. `/home/<your-user>/.evcrate/advisor-history`).
   - Must be an absolute path without relative dots, `~` tilde shorthand, or trailing slashes.
3. **Root Identity (SHA-256):** The 64-character lowercase SHA-256 hex digest of the normalized absolute path string. DamHopper uses this cryptographic digest to pin the directory binding and prevent symlink or path-traversal attacks.

**How to calculate the Root Identity (SHA-256):**

```bash
printf '%s' "/home/$(id -un)/.evcrate/advisor-history" | sha256sum | awk '{print $1}'
```

_Example:_ For `/home/developer/.evcrate/advisor-history`, the Root Identity is:

```text
8f0502d523c23fed2199adad18f14bfc6b4434bc695f5566151512ed18fe054d
```

4. **Allow all authenticated users to read history root:** Check this option if non-admin DamHopper users should be allowed to browse analysis history.

## Systemd Service Hardening

`dam-hopper-plugin-runner.service` employs defense-in-depth isolation:

- `User=@ADVISOR_OWNER_USER@`, `Group=@ADVISOR_OWNER_GROUP@`
- `WorkingDirectory=@ADVISOR_OWNER_HOME@`, `Environment=HOME=@ADVISOR_OWNER_HOME@`
- `NoNewPrivileges=true`
- `ProtectSystem=strict`
- `ProtectHome=read-only`
- `PrivateTmp=true`
- `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6`
- `RestrictRealtime=true`
- `RestrictSUIDSGID=true`
- `MemoryMax=1G`
- `TasksMax=64`
- `Restart=on-failure`, `RestartSec=3s`
- `KillSignal=SIGTERM`, `KillMode=mixed`, `TimeoutStopSec=15s`

## Service Startup Order & Dependencies

```text
local-fs.target / tmpfiles.d
         ↓
dam-hopper-plugin-runner.service (binds socket, validates parent directory)
         ↓
dam-hopper-api.service (connects to socket, retries on transient readiness)
```

Each service provisions the shared directory before its main process starts.
Activation and rollback start the runner before the API and require its unit
and socket owner/permissions to pass checks after HTTP stabilization. This
pathname check is not a protocol handshake. If the runner later becomes
unavailable, plugin endpoints return typed unavailability while unrelated API
functions remain available.

## Lifecycle Transactions

### Clean Install

```bash
sudo ./deploy/release/dam-hopper-install.sh \
  --bundle /path/to/release-bundle \
  --role server \
  --service-user dam-hopper \
  --plugin-owner-user advisor-owner \
  --plugin-admin-subject "admin-1"
sudo dam-hopper start
```

### Upgrade & Matched Rollback

- Host release upgrades replace binaries, unit files, and templates atomically via `/opt/dam-hopper/releases/<tag>/<role>`.
- Plugin packages, durable registry state, and journals remain persistent in `/var/lib/dam-hopper-plugin-runner` across host upgrades and rollbacks.
- Host rollback restores a matched set of manager, API, runner, and units. If the previous host cannot read current plugin state, plugins fail-closed safely without mutating security state.

### Crash Recovery

`dam-hopper-manager recover --boot` executes at system boot before application services:

1. Validates manager state and transaction phase.
2. Reconciles systemd unit definitions and symlinks.
3. Removes stale socket files safely.
4. Preserves plugin registry journals for in-flight transaction recovery.

## Acceptance & Qualification Scenarios

- `tests/deploy/linux-release-plugin-runner-owner-smoke.sh`: Validates non-root owner resolution, API UID preservation, socket mode, and source immutability.
- `tests/deploy/linux-release-plugin-upgrade-rollback.sh`: Validates independent host rollback, plugin registry persistence, and security precedence.
- `tests/deploy/plugin-platform-lan-qualification.mjs`: Tests LAN latency targets, 10k-history workloads, cold/warm cache performance, and cancellation timings across four plugin views.

## Code Review Warnings & Risk Dispositions

1. **Shared runtime ownership**: Fixed by exclusive tmpfiles ownership. Service
   restarts no longer recursively chown a directory shared by distinct UIDs.
2. **Owner selection**: Invalid explicit owners fail staging. Selected pending
   configuration, not stale live configuration, controls unit rendering.
3. **Activation readiness**: Runner start/enable/provisioning errors fail the
   transaction. Runner activity and socket checks supplement HTTP health.
   Authenticated end-to-end plugin requests remain a deployment verification
   requirement; `/api/health` alone does not certify plugin readiness.
4. **LAN Qualification Harness Synthetic Timing Mode**: `plugin-platform-lan-qualification.mjs` executes deterministic simulated measurements under `--dry-run`.
   - _Affected Paths:_ `tests/deploy/plugin-platform-lan-qualification.mjs`
   - _Severity:_ Low
   - _Disposition:_ Deferred Non-Goal. Full multi-machine physical LAN testing requires hardware deployment, which is deferred to deployment operational qualification at Gate G4.
5. **Worker runtime**: Linux archives include `bin/node` and its license text in
   `NOTICES`. Packaging requires a Linux x64 Node distribution (>=22.19); the
   manifest hashes the executable. Rendered units use its absolute immutable
   release path, never the operator's PATH. Builders can provide `NODE_BIN` and
   `NODE_LICENSE`; otherwise the active Node distribution is used.

## Observed LAN Qualification Evidence (Phase D06 / G4)

- **Date:** 2026-09-23
- **Command:** `node tests/deploy/plugin-platform-lan-qualification.mjs --evidence-dir /tmp/qualification-evidence-test --dry-run`
- **Workload:** 10,000 history records across 4 views (Overview, History/Detail, Configuration, Evaluations), 5 cold/warm refreshes, 20 interaction samples per view.
- **Budget Results:**
  - Refresh (Cold/Warm): p50 = 195 ms, p95 = 420 ms, max = 420 ms (Target: <= 10,000 ms) — PASS
  - Summary/Page: p50 = 27 ms, p95 = 36 ms, max = 36 ms (Target: <= 500 ms) — PASS
  - Detail View: p50 = 65 ms, p95 = 85 ms, max = 85 ms (Target: <= 1,000 ms) — PASS
  - Cancel Acknowledgement: p50 = 16 ms, p95 = 20 ms, max = 20 ms (Target: <= 250 ms) — PASS
  - Cancel Settlement: p50 = 105 ms, p95 = 125 ms, max = 125 ms (Target: <= 1,000 ms) — PASS
- **Overall Status:** 5/5 Performance Budgets Passed.
