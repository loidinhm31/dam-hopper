# Configuration Guide

## Project Registry (dam-hopper.toml)

DamHopper loads project registry data from `dam-hopper.toml`. You can point the server at a specific registry file with `--config <path>` or `DAM_HOPPER_CONFIG`, or let it use the canonical global registry at `~/.config/dam-hopper/dam-hopper.toml`.

Legacy workspace-root discovery still works when you pass `--workspace <dir>` or `DAM_HOPPER_WORKSPACE`, but it is no longer the primary model.

### Basic Setup

For end-to-end validation steps after setup, jump to the [Manual Smoke Checklist](#manual-smoke-checklist).

```toml
[workspace]
name = "my-workspace"
```

### Project Discovery

Define projects with type-specific defaults. `projects[].path` may be
absolute or relative. The existing registry file path is normalized with the
platform-safe `dunce` canonicalizer to establish `configPath` and its
directory; project path values themselves resolve lexically against that
directory, with redundant `.` components removed and no symlink resolution.
`env_file` and terminal-profile `cwd` remain project-relative and reject
absolute, rooted/prefix, or `..` traversal paths.

**Path serialization:** When DamHopper writes registry TOML, project paths
inside the config directory are written as relative paths for portability;
relative output always uses forward slashes. Terminal profile `cwd` values are
serialized relative to their project with forward slashes. Projects outside
the registry directory remain absolute, preserving the platform path value.

**Windows paths:** Drive-letter, mixed-separator, UNC, and `\\?\` verbatim
absolute project paths are accepted and covered by Windows-gated tests.
Verbatim values are preserved by config read/write; UNC availability still
depends on the target machine and share.

The same platform-aware path identity is used for registered Git worktree
targets. On Windows it normalizes separators, strips extended drive/UNC
prefixes, and compares case-insensitively; POSIX identity keeps case and

### Path validation and Windows target identity

Configuration validation is lexical and deterministic. The parser rejects
`..` in a project path and rejects absolute/rooted/prefix paths in project
`env_file` and terminal `cwd`; it does not inspect the filesystem to decide
whether a path is safe. A relative project path is joined to the registry
directory after validation. The TOML writer emits portable forward-slash
relative paths and leaves external absolute paths absolute.

Explicit `worktreePath` values must be absolute and must match a fresh Git
worktree listing for the configured project. The resolver canonicalizes live
targets and verifies directory containment, but keeps a normalized lexical
identity for removed targets. Windows identity is case-insensitive and
collapses `\\?\` drive/UNC aliases; POSIX identity does not reinterpret
backslashes as separators. Containment and relative projection use this same
identity, preventing case/prefix aliases from bypassing target ownership.

The resolver's discovery cache is a listing optimization only; it never
authorizes a target. Missing, prunable, symlink-replaced, or foreign
worktrees fail closed rather than redirecting to the configured project root.

```toml
[[projects]]
name = "api"
path = "./services/api"
type = "cargo"
build_command = "cargo build --release"
run_command = "./target/release/server"
env_file = ".env"
tags = ["backend", "critical"]

[[projects]]
name = "web"
path = "./apps/web"
type = "pnpm"
build_command = "pnpm build"
run_command = "pnpm dev"
tags = ["frontend"]

[[projects]]
name = "native"
path = "./apps/native"
type = "pnpm"
build_command = "pnpm tauri:build"
run_command = "pnpm tauri:dev"
tags = ["frontend", "native", "tauri"]

[[projects]]
name = "scripts"
path = "./scripts"
type = "custom"
build_command = "bash scripts/build.sh"
run_command = "bash scripts/run.sh"
```

### Project Fields

| Field         | Type   | Required | Notes                                             |
| ------------- | ------ | -------- | ------------------------------------------------- |
| name          | string | ✓        | Unique within registry                            |
| path          | string | ✓        | Absolute path or relative to config file dir      |
| type          | enum   | ✓        | npm \| pnpm \| cargo \| maven \| gradle \| custom |
| build_command | string |          | Overrides preset for type                         |
| run_command   | string |          | Overrides preset for type                         |
| env_file      | string |          | Relative path to .env (project-local only)        |
| tags          | array  |          | Arbitrary tags for filtering                      |

## File Access Boundaries

Runtime file access via `/api/fs/*` and WebSocket file operations is **sandboxed per project root**. The server maintains a set of allowed roots derived from the currently loaded `projects[].path` entries. All file paths are validated against these configured roots. This prevents traversal attempts from escaping a project's directory tree and blocks access to other projects' files.

**Phase 04 note:** `workspace_dir` is now a display/legacy field only; the security boundary is enforced by per-project roots derived from the config. This allows projects to be located anywhere on the filesystem while maintaining strict access control.

- Symlink targets are canonicalized and re-validated against the project boundary
- Tree subscriptions (watchers) are rooted at each project root
- Relative path sequences containing `..` are rejected before filesystem access
- After config reload or workspace switch, the sandbox roots are automatically reinitialized

## Startup Config Resolution

Server startup resolves configuration in this order:

1. `--config <path>` or `DAM_HOPPER_CONFIG` — load exact registry file
2. `--workspace <dir>` or `DAM_HOPPER_WORKSPACE` — load from directory or search upward
3. `~/.config/dam-hopper/dam-hopper.toml` — global registry
4. `defaults.workspace` from `~/.config/dam-hopper/config.toml`
5. Current working directory via legacy upward `dam-hopper.toml` discovery
6. Empty config fallback

**Phase 04 note:** Workspace APIs now report `configPath` (the authoritative registry file path) separately from `path`/`root` (legacy display fields).

## Workspace Switching and Config Reload

**POST /api/workspace/switch**

The workspace switch endpoint accepts either a directory path or a direct path to a `dam-hopper.toml` file:

```json
{ "path": "/home/user/projects/my-workspace" }
```

or

```json
{ "path": "/home/user/.config/dam-hopper/dam-hopper.toml" }
```

When switching:

- The server reloads configuration from the specified path (or discovers `dam-hopper.toml` in the directory)
- File API sandbox is reinitialized from the newly loaded project roots
- All PTY sessions are disposed
- All connected clients receive a `workspace:changed` broadcast event

**Config updates and settings changes** (`PUT /api/config`, `PATCH /api/config/projects/:name`, `POST /api/settings`) also trigger sandbox reinitialization after writing the new configuration. The reload always reads from the current `configPath` without re-discovery.

### Project Type Presets

#### npm

- Build: `npm run build`
- Run: `npm start`
- Dev: `npm run dev`

#### pnpm

- Build: `pnpm build`
- Run: `pnpm start`
- Dev: `pnpm dev`

#### cargo

- Build: `cargo build --release`
- Run: `cargo run --release`
- Dev: `cargo run`

#### maven

- Build: `mvn clean package`
- Run: `java -jar target/*.jar`
- Dev: `mvn spring-boot:run` (if Spring Boot)

#### gradle

- Build: `gradle build`
- Run: `gradle run`
- Dev: `gradle bootRun` (if Spring Boot)

#### custom

- Requires explicit build_command and run_command

### Terminal Environment Resolution

Project environment-file values are applied only when DamHopper creates a terminal session for that project. DamHopper does not pass its full server process environment through to PTY children.

Terminal env precedence is:

1. Safe baseline inherited from the host for basic shell execution, such as `PATH` and `HOME`
2. DamHopper default `TERM`
3. Project environment-file values
4. Explicit terminal request `env` overrides

If a project-level environment file sets `MONGODB_DATABASE=gleanOak` and the terminal create request includes `env.MONGODB_DATABASE=overrideDb`, the terminal child process sees `overrideDb`.

### Agent Store Configuration

Optional: configure where the agent store directory is located.

```toml
[agent_store]
path = ".dam-hopper/agent-store"
```

If omitted, defaults to `.dam-hopper/agent-store/` relative to the loaded registry file directory.

Import scans canonicalize the selected source directory, reject literal `..`
components and symlink escapes, and never overwrite an existing store item.
Distribution checks canonical symlink targets when available and falls back to
lexical comparison for broken links. On Windows, directory and file links use
the corresponding platform-specific symlink API.

### Feature Flags

All features are enabled by default.

## Host Resource Monitoring (Read-only)

The server-owned monitor is enabled with safe defaults and does not require a
new credential, helper, service, capability, or elevated host privilege. Its
optional TOML settings belong under `[server.host_resources]`; use snake_case
keys only. The default intervals are 5 seconds for light data, 15 seconds for
the bounded process inventory, and 60 seconds for PSS. Deep collection has a
150 ms process deadline and a 500 ms snapshot deadline; values are clamped to
safe ranges by the server.

```toml
[server.host_resources]
light_sample_seconds = 5
process_sample_seconds = 15
process_deadline_millis = 150
snapshot_deadline_millis = 500

```

The monitor reads bounded `/proc`, PSI, cgroup v2, and mount evidence when the
platform permits it. Containers can expose a namespace-limited view; cgroup v1
and non-Linux deep collection are explicitly unsupported. Missing, denied,
malformed, stale, or timed-out sources degrade only the affected deep section.
`GET /api/system/metrics` remains available as the compatible basic-metrics
fallback. Host diagnostics expose bounded process names and summaries only;
they do not expose raw argv or environment values.

`HostMetricsSampler` selects the longest matching disk mount on every supported
platform. On Windows it canonicalizes the workspace and supports drive-root
mount paths; when no mount matches, the reported disk falls back to the
workspace path with zero capacity rather than guessing a host mount.

Do not add re-authentication, action, helper, IPC, enrollment, or host-mutation
settings to this release. Those remain deferred backlog, not configuration.

The Phase 07 release evidence covers the packaged server in no-tunnel mode. Its
measured graceful-shutdown budget applies only when no tunnel sessions are
active; tunnel child-process disposal retains its separate three-second grace
period. The release owner approved Phase 07 completion with the still-unobserved
Windows CI result, canary-host profiling, staged monitor/in-app-alert canary, and
rollback rehearsal deferred as post-release work; none is passed evidence.

## Terminal Idle Suspend (Opt-in Linux Suspend)

The server-authoritative terminal idle suspend feature has two automatic
policies. `empty-fleet` requests suspend only after all managed PTYs are no
longer live, creating, or restart-pending. `agent-activity` observes configured
agent PTY/process/TCP evidence and may suspend while service-only terminals
remain open; it is an activity heuristic, not proof that an agent has
finished. Both policies use RTC wake after a bounded quiet period. The enrolled
helper also supports the Phase 01 execution-only indefinite-sleep sentinel; that
path is not a configuration mutation.

The feature is **disabled by default** (`enabled = false`) and requires explicit
host configuration under `[server.idle_suspend]` in the loaded registry TOML
(`~/.config/dam-hopper/dam-hopper.toml`).

[server.idle_suspend]
enabled = false
quiet_period_seconds = 900
wake_after_seconds = 600
capability_selection = "auto"
automatic_policy = "empty-fleet"
agent_executables = ["codex", "omp", "claude", "agy"]

# enrollment_reference = "systemd:dam-hopper-idle-suspend-helper.service"

### Policy and agent-executable fields (Phase 01)

`automatic_policy` accepts `empty-fleet` (the default) or `agent-activity`.
Phase 01 freezes this selector and its configuration contract. Phase 02
provides private PTY root/raw-output/input evidence, Phase 03 provides bounded
configured-agent process discovery and retained attribution through a private
procfs seam, and Phase 04 provides owned TCP byte observation and per-socket
baseline comparison. Phase 05 completes the dedicated transactional sampler,
manager-locked final admission, bounded warning projection, and
`agent-activity` coordinator path. Phase 06 adds protected status decoding and
aggregate browser presentation without adding a policy/matcher editor or
mutation route. Phase 07 qualifies the integrated manager/API/Chromium path,
the fake-executor safety boundary, and the explicitly selected Linux PTY/TCP
observer smoke; it does not authorize a real suspend canary. See [PTY Activity
Observation](./pty-activity-observation.md), [Configured-Agent Process
Discovery](./agent-activity-process-discovery.md), [Owned TCP Byte
Observation](./tcp-activity-observation.md), [Agent Activity Automatic
Admission](./agent-activity-automatic-admission.md), and [Protected Status and
Browser UI](./idle-suspend-status-ui.md).

Under `agent-activity`, the server starts one joinable sampler worker after
persistence restoration. It requests scheduled samples, a fresh final sample at
the quiet deadline, and recovery sampling after resume or handoff release.
Measurement failures remain visible as bounded status warnings and never
authorize automatic suspend. The default `empty-fleet` policy keeps its
fleet-transition behavior and does not start the activity sampler.

Each sample runs on a two-second cadence with a one-second monotonic acceptance
deadline and a five-second maximum accepted age; a quiet deadline always
triggers a fresh final sample, and late samples cannot claim a handoff.
Cancellation is cooperative: a kernel-stalled syscall cannot be forcibly
stopped, so shutdown join may be delayed. That join caveat is separate from
normal target-host latency qualification and is a rollout blocker when it
persists.

`agent_executables` defaults to `["codex", "omp", "claude", "agy"]`. Entries
are literal, case-sensitive basenames or absolute paths, never regular
expressions. The list must contain 1–32 unique entries; each entry is
1–256 UTF-8 bytes and each path component may contain only ASCII letters,
digits, `_`, `-`, `.`, `+`, and `@`. Whitespace/control/NUL characters,
disallowed shell/glob/regex metacharacters, relative slash-containing paths,
`.`/`..`, repeated or trailing `/`, and generic interpreter basenames (`node`,
`nodejs`, `bun`, `sh`, `bash`, `dash`, `zsh`, `ksh`, `fish`, `python`, or
`python` followed by an ASCII digit) are rejected. Validation is lexical and
does not expand variables, inspect the filesystem, launch a process, or
silently deduplicate input; invalid lists are rejected even when idle suspend
is disabled.

TOML uses the snake_case keys shown above. Config-shaped JSON uses
`server.idleSuspend.automaticPolicy` and
`server.idleSuspend.agentExecutables`; snake_case aliases are accepted on
input. The canonical writer may omit default-valued policy/list keys, and
omission resolves to the defaults.

### Configuration Paths and Registry Locations

DamHopper uses three distinct registry locations depending on deployment mode:

1. **Direct/source development default**: `~/.config/dam-hopper/dam-hopper.toml`. Overridden with `--config <path>` or the `DAM_HOPPER_CONFIG` environment variable.
2. **Release-manager / systemd production**: `/var/lib/dam-hopper/dam-hopper.toml`, owned by the API service identity with mode `0600`; it is the sole `--config` operand in `deploy/systemd/dam-hopper-api.service` `ExecStart`.
   On first start only, the runtime provisioner may validate and copy the
   exact bytes from `/etc/dam-hopper/dam-hopper.toml` when the canonical file
   is absent. The legacy file is read-only and is never synchronized after the
   canonical file exists. The server timing/manual audit is
   `/var/lib/dam-hopper/idle-suspend-audit.jsonl`, also mode `0600`.
3. **UAT runner default**: `/tmp/dam-hopper-uat/dam-hopper.toml` generated by `scripts/run-uat.sh`. Never treat this temporary path as the production registry.

### Production configuration ownership and updates

For systemd deployments, `/var/lib/dam-hopper/dam-hopper.toml` is the
canonical daemon registry and the only startup authority. The API service owns
the file as its configured `User=`/`Group=` with mode `0600`; the legacy
`/etc/dam-hopper/dam-hopper.toml` is a read-only migration source and is not a
second live configuration.

Use the authenticated API for normal changes:

- `PUT /api/config` replaces the registry through the API's same-directory
  atomic TOML writer.
- `PATCH /api/config/projects/:name` applies a project change through the same
  atomic writer.
- Idle-suspend timing changes use the timing endpoint documented above; they
  also commit through the API-owned canonical file.

Do not use root `sed -i`, `tee`, `cp`, `chown`, or `chmod` against the
canonical file. Those operations can replace an API-owned inode or change its
metadata. After an API update, restart
`dam-hopper-api.service` when changing startup-owned policy fields and verify
the canonical file remains a regular API-owned `0600` file. The reset tool is
the only privileged repair workflow: it refuses missing, linked, non-regular,
or mismatched files instead of repairing them, then performs an API-identity
atomic disablement when preconditions pass.


### Canonical TOML Examples

#### 1. Safe default configuration (upgrade / release-dark baseline)

```toml
[server.idle_suspend]
enabled = false
automatic_policy = "empty-fleet"
agent_executables = ["codex", "omp", "claude", "agy"]
quiet_period_seconds = 900
wake_after_seconds = 600
capability_selection = "auto"
# enrollment_reference = "systemd:dam-hopper-idle-suspend-helper.service"
```

#### 2. Observation-only qualification stage (measurement active, automatic suspend disabled)

```toml
[server.idle_suspend]
enabled = false
automatic_policy = "agent-activity"
agent_executables = ["codex", "omp", "claude", "agy"]
quiet_period_seconds = 900
wake_after_seconds = 600
capability_selection = "auto"
```

#### 3. Automatic enablement (opt-in automatic suspend)

```toml
[server.idle_suspend]
enabled = true
automatic_policy = "agent-activity"
agent_executables = ["codex", "omp", "claude", "agy"]
quiet_period_seconds = 900
wake_after_seconds = 600
capability_selection = "auto"
```

#### 4. Custom interpreted agent entry

When tracking interpreted agents (e.g. Node.js or Python entrypoint scripts), specify the exact, normalized absolute path to the script entrypoint token. Never specify bare `node`, `bun`, `python`, generic script names, shell wrappers, or wildcards:

```toml
[server.idle_suspend]
enabled = false
automatic_policy = "agent-activity"
agent_executables = ["codex", "omp", "claude", "agy", "/opt/tools/bin/my-agent.js"]
quiet_period_seconds = 900
wake_after_seconds = 600
```

### Startup Ownership and Immutability

- **Startup policy authority**: `StartupIdleSuspendPolicy` captures `enabled`, `enrollment_reference`, `capability_selection`, `automatic_policy`, and the validated executable set at server boot. Workspace switches, config reloads, full-config updates (`PUT /api/config`), and settings imports cannot change these fields on a running server. Changing policy or executable matchers requires restarting the API process; for systemd deployments use `sudo systemctl restart dam-hopper-api.service`.
- **Timing Updates**: Authenticated operators can tune `quiet_period_seconds` and `wake_after_seconds` via `PATCH /api/system/idle-suspend/v1/timing`. Unrestricted full-config updates preserve the current idle-suspend configuration and reject incoming modifications.
- **Timing Bounds**:
  - `quiet_period_seconds`: Integer between 60 (1 min) and 86400 (24 hours); default 900 (15 min).
  - `wake_after_seconds`: Integer between 60 (1 min) and 86400 (24 hours); default 600 (10 min).
- **Security Safeguards**: Both the timing mutation route and manual force-suspend route are strictly unavailable in development mode (`--no-auth`). All suspend requests fail closed if sleep inhibitors are active, helper enrollment is missing, host capabilities are unsupported, or RTC ownership is ambiguous.
- **Manual Execution Independence**: Manual force sleep (`POST /api/system/idle-suspend/v1/force-suspend`) is independent of the automatic idle suspend `enabled` setting; it is accessible only to an authenticated enabled actor when helper enrollment and capability checks are satisfied.

### Controlled Rollout Stages

1. **Stage 0 — Release Dark**: Deploy binary release with existing config selecting `automatic_policy = "empty-fleet"` (or omitted). Verify no existing installations change semantics.
2. **Stage 1 — Observation-Only Soak**: On an approved Linux canary host, set `enabled = false` and `automatic_policy = "agent-activity"`, restart `dam-hopper-api.service`, and observe protected status. The sampler monitors PTYs and sockets and generates warnings, but cannot arm or claim automatic suspend.
3. **Stage 2 — Target-Host Gate**: Run the ignored live Linux observer smoke (`cargo test --manifest-path server/Cargo.toml --test idle_suspend activity_live_linux_pty_tcp_smoke -- --ignored --exact --nocapture --test-threads=1`) under the deployed service context to verify kernel diagnostics, proc visibility, and the one-second sample budget.
4. **Stage 3 — Bounded Automatic Canary**: Operations and Security approve a single canary host. Set `enabled = true` and `automatic_policy = "agent-activity"` with a bounded `wake_after_seconds`. Allow exactly one genuine epoch attempt and verify resume, audit, and spent-epoch behavior.
5. **Stage 4 — Limited Cohort Expansion**: Expand to additional qualified hosts one at a time. Each host must independently pass Stage 2 qualification; never assume kernel compatibility across hosts.
### Warning and observation interpretation

While `agent-activity` is selected, `activity.measurementWarning` is `null` for
an available measurement and otherwise contains the closed reason, one
continuous `blockedSinceMs` interval, and at most 32 current attributable
`{ pid, executableIdentity }` examples (positive PID order; identity is nullable
and capped at 256 UTF-8 bytes without controls). The blocked interval is
measurement-unavailable duration, not quiet time or an automatic countdown. PID
or cause changes do not restart it; complete available recovery clears it, and a
later failure starts a new interval. Warning details appear only in the
authenticated, `Cache-Control: no-store` status response; they are not copied to
logs, audits, WebSocket hints, or rollout artifacts. Missing or misleading
warnings are a no-go for enablement.

### Policy Rollback and Emergency Disable

#### Level 1: Activity policy rollback (returns to zero-fleet policy)

1. Inspect protected status `GET /api/system/idle-suspend/v1/status`. If a
   handoff is active (`finalCheck` or `handedOff`), reconcile its outcome before
   editing configuration; a config edit is not cancellation.
2. In `/var/lib/dam-hopper/dam-hopper.toml`, set `automatic_policy = "empty-fleet"`.
3. Restart the API: `sudo systemctl restart dam-hopper-api.service`.
4. Refetch status: verify `automaticPolicy: "empty-fleet"` and `activity: null`.

#### Emergency disable (immediately halts automatic scheduling)

1. In `/var/lib/dam-hopper/dam-hopper.toml`, set `enabled = false` and `automatic_policy = "empty-fleet"`.
2. Restart the API: `sudo systemctl restart dam-hopper-api.service`.
3. Refetch status: verify `state: "disabled"`.

#### Level 2: Complete feature & helper disenrollment

To remove the privileged helper and disenroll completely, use the root disenrollment script:

```bash
sudo ./deploy/reset-linux-production.sh --dry-run
sudo ./deploy/reset-linux-production.sh
```

### Release-manager helper service (Production CLI Phase 03)

For a `server` or `both` release role, `install` stages
`dam-hopper-idle-suspend-helper.service` but does not start it. Explicit
`sudo dam-hopper start` starts the helper before the API; a helper start or
enable failure logs a warning and leaves ordinary API operations available.
`stop`, activation rollback, `rollback`, and boot recovery include the helper
in the managed-unit lifecycle. Inspect it with `dam-hopper status --json` or
`systemctl status dam-hopper-idle-suspend-helper.service`; see the
[Linux Release Manager](./linux-release-manager.md#helper-service-lifecycle-production-cli-phase-03)
guide for ordering and recovery details.

### Execution-only indefinite sleep (Phase 01)

`wake_after_seconds = 0` is **never valid** in this persisted automatic
configuration or in the timing PATCH. The helper execution protocol accepts
`wakeAfterSeconds: 0` as a required numeric sentinel for one fixed
indefinite-sleep request. The helper converts it to clear-only RTC behavior:
write `0`, read back the clear, and do not calculate or write a target epoch.

Nonzero execution values remain `60..=86400` seconds. The helper clears and
verifies the RTC alarm before programming a checked target epoch and verifying
the readback. A non-empty pre-existing `/sys/class/rtc/rtc0/wakealarm` is
treated as an ownership conflict (`RtcAlarmBusy`), and any preflight, clear,
readback, write, audit-intent, or suspend failure suppresses the operation.
Automated tests use temporary files and fake backends; they never suspend the
test host or program its RTC.

### Manual Force Sleep and Confirmation

Authenticated, database-backed operators can invoke manual force sleep from the Host Resource Popover or via `POST /api/system/idle-suspend/v1/force-suspend`. The strict JSON body is:

```json
{ "wakeAfterSeconds": 0, "force": false }
```

Execution accepts exactly `wakeAfterSeconds: 0` (indefinite, clear-only RTC mode) or
`60..=86400` seconds. The persisted automatic configuration never accepts zero.
The active fleet count is `live + creating + restartPending`; when it is nonzero,
the UI requires explicit confirmation and sends `force: true`. A request with
`force: false` returns `409 idleSuspendActiveFleetConfirmationRequired` without
claiming the fleet or dispatching the helper. `force: true` bypasses quiescence
only; authentication, generation, capability, inhibitor, RTC, audit, and helper
peer checks remain mandatory.

An accepted `202` means an audited handoff was admitted, not that the host has
already suspended. The browser sends one POST with retries disabled. If delivery
is ambiguous, reconnect and reconcile from the status endpoint, status revision,
and `host:idleSuspendChanged`; never replay the action. Manual execution does not
mutate the persisted automatic timing pair and can remain available when
automatic `enabled = false`, provided the helper is enrolled and capable.

### Browser Debug Preview

The Browser tool has no server configuration flag. It embeds the selected
development app directly and uses the DamHopper Browser Debug extension for
DOM selection; the target application does not need a package, script, or CSP
change for the bridge.

The web build bundles the extension at
`/browser-debug-extension/dam-hopper-browser-debug.zip`. If the Browser tool
reports that the bridge is unavailable, use its Download extension ZIP action,
extract the archive, open `chrome://extensions` in the client browser, enable
Developer mode, choose Load unpacked, and select the extracted
`dam-hopper-browser-debug` folder. A website cannot perform this browser
extension installation automatically. Reload the extension after a new
DamHopper deployment. Its content script runs only in framed pages and accepts
loopback apps and HTTPS development/tunnel pages, but the bridge accepts a
handshake only from loopback DamHopper parents or exact origins configured at
extension build time. For a deployed DamHopper parent, set
`VITE_DAM_HOPPER_EXTENSION_PARENT_ORIGINS` to a comma-separated list of exact
origins before `pnpm build`, for example
`https://damhopper.example.com,https://staging.damhopper.example.com`.
This exact-origin configuration is required for Browser address synchronization,
Back/Forward/Reload, and console forwarding. The bundled development defaults
cover `localhost` and `127.0.0.1` on ports 5173 and 4800.

The extension uses the existing bounded bridge protocol and does not receive a
DamHopper server token.

Native desktop clients use the embedded Tauri child-WebView controller and do
not require extension installation. The browser-extension ZIP instructions
below apply only to the web/browser host. Linux native builds remain
experimental and unverified at runtime; macOS support is deferred.

Use HTTP loopback URLs or URLs on currently-ready tunnel origins in the
Browser URL field; paths, query strings, and hashes are supported, but
credentials are rejected. The extension does not bypass a browser-level frame policy;
a target with `X-Frame-Options` or restrictive CSP may still refuse embedding.
For a controlled debug route, allow the exact DamHopper parent origin in
`frame-ancestors` and remove a conflicting `X-Frame-Options` header on that
route only:

```http
Content-Security-Policy: frame-ancestors 'self' http://localhost:4800 http://127.0.0.1:4800;
```

Replace the loopback entries with the exact deployed DamHopper origin(s); do
not use `*` or a broad tunnel wildcard. The target application remains
responsible for its own framing policy.

Headless browser tests cover protocol and mocked capture behavior. Before
release, manually verify the Chromium permission chooser, browser-tab-only
selection, crop coordinates at the supported zoom/HiDPI settings, live tunnel
navigation, and insertion into a real xterm. Those OS-level checks cannot be
automated by the repository's headless suite.

Selections are bounded DOM/ARIA metadata. Optional screenshots are captured by
an explicit browser permission gesture or supplied manually. A manual JPEG is
converted to PNG in the browser; the authenticated artifact API accepts PNG
bytes only. Artifacts live outside project roots for 10
minutes, are capped at 64 KiB JSON and 4 MiB PNG, and are removed on delete,
expiry sweep, or graceful server shutdown. When attached, the PTY receives only
generated local paths in a single control-free reference; page text is never
inserted and Enter is never sent. This local-path handoff assumes the PTY and
server share a filesystem; remote/container agents need a future resource API.

### UI Configuration

The global UI config includes terminal workspace/panel shortcuts, inline terminal suggestions, Codex terminal notification settings, terminal project switching, and the host-resource storage presentation preference.

| Field                                        | Type           | Default               | Notes                                                                                      |
| -------------------------------------------- | -------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| terminal_workspace_shortcut                  | string         | `Mod+Shift+Backquote` | Global IDE/terminal mode toggle shortcut                                                   |
| git_panel_shortcut                           | string         | `Mod+Shift+KeyG`      | Toggle the Git panel in IDE or Terminal mode                                               |
| project_panel_shortcut                       | string         | `Mod+Shift+KeyZ`      | Toggle the Project panel in IDE or Terminal mode                                           |
| ports_panel_shortcut                         | string         | `Mod+Shift+KeyP`      | Toggle the Ports panel in IDE or Terminal mode                                             |
| fleet_terminal_shortcut                      | string         | `Mod+Shift+KeyM`      | Toggle the Fleet Terminal panel in IDE or Terminal mode                                    |
| terminal_suggestions_enabled                 | bool           | `true`                | Kill switch for automatic suggestions and lifecycle-driven history writes                  |
| terminal_scroll_buttons_enabled              | bool           | `false`               | Show the expandable floating terminal scroll control                                       |
| terminal_auto_switch_project_enabled         | bool           | `true`                | Switch the active project when selecting a project-assigned terminal                       |
| terminal_codex_notifications_enabled         | bool           | `false`               | Master switch for Codex OSC 9 notifications and Codex TUI synchronization                  |
| terminal_codex_notification_toast_enabled    | bool           | `true`                | Persisted preference for transient in-app toasts; notification history remains independent |
| terminal_codex_browser_notifications_enabled | bool           | `true`                | Persisted preference for native browser popups; browser permission remains runtime-only    |
| terminal_codex_notification_sound_enabled    | bool           | `true`                | Persisted preference for the in-app chime                                                  |
| terminal_codex_notification_sound_volume     | u8             | `100`                 | In-app chime volume, from `0` to `100`                                                     |
| terminal_codex_notification_sound_pattern    | string         | `"default"`           | One of `"default"`, `"soft"`, `"two-tone"`, or `"urgent"`                                  |
| host_resource_pinned_mount                   | string or null | `null`                | Optional exact mount point for the host-resource storage row; UTF-8 length 1–4096 bytes    |

Example:

```toml
[ui]
terminal_workspace_shortcut = "Mod+Shift+Backquote"
git_panel_shortcut = "Mod+Shift+KeyG"
project_panel_shortcut = "Mod+Shift+KeyZ"
ports_panel_shortcut = "Mod+Shift+KeyP"
fleet_terminal_shortcut = "Mod+Shift+KeyM"
terminal_suggestions_enabled = true
terminal_scroll_buttons_enabled = false
terminal_auto_switch_project_enabled = true
terminal_codex_notifications_enabled = false
terminal_codex_notification_toast_enabled = true
terminal_codex_browser_notifications_enabled = true
terminal_codex_notification_sound_enabled = true
terminal_codex_notification_sound_volume = 100
terminal_codex_notification_sound_pattern = "default"
host_resource_pinned_mount = "/"
```

When enabled, the terminal shows a compact floating control in the lower-right
corner. Activate it to expand keyboard-accessible actions for jump-to-top,
step up/down (using the configured terminal scroll step), and jump-to-bottom.
The menu closes on outside click or `Escape`; the preference is UI-only and does
not affect retained server scrollback.

The API exposes these UI fields in `camelCase` (for example, `terminalCodexNotificationToastEnabled`, `terminalAutoSwitchProjectEnabled`, and `hostResourcePinnedMount`) and persists them as the snake_case TOML keys shown above. `hostResourcePinnedMount` accepts `null` to clear the pin; a non-null value must be UTF-8 encoded and 1–4096 bytes long. If the saved mount is absent from the current host-metrics disk list, the UI shows it as missing and does not silently select another mount. This preference is presentation-only and has no telemetry coupling. Older `terminal_agent_notifications_enabled` and `terminalAgentNotificationsEnabled` values remain read-compatible aliases for the master switch. Missing child preferences default to enabled, volume `100`, and pattern `"default"`.

`terminalAutoSwitchProjectEnabled` is a global preference and defaults to `true` so terminal selection follows the requested project context immediately. In Settings > Appearance, the **Switch project on terminal selection** switch uses the copy: “Selecting a terminal assigned to a project activates that project; free terminals leave the current project unchanged.” When enabled, selecting a project-assigned terminal or an already-open project terminal tab changes the active project before the tab or panel renders; when disabled, selection opens the terminal without changing the active project. Free terminals, unowned terminals with blank project metadata, and unknown sessions (including unrecognized session-ID prefixes) never switch the active project; free terminals remain excluded even if incidental metadata contains a project. The top-bar project switcher and project-scoped panels (Explorer, Search, Git, Commit, Project Info, and editor) all consume the resulting active project. This uses the existing global UI-config persistence path and requires no new endpoint or migration.

Only updates to `terminalCodexNotificationsEnabled` synchronize `~/.codex/config.toml`. Toast, browser-popup, sound, volume, and pattern updates persist only to DamHopper's global UI config. Browser notification permission is browser-managed and runtime-only: only the explicit **Request permission** action can request it; toggling or saving a browser-popup preference never requests, revokes, or persists it. **Play sound** previews the selected synthesized in-app pattern and volume only; it does not create a browser popup or request permission.

Shortcuts are normalized by the client config layer and can be captured/reset from Settings > Appearance > Keyboard Shortcuts. Git, Project, Ports, and Fleet Terminal shortcuts toggle their target in both IDE and Terminal modes; opening one closes the other target panels. The Project shortcut defaults to `Mod+Shift+KeyZ`.

#### Inline terminal suggestions

The **Inline Terminal Suggestions** switch is an immediate fail-closed kill switch:
turning it off hides automatic ghosts, stops controller searches, and prevents future
lifecycle-driven writes to browser-local command history. It does not delete commands
already retained in the browser. Use **Clear local command history** in Settings to
remove those commands, or disable **Local command history** to stop future browser-local
writes independently.

Automatic suggestions are supported only for a launch-only local interactive `zsh`,
`fish`, or Bash shell whose lifecycle markers validate for the current PTY incarnation.
Bash preserves scalar and array `PROMPT_COMMAND` hooks and records normalized simple
commands, but fails closed when an existing `DEBUG` trap or compound, multiline,
substitution, or redirection syntax prevents reliable capture. PowerShell,
SSH/subshell sessions, replayed or respawned terminals, alternate buffers,
and mobile/coarse-pointer input remain fail closed. In those cases no ghost is shown;
the explicit desktop history dialog remains the deliberate reuse path when enabled.

The desktop shortcuts are `Alt+Right` for the full suffix, `Alt+Shift+Right` for the
next token, and `Ctrl+Alt+H` for command history. Acceptance writes only the verified
suffix and never executes the command. All other terminal keys and paste data pass to
the PTY unchanged.

Only DamHopper-managed xterm sessions participate in this feature. External terminals remain out of scope even if they launch Codex.

### Server Configuration

Optional: configure SQLite path and retention for terminal restart recovery. Session persistence is always enabled when the database can be opened.

```toml
[server]
session_db_path = "~/.config/dam-hopper/sessions.db"  # Database file location
session_buffer_ttl_hours = 24  # TTL for dead session buffers in hours (default: 24)
```

**Fields:**

| Field                    | Type   | Default                          | Notes                                                                                  |
| ------------------------ | ------ | -------------------------------- | -------------------------------------------------------------------------------------- |
| session_db_path          | string | ~/.config/dam-hopper/sessions.db | SQLite database path (supports ~ expansion); must be on local filesystem               |
| session_buffer_ttl_hours | u64    | 24                               | Hours before dead session buffers are auto-deleted; prevents unbounded database growth |

**Security Note:** On Unix systems, database files are created with 0o600 permissions (user-only access). Ensure the directory containing `session_db_path` is not world-readable.

**Example:**

```toml
[server]
session_db_path = "~/.local/share/dam-hopper/sessions.db"
session_buffer_ttl_hours = 48
```

When the database opens successfully:

- Session metadata (id, project, command, cwd, restart_policy, etc.) is saved to SQLite
- Up to 1 MB of terminal scrollback is retained per session
- Any browser connected to the same server can resume live sessions
- On DamHopper server restart, sessions that were alive are relaunched and restored scrollback is replayed
- Exact shell/process memory continuity is not guaranteed across server or host restart
- Dead sessions are kept for 60 seconds to allow reconnection; buffers are cleaned up per TTL

### Deferred host-action scaffolding (inactive)

This Phase 07 release has no supported host-action configuration or client
contract. Inert, fail-closed route scaffolding remains in the server for a
future approved design, but authentication, re-authentication, helper
enrollment, lifecycle/audit, IPC, and host mutation are deferred together. Do
not configure or call those deferred routes for monitoring; no current setting
enables them.

### Telemetry Configuration

Telemetry is opt-in and disabled by default. The settings live under `[server.telemetry]` in
the registry file. Omitting the section leaves collection and the Codex OTLP collector off;
enabling the collector does not change the loopback-only network boundary.

```toml
[server.telemetry]
enabled = false
db_path = "~/.config/dam-hopper/telemetry.db"
detail_retention_days = 90
# aggregate_retention_days = 365

[server.telemetry.collector]
enabled = false
host = "127.0.0.1"
port = 4811
```

| Field                      | Type           | Default                             | Notes                                                    |
| -------------------------- | -------------- | ----------------------------------- | -------------------------------------------------------- |
| `enabled`                  | bool           | `false`                             | Master switch for telemetry collection and persistence   |
| `db_path`                  | string         | `~/.config/dam-hopper/telemetry.db` | SQLite telemetry database path                           |
| `detail_retention_days`    | u16            | `90`                                | Detailed-event retention, from 1 to 3650 days            |
| `aggregate_retention_days` | u32 or omitted | omitted                             | Optional aggregate retention; when set, must be positive |
| `collector.enabled`        | bool           | `false`                             | Enables the authenticated Codex OTLP/HTTP receiver       |
| `collector.host`           | IP address     | `127.0.0.1`                         | Must be a loopback address                               |
| `collector.port`           | u16            | `4811`                              | Must be non-zero                                         |

TOML uses snake_case keys; the corresponding API representation uses camelCase (for example,
`dbPath`, `detailRetentionDays`, and `aggregateRetentionDays`). The telemetry database is
separate from session persistence. When enabled, startup creates/opens it and starts a bounded
worker; initialization failures disable analytics only. SQLite and WAL/SHM files are restricted
to owner access on Unix. Telemetry stores bounded, privacy-filtered metadata rather than command
text, prompts, responses, or tool output; see the [telemetry architecture notes](./system-architecture.md#codex-otel-usage-analytics).

Daily aggregates are retained indefinitely when `aggregate_retention_days` is omitted. Set it to
a positive value to purge older UTC rollups. The Usage page can delete all data or a selected
UTC-day-aligned `[from,to)` range; deletion requires explicit confirmation. Full deletion also
rotates the shared telemetry HMAC key, while range deletion does not.

Codex session summaries are flat and retention-bounded, not permanent. Raw `response.completed`
events are applied before the configured detail-retention purge removes expired summaries and
events. `delta` counters accumulate, while `cumulative` counters accept only newer non-regressing
values.
Codex CLI 0.146.1 may emit token fields without trace/span identity. Those records use a
domain-separated HMAC fallback over bounded decoded fields, remain `unverified`, and are stable for
replay; valid trace/span identity always takes precedence. Identical same-millisecond decoded events
can dedupe as the documented compatibility
tradeoff; invalid timestamps still fail closed. No receipt-time, conversation-ID-alone, random-ID,
raw-content, or config-secret fallback is used. This does not change telemetry configuration,
event fields, or the SQLite schema. The existing Usage health response additionally exposes
fixed-cardinality in-memory drop counters; they reset on process restart and contain no source or
payload values. Its legacy `droppedMissingIdentity` counter remains available for API compatibility
and stays zero while this fallback is active.
Telemetry uses a fresh v1 Codex-only schema containing only Codex sessions, usage events, daily
rollups, and health state. There is no legacy-data migration or import. During development, startup
checks the SQLite version and complete schema object set; a legacy, malformed, or otherwise
incompatible telemetry database is reset transactionally by removing its user tables/views/triggers/
indexes and recreating the v1 schema. A valid current database is reopened without data loss. The
reset is bounded to the configured telemetry file, and telemetry/session database paths must resolve
to different files. Stop DamHopper and remove the telemetry database plus its `-wal`/`-shm` sidecars
for an explicit clean reset; never remove the separate `sessions.db`.

The Usage settings API can explicitly manage the local Codex exporter with `codexExporter: true`.
It writes only the exact DamHopper-owned shape in `~/.codex/config.toml` (loopback `/v1/logs`,
binary OTLP, one bearer header, and `log_user_prompt = false`). The generated secret is stored
in `~/.config/dam-hopper/codex-otlp-token` as a regular owner-only (`0600`) file; config writes
are atomic. Foreign, malformed, or changed exporter configuration is reported as
`codexExporter: "conflict"` and never overwritten. API responses expose status only
(`notConfigured`, `managed`, or `conflict`), never the bearer value.

Managing the config does not restart Codex: restart the existing Codex process separately for
it to reconnect. Collector changes restart only the loopback listener, not the DamHopper server.
Failed runtime or registry writes roll back both runtime state and the managed Codex file.

`PATCH /api/usage/settings` applies validated telemetry changes to the running server before
persisting the registry file. Enabling or disabling telemetry changes which newly accepted Codex
events are persisted; existing summaries remain readable. Collector host/port or enabled-state
changes stop and start the loopback listener while the server remains up. If a collector restart
or retention operation fails, the previous live collector/configuration is restored and the failed
update is not published.

Rollback/runbook: pause collection, optionally delete a UTC range or all usage data, then leave
the feature disabled. Existing telemetry is not removed by disabling the flag. Re-enable only
after confirming database permissions, collector loopback binding, and the Usage health counters.

The Usage page's Sessions tab is a read-only audit view over flat aggregate summaries. It keeps
cached input separate from the primary token total and accepts dynamic provider/model identifiers.
Session IDs are derived HMAC values; raw commands, prompts, responses, tool content, and storage
paths are not displayed or stored in the UI. Pausing keeps existing summaries available while
marking the view paused; deletion requires explicit confirmation. List/detail refresh runs every
15 seconds only in a visible document (hidden browser tabs stop polling), with identical behavior
in browser and native hosts.

### Diagnostics Storage

Diagnostics export does not currently add user-configurable knobs to `dam-hopper.toml`.

The export API is local-only, uses camelCase on the wire, and accepts `frontend` plus the legacy `frontendSnapshot` alias.

The Phases 02–03 canonical idle-suspend event producer is internal. Its path
is fixed at
`/var/lib/dam-hopper/.config/dam-hopper/diagnostics/idle-suspend-events-v1.jsonl`;
there is no configuration key or public path override. Phase 03 wires the
optional writer into `AppState` and coordinator startup; initialization can
degrade semantic evidence without disabling suspend/status behavior.

Production collection is a separate read-only CLI path:
`dam-hopper diagnose --json` (Phases 06–07). The required `--json` flag is the
complete grammar; path, window, source, unit, URL, command, and verbosity
overrides are not accepted.

Bundle-v1 bounds are fixed in the implementation:

- 60-minute historical window
- 10,000 accepted records per source and 10,000 record-array items
- 16 KiB per JSONL line and 16 MiB maximum file scan
- 2 MiB maximum host-command stdout and 256 KiB maximum local-API body
- 8 MiB maximum serialized bundle
- 512-byte redacted/serialized strings, 256 source errors, 32 warning examples,
  and nested DTO depth 8
- 5-second command/API deadlines

These are not `dam-hopper.toml` keys and have no public tuning knobs. The
default idle-suspend policy (`empty-fleet`) and timeout configuration remain
unchanged.

The collector uses fixed role-aware host adapters and emits one bounded
camelCase `bundleSchemaVersion: 1` JSON file. Applicable server/both sources
are collected for those roles; web-role sources are `notApplicable`; an
unknown role remains partial. Current host probes are marked latest and
`nonHistorical`, so they do not establish historical completeness.

Root output is `/var/lib/dam-hopper-manager/diagnostics`. Non-root output is
`$XDG_STATE_HOME/dam-hopper/diagnostics`, or
`$HOME/.local/state/dam-hopper/diagnostics` when unset; there is no `/tmp`
fallback. The output directory is owner-only `0700`, the final bundle is
owner-only `0600`, and non-root execution never escalates. A root-only helper
audit is reported as `permissionDenied` for non-root collection and can make a
valid bundle partial. The command prints only the absolute final bundle path
after an atomic same-directory write.

The command returns `0` for complete applicable historical evidence, `2` for a
valid partial bundle, and `1` for serialization or secure-output failure.

See [Linux Release Manager — Production diagnostics](./linux-release-manager.md#production-diagnostics-phase-06)
for fixed source paths, adapter behavior, and the atomic write sequence.

- Backend diagnostics are stored locally at `~/.config/dam-hopper/diagnostics/backend-log.jsonl`
- The backend log keeps a 60-minute retention window and uses restricted `0o600` file permissions on Unix
- Frontend diagnostics stay in browser `localStorage` under `damhopper_diagnostics_frontend_v1`
- Exported browser JSON bundles are created only when the user triggers Settings > Maintenance > Export Diagnostics
- Terminal tails are included by default and may still contain sensitive local/dev output even after best-effort redaction

## Global Configuration (~/.config/dam-hopper/config.toml)

Store global defaults and known workspace metadata. This file is separate from the project registry.

```toml
[defaults]
workspace = "/home/user/projects/main-workspace"

[[workspaces]]
name = "prod"
path = "/home/user/prod-workspace"

[[workspaces]]
name = "sandbox"
path = "/tmp/test-workspace"
```

### Fields

**defaults.workspace** — Legacy fallback workspace directory, used only after explicit config, explicit workspace, and the global registry path are checked.

**workspaces** — Known workspace shortcuts (referenced by server later, not currently used by CLI).

## Environment Variables

| Var                                        | Type    | Purpose                                                                   |
| ------------------------------------------ | ------- | ------------------------------------------------------------------------- |
| `DAM_HOPPER_CONFIG`                        | path    | Load an exact `dam-hopper.toml` registry file                             |
| `DAM_HOPPER_WORKSPACE`                     | path    | Legacy workspace path/discovery fallback                                  |
| `DAM_HOPPER_PORT`                          | number  | API listen port (direct/Docker default 4800; systemd sets 4801)           |
| `DAM_HOPPER_HOST`                          | string  | API bind address (default `0.0.0.0`)                                      |
| `DAM_HOPPER_CORS_ORIGINS`                  | string  | Comma-separated exact HTTP(S) origins for credentialed API/WS CORS        |
| `DAM_HOPPER_WEB_DIR`                       | path    | Explicit API combined-mode static root; Docker sets `/opt/dam-hopper/web` |
| `DAM_HOPPER_NO_AUTH`                       | boolean | Development-only API auth bypass                                          |
| `DAM_HOPPER_WEB_ROOT`                      | path    | Dedicated `dam-hopper-web` static root                                    |
| `DAM_HOPPER_WEB_HOST`                      | string  | Dedicated web bind address (default `0.0.0.0`)                            |
| `DAM_HOPPER_WEB_PORT`                      | number  | Dedicated web listen port (default `4802`)                                |
| `DAM_HOPPER_WEB_RUNTIME_CONFIG`            | path    | Optional public runtime-config JSON file                                  |
| `DAM_HOPPER_WEB_RELEASE_VERSION`           | string  | Optional web health release-version override                              |
| `VITE_DAM_HOPPER_LOG_LEVEL`                | string  | Web bootstrap log level, embedded at build time                           |
| `VITE_DAM_HOPPER_EXTENSION_PARENT_ORIGINS` | string  | Exact extension parent origins, embedded at build time                    |
| `RUST_LOG`                                 | string  | Rust logging filter                                                       |
| `MONGODB_URI` / `MONGODB_DATABASE`         | string  | Optional API authentication database                                      |

`VITE_*` values require a web rebuild. `VITE_DAM_HOPPER_SERVER_URL` is not
allowed for production builds; production API origin is runtime config.
Changing extension parent origins also requires redistributing its generated ZIP.
CORS values are runtime API configuration and must exactly match the browser
origin.

## Authentication Token

**Location:** `~/.config/dam-hopper/server-token`

**Permissions:** 0600 (read-only to user)

**Format:** Hex-encoded UUID (64 characters)

### Generate New Token

```bash
cd server && cargo run -- --config /path/to/dam-hopper.toml --new-token
```

Saves to `~/.config/dam-hopper/server-token`.

### Use Token

Include in all API requests:

```bash
curl -H "Authorization: Bearer $(cat ~/.config/dam-hopper/server-token)" \
  http://localhost:4800/api/projects
```

## Running the Server

### Development Mode

```bash
cd server
cargo run -- --config /path/to/dam-hopper.toml --port 4800 \
  --host 127.0.0.1
# Or omit --config to use ~/.config/dam-hopper/dam-hopper.toml
```

### With Logging

```bash
RUST_LOG=dam_hopper=debug cargo run -- --config /path/to/dam-hopper.toml \
  --host 127.0.0.1
```

### Release Build

```bash
cargo build --release
./target/release/dam-hopper-server --config /path/to/dam-hopper.toml --port 4800 \
  --host 127.0.0.1
```

### Dedicated release web host (`dam-hopper-web`)

Build and run the second Cargo binary with a selected immutable web root:

```bash
cargo build --release --manifest-path server/Cargo.toml
./server/target/release/dam-hopper-web \
  --root /path/to/immutable/web-dist \
  --host 0.0.0.0 \
  --port 4802 \
  --runtime-config /etc/dam-hopper/runtime-config.json
```

`--root` (or `DAM_HOPPER_WEB_ROOT`) is required. The host rejects missing,
non-directory, or symlink roots. `--runtime-config` is optional; without it the
reserved endpoint returns `404`. Runtime config is public but startup-validated,
contains `schemaVersion`, `releaseVersion`, `profileId`, and optional `apiUrl` (omitted
when unset), and is capped at 4 KiB. When present, `apiUrl` must be an exact HTTP(S)
origin without credentials, path, query, or fragment.

The host serves only GET/HEAD. Health and runtime config are reserved
`/__dam-hopper/*` routes with JSON and `Cache-Control: no-store`; static files
stream with MIME detection. Hashed Vite assets are immutable for one year,
`index.html` is `no-cache`, and other assets use a bounded one-hour cache.
Extensionless HTML navigation may fall back to `index.html`; asset-like,
reserved, traversal, encoded-separator, symlink, and directory requests return
`404`. SIGTERM and CTRL-C perform graceful shutdown.

### API-only and Docker combined mode

`dam-hopper-server` is API-only by default: omit `--web-dir` for no static
filesystem access. Docker intentionally opts in to the legacy combined topology:

```bash
dam-hopper-server --port 4800 --web-dir /opt/dam-hopper/web
```

The repository `Dockerfile` supplies this explicit flag in its `CMD`. Do not
infer that systemd or direct API startup serves browser assets; systemd uses
backend port `4801`, while the dedicated web host uses `4802`.

### Linux systemd release manager

Use the published bootstrap or packaged `dam-hopper` manager; checkout-built
production/reset scripts are not supported:

```bash
bash dam-hopper-install.sh --version v0.2.0 --role server
sudo dam-hopper start
```

For an already downloaded bundle, `fetch` runs as the non-root caller and
`install`/`role set` run as root:

```bash
dam-hopper fetch --latest --output "$HOME/.cache/dam-hopper/latest"
sudo dam-hopper install --bundle "$HOME/.cache/dam-hopper/latest" --role server
sudo dam-hopper start
```

`install` and `role set` stop at `PENDING`; `start` is the sole activation
entrypoint. If the canonical root is a verified legacy format-2 installation,
the manager performs the one-time side-staged migration and retires the old
runner. Exact invariants, exchange, rollback, and recovery are documented in
[Linux systemd](./linux-systemd.md).

Current systemd-owned paths are:

- `/opt/dam-hopper/` — canonical release root and current/previous views
- `/etc/systemd/system/dam-hopper-api.service`
- `/etc/systemd/system/dam-hopper-web.service`
- `/etc/systemd/system/dam-hopper-recovery.service`
- `/var/lib/dam-hopper-manager/state.json` — durable manager state

## Browser origin and transport

The API server is API-only by default. A separate `dam-hopper-web` deployment
normally listens on `4802` and fetches its API origin from runtime config, so
the API must allow the exact web origin through credentialed CORS. Wildcard and
credentialed allow-all CORS are forbidden:

```bash
# API allows a dedicated web host
DAM_HOPPER_CORS_ORIGINS=https://web.example.com \
  dam-hopper-server --host 0.0.0.0 --port 4801

# Docker's explicit combined mode is same-origin on 4800
dam-hopper-server --host 0.0.0.0 --port 4800 \
  --web-dir /opt/dam-hopper/web
```

The equivalent API CLI option is `--cors-origins
"https://first.example,https://second.example"`. Each value must be an exact
`http://` or `https://` origin with no path, query, fragment, credentials, or
wildcard. Values are trimmed; duplicate or ambiguous origins are rejected at
startup. Restart the API after changing the setting.

Each allowlisted origin may call authenticated APIs with credentials. CORS does
not make media public: media ticket issuance still requires the authenticated
actor, and each stream URL is a short-lived actor/session-bound capability with
expiry, logout/session revocation, and file revalidation. Windows native desktop
uses this same browser transport for separate-origin profiles; Android, iOS, and
unsupported native hosts continue to require same-origin profiles.

Authenticated HTTP binds, including the default `0.0.0.0`, are supported. HTTP
media and bearer credentials remain exposed to interception, replay, and modification;
use HTTPS, a VPN/Tailscale network, or another trusted encrypted network when that
risk is unacceptable.

### Media compatibility and Phase 09 qualification

The current media contract is v2 only: issue/revoke/logout require a UUIDv4
`mediaClientId`, responses advertise `session-cookie-v2`, and the stream path
never accepts a bearer token. The deterministic server/media tests and the
browser suite cover namespaced cookies, ticket binding, exact-origin fallback,
credentialed `HEAD`, Range/HEAD behavior, lifecycle cleanup, file-version
revocation, and old/v1 rejection.

Phase 09 reconciled **3,504 passed / 9 skipped or ignored** across the release
ledger, including 1,416 Rust server tests, 209 UI browser tests, 24 live
two-server assertions, and four embedded browser assertions. The live harness
(`scripts/qualify-phase09-workbench.mjs`) creates isolated roots and repositories
for Server A (`127.0.0.1:14801`) and Server B (`127.0.0.1:14802`) and serves the
browser fixture on `127.0.0.1:15173`. It checks equal project/file names,
cross-server ticket rejection, selected-client revocation, and owner-specific
remote effects. The harness uses `--no-auth` only for deterministic fixture
checks; normal-auth suites remain required for actor isolation.

`packages/ui/vitest.browser.config.ts` binds the fixture/API server to port
`15173` with `strictPort: true` and accepts exactly one of `BROWSER_CHANNEL` or
`BROWSER_EXECUTABLE_PATH`. Reserve all fixture ports before launch and never
terminate an unrelated listener. Disable idle suspend and external telemetry in
fixtures; retain only sanitized evidence and delete temporary credentials/roots.

Deploy and roll back matching frontend/backend versions. A version-skewed
client must fail closed rather than revive capability-only URLs or a v1 cookie.
G2-Web is qualified; G2-Native remains blocked until real Windows S13 runtime,
SSH, WebView2/DPAPI, and Browser relay evidence is recorded. Old browser
layouts/history discarded by the fresh reset cannot be restored by rollback.

## SSH Key Management

SSH credentials are loaded on-demand via `/api/ssh/keys/load`:

```bash
curl -X POST \
  -H "Authorization: Bearer $(cat ~/.config/dam-hopper/server-token)" \
  -H "Content-Type: application/json" \
  -d '{"privateKeyPath": "/home/user/.ssh/id_rsa"}' \
  http://localhost:4800/api/ssh/keys/load
```

Keys are stored in-memory per session (not persisted to disk).

## Manual Smoke Checklist

1. Create `~/.config/dam-hopper/dam-hopper.toml` with at least two projects whose `projects[].path` values point at separate roots. On Windows, use different drives if available.
   Expected: `GET /api/workspace/status` reports the registry `configPath` and the expected `projectCount`.

2. Start the same-origin server with `cargo run -- --config ~/.config/dam-hopper/dam-hopper.toml --port 4800 --host 127.0.0.1`.
   Expected: startup succeeds without requiring a repo-local `dam-hopper.toml`.

3. Browse and read files in each project, then create or edit a file inside each root.
   Expected: list/read/write operations work inside the selected project and do not bleed across roots.

4. Create a terminal session for each project without passing `cwd`.
   Expected: each terminal starts in the selected project root.

5. Attempt a traversal or sibling-project read such as `/api/fs/read?project=alpha&path=../beta/owned.txt`.
   Expected: the server returns `403 FORBIDDEN`. Also verify rejection for a raw absolute path outside the configured root and for any symlink that resolves outside the selected project.

6. On Windows, change one project path to a mixed-separator absolute path and, if supported in your environment, a `\\?\` verbatim path.
   Expected: the registry still loads, the project remains accessible, and TOML writes preserve absolute paths instead of forcing them relative.

7. On Windows or in any environment with a reachable network share, add a temporary UNC-style project entry such as `path = "\\\\server\\share\\project"`.
   Expected: the registry either works for that project in your environment or fails in a clear, local way that you can document before rollout. Do not assume UNC behavior from Linux CI alone.

## Troubleshooting Configuration

### Registry or project path not found

Error: `Workspace directory does not exist` or missing project path errors

Check:

1. Registry path exists: `ls ~/.config/dam-hopper/dam-hopper.toml`
2. Each `projects[].path` exists
3. Relative project paths are resolved from the registry file directory
4. User has read permissions

### Project not discovered

Error: `Project not found: {name}`

Verify in dam-hopper.toml:

1. Project name is correct
2. Project path exists relative to the registry file directory or is an absolute path
3. Project type matches actual structure

```bash
ls -la /configured/project/path
```

### Token issues

Regenerate token:

```bash
cargo run -- --config /path/to/dam-hopper.toml --new-token
cat ~/.config/dam-hopper/server-token
```

Include in Authorization header for all requests.

## Example: Multi-Project Workspace

```toml
[workspace]
name = "web-app-monorepo"

[[projects]]
name = "backend"
path = "./services/backend"
type = "cargo"
env_file = ".env.backend"
tags = ["api", "critical"]

[[projects]]
name = "frontend"
path = "./packages/frontend"
type = "pnpm"
tags = ["ui"]

[[projects]]
name = "mobile"
path = "./apps/mobile"
type = "custom"
build_command = "flutter build apk"
run_command = "flutter run"
tags = ["ios", "android"]

[[projects]]
name = "docs"
path = "./docs"
type = "custom"
build_command = "yarn build"
run_command = "yarn start"

[agent_store]
path = ".dam-hopper/agent-store"
```

Start server:

```bash
dam-hopper-server --config ~/.config/dam-hopper/dam-hopper.toml --port 4800
```

All four projects now accessible via `/api/projects` and `/api/fs/list?project=frontend&path=src`, etc.
