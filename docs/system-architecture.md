# System Architecture

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Browser / Native WebView                                    │
│  ├─ Thin Vite host (apps/web/dist/)                        │
│  ├─ Tauri native host (apps/native)                        │
│  ├─ Shared React UI package (packages/ui)                  │
│  ├─ Shared runtime utilities (packages/shared)             │
│  ├─ Cooperative browser-debug preview + picker             │
│  ├─ fetch(/api/*) for REST queries                         │
│  └─ WebSocket(/ws) for terminal I/O + events               │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP/WebSocket
┌──────────────────────▼──────────────────────────────────────┐
│  dam-hopper-server (API :4801 systemd; :4800 direct/legacy)   │
├─────────────────────────────────────────────────────────────┤
│  ┌─ AppState (shared across all handlers)                  │
│  │  ├─ workspace_dir: Arc<RwLock<PathBuf>>                │
│  │  ├─ config: Arc<RwLock<DamHopperConfig>>                  │
│  │  ├─ pty_manager: PtySessionManager                     │
│  │  ├─ port_forward_manager: Option<PortForwardManager>   │
│  │  ├─ agent_store: Arc<AgentStoreService>                │
│  │  ├─ event_sink: BroadcastEventSink                     │
│  │  ├─ fs: FsSubsystem                                    │
│  │  ├─ media_tickets: MediaTicketStore (shared lifecycle)  │
│  │  ├─ video_stream_tickets: VideoStreamTicketStore       │
│  │  ├─ image_stream_tickets: ImageStreamTicketStore       │
│  │  ├─ ssh_creds: Arc<RwLock<Option<...>>>               │
│  │  ├─ auth_token: Arc<String>                            │
│  ├─ opaque_server_setup: Arc<ServerSetup<...>>            │
│  ├─ opaque_registrations: OpaqueRegistrations (in-mem)   │
│  ├─ Router                                                 │
│  │  ├─ /api/projects → ProjectList handler                │
│  │  ├─ /api/pty/* → PTY spawn/send/kill                   │
│  │  ├─ /api/ports → Port detection list                   │
│  │  ├─ /api/git/* → Clone/push/status/branch/root ops     │
│  │  ├─ /api/fs/* → [conditional] List/read/stat (per-proj)│
│  │  ├─ /api/fs/video/* → Ticket issuance/stream/revoke     │
│  │  ├─ /api/fs/image/* → Preview ticket/stream/revoke     │
│  │  ├─ /api/agent-store/* → Distribution/import           │
│  │  ├─ /api/workspace/* → Config switching                │
│  │  ├─ /api/usage/* → Codex OTel usage (opt-in)           │
│  │  ├─ /api/browser-debug/* → Ephemeral artifacts         │
│  │  └─ /ws → WebSocket upgrade                            │
│  └─ Services                                               │
│     ├─ PtySessionManager (Arc<Mutex<Map<uuid, ...>>>)     │
│     ├─ TelemetryStore/Worker (opt-in, separate SQLite)     │
│     ├─ BrowserDebugArtifactManager (ephemeral, TTL/sweep)  │
│     ├─ FsSubsystem (Arc<Mutex<ProjectSandbox>>)           │
│     ├─ AgentStoreService (symlink distribution)           │
│     ├─ CommandRegistry (BM25 search)                      │
│     └─ Broadcast channels (PTY output, git progress)      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  dam-hopper-web (Rust/Axum; dedicated static host :4802)    │
├─────────────────────────────────────────────────────────────┤
│  immutable web root · runtime-config/health · GET/HEAD only  │
└─────────────────────────────────────────────────────────────┘
```

The overview names both launch modes and the two server processes. The systemd
deployment uses `0.0.0.0:4801` for the API; the host firewall and Tailscale ACLs
must restrict that wildcard listener. The dedicated `dam-hopper-web` process
serves the immutable frontend root and runtime metadata on `:4802`.

`dam-hopper-server` is API-only by default. Docker opts into same-process
combined serving with an explicit `--web-dir`; direct and systemd API launches
do not silently serve frontend assets. The existing `4800` nohup service is a
legacy launch outside this deployment and is not touched by its installer,
validation, or rollback. Manifest v1 activation is coordinated by the
`dam-hopper` manager: `dam-hopper-recovery.service` reconciles durable state
before the API and web units are allowed to start.

The manager's activation boundary is intentionally explicit. `install` and
`role set` stage a candidate and stop at `PENDING`; the unified `dam-hopper
start` command performs activation or starts/verifies the recorded committed
role when no candidate is pending.

### Host resource monitoring and remediation (planned)

Host resources remains a host-context feature, not a project-sandbox feature. The
existing `HostMetricsSampler` will evolve into one shared `HostResourceMonitor`
owned by `AppState`. It periodically reads available Linux procfs, PSI, cgroup,
process, and mount signals, keeps a bounded in-memory sample/alert window, and
serves both the protected snapshot API and background alert events. The UI must
not create a second sampler for each open popover.

The monitor is descriptive and degrades per signal:

- `/proc/meminfo`, PSI, cgroup v2, process RSS/PSS, and mount observations are
  parsed directly; shell utilities are not part of the observation path.
- Missing files, unsupported kernels, namespaces, and permission failures become
  explicit availability states, not whole-request failures.
- `MemAvailable` and sustained PSI are primary alert inputs. Cache/slab/anon,
  swap, process, cgroup, and mount values explain the state; high cache alone is
  not an incident.
- Exact page-cache bytes for an arbitrary mount are not promised. Mount identity,
  filesystem/access context, and any estimate carry an uncertainty label.

Privileged actions use a separate host-local fixed-action helper. The DamHopper
server never accepts an arbitrary command, shell string, executable path, or host
password from the browser. The helper is reachable only through restricted local
IPC and accepts typed operations such as `drop-clean-caches` and
`terminate-same-user-pid`. Every request requires fresh single-use DamHopper
re-authentication plus explicit confirmation, then the helper revalidates target
identity and records a sanitized audit event.

The v1 action boundary is intentionally narrow:

- cache dropping is an explicit diagnostic operation with before/after samples;
- process control is same-user graceful `SIGTERM` only, with PID start-time and
  UID revalidation;
- root-owned/other-user processes are visible but not killable;
- no automatic cache dropping, process killing, service/container control, or
  generic root shell is allowed.

The helper may integrate with polkit when a host authentication agent exists, but
headless/remote hosts must use an explicit host enrollment path and fail closed
when the helper is unavailable. This preserves the distinction between web-app
authentication and OS privilege.

## Module Breakdown

### Browser debug artifacts (Phase 2; Phase 6 hardened)

The authenticated `/api/browser-debug/artifacts` routes provide ephemeral handoff storage for browser-debug tooling. `BrowserDebugArtifactManager` keeps metadata in memory and writes generated JSON/PNG paths beneath a temporary root; it exposes create, one-shot PNG upload, and delete only—there is intentionally no read/list route. Create accepts a live `terminalId` plus validated `selection` JSON (64 KiB request cap). PNG upload requires `image/png`, is capped at 4 MiB, and performs structural plus decoded-image verification before writing. Artifacts expire after 10 minutes, a 60-second sweeper removes expired files, and shutdown cleanup removes the root.

### linux_release/ (Phases 01–06: publisher, manifest, acquisition, staging, activation, and recovery)

`server/src/linux_release/` owns the strict Fedora 44 x86_64 systemd release
profile and its manager. The module remains deliberately split so
security-sensitive boundaries stay reviewable:

- `constants.rs`, `version.rs`, `manifest.rs`, `inventory.rs`, and the private
  inventory/manifest validation modules enforce the Manifest v1 wire contract,
  SemVer/tag identity, role projections, normalized paths, required assets,
  modes, and runtime-file exclusions.
- `cli.rs` defines `fetch`, `install`, `role set`, `start`, `status`,
  `rollback`, `recover`, `validate`, and `version`; `privilege.rs` enforces the
  EUID matrix. The binary at `server/src/bin/dam-hopper.rs` only parses,
  preflights, dispatches, and reports outcomes.
- `platform.rs`, `origin.rs`, and `host_config.rs` gate Fedora 44, x86_64,
  glibc/systemd requirements, exact browser origins, and recorded/public role
  configuration.
- `acquire.rs`, `acquire_client.rs`, and `attestation.rs` keep network work
  unprivileged, bound HTTPS redirects/deadlines/response sizes, require the
  archive SHA-256 to match the manifest, and optionally invoke `gh` for
  repository-bound attestation checks.
- `archive.rs` and `archive_extract.rs` inspect gzip/tar entries against the
  exact manifest inventory, reject links/special files/path or metadata drift,
  and extract only the selected role's new files.
- `unit.rs`, `unit_parser.rs`, and `unit_policy.rs` render the allowlisted
  release-root/version/public-config/origin placeholders, parse the result,
  and enforce independent API/web systemd contracts. `stage_units.rs` writes
  selected units, the recovery unit, web sysusers, and pending public config;
  `systemd.rs` invokes systemd tools without a shell.
- `account.rs`, `ownership.rs`, `process.rs`, and `process_holders.rs` validate
  the dedicated web account, release/state modes, process identity/executable/
  cgroup, listener evidence, and SQLite holder safety. `health.rs` performs
  exact service, process, listener, and JSON health probes.
- `layout.rs`, `lock.rs`, `stage.rs`, and `stage_transaction.rs` define the
  `/opt`, `/etc`, `/var/lib`, and `/run/lock` paths, nonblocking deployment
  lock, root-private transaction stage, role resolution, rendered-unit
  candidates, and fsync-backed pending handoff.
- `durable_fs.rs`, `state.rs`, `state_record.rs`, `journal.rs`, `transaction.rs`,
  and `systemd_backup.rs` persist the generation-numbered state envelope,
  validate phase transitions, hold transaction backups, and make filesystem
  updates crash durable.
- `activate_preflight.rs`, `activate.rs`, `rollback.rs`, `recovery.rs`, and
  `retention.rs` implement the lock-scoped cutover, health gate, automatic and
  manual rollback, boot reconciliation, and fail-closed retention.

Install and role change validate inputs and construct a role view under
`/opt/dam-hopper/.staging/<transaction-id>` before renaming it to
`/opt/dam-hopper/releases/<tag>/<role>`. They then render a pending candidate
under `/var/lib/dam-hopper-manager/`; no active release changes until the
explicit `dam-hopper start` command.

#### Durable activation state machine

The authoritative state envelope is
`/var/lib/dam-hopper-manager/state.json`; it records generation, active and
previous known-good releases, pending candidate, transaction phase, hashes,
and the latest failure. The `/opt/dam-hopper/current` symlink is a repaired
convenience pointer, not the source of truth. Valid forward activation is:

`ABSENT | ACTIVE → STAGED → PENDING → QUIESCED → SWITCHED → PROBING → COMMITTED`

`start` takes the deployment lock, validates old and candidate state, quiesces
selected old units and proves cgroups/listeners/SQLite holders are clear,
installs candidate units/configuration, daemon-reloads, starts the selected
units, and enters `PROBING`. Each candidate must become active with the
expected MainPID, executable, identity, listener, and exact JSON health
contract. Initial readiness has a 20-second deadline, followed by 20
consecutive probes at 500 ms (a 10-second stability window). Any transient
probe failure resets the window; identity, listener, or contract mismatches
fail the transaction.

After the full window, the manager enables selected units, disables removed
units, atomically records `active`/`previous`, clears `pending` and the
transaction, repairs `current`, and garbage-collects only unreferenced,
verified release trees. State writes use a same-directory temporary file,
write/sync, rename, and parent-directory sync.

#### Recovery and rollback

`dam-hopper-recovery.service` is a root oneshot unit ordered after local
filesystems and before `dam-hopper-api.service` and
`dam-hopper-web.service`. It runs `dam-hopper recover --boot`, classifies the
durable phase, and blocks inconsistent or unowned state instead of guessing.
`STAGED`/`PENDING` leaves the old active release in place; `QUIESCED`,
`SWITCHED`, and `PROBING` restore the previous release (or the first-install
baseline); `COMMITTED` repairs pointers and enablement without rolling back
the version.

Candidate failure automatically stops the candidate and restores the recorded
previous units, configuration, and state through the same health gate. First
install failure leaves all application units stopped/disabled and no active
release. Manual `rollback` promotes the recorded previous release through the
same transaction rules; restoration failure is `RECOVERY_REQUIRED`, and
retention deletes only verified, unreferenced trees.

The module is exported from `server/src/lib.rs` for the manager and integration
tests. The publisher schema remains at
`deploy/release/release-manifest.schema.json`; Rust cross-field validation is
authoritative. See [Linux Release Manager](./linux-release-manager.md) for the
CLI grammar, paths, and transaction flow, and the systemd section below for
the role/ownership contracts.

### Central publisher and bootstrap (Phase 06)

The producer boundary is `.github/workflows/release-linux.yml`, not the runtime
manager. Metadata validation fans out to Rust and web builds, then one package
job assembles the archive twice and compares SHA-256 values before generating
the external manifest, SPDX SBOM, and bootstrap. An attestation job covers all
four final assets; only the environment-gated publish job has `contents: write`.
The desktop workflow uses `desktop-v*` and cannot own stable `vX.Y.Z` releases.

`deploy/release/build-release-archive.sh` is a fixed-input archive assembler;
`generate-release-manifest.mjs` hashes and inventories its final bytes;
`check-release-assets.mjs` enforces exact local and draft-release asset sets.
`dam-hopper-install.sh` downloads as the caller, verifies archive integrity
(and optional manifest/archive attestations), extracts only the manager, and
stages through `sudo`; activation remains `sudo dam-hopper start`. See [Linux
Release Publisher and Bootstrap](./linux-release-publisher-bootstrap.md) for
the concrete DAG, artifact names, and known workflow boundaries.

### web_host/ (Phase 03: dedicated static host)

`server/src/web_host/` is a separate Axum application for immutable release
frontend assets. `server/src/bin/dam-hopper-web.rs` is a thin launcher that
requires a validated `--root` (or `DAM_HOPPER_WEB_ROOT`), defaults to
`0.0.0.0:4802`, and does not construct API `AppState` or write API state.

- `mod.rs` validates the root and optional runtime-config path, then builds the
  host state and listener.
- `router.rs` reserves `GET /__dam-hopper/health` and
  `GET /__dam-hopper/runtime-config.json` before the safe static fallback.
  Static requests are GET/HEAD only; reserved paths never become asset paths.
- `safe_path.rs` rejects traversal, encoded separators, symlink components,
  directories, and unsafe SPA fallback candidates.
- `cache_policy.rs` gives no-store to runtime metadata, no-cache to root/index,
  immutable one-year caching to Vite content-hashed assets, and one-hour public
  caching to other assets.
- `runtime_config.rs` validates the bounded 4 KiB schema, release SemVer, UUID
  v4 profile ID, and exact HTTP(S) API origin. Health payloads identify the
  `web` role without exposing filesystem details.

The browser fetches runtime config from the relative web-host endpoint before
creating a transport. It keeps an active user profile ahead of the managed
deployed-server profile, clears a managed token when its URL changes, and fails
closed to an idle transport when config is missing or invalid.

### config/

Handles registry loading, legacy discovery fallback, and feature flags.

**Key types:**

- `DamHopperConfig` — parsed project registry
- `ProjectConfig` — individual project settings

**Registry and sandbox semantics:**

- Canonical registry path is `~/.config/dam-hopper/dam-hopper.toml`, with `--config` and `DAM_HOPPER_CONFIG` as explicit overrides
- Relative `projects[].path` values resolve against the loaded registry file directory; absolute paths are preserved
- File API security is enforced by per-project roots in `ProjectSandbox`, not by `workspace_dir`
- Example: with a registry at `~/.config/dam-hopper/dam-hopper.toml`, `path = "./apps/web"` resolves to `~/.config/dam-hopper/apps/web`, while `path = "D:\\repos\\api"` stays `D:\repos\api` on Windows

**Path resolution priority:**

1. `--config` CLI flag or `DAM_HOPPER_CONFIG` env var
2. `--workspace` CLI flag or `DAM_HOPPER_WORKSPACE` env var
3. `~/.config/dam-hopper/dam-hopper.toml` global registry path
4. `~/.config/dam-hopper/config.toml` `defaults.workspace`
5. Current working directory via legacy upward `dam-hopper.toml` discovery
6. Empty config fallback

### Project worktree targets (Phase 07 target lifecycle)

A configured project remains the stable authorization, configuration, and
top-bar identity. A Git worktree is an optional execution target beneath that
project; selecting one does not rewrite `ProjectConfig.path`, switch the active
project, or create a synthetic project. Root-sensitive operations carry an
explicit target reference:

```text
ProjectTargetRef {
  project: string,
  worktreePath?: string  // absent means the configured project root
}
```

The browser keeps one selected target per project in session memory. Restarting
the browser therefore selects the configured root again. The selector discovers
registered worktrees on mount and supports an explicit refresh; discovery rows
may come from the bounded server cache, but the cache is never an authorization
decision. The server does not hold a global "active worktree" because requests,
watchers, media tickets, editor state, and terminal sessions for several targets
may coexist.

```mermaid
flowchart LR
    Selector["Project panel worktree selector"] --> TargetStore["Session target store"]
    TargetStore --> Panels["Explorer, Search, Git, Editor, Terminal"]
    Panels --> Transport["REST and WebSocket target reference"]
    Transport --> Resolver["Project target resolver"]
    Resolver --> Registry["Configured project root"]
    Resolver --> Worktrees["git worktree list --porcelain"]
    Resolver --> Sandbox["Target-aware filesystem sandbox"]
    Sandbox --> Files["Files and watchers"]
    Resolver --> GitOps["Git operations"]
    Resolver --> Pty["PTY cwd, target metadata, and restore"]
    Resolver --> Media["Target-bound media tickets"]
```

The resolver is authoritative. For a root target it returns the canonical
configured path. For a worktree target it canonicalizes the request and accepts
it only if a fresh Git snapshot reports that path as a registered worktree of the
configured repository, then rechecks that the projected target directory is
live and usable. An existing arbitrary sibling directory, a worktree belonging
to a different repository, and a missing/prunable worktree are not valid targets
for new operations. Discovery uses a short-lived bounded cache for UI listing;
add, remove, prune, explicit refresh, and project-configuration reload
invalidate the relevant discovery entry. A failed discovery leaves existing UI
rows visible with a stale-data warning and offers retry.

App-initiated removal re-fetches discovery immediately before checking
exact-target ownership, refuses dirty editor tabs or live terminal sessions,
and only reconciles the target store after Git confirms success. Git's
dirty/untracked guard remains authoritative and is never bypassed by this UI
check. When a registered target disappears externally, the selector keeps its
row as unavailable, records the path in the target store, and routes
subsequent new operations to the configured root. Existing editor tabs are
retained and live terminal sessions with matching immutable `worktreePath`
metadata are marked orphaned. Legacy sessions without that marker fall back to
project/cwd containment.

`ProjectSandbox` evolves from one root per project to validation by project and
resolved target root. This changes the set of approved roots, not the traversal
rules: canonical containment, symlink, write, upload, and encrypted-write checks
remain in force. File watcher subscription keys and media tickets include target
identity so concurrent roots cannot overwrite or authorize one another.
Ordinary shared-state locks are not held while invoking Git or awaiting
filesystem work. The workspace lifecycle guard is the deliberate exception: it
spans fresh target validation, PTY creation, restore, respawn, and worktree
removal so those ownership decisions cannot race.

Frontend caches use `(project, targetKey, ...)`. Editor tab keys use
`(project, targetKey, path)` and persisted legacy tabs migrate to the configured
root. Terminal command/profile IDs use a stable opaque target discriminator;
canonical paths remain structured state rather than being embedded verbatim
into display IDs. Current `terminal:create` requests carry an optional
`worktreePath`; the server validates and canonicalizes the registered target,
constrains cwd to that target, and persists the target marker with the session
for reconnect, restore, and removal ownership checks. Legacy sessions without
the marker use project/cwd metadata for orphan detection. The Git panel's
existing nested-repo `root` remains a separate axis after the project target;
it is not reused as the worktree selector.

```mermaid
stateDiagram-v2
    [*] --> ConfiguredRoot
    ConfiguredRoot --> WorktreeSelected: select registered worktree
    WorktreeSelected --> ConfiguredRoot: select root
    WorktreeSelected --> TargetUnavailable: path removed or prunable
    TargetUnavailable --> ConfiguredRoot: fallback for new operations
    TargetUnavailable --> OrphanResources: preserve dirty tabs and live terminals
    OrphanResources --> [*]: resources closed explicitly
```

Removing a worktree through DamHopper is blocked while it has dirty editor tabs
or live terminals; Git's own dirty-worktree protection remains the final disk
safety check. If the selected worktree disappears externally or becomes
unavailable during discovery, the session store records the unavailable target,
falls back to the configured root for new operations, and exposes a notice.
Dirty tabs retain their target identity with an unavailable warning, while
existing terminal processes remain at their original cwd until the user closes
them. It never silently discards editor data or moves a running process.

The selected target is propagated with each root-sensitive REST and WebSocket
request rather than inferred from global UI state. File, search, Git, editor,
terminal, watcher, and media paths resolve through the same project/target
contract; workspace-scoped operations that do not support a worktree reject an
unexpected `worktreePath`. Target-aware cache keys prevent results from one
worktree replacing another, and legacy requests without `worktreePath` continue
to address the configured project root. Target-scoped terminal create failures
and respawn validation failures reconcile the exact target through the terminal
target-unavailable event when fresh validation confirms target loss. Ordinary
PTY and cwd failures remain local errors. This preserves the session's
immutable target identity while routing subsequent new operations to the
configured root.

### shared/

Dependency-free runtime helpers shared by browser packages.

- `logger.ts` centralizes `configureLogger`, `getLoggerConfig`, `resolveLogLevel`, and `logger.debug/info/warn/error`
- Phase 01 adds `addLoggerSink()` fanout. The primary sink stays in place, and extra sinks are isolated so one sink failure cannot break the app path
- Sensitive metadata is redacted recursively before sink delivery by default
- Web bootstrap reads the desired log level from Vite env and falls back to `debug` in development or `warn` in production

### xterm agent notifications (Phase 2)

Pure frontend notification pipeline in `packages/ui/src/lib/`:

- `agent-command-recognizer.ts` identifies tracked agent commands from terminal input
- `agent-activity-tracker.ts` turns submitted command, output, user input, and enhanced exit events into activity state changes
- `terminal-notification-signal-parser.ts` converts BEL and OSC 9/777/99 terminal signals into normalized notification events
- `terminal-notifications.ts` keeps a bounded, memory-only notification history and transient toast IDs in Zustand
- `terminal-notification-sound.ts` reuses one Web Audio context to synthesize the built-in `default`, `soft`, `two-tone`, and `urgent` in-app chimes at the persisted volume. `default` preserves the existing single-chime behavior for compatible configurations; sound has no effect on native browser popups and requires no audio assets or dependencies. Unavailable or blocked audio is a silent no-op.
- `browser-notification-service.ts` applies permission, rate-limit, and delivery guards before creating `Notification` objects. Web builds use the browser API; native Tauri v2 builds use the compatible shim supplied by `tauri-plugin-notification`
- `TerminalNotificationCenter` and `TerminalNotificationToastViewport` render the shared in-app bell/feed and top-right live alerts

On terminal attach or reconnect, notification delivery is marked replay-active before
the retained buffer is written and remains suppressed until xterm invokes that write's
completion callback. Live chunks queue during that interval, so historical OSC 9
signals cannot alert while an identical signal received after replay completion can.

Runtime delivery is UI-driven, while its preferences use the server-backed global UI-config persistence path. The shared service uses the standard `Notification` contract: web builds use browser notifications, while native Tauri v2 registers `tauri-plugin-notification`, whose injected shim routes permission and delivery through the native plugin. The native default capability grants only permission-state, permission-request, and notify commands. Native OS popups do not expose the browser event object used by the shared click binding, so in-app toast/history remain the interactive paths. On Windows, native popup delivery requires an installed/bundled app identity and is not a reliable end-to-end check in `tauri dev`. The API uses camelCase and global TOML uses snake_case: the master `terminalCodexNotificationsEnabled` / `terminal_codex_notifications_enabled` defaults to off, while toast, browser-popup, and sound preferences default to on, volume defaults to `100`, and the sound pattern defaults to `"default"`. Valid patterns are `"default"`, `"soft"`, `"two-tone"`, and `"urgent"`; invalid values are rejected during config deserialization. The master is the OSC 9 capture gate and the only setting that synchronizes Codex TUI configuration. While it is on, history is always recorded; toast, browser-popup, and chime delivery have independent child gates. Child delivery and sound preference updates do not modify `~/.codex/config.toml`. It is covered by unit tests around parsing, recognition, tracking, notification gating, callback-gated replay suppression, restart suppression, and cleanup behavior, plus a Chromium regression test that verifies queued live chunks resume only after retained replay completes.

Phase 03 adds the delivery controls to the shared UI package:

- `TerminalAgentNotificationSettings` exposes the master, **In-app toast**, and **Browser popup** switches; `TerminalNotificationSoundControls` exposes the Sound switch, fixed Sound style selector, Volume slider, and user-activated **Play sound** button
- `AgentCommandPatternEditor` lets users add literal aliases such as `CODEXNSB` or custom regex matches without editing config files by hand
- browser permission state is read from the runtime `Notification` API and is never persisted into server config; only the explicit request button can request it, while preview plays Web Audio only. In native Tauri v2, that runtime API is provided by the notification plugin shim
- diagnostics for unsupported/default/denied/rate-limited/factory-error paths are emitted as frontend `custom` events under scope `terminal-agent-notifications`
- the Codex notification setting gates event capture and child controls, but does not reset saved child choices; toast off still retains bell/feed history, and the Sound switch/style/volume gate only the best-effort chime. Browser popup delivery additionally requires runtime native permission, so browser permission denial or lack of support does not affect the in-app bell/feed
- in-app history is session-memory only, capped at 50 records; at most three toast alerts are shown and each expires after six seconds

Notification scope remains xterm-only. DamHopper does not watch external terminals, OS process tables, or implement a separate native notification daemon for this feature.

### inline terminal suggestions

Automatic suggestions and history capture remain fail-closed until the server verifies
a shell lifecycle for the current PTY incarnation. On Unix, the server supports launch-only
local interactive zsh, fish, and Bash adapters; every other command or shell remains unsupported.
Terminal and outgoing PTY bytes are passive: the feature
never infers command boundaries from Enter, output silence, replayed scrollback, or
arbitrary input. Command history is browser-local and users can clear it or disable
future persistence from Settings.

Supported adapters emit OSC 633-compatible `A`/`B`/`E`/`C`/`D` markers carrying a
fresh, per-incarnation nonce. `ShellLifecycle` is a bounded (8 KiB) streaming parser:
it accepts BEL or ST terminators and validates marker order, nonce, and the base64url
command payload in `E`. Bash uses normalized `BASH_COMMAND` text for simple commands
and emits no submission marker for ambiguous syntax. The nonce exists only in the child
environment and lifecycle observer; it is never persisted or sent to clients. Valid private markers are stripped
from live output and scrollback, while malformed, invalid, or oversized markers remain
visible verbatim and reset trust.

The server broadcasts only typed `terminal:lifecycle` events (`editing`, `submitted`
with the exact command, `opaque`, or `unverified`) and an opaque generation number.
It resets lifecycle trust on a terminal attach/replay, invalid marker or transition,
alternate-buffer entry, and a new PTY incarnation. No lifecycle event establishes
trust for unsupported shells.

Phase 02 storage hardening now includes deterministic exclusive staging-file replacement race
validation, canonical decoded SHA-256 fingerprint validation, and forced-process crash/restart
replacement recovery with idempotent purge. Phase 03+ delivery and release evidence remains
pending; Linux, macOS, iOS, and Windows-agent/platform support remain deferred. These proofs do
not claim v1 release readiness or that all safeguards above are complete.

```mermaid
stateDiagram-v2
  [*] --> Unverified
  Unverified --> PromptStart : valid A and nonce
  PromptStart --> Editing : valid B
  Editing --> Submitted : valid E with nonce and exact command
  Submitted --> Opaque : valid C
  Opaque --> Finished : valid D
  Finished --> PromptStart : next valid A
  PromptStart --> Unverified : invalid or stale marker
  Editing --> Unverified : attach/replay, respawn, or alternate buffer
  Submitted --> Unverified : invalid transition
  Opaque --> Unverified : invalid transition
```

The security boundary is that only `Editing` may query or show a passive suggestion. `E` supplies
the exact submitted command; `C` closes editing before command output or password/REPL/
TUI input. Browser-local history commits only from a current-generation, server-validated
`submitted` lifecycle event carrying that exact `E` command. Outgoing PTY bytes, Enter,
terminal silence, and replayed scrollback never establish a history boundary.
The Bash adapter preserves scalar and array `PROMPT_COMMAND` hooks and disables itself when
an existing `DEBUG` trap would make command capture ambiguous. Bash commands containing
compound, multiline, substitution, or redirection syntax also fail closed rather than
submitting an approximation. Nonce validation limits accidental or child-process marker spoofing; it is not isolation
against malicious same-user code, so invalid sequences always reset to `Unverified`.

Phase 03 implements a per-session, client-only suggestion controller with immutable
snapshots and monotonic prompt epochs and input revisions. Each lifecycle, input, output,
replay, or composition transition synchronously invalidates outstanding searches. A result
can enter a `ghost` snapshot only when its session, epoch, revision, exact raw input, verified
editing lifecycle, and byte-exact true-prefix relation still match. Phase 04 renders only the
remaining suffix of that snapshot; it never redraws or replaces the typed prefix.

The controller accepts only one printable grapheme as an append while a verified prompt is
clean. Control sequences, Enter, cursor edits, completion, multi-grapheme/paste input, IME
composition, terminal output, reconnect/replay, and buffer ambiguity fail closed to `opaque`
or `unverified`. The terminal adapter remains passive except for three explicit desktop
shortcuts: `Alt+Right` accepts the full remaining verified suffix, `Alt+Shift+Right` accepts
its next token, and `Ctrl+Alt+H` opens the explicit history workflow when enabled. Acceptance
atomically clears the ghost before writing the suffix once through the normal PTY path; it never
sends Ctrl+U, the existing prefix, or Enter. Every other xterm key and input byte—including Tab,
Enter, Escape, Ctrl+R, paste, and TUI input—continues unchanged. Coarse-pointer and
native-keyboard-suppressed surfaces disable automatic ghost and history-shortcut behavior.
Fuzzy/non-prefix results remain for an explicitly focused accessible list rather than passive
completion.

History v2 is browser-local under `dam-hopper:command-history` as `{ version: 2, entries }`.
Each entry retains an exact raw command, a stable v2 id, last-used timestamp, total use count,
current project, and a per-project usage map. Its NFKC-lowercased `searchText` and Unicode
word tokens are derived search fields only; they never reconstruct or alter the raw command.
The shared ranking puts byte-exact raw prefixes ahead of normalized token-prefix matches, then
uses recency and usage as tie-breaking signals. Legacy records are normalized in memory and
are not rewritten until a later verified command write. Disabled or inaccessible local storage
fails closed, and the Settings controls can stop future writes or clear stored history.

The server preserves ordering at the prompt boundary: visible PTY output is emitted before its
pending `editing` lifecycle snapshot. A marker-only chunk cannot flush `editing`; it waits for
visible prompt output (or a previously established visible boundary). This prevents the client
from treating an unseen prompt marker as a usable editing surface.

Cursor placement is isolated behind one fail-closed geometry adapter. It measures the
xterm textarea relative to the current terminal host and has one validated screen-grid fallback.
It recomputes once per animation frame on cursor/output/resize/scroll/zoom/font changes; the
terminal host attachment invalidates it after reparenting. Detached hosts, alternate buffers,
scrollback, invalid rectangles, and out-of-bounds measurements hide the ghost rather than guess.
The visual suffix is `aria-hidden`, unfocusable, pointer-inert, single-line, and clipped/faded at
the available terminal width. Proposed xterm decoration APIs are not a default dependency;
adopting them requires a renderer/reflow spike and pinned compatibility.

The explicit history path is a focus-managed dialog, never a passive preselected menu. It searches
browser-local entries and exposes full command text with Copy and Use actions. Use writes only a
single-line command to the current PTY without Enter; a multi-line entry stays visible but is
copy-only. The dialog and ghost consume only immutable controller snapshots and do not record
history, alter lifecycle trust, or add terminal protocol messages.

History stores exact raw commands separately from normalized search fields, remains
local-only, and provides clear/disable controls. Desktop is the first support boundary;
mobile direct-write paths remain explicitly unsupported until all input routes share the
same controller.

### Codex OTel usage analytics

Usage is a Codex-only observability feature. Codex `response.completed` log records exported over
OTLP are the sole write source. PTY creation, input, output, shell integration, command lifecycle,
and restart paths perform no usage work and carry no usage correlation identifiers.

```mermaid
flowchart LR
  Codex[Codex OTel response events] --> Receiver[Authenticated loopback OTLP receiver]
  Receiver --> Normalize[Bounded allowlist normalizer]
  Normalize --> Queue[Codex-only bounded queue]
  Queue --> Worker[Dedicated SQLite writer]
  Worker --> DB[(telemetry.db)]
  DB --> API[Authenticated Codex usage API]
  API --> Usage[Codex Usage overview and sessions]
  API --> Settings[Codex usage settings and health]
  PTY[PTY and shell lifecycle] -. no telemetry dependency .-> Codex
```

The receiver binds to loopback only, requires the generated bearer secret, decodes only bounded
allowlisted fields, and queues normalized `CodexUsageEvent` values directly. The Codex usage
runtime owns queue admission, batching, retention, deletion, and shutdown. There is no generic
`TelemetrySink`, PTY capture snapshot, command classifier, terminal correlation registry, marker
injection, or output redactor in this dataflow. Collector or storage failure cannot affect terminal
latency or behavior.

Collector health preserves the aggregate `dropped` count and adds five fixed-cardinality,
in-memory reason counters: missing source identity, invalid timestamp, paused admission, full
queue, and unavailable worker. Normalization and enqueue outcomes increment exactly one reason
counter alongside the aggregate; the counters never include source versions, models, identifiers,
paths, errors, or payload content, and reset on process restart. The missing-identity field is
retained for health API compatibility and remains zero when the bounded fallback is active.
Queue-full and worker-unavailable outcomes retain retryable `503` responses, while normalization
and paused records retain their existing `202` behavior.

Codex CLI 0.146.1 emits token fields in `response.completed`, but its OTLP records provide no safe
per-event trace/span or provider event ID. When trace/span are absent, Usage derives a
domain-separated HMAC fallback from bounded decoded fields: source version and timestamp,
conversation/model identifiers, bounded token components, duration, and counter semantic. Raw
content, receipt time, conversation ID alone, and fabricated random IDs are never fallback keys.
Valid trace/span identity takes precedence over the fallback.
The fallback is stable for replay but can dedupe identical same-millisecond decoded events; this is
an explicit compatibility tradeoff, and those events remain `unverified`. Invalid timestamps still
fail closed. This is an ingestion-admission decision only: it makes no Codex event or SQLite schema
change.

Development invariant: remove the Usage middle layer from every PTY production path, including
constructor parameters, session options, restart/restore handoff, reader-loop state, environment
mutation, admission locks, and no-op abstractions. Do not retain a disabled Usage hook “for later.”
Codex usage may depend on the independent OTLP runtime; PTY production modules must not import or
call it. A negative production dependency scan and an enabled-versus-disabled PTY
latency/throughput comparison gate this refactor so future Usage work cannot silently reintroduce
terminal overhead.

The target store contains `codex_sessions`, `codex_usage_events`, `codex_daily_rollups`, and
`telemetry_health`. It retains keyed dedupe/session identifiers, bounded model/source/status fields,
response count and duration, nullable token components, and explicit quality only. The database is a
fresh v1 Codex-only store; it has no legacy-data migration or import. During development, startup
checks `user_version` and the complete allowlisted object definitions. If the configured telemetry
file is legacy, malformed, or otherwise not this target schema, the store performs a bounded,
transactional reset of that telemetry file's user tables/views/triggers/indexes and recreates the
fresh schema. A current schema is reopened without resetting its data.

The protected API exposes Codex totals, time/model buckets, bounded session summaries, receiver and
storage health, retention, and deletion controls. Shell, terminal, command, project, category,
agent, capture-quality, terminal-correlation, and inferred-lineage filters or fields do not exist in
the target contracts. The Usage page shows Codex token/response/session/duration trends and model
breakdowns. Settings contains one “Codex usage telemetry” setup surface. Neither UI surface mentions
terminal analytics; cost stays omitted until authoritative versioned pricing exists.

For an intentional clean reset, stop DamHopper and remove the effective
`server.telemetry.db_path` file plus its `-wal` and `-shm` sidecars. The default is
`~/.config/dam-hopper/telemetry.db`. The separate `sessions.db` must not be removed.
Runtime initialization also rejects configurations that resolve telemetry and session persistence to
the same database file.

#### Development reset boundary

Legacy combined telemetry data is intentionally unsupported during development. On startup,
`TelemetryStore` checks SQLite `user_version` and the object list/schema definitions; any non-v1 or
non-Codex database is cleared and recreated from the fresh schema, with no migration or data import.
The reset is scoped to the configured telemetry database and uses a single transaction; current
Codex v1 data survives a normal reopen. For a manual reset, stop DamHopper and remove
`telemetry.db` plus its `-wal` and `-shm` sidecars; `sessions.db` is unrelated and must remain intact.

#### Flat Codex session summaries

OTel remains authoritative for input, cached-input, output, and reasoning token components. The
runtime stores one privacy-safe flat summary per Codex session and never infers parent/child edges
from event order, model names, titles, or text. Direct reads from Codex SQLite or rollout files are
forbidden in production.

Idempotent upserts preserve summaries before detail purge. `delta` counters add; `cumulative`
counters accept only newer non-regressing observations, rejecting stale, conflicting, or regressing
updates as summary conflicts.

The protected API exposes cursor-bounded `GET /api/usage/sessions` and
`GET /api/usage/sessions/{id}` routes. List pages are capped at 100 rows (default 25) across a
maximum five-year range; cursors are authenticated and bound to the range and model filter. Each
session contains only a derived ID, timestamps, optional model data, bounded token components, and
bounded model summaries. Detail returns the same flat projection. Active sessions preserve a null
end timestamp while cursor ordering uses their start timestamp as the effective sort key. Terminal,
project, shell, capture-quality, category, agent, correlation, lineage, and raw-content fields are
not part of the contract.

Model identifiers are generalized rather than tied to a fixed model-name allowlist. They are
bounded to 1–64 safe ASCII characters, must start and end alphanumeric, and may contain `.`, `_`,
`-`, `/`, or `:`; URL-like values, repeated separators, and content-bearing forms are rejected
before storage or filtering.

Codex app-server metadata is intentionally outside this usage contract. OTel aggregate usage remains
the sole source for persisted Codex session summaries until a future, privacy-safe metadata
projection is separately specified.

Key invariants:

- Shell lifecycle validation remains the only command boundary.
- Telemetry persistence stays off the PTY hot path.
- Raw commands and AI content never cross the persistence boundary.
- Availability and paused state are reported explicitly; missing token components remain null.
- Codex telemetry adds no MCP call or model-token consumption.
- Metrics stay descriptive; no productivity or employee scoring.
- Session detail remains one compact Codex summary row bounded by detail retention; no permanent
  turn/event transcript.

Notification selection also stays frontend-only. Native notification clicks
publish a typed browser event keyed by the stable PTY `sessionId`;
`WorkspacePage` consumes it because that page owns workspace mode, compact
surface selection, terminal selection, and xterm focus orchestration. A click
preserves the current IDE/Terminal mode: desktop IDE mode opens its Terminal
bottom tool, while compact mode reveals the Terminal surface without toggling
the mode. Displayed
notification context uses `Project · Bash #N`, with the ordinal read from the
current 1-based open-terminal order; the original sanitized body keeps its own
payload allowance below that context line. Project names and terminal ordinals
are display only and are never used as navigation identity. Navigation requires
a mounted target that is explicitly alive, or a mounted and registered xterm
only when liveness is unknown. Explicitly dead, unmounted, and stale session
clicks no-op without changing server state, the WebSocket protocol, or persisted
terminal layout. Compact coarse-pointer layouts with the mobile custom keyboard
enabled still reveal and refit the exact session but suppress forced native
xterm focus so selection does not unexpectedly open the browser keyboard.

### frontend diagnostics (Phase 01)

The browser host now initializes a diagnostics client before React render. This creates a local-only ring buffer for client-side troubleshooting and keeps the capture path active from app startup onward.

**Host init flow:**

1. `apps/web/src/main.tsx` calls `initializeClientDiagnostics()` before `createRoot(...).render(...)`
2. `WsTransport` status changes are fed into the diagnostics client
3. `RouteDiagnostics` in `packages/ui/src/embed/dam-hopper-app.tsx` records route changes
4. `ErrorBoundary` records React render failures
5. Window `error` and `unhandledrejection` events are captured

**Stored signals:**

- shared logger entries via logger sink fanout
- browser runtime errors
- unhandled promise rejections
- React error boundary failures
- route changes
- WebSocket transport status changes

**Storage model:**

- persisted in `localStorage` under `damhopper_diagnostics_frontend_v1`
- bounded ring buffer, trimmed by time and entry count
- storage budget is capped at a small fixed size; oldest entries are dropped first when the cap is hit
- diagnostics stay best-effort if browser storage is blocked or full

Phase 01 is client-side only. It does not add a backend export endpoint yet.

### backend diagnostics store + export (Phases 02-04)

The server now keeps a local-only diagnostics store for backend events and exposes a protected export endpoint for debugging. Request/response payloads use camelCase on the wire.

**Storage model:**

- JSONL file under the config dir: `~/.config/dam-hopper/diagnostics/backend-log.jsonl`
- file mode is `0600` on Unix
- retention window is 60 minutes
- compaction keeps the newest in-window events and drops older ones
- storage is local only; there is no remote upload path

**Privacy model:**

- event message text and fields are redacted before persist
- redaction is best effort, not a hard privacy boundary
- export also returns the already-redacted backend events

**Export API:**

- `POST /api/diagnostics/export`
- protected by auth like other backend routes
- invoked by Settings > Maintenance > Export Diagnostics and terminal-title context menus in the UI
- workspace terminal exports use the shared terminal-panel time window and pass only the right-clicked session ID as `terminalIds`
- request accepts `frontend` and also the legacy `frontendSnapshot` alias
- response schema version is `1`
- top-level export sections:
  - `scope`
  - `manifest`
  - `frontend`
  - `backend`
  - `terminals`
  - `system`

**Scope fields:**

- `windowMinutes`
- `includeTerminalOutput`
- `terminalTailBytes`
- `terminalIds`
- UI defaults: 60-minute window, terminal tails included, `terminalTailBytes=65536`

**Manifest fields:**

- `backendEventCount`
- `terminalSessionCount`
- `retentionMinutes`
- `storage` = `localConfigJsonl`
- `droppedPersistEvents`
- `persistErrorCount`

**Terminal tails:**

- `terminals.sessions` includes detailed session snapshots
- `terminals.tails` includes capped per-session scrollback tails when `includeTerminalOutput=true`
- `terminalTailBytes` controls how much tail data is returned per session
- exported files use `dam-hopper-diagnostics-{timestamp}.json`
- terminal tails may still contain sensitive local/dev output even after best-effort redaction; exported bundles should be reviewed before sharing

### Cooperative browser debug preview

The browser host exposes a global Browser tool for controlled development
applications. V1 does not inspect arbitrary public pages. Supported preview
URLs may use an HTTP loopback origin or the origin of a `Ready` tunnel URL
returned by the connected server's `TunnelSessionManager`; paths, query
strings, and hashes remain inside that approved origin boundary.

The DamHopper Browser Debug extension injects a framework-neutral, dev-only
content script into the cross-origin iframe. The target application does not
install anything. The extension owns element highlighting, DOM/accessibility
extraction, path synchronization, and bounded console previews. Parent and extension communicate through a
versioned `postMessage` protocol with WindowProxy/source checks, a per-load
nonce, exact target/parent-origin checks, request IDs, schema validation, and
bounded payloads. Loopback parent origins are allowed for local development;
deployed parent origins are compiled into the extension from
`VITE_DAM_HOPPER_EXTENSION_PARENT_ORIGINS`. The target route must still permit
iframe embedding through its browser policy; DamHopper does not bypass
`X-Frame-Options` or restrictive CSP.

The native desktop controller enforces the approved origin boundary before
navigation and across redirects. The web iframe fallback can validate bridge
messages but cannot inspect a cross-origin iframe's final URL after an
external redirect. Such a redirect may remain visually rendered without
trusted bridge access or page inspection and is not a supported preview.

The web build packages the extension as
`/browser-debug-extension/dam-hopper-browser-debug.zip`. When the Browser
tool cannot complete the bridge handshake, it offers this download and directs
the client to extract it and use Chromium's `chrome://extensions` Developer
mode / Load unpacked flow. The target application remains unmodified; a normal
website cannot silently install a browser extension.

```mermaid
flowchart LR
    U[User opens Browser tool] --> A{Allowed origin?}
    A -->|No| X[Reject preview]
    A -->|Loopback or active tunnel| F[Controlled app iframe]
    F <--> B[Dev-only bridge]
    B --> S[Bounded DOM and ARIA selection]
    U --> C[Explicit share-current-tab gesture]
    C --> D{Capture available?}
    D -->|Yes| P[Crop selected iframe region]
    D -->|No or denied| M[DOM-only or manual image fallback]
    S --> R[Selection preview]
    P --> R
    M --> R
    R -->|Explicit attach| E[Authenticated bundle API]
    E --> T[Ephemeral JSON and PNG, mode 0600]
    T --> W[Insert generated paths into chosen PTY]
```

**Client state and UI rules:**

- `WorkspacePage` registers Browser beside existing tool definitions for IDE,
  terminal, and compact layouts without creating another PTY lifecycle.
- Native and web hosts expose `Responsive` and `Custom` Browser Debug viewport
  controls. Custom width and height are whole CSS-pixel values bounded to
  160–4096; the top-bar `+` probe and symmetric stepper buttons change both
  dimensions by 16px. Keyboard shortcuts are intentionally not part of this
  feature. The state is browser-local and platform-scoped. These controls do
  not resize the main window; main-window resizing is a separate native shell
  concern.
- A custom viewport stage may overflow and scroll. The native adapter and
  fallback iframe share a host path that remeasures the viewport and stage,
  preserves the complete requested frame for native bounds and clips only the
  visible intersection for the fallback iframe; stage scroll and resize
  changes trigger remeasurement.
- One `BrowserDebugKeepAliveHost` owns the iframe for the lifetime of
  `WorkspacePage`. The host keeps the iframe in one fixed overlay and moves
  that overlay off-screen when no Browser viewport is active; viewport
  geometry is recalculated on shell, resize, and compact-surface changes. Tool
  close, IDE/terminal switching, and compact surface changes do not recreate
  the iframe or its browsing context. Leaving Workspace, changing server
  profile, or changing the preview URL disposes it and invalidates the bridge
  nonce.
- Preview metadata is browser-local. Captured `MediaStream` objects are never
  persisted; closing the visible Browser panel stops all capture tracks for
  privacy even though the iframe stays alive in its off-screen overlay.
- `getDisplayMedia()` is invoked only from a user gesture. Current-tab and
  browser-surface options are hints, not silent permission or proof of the
  selected surface. Capture failure degrades to semantic metadata plus manual
  image upload.
- Page text renders only as React text. Input values, password/file controls,
  cookies, storage, auth data, event attributes, hidden surrounding DOM, and
  unbounded HTML are excluded.
- Captured content and artifact paths are excluded from frontend diagnostics.

**Artifact and terminal handoff rules:**

- `BrowserDebugArtifactManager` owns a server-instance temporary directory and
  an in-memory metadata map. Bundle files are random, mode `0600`, size-capped,
  TTL-bound, and removed on explicit discard, expiry sweep, and server shutdown.
- The protected browser-debug API accepts one bounded structured selection and
  optional cropped PNG. It never accepts a client-provided filesystem path.
- The create response includes the server-generated JSON path; an optional PNG
  path appears only after the PNG upload commits. The selected PTY must still
  be mounted/live and is addressed by stable `sessionId`.
- Terminal insertion contains generated paths and an untrusted-data warning,
  not raw page content. Strip CR/LF, C0/C1, ESC/CSI/OSC/DCS sequences; never
  append Enter or auto-submit.
- Browser-debug JSON/PNG data never enters diagnostic JSONL, diagnostic export,
  terminal replay, project roots, or the persistence database.

**Failure invariants:**

- iframe navigation invalidates the nonce and selection;
- a stopped/replaced tunnel immediately removes its origin from the allowlist;
- stale, dead, or unmounted terminal targets are safe no-ops;
- capture denial never blocks DOM-only inspection;
- disconnect/reconnect does not extend bundle TTL or expose bundles to a
  different server profile.

### apps/native

Tauri v2 native client that reuses the same `packages/ui` runtime as the web
host. It is a remote client only: it does not embed the Rust server as a
sidecar, does not rewrite PTY behavior in native code, and keeps Tauri
permissions to `core:default` plus the scoped `browser-debug` permission
granted to the `browser-debug-main` capability on the main window.

**Frontend host:**

- `apps/native/src/main.tsx` mirrors `apps/web/src/main.tsx`: configures the shared logger, initializes `WsTransport(getNativeServerUrl(), activeProfile.id)` when an active profile exists, otherwise installs an idle transport for the setup screen, creates the TanStack Query client, and mounts `DamHopperApp`.
- `apps/native/vite.config.ts` uses Tauri's fixed dev port `1420`, strict port mode, `TAURI_DEV_HOST` HMR support on port `1421`, and ignores `src-tauri` in Vite file watching.
- The shared `ServerProfileGuard` still controls startup. If no server profile exists, the native host installs an idle transport and opens the server setup dialog instead of relying on the packaged webview's same-origin URL.

**Tauri shell:**

- `apps/native/src-tauri` contains the default Tauri builder, the main window config, and the checked-in Android Studio project under `src-tauri/gen/android`.
- No filesystem, shell, opener, HTTP, or sidecar plugin permissions are granted in Phase 03. The native CSP allows local/profile HTTP and WebSocket connections but keeps default script execution to self.
- Native desktop dev uses `http://localhost:1420`. Android dev uses `tauri android dev --host`, which sets `TAURI_DEV_HOST` so the Vite dev server and HMR bind to the LAN-reachable address for an emulator or physical device. Packaged desktop webview requests can present `tauri://localhost`, `http://tauri.localhost`, or `https://tauri.localhost` depending on platform/webview. Windows native desktop may use separate-origin profiles through the existing browser transport when the backend has an exact `DAM_HOPPER_CORS_ORIGINS` entry; Android, iOS, and unsupported native hosts remain same-origin by policy. Separate web frontends also require an exact backend `DAM_HOPPER_CORS_ORIGINS` entry.

**Shared internal app layout zoom:**

- `packages/ui` owns the host-independent `AppZoomProvider` and `useAppZoom` contract. `DamHopperApp` wraps its complete shared tree, so web and native hosts use the same behavior without host bootstrap or Tauri wiring.
- `TopNav` exposes decrement/increment controls for the discrete `50%` through `120%` levels in `10%` steps. The validated level is best-effort persisted in local storage under `dam-hopper:app-zoom:v1` and defaults to `100%`.
- The provider applies CSS `zoom` to `document.documentElement`, which includes normal app content and body-mounted portals. It changes internal presentation scale only; it does not change the OS/native window or the Browser Debug viewport model. The native Browser Debug child mirrors this factor with WebView page zoom while using rendered DOM coordinates for its bounds, so selected target CSS dimensions remain stable.

**Native browser-debug controller (Phase 03):**

- `apps/native/src-tauri/src/browser_debug/` owns one stable-label `browser-debug` child WebView, its serialized lifecycle, geometry, visibility, navigation generation, nonce/request state, and main-window-only commands.
- Custom viewport geometry is supplied by the shared UI through the existing
  host lifecycle contract; it does not resize the Tauri main window. Web uses
  the iframe adapter, while desktop native uses the child WebView adapter.
- Native desktop target navigation is parsed and restricted to HTTP loopback or
  explicitly supplied HTTPS tunnel origins. Credentials, unsafe schemes, popups,
  downloads, external redirects, and Windows WebView2 permission requests fail
  closed. The web iframe fallback can reject untrusted bridge messages but
  cannot observe a cross-origin external redirect; the redirected page may
  remain visible without trusted control or inspection.
- The existing built browser bridge is embedded by `build.rs` and injected at document start. The native relay accepts only bounded, schema-validated events matching the child label, committed origin, generation, nonce, and issued request ID.
- Child cookies, cache, and page storage use a profile-scoped hashed directory under application data. Clearing a profile destroys the active child before removing only that profile’s directory. Linux has a WebKitGTK child/relay implementation but remains runtime-unverified until a real engine verification pass; macOS remains deferred.

### persistence/ (Phase 04)

SQLite-backed session persistence infrastructure for live resume and server-restart relaunch.

Persistence is always enabled when the configured SQLite database can be opened. It does not preserve exact shell/process memory across DamHopper server or host restart.

**Schema (001_initial.sql):**

| Table           | Purpose                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| sessions        | Session metadata: id, project, command, cwd, session_type, restart_policy, restart_max_retries, env_json, cols, rows, created_at, updated_at |
| session_buffers | Scrollback buffers: session_id, data (BLOB), total_written, updated_at                                                                       |
| persisted_ports | Stdout-detected safe port candidates: session_id, port, project, updated_at                                                                  |

Indexes on `project` and `updated_at` for efficient queries.

**SessionStore API:**

- `open(path) → Result<Self>` — Creates/opens database, runs migrations, sets 0o600 permissions (Unix)
- `save_session(meta, env, cols, rows, restart_max_retries) → Result` — INSERT OR REPLACE into sessions
- `save_buffer(id, data, total_written) → Result` — Persist scrollback buffer
- `load_sessions() → Result<Vec<PersistedSession>>` — Load all saved sessions from database
- `load_buffer(id) → Result<Option<(Vec<u8>, u64)>>` — Load buffer data + byte count for session
- `delete_buffer_before(cutoff_ms) → Result` — TTL-based cleanup of expired buffers
- `delete_session_buffer(id) → Result` — Remove buffer for specific session

**Thread Safety:** Arc<Mutex<Connection>> — safe for concurrent access across async runtime.

**Session Storage Format:**

```rust
pub struct PersistedSession {
    pub meta: SessionMeta,        // id, project, command, cwd, session_type, restart_policy
    pub env: HashMap<String, String>,  // Stored as JSON blob in database
    pub cols: u16,                // Terminal width
    pub rows: u16,                // Terminal height
}
```

**Data Integrity:**

- RestartPolicy and SessionType enums stored as lowercase strings in database
- Environment variables serialized to JSON for portability
- created_at / updated_at in milliseconds (Unix epoch)
- total_written counter tracks bytes for buffer offset tracking (Phase 02)

### Persist Worker (Phase 05)

**Purpose**: Async worker thread that batches terminal session buffers and persists them to SQLite while bounding PTY snapshot memory use.

**Architecture:**

- **Dedicated thread**: `persist-worker` (std::thread, not tokio)
- **Snapshot delivery**: PTY readers use non-blocking `try_send()` for periodic buffer snapshots; a full queue drops only that best-effort update
- **Lifecycle delivery**: create, exit, removal, and shutdown commands use ordered `send()` calls; final buffer persistence falls back to the store if the worker is disconnected
- **Bounded channel**: sync_channel(256) prevents unbounded memory growth
- **Batching**: HashMap deduplication (only latest buffer per session written)
- **Throttling**: 16KB snapshots (prevents 256MB/sec → 16MB/sec memory churn reduction)

**Worker Commands (PersistCmd enum):**

| Command          | Source            | Trigger             | Behavior                                 |
| ---------------- | ----------------- | ------------------- | ---------------------------------------- |
| `BufferUpdate`   | PTY reader        | Every 16KB output   | Batches per session, overwrites previous |
| `SessionCreated` | PtySessionManager | On spawn            | Records metadata to SQLite               |
| `SessionExited`  | PTY reader        | On EOF              | Immediate flush (no 5s wait)             |
| `SessionRemoved` | PtySessionManager | On kill             | Deletes from database                    |
| `Shutdown`       | main.rs           | After readers drain | Final flush and exit                     |

**Main Loop** (`PersistWorker::run()`):

1. `recv_timeout(1s)` with periodic 5s flush timer
2. On command: batch into HashMap, update database
3. On timeout: flush all pending buffers to SQLite
4. On channel disconnect: call `flush_all()` and exit

**Graceful Shutdown:**

1. Server receives SIGTERM
2. PTY manager snapshots live buffers, stops producers, and waits for readers
3. main.rs sends `PersistCmd::Shutdown`
4. Worker flushes its pending buffers and exits
5. main.rs joins the worker thread

**Performance Characteristics:**

| Metric             | Value                  | Improvement                 |
| ------------------ | ---------------------- | --------------------------- |
| Snapshot frequency | ~6/sec (16KB throttle) | 94% reduction vs every-read |
| Memory churn       | 16MB/sec               | 16× reduction vs 256MB/sec  |
| Worker CPU         | <1%                    | Minimal overhead            |
| Non-blocking sends | 100%                   | PTY never waits on DB       |

**Integration Points:**

1. **PtySessionManager** — holds `Option<SyncSender<PersistCmd>>`
   - `create()` sends SessionCreated
   - `kill()` sends SessionRemoved
   - Reader thread sends throttled, best-effort BufferUpdate snapshots
   - Reader thread sends a final buffer snapshot and SessionExited before it exits

2. **main.rs** — manages worker lifecycle
   - Spawns worker thread on startup (if enabled)
   - Holds persist_tx and explicitly sends Shutdown after reader drain
   - Joins the worker after its final flush before process exit

3. **SessionStore** — shared via Arc<Mutex>
   - Worker calls save_session, save_buffer, delete_session
   - Periodic PTY snapshots do not block on persistence; lifecycle transitions may wait for bounded queue capacity

**Use Cases:**

- Server restart recovery: restore active sessions + their scrollback on reboot
- Long-running tasks: preserve build/run output across server updates
- Debug experience: buffer history available immediately without re-running commands

### fs/ (Phase 01+: IDE File Explorer + Editor)

**error.rs** — `FsError` enum (Unavailable, NotFound, PermissionDenied, TooLarge, Conflict).

- `Conflict` variant (Phase 04): raised when write rejected due to mtime mismatch.

**sandbox.rs** — `ProjectSandbox` validates paths against per-configured project roots.

- HashMap<project_name, canonical_root> initialized at startup + workspace switch
- Cheap clone; canonicalization done at init time
- Never held across `.await`
- Planned worktree targets extend validation to an authorized
  `(project_name, canonical_target_root)` pair without allowing arbitrary paths

**ops.rs** — Filesystem operations:

- `list_dir()` — directory contents with metadata
- `read_file()` — text/binary detection, range reads (max 100MB, Phase 04: capped at 10MB per REST call, unlimited via WS)
- `stat()` — file metadata (kind, size, mtime, mime, isBinary)
- `detect_binary()` — heuristic detection
- `atomic_write_with_check()` (Phase 04) — mtime-guarded atomic write via tempfile + rename
- `search()` (Phase 07) — .gitignore-aware text search using `ignore` crate; returns file + match context; results capped at 1000

**Phase 2 delayed-write hardening (Unix/Linux):** The WebSocket write protocol and
chunked uploads keep their temporary file in the target filesystem, verify the
declared byte count, and revalidate the authorized project/worktree target at
commit. On Unix/Linux, the final commit is target-relative: parent directories
are opened with no-symlink-following flags, the target root identity captured at
begin is checked again, the expected file mtime is checked with the opened
directory, and the temporary file is atomically renamed through that directory
handle. This prevents a delayed commit from resolving a replaced path tree
against a different filesystem object while the operation was in flight.

The accepted scope for this phase is Unix/Linux handle-anchored,
target-relative commits. Windows retains a path-based fallback: it rechecks the
target-root identity and expected mtime before persisting the temporary file,
but cannot provide the same handle-anchored rename guarantee. That Windows race
window is known and explicitly out of scope for Phase 2; it must not be
described as equivalent to the Unix/Linux guarantee.

**mod.rs** — `FsSubsystem` (Arc<Mutex<Inner>>):

- Lazy init: ProjectSandbox stored as Option (Unavailable if init failed)
- Seeded/reinitialized from config projects on startup and workspace switch
- Cheap clone pattern

### Explorer video playback and download (Phase 04 browser-host validation complete)

Phase 1 delivered the authenticated, purpose-bound ticket boundary. Phase 2
ships session-bound media: an opaque ticket URL is paired with an HTTP-compatible,
host-only `HttpOnly; SameSite=Lax; Path=/api/fs` media-session cookie without
`Secure`, so the stream endpoint is no longer capability-only. Auth cookies remain
`HttpOnly; SameSite=Strict`. Phase
03 completes the browser-host `VideoPreview` integration. Phase 04 validates it
with the repository Playwright/Vitest harness in installed Chromium 151 using a
valid one-second VP8 WebM fixture, the real ticket client, and the native download
helper. The 116-test full browser suite, including 11 media-specific tests,
passed on Chromium 151. The broader gate also passed 1,018 UI tests and 691 Rust
tests (one ignored performance test); `pnpm build` and `pnpm lint` were clean. Checks cover the
versioned session-cookie contract, credentialed `HEAD` before source exposure,
`crossOrigin="use-credentials"`, playback/seek, direct anchor download, rejected
probe retry, cleanup, and absence of `Blob`/object-URL conversion. The fixture uses
real same-origin HTTP cookie storage and native cookie sending, including cookie
binding, DELETE clearing, and ticket-only cross-origin authorization; it does not
expose the HttpOnly cookie to JavaScript. Separate browser frontends use an exact
configured CORS allowlist. Media
issuance requires authentication and stream URLs are actor/session-bound, short-lived
capabilities; logout/session revocation still invalidates them. `SameSite=Lax` cookies
are not sent cross-site, so cross-origin media uses the bound ticket capability.
Cleartext HTTP still permits interception or modification of credentials, ticket URLs,
actions, and media bytes. It is not evidence for real cross-site CHIPS partitioning.
Edge, Tauri/WebView, Safari, and Firefox remain unqualified.
Browser routing recognizes only the final, case-insensitive extensions `mp4`,
`m4v`, `webm`, `ogv`, `ogg`, and `mov` (an extension/MIME hint, not codec proof);
diff tabs retain their dedicated viewer.

The shipped server-side sequence is:

```mermaid
sequenceDiagram
    participant E as Explorer and EditorTabs
    participant V as VideoPreview
    participant A as Authenticated ticket API
    participant S as Session-bound stream API
    participant F as ProjectSandbox and file
    E->>A: POST project, path, and purpose with Bearer auth
    A->>F: Resolve sandbox path and stat regular file
    F-->>A: Canonical resource metadata
    A-->>E: Opaque URL plus HttpOnly media-session cookie
    alt Playback purpose
        E->>V: Open recognized video extension
        V->>S: GET playback URL with optional single Range/If-Range
        S-->>V: Inline 206 stream for play and seek
    else Download purpose
        E->>S: Navigate to download URL
        S-->>E: Attachment stream handled by browser
    end
    S->>F: Revalidate ticket, sandbox path, and metadata
    F-->>S: Seekable bounded file reader
```

`POST /api/fs/video/tickets` stays behind normal authentication. It accepts only
a configured project, project-relative path, and closed `playback | download`
purpose. It resolves through the existing `ProjectSandbox`, verifies a regular
video candidate, and returns a random opaque ticket URL. `DELETE
/api/fs/video/tickets` revokes a ticket idempotently. The in-memory ticket store
prunes expired entries and binds each ticket to one canonical project resource,
one immutable purpose, issuance
metadata, and the authenticated actor's media session. Tickets are never
persisted into editor state, browser storage, diagnostics, or logs. Ticket idle
expiry is 15 minutes; media-session idle expiry is 30 minutes; both have an
eight-hour absolute expiry. The stream
must present the matching `damhopper-media-session` cookie (host-only, `HttpOnly`,
`SameSite=Lax`, `Path=/api/fs`; no `Secure`); ticket-only, foreign-session,
expired, and revoked requests return indistinguishable `404` responses. Idle TTL
refreshes only after a fully validated stream response or ticket issuance, never
past the absolute deadline. `DELETE /api/fs/media-session` requires Bearer
authentication, clears the cookie, and—when a matching cookie is supplied—revokes
every ticket in that authenticated actor's session; it returns `204` without
disclosing absent or foreign session state. Ticket-specific image/video DELETEs
also require Bearer authentication and remove a ticket only with its matching
actor/session cookie.
Workspace reinitialization and configuration changes revoke all tickets and
advance the generation, preventing issuance across a changed context. Session and
ticket state is process-local; multi-instance deployments require sticky routing
to the issuing process until a shared store exists. Restart revokes all media state.

During server-profile credential replacement and logout, `ServerSettingsDialog`
uses this session-revoke endpoint with a five-second bound. An unreachable old
server falls back to the bounded server-side expiry. If remote revocation
succeeds but subsequent local token persistence/removal fails, the remote session
remains revoked intentionally rather than being recreated; a retained/restored
local login must issue fresh media before it streams.

`GET|HEAD /api/fs/video/stream/{ticket}` is authorized by the bound ticket and
media-session cookie, not by a long-lived credential in the URL. Every request
revalidates the sandbox path and file identity (size, mtime, and platform identity) before opening
the file; drift revokes the ticket and returns `410 Gone`. `GET` supports no range
(`200`) or exactly one checked byte range (`206`, exact `Content-Length` and
`Content-Range`). Unsatisfiable, malformed, or multi-range requests return `416`
with `Content-Range: bytes */size`. `HEAD` returns representation metadata without
reading the body and ignores range selection. `If-Range` is honored only when its
single ETag or HTTP-date validator matches; otherwise the request safely falls back
to the full `200` representation.

Responses set `Accept-Ranges: bytes`, the detected media `Content-Type`, `ETag`,
`Last-Modified`, and `Cache-Control: private, no-store`. Disposition comes only
from the stored purpose: `inline` for playback or a sanitized RFC 5987 `attachment`
filename for download. The client cannot upgrade a playback ticket into a download
ticket. Bodies use an async reader bounded to 128 KiB with Hyper backpressure;
client disconnect drops the body and file without a detached producer, and no
filesystem or ticket-store lock is held while streaming.

The backend emits credentialed CORS and preflight headers only for exact configured
origins. Browser media playback requires an authenticated ticket; the ticket remains
bound to the issuing actor/session and is revoked with that session. Cleartext
interception or modification remains a deployment risk.

The browser host routes recognized video extensions to `VideoPreview` before
generic binary or large-text tiering. The player requests a fresh playback
ticket on mount, uses one
native `<video controls preload="metadata" playsInline>` element, and clears its
source on tab switch or unmount. Download actions request a separate download
ticket, then activate a temporary anchor so browser download handling consumes the
stream directly without `fetch().blob()`. Playback and download can run concurrently
and expire or revoke independently. Extension and MIME are routing hints only;
codec failure becomes an actionable unsupported-media state. This validation is
browser-host-only. Microsoft Edge was not installed and was not substituted with
Chromium. Packaged Tauri/WebView playback/download, Safari, Firefox, and real
cross-site CHIPS partition behavior remain unqualified. V1 does
not add thumbnails, custom controls, Media Source Extensions, HLS/DASH, codec probing,
or transcoding.

Key invariants:

- Workspace sandbox and authentication checks happen before any file bytes leave.
- Browser URLs never contain the profile JWT, username, absolute path, or raw file content.
- Memory remains proportional to stream chunk size and active streams, never file size.
- One ticket selects one resource and one purpose; it cannot enumerate projects,
  change paths, or switch between inline and attachment behavior.
- Playback never depends on download completion; each action owns a separate ticket
  and response stream over the same validated file.
- File replacement or metadata drift invalidates the prior ticket/range sequence.
- Unsupported containers/codecs fail visibly; media never falls back to Bearer URLs
  or a 1–3 GB Blob read.

### Explorer native image preview (Phase 03 release gate complete)

Image preview uses the same bounded, session-bound media-ticket core as video
while keeping a separate public adapter and contract. The server exposes `POST|DELETE
/api/fs/image/tickets` and `GET|HEAD /api/fs/image/stream/{ticket}`. Image
issuance accepts only final, case-insensitive `png`, `jpg`, `jpeg`, `gif`, and
`webp` extensions and always binds the capability to the fixed `preview`
purpose. SVG, AVIF, BMP, TIFF, dotfiles, directories, symlink components, FIFOs,
and traversal paths remain outside the preview surface.

The browser flow is session-bound:

```mermaid
sequenceDiagram
    participant E as Explorer and EditorTabs
    participant I as ImagePreview
    participant A as Authenticated image ticket API
    participant S as Ticketed image stream
    participant F as ProjectSandbox and file
    E->>A: POST project and path with Bearer auth
    A->>F: Resolve, regular-file check, MIME and version bind
    A-->>E: Opaque preview URL plus media-session cookie
    E->>I: Mount one native <img>
    I->>S: Native GET/HEAD with matching cookie
    S->>F: Revalidate sandbox path and file identity
    S-->>I: Inline image bytes/range response
    I->>A: Authenticated best-effort DELETE on cleanup
```

`ImagePreview` assigns the opaque URL directly to one native `<img>` and relies
on browser decoding. It never calls `fsRead`, buffers a response, creates a
`Blob`, creates an object URL, uses a canvas transform, or exposes a download
action. Loading, ready, generic error, retry, stale-generation, profile-change,
and unmount cleanup are explicit lifecycle states; cleanup detaches `src` before
revoking the capability. The `alt` contract is `Image preview: {fileName}`.

The editor assigns an `image` tier before binary/large classification, including
large or binary-hinted allowlisted images. Open, hydration, save, force-overwrite,
reload, and Git reconciliation paths treat image tabs as preview-only and never
materialize bytes. Diff tabs retain their dedicated viewer and video routing
continues to take precedence. The shared store keeps idle/absolute expiry,
generation invalidation, stale-file `410`, range/HEAD,
revalidation and private no-store response invariants used by video.

### git/

Git operations and repository discovery helpers.

**types.rs** — shared API types for git surfaces.

- `VcsRoot` — root descriptor returned by `/api/git/{project}/roots`
- `VcsRootKind` — `Primary`, `Submodule`, or `NestedRepo`
- `VcsRootMappingState` — `Mapped`, `Unmapped`, `Missing`, or `Uninitialized`
- `SubmoduleGitlinkInfo` — gitlink path, object id, optional module name, optional URL

**vcs_roots.rs** — discovery and resolution helpers.

- `discover_vcs_roots(project_path)` scans the primary repo, gitlinks, `.gitmodules`, and nested repos.
- `resolve_vcs_root(project_path, root_id)` validates root ids, blocks traversal, and returns the canonical path for a usable VCS root.
- `resolve_git_request_root(project_path, requested_root)` and `resolve_git_path_root(...)` normalize root-scoped API requests so branch, diff, staging, and history actions stay inside one VCS root.
- `staged_vcs_root_ids(project_path)` reports which discovered roots currently have staged changes.
- Primary root accumulates warnings when `.gitmodules` is invalid or gitlink state is inconsistent.

Root discovery treats `.gitmodules` as optional metadata. The index gitlink is
the source of truth for submodule rows, and a child `.git` marker promotes that
path to an actionable VCS root. This keeps parent gitlink state separate from
child repository file state: parent diffs can show `modules/child` as a
submodule entry while root-scoped child diffs show `README.md`, `src/*`, and
other child-local paths.

### Web Frontend Shared File Decorations

**Location:** `packages/ui/src/lib/`

- `file-decoration.ts` is the single lookup table for file icons, badge text, display language, and Monaco language.
- Lookup order: exact filename > extension > MIME fallback > neutral default.
- `file-decoration-icon.tsx` is a thin rendering wrapper around the shared registry.
- `mime-to-language.ts` remains as a compatibility wrapper for MIME-only callers.
- Shared consumers include the file tree, editor tabs, search headers, and path labels, so file identity stays consistent across the IDE.

**Design notes:**

- Exact-name matches cover dotfiles and toolchain files like `.env`, `.gitignore`, `Dockerfile`, `Makefile`, and lockfiles.
- Registry returns safe defaults for unknown files, no throw path.
- UI components should consume the shared helpers instead of re-implementing filename parsing.

### Explorer language filter (Phase 02 shipped)

The Explorer language filter uses a user-triggered, project-root scan rather than
recursively expanding the lazy filesystem tree. An authenticated one-shot endpoint
resolves the selected project through the existing filesystem sandbox, walks regular
files with the shared `ignore::WalkBuilder` policy, and returns bounded project-relative
metadata for Rust, combined JavaScript/TypeScript, and Java files.

- The scan honors Git ignore sources, includes hidden paths so the existing
  `explorerShowHidden` preference can control presentation, excludes symlinks, does
  not follow directory links, and returns normalized relative paths only.
- Results are capped and expose `truncated`; they are stored only in the typed TanStack
  Query project cache `['explorer-language-scan', project]`, whose metadata includes the
  result, generation, stale flag, and last completed scan timestamp. `Scan`/`Rescan` is
  always explicit. Filesystem events increment the project generation and mark the cached
  result stale without triggering a background scan. A response finishing after such an
  event remains usable but stale; a failed rescan preserves the prior result. Workspace
  changes remove all language-scan cache entries.
- The selected `All | Rust | JS/TS | Java` filter is a global UI preference persisted
  through the existing global-config/settings path. Scan results, stale state, and
  expanded scan-tree folders are not persisted.
- The Explorer consumes the cache to build a complete, sorted, navigation-only
  synthetic hierarchy for the selected language. `All` remains the live lazy
  filesystem tree; synthetic rows are not mutation targets, so create, rename,
  delete, upload, and related filesystem actions are disabled while filtered.
- The header presents explicit `Scan`/`Rescan` controls and reports last-scan,
  stale, in-progress, truncation, error, and empty-result states. Committed
  results carry a monotonic `resultVersion` (including same-generation rescans)
  so rendering follows the latest committed snapshot rather than an obsolete
  tree projection.
- Reveal/selection requests switch a filtered view to `All` when necessary, then
  wait for the live tree's committed render after each lazy-child load before
  opening ancestors and focusing the target. Completion is recorded only after
  successful reveal, and a request nonce permits a later retry.

The first version is extension-based and limited to `.rs`, `.js`, `.jsx`, `.ts`,
`.tsx`, and `.java`. It does not provide parser/LSP semantics, symbols/references,
automatic rescans, persistent indexes, streaming progress, or caller-configurable
language families.

### Semantic code navigation (planned)

Semantic navigation is an editor capability separate from the Explorer language
filter. Monaco exposes Go to Definition, Go to Implementation, Find References,
modifier-click, and keyboard/context-menu actions through registered language
providers. A typed client adapter sends project-relative document and navigation
messages over a dedicated authenticated WebSocket. The backend translates those
messages to standard LSP JSON-RPC over stdio for an allowlisted language server.
V1 targets `rust-analyzer`, `typescript-language-server`, and Eclipse JDT LS; the
registry stays generic so later languages add descriptors rather than UI forks.

DamHopper does not embed a VS Code workbench or general extension host for this
feature. VS Code language extensions ultimately use the same language-server
processes, while an extension host would add incompatible contribution APIs,
Node/browser runtime assumptions, marketplace installation, and a broader code
execution boundary. A real extension host remains a separate future product
decision, not a prerequisite for semantic navigation.

```mermaid
sequenceDiagram
    participant M as Monaco provider
    participant C as Semantic client
    participant W as Authenticated semantic WS
    participant R as LSP registry and supervisor
    participant L as Allowlisted language server
    M->>C: Open model with project-relative path and version
    C->>W: document/open or incremental document/change
    W->>R: Resolve project, language, and server descriptor
    R->>L: Lazy start, initialize, and replay open documents
    M->>C: Definition, implementation, or references request
    C->>W: Navigation request with cancellation token
    W->>L: Standard LSP request over stdio
    L-->>W: Locations plus progress or capability state
    W-->>C: Bounded project-relative targets
    C-->>M: Jump directly or show a multi-target result list
```

The supervisor reuses one process per authenticated client, configured project,
and server descriptor. Opening the first supported Monaco model may prewarm that
server, but no workspace-wide language scan or server fan-out occurs. Interactive
requests have bounded queues and deadlines; superseded requests propagate
`$/cancelRequest`, and late responses are discarded by document/request version.
After an inactivity grace period, warm processes become LRU eviction candidates
even if tabs remain open. A later request restarts the process and replays current
open document snapshots. Per-client and global process limits prevent a workspace
with many languages from starting every server at once.

The browser never selects an executable, arguments, root URI, or absolute path.
Server descriptors are built in or loaded only from trusted global configuration;
commands are spawned without a shell and with a sanitized environment. Every
incoming project/path is resolved through `ProjectSandbox`. LSP `file://` URIs and
host paths stay behind the backend adapter, which returns only normalized
project-relative targets and bounded display metadata.

Key invariants:

- Semantic navigation starts on supported editor demand; Explorer scans and
  filesystem events never start a language server.
- One language-server failure degrades only that project/language and never blocks
  file editing, terminal I/O, saving, or other WebSocket traffic.
- Unsaved Monaco content is synchronized by version and is never persisted by the
  semantic transport; reconnect/restart replays only currently open documents.
- Warm navigation latency, cold-start/indexing time, queue wait, cancellation,
  process RSS/CPU, crashes, and evictions are measured without logging source text
  or absolute paths.
- Missing binaries and unsupported capabilities produce explicit setup/degraded
  states; the server never downloads or executes a project-supplied language tool.

### Multi-Server Profile Management (Phase 2)

**Client-side only** — no backend involvement. React component integration:

**File:** `packages/ui/src/api/server-config.ts`

- `ServerProfile` interface: { id (UUID), name, url, authType, username?, createdAt (timestamp) }
- Functions: `getProfiles()`, `saveProfiles()`, `createProfile()`, `updateProfile()`, `deleteProfile()`, `setActiveProfile()`, `getActiveProfile()`, `migrateToProfiles()`
- Storage: localStorage with keys `damhopper_server_profiles` (all profiles) + `damhopper_active_profile_id` (current)

**Components:**

- `ServerSettingsDialog.tsx` (organisms/) — create/edit profile form with URL + auth type selector
- `ServerProfilesDialog.tsx` (organisms/) — list profiles, switch active, delete, edit (calls callbacks to parent)
- `Sidebar.tsx` — displays active profile name; "Change Server" button opens `ServerProfilesDialog`

**Integration in shared UI and host bootstraps:**

- `DamHopperApp` calls `migrateToProfiles()` at startup to convert legacy config
- Browser host initializes `WsTransport(activeProfile.url, activeProfile.id)` when a valid active profile exists; a packaged same-origin build uses `WsTransport(getServerUrl())` when migration leaves no profile.
- Native host initializes `WsTransport(getNativeServerUrl(), activeProfile.id)` when an active profile exists, otherwise installs `IdleTransport`
- Packaged same-origin builds ignore stale cross-origin profile/localStorage URLs and fall back to the serving origin; profile selection remains available when an explicit profile is needed.
- Sidebar triggers profile switcher dialog and the setup flow remains profile-driven in both hosts

**Data Persistence:**

- Profiles: localStorage (survives browser close, shared across tabs)
- Active profile ID: localStorage (survives browser close, shared across tabs)
- Auth token: localStorage, keyed by profile ID (survives browser close; bearer token is readable by JavaScript) — password never stored
- Profile changes emit a reactive revision so tabs rebind auth state and transport; changing a normalized backend URL clears that profile token and requires login again

### SSH Credential Persistence (Phase 02)

SSH passphrases are session-only by default. Save-for-later uses the host OS credential store on Linux, not app config or browser storage.

**Server behavior:**

- `SshCredStore` keeps the active key path plus passphrase in memory.
- In-memory passphrase bytes use `Zeroizing<Vec<u8>>` and are cleared on drop.
- `POST /api/ssh/keys/load` accepts `saveForLater`.
- `POST /api/ssh/keys/load` validates the key before any persistence attempt, so wrong passphrases never overwrite saved credentials.
- `saved=true` means a stored credential is available after the request, not necessarily that the current request created it.
- `GET /api/ssh/credentials` returns metadata only: `saved`, `keyPath`, `error`.
- `DELETE /api/ssh/credentials` forgets the saved entry and clears the current session credential if it matches.

**Persistence behavior:**

- Saved passphrases use `secret-tool` on Linux.
- Stored key scope is derived from workspace path + SSH key path + public-key fingerprint when available.
- No plaintext passphrase is written to app config, localStorage, or logs.
- API responses never include secret material, only status metadata.

**Trust boundary:**

- OS keyring gives encrypted-at-rest protection against disk disclosure.
- It does not protect against a compromised same-user process or DamHopper itself while running.
- If keyring support is unavailable, save-for-later falls back to session-only use with an error.
- The frontend retry hook performs only one automatic retry after a successful key load and does not keep a long-lived success cache, so later SSH auth failures can reopen the prompt instead of being masked by stale session state.

### SSH port-forwarding control (Phase 03; shipped safeguards)

Phase 01 feasibility passed for Windows ACLs, SSH-agent access, and the
no-follow/contained-handle primitives. Phase 02 contracts now include the
forwarding manager/runtime safeguards below. Linux, macOS, and iOS remain
deferred; see the Phase 01 native dependency/platform gate report.

The planned SSH forwarding implementation is a native desktop capability. The shared React UI talks to a host interface; only
`apps/native` supplies a Tauri-backed implementation. Rust code in `apps/native/src-tauri` owns the
SSH protocol, desktop loopback listeners, profile/trust/meta persistence, host trust, credentials,
activation ordering, scope purge, lifecycle, and shutdown. The Axum server has no forwarding CRUD
route, manager, store, flag, state, or WebSocket event. Existing `server/src/port_forward/**`, PTY
port detection, `/api/ssh/*`, Git credentials, and shared `WsTransport` behavior remain protected,
unrelated, and unchanged.

V1 supports SSH local forwarding only:

`desktop 127.0.0.1:localPort -> native Rust SSH client -> remote 127.0.0.1:targetPort`.

The SSH endpoint defaults from the active DamHopper server profile hostname with port 22 prefilled,
but the user must review and save it. The persisted SSH endpoint is explicit and editable; later
HTTP profile URL changes never silently rewrite it. Both bind and remote target hosts are fixed
IPv4 `127.0.0.1`; only their integer ports are configurable in `1..=65535`. Remote forwarding,
SOCKS, non-loopback targets, wildcard/IPv6, port `0`, arbitrary paths/options,
and browser/mobile support are out of v1 scope. Windows Credential Manager persistence
is the shipped desktop password/passphrase persistence boundary described below.

```mermaid
flowchart LR
    UI[Shared SSH forwarding page] --> Host[SshForwardHost interface]
    Host -->|Tauri invoke| IPC[Desktop-only IPC commands]
    IPC --> Ordering[Desktop identity and activation ordering]
    Ordering --> Manager[Native SshForwardManager]
    Manager --> Profiles[(Native per-server-profile TOML)]
    Manager --> KnownHosts[(Native per-server-profile known hosts)]
    Manager --> ScopeMeta[(Scope retention metadata)]
    Manager --> Agent[OS SSH agent or safe key inventory]
    Manager --> Listener[Desktop 127.0.0.1 listener]
    Listener -->|SSH direct-tcpip| Target[Remote 127.0.0.1 target]
    Manager -->|Low-rate Tauri event hint| Host
    Delete[Observed ServerProfile deletion] -->|deactivate then purge| Manager
    Web[Browser and native mobile] -. host unavailable .-> UI
    Axum[DamHopper Axum server] -. no forwarding dependency .-> Manager
```

`apps/native/src/native-ssh-forward-host.ts` is the only **SSH-forwarding** frontend module that
imports Tauri invoke/event APIs; other native adapters remain separate. `packages/ui` defines the
host interface/context and renders no route, navigation, query, invoke, or listener when the host is
absent. Commands return authoritative snapshots. Events are bounded refetch hints, never patches.
The adapter rejects stale desktop/manager/client/activation/scope/profile identities.

Activation ordering is manager-authoritative. Rust persists a stable desktop UUID, creates a random
manager-session UUID per native process, and atomically issues a monotonically increasing client
epoch to each webview adapter. Within its epoch, the caller issues canonical decimal-string
`activationToken` values. Rust strictly parses both counters to `u64` and compares epoch then token
numerically; wire strings are never compared lexicographically (`9 < 10`, `99 < 100`). Rust records
the latest `(clientEpoch, activationToken)` intent before the
serialized activation gate, then rechecks it after each stop/load await and before commit,
auto-start, event, or response. Delayed A or B can never overwrite latest C. A new reload epoch that
activates the same scope takes ordering ownership but rehydrates the existing listener without
stop/start or generation change. Process restart changes manager-session ID, so memory-only epochs,
tokens, scope/runtime generations safely reset; old IPC clients/tasks no longer exist.

Native state separates durable intent from live resources:

- `NativeSshForwardProfile`: UUID, active DamHopper server-profile scope ID, name, explicit SSH
  host/port/user, auth mode (`agent` or safe inventory key reference), desktop local port, fixed
  remote target host `127.0.0.1`, target port, auto-start, and bounded reconnect policy. It contains no passphrase, private key,
  HTTP auth token, task handle, socket, or raw SSH option.
- `NativeSshForwardRuntime`: profile ID, scope ID, generation, state, desktop bind address,
  timestamps, retry count, channel count, and stable redacted error code. It is memory-only.
- Profile, known-host, and scope-meta files live under Tauri `app_config_dir`, partitioned by a hash
  of the active server-profile UUID. Mutations share one strict manager/runtime lock and are
  serialized/atomically replaced; Unix files use mode `0600`. Observed `ServerProfile` deletion
  deactivates then calls inactive `purge_scope`. For a known scope, unavailable browser storage is
  a no-write condition: it does not advance aging, create metadata, or purge. Unobserved absent
  scopes quarantine 30 continuous days; active/staged scopes never purge.
- The app-config root, scope directories, and every profile/trust/meta read, temp write, atomic
  replace, backup, quarantine, tombstone, and purge use retained no-follow/reparse-safe contained
  directory handles. Link/reparse/hard-link/component swaps fail closed; validated paths are never
  reopened by string.

All IPC revisions, scope/runtime generations, client epochs, and activation tokens are canonical
unsigned decimal strings, never JSON numbers. Strings are wire encoding only; Rust parses to `u64`
and TypeScript parses to `BigInt` before numeric equality/order/freshness decisions. Lexical compare
is prohibited. Rust uses checked `u64` increments and fails
`COUNTER_EXHAUSTED` rather than wrap/reset. Wire timestamps are RFC3339 UTC with exact milliseconds
and `Z`. Persisted profile/trust revisions survive restart; manager/client/activation/runtime
counters are memory-only as described above.

V1 prefers the OS SSH agent. An optional key mode selects only an inventory entry beneath the
desktop user's SSH directory and loads it through a platform no-follow/contained-handle operation.
When the Windows agent is unavailable, the desktop UI may ask for the selected encrypted key's
passphrase through the Tauri IPC boundary. Rust decrypts the key in memory, keeps only the
profile-scoped decrypted key for the active desktop session, and never persists, logs, or sends the
passphrase to the HTTP server. The Start/Restart credential prompt also offers an editable username
and ephemeral SSH password method, like VS Code Remote-SSH; native Rust zeroizes and clears that
credential after a failed authentication, and it never enters the profile, browser snapshot, logs,
or HTTP server. There is no path picker, keychain, or subprocess fallback.

Host trust lookup is endpoint-first. SSH host is canonical safe ASCII DNS (lowercase, trailing dots
removed) or canonical IPv4 plus port; validation is applied before lookup and mutation. An endpoint
with no records produces one bounded unknown-key challenge. Approval must echo the exact canonical
algorithm and `SHA256:` fingerprint; Rust persists the held full key and requires an explicit later
Start. A trusted endpoint accepts only unique exact pre-recorded algorithm/full-key pairs, with a
hard cap of eight algorithms. Same algorithm/new key or an unrecorded algorithm at an existing
endpoint hard-fails without an approval shortcut.

Every profile/trust/meta operation revalidates the retained contained handle and scope identity
before use; handles are not replaced by path-based reopen. The desktop identity cache is scoped to
the current native process/session and is never treated as durable trust or cross-process identity.

Changed-key/algorithm remediation is stopped-app only. The trust file is
`<Tauri app_config_dir>/ssh-forward/scopes/<sha256(scope UUID)>/known-hosts.toml`; the root is resolved
by Tauri for identifier `com.damhopper` (normally `%APPDATA%\com.damhopper`,
`$HOME/Library/Application Support/com.damhopper`, or
`${XDG_CONFIG_HOME:-$HOME/.config}/com.damhopper`), never by hardcoded username. The signed executable
offers a pre-webview `--ssh-forward-trust-repair` mode with scope/host/port or opaque backup ID only,
no path/key argument or IPC. It requires the normal manager's runtime lock exclusively, creates a
contained protected whole-file backup and optional endpoint quarantine, removes only the canonical
endpoint records, checked-increments trust revision, fsyncs, and permission-preserving atomically
replaces. Recovery verifies backup checksum/scope and unchanged post-repair revision, imports records,
increments again, and never rolls revision back. Reopen, Start to obtain unknown challenge, compare
the exact algorithm/fingerprint out of band, approve, then explicitly Start. Direct key insertion,
`trust anyway`, and running-state trust deletion are prohibited.

The exact user copy is: “Connection blocked because the saved SSH host identity no longer matches.
Do not approve it yet. Stop all forwards, quit DamHopper, verify the expected fingerprint with the
server administrator, then run the displayed trust-repair command. Reopen DamHopper, start the
forward, compare the fingerprint exactly, approve it, then start again.”

```mermaid
stateDiagram-v2
    [*] --> Stopped
    Stopped --> Starting : start or scoped auto-start
    Starting --> Running : host trusted, SSH authenticated, local listener bound
    Starting --> Failed : validation, trust, auth, SSH, or bind failure
    Starting --> Stopping : stop, scope switch, or app exit
    Running --> Reconnecting : SSH transport lost
    Running --> Stopping : stop, scope switch, or app exit
    Reconnecting --> Running : same generation reconnected
    Reconnecting --> Failed : retry budget exhausted
    Reconnecting --> Stopping : stop, scope switch, or app exit
    Failed --> Starting : explicit retry
    Failed --> Stopping : stop, scope switch, or app exit
    Stopping --> Stopped : listener, channels, and SSH session closed
```

#### Established-connection forwarding model (phase 1 persistence boundary)

The next forwarding iteration separates SSH connection identity/lifecycle from
individual port rules. One active DamHopper server-profile scope may contain
many credential-free SSH connection profiles. Each established native
connection owns one authenticated `SshSession` and may serve many loopback-only
forwarding rules through independent `direct-tcpip` channels. The existing
one-active-scope boundary remains: a scope change closes every connection and
forward in the prior scope.

```mermaid
stateDiagram-v2
    [*] --> Disconnected
    Disconnected --> Authenticating : explicit Connect
    Authenticating --> TrustBlocked : unknown host key
    TrustBlocked --> Disconnected : approve exact key for later retry
    Authenticating --> Established : trust verified and SSH authenticated
    Authenticating --> Disconnected : cancel or authentication failure
    Established --> Reconnecting : SSH transport lost
    Reconnecting --> Established : memory lease or unexpired vault credential succeeds
    Reconnecting --> Disconnected : retry exhausted or credential invalid
    Established --> Disconnecting : explicit disconnect, scope switch, or exit
    Reconnecting --> Disconnecting : explicit disconnect, scope switch, or exit
    Disconnecting --> Disconnected : live ports, channels, session, and memory lease closed
```

Forwarding rules have an independent `off -> opening -> on -> closing -> off`
lifecycle. `opening` is admitted only when native state confirms that the
referenced connection is `Established` and its expected numeric generation is
current. Unknown, stale, wrong-scope, disconnected, authenticating, or
reconnecting connections fail closed without requesting credentials. Opening
or closing one port cannot tear down healthy sibling ports; disconnecting the
parent connection closes all children.

Persisted state is the credential-free v2 document in each scope's
`profiles.toml`. It contains connection profiles (endpoint, SSH user, auth mode
or safe key reference) and forwarding rules (connection profile ID, local port,
fixed remote loopback target/port, reconnect/enable intent). It contains no
password, passphrase, decrypted key, live session, listener, or runtime
generation. The v2 document carries independent `connectionsRevision` and
`rulesRevision` counters; each replacement checks the expected counter, updates
only its collection, and atomically replaces the one validated document.

The first v1 read migrates deterministically: each legacy combined profile
becomes a rule, and connection profiles are deduplicated only by canonical
scope + endpoint + SSH user + auth identity. The original v1 bytes are retained
with scope, length, and SHA-256 metadata in `profiles.v1.rollback.toml` and
`profiles.v1.rollback.meta` until the migration is superseded. Invalid or
secret-bearing v1 data is rejected without publishing v2. Restart recovery
validates rollback artifacts and replacement identities/checksums before
cleanup; incomplete or tampered artifacts fail closed rather than guessing.

During phase 1, legacy profile reads remain compatibility reads: they do not
auto-authenticate, start a connection, or request credentials. A legacy-shaped
write is rebased onto the current v2 document by stable connection-profile ID,
so concurrent v2-only changes are retained and the rule's `desiredEnabled`
intent is preserved. Connection/rule persistence therefore records desired
state only; authentication and live forwarding remain explicit manager
operations.

The native manager is authoritative. Each established runtime is keyed by the
stable connection profile ID and guarded by a memory-only connection generation.
It owns the reusable SSH session, per-connection lifecycle serialization,
forwarding children, and a memory lease used for the live transport. Port
commands carry no credentials and cannot initiate authentication.

Successful passphrase or password authentication may save the entered secret
for exactly 30 days in Windows Credential Manager using user-bound,
local-machine persistence. The fixed `expiresAt` is set only by a successful
save/replacement and is not extended by silent reads or reconnects. The vault
target is an opaque, versioned digest of app + scope + connection profile +
canonical endpoint + user + auth mode/key ID. The versioned credential blob
contains the secret and its timestamps; TOML, browser storage, snapshots,
events, diagnostics, and logs contain metadata only (`saved`, `expiresAt`, safe
status). Agent and unencrypted-key modes store no secret. SSH authentication is
trust-first: host-key verification and any explicit approval/repair complete
before a saved secret is eligible for use.

```mermaid
stateDiagram-v2
    [*] --> Absent
    Absent --> Saved : successful auth and remember for 30 days
    Saved --> Saved : disconnect, scope switch, trust change, or shutdown
    Saved --> Rejected : stored credential receives terminal auth failure
    Rejected --> Saved : successful replacement
    Saved --> Expired : fixed expiresAt reached
    Rejected --> Expired : fixed expiresAt reached
    Expired --> Absent : next read, startup sweep, or explicit cleanup
    Saved --> Absent : Forget, profile delete, or scope purge
    Rejected --> Absent : Forget, profile delete, or scope purge
```

Disconnect, scope switch, trust change, manager shutdown, and app exit close and
zeroize live sessions, decrypted keys, passwords, and live credential leases but retain
the unexpired vault entry. A trust change never authorizes credential use: SSH
host-key verification and explicit repair/approval complete before the vault
secret may be sent. Terminal authentication failure quarantines the entry from
automatic reuse until successful replacement, explicit retry, Forget, or
expiry; it does not silently loop. Expired entries are never returned and are
deleted at the next app-controlled read/sweep because Windows Credential
Manager has no autonomous TTL. Explicit Forget, connection-profile deletion,
and scope purge must verify vault deletion before reporting success; cleanup
failure is reported as maintenance failure. Reconnect reuses the live lease first
and then the unexpired, non-quarantined vault entry.

The vault adapter calls Windows Credential Manager directly; it does not shell
out, write a DPAPI side file, or expose secrets over Tauri IPC. Vault
unavailability does not tear down a successfully authenticated live session,
but the snapshot must report that the credential was not saved. The same-user
process access limitation of Windows Credential Manager remains an explicit
trust-boundary risk. If persistence maintenance or migration rollback cannot restore
the prior document/postcondition, the operation returns a maintenance error and does
not claim success.

Phase 04 explicitly defers adding saved-credential detail to the public snapshot
metadata contract. Phase 03 snapshots expose only existing safe status fields; they
never expose credential contents or targets.

Target limits remain explicit and bounded: at most 16 established connections,
four concurrent handshakes, 64 enabled forwarding rules per active scope, and
64 channels per connection. Snapshot/event authority, canonical decimal wire
counters, stale desktop/manager/client/activation rejection, endpoint-first
host trust, fixed `127.0.0.1` bind/target, and shutdown cleanup invariants remain
unchanged.

#### Phase 2 lifecycle hardening

The native manager's v2 `ConnectionRegistry` is the single in-memory authority
for connection and forwarding-rule runtime ownership. A connection reservation
allocates a connection generation and cancellation token before authentication;
the live connection owns one shared `SshSession`, and each child rule owns its
own rule generation and worker. A rule may be admitted only against the current
established parent generation, so a disconnected or replaced connection cannot
inherit children from an older instance.

Every asynchronous completion carries the connection ID and generation, rule ID
and rule generation where applicable, and the reservation's cancellation token.
Worker exits, reconnect results, and delayed callbacks are ignored when any of
those identities is stale. Disconnect first advances the parent generation,
cancels the parent and children, marks children closing, and only then allows
the connection to be reused. Counter exhaustion is an error rather than a wrap;
it never partially mutates the parent or its children.

Cancellation is observable by all handshake, reconnect, listener, and channel
workers. It wakes waiters and makes shutdown/disconnect cleanup bounded and
idempotent. Failed reservations are reaped even when the initiating task drops;
if the registry lock is temporarily unavailable, cleanup is deferred and
rechecked. Shared session close is serialized and safe through `Arc` references,
so closing one child cannot close a sibling's transport. A worker can mark only
its current child failed; stale worker exits cannot mutate a reused connection
or a newer rule generation.

Live-scope mutation is manager-owned. The scope activity lease and operation
fence prevent direct rule replacement while the scope has active runtime state;
such writes fail closed rather than allowing a listener to outlive its stored
definition. Reconciliation applies desired rules under a dedicated gate, keeps
healthy siblings running, rejects duplicate loopback ports, and removes only
rules that are off and no longer present. Connection/rule revisions and runtime
generations remain separate: revisions protect persisted-document updates,
while generations protect asynchronous live-worker callbacks.

The native manager serializes operations per profile. Start/stop are idempotent; restart performs a
bounded stop before a new generation. CRUD never implicitly edits a live worker: update/delete of an
active profile returns `PROFILE_ACTIVE`, and the UI exposes Stop then Update/Delete as two explicit
operations. Activating a different DamHopper server-profile scope stops all forwards from the prior
scope before committing the new scope. Auto-start candidates sort by `(createdAt, id)`, reserve the
first 16 slots deterministically, launch at most four handshakes concurrently, and leave overflow
stopped with visible `AUTO_START_SKIPPED_LIMIT`. Reloading the webview with the same scope rehydrates
the existing runtime without duplicating listeners.

Unknown trust leaves the admitted generation failed with one challenge. Repeated Start/Restart while
that challenge is current returns it without another generation; Stop clears it; expiry allows a new
generation/challenge. Approval consumes it but never auto-starts. Reconnect keeps the same listener
and generation, rejects new local clients until SSH returns, re-verifies trust, and closes channels
from the lost transport.

Tauri registers exactly 13 Windows desktop commands: open client, activate scope, snapshot, profile CRUD,
start, stop, restart, key inventory, ephemeral key unlock, exact host-key approval, and inactive scope purge. `build.rs`
uses `AppManifest::commands`; checked-in `permissions/ssh-forward.toml` allows exactly those names;
`ssh-forward-main` grants that app permission only to `main` on Windows. The existing
main `default` capability still grants `core:default` (including event listen/unlisten/emit), and
capabilities merge; this feature adds no core permission and makes no false minimal-core claim. No
shell/general filesystem/HTTP/opener capability is granted. Every
command validates UUID/scope, safe ASCII SSH endpoint hosts, integer ports `1..=65535`, fixed local
bind `127.0.0.1`, fixed remote target `127.0.0.1`, bounded strings, revision, and lifecycle state.
Local port `0`, wildcard binds, alternate remote targets, and client-supplied paths are rejected.
The sole `ssh-forward:changed` hint includes desktop instance, manager session, client epoch,
activation token, scope ID/generation, revisions, and optional profile/generation. The adapter
requires exact current desktop/manager/client-epoch/activation/scope identity before a numeric
freshness check may schedule refetch. Mismatched hints do nothing; events never become authority.

SSH/agent/native-handle Cargo dependencies use desktop target-OS dependency sections and modules/
handlers use `cfg(desktop)`. Android/iOS Cargo trees and generated handlers contain none of the 13
commands or accepted SSH dependencies; native mobile frontend creates no host/call.

Profiles are capped at 64 per scope, active forwards at 16, and channels at 64 per forward. Connect
and authentication share a 15-second timeout; channel open uses 10 seconds; shutdown grace is 5
seconds. Reconnect uses at most five attempts with exponential 1-second delay capped at 30 seconds
and at most 20% jitter. Error/event detail is capped at 512 characters and excludes usernames, key
labels, paths, targets, payload bytes, and source error chains.

V1 sets no application-level channel idle timeout so long-idle database/debug clients remain alive.
Channels close on peer EOF, SSH loss, Stop, scope switch, exit, or cap enforcement. SSH keepalive is
30 seconds with three unanswered probes before transport-loss/reconnect handling.

Actual app shutdown uses one idempotent coordinator fed by main `WindowEvent::CloseRequested` and
Tauri `RunEvent::ExitRequested`. It prevents close/exit, rejects new forwarding commands, disposes
SSH manager and existing Browser Debug cleanup under one 5-second deadline, force-closes handles/
aborts leftovers, then exits. `RunEvent::Exit` is last-chance non-async fallback. Webview reload does
not close the main window and therefore does not dispose native forwards.
`createUpdaterArtifacts` is packaging metadata, not runtime updater support. V1 registers no updater
plugin/capability, in-app update/restart control, or Tauri restart/relaunch call. Enabling one is
blocked until it enters the same disposal coordinator and packaged tests prove old listeners close
before relaunch on Windows, macOS, and Linux.

Loopback binding prevents LAN exposure but is not isolation from other processes on the desktop.
Any local process able to connect to the chosen port can use the transparent TCP forward. V1 makes
this explicit in UI/docs; adding per-client authentication would change the forwarded protocol and
is not part of generic TCP forwarding. Product owner must explicitly accept this before release;
security must accept fixed remote-loopback target/trust/ACL. Automated build is distinct from
hash-bound packaged runtime evidence owned by a release engineer. Windows/macOS/Linux evidence must
show the listener works for a second local process before Stop and is unreachable after Stop, scope
switch, and graceful app exit; missing/manual-pending evidence is not a release pass.

### pty/ (Phase 04: Restart Engine ✅ / Phase 07: Idempotency ✅)

Manages portable terminal sessions with automatic restart capabilities and idempotent creation.

**manager.rs** — `PtySessionManager` (Arc<Mutex<Inner>>):

- Map<id, LiveSession> for active sessions
- Map<id, DeadSession> tombstones (60s TTL; auto-evicted by cleanup task)
- Set<id, String> killed tracks manually terminated sessions (used to prevent supervisor respawn race)
- PTY child env is rebuilt from a safe baseline allowlist, then `TERM` and the resolved session env snapshot are applied before spawn
- Initial creation and automatic respawn use one command-construction path. Unix shell selection, cwd, and arguments remain unchanged.
- On Windows, an untargeted terminal with omitted cwd uses an existing user home, then the server current directory; it never uses `/tmp`. Empty or `bash` shell-selector requests launch interactive `cmd.exe` without Unix flags. Other command strings use `cmd.exe /C <command>`.
- Shell integration is Unix-only. Windows `cmd.exe` sessions remain lifecycle-unverified and never receive Bash, zsh, or fish adapter arguments or nonce environment state.
- `create()` fully idempotent: removes dead tombstone, inserts into killed set pre-spawn, removes post-spawn (TOCTOU guard)
- `kill()` marks session dead + adds to killed set, retains 60s tombstone for reconnect
- `remove()` immediately evicts session + adds to killed set (no restart on user kill)
- `spawn_cleanup_task()` runs every 30s: prunes expired tombstones AND orphaned killed set entries (prevents unbounded memory growth)
- Bounded respawn channel (256 slots) prevents DoS

**api/terminal.rs** — terminal creation env resolution:

- Loads project `env_file` into a per-session env map without mutating the server process env
- Request `env` values override `env_file` values
- Missing `env_file` logs a warning and continues
- Malformed `env_file` returns a clear terminal creation error

**session.rs** — Session state management:

- `SessionMeta` — public status (id, alive, exit_code, restart_count)
- `LiveSession` — owns master PTY + writer, reader thread reference
- `DeadSession` — tombstone with exit code, restart decision, backoff delay
- `RespawnOpts` — cloneable subset of PtyCreateOpts for respawn

**Restart Engine (Phase 04):**

**Supervisor Pattern** — decouples blocking I/O from async restart logic:

1. Reader thread (std::thread) reads PTY output blocking
2. On EOF: infer exit code → decide restart → send RespawnCmd
3. Supervisor task (tokio) receives cmd, waits backoff, calls create()
4. New session inherits same ID (no frontend navigation needed)

**Decision Matrix:**
| Policy | Exit=0 | Exit≠0 | Killed |
|--------|--------|--------|---------|
| Never | ✗ | ✗ | ✗ |
| OnFailure\* | ✗ | ✓ | ✗ |
| Always | ✓ | ✓ | ✗ |

\*OnFailure currently acts like Always due to portable-pty API limitation

**Exponential Backoff:**

- 1s, 2s, 4s, 8s, 16s, 30s (max)
- Cap at `MAX_RESTART_DELAY_MS` (30s)
- Resets to 1s on clean exit (exit_code == 0)

**Exit Code Inference** (Limitation):

- portable-pty API only signals EOF (no waitpid equivalent)
- Inferred as: process in live map → exit 0; not found → exit -1
- Cannot distinguish exit 0 from exit 1 (architectural limitation)
- Upstream issue filed: requires std::process wrapper as future work

**Known Issues (Phase 04 Review):** Both fixed before merge:

1. Bounded channel prevents unbounded respawn queue growth (DoS vector) — ✓ Fixed
2. Exit code always 0 for natural exits (OnFailure policy broken) — ✓ Fixed

**Phase 07 Improvements:**

- Killed set prevents double-spawn on concurrent create (50-100ms lock contention reduction)
- Idempotent create eliminates client need for alive status filtering
- Cleanup task prevents killed set from accumulating orphaned entries (was potential memory leak)

**Killed Set Lifecycle (Phase 07 Idempotency Mechanism):**

Prevents supervisor from restarting a session during the kill window and enables full idempotency on create:

1. **User kill**: Session moved to killed set immediately (before reader sees EOF)
2. **Reader exit**: Checks killed set — if present, skips restart decision
3. **Supervisor restart**: Checks killed set — if present, skips delayed respawn
4. **Cleanup task**: Every 30s, removes orphaned IDs (not in live or dead maps)

Example race sequence (create during backoff):

- T0: Process exits, reader sends RespawnCmd with 1s backoff
- T200ms: User calls `terminal:create` with same ID
- T200ms: Create inserts ID into killed set (cancels pending respawn)
- T200ms: Create spawns fresh process, reacquires lock, removes ID from killed set
- T1.2s: Supervisor wakes up, checks killed set — not there anymore but session exists with different PID, skips restart
- Result: Single shell, no race condition

**Buffer Offset Tracking (Phase 01 - F-08 + Phase 02 Protocol Extension):**

Enables efficient delta replay for WebSocket reconnections. ScrollbackBuffer tracks monotonic byte counter and provides differential read API.

**buffer.rs** — `ScrollbackBuffer` enhancements:

- `total_written: u64` — monotonic counter tracking all bytes ever written (survives eviction)
- `current_offset() → u64` — returns total bytes written, used for client checkpoint
- `read_replay(Option<u64>) → BufferReplay` — returns data, current offset, `reset`, and `truncated`
- Ring buffer algorithm unchanged; offset tracking has zero performance cost

**Delta Replay Logic**:

1. Client requests bytes from stored offset
2. Server calculates buffer start offset: `total_written - buffer.len()`
3. If requested offset within buffer: return delta (new bytes since offset)
4. If requested offset too old (evicted): return full buffer with `reset=true`, `truncated=true`
5. If requested offset = current: return empty slice (no new data)

**Phase 02: Protocol Messages**

New WebSocket protocol messages enable explicit buffer attachment:

**manager.rs** — `PtySessionManager` enhancements:

- `get_buffer_with_offset(id: &str, from_offset: Option<u64>) → Result<TerminalBufferReplay, AppError>` — returns utf8-lossy data, current offset, reset, and truncated
- Error handling: returns `SessionNotFound` if session not in live map
- Integration with existing session lifecycle: returned data respects current buffer state

**ws.rs** — WebSocket handler:

- `ClientMsg::TermAttach { id, from_offset }` — client requests buffer replay
- Handler calls `get_buffer_with_offset()` → sends `ServerMsg::TermBuffer`
- Error behavior: session not found → logs warning and sends no response; the client confirms absence with `terminal:listDetailed` before creating a replacement
- Response `ServerMsg::TermBuffer { id, data, offset, reset, truncated }` — contains delta or full buffer plus client replay instructions

**Use Case (Phase 02+)**: On WebSocket reconnect, client sends `terminal:attach` with last stored offset instead of requesting full buffer, reducing data transfer by ~90% in typical scenarios.

**Error Handling:**

- Silent failure (no response) on session-not-found requires guarded client recovery: a timeout probes `terminal:listDetailed`; alive sessions retry with capped exponential backoff, while missing/dead sessions are created once before reattach
- No error response required; client uses timeout as a trigger to verify session state, not as proof of session death
- Server logs warning for diagnostics

**Buffer States:**

- Empty buffer (no writes yet) → offset = 0, data = ""
- Old offset (evicted from ring buffer) → fallback to full buffer with `truncated=true`
- Current offset → data = "" (no new content)
- Mid-range offset → data = delta (new bytes since offset)

**Tests (Phase 02)**: 4 Unix integration tests + 2 Windows unit tests (6/6 passing)

- `get_buffer_with_offset_returns_full_buffer_when_no_offset` — returns full buffer when from_offset=None
- `get_buffer_with_offset_returns_delta_when_offset_provided` — returns delta between two offsets
- `get_buffer_with_offset_returns_full_buffer_when_offset_too_old` — fallback to full buffer when offset evicted
- `get_buffer_with_offset_returns_error_for_nonexistent_session` — error handling for dead sessions
- Unit test (manager.rs): `get_buffer_with_offset_session_not_found`
- Unit test (manager.rs): `get_buffer_with_offset_with_some_offset_session_not_found`

**Tests (Phase 04-07):**

- 8 decision matrix rows (all 8/8 passing)
- 5 base integration tests (Phase 04, all passing)
- 1 race condition test: `create_during_backoff_cancels_pending_restart` (Phase 07, validates idempotency)
- Covers: session create/list, write/buffer, resize, kill, remove, respawn, concurrent create race

### port_forward/ (Phase 03: Port Detection ⧖)

Automatic detection and tracking of ports opened by running processes in PTY sessions.

**manager.rs** — `PortForwardManager` (Arc<RwLock<HashMap<u16, DetectedPort>>>):

- In-memory registry tracking up to 100 detected ports (prevents unbounded memory growth)
- Port states: `Provisional` (from stdout regex), `Listening` (confirmed via /proc/net/tcp), `Closed` (detected lost)
- `report_stdout_hit()` — PTY scanner fires on regex match, inserts Provisional entry, broadcasts `port:discovered`
- `confirm_listen()` — /proc poller upgrades Provisional → Listening, re-broadcasts `port:discovered` with state update
- `report_lost()` — cleanup on close detection, broadcasts `port:lost`
- Non-blocking design: write lock released before broadcasting (I/O)

**detector.rs** — Port detection logic:

- `strip_ansi()` — removes ANSI CSI (`\x1b[...m`) and OSC (`\x1b]...\x07`) sequences from stdout
- `PORT_REGEXES` (lazy via `once_cell`) — 7-pattern bank: listening on, localhost:port, http://localhost:port, etc.
- `port_is_safe()` — safety filter: blocks system ports (<1024) + danger list (22, 25, 110, 143, 3306, 5432, 6379, 27017)
- `scan_chunk()` — called per PTY output chunk, ANSI-stripped, regex applied, returns first safe port match

**session.rs** — Port state and metadata:

- `DetectedPort` — port number, owning PTY `session_id` and `incarnation`, detection source (stdout_regex or proc_net), project, state
- `PortState` enum — Provisional, Listening, Closed

**mod.rs** — Poller integration:

- Linux-only /proc/net/tcp poller (2s interval via `procfs` crate)
- Confirms provisional ports by checking /proc state, detects lost ports (no longer in /proc)
- Cross-references session IDs to label port origin (which project/session discovered it)

**Integration:**

- PtySessionManager reader thread calls `detector::scan_chunk()` for each stdout chunk
- PortForwardManager methods called from detector + poller
- EventSink broadcasts port events to all connected WebSocket clients

**Limitations:**

- Linux-only poller (Windows/macOS no /proc/net/tcp, fallback: stdout-only detection)
- Poller 2s latency before state confirmation
- Port 0 (ephemeral) not tracked (not useful for proxying)

### crypto/ (Phase Stealth-01: OPAQUE PAKE)

Server-side OPAQUE password-authenticated key exchange for the encrypt-in-transit upload feature.

**mod.rs** — Re-exports `DamHopperOpaqueSuite`, `OpaqueRegistrations`, `load_or_create_server_setup`, `validate_identifier`.

**opaque.rs** — Core OPAQUE logic:

- `DamHopperOpaqueSuite` — `CipherSuite` impl: Ristretto255 group, TripleDH key exchange, Identity KSF (no key stretching). Matches `@serenity-kit/opaque` client defaults.
- `OpaqueRegistrations` — `Arc<RwLock<HashMap<String, ServerRegistration<...>>>>` type alias; in-memory only (ephemeral — lost on server restart, which is intentional for the encrypt-in-transit model).
- `load_or_create_server_setup()` — loads `ServerSetup` from `~/.config/dam-hopper/opaque-server-setup` or generates a new one with 0o600 permissions (Unix).
- `handle_register_start(setup, identifier, request_bytes) → Vec<u8>` — returns serialized `RegistrationResponse`.
- `handle_register_finish(upload_bytes) → ServerRegistration` — deserializes `RegistrationUpload`; caller stores in `OpaqueRegistrations`.
- `handle_login_start(setup, identifier, registration, request_bytes) → (ServerLogin, Vec<u8>)` — returns intermediate login state + serialized `CredentialResponse`; caller stores state in per-connection HashMap.
- `handle_login_finish(login_state, finalization_bytes) → Zeroizing<Vec<u8>>` — completes handshake; derives 32-byte AES key via `HKDF-SHA256(session_key, label="dam-hopper-aes-256-gcm-v1")`; wrapped in `Zeroizing` (zeroed on drop).
- `validate_identifier(id) → bool` — alphanumeric + `-` + `_`, max 128 chars.

**Key security properties:**

- Passphrase never crosses the wire (OPAQUE zero-knowledge property)
- All group operations run in `tokio::task::spawn_blocking`
- Per-connection caps: 16 in-flight `ServerLogin` states, 16 active AES session keys
- `ServerSetup` private key never logged or exposed

### git/

Git operations use `git2` for repository inspection plus remote transport
operations (`fetch`, `pull`, `push`). Real `git` CLI porcelain remains for
history/worktree flows where porcelain semantics matter, and for the
`pull --ff-only` fallback when libgit2 fetch succeeds but merge application
should defer to Git itself. CLI calls are built with
`Command::new("git").args(...)`; request data is never interpolated through a
shell.

**repository.rs** — Shared git2 repository operations for status, branch reads,
fetch, pull, push, log, and branch actions.

**Shared remote credential callbacks** — Fetch, pull, and push now share the
same libgit2 `RemoteCallbacks` credential priority:

1. loaded `SshCredStore` key + passphrase from `POST /api/ssh/keys/load`
2. SSH agent
3. Git credential helper
4. default credentials

Push uses `Remote::push(...)` with pack/upload progress callbacks and
`push_update_reference` rejection handling. The backend intentionally pushes
only the checked-out branch to its configured upstream; missing
`branch.<name>.remote` or `branch.<name>.merge` returns a clear server error
instead of emulating broader `git push` inference modes.

**Git push credential flow (Phase 01)** — Push is now a first-class root-aware
operation in the UI and the backend. `ProjectInfoPanel`, `WorkspaceGitPanel`,
and `GitPage` forward the selected VCS root through the existing push payload,
and the server resolves that root before running the shared libgit2 push path.
Successful pushes invalidate the broader Git cache set so branches, git log,
project status, diffs, conflicts, file tree, and project list refresh together
after the retry completes.

**Git push and SSH retry follow-up (Phase 03)** — The web Git page now uses the
same root-aware push path for single-project views, the SSH passphrase retry
dialog can optionally save credentials for later, and retry status text is
shared across the frontend instead of being duplicated per caller. The retry
dialog loads credentials into the shared backend callback stack; it does not
depend on CLI `ssh_askpass` helpers or TTY prompt shims. The explicit
force-push action only changes the push refspec mode; it does not relax the
drop/undo protections for pushed or shared history.

**Worktree-aware Git addressing (Phase 04 complete)** — Git addressing is
`(project, selected target, nested root)`, with the server validating the
selected target before discovering its nested roots. REST/WebSocket Git and
status operations, including bulk Fetch/Pull, carry `worktreePath`; worktree
management remains anchored to the configured project root. Frontend Git query
and cache identities, plus mutation invalidation, include `targetKey`, and
stage/unstage status refresh is target-scoped. Regression coverage verifies
target validation, propagation, cache isolation, and status refresh behavior.
Editor/diff isolation is complete, and terminal command/profile identity now
uses stable opaque target discriminators while session metadata retains the
canonical target path.

**commit_file_ops.rs** — IntelliJ-compatible history actions:

- `drop_commit()` — local unpushed commit removal; uses hard reset for `HEAD`
  and `rebase --onto` for non-HEAD commits with descendants.
- `drop_commit_files()` — removes selected file changes from an unpushed commit
  while preserving the rest of the commit.
- `revert_commit()` — creates an inverse commit for safe shared-history changes.
- `revert_commit_files()` — applies inverse selected-file changes to the
  worktree without rewriting history.

History rewrite preflights check dirty worktree state, root commits,
reachability, upstream pushed/shared status, detached HEAD, and active
merge/rebase/cherry-pick operations. Safe operations like revert stay available
for shared history, while blocked or conflicted rewrite operations return
`GitActionResult` with `blockedReason`, `recovery`, and `recommendation` so the
web UI can show recoverable state instead of generic errors.

**types.rs** — Shared data types:

- `DiffFileEntry` — file status, staged flag, additions/deletions, optional root/submodule metadata
- `FileDiffContent` — hunks, original+modified content, language detection, binary flag
- `HunkInfo` — hunk position + header for unified diff display
- `ConflictFile` — 3-way merge content (ancestor, ours, theirs)

**diff.rs** (Phase 01) — Diff and conflict operations:

- `get_diff_files()` — list changed files (staged + unstaged)
- `get_file_diff()` — hunked diff for single file
- `append_submodule_status_entries()` — surfaces dirty submodule gitlinks from parent repo status
- `stage_files()` — stage paths for commit
- `unstage_files()` — unstage paths
- `discard_file()` — restore file from HEAD
- `discard_hunk()` — revert single hunk (destructive)
- `get_conflicts()` — list merge-conflicted files with 3-way content
- `resolve_conflict()` — write resolved content, mark resolved

### agent_store/

Distributes `.claude/` items across projects.

**distributor.rs** — Ship/unship/absorb operations.

**health_check.rs** — Detects broken symlinks.

### api/

HTTP request handlers + WebSocket upgrade.

**router.rs** — Route definitions (ide_explorer routes are feature-gated).

**fs.rs** — File explorer handlers:

- `GET /api/fs/list` — directory contents with metadata
- `GET /api/fs/read` — file text/binary content
- `GET /api/fs/stat` — file metadata
- `GET /api/fs/search` (Phase 07) — global file content search, .gitignore-aware, results capped at 1000

**git_diff.rs** (Phase 01) — Git diff/staging/conflict handlers:

- `GET /api/git/:project/diff?root=ID` — list changed files for a VCS root
- `GET /api/git/:project/diff?root=*` — read-only aggregate local changes grouped by VCS root metadata
- `GET /api/git/:project/diff/file?path=REL&root=ID` — file diff with hunks inside one root
- `POST /api/git/:project/stage` — stage files, root-aware
- `POST /api/git/:project/unstage` — unstage files, root-aware
- `POST /api/git/:project/discard` — discard file changes, root-aware
- `POST /api/git/:project/discard-hunk` — discard single hunk, root-aware
- `GET /api/git/:project/conflicts?root=ID` — list merge conflicts for one root
- `POST /api/git/:project/resolve` — resolve merge conflict, root-aware
- `POST /api/git/:project/commit` — create commit, supports `amend` and root scoping

**git.rs** — Git history and branch action handlers:

- `GET /api/git/:project/branches?root=ID` — list local and remote branches for one root
- `GET /api/git/:project/roots` — discover primary, submodule, and nested repo roots
- `POST /api/git/:project/branches` — create branch, optional checkout, root-aware
- `POST /api/git/:project/branches/checkout` — checkout branch with `normal`, `stash`, or `force`, root-aware
- `POST /api/git/:project/branches/update` — update a branch from its remote tracking branch, root-aware
- `POST /api/git/:project/cherry-pick` — cherry-pick a commit
- `POST /api/git/:project/reset` — reset current branch with `soft`, `mixed`, `hard`, or `keep`
- `POST /api/git/:project/undo-last-commit` — safe local commit recovery; blocks pushed/shared history and recommends revert for published commits
- `POST /api/git/:project/commit/:hash/drop` — drop an unpushed commit by default; pushed/shared commits are blocked
- `POST /api/git/:project/commit/:hash/drop-files` — drop selected changes from an unpushed commit by default; pushed/shared commits are blocked
- `POST /api/git/:project/commit/:hash/revert` — revert a commit with an inverse commit
- `POST /api/git/:project/commit/:hash/revert-files` — apply inverse selected-file changes to the worktree
- `POST /api/git/push` — root-aware single-repo push; body carries `{ project, root?, force? }`

**port_forward.rs** (Phase 03) — Port detection handler:

- `GET /api/ports` — returns all detected ports: `{ "ports": [{ port, session_id, incarnation, project, state }, ...] }`; `incarnation` identifies the concrete PTY instance that owns the detection
- On non-Linux or when manager absent: returns empty ports array
- Protected endpoint (requires auth token)

**error.rs** — Maps AppError to HTTP status codes.

**ws_protocol.rs** — WS message envelopes. Phase Stealth-01 additions:

- `ClientMsg`: `AuthRegisterStart`, `AuthRegisterFinish` (with `overwrite: bool`), `AuthLoginStart`, `AuthLoginFinish`, `FsPutBegin`, `FsPutChunk`, `FsPutCommit`, `FsPutSave`
- `ServerMsg`: `AuthRegisterStartResponse`, `AuthRegisterFinishResponse`, `AuthLoginStartResponse`, `AuthLoginFinishResponse`, `FsPutBeginOk`, `FsPutChunkAck`, `FsPutResult`, `FsPutSaveResult`

All `auth:*` and `fs:put_*` kind names are intentionally neutral (no `stealth:` prefix) to avoid IDS fingerprinting.

### state.rs

`AppState` holds:

- Workspace config (Arc<RwLock>)
- PTY manager (cheap clone pattern)
- FS subsystem (cheap clone pattern)
- Auth token (Arc<String>)
- Feature flags (captured at startup)
- `opaque_server_setup: Arc<ServerSetup<DamHopperOpaqueSuite>>` — long-term OPAQUE server keypair, loaded from disk at startup (Phase Stealth-01)
- `opaque_registrations: OpaqueRegistrations` — in-memory OPAQUE credential store, shared across all WS connections (Phase Stealth-01)

### main.rs

Server bootstrap:

- Config loading
- PTY manager init
- FS subsystem init
- `load_or_create_server_setup()` — OPAQUE server keypair (Phase Stealth-01)
- `AppState` construction
- Router registration (ide_explorer routes conditional)
- Optional `--web-dir` enables same-process static serving for an explicitly
  selected web root; without it, the API router is API-only. The independent
  `dam-hopper-web` binary owns the dedicated release web-host path.
- Port binding + graceful shutdown

## SYSTEMD SERVICE: role-aware units, durable activation, and recovery

Manifest v1 has two runtime layers. Phase 04 renders and validates role-aware
unit candidates; Phase 05 is the manager's lock-scoped transaction coordinator
that installs, probes, commits, rolls back, and reconciles those candidates.
systemd supervises only the concrete units selected by the committed state. The
guarded format-2 runner remains a separate legacy path until migration.

The owner decision intentionally makes the API service `root` for this MVP.
The dedicated web service is isolated under `dam-hopper-web`; it must not gain
access to API credentials, user state, project files, or manager state. This is
not a claim that the broad API identity is least privilege.

### Role projection and unit independence

Manifest inventory roles are algebraic:

- `server` selects `common` plus `server` entries and renders
  `dam-hopper-api.service`.
- `web` selects `common` plus `web` entries and renders
  `dam-hopper-web.service` plus its sysusers input.
- `both` selects the complete inventory and renders both app units for one
  exact release tag/version and manager transaction.

The fixed service contracts are:

| Service | Identity | Concrete executable | Bind |
| --- | --- | --- | --- |
| `dam-hopper-recovery.service` | `root:root` | `<release-root>/bin/dam-hopper-manager recover --boot` | no listener |
| `dam-hopper-api.service` | `root:root` | `<release-root>/bin/dam-hopper-server` | `0.0.0.0:4801` |
| `dam-hopper-web.service` | `dam-hopper-web:dam-hopper-web` | `<release-root>/bin/dam-hopper-web` | `0.0.0.0:4802` |

API and web units have no dependency on each other, shared process, proxy, or
role coupling. Both require/follow the recovery unit. Stopping or restarting
one application role must not stop the other. The legacy `4800` listener must
be free before activation, and wildcard API/web binds remain subject to host
firewall and Tailscale ACL policy.

### Unit templates and candidate pipeline

The publisher ships these exact inventory paths:

- `deploy/systemd/dam-hopper-recovery.service.in`
- `deploy/systemd/dam-hopper-api.service.in`
- `deploy/systemd/dam-hopper-web.service.in`
- `deploy/sysusers.d/dam-hopper-web.conf`

`server/src/linux_release/unit.rs` accepts only
`@RELEASE_ROOT@`, `@RELEASE_VERSION@`, `@PUBLIC_CONFIG@`, and
`@API_ORIGINS@`. The render context validates absolute release/config paths,
forbids control characters, validates stable SemVer and exact web origins, and
serializes origins as one comma-separated `DAM_HOPPER_CORS_ORIGINS` value.
Unknown and unresolved uppercase tokens fail closed. `unit_parser.rs` parses
rendered text; `unit_policy.rs` enforces service-specific properties before a
candidate is accepted.

The candidate path is:

```text
validated archive + selected role
  -> /opt/dam-hopper/.staging/<transaction-id>/
  -> /opt/dam-hopper/releases/<tag>/<role>/
  -> render selected app/recovery unit(s) and web sysusers into
     /var/lib/dam-hopper-manager/pending-units/
  -> write /var/lib/dam-hopper-manager/pending-host-config.json
  -> systemd-analyze verify (when available)
  -> persist pending in /var/lib/dam-hopper-manager/state.json
  -> explicit start installs concrete files into /etc/systemd/system/
```

The `systemd.rs` adapter invokes `systemd-analyze`, `systemd-sysusers`, and
`systemctl` through argument vectors, never a shell. Rendered files are
candidates until `start` takes the deployment lock and switches them.

### API unit contract

`dam-hopper-api.service` has explicit:

- `Type=exec`, `User=root`, `Group=root`, and `WorkingDirectory=/root`;
- `HOME=/root`, `XDG_CONFIG_HOME=/etc/dam-hopper`, `RUST_LOG=info`,
  `RUST_ENV=production`, and exact `DAM_HOPPER_CORS_ORIGINS`;
- optional `EnvironmentFile=-/etc/dam-hopper/server.env` followed by optional
  generated `server-safety.env`;
- `ExecStart=<release-root>/bin/dam-hopper-server --config
  /etc/dam-hopper/dam-hopper.toml --host 0.0.0.0 --port 4801`;
- `Restart=on-failure`, `RestartSec=5s`, `KillSignal=SIGTERM`,
  `KillMode=mixed`, and `TimeoutStopSec=20s`; and
- `UMask=0077`, `NoNewPrivileges=false`, and journald stdout/stderr.

`NoNewPrivileges=false` is deliberate because API-managed interactive PTYs may
need existing `sudo` behavior. The root identity gives the API broad host
authority; that accepted residual risk remains visible in release reviews. The
unit has no `--no-auth` flag; production environment and exact CORS values
remain explicit.

### Web unit contract and isolation

`dam-hopper-web.service` uses:

- `Type=exec`, `User=dam-hopper-web`, `Group=dam-hopper-web`;
- a concrete matching release command:
  `.../bin/dam-hopper-web --root .../web --host 0.0.0.0 --port 4802
  --runtime-config /etc/dam-hopper/host-config.json --release-version <version>`;
- `Restart=on-failure`, `RestartSec=5s`, `KillSignal=SIGTERM`,
  `KillMode=mixed`, `TimeoutStopSec=10s`, and `UMask=0077`;
- `NoNewPrivileges=true`, empty capability and ambient-capability sets,
  `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`,
  `PrivateDevices=true`, kernel/control-group/module protection,
  `MemoryDenyWriteExecute=true`, `LockPersonality=true`,
  `RestrictRealtime=true`, and `RestrictSUIDSGID=true`; and
- `ReadOnlyPaths` for only the selected release root and public host config.

The policy rejects `EnvironmentFile` and `ReadWritePaths` in the web unit. The
web process is static and GET/HEAD-only; it receives no API environment/token,
SQLite, project, upload, home, or manager-state path and does not write its
release tree.

### Web identity and ownership

`deploy/sysusers.d/dam-hopper-web.conf` declares the fixed system identity:

```text
u dam-hopper-web - "DamHopper Web Host" /nonexistent /sbin/nologin
```

`account.rs` resolves the passwd entry before activation and rejects a missing
account, UID 0, interactive shells, or unrestricted homes. The sysusers
declaration grants no supplementary groups; the unit uses the account as both
user and primary group. `systemd-sysusers` creation is idempotent and account
persistence after rollback is intentional.

`ownership.rs` rejects symbolic links and special files. Its recursive release
check expects directories at `0755`, executable files directly under `bin/` at
`0755`, and other regular release files at `0644`; with `require_root`, every
checked path must have UID 0. Rendered unit/sysusers files are written at
`0644`. Manager transaction directories are `0700`; private state/lock files
are `0600`.

The relevant mutable/immutable paths are:

| Path | Meaning |
| --- | --- |
| `/opt/dam-hopper/releases/<tag>/<role>/` | root-owned immutable role view |
| `/var/lib/dam-hopper-manager/pending-units/` | rendered app/recovery/sysusers candidates |
| `/var/lib/dam-hopper-manager/pending-host-config.json` | candidate public web config |
| `/var/lib/dam-hopper-manager/backups/<tx-id>/` | transaction-owned unit/config backups |
| `/var/lib/dam-hopper-manager/state.json` | authoritative state envelope |
| `/etc/dam-hopper/host.toml` | recorded role and exact allowed origins |
| `/etc/dam-hopper/host-config.json` | active public runtime config |
| `/etc/systemd/system/` | concrete unit destination |
| `/opt/dam-hopper/current` | repaired active-view convenience link |

### Durable activation state machine

The authoritative state envelope records generation, active/previous releases,
pending candidate, transaction phase, hashes, and latest sanitized failure.
The valid forward graph is:

`ABSENT | ACTIVE → STAGED → PENDING → QUIESCED → SWITCHED → PROBING → COMMITTED`

`install` and `role set` stop at `PENDING`. `start` owns the remainder under
one root deployment lock:

```text
lock/reconcile -> validate old + candidate -> QUIESCED
  -> stop/disable selected old units and prove cgroups/listeners/SQLite clear
  -> install candidate units/config and daemon-reload -> SWITCHED
  -> start selected candidate -> PROBING -> exact health stability
  -> enable selected/disable removed -> atomic COMMITTED state
  -> repair current -> collect only verified unreferenced trees
```

Each durable boundary uses a same-directory temporary file, write and sync,
atomic rename, and parent-directory sync. `current` never decides which
release is active.

### Health stability gate

For each selected service, the manager requires at most **20 seconds** for
initial readiness, then **20 consecutive probes at 500 ms** (**10 seconds** of
uninterrupted stability). Each probe checks active `MainPID`, expected
executable/identity, exact listener (`4801` API or `4802` web), and loopback
JSON health (`/api/health` or `/__dam-hopper/health`) with schema `1`,
`status: "ok"`, expected role/version, JSON content type, no redirects, and a
bounded body. Transient failures reset the count; identity, executable,
listener, schema, role, or version mismatches fail immediately.

### Recovery and rollback

`dam-hopper-recovery.service` is a root `Type=oneshot` unit running
`dam-hopper-manager recover --boot` after `local-fs.target` and before both
application units. The app units require/follow it. Recovery classifies durable
state instead of guessing:

| Durable point | Recovery result |
| --- | --- |
| `STAGED`/`PENDING` | Leave old active release; keep candidate disabled |
| `QUIESCED`/`SWITCHED`/`PROBING` | Restore exact transaction backups and verify old release |
| `COMMITTED` | Keep committed release; repair enablement and `current` |
| Missing/corrupt or unowned/hash-mismatched state | `RECOVERY_REQUIRED`; block app units |

Automatic activation failure stops the candidate, restores transaction-owned
units/config/state, and reruns the same health gate. First-install failure
returns to no active release with app units disabled. Manual
`sudo dam-hopper rollback` promotes `previous` through the same activation,
probe, and commit rules; failure first attempts to restore the original active
release, otherwise returns `RECOVERY_REQUIRED`. Retention keeps active, one
previous known-good, pending/latest-failed, and transaction-referenced views;
deletion occurs only after manifest and ownership verification.

### Runtime evidence boundary

`process.rs` queries systemd `MainPID`, reads effective UID/GID and
`/proc/<pid>/exe`, and records the process cgroup. Its listener parser checks
`/proc/net/tcp` and `/proc/net/tcp6` for state `0A` (LISTEN), including ports
4800, 4801, and 4802. `process_holders.rs` rejects foreign SQLite holders
before quiesce. `health.rs` combines these observations with exact loopback
JSON checks. Temporary-tree tests do not prove SELinux labels, firewall ACLs,
or host-specific systemd/account policy.

### Legacy format-2 runner (retained until migration)

`deploy/systemd/dam-hopper.service` and `pnpm linux:production` remain the
guarded administrator path until migration/retirement. That path consumes an
exact server-only format-2 marker, uses the historical `User=loidinh`
identity and fixed `/opt/dam-hopper/bin` executable, and does not understand
Manifest v1 role inventory or the API/web unit names. It must not share the
`4800`/SQLite ownership with another launch. Full details and the historical
evidence boundary are in [Linux systemd](./linux-systemd.md).

Phase 05 module proofs are covered by the focused state-machine, health, and
unit-policy integration suites. Live distro evidence (systemd enablement,
SELinux labels, firewall ACLs, account provisioning, and rollback rehearsal)
remains host/deployment-specific.

## Host resource monitoring (current delivery; remediation deferred)

The current delivery boundary is monitoring-only. Phase 03 implements one
shared cached monitor, the compatible legacy metrics projection, versioned
read-only snapshot and alert APIs, and bounded alert events. Phase 06 implements
the in-app diagnosis UI. Phase 07 packages, validates, and rolls out only those
observation surfaces. It must not enable, package, exercise, or claim support
for host mutation.

The top-nav host-resource popover presents the cached snapshot, bounded mixed
alert history, and diagnostic evidence, with no remediation controls. The
legacy memory `alert` remains stable; the snapshot's additive `currentAlerts`
array carries concurrent active thermal/disk incidents. A valid
`host:alertChanged` event updates only its matching cached incident and
invalidates the read-only queries; recovery (`resolvedAt`, including zero)
removes only that incident. The browser rejects malformed or unexpected nested
evidence before changing cache state. An explicit empty `currentAlerts` array
clears resource presentation, while a missing field is retained for
old-server compatibility rather than interpreted as recovery. REST projections
remain authoritative after reconnect, missed events, or profile changes. Deep
Linux reads degrade per signal, while `GET /api/system/metrics` remains the
compatibility fallback and rollback seam.

Re-authentication, mutation lifecycle/audit, local privileged IPC, enrollment,
and fixed host operations are one future remediation backlog. Existing
server-side lifecycle scaffolding, where present, is outside the current
delivery and has no privileged executor. It must remain incapable of host
mutation. The deferred threat model below is retained for a future design gate;
it is not a dependency of Phase 07.

### Data flow and trust boundary

```
Linux procfs / PSI / cgroup v2
  -> HostResourceMonitor (read-only, bounded, cached)
  -> snapshot (`alert` + additive `currentAlerts`), mixed alert history,
     and `host:alertChanged`
  -> validated browser cache + diagnostics UI
```

`HostResourceMonitor` has no dependency on `HostActionService`, helper IPC, or
action configuration. Alert collection and delivery can only publish bounded,
sanitized state. The resource lifecycle emits one event per changed target, so
concurrent disk and thermal incidents remain independent and recovery is
per-target. Current and legacy payloads share the existing event channel; the
client's strict discriminator/evidence validation preserves old payload support
without trusting malformed additive data. The existing `GET /api/system/metrics`
remains a compatible basic-metrics endpoint; new resource APIs are versioned
siblings. Phase 03 moves it to the shared monitor's cached projection without
changing its response shape.

### Host-resource glance panel (current UI)

The top-nav popover keeps the same monitoring-only boundary and existing query
ownership. It combines the cached deep snapshot with the cached compatibility
metrics; opening the popover may poll the compatibility projection, but it must
not start another host sampler or add a second telemetry endpoint.

The visible body uses two tiers:

- the glance tier appears first and keeps a stable order: memory used, CPU,
  pinned storage, every reported temperature sensor, then battery/power;
- percentage-capable values show a numeric value beside a bounded meter. Memory
  uses `usedBytes / totalBytes`, not available memory. Battery adds charging
  state and instantaneous watts when reported;
- temperature rows keep the same compact meter-like layout but report Celsius.
  They must not fabricate a percentage until the telemetry contract provides a
  meaningful per-sensor range or threshold;
- one disclosure contains memory diagnosis, pressure, cache/slab/swap, storage
  inventory, process/cgroup scope, alert evidence, and incident history. The
  active status remains visible outside the disclosure.

Storage pinning is presentation preference only. Global UI config stores one
optional mount point as `hostResourcePinnedMount` on the API and
`host_resource_pinned_mount` in TOML. Non-null values are 1–4096 UTF-8 bytes;
`null` clears the pin. The browser resolves it against the current
`HostMetrics.disks` list and never sends it into monitoring, alert
classification, or telemetry. A missing mount stays visibly missing until the
user changes or clears the pin; it must not silently bind to a different
filesystem. With no saved pin, the compatibility `HostMetrics.disk` value is
the default. The pinned mount percentage is the primary storage value and the
compatibility disk percentage is supporting `(overall …)` context; this label
is not an aggregate sum across potentially overlapping mounts.

The component dataflow is:

```
HostResourceMonitor cache
  -> resource snapshot + compatibility metrics
  -> TanStack Query cache
  -> glance metric projection + diagnostic detail projection
Global UiConfig
  -> optional pinned mount
  -> current-disk resolver
  -> glance storage row only
```

Key invariants:

- missing, unsupported, and stale values never render as zero;
- a preference update cannot change sampling, alerts, or host state;
- the selected mount and the compatibility/overall value remain distinct;
- meter labels, numbers, warning text, and disclosure controls remain
  keyboard- and screen-reader-operable; color is never the only state cue.

The release image is built explicitly for `linux/amd64` and uses pinned base
image digests. Phase 07 evidence measures clean shutdown only for a server with
no active tunnel sessions; active tunnel disposal has a separate three-second
child-process grace period. The full release command set includes Rust
format/check/tests, UI unit/type/browser tests, lint, web/server builds, and the
Docker build. The release owner approved Phase 07 completion with the
still-unobserved Windows CI result, canary-host profiling, staged
monitor/in-app-alert canary, and rollback rehearsal deferred as post-release
work. Those checks remain unexecuted and are not passed evidence.

### Snapshot boundaries

`HostResourceSnapshotV1` is serialized in camelCase and reports explicit
availability for each deep section. Collection is read-only and uses startup-owned
`/proc`, `/sys`, and cgroup roots; callers cannot provide alternate roots. Every
text read is bounded by the actual stream at 256 KiB, and oversize, invalid UTF-8,
permission, parse, and race failures degrade the relevant section instead of
failing the snapshot.

Linux deep metrics include memory PSI (`some`/`full`) and discovered unified cgroup
v2 membership. Cgroup records report current usage, max/high limits (including
unlimited markers), file cache, memory events, and cgroup PSI. Mount and
membership validation runs before cgroup reads; unsupported or invalid layouts
remain explicitly degraded.

Linux battery telemetry is read from the startup-owned `/sys/class/power_supply`
tree and remains part of the same cached snapshot. Only entries classified as
`Battery` contribute. Direct `energy_now` and `power_now` micro-units become Wh
and W respectively; charge, current, and voltage are never combined to infer a
missing measurement. Multiple batteries contribute a value only when every
classified battery supplies the same direct attribute, so partial totals are not
reported. Capacity uses the direct percentage for one battery and the ratio of
complete summed `energy_now`/`energy_full` pairs for multiple batteries. Missing
optional values serialize as `null`; the top-level `battery` field is additive
and optional for clients interoperating with older servers. The serialized
`battery` v1 object contains `count`, `capacityPercent`, `status`,
`remainingEnergyWh`, `instantaneousPowerW`, and `availability`; status is one of
`charging`,
`discharging`, `full`, `notCharging`, `unknown`, or `mixed`. An unrecognized or
malformed raw status is treated as malformed and does not become a fabricated
status value. Malformed, denied, unsupported, and stale reads retain explicit
availability (and stale cached values where applicable). Non-Linux platforms
report battery availability as `unsupported`.

Process inventory is bounded to 4,096 scanned PIDs, 20 returned processes, and PSS
reads for the top 5 by RSS, with a 100 ms deadline. The response includes scan,
truncation, deadline, skipped, and issue counters for permission denied, invalid
UTF-8, malformed, and disappeared process files. Process strings are capped at
256 bytes.

Cache attribution is descriptive rather than additive accounting. Labels identify
system-file cache, cgroup-file cache, process-file RSS, mount-file mappings, or
unattributed shared cache; clients must not sum overlapping labels. Each carries
optional bytes, confidence, and collection method.

### Deferred remediation design: fixed v1 contract

This subsection and the remaining remediation subsections are backlog design,
not current behavior or Phase 07 scope. Re-activation requires a new
architecture/security gate and explicit product sign-off. Until then no
privileged component is packaged or enrolled, and no mutation capability may be
advertised as available.

The deferred lifecycle must fail closed: approvals are consumed once;
lifecycle outcomes are recorded in bounded local audit storage; and unavailable
audit or execution state cannot be reported as success. It must perform no OS
password, sudo/polkit/PTY escalation, generic command execution, or automatic
remediation.

- The only client-selectable value is a typed, allowlisted intent. The client
  cannot supply a command, shell, executable path, signal number, process
  group, raw PID, cache mode, or writable kernel path.
- An approval binds the authenticated actor, canonical action digest, immutable
  target identity, nonce, issued-at time, expiry, and single-use state. The
  canonical target includes host PID namespace inode, mount namespace inode,
  user namespace inode, boot ID, PID, process start ticks, UID, cgroup, and
  bounded command identity where the action type needs a process target.
- IPC is a versioned `AF_UNIX SOCK_SEQPACKET` enum protocol with one 8 KiB
  request frame per connection. It uses close-on-exec descriptors, rejects
  truncated/multiple frames and `SCM_RIGHTS`, and accepts no client-supplied
  file descriptor. The helper enforces an issued-at window, request-ID
  deduplication, fixed action-specific rate limits, and structured errors that
  contain no credentials, approval material, raw command lines, or environment
  values.
- Process termination prefers a pidfd. A permitted fallback re-reads host
  namespace inodes, boot ID, UID, start ticks, cgroup, and bounded command
  identity immediately before a fixed `SIGTERM`. It never acts on PID 1 or a
  process group; `SIGKILL` is a different, separately approved action.
- The cache action is globally scoped and therefore exceptional: it always
  calls `sync` first, then writes only the fixed value `3` to `drop_caches`.
  It has a global warning, cooldown, before/after samples, helper-side policy,
  and no client-selected cache value. It is not mount or workspace cleanup.
- Actions are unavailable with `--no-auth`, without MongoDB-backed re-auth,
  on non-Linux hosts, in Docker/nohup installs, or whenever enrollment, IPC,
  policy, or target revalidation is unavailable.

### Deferred remediation design: helper enrollment proof

Enrollment requires a feature probe for both `SO_PEERPIDFD` and
`SO_PASSPIDFD`; an unavailable or failing probe makes actions unavailable. The
helper accepts a local IPC request only after all of the following checks
succeed:

1. It obtains the connected peer's pidfd atomically with `SO_PEERPIDFD` and
   checks `SO_PEERCRED` against the configured enrolled server effective UID.
   It does not call `pidfd_open()` on the numeric credential PID.
2. It reads the expected unit's active `MainPID` from the local system manager
   and compares it with the still-pinned peer pidfd identity. Sharing a unit
   cgroup is insufficient: PTY, shell, and other descendant processes are
   rejected.
3. It enables `SO_PASSPIDFD` and requires the kernel-provided `SCM_PIDFD` on
   the single request frame. That per-request pidfd must again identify the
   enrolled service `MainPID`; this rejects a socket inherited across `fork` or
   `exec`. `SCM_RIGHTS`, missing ancillary data, extra ancillary records, and
   a second request frame are denied.
4. The client creates its socket with `SOCK_CLOEXEC`; the helper accepts with
   `accept4(..., SOCK_CLOEXEC)`, closes the connection after one receipt, and
   never passes that descriptor to another process.
5. The pinned per-request pidfd verifies the expected cgroup and executable
   device/inode against the root-owned enrolled server identity.
6. The helper executable, socket, unit, and policy identity have the expected
   root ownership and non-writable modes.
7. The request is a supported versioned action and satisfies the fixed v1
   contract above.

Failure at any point is an `unavailable` or `denied` result and causes no
signal or kernel write. Same-user means the enrolled server's effective UID,
not the browser account name. A remote browser is never a polkit agent and its
password is never accepted or transported.

### Deferred remediation design: host-namespace target proof

The enrolled helper must run in the host PID, mount, and user namespaces. It
opens and revalidates the target using its own host `/proc`, never a client
provided proc root or namespace path. At approval and immediately before the
fixed action, it compares the target's host PID/mount/user namespace inode
identities, boot ID, PID, start ticks, UID, cgroup, and bounded command
identity with the canonical target. It rejects absent, changed, non-host, or
unreadable namespace evidence. This denies ambiguous nested-systemd and
container targets rather than attempting a best-effort signal.

### Deferred remediation threat model: abuse-case matrix

| Asset or entry point        | Abuse                                        | Required control                                                                                          | Residual risk and test                                                                                        |
| --------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Browser JWT or cookie       | Stolen token or CSRF creates an action       | Protected route, fresh re-auth, Origin/Content-Type checks for cookie requests, one-shot bound approval   | A valid in-session actor can approve an allowed action; reject expired, reused, and mismatched approvals      |
| Browser intent body         | Command, signal, PID-only, or path injection | Canonical typed action and server-resolved immutable target                                               | Future action enum defects remain possible; property-test rejected unknown fields                             |
| Stale UI target             | PID reuse or changed cgroup/namespace        | Bind host namespace inodes, boot ID/start ticks/UID/cgroup/identity and re-read immediately before action | Process can exit between checks; return failed receipt without retrying another PID                           |
| Approval or IPC frame       | Replay, oversized input, spoofed request     | Nonce and request-ID single use, 8 KiB cap, freshness window, helper dedupe                               | Bounded in-memory/durable dedupe retention; test replay and over-limit frames                                 |
| Server process              | Compromise invokes helper                    | Helper peer proof, fixed enum, target checks, cooldown, local audit                                       | An enrolled server compromise can request an allowed action; security owner must accept this v1 residual risk |
| Same-UID local process      | Connects directly to helper                  | `SO_PEERCRED` PID equals systemd `MainPID`, pinned pidfd/executable/cgroup, root-owned socket/policy      | System-manager proof may be unsupported; unsupported layouts remain read-only                                 |
| Namespace or cgroup view    | Targets another host/container process       | Helper validates host PID/mount/user namespace inodes, boot ID, and target cgroup/UID; no PID-only action | Namespace layouts can be ambiguous; deny if identity proof is incomplete                                      |
| Global cache drop           | Availability or I/O denial of service        | Fixed `sync` + `3`, explicit warning, cooldown, rate limit, audit                                         | The action is inherently global; use only in operator-approved enrollment                                     |
| Helper or audit files       | Tampering or suppression                     | Root-owned binary/socket/policy; append-only bounded local audit where supported                          | Local root can tamper; include verification status in support checks                                          |
| Monitor, alerts, or WS      | Automatic remediation or evidence leakage    | Negative dependency boundary, sanitized bounded events, REST snapshot authoritative                       | Broadcast loss is expected; test monitor cannot import action modules                                         |
| Partial failure or shutdown | Half-completed action or unsafe retry        | Owned queue, cancellation, receipt state, no automatic retry                                              | Syscalls are not reversible; record outcome and require a new approval                                        |

### Deferred remediation evidence: Phase 01 host feasibility

The development host was checked read-only on 2026-08-08. It runs Fedora 44
with Linux 7.1.5, systemd 259 as PID 1, unified cgroup v2 mounted at
`/sys/fs/cgroup`, readable `/proc/meminfo` and memory PSI, and SELinux in
enforcing mode. The current Codex process is an unprivileged user-session
cgroup. No DamHopper systemd unit, helper binary, Unix socket, or root-owned
policy exists on this host.

This confirms only that the deferred systemd/cgroup/peer-credential design is
feasible on that host; it does not prove enrollment or authorize implementation.
Any future remediation phase must validate the actual installed unit, binary,
socket, ownership, and peer identity before it reports capability. Current
delivery remains monitoring-only.

### Deferred remediation sign-off before privileged implementation

- A security owner must accept the residual risk of a compromised enrolled
  server requesting only the helper's fixed action set.
- The support matrix must define the minimum kernel, distro, systemd, and pidfd
  fallback policy. Unknown or unsupported layouts remain monitoring-only.
- The operator must explicitly accept the retention target for the local action
  audit and whether the global cache action is permitted at all.

No privileged helper, auto-remediation, sudo/PTY escalation, generic command
execution, or development bypass may enter a delivery phase before these
decisions are recorded and the architecture gate is reopened.

## Data Flow: File List Request

```
GET /api/fs/list?project=web&path=src
         ↓
    resolve() handler
         ↓
    AppState.project_path("web")
    → finds project in config
    → returns absolute path
         ↓
    ProjectSandbox.validate("web", proposed_path)
    → checks path stays within project root
    → returns canonical path
         ↓
    ops::list_dir()
    → tokio::fs::read_dir()
    → collects DirEntry (name, kind, size, mtime, isSymlink)
         ↓
    JSON response: { entries: [...] }
```

## Data Flow: File Search Request (Phase 07)

```
GET /api/fs/search?project=web&q=pattern[&case=true&max=50]
         ↓
    search() handler (fs.rs)
         ↓
    ProjectSandbox.validate(project, search_root)
         ↓
    spawn_blocking: walk_dir via ignore crate (respects .gitignore)
    → filter by path + file type
    → regex-escaped plain text search
    → collect matches (file, line, column, context)
         ↓
    cap results at max (default 200, hardcap 1000)
         ↓
    JSON response: { results: [{ file: "...", matches: [...] }] }
```

## Frontend Components (Phase 06+)

Frontend now uses a split host/package layout: `apps/web` is the thin Vite browser host, `apps/native` is the implemented Tauri v2 remote client, and `packages/ui` contains the shared React UI. The hosts own DOM mount plus transport/query bootstrapping; the shared package owns components, hooks, stores, styles, assets, and tests.

### Component Architecture

**TerminalPanel** (`packages/ui/src/components/organisms/TerminalPanel.tsx`)

- Renders single terminal session using xterm.js
- Subscribes to Transport events: `onTerminalExit`, `onProcessRestarted`, `onTransportStatus`
- Owns a session-local xterm search controller backed by the official search addon
- Routes Ctrl/Cmd+F from the active pane to that controller; the browser default is suppressed and the keystroke stays client-only, so it never enters PTY input. Ctrl/Cmd+Shift+F remains the file-search shortcut.
- Applies the shared persisted terminal font size to its live xterm instance, invalidates terminal geometry, and schedules the existing fit path; xterm's resize event remains the only PTY dimension writer.
- Consumes editable page-global font shortcuts before browser or terminal input. The defaults use physical keys `Ctrl+Alt+Shift+Equal` (the `+` key) and `Ctrl+Alt+Minus`; the xterm handler prevents a matching shortcut from reaching the PTY twice.
- Stores the base xterm key handler so temporary `PaneContainer` routing can be removed without disabling terminal shortcuts, including split-to-runtime transitions
- Closes find state for inactive, detached, or reparented terminals so stale queries and decorations do not survive host changes
- Writes ANSI banners for lifecycle events:
  - Exit: Green (code=0), Red (code≠0, no restart), Yellow (willRestart)
  - Restart: Yellow `[Process restarted (#N)]`
  - Reconnect: Dim `[Reconnecting…]` / `[Reconnected]`
- Reconnects through one in-flight `terminal:attach`; a timeout verifies session liveness, then retries with capped exponential backoff or creates one confirmed-dead replacement

### Browser-local terminal output activity

Runtime terminal rows derive recent-output activity from the existing terminal
rendering path; there is no server, SSE, or WebSocket protocol change. The data
flow is:

```
/ws terminal:output { kind, id, data }
  -> WsTransport listener dispatch keyed by terminal session id
  -> TerminalPanel attach/replay gate
  -> writeLiveData(data) and xterm write
  -> memory-only per-session browser-local activity snapshot store
  -> TerminalRuntimeNavigatorItem for the same session id
```

`writeLiveData` marks a non-empty chunk only when it passes the replay gate for
xterm writing. Historical `terminal:buffer` replay does not count. Live chunks
queued during replay count only after replay completes and each chunk flows
through `writeLiveData`. Every mounted `TerminalPanel`, including hidden panels
retained by `TerminalKeepAliveHost`, independently updates its session entry.

The store publishes only per-session activity snapshots containing derived
recent/quiet state and stream readiness needed for the gray state; its internal
bookkeeping also retains the latest observed-output timestamp and timer/
subscription state. It never stores, persists, logs, or forwards output content. The
recent-output window is fixed at 3,000 ms in v1. A first chunk transitions the
session to recent output and schedules an expiry check. Later chunks update the
timestamp without notifying React or recreating the timer. Each expiry callback
compares the current time with the latest timestamp and either schedules the
remaining duration or publishes one quiet transition. This timestamp check is
required because background-tab timers may run late.

Runtime row state precedence is fixed:

1. `alive === false`: stopped (red or muted stopped treatment).
2. Transport disconnected, attaching, or replaying: stream unavailable (gray).
3. Live output observed within 3,000 ms: receiving output (green).
4. Otherwise: quiet/no recent output observed (yellow).

Attach/replay start, transport disconnect or replacement, terminal exit, and
panel cleanup clear recent activity and reset stream readiness so stale green
cannot survive a lifecycle boundary. Each mounted panel owns its registration;
owner-checked callbacks make late output or readiness updates from a prior
disconnect, exit, attach reset, replacement, or disposed panel no-ops. A confirmed
in-place `process:restarted` event, or a liveness-confirmed `terminal:changed`
recovery probe, reopens the live gate for the replacement reader without replaying
the retained buffer or counting the synthetic restart banner; fresh post-replay or
post-restart output may activate the row again. Store subscribers are notified only
when the externally visible activity/stream state changes, not for every PTY chunk.
Per-terminal labels and tooltips distinguish receiving, quiet, unavailable, and
stopped; the aggregated project item exposes receiving versus no recent terminal
output. Color is never the only cue.

Key invariants:

- Session ID is the isolation key; output from terminal A cannot affect terminal B.
- Activity means browser-observed live output accepted by xterm, not process work,
  command execution, health, server-authoritative idleness, or delivery proof.
- Replay and synthetic lifecycle banners never create recent-output activity.
- Hidden kept-alive mounted terminals participate; unmounted/disposed panels do not.
- Activity state is memory-only, bounded by mounted session lifecycle, and content-free.
- The feature adds no SSE endpoint, server timer, persistence, or protocol field.

### Unified terminal status for UI indicators

The UI keeps process liveness, observed output activity, and shell lifecycle as
separate state machines. The Traditional project item and per-terminal activity
rows share the same output-status calculation; the project item aggregates that
status across its terminal tabs:

| Surface                      | Green condition                 | Non-green condition                                                   | Authoritative source               |
| ---------------------------- | ------------------------------- | --------------------------------------------------------------------- | ---------------------------------- |
| Traditional project item     | At least one tab is `receiving` | Every tab is `quiet`, `unavailable`, or `stopped`                     | Shared browser-local output status |
| Per-terminal tab/runtime row | That terminal is `receiving`    | `quiet`, `unavailable`, or `stopped`                                  | Shared browser-local output status |
| Process liveness             | `SessionInfo.alive === true`    | Backend PTY exited, was killed, or lost its target                    | `terminal:listDetailed`            |
| Shell lifecycle              | Verified `editing` event        | Validated lifecycle transition, replay reset, restart, or termination | `terminal:lifecycle`               |

The shared output status precedence is:

1. `alive === false` → `stopped`.
2. Stream unavailable or replaying → `unavailable`.
3. Non-empty live output observed within 3,000 ms → `receiving`.
4. Otherwise → `quiet`.

The project indicator is green only when at least one tab resolves to
`receiving`. This is a UI-only aggregation. Quiet or unavailable output does
not mutate `SessionInfo.alive`; an idle but healthy shell remains alive, and a
verified `editing` lifecycle remains editing while no output arrives.

```text
/ws terminal:output
  -> browser-local activity store
  -> shared terminal output status
  -> per-terminal indicator
  -> Traditional project aggregate (any receiving tab)

terminal:listDetailed
  -> SessionInfo.alive
  -> stopped precedence in the shared status

terminal:lifecycle
  -> shell suggestion/lifecycle controller
```

**TerminalTreeView** (`packages/ui/src/components/organisms/TerminalTreeView.tsx`)

- Sidebar tree displaying projects + commands + sessions
- Renders `StatusDot` component (NEW: Phase 6) for each session
- Status dots reflect session lifecycle via `getSessionStatus()` helper
- Color mapping:
  - 🟢 Green: alive
  - 🟡 Yellow: restarting (willRestart=true, within backoff)
  - 🔴 Red: crashed (exit≠0, no restart)
  - ⚪ Gray: exited cleanly (exit=0)
- Expandable profile nodes show instance children + alive count badge

### Terminal selection and active-project synchronization

`TerminalTreeView` remains presentational: row clicks flow through
`WorkspacePage` into `useTerminalManager`. The terminal manager resolves the
selected session's project with `findSessionMeta`. When the persisted global UI
preference `terminalAutoSwitchProjectEnabled` is enabled, the resolved project
is non-empty, and the session is project-owned rather than a `free:` session,
`handleSelectTerminal` and already-open terminal-tab selection update
`useWorkspaceStore`'s `activeProject` before the terminal or project panel
renders. Free terminals are excluded even when incidental
metadata contains a project; unknown sessions, including sessions with
unrecognized ID prefixes, and unowned terminals without a non-blank project
continue to open normally without changing the active project. The preference is part of `UiConfig` and uses the existing
`globalConfig:get` / `globalConfig:updateUi` persistence path, so the behavior
is shared across workspace sessions without changing project configuration or
terminal APIs. The preference defaults to `true` so terminal selection follows
the requested project context immediately; users can opt out from Settings >
Appearance.

**DashboardPage** (`packages/ui/src/components/pages/DashboardPage.tsx`)

- Main view: all sessions with metadata (uptime, exit code)
- **SessionRow** renders:
  - Status dot (via `getSessionStatus`)
  - Restart badge `↻ N` (when `restartCount > 0`, yellow background)
  - Uptime and command
- Queries invalidated on `process:restarted` event → auto-refresh

### Session Lifecycle Helpers (Phase 06)

**session-status.ts** (`packages/ui/src/lib/session-status.ts`)

- `getSessionStatus(sess: SessionInfo): "alive" | "restarting" | "crashed" | "exited"` — determines UI status
- `getStatusDotColor(status): string` — maps status to Tailwind class
- `getStatusGlowClass(status): string` — optional glow effect for active states
- Centralized logic prevents UI inconsistencies across components

**session-status.test.ts**

- Unit tests for all status transitions
- Color mapping validation
- Edge cases (null exit code, missing fields)

### Transport Events (Phase 06)

**WebSocket Transport** (`packages/ui/src/api/ws-transport.ts`)

- New event listeners (Phase 5 contract):
  - `onTerminalExit(id, callback)` — trigger exit banner, call onExit
  - `onProcessRestarted(id, callback)` — trigger restart banner, invalidate queries
  - `onTransportStatus(callback)` — listen to WS connection status changes

### SessionInfo Type Extensions

```ts
export interface SessionInfo {
  id: string;
  /** Opaque concrete PTY identity used to reject stale push events. */
  incarnation?: number;
  project?: string;
  command: string;
  cwd: string;
  /** Server-validated canonical worktree target, when target-scoped. */
  worktreePath?: string;
  type: "build" | "run" | "custom" | "shell" | "terminal" | "free" | "unknown";
  alive: boolean;
  /** True when the session's original target is unavailable for respawn. */
  targetUnavailable?: boolean;
  exitCode?: number | null;
  startedAt: number;
  // Phase 3 restart policy fields
  restartPolicy?: "never" | "on-failure" | "always";
  restartCount?: number;
  lastExitAt?: number;
  // Phase 5 exit event fields
  willRestart?: boolean; // Indicates if process will auto-restart
  restartInMs?: number; // Milliseconds until restart attempt
}
```

### Data Flow: Terminal Lifecycle

```
User launches terminal
  ↓
terminal:create (with optional worktreePath) → Backend validates target and creates PTY
  ↓
Frontend stores the returned SessionInfo (alive=true)
  ↓
TerminalPanel mounts, xterm renders, streams output
  ↓
Process exits
  ↓
terminal:exit (willRestart flag set by backend)
  ↓
TerminalPanel writes exit banner (color based on exit code + willRestart)
  ↓
If willRestart=true, waits for restart...
  ↓
process:restarted event
  ↓
TerminalPanel writes restart banner, UI updates badge
  ↓
xterm resumes streaming (same session ID, new PTY)
```

**FileTree.tsx (react-arborist)**

- `onMove` callback enabled for drag-and-drop
- Drop on directory → move file/folder into directory
- Drop on file → move into file's parent directory
- All moves validated through server `ops.move()` sandbox

### Context-menu placement invariant

The shared Radix foundation lives in `packages/ui/src/components/ui/ContextMenu.tsx`. Consumers use `ContextMenu.Root` with `ContextMenu.Trigger` (always `asChild`) and body-only `ContextMenu.Portal`; `ContextMenu.Content` also self-portals as a guard when a consumer omits the explicit portal. Radix owns pointer anchoring, collision handling, focus, keyboard navigation, and dismissal. The wrapper adds an 8px collision padding, shared layering/max-space styles, one-open coordination, and capture-level scroll close.

This portal boundary is required because floating terminal panels use `backdrop-filter` and `overflow-hidden`; fixed descendants below those panels can otherwise receive a panel-relative containing block and be clipped. Menu-specific components own only action content and trigger state; they must not reimplement viewport clamps, guessed dimensions, portal targets, or document-level dismissal listeners. `DamHopperApp` prevents the native browser context menu at document capture for every unmarked event path, without stopping propagation. Enabled shared `ContextMenu.Trigger` elements are marked and left to Radix, which prevents the default and opens the menu; disabled triggers remain unmarked and are globally suppressed. Thus unconfigured and disabled right-clicks show nothing while enabled configured menus retain their normal event path. All seven consumers now use the shared Radix surface. Custom trigger components forward Radix refs and DOM props; branch menus lift their Root beside Radix Select so Select dismisses before the menu opens, while lifted diagnostics retain a local native trigger for pointer anchoring.

The Explorer tree keeps the Arborist row itself as the direct `asChild` trigger. Opening or dismissing its menu must not update `FileTree` state, since that can recreate virtualized rows during Radix's opening lifecycle. Tree menu callbacks instead close over the originating row's `FsArborNode`; only a selected action may update dialog, upload, operation-error, or other parent state. This preserves pointer and keyboard invocation, the composed Arborist drag ref, and exact action targeting.

Touch long-press contract: Explorer rows and editor tabs use the existing shared Radix `ContextMenu.Trigger` as the single owner of non-mouse long-press behavior. Radix's built-in 700 ms touch/pen timer, movement/cancel cleanup, native `contextmenu` fallback, anchor placement, focus, and dismissal remain authoritative; no second global gesture timer or dependency is introduced. Nested Git-status and tab-close controls are not menu triggers: they use local touch/pen pointer guards and non-mouse context-menu suppression so their own actions remain reachable without opening the parent row/tab menu. The app marker must remain on the real `asChild` DOM target so document-level native-menu suppression does not block configured triggers. Long-press support is scoped to existing Explorer and editor-tab menus. Monaco text and preview surfaces remain outside this contract until an app context-menu action model exists; mapping a hold to tab actions is prohibited. The shipped UI/test change has no backend, API, database, authentication, configuration, or deployment impact.

Test boundary: JSDOM wrapper and consumer tests verify the shared contract, portal/body mounting, trigger compatibility, scroll close, and disabled-item wiring. Chromium browser tests use synthetic pointer sequences in headless Chromium for app-level timing, portal geometry, focus/navigation, cancellation, nested-control protection, and held row/tab targeting; they are not physical Android Chrome or iOS Safari certification. Native long-press callouts and browser event ordering still require real-device follow-up. Phase 03 is the verification boundary for the wrapper and consumer migration; Phase 04 keeps the browser geometry/focus regression coverage. Monaco text long-press is a documented non-goal until its menu contract is designed.

**Phase 02 migration notes:** the consumer rollout kept the shared Radix foundation as the single menu primitive, forwarded trigger refs through the wrapper layers, isolated the branch `Select` control from the generic context-menu trigger path, and lifted the diagnostics trigger into its own dedicated consumer wiring. A local branch option prevents only right-button Select handling, then hands the pointer-up event to the lifted branch-menu presenter; the native `contextmenu` event remains the fallback, and `ContextMenu`/`Shift+F10` use the same opener. This closes Select before the single menu mounts, so a branch is never checked out by opening its action menu. Escape and outside dismissal clear the lifted state and return focus to the Select trigger when practical; Delete preserves the checked-out-branch guard and transfers focus to the confirmation dialog. The intent is to standardize trigger ownership without expanding the menu API surface or coupling unrelated selectors to the context-menu shell.

## Concurrency Model

**Tokio async:** All I/O non-blocking.

**Mutexes:**

- AppState.workspace_dir, config, global_config: RwLock<T>
- PtySessionManager.inner: Mutex<Map<...>>
- FsSubsystem.inner: Mutex<Option<Sandbox>>
- SshCredStore: Mutex<...>

**Broadcast channels:** PTY output fan-out to multiple WebSocket clients.

**Important:** Never hold FsSubsystem, PtySessionManager locks across `.await` — clone fields out first.

## Authentication & Security

**Bearer token:**

- Hex UUID stored in `~/.config/dam-hopper/server-token`
- Validated via `subtle::constant_time_compare()`
- All routes protected via middleware

**Filesystem sandbox:**

- Projects cannot traverse above their root
- Symbolic links are allowed but validated
- Binary file detection prevents accidental text parsing

**Browser origin:** The backend is same-origin by default. Separate browser
frontends require exact `DAM_HOPPER_CORS_ORIGINS` entries; wildcard CORS is forbidden.
Authenticated HTTP binds, including non-loopback binds, are supported. Media ticket
issuance requires authentication and stream URLs are short-lived actor/session-bound
capabilities, with expiry, revocation, and file revalidation preserved. HTTP exposes
Bearer/auth credentials, ticket URLs, API actions, and media bytes to interception or
modification; use HTTPS or a trusted encrypted network when needed.

## Feature Gating: IDE Explorer

Routes `/api/fs/*` (list, read, stat) only registered when:

- OR env: `DAM_HOPPER_IDE=1`

If disabled, requests return 404.

FsSubsystem still initializes (needed for future phases), but routes are gated at router level.

## Error Handling Strategy

Each module defines error enum:

- `FsError` — sandbox/ops errors
- `AppError` — top-level (Fs, Git, NotFound, etc.)
- `ApiError` — HTTP mapping

API layer (handlers) catch AppError → HTTP status:

- 400 Bad Request (validation)
- 404 Not Found
- 503 Service Unavailable (feature disabled)

## Phase Progression

**Phase 01 (Complete):**

- File explorer foundation—sandbox, list/read/stat REST endpoints.
- Git diff/staging/conflict API—8 endpoints for change management. `DiffFileEntry`, `FileDiffContent`, `HunkInfo`, `ConflictFile` types. `git::diff` module with hunked diff parsing, hunk-level discard, 3-way merge visualization.

**Phase 02 (Complete):** Watcher subsystem via inotify/notify; WebSocket subscription protocol `{kind:}` envelope (hard cut from legacy `{type:}`); fs:subscribe_tree/fs:unsubscribe_tree/fs:event channels; health endpoint with feature flags.

**Phase 03 (Complete):** Web IDE shell—react-resizable-panels layout (file tree | editor | terminal); react-arborist tree component; TanStack Query + useFsSubscription hook for live tree sync; applyFsDelta merges server events into client cache; feature flag `ide_explorer` gates routes and sidebar link; /ide lazy route with fallback placeholder.

**Phase 03 (Complete):** IntelliJ-compatible Git actions—shared safe-vs-rewrite history menu, undo-last-commit endpoint, revert-selected-changes vs drop-selected-changes split, and pushed/shared history protections that steer users toward revert.
**Phase 04 (Complete):** Verification and docs for real Git semantics—tests cover active-operation blocking, recovery metadata, pushed-history rewrite guards, and UI refresh behavior after history mutations.
**Phase 01 (Complete):** Root-aware Git push and SSH retry flow—ProjectInfoPanel selects the active VCS root, push requests forward the selected root for child repos, retry results are normalized before auth detection, and successful pushes invalidate the broader Git cache set.

**Phase 04 (Complete):** Monaco editor with tab mgmt + save. WS write protocol (fs:write_begin → fs:write_chunk\* → fs:write_commit). File tiering (normal <1MB, degraded 1-5MB, large ≥5MB, binary). Conflict detection via mtime. Ctrl+S save, MonacoHost, EditorTabs, LargeFileViewer, BinaryPreview, ConflictDialog components.

**Phase 05 (Complete):** CRUD + WS-chunked upload + streaming download.

**Phase 06 (Complete):** Unified workspace—merge IdePage + TerminalsPage into single WorkspacePage. Tabbed left sidebar (Files/Terminals), multi-terminal bottom panel with TerminalTabBar + MultiTerminalDisplay. Terminal state extracted to `useTerminalManager` hook. Single `/workspace` route; `/terminals` and `/ide` redirect. Feature flag `ide_explorer` controls editor/file-tree visibility within page (not route access).

**Phase 07 (Complete):** IDE explorer enhancements:

- **Markdown split-view preview:** `MarkdownHost` + `MarkdownPreview` components in packages/ui/src/components/organisms/. EditorTabs routes .md/.mdx files to MarkdownHost. Toggle modes: Edit | Split | Preview-only.
- Markdown view mode is one browser-local presentation preference shared by all
  Markdown files across projects and workspaces in the app origin. It is stored
  as a single versioned localStorage value; files without a valid value use
  Split. Storage failures and invalid values are non-fatal; this preference
  never changes server, workspace, project-file, API, or database state.
- **Drag-and-drop file move:** FileTree.tsx DnD via react-arborist's built-in `onMove`. Drop on dir → move into dir. Drop on file → move to file's parent. Calls existing `ops.move()` with server-side sandbox validation.
- **Backend search API:** `GET /api/fs/search?project=X&q=QUERY[&case=bool&max=N]` in server/src/api/fs.rs. Uses `ignore` crate v0.4 for .gitignore-aware directory walking. Plain text search (regex-escaped server-side). Results capped at 1000, default 200.
- **Persistent explorer tree expansion:** `packages/ui/src/stores/explorer-tree.ts` (`useExplorerTreeStore`) persists directory open/close states in `localStorage` under `dam-hopper:explorer-tree-state` keyed by target scope (`${project}::${targetKey}`). `FileTree` uses this state for `initialOpenState`, cascading child hydration on remount, error-safe directory pruning, and rename/move/delete tree synchronization.
- **Persistent editor view state:** Monaco editor `viewState` (cursor position, column, scroll offsets, and code folds) is persisted in `dam-hopper:editor-state` via `packages/ui/src/stores/editor.ts`. `MonacoHost` captures view state before switching active tabs and on unmount with race-safe tab attribution, preserving view state across tab switching and app reloads.
- **Frontend search panel:** New "SEARCH" tab in SidebarTabSwitcher. SearchPanel component with debounced input (useDeferredValue), results grouped by file with match highlighting. `useFileSearch` hook in packages/ui/src/hooks/. Ctrl+Shift+F keyboard shortcut to focus search. Gated behind ide_explorer feature flag.

**Phase 08 (Complete):** IDE Tool Windows Refactoring.
Refactored `IdeShell.tsx` into a flexible, extensible "Tool Window" system.

- **ActivityBar:** A thin vertical strip for switching between tool windows (Explorer, Terminals, Search).
- **ToolPanel:** A generic container for active tool content with resizable handles and a consistent header.
- **ToolWindowDef:** Standardized interface for defining tools (id, label, icon, content).
- **Persistence:** Active tool IDs are persisted in `localStorage`.
- **Extensibility:** Enables easy addition of new side panels without modifying `IdeShell` layout logic.
- **Terminal floating-panel layering:** In terminal mode, Files and tool overlays use a shared base `z-index` of `20`; activating one raises it to `25`. Global Browser/debug overlays remain above this layer.
- **Bottom panel maximize toggle:** The bottom tool panel header exposes an IntelliJ-style maximize/restore button (session-only state, not persisted). Maximizing hides the top area (explorer/editor/right panels via `display:none`) and stretches the bottom panel to fill the workspace body; activity bars stay visible. Closing the maximized bottom tool resets the state. Implemented as sibling-only CSS class flips so the terminal keep-alive element is never remounted (no PTY duplication); layout decisions live in the pure `resolveBottomPanelLayout` helper. Maximizing also unselects active top tools on both sides; reselecting a top tool from the activity bar (or a reveal-active-file request) restores the normal layout. State transitions live in the pure `resolveMaximizeToggle` / `resolveTopToolToggle` helpers.

**Native Browser Debug (Windows v1; Linux implementation pending runtime verification):** The Tauri host keeps the existing Browser tool contract and selects a host adapter at the edge. Windows creates a labeled child WebView, injects the shared bridge at document start, and relays only bounded, versioned events through the native controller. Linux uses the equivalent WebKitGTK message hook. Navigation is restricted to loopback or server-reported HTTPS tunnel origins; popups, downloads, and permissions are denied by the Windows WebView2 policy hooks. Linux has no runtime-verified equivalent permission policy yet. The child uses per-server profile storage and is destroyed on target/profile changes and main window shutdown. Linux remains explicitly unverified at runtime; setting
`VITE_DAM_HOPPER_NATIVE_BROWSER_DEBUG=0` selects the existing web iframe host.

See the maintained platform gate and rollback procedure in
[Native Browser Debug Support](./native-browser-debug-support.md). Deployment
ownership is intentionally separate: Docker serves `/opt/dam-hopper/web` with
the server on 4800 only when it passes explicit `--web-dir`; the dedicated
`dam-hopper-web` serves an immutable root on 4802; systemd runs backend-only on
4801; and legacy nohup remains loopback-only on 4800.
