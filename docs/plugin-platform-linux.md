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
   Durable registry state (`registry-v1.json`, journals, and staging directories) is isolated in `/var/lib/dam-hopper-plugin-runner` with mode `0700` owned by `<plugin-owner-user>`.
   Existing state owned by another account is rejected rather than recursively
   reassigned. Account changes require a deliberate state migration.

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
   - *Affected Paths:* `tests/deploy/plugin-platform-lan-qualification.mjs`
   - *Severity:* Low
   - *Disposition:* Deferred Non-Goal. Full multi-machine physical LAN testing requires hardware deployment, which is deferred to deployment operational qualification at Gate G4.
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
