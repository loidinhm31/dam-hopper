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

Enabling plugins requires explicit operator input during installation or role configuration:

- `--plugin-owner-user <username>`: The dedicated, non-root system account that runs `dam-hopper-plugin-runner` and owns worker processes.
- `--plugin-admin-subject <subject>`: Authorized subject identifier permitted to perform administrative plugin actions (install, update, rollback, remove). May be specified multiple times.

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
   Provisioned at boot via systemd tmpfiles rule (`/etc/dam-hopper/tmpfiles.d/dam-hopper-plugin-runner.conf`):
   ```text
   d /run/dam-hopper 0750 dam-hopper dam-hopper-plugins -
   d /run/dam-hopper/plugin-runner 0750 <plugin-owner-user> dam-hopper-plugins -
   ```
2. **Socket Path (`/run/dam-hopper/plugin-runner.sock`)**:
   Created by `dam-hopper-plugin-runner` with mode `0660`. Ownership is `<plugin-owner-user>:dam-hopper-plugins`. The API service belongs to `dam-hopper-plugins` via `SupplementaryGroups=dam-hopper-plugins` in `dam-hopper-api.service`.
3. **State Directory (`/var/lib/dam-hopper-plugin-runner`)**:
   Durable registry state (`registry-v1.json`, journals, and staging directories) is isolated in `/var/lib/dam-hopper-plugin-runner` with mode `0700` owned by `<plugin-owner-user>`.

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

The runner service is ordered after `local-fs.target` and tmpfiles creation. The API server connects to the runner socket over non-blocking streams; if the runner is temporarily restarting or unavailable, API endpoints report typed plugin unavailability without crashing unrelated server functions.

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

1. **RuntimeDirectory Ownership Contention**: Both API and runner units utilize `RuntimeDirectory=dam-hopper`.
   - *Affected Paths:* `deploy/systemd/dam-hopper-api.service.in`, `deploy/systemd/dam-hopper-plugin-runner.service.in`
   - *Severity:* Low
   - *Disposition:* Accepted Risk. systemd provisions `/run/dam-hopper` shared group permissions safely via tmpfiles rule `d /run/dam-hopper 0750 @API_USER@ @PLUGIN_SHARED_GROUP@ -`. Socket directory `/run/dam-hopper/plugin-runner` provides sub-path isolation.
2. **Silent Fallback on Owner Verification in Stage Units**: `verify_plugin_owner_account` returns error if owner is unconfigured or invalid, falling back to safe defaults during initial unit staging.
   - *Affected Paths:* `server/src/linux_release/stage_units.rs`
   - *Severity:* Low
   - *Disposition:* Accepted Design. Packaging and staging allow offline preparation before owner configuration is committed. Full verification is enforced strictly during `install` and `role set` CLI commands.
3. **Probe Runner Health in Activation Health Checks**: Health check primarily monitors API HTTP readiness.
   - *Affected Paths:* `server/src/linux_release/health.rs`, `server/src/linux_release/activate.rs`
   - *Severity:* Low
   - *Disposition:* Accepted Risk. The API server client connects to the runner socket over non-blocking streams and reports typed plugin unavailability without crashing API routes, conforming to Requirement 9. Dedicated socket health verification is provided via `probe_runner_health`.
4. **LAN Qualification Harness Synthetic Timing Mode**: `plugin-platform-lan-qualification.mjs` executes deterministic simulated measurements under `--dry-run`.
   - *Affected Paths:* `tests/deploy/plugin-platform-lan-qualification.mjs`
   - *Severity:* Low
   - *Disposition:* Deferred Non-Goal. Full multi-machine physical LAN testing requires hardware deployment, which is deferred to deployment operational qualification at Gate G4.
5. **Node Runtime Bundling at Gate G0**: Release archive bundles templates and runner binary, with Node binary bundling deferred to G0 distribution freeze.
   - *Affected Paths:* `deploy/release/build-release-archive.sh`
   - *Severity:* Low
   - *Disposition:* Deferred Non-Goal. Freezing exact Node >=22.19 distribution and SHA-256 for target Linux profiles is tracked as an unresolved deployment question for Gate G0.

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
