# Linux systemd Deployment and Operator Guide

Authoritative Linux x86_64 guide to roles, activation, rollback, recovery, and format-2 migration; release assets and the v0.5.0/v0.5.1 advisory are in the [Publisher guide](./linux-release-publisher-bootstrap.md).

## 1. Supported Platform and System Requirements

Manifest v2 targets Linux `x86_64-unknown-linux-gnu`; supported hosts need no
checkout, compiler, Node.js, pnpm, Cargo, or Rust toolchain.

| Requirement                | Specification                                         | Verification / Fallback                           |
| -------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| **Operating System**       | Linux (systemd host)                                  | `/etc/os-release`; profile `linux-x86_64-systemd` |
| **Architecture**           | x86_64 (amd64)                                        | Required; `uname -m` == `x86_64`                  |
| **C Library**              | GNU libc >= 2.39                                      | Dynamically linked against system glibc           |
| **Init & Service Manager** | systemd >= 245                                        | Unified cgroup v2; PID 1 system manager           |
| **Security Module**        | SELinux policy as deployed                            | Units use native systemd sandboxing               |
| **Host Utilities**         | `curl`, `tar`, `gzip`, `sha256sum`, `sudo`, `systemd` | Required on path for bootstrap/archive handling   |
| **Attestation Verifier**   | GitHub CLI (`gh`)                                     | Optional; only with `--verify-attestation`        |

---

## 2. Release Artifacts and Trust Chain

Each stable tag publishes four immutable assets:

1. `dam-hopper-install.sh` (non-root bootstrap)
2. `dam-hopper-vX.Y.Z-linux-x86_64-systemd.tar.gz` (v2 Linux archive)
3. `release-manifest.json` (Manifest v2 digests, inventory, and service contracts)
4. `dam-hopper-vX.Y.Z-linux-x86_64-systemd.spdx.json` (SPDX 2.3 SBOM)

The bootstrap downloads as the invoking user, checks manifest-bound SHA-256,
and invokes `sudo` only for manager staging. `--verify-attestation` adds
GitHub attestation checks; checksum verification remains mandatory. Archives
exclude environment files, tokens, passwords, databases, and host-local state.

---

## 3. Host Architecture and Service Roles

DamHopper provides role-scoped API, helper, and web services
coordinated by a root-only recovery unit:

| Unit                                     | Process Binary                   | User / Group                                        | Listener                            | Sandboxing & Capabilities                                                                            |
| ---------------------------------------- | -------------------------------- | --------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `dam-hopper-recovery.service`            | `dam-hopper recover --boot`      | `root:root`                                         | None                                | Oneshot pre-boot gate before application units                                                       |
| `dam-hopper-idle-suspend-helper.service` | `dam-hopper-idle-suspend-helper` | `root:<API group>` (default `root:dam-hopper`) | `/run/dam-hopper/idle-suspend.sock` | `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`, `CAP_WAKE_ALARM` |
| `dam-hopper-api.service`                 | `dam-hopper-server`              | `dam-hopper:dam-hopper` (default rendered identity) | `0.0.0.0:4801`                      | Dedicated PTY/auth/file operations; `NoNewPrivileges=false`                                          |
| `dam-hopper-web.service`                 | `dam-hopper-web`                 | `dam-hopper-web:dam-hopper-web`                     | `0.0.0.0:4802`                      | Read-only static host; `ProtectSystem=strict`, `NoNewPrivileges=true`                                |
> **API identity and command contract:** The checked-in API unit and the
> default release-manager render run `dam-hopper-api.service` as the
> unprivileged `dam-hopper:dam-hopper` account. Custom identities must remain
> non-root; verify `User=`/`Group=` on each host.
> Template source is `ExecStart=@RELEASE_ROOT@/bin/dam-hopper-server --config @API_HOME@/dam-hopper.toml --host 0.0.0.0 --port 4801`; default rendering is:
> `ExecStart=/opt/dam-hopper/current/bin/dam-hopper-server --config /var/lib/dam-hopper/dam-hopper.toml --host 0.0.0.0 --port 4801`.
> The checked-in unit is this concrete production-default rendering and must
> stay synchronized. It has exactly one privileged
> `ExecStartPre=+/opt/dam-hopper/current/bin/dam-hopper-manager provision-api-runtime`
> and exactly one `ExecStart`; strict policy rejects legacy `/etc` paths,
> alternate config operands, duplicates, and extra arguments.

### Agent Store OMP/Codex file access

Agent Store path settings are paths on the server, not on the browser, and do
not grant filesystem permissions or change the API/PTY identity. The default API
unit runs as the unprivileged `dam-hopper:dam-hopper` account. A configured
`~/.omp/agent` or `~/.codex` resolves against the server's effective PTY home;
verify that this is the same home and path used by the target agent process.
`PI_CODING_AGENT_DIR`, `CODEX_HOME`, and per-session PTY environment overrides
can affect runtime paths.

The API can read or update only files allowed by the service account's existing
Unix permissions. Use a deployment where the API and target agent share the
required OS identity, or have an administrator provision narrowly scoped
traverse/read/write access to only the required target directories and config
file. Do not make a user's whole home writable by `dam-hopper`, and do not use
`sudo` or broad ownership changes as an Agent Store workaround. If the service
cannot access the selected target safely, leave notification settings disabled
and provision the required access before attempting config changes. See the
[agent-status architecture](./architecture/agent-status.md#agent-store-path-verification)
for current verification behavior and its limits.

### Deployment Roles

- `server`: Deploys `dam-hopper-idle-suspend-helper.service` and
  `dam-hopper-api.service` (API listens on `0.0.0.0:4801`).
- `web`: Deploys only `dam-hopper-web.service` (listening on `0.0.0.0:4802`).
- `both`: Deploys server and web units in lockstep.

The native release manager manages four unit types: recovery on every role,
helper and API on server roles, and web on web roles. The helper uses the
rendered API group for `/run/dam-hopper/idle-suspend.sock`.
`dam-hopper-runtime.conf` creates `/run/dam-hopper` at mode `3770`, owned by
`root:<API group>`; the API and helper unit prestarts apply this configuration.

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

/var/lib/dam-hopper/              # 0700 final API UID:GID (API runtime state)
├── dam-hopper.toml                # 0600 final API UID:GID (Canonical API registry)
├── idle-suspend-audit.jsonl       # 0600 final API UID:GID (Server timing/manual audit)
└── .config/dam-hopper/            # 0700 final API UID:GID (Diagnostics and token parent)

/etc/dam-hopper/             # 0755 root:root (Installer/host config; API gate reads legacy only)
├── host.toml                # 0644 root:root (Recorded deployment role and allowed web origins)
├── host-config.json         # 0644 root:root (Committed public runtime config)
├── server.env               # 0600 root:root (Optional production env: MONGODB_URI/DATABASE or DAM_HOPPER_LITE_MODE, DAM_HOPPER_MFA_KEY_FILE)
├── mfa-encryption.key       # 0600 API UID:GID (Dedicated 32-byte AES-256-GCM TOTP encryption key)
└── dam-hopper.toml          # 0644 root:root (Optional read-only legacy migration source)
/etc/systemd/system/
├── dam-hopper-recovery.service
├── dam-hopper-idle-suspend-helper.service # Present only if role is 'server' or 'both'
├── dam-hopper-api.service                # Present only if role is 'server' or 'both'
└── dam-hopper-web.service                # Present only if role is 'web' or 'both'
/etc/dam-hopper/tmpfiles.d/dam-hopper-runtime.conf # Shared API/helper runtime directory
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

4. **Configure production environment & MFA key (`server` or `both` roles):**

   In production authenticated mode (`RUST_ENV=production` with either MongoDB or SQLite lite mode configured), `DAM_HOPPER_MFA_KEY_FILE` is mandatory:
   - Must contain exactly 32 raw bytes, 64 hex characters, or 44 Base64 characters.
   - File permissions must be strictly mode `0600`, regular file only (symlinks or group/world bits are rejected).
   - Dedicated to encrypting confirmed and pending TOTP secrets at rest via AES-256-GCM.
   - Must be backed up separately from the database and deployed to all server instances.

   ```bash
   # Generate dedicated 32-byte key (64 hex characters)
   sudo mkdir -p /etc/dam-hopper
   openssl rand -hex 32 | sudo tee /etc/dam-hopper/mfa-encryption.key > /dev/null
   sudo chown <API_USER>:<API_GROUP> /etc/dam-hopper/mfa-encryption.key
   sudo chmod 600 /etc/dam-hopper/mfa-encryption.key
   ```

   ##### Option A: MongoDB Configuration (Default)
   ```bash
   sudo tee /etc/dam-hopper/server.env <<EOF
   MONGODB_URI=mongodb://127.0.0.1:27017
   MONGODB_DATABASE=damHopper
   DAM_HOPPER_MFA_KEY_FILE=/etc/dam-hopper/mfa-encryption.key
   EOF
   sudo chmod 600 /etc/dam-hopper/server.env
   ```

   ##### Option B: SQLite Lite Mode (Alternative, no MongoDB required)
   ```bash
   sudo mkdir -p /var/lib/dam-hopper
   sudo chown <API_USER>:<API_GROUP> /var/lib/dam-hopper
   sudo chmod 700 /var/lib/dam-hopper

   sudo tee /etc/dam-hopper/server.env <<EOF
   DAM_HOPPER_LITE_MODE=true
   DAM_HOPPER_AUTH_SQLITE_PATH=/var/lib/dam-hopper/auth.db
   DAM_HOPPER_MFA_KEY_FILE=/etc/dam-hopper/mfa-encryption.key
   EOF
   sudo chmod 600 /etc/dam-hopper/server.env
   ```

5. **Explicitly activate the release:**
   ```bash
   sudo dam-hopper start
   ```

### 5.2 Release Activation Gate

The `dam-hopper start` command is the sole activation entrypoint. Under `/run/lock/dam-hopper/deploy.lock`:

1. Quiesces existing services and verifies cgroups, listeners (4801/4802), and SQLite file holders are completely released.
2. Backs up active systemd units and configuration to `/var/lib/dam-hopper-manager/backups/<tx_id>/`.
3. Installs concrete units to `/etc/systemd/system/` and runs `systemctl daemon-reload`.
4. For a server role, starts the helper, then API; helper startup failure is
   warning-only and does not block API startup.
5. Starts the selected web unit when the role includes `web`, then enters state `PROBING`.
6. **Health Stability Gate:**
   - API/web units must report active within a **20-second startup deadline**.
   - API/web units must then satisfy **20 consecutive successful probes spaced at 500 ms** (10 seconds of uninterrupted stability).
   - Probes verify: expected MainPID, executable path, process UID/GID, exact listener, and valid JSON response (`status: "ok"`, `schemaVersion: 1`, expected `version` and `role`).
7. On success, API/web units are enabled, helper enablement is best-effort;
   `current` is updated and state advances to `COMMITTED`.

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
3. `systemctl daemon-reload` runs; on a previous server role, the helper starts
   before the API and helper failure is warning-only.
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
- Restores backups, including the helper, if a crash occurred during
  `QUIESCED`, `SWITCHED`, or `PROBING`.
- Repairs `current` and systemd enablement for `COMMITTED` releases;
  helper enablement is best-effort for server roles and disabled for
  non-server roles.
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

### Capturing a production diagnostics bundle

Run the fixed, one-shot collector after an idle-suspend incident:

```bash
dam-hopper diagnose --json
```

`--json` is required; no path, window, source, unit, URL, command, or
verbosity override is accepted. The collector reads fixed local sources,
redacts before serialization, writes one atomic `bundleSchemaVersion: 1` JSON
file, and prints exactly its absolute path plus newline on stdout.

- **Root**: writes under `/var/lib/dam-hopper-manager/diagnostics` (directory
  `0700`, bundle `0600`) and attempts the root-only helper audit.
- **Non-root**: writes under `$XDG_STATE_HOME/dam-hopper/diagnostics`, or
  `$HOME/.local/state/dam-hopper/diagnostics` when `XDG_STATE_HOME` is unset.
  It never escalates; an applicable helper audit is `permissionDenied`, so the
  result is normally partial (exit `2`). There is no `/tmp` fallback.
- **Exit `0`**: safely written bundle with complete applicable historical
  evidence. **Exit `2`**: safely written valid partial bundle. **Exit `1`**:
  serialization or secure-output failure; no path is printed.
- **Sources and privacy**: server events/audit, helper audit, backend
  diagnostics, fixed API/helper systemd and journald metadata, the loopback
  idle-status API, and current host probes. Tokens, credentials, terminal/PTY
  bytes, argv/environment, journal message text, raw helper frames, and
  socket/IP addresses are excluded. Current status/probes are latest or
  non-historical, not incident history.
- **Safety and rollback**: source files are read-only; output uses a same-
  directory exclusive `0600` temporary file, sync, atomic rename, and
  directory sync. Rollback restores prior binaries/assets and retains evidence.

For deterministic gates, run the diagnostics target and cross-layer target from
the source checkout. On an approved Linux host, the explicit read-only smoke is:

```bash
cargo test --manifest-path server/Cargo.toml \
  --test idle_suspend_diagnostics_linux_smoke -- --ignored
```

It uses production read adapters plus temporary output and compares before/after
host/configuration/audit hashes, RTC wakealarm content, and API/helper
`ActiveState`, `SubState`, and `MainPID`; it must not trigger suspend.

See [Linux Release Manager — Production diagnostics](./linux-release-manager.md#production-diagnostics)
for fixed source paths and adapter details.

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
idle-suspend helper reset/rollback tool documented in the [idle-suspend runbook](./linux-systemd/idle-suspend-runbook.md); it is not
a general release manager.

---

## 11. Terminal Idle Suspend Runbook

Enrollment, helper security, host qualification, canaries, and rollback are covered in the [dedicated operator runbook](./linux-systemd/idle-suspend-runbook.md).

## 12. Operator Runbook: Native Advisor Migration & Plugin Platform Retirement

With Native Advisor integrated directly into Dam-Hopper, the plugin runner service, worker Node, and plugin platform are retired.

### Sequence of Operations

#### Step 1: Deploy Native Release and Migrate Manager State

Download the native release bundle directory containing `release-manifest.json` and its archive. The release manager automatically migrates committed manager-state v1/v2 to schema3 under deployment lock, backing up the prior state to `/var/lib/dam-hopper-manager/state.v2.bak`:

```bash
# Stage native release
sudo dam-hopper install --bundle /path/to/release-bundle-directory --role both

# Activate native services (API, helper, web, recovery)
sudo dam-hopper start
```

#### Step 2: Verify Native Advisor and Core Runtime

Verify that the API server and Native Advisor endpoint respond:
Use the session token returned by normal MFA sign-in; `server-token` is the
server signing secret, not a bearer credential. See the
[Authentication API](./api/authentication.md).

```bash
# Health probe
curl -s http://127.0.0.1:4801/api/health

# Prompt for a session token returned after normal MFA sign-in
read -rsp 'MFA-issued session token: ' SESSION_TOKEN
printf '\n'
curl -s -H "Authorization: Bearer ${SESSION_TOKEN}" \
  http://127.0.0.1:4801/api/advisor/status
unset SESSION_TOKEN
```

#### Step 3: Inspect Retired Plugin Platform (Dry-Run)

Run the safe removal script in default read-only dry-run mode to inspect what will be stopped, disabled, and removed:

```bash
# Inspect system-level plugin platform components
bash deploy/remove-plugin-platform.sh --scope system
```

For each installed API and helper unit, the script refuses to proceed while the unit references the retired plugin tmpfiles configuration or group.

#### Step 4: Apply Safe Removal

Once verified, apply the removal under root privileges:

```bash
# Apply removal of plugin runner unit, socket, and registry
sudo bash deploy/remove-plugin-platform.sh --scope system --apply

# Optional: If no other system consumers require the dedicated account:
sudo bash deploy/remove-plugin-platform.sh --scope system --apply --purge-account
```

#### Step 5: Verify Absence and Preservation Invariants

Verify that the runner unit is inactive and no unit file remains listed. If Advisor history existed before cleanup, confirm its existing server- and user-owned data remains:

```bash
# Check both the service state and systemd's registered unit files.
systemctl is-active dam-hopper-plugin-runner.service || true
systemctl list-unit-files dam-hopper-plugin-runner.service

# Existing Advisor history is outside the removal allowlist.
for history in /var/lib/dam-hopper/.evcrate/advisor-history "$HOME/.evcrate/advisor-history"; do
  if [[ -d "$history" ]]; then
    ls -la "$history"
  else
    printf 'No history directory at %s\n' "$history"
  fi
done

# The runtime directory remains; the socket exists only while the helper is active.
ls -ld /run/dam-hopper
if systemctl is-active --quiet dam-hopper-idle-suspend-helper.service; then
  test -S /run/dam-hopper/idle-suspend.sock
fi
```

