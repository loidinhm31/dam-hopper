# Documentation Reader Report: Configuration Guide, Linux Release Manager & Release Manifest

**Date:** 2026-10-05  
**Target Documents:**
1. `docs/configuration-guide.md`
2. `docs/linux-release-manager.md`
3. `docs/linux-release-manifest.md`

---

## 1. Document Purposes

### 1.1 `docs/configuration-guide.md`
- **Purpose:** Primary operational and developer configuration manual for DamHopper across project registries (`dam-hopper.toml`), global UI configuration (`config.toml`), file sandboxing, terminal environment resolution, read-only host resource monitoring, opt-in Linux terminal idle suspend, browser extension bridge, and Cognito Privacy Mode.
- **Coverage:** Outlines configuration file discovery and priority, project schema validation, filesystem boundary isolation (`/api/fs/*`), terminal process environments, server-level monitoring and power management, extension bridge communication, and appearance/keyboard customization.
- **Scope:** Defines boundaries between user configuration, server-authoritative defaults, immutable boot parameters, and systemd production overrides.

### 1.2 `docs/linux-release-manager.md`
- **Purpose:** Authoritative technical specification and operations manual for the DamHopper Linux release manager CLI (`dam-hopper` / `bin/dam-hopper-manager`).
- **Coverage:** Governs unprivileged asset acquisition (`fetch`), root-only transactional staging (`install`, `role set`), durable activation with continuous health gating (`start`), crash recovery (`recover`), rollback (`rollback`), and one-shot diagnostic bundle generation (`diagnose`).
- **Scope:** Manages host systemd service topology (`dam-hopper-api`, `dam-hopper-idle-suspend-helper`, `dam-hopper-web`, `dam-hopper-recovery`) on `x86_64-unknown-linux-gnu` platforms running systemd >= 245 and glibc >= 2.39; documents atomic legacy format-2 migration.

### 1.3 `docs/linux-release-manifest.md`
- **Purpose:** Canonical schema and validation contract for the Linux Release Manifest v2 (`release-manifest.json`).
- **Coverage:** Defines release metadata, SemVer tag identity, target profile bounds, archive integrity digests, inventory file/directory entries and role projections (`common`, `server`, `web`, `both`), systemd service contracts, rollback compatibility declarations, and dedicated web runtime static routes.
- **Scope:** Acts as the shared contract between the release publisher (`generate-release-manifest.mjs`, `release-manifest.schema.json`) and the runtime manager (`server/src/linux_release/`). Clarifies that Windows distribution assets remain strictly outside this manifest contract.

---

## 2. Key Sections and Architectural Concepts Described

### 2.1 Configuration Architecture (`docs/configuration-guide.md`)

- **Project Registry (`dam-hopper.toml`) & Path Normalization:**
  - Authoritative config loaded via `--config <path>`, `DAM_HOPPER_CONFIG`, or canonical `~/.config/dam-hopper/dam-hopper.toml`.
  - Normalization uses platform-safe `dunce` canonicalization for `configPath`. Project paths resolve lexically against config parent directory with redundant `.` removed and no symlink resolution.
  - Windows absolute paths support drive-letter, UNC (`\\server\share`), and extended verbatim (`\\?\C:\...`) formats. Path containment collapses `\\?\` aliases and matches case-insensitively on Windows, while preserving POSIX byte identity.
- **File Access Boundaries & Sandboxing:**
  - File operations (`/api/fs/*` and WebSocket file streaming) sandboxed strictly per project root derived from `projects[].path`.
  - `workspace_dir` deprecated as a security boundary; retained as a legacy/display field only.
  - Traversal sequences (`..`) rejected before disk access; symlink targets re-canonicalized against project root boundary. Dynamic reload or workspace switch instantly reinitializes sandbox roots.
- **Startup Resolution Priority (6 Tiers):**
  1. `--config <path>` or `DAM_HOPPER_CONFIG` (exact file).
  2. `--workspace <dir>` or `DAM_HOPPER_WORKSPACE` (directory upward search).
  3. Canonical global registry: `~/.config/dam-hopper/dam-hopper.toml`.
  4. Global defaults: `defaults.workspace` from `~/.config/dam-hopper/config.toml`.
  5. CWD upward discovery of `dam-hopper.toml`.
  6. Empty fallback.
- **Workspace Switching & Config Reload:**
  - `POST /api/workspace/switch` accepts direct TOML path or directory. Reinitializes sandboxes, terminates active PTY sessions, and broadcasts `workspace:changed`.
  - Same-directory atomic TOML writer applies mutations (`PUT /api/config`, `PATCH /api/config/projects/:name`, `POST /api/settings`).
- **Terminal Environment Resolution:**
  - Precedence: (1) Safe inherited host baseline (`PATH`, `HOME`) -> (2) Default `TERM` -> (3) Project `.env` -> (4) Request overrides. Server host process environment never leaked to child PTYs.
- **Read-Only Host Resource Monitoring (`[server.host_resources]`):**
  - Opt-out defaults: 5s light sampling, 15s bounded process list, 60s PSS. Deadlines: 150ms process inspection, 500ms snapshot generation.
  - Reads `/proc`, PSI, cgroup v2, and disk mount table (selecting longest matching mount path). Fallback to `GET /api/system/metrics`.
- **Opt-in Linux Terminal Idle Suspend (`[server.idle_suspend]`):**
  - Policies: `empty-fleet` (default) vs `agent-activity` (watches PTY/process/TCP evidence on 2s cadence with 1s monotonic deadline).
  - Executable matchers (`agent_executables`): 1–32 unique entries, 1–256 UTF-8 bytes, ASCII restricted, rejects shell wrappers, wildcards, and bare script interpreters (`node`, `python`, `bash`).
  - Startup policy immutability: Captured in `StartupIdleSuspendPolicy` at boot; cannot be mutated via runtime API or workspace switch without daemon restart.
  - Timing tuning: Authenticated `PATCH /api/system/idle-suspend/v1/timing` (`quiet_period_seconds` and `wake_after_seconds` in `60..=86400`).
  - Manual force sleep: `POST /api/system/idle-suspend/v1/force-suspend`. Execution accepts `wakeAfterSeconds: 0` as numeric sentinel for indefinite sleep (RTC clear-only mode). Nonzero execution requires `60..=86400`. Nonzero active fleet requires explicit `{ "force": true }`.
  - Phased rollout stages (Stage 0: Dark -> Stage 1: Soak -> Stage 2: Target-Host Gate -> Stage 3: Canary -> Stage 4: Expansion). Emergency rollback and disenrollment runbooks.
- **Browser Debug Extension Bridge:**
  - Bundled extension ZIP (`/browser-debug-extension/dam-hopper-browser-debug.zip`).
  - Security boundary: Requires exact parent origins configured via `VITE_DAM_HOPPER_EXTENSION_PARENT_ORIGINS` before build; loopback defaults cover ports 5173 and 4800.
  - Artifact bounds: 64 KiB JSON DOM metadata, 4 MiB PNG screenshots; short 10-minute expiry; zero server token exposure to extension.
- **Global UI Preferences (`~/.config/dam-hopper/config.toml`):**
  - Panel shortcuts, inline terminal suggestions fail-closed kill switch, auto project switching on terminal selection, terminal agent notification policies v2 (`codex`, `omp`, `claude`), Agent Settings paths, pinned mount point.
  - Cognito Privacy Mode: Global shortcut `Mod+Alt+KeyB`, style `heavy-blur` vs `black-screen`. Ephemeral activation with nonpassive window capture event swallowing.

---

### 2.2 Linux Release Manager Lifecycle (`docs/linux-release-manager.md`)

- **Prerequisites and Privilege Boundary:**
  - Target: Linux `x86_64-unknown-linux-gnu`, glibc >= 2.39, systemd >= 245 running as PID 1.
  - Privilege separation: `fetch` strictly non-root; `install`, `role set`, `start`, `rollback`, `recover` run as root (EUID 0); `status` and `version` run under any EUID.
  - Runtime identity: API unit `User=`/`Group=` is sole runtime identity authority; root identity rejected; primary group enforced.
- **API Runtime State Reconciliation (`provision-api-runtime`):**
  - Privileged pre-start command: `ExecStartPre=+<release-root>/bin/dam-hopper-manager provision-api-runtime`.
  - Validates and enforces exact metadata:
    - `/var/lib/dam-hopper` (mode `0700`, API UID/GID).
    - `/var/lib/dam-hopper/dam-hopper.toml` (mode `0600`, regular file, API UID/GID).
    - `/var/lib/dam-hopper/idle-suspend-audit.jsonl` (mode `0600`, regular file, API UID/GID).
    - `/etc/dam-hopper/dam-hopper.toml` (mode `0644`, root:root, read-only migration source; copied byte-for-byte on first boot if canonical missing; never mutated).
  - Explicit single `ExecStart` command enforcement in rendered unit.
- **Phase 03 Preflight SQLite Migration Protection:**
  - Read-only inspection of candidate databases before quiesce or switch. Resolves `server.session_db_path` from canonical `/var/lib/dam-hopper/dam-hopper.toml` and extant `/etc/dam-hopper/dam-hopper.toml`.
  - Checks database and `-wal`/`-shm` sidecars for foreign process holders; halts release switch if foreign processes hold locks.
- **Managed Service Topology:**
  - Active units: `dam-hopper-api.service` (port 4801), `dam-hopper-web.service` (port 4802), `dam-hopper-idle-suspend-helper.service` (`/run/dam-hopper/idle-suspend.sock`), `dam-hopper-recovery.service` (boot gate).
  - Complete retirement of plugin runner (`dam-hopper-plugin-runner.service`), socket, and runner tmpfiles.
- **Durable Activation State Machine & Health Gate:**
  - States: `ABSENT | ACTIVE -> STAGED -> PENDING -> QUIESCED -> SWITCHED -> PROBING -> COMMITTED`.
  - Serialization: `/run/lock/dam-hopper/deploy.lock`.
  - Authoritative envelope: `/var/lib/dam-hopper-manager/state.json` (mode `0600`, generation counter).
  - Health Gate: 20 seconds startup deadline + 20 consecutive successful probes spaced at 500 ms (10 seconds continuous stability). Verifies `MainPID`, identity, listener port, JSON schema 1, status `ok`, and version. Automatic rollback on probe failure.
- **Boot Recovery & Manual Rollback:**
  - Recovery unit `dam-hopper-recovery.service` runs `dam-hopper-manager recover --boot` before app units. Classifies interrupted states and restores transaction backups or marks `RECOVERY_REQUIRED`.
  - Manual `sudo dam-hopper rollback` activates previous known-good release through transaction backup restoration.
- **Production Diagnostics Collector (`dam-hopper diagnose --json`):**
  - Single-shot collector emitting atomic file `dam-hopper-diagnose-<ms>-<uuid>.json` (`bundleSchemaVersion: 1`, mode `0600`).
  - Output path: `/var/lib/dam-hopper-manager/diagnostics` (root) or `$XDG_STATE_HOME/dam-hopper/diagnostics` (non-root).
  - Redacts credentials, tokens, terminal data, argv, and addresses.
- **Legacy Format-2 Migration:**
  - Sibling directory staging `/opt/.dam-hopper-migration.<tx_id>`.
  - Atomic filesystem directory swap via Linux `renameat2(RENAME_EXCHANGE)`. Zero cross-device copy fallback.

---

### 2.3 Linux Release Manifest v2 (`docs/linux-release-manifest.md`)

- **Publisher and Bootstrap Boundary:**
  - Emits 4 external attested assets: `dam-hopper-install.sh`, `release-manifest.json`, profile tar.gz archive, SPDX 2.3 SBOM.
  - Git tag `vX.Y.Z` is release authority. Component versions (`cli`, `api`, `webHost`, `webAssets`) must match in lockstep.
  - Windows release assets (`.zip`, `.ps1`) strictly segregated from Manifest v2; Windows installer verifies digests via GitHub Release API metadata.
- **Manifest v2 Structure:**
  - Root fields: `schemaVersion` (2), `release` (`tag`, `version`, `commitSha`), `profile` (`linux-x86_64-systemd`, glibcMin: 2.39, systemdMin: 245), `archive` (`name`, `size`, `sha256`), `components`, `inventory`, `services`, `rollback`. Reject unknown fields.
- **Inventory Specification & Role Projections:**
  - Maximum 20,000 entries. Normalized relative UTF-8 paths <= 255 bytes.
  - Entry kinds: `file` (requires positive `size` and lowercase 64-hex `sha256`) and `dir`.
  - Octal file mode represented as JSON integer (e.g. `493` for `0755`).
  - Roles: `common`, `server`, `web`. Target projection rules: `server` (common + server), `web` (common + web), `both` (all inventory entries).
- **Service Contracts:**
  - `services.api`: `unitName: "dam-hopper-api.service"`, `bindHost: "0.0.0.0"`, `port: 4801`, `healthPath: "/api/health"`. Identity field removed; systemd unit is runtime authority.
  - `services.web`: `unitName: "dam-hopper-web.service"`, `identity: "dam-hopper-web"`, `bindHost: "0.0.0.0"`, `port: 4802`, `healthPath: "/__dam-hopper/health"`.
  - `rollback`: `{ "previousReleaseCompatible": true, "stateCompatibility": "n-1" }`.
- **Web Runtime Contract:**
  - Static file server (`bin/dam-hopper-web`) bound to `0.0.0.0:4802`.
  - Static GET/HEAD serving with caching hierarchy (no-cache for index.html, 1-year immutable for hashed assets).
  - Dynamic endpoints: `GET /__dam-hopper/health` and `GET /__dam-hopper/runtime-config.json` (max 4 KiB, machine-local, `no-store`).
- **Manager Manifest Consumption:**
  - Strict v2 manifest validation for downloaded external candidates.
  - Backward-compatible dual-reading of Manifest v1 (`schemaVersion: 1`, legacy API `identity: "root"`) exclusively for existing installed release rollback trees referenced in `state.json`.

---

## 3. Areas Needing Update or Synchronization with Latest Codebase Changes

### 3.1 Discrepancies in `docs/linux-release-manager.md`

1. **Manager State Schema Version Contradiction:**
   - *Doc Heading & Intro (lines 1, 3):* Stated as `(Manifest v2; manager state v3)` and "manager state schema v3 is current and migrates installed schema v1/v2 records".
   - *Doc Section "Status and version" (line 437):* States "`version` reports the Cargo package version, the `linux-x86_64-systemd` profile, and release manifest schema `2`; persisted manager state remains schema `1`."
   - *Code Reality (`server/src/linux_release/constants.rs:9` & `state.rs:46, 202-220`):* `MANAGER_STATE_SCHEMA_VERSION = 3`. Persisted state is explicitly written as schema 3. State loader migrates legacy v1 (`MANAGER_STATE_SCHEMA_VERSION_LEGACY = 1`) and legacy v2 (`MANAGER_STATE_SCHEMA_VERSION_LEGACY_V2 = 2`) to v3. Line 437 is stale and contradicts the rest of the document and the code.
2. **Residual Retired Plugin Runner References in Staging & Layout:**
   - *Doc Section "Role-aware unit staging" (line 526):* States: "Every role receives recovery; a `server` role also stages API, helper, runner, and `dam-hopper-plugin-runner.conf` assets. `render_helper_unit` and `render_runner_unit` substitute allowlisted release, identity, registry, Node, and socket tokens, parse the units, and enforce their policies."
   - *Doc Section "Filesystem layout" table (lines 468–470):* Still lists:
     - `/etc/dam-hopper/tmpfiles.d/dam-hopper-plugin-runner.conf` ("Rendered runner runtime directories")
     - `/var/lib/dam-hopper-plugin-runner/` ("Runner-owned durable registry/state")
     - `/etc/dam-hopper/host.toml` ("Role, API user, plugin owner/admin inputs")
   - *Code Reality (`server/src/linux_release/stage_units.rs:219–270` & `host_config.rs:65–75`):*
     - The plugin runner was retired in Phase 06/07. Staging stages `dam-hopper-api.service`, `dam-hopper-idle-suspend-helper.service`, and `tmpfiles.d/dam-hopper-runtime.conf`. `render_runner_unit` and runner staging logic do not exist.
     - `HostConfig` in `host_config.rs` has `#[serde(deny_unknown_fields)]` and supports only `role`, `allowed_web_origins`, and `service_user`. All plugin owner/admin fields are retired and rejected.
     - The filesystem layout table must remove the runner paths and replace `dam-hopper-plugin-runner.conf` with `dam-hopper-runtime.conf`.
3. **Deployment Journeys Count:**
   - *Doc Section "Verification" (line 368):* States: "the package's `pnpm test:deploy` command invokes seven deployment journeys, including clean install, security, and reset smoke."
   - *Code Reality (`package.json:39`):* `pnpm test:deploy` runs **eight** journeys, including the added `tests/deploy/linux-release-remove-plugin-platform.sh`.

---

### 3.2 Discrepancies in `docs/linux-release-manifest.md`

1. **Inconsistent Header Status Regarding Manager State Schema:**
   - *Doc Status Line (line 3):* States: "Status: Manifest v2 and manager-state v2 are the current release contracts."
   - *Doc Section "Manager consumption" (lines 268, 275):* States: "Manifest v2; manager state v3 ... Manager state is schema v3; installed schema v1/v2 records are migrated".
   - *Code Reality:* Manager state is schema 3 (`MANAGER_STATE_SCHEMA_VERSION = 3`). Line 3 must be updated from `manager-state v2` to `manager-state v3`.
2. **Missing Required Inventory Entries in Specification Table:**
   - *Doc Table "Required paths and activation assets" (lines 135–144):* Lists 10 paths, omitting:
     - `bin/dam-hopper-idle-suspend-helper` (kind: `file`, role: `server`, executable) — required by Rust validator in `server/src/linux_release/inventory_validation.rs:222` for `schema_version >= 2`.
     - `tmpfiles.d/dam-hopper-runtime.conf` (kind: `file`, role: `server`) — required by release asset verification in `deploy/release/check-release-assets.mjs:67` (`REQUIRED_INVENTORY_PATHS`).
   - Both files are packaged and verified by release gates, but missing from the specification table.
3. **Outdated Statement Regarding `services.runner` Generation:**
   - *Doc Section "Service and rollback contracts" (line 164):* Claims: "The release generator emits `services.runner` for every published Linux archive; runtime manifest fields remain optional for local fixtures only."
   - *Code Reality (`deploy/release/generate-release-manifest.mjs:297–312` & `release-manifest.schema.json:57`):* The generator emits only `api` and `web` in `services`. `runner` is NOT emitted. In the JSON schema, `runner` is optional and deprecated.
4. **License vs Notices Requirement:**
   - *Doc Table (line 144):* States `LICENSE or NOTICES | file | common | at least one is required`.
   - *Code Reality (`deploy/release/check-release-assets.mjs`):* Following runner retirement, Linux release verification only packages `LICENSE`; `NOTICES` is no longer generated or required.

---

### 3.3 Discrepancies in `docs/configuration-guide.md`

1. **Incomplete Project Configuration Fields Table:**
   - *Doc Table (lines 104–112):* Lists only 7 basic fields: `name`, `path`, `type`, `build_command`, `run_command`, `env_file`, `tags`.
   - *Code Reality (`server/src/config/schema.rs:193–208`):* `ProjectConfig` supports multiple operational features:
     - `services`: Sub-services array (`ServiceConfig` with `name`, `build_command`, `run_command`).
     - `commands`: Named custom script commands map (`HashMap<String, String>`).
     - `terminals`: Custom project terminal profiles array (`TerminalProfile` with `name`, `command`, `cwd`).
     - `agents`: Project agent assignments (`ProjectAgents` with `skills`, `commands`, `hooks`, `mcp_servers`, `subagents`, `distribution`, `memory_template`).
     - `restart_policy`: Process restart behavior (`never`, `on-failure`, `always`).
     - `restart_max_retries`: Maximum retries threshold (u32, default `5`).
     - `health_check_url`: Optional HTTP health probe URL string.
2. **Omitted Top-Level `[server]` Subsections:**
   - *Doc Scope:* Documents only `[server.host_resources]` and `[server.idle_suspend]`.
   - *Code Reality (`server/src/config/schema.rs:638–665`):* `ServerConfig` includes:
     - `[server.advisor]`: `enabled = false` (default-off toggle for native Advisor subsystem).
     - `[server.telemetry]`: OTLP capture settings (`enabled`, `disabled_at`, `capture`, `collectors`).
     - Workflow event retention thresholds: `workflow_event_retention_days` (default 90), `workflow_deleted_note_retention_days` (default 7), `workflow_stale_after_hours` (default 24).
     - Database persistence paths: `session_db_path` (default `~/.config/dam-hopper/sessions.db`), `session_buffer_ttl_hours` (default 24).
3. **Incomplete UI Configuration Settings Table:**
   - *Doc Table (lines 620–637):* Documents 12 UI fields.
   - *Code Reality (`server/src/config/schema.rs:1071–1230`):* Missing fields from `UiConfig`:
     - `terminal_commit_status_enabled` (bool, default `false`).
     - `terminal_scroll_step` (u16, default `3`).
     - Virtual mobile keyboard: `mobile_custom_keyboard_enabled` (bool, default `true`), `mobile_custom_keyboard_font_size` (u16, default `13`), `mobile_custom_keyboard_padding` (u16, default `6`), `mobile_custom_keyboard_row_gap` (u16, default `4`).
     - File explorer: `explorer_show_hidden` (bool, default `false`), `explorer_language_filter`.
     - Typography & zooming: `system_font_size` (14), `editor_font_size` (14), `terminal_font_size` (14), `editor_zoom_wheel_enabled` (bool, default `true`).
     - Navigation shortcuts: `search_text_shortcut`, `search_filename_shortcut`, `terminal_file_panel_shortcut`, `reveal_active_file_shortcut`, `terminal_font_size_increase_shortcut`, `terminal_font_size_decrease_shortcut`.
     - Ordered collections: `terminal_order`, `project_order`, `project_command_order`, `runtime_group_order`, `runtime_item_order`.
4. **Outdated Version Numbers in Examples:**
   - Several examples across the document reference `v0.2.0`, while the current repository release baseline is `v0.10.2`.
5. **Multi-Profile Workbench Context:**
   - Recent releases introduced concurrent multi-profile workbench operation with tuple-keyed target identities (`packages/ui/src/api/scope.ts`). The configuration guide should clarify that `dam-hopper.toml` configures an individual server instance, while UI preferences in `~/.config/dam-hopper/config.toml` govern client presentation across connected profiles.

---

## 4. Unresolved Questions

1. Should `docs/linux-release-manifest.md` completely excise legacy schema v1 and plugin-runner runner definitions from its documentation, or must it retain migration notes for existing v0.2.0 installations undergoing rollback?
2. Is there an active deprecation schedule for the legacy downward-compatible octal string permissions (`"0o755"`) in `ReleaseManifest` inventory decoding, or will the Rust parser maintain this compatibility indefinitely alongside integer values?
3. Should the missing `ProjectConfig` fields (`services`, `commands`, `terminals`, `agents`, `restart_policy`) be consolidated directly into `docs/configuration-guide.md`, or should a dedicated project schema specification document be authored?
