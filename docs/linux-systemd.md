# Linux systemd Deployment and Operator Guide

Authoritative deployment, role management, activation, rollback, recovery, and format-2 migration guide for DamHopper on Fedora 44 x86_64 systemd hosts.

## 1. Supported Platform and System Requirements

The published DamHopper release provides immutable, attested binary releases for Fedora 44. Target hosts do not require a compiler, Git repository checkout, Node.js, pnpm, Cargo, or Rust toolchain.

| Requirement                | Specification                                         | Verification / Fallback                                       |
| -------------------------- | ----------------------------------------------------- | ------------------------------------------------------------- |
| **Operating System**       | Fedora Linux 44                                       | Required; `/etc/os-release` `ID=fedora`, `VERSION_ID=44`      |
| **Architecture**           | x86_64 (amd64)                                        | Required; `uname -m` == `x86_64`                              |
| **C Library**              | GNU libc >= 2.43                                      | Dynamically linked against system glibc                       |
| **Init & Service Manager** | systemd >= 259                                        | Unified cgroup v2; PID 1 system manager                       |
| **Security Module**        | SELinux Enforcing                                     | Standard targeted policy; units use native sandboxing         |
| **Host Utilities**         | `curl`, `tar`, `gzip`, `sha256sum`, `sudo`, `systemd` | Required on path for bootstrap/archive handling               |
| **Attestation Verifier**   | GitHub CLI (`gh`)                                     | Optional; required only when `--verify-attestation` is passed |

---

## 2. Release Artifacts and Trust Chain

DamHopper releases are distributed as four immutable, reproducible release assets per `vX.Y.Z` tag:

1. `dam-hopper-install.sh`: Unprivileged non-root bootstrap shell script
2. `dam-hopper-vX.Y.Z-fedora44-x86_64-systemd.tar.gz`: Release archive containing binaries, unit templates, sysusers, and web dist
3. `release-manifest.json`: Authoritative Manifest v1 metadata (SHA-256 digests, role projections, unit definitions)
4. `dam-hopper-vX.Y.Z-fedora44-x86_64-systemd.spdx.json`: Machine-readable SPDX 2.3 SBOM

### Trust Flow and Integrity Guarantees

```text
[GitHub Release] ──> curl (unprivileged)
      │
      ├──> SHA-256 Checksum Validation (MANDATORY)
      │    Archive digest matched against release-manifest.json
      │
      └──> GitHub Artifact Attestation (OPTIONAL)
           Verified using `gh attestation verify` when requested.
           When omitted, operator accepts checksum-only authentication.
```

- **Mandatory SHA-256 Verification:** The manager and bootstrap script compute the SHA-256 digest of downloaded assets and strictly assert equality against `release-manifest.json`.
- **Optional GitHub Attestation:** If `--verify-attestation` is specified, `gh` is required; the bootstrap script verifies SLSA provenance and cryptographic attestations signed by GitHub Actions, and aborts if `gh` is absent. When `--verify-attestation` is omitted, the installer performs mandatory SHA-256 checksum validation alone; the operator accepts that checksums alone do not authenticate the publisher against repository compromise.
- **Exclusion of Secrets:** Release archives never contain `.env`, `server.env`, tokens, passwords, database credentials, SQLite databases, or machine-local configuration.

---

## 3. Host Architecture and Service Roles

DamHopper provides three independently managed runtime services coordinated by
a root-only recovery unit:

| Unit                                     | Process Binary                   | User / Group                           | Listener                            | Sandboxing & Capabilities                                                                            |
| ---------------------------------------- | -------------------------------- | -------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `dam-hopper-recovery.service`            | `dam-hopper recover --boot`      | `root:root`                            | None                                | Oneshot pre-boot gate before application units                                                       |
| `dam-hopper-idle-suspend-helper.service` | `dam-hopper-idle-suspend-helper` | `root:dam-hopper` (rendered API group) | `/run/dam-hopper/idle-suspend.sock` | `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`, `CAP_WAKE_ALARM` |
| `dam-hopper-api.service`                 | `dam-hopper-server`              | `dam-hopper:dam-hopper` (default rendered identity) | `0.0.0.0:4801`                      | Dedicated PTY/auth/file operations; `NoNewPrivileges=false`                                          |
| `dam-hopper-web.service`                 | `dam-hopper-web`                 | `dam-hopper-web:dam-hopper-web`        | `0.0.0.0:4802`                      | Read-only static host; `ProtectSystem=strict`, `NoNewPrivileges=true`                                |

> **Security Notice on API Identity:** The checked-in API unit and default
> release-manager render run `dam-hopper-api.service` as the unprivileged
> `dam-hopper:dam-hopper` account. A custom rendered identity must remain
> non-root; verify the effective `User=`/`Group=` on each host. An API or PTY
> compromise is therefore bounded by that service account's access, while host
> firewall and Tailscale ACLs still must limit port `4801`. The web service
> runs under a dedicated, unprivileged system account (`dam-hopper-web`) with
> strict filesystem sandboxing. The helper is root-owned but accepts only the
> enrolled API peer over its local socket.

### Deployment Roles

- `server`: Deploys and manages `dam-hopper-idle-suspend-helper.service` and
  `dam-hopper-api.service` (API listens on `0.0.0.0:4801`).
- `web`: Deploys only `dam-hopper-web.service` (listening on `0.0.0.0:4802`).
- `both`: Deploys the server and web units in lockstep.

The recovery unit is staged for every role. Neither application unit depends on
the other. The helper is a server-role companion and is started before the API
by `dam-hopper start`; a helper start/enable failure is logged as a warning so
non-suspend API operations remain available.

---

## 4. Filesystem Hierarchy and Permissions

DamHopper enforces strict separation between immutable release assets, durable manager state, machine-local configuration, and application data:

```text
/opt/dam-hopper/
├── releases/
│   └── <vX.Y.Z>/
│       └── <role>/          # Selected role view ('server', 'web', or 'both')
│           ├── bin/         # 0755 root:root (manager, server [if server/both], web [if web/both])
│           └── web/         # 0755 root:root (SPA static dist [if web/both])
├── current -> releases/<vX.Y.Z>/<role>   # Repairable convenience symlink
└── .staging/                # 0700 root:root (temporary staging workspace)

/var/lib/dam-hopper-manager/ # 0755 root:root
├── state.json                     # 0600 root:root (Authoritative generation-numbered state)
├── pending-units-<tx_id>/         # 0700 root:root (Transaction-scoped candidate unit files)
├── pending-host-config-<tx_id>.json # 0644 root:root (Candidate public runtime config)
└── backups/<tx_id>/               # 0700 root:root (Concrete unit & config rollback backups)

/etc/dam-hopper/             # 0755 root:root
├── host.toml                # 0644 root:root (Recorded deployment role and allowed web origins)
└── host-config.json         # 0644 root:root (Committed public runtime config)

/etc/systemd/system/
├── dam-hopper-recovery.service
├── dam-hopper-idle-suspend-helper.service # Present only if role is 'server' or 'both'
├── dam-hopper-api.service   # Present only if role is 'server' or 'both'
└── dam-hopper-web.service   # Present only if role is 'web' or 'both'

The helper service opens `/run/dam-hopper/idle-suspend.sock` from its fixed
`ExecStart` arguments. The optional socket-unit template is an archive asset;
the release manager's managed lifecycle list covers the helper service itself.

/run/lock/dam-hopper/
└── deploy.lock              # Nonblocking file lock serializing deployment operations
```

---

## 5. Operator Installation and Lifecycle Workflow

### 5.1 Fresh Installation (Bootstrap)

`dam-hopper-install.sh` stages candidate files, copies the manager CLI to `/usr/local/bin/dam-hopper`, and stops at `PENDING`.

1. **Download bootstrap script:**

   ```bash
   curl -fsSLO https://github.com/loidinhm31/dam-hopper/releases/latest/download/dam-hopper-install.sh
   chmod +x dam-hopper-install.sh
   ```

2. **Stage candidate release:**

   ```bash
   # Install API server role
   ./dam-hopper-install.sh --latest --role server

   # Install dedicated web host role
   ./dam-hopper-install.sh --latest --role web

   # Install both roles with CORS web origin authorization
   ./dam-hopper-install.sh --latest --role both --allow-web-origin http://localhost:4802
   ```

   **Staging Behavior:** `install` runs preflight checks, extracts files to `/opt/dam-hopper/releases/<vX.Y.Z>/<role>`, renders unit templates to `/var/lib/dam-hopper-manager/pending-units-<tx_id>/` and public config to `/var/lib/dam-hopper-manager/pending-host-config-<tx_id>.json`, and updates `/var/lib/dam-hopper-manager/state.json` to state `PENDING`. It **never** alters running services, replaces units in `/etc/systemd/system/`, switches `/opt/dam-hopper/current`, or opens listeners.

3. **Inspect pending state:**

   ```bash
   dam-hopper status
   # Or for machine-readable automation:
   dam-hopper status --json
   ```

4. **Explicitly activate the release:**
   ```bash
   sudo dam-hopper start
   ```

### 5.2 Release Activation Gate

The `dam-hopper start` command is the sole activation entrypoint. Under `/run/lock/dam-hopper/deploy.lock`:

1. Quiesces existing services and verifies cgroups, listeners (4801/4802), and SQLite file holders are completely released.
2. Backs up active systemd units and configuration to `/var/lib/dam-hopper-manager/backups/<tx_id>/`.
3. Installs concrete units to `/etc/systemd/system/` and runs `systemctl daemon-reload`.
4. For a server role, starts `dam-hopper-idle-suspend-helper.service` **before** `dam-hopper-api.service`. A helper start failure emits a warning and does not block API startup.
5. Starts the selected web unit when the role includes `web`, then enters state `PROBING`.
6. **Health Stability Gate:**
   - API/web units must report active within a **20-second startup deadline**.
   - API/web units must then satisfy **20 consecutive successful probes spaced at 500 ms** (10 seconds of uninterrupted stability).
   - Probes verify: expected MainPID, executable path, process UID/GID, exact listener, and valid JSON response (`status: "ok"`, `schemaVersion: 1`, expected `version` and `role`).
7. On success, API/web units are enabled, helper enablement is best-effort, `current` symlink is updated, and state advances to `COMMITTED`.

### 5.3 Upgrading to a New Release

Upgrading follows the exact same two-step pattern:

```bash
# Stage candidate version without interrupting current service
./dam-hopper-install.sh --version v0.2.0 --role both

# Verify candidate is staged
dam-hopper status

# Commit activation through health gate
sudo dam-hopper start
```

If health checks fail during activation, the manager automatically rolls back to the previous release.

### 5.4 Changing Roles

To switch between `server`, `web`, and `both`, supply the release bundle (either retained from installation or fetched via `dam-hopper fetch`):

```bash
# Fetch release bundle if not already retained
dam-hopper fetch --latest --output /tmp/dam-hopper-bundle

# Stage role transition to 'both' with required --bundle option
sudo dam-hopper role set --bundle /tmp/dam-hopper-bundle both --allow-web-origin http://localhost:4802

# Activate transition
sudo dam-hopper start
```

---

## 6. Health Probes and Runtime Configuration

### API Service Health (`0.0.0.0:4801`)

`GET /api/health` returns HTTP 200 with:

```json
{
  "schemaVersion": 1,
  "status": "ok",
  "version": "0.1.0",
  "role": "api"
}
```

### Web Host Health (`0.0.0.0:4802`)

`GET /__dam-hopper/health` returns HTTP 200 with:

```json
{
  "schemaVersion": 1,
  "status": "ok",
  "version": "0.1.0",
  "role": "web"
}
```

### Web Runtime Configuration

`GET /__dam-hopper/runtime-config.json` returns:

```json
{
  "schemaVersion": 1,
  "releaseVersion": "0.1.0",
  "profileId": "c7325e68-07e1-4e44-8d96-b333a4658cf9"
}
```

_Note:_ On a fresh install, `apiUrl` is omitted. A new web UI starts in the standard server-profile setup flow, where user-saved profiles remain authoritative. `apiUrl` is present only when explicitly configured in retained host configuration (`/etc/dam-hopper/host-config.json`).

---

## 7. Rollback, Crash Recovery, and Boot Ordering

### Automatic Rollback

If candidate API/web units fail to start within 20 seconds, crash during
probing, or fail any of the 20 consecutive health checks:

1. Candidate units, including the helper for a server role, are stopped and
   disabled.
2. Previous concrete units and configuration are restored from
   `/var/lib/dam-hopper-manager/backups/<tx_id>/`.
3. `systemctl daemon-reload` is executed. For a previous server role, the
   helper is started before the API; helper start failure is warning-only.
4. Previous API/web units are verified against the 10-second health gate.
5. On a clean first install with no previous release, all managed units
   (including the helper) are stopped and disabled.

Manual `sudo dam-hopper rollback` promotes the recorded `previous` release
through the same activation path, so the helper stop/start ordering and
non-fatal fallback also apply.

### Manual Rollback

To revert an active release to the recorded `previous` version:

```bash
sudo dam-hopper rollback
```

The manager executes the rollback transaction using the recorded backup artifacts and verifies health before completing.

### Boot Recovery Service

`dam-hopper-recovery.service` is a root-owned oneshot unit ordered after `local-fs.target` and before `dam-hopper-api.service` and `dam-hopper-web.service`.
At boot:

- Reconciles any interrupted transaction in `/var/lib/dam-hopper-manager/state.json`.
- Disables helper/API/web units while a `PENDING` candidate is retained.
- Restores backups, including the helper, if a crash occurred during `QUIESCED`, `SWITCHED`, or `PROBING`.
- Repairs `current` and systemd enablement for `COMMITTED` releases; helper enablement is best-effort for server roles and disabled for non-server roles.
- Fails closed, stops/disables all managed units, and blocks application startup if state is corrupted, marking status as `RECOVERY_REQUIRED`.

---

## 8. Format-2 Legacy Migration

DamHopper provides a one-time automated migration path for existing checkout-runner (format-2) installations:

### Invariants for Format-2 Detection

The legacy installation must strictly match:

- Canonical root `/opt/dam-hopper` containing only `bin/dam-hopper-server` and `.systemd-fresh-install/`.
- Marker `.systemd-fresh-install/manifest` with `format=2`, nonces, and matching SHA-256 digests.
- Unit `/etc/systemd/system/dam-hopper.service` running as `loidinh`.
- Active process on `0.0.0.0:4801` responding with `status: "ok"`.

### Atomic Directory Exchange

Upon `sudo dam-hopper start` during a migration transaction:

1. The new release is side-staged in `/opt/.dam-hopper-migration.<tx_id>`.
2. Existing service is quiesced.
3. Linux `renameat2(RENAME_EXCHANGE)` atomically swaps `/opt/dam-hopper` and `/opt/.dam-hopper-migration.<tx_id>`.
4. Legacy unit `/etc/systemd/system/dam-hopper.service` is removed and new units are installed.
5. Legacy release is recorded as `imported-format-2` in `previous` state for safe rollback.

_Any format-1 layout (containing `web.sha256` or `/opt/dam-hopper/web`) or drifted configuration fails closed before any filesystem mutation._

---

## 9. Troubleshooting and Diagnostics

### Inspecting Manager State

```bash
# Human-readable state summary
dam-hopper status

# Full JSON state payload
dam-hopper status --json
```

### Inspecting Service Logs

```bash
# Idle-suspend helper journal
journalctl -u dam-hopper-idle-suspend-helper.service -f --no-tail

# API service journal
journalctl -u dam-hopper-api.service -f --no-tail

# Web host service journal
journalctl -u dam-hopper-web.service -f --no-tail

# Boot recovery unit journal
journalctl -u dam-hopper-recovery.service --no-tail
```

### Common Failure Resolutions

- **Port Conflict (4801 / 4802):** Check `ss -tulpn | grep -E '4801|4802'` for foreign processes.
- **Lock Contention:** If `/run/lock/dam-hopper/deploy.lock` is held, wait for the concurrent manager process to finish. Do not delete the lock while a manager process is active.
- **`RECOVERY_REQUIRED` State:** Run `sudo dam-hopper recover` to attempt automatic reconciliation. Check journal logs for root causes.

---

## 10. Retired Checkout-Runner Commands and Obsolete Paths

The old checkout-runner production workflow is retired:

- `deploy/run-linux-production.sh`
- the fixed `deploy/systemd/dam-hopper.service` unit
- `pnpm linux:production` / `pnpm linux:reset`

Use `dam-hopper-install.sh` and the `dam-hopper` CLI for release lifecycle
operations. `deploy/reset-linux-production.sh` is retained only as the
idle-suspend helper reset/rollback tool documented in section 11.4; it is not
a general release manager.

---

## 11. Terminal Idle Suspend Helper Enrollment & Rollback Runbook

The server-authoritative terminal idle suspend subsystem provides two automatic
policies. `empty-fleet` requests host suspend only after all managed PTYs are no
longer live, creating, or restart-pending. `agent-activity` uses configured-agent
PTY/process/TCP evidence and may suspend while service-only terminals remain
open; it is an activity heuristic, not proof that an agent has finished. Both
policies use RTC wake after a bounded quiet period. The enrolled helper also
supports the Phase 01 execution-only indefinite-sleep sentinel; automatic
persisted timing remains bounded.

### 11.1 Host Qualification Requirements

Before enabling terminal idle suspend on a production host:

1. **Kernel & RTC Hardware**: The host must expose a functional RTC wakealarm device at `/sys/class/rtc/rtc0/wakealarm`.
2. **Systemd & Logind**: The fixed `systemctl suspend` path must reach systemd/logind and support suspend without desktop session inhibitors blocking non-interactive operation.
3. **RTC ownership and inhibitors**: DamHopper must be the approved owner of `rtc0` wakealarm. A non-empty existing alarm is rejected as busy; active system inhibitors (for example system update locks or backup operations) are respected and cause suspend requests to fail closed without retry.

### 11.2 Privileged Helper Enrollment & Hardening

The privileged helper binary `dam-hopper-idle-suspend-helper` executes the fixed suspend request with RTC wakealarm programming over a local Unix domain socket. In the Phase 03 release-manager path, the helper service itself binds `/run/dam-hopper/idle-suspend.sock` from its ExecStart arguments:

- **Manager-managed service**: `deploy/systemd/dam-hopper-idle-suspend-helper.service` runs the helper under strict systemd hardening:
  - `NoNewPrivileges=yes`
  - `ProtectSystem=strict`
  - `ProtectHome=yes`
  - `PrivateTmp=yes`
  - `CapabilityBoundingSet=CAP_WAKE_ALARM`
- **Socket permissions**: The service uses `RuntimeDirectory=dam-hopper` with mode `0775`; the helper binds the socket and sets mode `0660`.
- **Optional socket unit**: `deploy/systemd/dam-hopper-idle-suspend-helper.socket` is a packaged manual/socket-activation asset. The Phase 03 release manager stages and manages the helper **service**, not this `.socket` unit. Do not enable both direct-binding service mode and the socket unit for the same path.
- **Peer Credential Verification**: The helper validates peer UID and PID on connection via `SO_PEERCRED`, rejecting unauthorized callers.
- **Audit Trail**: The single `/var/log/dam-hopper/idle-suspend-helper.jsonl`
  file (mode `0600`) records request/authentication evidence plus v2
  capability, preflight, accepted-intent, RTC, suspend-invocation, and
  completion milestones. No parallel helper log is used.

The server always configures the systemd helper executor and checks the
configured socket's presence and health per request
(`DAM_HOPPER_IDLE_SUSPEND_SOCKET` overrides the default path), even when
automatic `[server.idle_suspend] enabled = false`. Automatic scheduling policy
and manual execution availability are separate; both still fail closed on
missing capability, RTC ownership, inhibitor, audit, or handoff prerequisites.

#### Phase 01 RTC and wake semantics

The helper protocol remains version 1 and accepts `wakeAfterSeconds: 0` or
`60..=86400` only. Zero is converted to clear-only mode: the helper writes
`0` to `/sys/class/rtc/rtc0/wakealarm`, reads it back, and skips target-epoch
calculation and writes. A timed value clears and verifies first, computes a
checked `now + seconds`, writes the target, and verifies the readback.

Peer authentication, protocol version checks, request-ID deduplication,
capability/inhibitor/RTC preflight, and the intent audit occur before RTC
mutation. Any busy alarm, audit-intent failure, clear/readback/write failure,
or unsupported capability suppresses suspend. Intent and completion records
retain `wakeAfterSeconds: 0`; the helper audit remains mode `0600` and bounded.
The server audit's recent-read APIs are capped; its append retention and
rotation are operator-managed.
#### Phase 04 helper audit v2

The helper audit evolves in place with independent schema version `2`; the
protocol remains version `1`, with the same required `requestId`/
`wakeAfterSeconds` fields and 4-KiB frame cap. Established
`acceptedIntent`, `executionCompleted`, and `executionRejected` records remain
readable, including legacy lines whose schema version is implicit v1.

New lines carry timestamp, canonical boot/producer identity, checked producer
sequence, safely available UUID correlation, numeric peer PID/UID, and closed
reason/outcome codes. Additive `recordType` values are `requestRejected`,
`capabilityResult`, `preflightResult`, `rtcProgrammingResult`, and
`suspendInvoked`. Capability probes and auth/frame failures use null
correlation when no validated action request ID exists. Restricted detail is
source-only and is not suitable for bundle projection.

The authoritative order is authenticate/decode/validate/deduplicate, emit
capability or preflight evidence, synchronously persist `acceptedIntent`,
program and verify RTC, emit the RTC result and `suspendInvoked`, invoke the
fixed suspend backend, then record the actual completion. Only intent sync
failure blocks RTC/suspend; later milestone write failures cannot rewrite the
backend outcome.

The file is capped at 10,000 records. Overflow pruning retains the newest
half through an exclusive mode-`0600` no-follow temporary file, syncs the
retained file and parent directory before atomic replacement, and removes the
temporary file on failure. A helper restart creates a new producer instance
and restarts its sequence at one.


The Phase 02 canonical server event stream is separate from both audit files.
The isolated writer targets
`/var/lib/dam-hopper/.config/dam-hopper/diagnostics/idle-suspend-events-v1.jsonl`
with mode `0600`, no-follow append/sync semantics, and does not add a systemd
unit or `StateDirectory=` directive. Its parent is expected to be provisioned
by the API runtime path owner. Phase 03 passes the optional writer from
`AppState` into the coordinator; construction failure records a sanitized
backend diagnostic and disables only semantic emission, not API startup or
suspend/status behavior.

Do not qualify indefinite sleep from an automated test: repository tests use
temporary files and fake backends and never invoke `systemctl`, logind, or a
real RTC. A production indefinite canary requires explicit operations approval
and a verified physical or out-of-band wake path; use a bounded timed canary
first.

### 11.3 Boundary Verification

Run the non-privileged boundary verification script before deployment:

```bash
./scripts/verify-idle-suspend-boundary.sh
```

The script executes 14 static and presence checks. Check 13 verifies that both
API unit files declare `PIDFile=/run/dam-hopper/server.pid`, write `$MAINPID`
from `ExecStartPost`, and remove the PID from `ExecStopPost`. Check 14 verifies
that `HELPER_SERVICE_UNIT` is defined, staged, started by activation, and
included in status inspection.

For release-manager integration coverage, run:

```bash
cargo test --manifest-path server/Cargo.toml --test linux_release_staging
cargo test --manifest-path server/Cargo.toml --test linux_release_unit_policy
cargo run --manifest-path server/Cargo.toml --bin dam-hopper -- status --json
```

The staging suite covers helper hardening and fixed paths, API PID hooks,
server/web/both role projections, and helper status-role mapping. The status
smoke check should list API and helper under `role: "server"` (plus web and
recovery records when present). These checks do not invoke host suspend, logind,
or real RTC hardware; qualify a real host separately.

### 11.4 Rollback and Emergency Reset

To completely disenroll the privileged helper, revert configuration, and restore host integrity:

```bash
# Dry-run simulation:
./deploy/reset-linux-production.sh --dry-run

# Full production reset (requires root):
sudo ./deploy/reset-linux-production.sh
```

Rollback guarantees:

1. The operator first verifies the authoritative server status has no active or in-flight handoff. The reset script checks socket presence only; it cannot inspect coordinator state.
2. Atomically disables `enabled = false` under `[server.idle_suspend]`.
3. Stops and disables the manager-managed helper service; it also stops, disables, and removes the optional helper socket unit when present.
4. Preserves external RTC alarms (never clears unrelated alarms).
5. Removes only manifest-owned helper assets and runs `systemctl daemon-reload`.
6. Preserves audit logs for post-mortem operator analysis.

### 11.5 Manual Force Sleep Qualification & Canary Runbook

This is an operator procedure, not automated-test evidence. Automated checks use
fake RTC/executor backends and never invoke `systemctl`, logind, real RTC
hardware, or host suspend.

1. **Prerequisites Verification**:
   - Host kernel must support `/sys/class/rtc/rtc0/wakealarm`.
   - Verify exclusive RTC ownership: ensure `/sys/class/rtc/rtc0/wakealarm` is empty; preserve and investigate any foreign alarm.
   - In manager-managed service mode, verify `systemctl is-active dam-hopper-idle-suspend-helper.service` returns `active` and `test -S /run/dam-hopper/idle-suspend.sock` succeeds. The release manager does not enable the `.socket` unit. If a separate socket-unit enrollment is used, verify that socket instead and do not run the direct-binding service concurrently.
   - Verify database-backed authentication is functioning; `--no-auth` mode strictly prohibits manual sleep.
   - Verify the server status has no active/in-flight handoff and record the current status revision.

2. **Timed Canary Qualification (Required First)**:
   - Perform during an approved maintenance window with physical or out-of-band recovery.
   - Using the active authenticated profile, make exactly one manual POST with a bounded timer (for example `{ "wakeAfterSeconds": 120, "force": false }` when the fleet is quiescent). Do not retry an ambiguous response.
   - Monitor `/var/log/dam-hopper/idle-suspend-helper.jsonl` for the ordered
     preflight, intent, RTC, invocation, and completion milestones (exactly
     one `acceptedIntent` and `executionCompleted`) and the server
     `idle-suspend-audit.jsonl` for the actor/request outcome.
   - Confirm the machine suspends and automatically resumes within the approved tolerance.
   - Upon resume, refetch status and verify the status revision/`host:idleSuspendChanged` reconciliation, handoff release, and no duplicate suspend request.

3. **Indefinite Sleep Canary Protocol (High Risk)**:
   - **Warning**: Indefinite sleep (`wakeAfterSeconds: 0`) clears the RTC wakealarm (no auto-wake). The machine will NOT wake on a timer.
   - **Mandatory Requirements**:
     - Operations owner approval with assigned physical or out-of-band recovery personnel (for example IPMI/iLO/BMC, Wake-on-LAN, or physical power button).
     - Never execute an indefinite canary on a remote host without verified out-of-band power cycling capability.
     - Submit exactly one POST and never replay it after a network interruption.
   - Confirm post-resume status, audit, handoff, and PTY reconciliation once manually awakened.

### 11.6 Target-Host Observer Qualification (Phase 07 Gate)

Before enabling the `agent-activity` automatic policy on any host, qualify that host's kernel, permissions, and service context:

1. **Kernel and Socket Diagnostic Prerequisite**:
   Verify that the kernel supports `NETLINK_SOCK_DIAG` socket diagnostics for `INET` and `INET6` sockets, and that `TCP_INFO` byte counters (`tcpi_bytes_received`, `tcpi_bytes_sent`) are populated.

2. **Procfs Visibility**:
   Verify that the user running `dam-hopper-api.service` can inspect `/proc/<pid>/stat`, `/proc/<pid>/cmdline`, and `/proc/<pid>/fd` for child processes spawned under managed PTY sessions.

3. **Execute Live Linux Smoke Suite**:
   Run the canonical integration check from a source checkout on the target host:

   ```bash
   cargo test --manifest-path server/Cargo.toml --test idle_suspend \
     activity_live_linux_pty_tcp_smoke -- --ignored --exact --nocapture --test-threads=1
   ```

   *Expected Result*: Test passes within 1.00 second (the Phase 08 QA run measured 0.74s). This is observer evidence only, not a target-host or suspend-canary guarantee. The test uses real Linux loopback TCP, managed PTYs, and direct procfs/netlink observation, with a panic executor that guarantees zero host suspend calls.
   Run the command from a source checkout with the deployed API service's
   effective UID/GID, procfs visibility, mount view, and network namespace (or
   an equivalent `systemd-run` sandbox). Do not add root privileges, capabilities,
   shell wrappers, or a broader namespace just to make the test pass; record the
   actual service-context result and shutdown/join latency.

4. **Sample Budget and Bounded Join**:
   Verify that observation samples consistently complete within the 1-second budget and that worker thread shutdown joins cleanly without hanging on stalled syscalls.

### 11.7 Protected Status Interpretation & Operator Reason Guide

The protected status endpoint (`GET /api/system/idle-suspend/v1/status`) reports `activity.measurementState` and `activity.reasonCode`. Use this guide to interpret status and determine appropriate operator action:

| Measurement / reason                   | Operator interpretation                                  | Action                                                                                |
| -------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `initializing` / null                  | No qualified baseline yet                                | Wait for a complete sample; do not enable automatic action based on it                |
| `available` / `recentInput`            | Accepted terminal input reset quiet globally             | Expected; countdown restarts                                                          |
| `available` / `recentOutput`           | Raw bytes arrived in an agent-owned/mixed terminal       | Expected; investigate noisy spinner/service only if false-busy matters                |
| `available` / `recentNetwork`          | Attributable TCP4/TCP6 socket changed                    | Expected; unchanged connection alone does not count                                   |
| `available` / `agentChanged`           | Relevant identity/socket baseline changed                | Expected conservative activity and fresh quiet window                                 |
| `available` / `lifecycleBusy`          | Create/restart/dispose/close/handoff blocks admission    | Wait for lifecycle settlement; do not override automatically                          |
| `available` / `quiet`                  | Complete heuristic sample, no recent qualifying activity | Candidate only; final fresh scan and admission checks still required                  |
| `available` / `epochSpent`             | This genuine-activity epoch already attempted            | No automatic retry until new genuine activity                                         |
| `unavailable` / `procAccess`           | Required proc identity/ownership inaccessible            | Fix service/proc permissions or roll back to `empty-fleet`                            |
| `unavailable` / `scanLimit`            | A hard bound made the sample incomplete                  | Reduce managed workload or stay on `empty-fleet`; never tune away bounds casually     |
| `unavailable` / `scanTimeout`          | Complete sample missed the 1s budget                     | Investigate target-host latency; no automatic claim                                   |
| `unavailable` / `socketDiagnostics`    | Direct kernel socket diagnostics/counters incomplete     | Verify kernel support/service sandbox; no fallback to interface traffic               |
| `unavailable` / `unsupportedTransport` | Attributable UDP/QUIC is present                         | Policy cannot qualify while present; use `empty-fleet` if workload requires it        |
| `unavailable` / `namespaceMismatch`    | Ownership crosses current network namespace              | Unsupported boundary; do not claim coverage                                           |
| `unavailable` / `staleObservation`     | Sample/ticket exceeded age or was invalidated            | Wait for fresh sample; repeated events indicate load/race issue                       |
| `unavailable` / `identityUncertain`    | PID/incarnation/root attribution cannot be proven        | Let workload settle/restart naturally or use `empty-fleet`; never kill it as recovery |
| `unavailable` / `counterOverflow`      | Monotonic evidence cannot be compared safely             | New incarnation/reconciliation required; no automatic claim                           |
| `unavailable` / `reconciling`          | Resume/outcome identity and baseline rebuild in progress | Wait; recovery is not new activity and does not re-arm a spent epoch                  |

### 11.8 Observation-Only Canary Soak Runbook

To validate activity observation on a candidate host without risking unexpected automatic sleep:

1. In `/etc/dam-hopper/dam-hopper.toml`, set:
   ```toml
   [server.idle_suspend]
   enabled = false
   automatic_policy = "agent-activity"
   agent_executables = ["codex", "omp", "claude", "agy"]
   ```
2. Restart the API service:
   ```bash
   sudo systemctl restart dam-hopper-api.service
   ```
3. Poll protected status and observe activity state:
   ```bash
   curl -s -H "Authorization: Bearer <operator-token>" \
     http://127.0.0.1:4801/api/system/idle-suspend/v1/status | jq .activity
   ```
4. Exercise workloads:
   - Start recognized agents (`claude`, `omp`, etc.) and observe `recentOutput` or `recentNetwork`.
   - Send interactive input to any terminal and observe `recentInput`.
   - Run service-only terminals and observe that they do not reset quiet.
   - Verify that when quiet time elapses, status reports `quiet`, but **zero** automatic suspend requests are made because `enabled = false`.
   - Verify that any measurement warning contains safe PID/identity examples without leaking command arguments or socket details.

The warning is an operational measurement report, not a countdown or completion
signal. When unavailable, `activity.measurementWarning` contains one continuous
`blockedSinceMs` interval, the closed reason, and at most 32 current attributable
`{ pid, executableIdentity }` examples in positive PID order. Identity is nullable
and capped at 256 UTF-8 bytes without controls. Cause/PID changes preserve the
interval; complete available recovery clears it, and a later failure starts a new
interval. The warning appears only in authenticated, `Cache-Control: no-store`
status; logs, audits, WebSocket hints, and rollout artifacts contain no process
details.
### 11.9 Bounded Automatic Canary Runbook (Operations Gate)

Executing a real automatic host suspend canary is an explicit Operations procedure requiring written approval:

1. **Approval Prerequisites**:
   - Designated host owner, scheduled maintenance window, and on-call rollback engineer.
   - Verified physical or BMC/IPMI out-of-band power access.
   - Clean RTC status: `/sys/class/rtc/rtc0/wakealarm` must be empty.
   - Zero system sleep inhibitors: `systemd-inhibit --list` must show no active inhibitors.
   - Verify database-backed authentication, helper service/socket capability, and
     a clean status with no active or in-flight handoff.

2. **Enablement**:
   In `/etc/dam-hopper/dam-hopper.toml`, set:
   ```toml
   [server.idle_suspend]
   enabled = true
   automatic_policy = "agent-activity"
   quiet_period_seconds = 900
   wake_after_seconds = 180
   ```
   Restart API: `sudo systemctl restart dam-hopper-api.service`.

3. **Execution and Verification**:
   - Generate one genuine activity epoch with a recognized agent.
   - Allow the agent to finish and the quiet period to elapse.
   - Observe machine suspension and automatic wake at the scheduled RTC time (180s).
   - Upon wake, refetch status and verify:
     - `state` reconciled to `watching` or `armed`.
     - `currentEpoch` advanced, latching the spent epoch.
     - Helper audit `/var/log/dam-hopper/idle-suspend-helper.jsonl` contains
       exactly one `acceptedIntent` and one `executionCompleted`, plus the
       expected preflight, RTC-programming, and suspend-invocation milestones.
     - Server audit `idle-suspend-audit.jsonl` contains the matching handoff record.
     - No duplicate suspend request is issued while conditions remain unchanged.

### 11.10 Controlled Rollout Stop Criteria

Immediately halt rollout and execute rollback upon encountering any of the following:

1. **Unexpected Suspend**: Host suspends while an attributable agent is actively producing network or PTY traffic, or while a service-only workload was unintentionally treated as eligible.
2. **Missed RTC Wake**: Host fails to resume automatically within approved timer tolerance.
3. **Duplicate Handoff**: More than one handoff is dispatched within the same activity epoch.
4. **Stuck Handoff**: Server remains in `handedOff` state without post-resume reconciliation.
5. **False Quiet**: Status reports `quiet` during known active agent computation or unobserved transport activity.
6. **Persistent Unavailable**: Repeated `scanTimeout`, `scanLimit`, `procAccess`, `socketDiagnostics`, `unsupportedTransport`, `namespaceMismatch`, `identityUncertain`, `counterOverflow`, or `reconciling` warnings.
7. **Budget or Join Failure**: Sampling exceeds the one-second deadline, or shutdown cannot join the sampler cleanly.
8. **Privacy Leakage**: Any command arguments, environment variables, matcher entries, socket addresses, terminal content, or raw diagnostics appear in status warnings, logs, audits, WebSocket hints, or rollout artifacts.
9. **Lost Reconciliation**: PTY/process baselines, helper outcome, audit chain, or status revision cannot be reconciled after resume.

### 11.11 Rollback and Emergency Disable Procedures

#### Level 1: Activity Policy Rollback

Restores legacy zero-active-fleet behavior without disturbing helper enrollment or manual sleep:

1. Refetch protected status and ensure there is no `finalCheck`, `handedOff`, or
   active handoff. Reconcile an accepted handoff before restarting; a config edit
   is not cancellation.
2. Back up `/etc/dam-hopper/dam-hopper.toml` while preserving owner and mode.
3. Edit the active registry:
   ```toml
   [server.idle_suspend]
   automatic_policy = "empty-fleet"
   ```
4. Restart the API:
   ```bash
   sudo systemctl restart dam-hopper-api.service
   ```
5. Verify status:
   ```bash
   curl -s -H "Authorization: Bearer <operator-token>" \
     http://127.0.0.1:4801/api/system/idle-suspend/v1/status | jq '{automaticPolicy, activity, state}'
   ```
   Require `automaticPolicy: "empty-fleet"` and `activity: null`.

#### Emergency Disable

Immediately disables all automatic idle-suspend scheduling:

1. Refetch protected status and resolve any accepted handoff before restarting.
2. In `/etc/dam-hopper/dam-hopper.toml`, set `enabled = false` and
   `automatic_policy = "empty-fleet"`.
3. Restart the API: `sudo systemctl restart dam-hopper-api.service`.
4. Verify `state: "disabled"` and `activity: null`.

#### Level 2: Complete Disenrollment & Helper Removal

To completely remove helper units and restore pristine host configuration, use the root disenrollment script:

```bash
sudo ./deploy/reset-linux-production.sh --dry-run
sudo ./deploy/reset-linux-production.sh
```
