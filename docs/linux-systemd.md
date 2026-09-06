# Linux systemd Deployment and Operator Guide

Authoritative deployment, role management, activation, rollback, recovery, and format-2 migration guide for DamHopper on Fedora 44 x86_64 systemd hosts.

## 1. Supported Platform and System Requirements

The published DamHopper release provides immutable, attested binary releases for Fedora 44. Target hosts do not require a compiler, Git repository checkout, Node.js, pnpm, Cargo, or Rust toolchain.

| Requirement | Specification | Verification / Fallback |
|---|---|---|
| **Operating System** | Fedora Linux 44 | Required; `/etc/os-release` `ID=fedora`, `VERSION_ID=44` |
| **Architecture** | x86_64 (amd64) | Required; `uname -m` == `x86_64` |
| **C Library** | GNU libc >= 2.43 | Dynamically linked against system glibc |
| **Init & Service Manager** | systemd >= 259 | Unified cgroup v2; PID 1 system manager |
| **Security Module** | SELinux Enforcing | Standard targeted policy; units use native sandboxing |
| **Host Utilities** | `curl`, `tar`, `gzip`, `sha256sum`, `sudo`, `systemd` | Required on path for bootstrap/archive handling |
| **Attestation Verifier** | GitHub CLI (`gh`) | Optional; required only when `--verify-attestation` is passed |

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

DamHopper provides two independently managed services coordinated by a root-only recovery unit:

| Unit | Process Binary | User / Group | Listener | Sandboxing & Capabilities |
|---|---|---|---|---|
| `dam-hopper-recovery.service` | `dam-hopper recover --boot` | `root:root` | None | Oneshot pre-boot gate before application units |
| `dam-hopper-api.service` | `dam-hopper-server` | `root:root` | `0.0.0.0:4801` | Dedicated PTY/auth/file operations; `NoNewPrivileges=false` |
| `dam-hopper-web.service` | `dam-hopper-web` | `dam-hopper-web:dam-hopper-web` | `0.0.0.0:4802` | Read-only static host; `ProtectSystem=strict`, `NoNewPrivileges=true` |

> ⚠️ **Security Notice on API Identity:** Running `dam-hopper-api.service` as `root:root` is an accepted v1 MVP operational decision for host PTY and development container operations. An API or PTY compromise equals root compromise. Host firewall and Tailscale ACLs must strictly limit access to port `4801`. The web service runs under a dedicated, unprivileged system account (`dam-hopper-web`) with strict filesystem sandboxing.

### Deployment Roles

- `server`: Deploys only `dam-hopper-api.service` (listening on `0.0.0.0:4801`).
- `web`: Deploys only `dam-hopper-web.service` (listening on `0.0.0.0:4802`).
- `both`: Deploys both `dam-hopper-api.service` and `dam-hopper-web.service` in lockstep.

Neither application unit depends on the other. Both units depend on `dam-hopper-recovery.service` having completed successfully.

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
├── dam-hopper-api.service   # Present only if role is 'server' or 'both'
└── dam-hopper-web.service   # Present only if role is 'web' or 'both'

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
4. Starts selected role units and enters state `PROBING`.
5. **Health Stability Gate:**
   - Units must report active within a **20-second startup deadline**.
   - Units must then satisfy **20 consecutive successful probes spaced at 500 ms** (10 seconds of uninterrupted stability).
   - Probes verify: expected MainPID, executable path, process UID/GID, exact listener, and valid JSON response (`status: "ok"`, `schemaVersion: 1`, expected `version` and `role`).
6. On success, units are enabled, `current` symlink is updated, and state advances to `COMMITTED`.

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
*Note:* On a fresh install, `apiUrl` is omitted. A new web UI starts in the standard server-profile setup flow, where user-saved profiles remain authoritative. `apiUrl` is present only when explicitly configured in retained host configuration (`/etc/dam-hopper/host-config.json`).

---

## 7. Rollback, Crash Recovery, and Boot Ordering

### Automatic Rollback
If candidate units fail to start within 20 seconds, crash during probing, or fail any of the 20 consecutive health checks:
1. Candidate units are stopped and disabled.
2. Previous concrete units and configuration are restored from `/var/lib/dam-hopper-manager/backups/<tx_id>/`.
3. `systemctl daemon-reload` is executed and previous units are restarted.
4. Previous units are verified against the 10-second health gate.
5. On a clean first install with no previous release, application units are stopped and disabled.

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
- Restores backups if a crash occurred during `QUIESCED`, `SWITCHED`, or `PROBING`.
- Repairs `current` and systemd enablement for `COMMITTED` releases.
- Fails closed and blocks application startup if state is corrupted, marking status as `RECOVERY_REQUIRED`.

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

*Any format-1 layout (containing `web.sha256` or `/opt/dam-hopper/web`) or drifted configuration fails closed before any filesystem mutation.*

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

The server-authoritative terminal idle suspend subsystem provides opt-in, fail-closed host suspend with RTC wake after a bounded quiet period with zero active or starting PTY terminals. The enrolled helper also supports the Phase 01 execution-only indefinite-sleep sentinel; automatic persisted timing remains bounded.

### 11.1 Host Qualification Requirements
Before enabling terminal idle suspend on a production host:
1. **Kernel & RTC Hardware**: The host must expose a functional RTC wakealarm device at `/sys/class/rtc/rtc0/wakealarm`.
2. **Systemd & Logind**: The fixed `systemctl suspend` path must reach systemd/logind and support suspend without desktop session inhibitors blocking non-interactive operation.
3. **RTC ownership and inhibitors**: DamHopper must be the approved owner of `rtc0` wakealarm. A non-empty existing alarm is rejected as busy; active system inhibitors (for example system update locks or backup operations) are respected and cause suspend requests to fail closed without retry.

### 11.2 Privileged Helper Enrollment & Hardening
The privileged helper binary `dam-hopper-idle-suspend-helper` executes the fixed suspend request with RTC wakealarm programming over a local Unix domain socket:
- **Socket Unit**: `deploy/systemd/dam-hopper-idle-suspend-helper.socket` creates `/run/dam-hopper/idle-suspend.sock` with `SocketMode=0660`.
- **Service Unit**: `deploy/systemd/dam-hopper-idle-suspend-helper.service` executes the helper under strict systemd hardening:
  - `NoNewPrivileges=yes`
  - `ProtectSystem=strict`
  - `ProtectHome=yes`
  - `PrivateTmp=yes`
  - `CapabilityBoundingSet=CAP_WAKE_ALARM`
- **Peer Credential Verification**: The helper validates peer UID and PID on connection via `SO_PEERCRED`, rejecting unauthorized callers.
- **Audit Trail**: Every request, intent, and completion is recorded to `/var/log/dam-hopper/idle-suspend-helper.jsonl` (mode `0600`).

The server enrolls the helper executor when the configured socket exists
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
3. Stops and disables helper socket and service units.
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
   - Verify `systemctl is-active dam-hopper-idle-suspend-helper.socket` returns `active`.
   - Verify database-backed authentication is functioning; `--no-auth` mode strictly prohibits manual sleep.
   - Verify the server status has no active/in-flight handoff and record the current status revision.

2. **Timed Canary Qualification (Required First)**:
   - Perform during an approved maintenance window with physical or out-of-band recovery.
   - Using the active authenticated profile, make exactly one manual POST with a bounded timer (for example `{ "wakeAfterSeconds": 120, "force": false }` when the fleet is quiescent). Do not retry an ambiguous response.
   - Monitor `/var/log/dam-hopper/idle-suspend-helper.jsonl` for helper intent then completion and the server `idle-suspend-audit.jsonl` for the actor/request outcome.
   - Confirm the machine suspends and automatically resumes within the approved tolerance.
   - Upon resume, refetch status and verify the status revision/`host:idleSuspendChanged` reconciliation, handoff release, and no duplicate suspend request.

3. **Indefinite Sleep Canary Protocol (High Risk)**:
   - **Warning**: Indefinite sleep (`wakeAfterSeconds: 0`) clears the RTC wakealarm (no auto-wake). The machine will NOT wake on a timer.
   - **Mandatory Requirements**:
     - Operations owner approval with assigned physical or out-of-band recovery personnel (for example IPMI/iLO/BMC, Wake-on-LAN, or physical power button).
     - Never execute an indefinite canary on a remote host without verified out-of-band power cycling capability.
     - Submit exactly one POST and never replay it after a network interruption.
   - Confirm post-resume status, audit, handoff, and PTY reconciliation once manually awakened.
