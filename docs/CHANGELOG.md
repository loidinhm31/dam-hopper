# 2026-08-15

- **Native SSH port-forwarding Windows gate (Phase 07 subset).** Added Windows CI and release pre-bundle checks for Rust formatting/lint/unit coverage, the real temporary OpenSSH remote-loopback forwarding gate, deterministic smoke/evidence validation, WebView2/OpenSSH preflight, no-bundle Tauri compilation, and the unsigned NSIS package profile. Protected packaged-runtime evidence remains manual-pending; cross-platform support, signed updater artifacts, and final security/product release approval remain deferred. [See phase gate](../plans/260808-1310-ssh-port-forwarding-control/phase-07-cross-platform-release-gates.md).

## 2026-08-11

- **Host-resource restoration alerts (Phase 02).** Added additive snapshot
  `currentAlerts` for concurrent thermal/disk incidents without changing the
  legacy memory alert, newest-first mixed incident history, and compatible
  `host:alertChanged` resource payloads. The client validates event shape and
  nested evidence before cache updates, preserves active incidents if an older
  server omits the additive field, and removes only the recovered target. Known
  accepted UI caveat: after acknowledgement, a resource-only critical badge can
  render info-colored while its active count and incident state remain correct.

## 2026-08-05

- **Codex OTel-only Usage refactor.** Removed terminal Usage work from PTY production paths and
  made bounded Codex `response.completed` OTLP events the sole usage write source. The fresh
  Codex-only `telemetry.db` schema, aggregate/session API, Usage page, and Settings exporter flow
  now document retention-bounded (not permanent) session summaries, WAL/SHM reset boundaries, and
  privacy-safe data contracts. `sessions.db` remains protected from telemetry resets. Automated Rust, UI, web,
  and browser gates pass; manual PTY benchmarking, signing, and target-environment release checks
  remain follow-ups.

## 2026-07-30

- **Native embedded browser controller (Phase 03).** Added the Tauri desktop child-WebView controller, build-time bridge injection, loopback/HTTPS tunnel navigation policy, bounded native relay validation, profile-isolated browser storage, lifecycle/geometry commands, and fail-closed popup, download, redirect, external-scheme, and permission handling. Windows WebView2 is the verified implementation target; Linux remains build-only and macOS is deferred. [See plan](../plans/260728-1313-tauri-native-embedded-browser/plan.md).

## 2026-08-01

- **Phase 02: Stale lazy-chunk recovery.** The shared `ErrorBoundary` now
  recognizes only known browser module-load signatures (`ChunkLoadError`, failed
  Vite chunk loads, and dynamic-import/module-script fetch failures). It writes
  the namespaced `dam-hopper:stale-chunk-reload-attempted` key to
  `sessionStorage` before one reload per tab session. Storage read/write errors
  fail closed and retain the existing fallback; second stale failures and
  unrelated render errors also retain the existing fallback and diagnostics.
  Focused `ErrorBoundary` tests cover classifier boundaries, first/second
  failures, unrelated errors, and unavailable storage.

## 2026-07-25

- **Controlled browser debug preview and terminal handoff.** Added an
  extension-assisted iframe Browser tool with bundled client extension setup,
  bounded DOM/ARIA
  selection, optional user-mediated tab capture, manual-image fallback, and
  short-lived authenticated JSON/PNG artifacts. Explicit confirmation inserts
  only generated artifact paths into a selected live terminal, without page
  text, terminal controls, or auto-submit. Target reloads invalidate prior
  selection state; CSP/framing failures, capture denial, stale tunnels, and
  closed terminals fail closed. [See plan](../plans/260724-0114-browser-debug-embedded-selection/plan.md).
  Phase 6 automated hardening covers malformed/nested bridge messages,
  capture cleanup and JPEG conversion, tunnel invalidation, private artifact
  boundaries, and the no-read artifact contract. Chromium permission chooser,
  HiDPI crop, live tunnel, and real-xterm checks remain manual release gates.

## 2026-07-16

- **Configurable terminal panel shortcuts.** Added settings-backed shortcuts for
  Git (`Ctrl+Shift+G`), Ports (`Ctrl+Shift+P`), and Fleet Terminal
  (`Ctrl+Shift+M`). Each shortcut toggles its target and closes the other two;
  xterm input suppresses the bindings so they never reach the PTY. [See plan](../plans/260716-0025-terminal-panel-shortcuts/plan.md).

## 2026-07-14

- **Explorer: Copy Path context menu.** Complete ✓ 2026-07-14. Added "Copy Absolute Path" and "Copy Relative Path" items to the Explorer (file-tree) right-click menu for both files and folders. Absolute path joins the server-resolved absolute project root (`useProject(name).data.path`) with the node's project-relative path using the native separator (backslash on Windows, forward slash elsewhere); relative path is always forward-slash POSIX. Path computation and the menu item list are extracted into pure `buildTreeCopyPaths` / `getTreeContextMenuItems` helpers for SSR unit testing, mirroring the `getEditorTabContextMenuItems` pattern. The absolute item disables when the project root is unknown; a transient "Copied to clipboard" toast reuses the existing `useCopyToClipboard` hook. Frontend-only; no backend/API changes. Validation: `pnpm --filter @dam-hopper/ui build`, `pnpm --filter @dam-hopper/ui test` (422 passing), changed files lint-clean. [See plan](../plans/260714-1430-explorer-copy-path/plan.md).

## 2026-07-08

- **Bottom Panel Maximize Toggle.** Complete ✓ 2026-07-08. Added an IntelliJ-style maximize/restore toggle to the IDE bottom tool panel header. Maximizing hides the top area (explorer/editor/right panels) and expands the bottom panel to fill the workspace body; activity bars stay visible so tools remain switchable. State is session-only (not persisted), closing the maximized bottom tool resets it, and the terminal keep-alive element stays in the same React tree position so no PTY is remounted or duplicated on toggle. Layout decisions were extracted into a pure `resolveBottomPanelLayout` helper for SSR unit testing (toggle/restore/reset-on-close), plus an `IdeShell` SSR contract test for button presence/absence. ESLint config now ignores Rust/Tauri `target/` build artifacts that previously produced ~200 false parsing errors. [See plan](../plans/260708-1957-bottom-panel-maximize-toggle/plan.md).

- **Bottom panel maximize: auto-restore on top tool selection.** Enhanced the maximize toggle so clicking maximize also unselects any active top tools on both sides (the activity bar no longer highlights them while the bottom panel covers the top area). Selecting a top tool from the activity bar again — or triggering a reveal-active-file request — automatically restores the normal (non-maximized) layout. Maximize/top-tool state transitions are extracted into pure `resolveMaximizeToggle` / `resolveTopToolToggle` helpers for SSR unit testing.

## 2026-05-31

- **Phase 04: Diagnostic Log Capture.** Complete ✓ 2026-07-07. Added Settings > Maintenance `Export Diagnostics` in the UI and a protected `POST /api/diagnostics/export` flow that sends the canonical `frontend` snapshot payload plus default 60-minute and terminal-tail settings. Downloads use `dam-hopper-diagnostics-{timestamp}.json`. Exported terminal tails are included by default and should be reviewed before sharing because they can still contain sensitive local/dev output.

- **Phase 03: PTY And WebSocket Instrumentation.** Complete ✓ 2026-07-07. Added backend terminal diagnostics events for PTY create/spawn failure/EOF/read error/exit/kill/remove/restart decisions, WS terminal control tracing, frontend transport lifecycle tracing, TerminalPanel attach/create/replay diagnostics, renderer-mode instrumentation, and capped terminal-tail export. Export scopes `terminals.sessions` and `terminals.tails` to requested terminal ids and keeps input data redacted as byte counts only.

- **Shared terminal rendering and resize smoothing.** Added WebGL2-backed xterm rendering across browser, desktop Tauri, and Android WebView hosts with quiet DOM-renderer fallback when unsupported, initialization fails, or the WebGL context is lost. Centralized animation-frame terminal fitting and host attachment to coalesce live-resize work while preserving split-pane docking, tab keep-alive behavior, and mobile native-keyboard focus suppression.

- **Terminal mode switching buffer readability fix.** Kept xterm instances mounted across Traditional ↔ Runtime terminal view switches so historical output is not replayed and rewrapped at a different width during Runtime navigator resizing.

## 2026-05-25

- **Phase 04: Responsive Companion Layout.** Complete ✓ 2026-05-25. Added the compact responsive workspace shell with shared media-query helpers, safe-area/dynamic-height CSS primitives, mobile/tablet surface switching, and terminal refit handling for hidden-panel transitions. Reused the existing editor, terminal, fleet, ports, Git, and project surfaces without duplicating business logic. Hardened `MobileWorkspaceShell` for empty-surface fallback, improved TopNav selector layering and compact/tablet behavior, and aligned compact navigation behavior with zoomed and iPad-sized layouts. Validation passed for `pnpm --filter @dam-hopper/ui test`, `pnpm --filter @dam-hopper/ui build`, `pnpm build`, and `pnpm dev` startup verification. [See plan](../plans/260524-2238-tauri-v2-shared-ui-native/phase-04-responsive-companion-layout.md).

- **Phase 03: Tauri Native Shell.** Implemented 2026-05-25. Added `@dam-hopper/native` as a thin Tauri v2 host that mounts the shared `@dam-hopper/ui` app, configures the shared logger and TanStack Query, uses an idle transport until a server profile exists, and keeps the native shell remote-client-only with `core:default` permission. Added native Vite config on port 1420 with HMR port 1421, minimal `src-tauri` Rust entrypoint/config/capability, restrictive CSP, root native scripts, native build coverage in `pnpm check`, CORS documentation for Tauri origins, and a committed native Cargo lockfile. Validation passed for native TypeScript and Vite build; full desktop Tauri runtime validation is blocked locally by missing Linux prerequisites (`webkit2gtk-4.1`, `rsvg2`, `dbus-1.pc` / `libdbus-1-dev`, `pkg-config`). [See plan](../plans/260524-2238-tauri-v2-shared-ui-native/phase-03-tauri-native-shell.md).

- **Phase 02: Shared Logger And Runtime Utilities.** Complete ✓ 2026-05-25. Added the dependency-free `@dam-hopper/shared` logger API (`configureLogger`, `getLoggerConfig`, `resolveLogLevel`, and `logger.debug/info/warn/error`) with recursive sensitive-metadata redaction before the sink, wired web bootstrap log level selection to Vite env with dev-debug / prod-warn fallback, and replaced direct `console` usage in high-value transport/auth/terminal/dashboard/error-boundary/fs paths. `packages/ui` keeps `cn` as-is. Verification passed for shared tests/build, ui tests/build, and web build.

## 2026-05-23

- **Phase 01: Root-Aware Git Push and SSH Retry Flow.** Complete ✓ 2026-05-23. Rebuilt push on top of libgit2 so `POST /api/git/push` keeps the root-aware UI/API contract while the backend now uses `Remote::push(...)` with the same credential callback order as fetch/pull: loaded key, SSH agent, credential helper, then default credentials. `ProjectInfoPanel`, `WorkspaceGitPanel`, and `GitPage` all preserve the selected VCS root in the push payload, the shared SSH retry hook still normalizes single-result versus array Git responses before auth detection, and successful pushes still invalidate the broader Git cache set. Focused Rust coverage now includes successful local bare-remote push, missing-upstream failure, nested-root isolation, and callback-level remote rejection reporting. [See plan](../plans/260523-0355-git-push-ssh-passphrase/plan.md).

## 2026-05-20

- **Phase 01: Backend VCS Root Discovery.** Complete ✓ 2026-05-20. Added backend discovery for git roots under a project: the server now resolves the primary repo, nested repos, and submodule gitlinks, exposes them through `GET /api/git/{project}/roots`, and reports mapping state plus submodule metadata for client-side root selection. Invalid `.gitmodules` files are tolerated with warnings on the primary root. Tests cover mapped, unmapped, missing, uninitialized, and traversal-blocked roots.

- **Phase 04: Tests Docs Validation.** Complete ✓ 2026-05-20. Validated the multi-root Git work with real repo tests and web Vitest coverage, then updated the API, system architecture, and frontend component docs for root discovery and root-scoped Git behavior. Full Rust and web suites passed; no critical review issues remained.

- **Phase 05: Terminal Workspace Verification and Docs.** Complete ✓ 2026-05-20. Verified terminal workspace behavior through web tests, web build, focused Rust `ui_config` tests, and real-browser checks. Real-browser verification exposed a swapped split-action mapping in the terminal tab bar; `Split Right` and `Split Down` are now wired to the correct pane directions, and the UI mapping is covered by a focused regression test. Terminal mode now keeps the existing Ports panel in the right rail below Fleet Terminal for development port and tunnel access. Frontend docs now also record the terminal workspace persistence keys and runtime verification boundaries.
- **Phase 04: Terminal Workspace Advanced Docking.** Complete ✓ 2026-05-20. Terminal workspace drag and drop now uses explicit docking intents: pane center moves, edge splits, tab insertion targets, same-pane tab reorder, empty-pane insertion, labeled docking previews, and a richer drag overlay. The layout state was refactored into pure tree/docking helpers so docking updates are atomic and persisted without touching PTY lifecycle. Focused docking tests and `pnpm --filter @dam-hopper/web build` passed.
- **Phase 03: Terminal Workspace Layout.** Complete ✓ 2026-05-20. Workspace Terminal now renders a full-height shell below the top nav, Fleet Terminal stays available as a persisted right rail in terminal mode, the existing terminal manager state is reused across mode switches, and terminal panes refit when mode or rail layout changes.

# Changelog

- **Phase 01: Git-unavailable production state.** Complete ✓ 2026-08-01.
  Git-uninitialized projects now return HTTP 409 with error code
  `GIT_NOT_INITIALIZED`; the typed client exposes `ApiRequestError` and the
  `GitDiffResult` unavailable variant. Root/branch/history surfaces and
  `GitLocalChanges`/Changes panels render actionable `git init` guidance,
  while discovered usable nested roots remain root-scoped for branch and diff
  operations.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),

## 2026-08-14

- **Native SSH Port-Forwarding Control — Phase 06 (Windows desktop scope).** Completed the host-gated `/ssh-forwarding` route and navigation, explicit reviewed profile form, lifecycle controls, agent/opaque-key inventory selection, unknown-host approval, changed-key stopped-app remediation presentation, bounded reconnect/auto-start states, and exact local-process/loopback security copy. Browser and native-mobile hosts expose no matching route and make zero forwarding calls. Validation: UI 181 files/1,050 tests, Chromium 28 files/121 tests, Rust 140 passed/1 ignored; build, lint, `cargo check`, `cargo fmt`, and diff checks passed. Cross-platform, packaged-runtime, security, product, and manual Phase 07 release gates remain deferred; release readiness is not claimed. [See completion report](../plans/260808-1310-ssh-port-forwarding-control/reports/04-phase-06-completion.md).

## 2026-07-26

- **Phase 03: Terminal usage analytics persistence.** Added opt-in telemetry startup/shutdown with a
  dedicated bounded worker, private `telemetry.db` SQLite/WAL storage, idempotent command and token
  writes, UTC daily rollups before detail purge, configurable retention and project exclusions, and
  HMAC-key/file permission hardening. Database failures remain isolated from PTY flow; aggregate API
  routes remain scheduled for Phase 04.

- **Phase 02: Validated shell lifecycle capture.** Bash, Zsh, and Fish now report
  bounded completion status through versioned OSC 633 adapters. PTY lifecycle events
  carry terminal-run/sequence identity and privacy-safe normalized command metadata
  through a bounded non-blocking telemetry sink. The default path is no-op and
  non-durable; `ChannelTelemetrySink` is reserved as the Phase 03 durable-worker
  boundary.
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- IntelliJ-style **Edit Commit Message** for any unpushed commit reachable from
  the checked-out branch. Added full-message read and guarded message-rewrite
  REST APIs, root-commit and descendant replay support, shared Git history UI
  wiring, multiline editing, and pushed/non-active-branch availability guards.

- **Phase 01: Workspace Split.** Complete ✓ 2026-05-24. Split the web frontend into a thin `apps/web` Vite host plus a shared `packages/ui` React package, preserving current browser behavior while moving shared components, hooks, styles, tests, assets, and transport-facing UI code behind explicit UI package exports. No native behavior was added yet in this phase. [See plan](../plans/260524-2238-tauri-v2-shared-ui-native/phase-01-workspace-split.md).

- Root-aware force-push support on the actual push flow. `POST /api/git/push` now accepts `force: true`, and the Push entrypoints in `ProjectInfoPanel`, `WorkspaceGitPanel`, and `GitPage` expose a confirmed `Force Push` action that reuses the same libgit2 credential callback path as normal push. This stays separate from the guarded history-rewrite endpoints: pushed/shared-history drop and undo flows still recommend revert instead of silently overriding safety checks.
- Shared Git push feedback in the web UI. The SSH retry status banner now also confirms successful push completion, so regular push, force push, and passphrase-retry push all report a visible result after the request finishes.

- **Phase 02: Terminal Workspace Shortcut Routing.** Complete ✓ 2026-05-19. Added configurable terminal workspace switching: `UiConfig` now carries `terminalWorkspaceShortcut` with default `Mod+Shift+Backquote`, the settings UI exposes a Terminal workspace row, `WorkspacePage` toggles IDE/Terminal mode from the configured shortcut, and `TerminalPanel` plus `PaneContainer` suppress that shortcut from xterm input so the binding stays global. [See plan](../plans/260519-2159-terminal-workspace-docking/phase-02-configurable-mode-shortcut.md).

- **Phase 01: Workspace Mode Shell.** Complete ✓ 2026-05-19. Added persisted workspace mode for the main shell: `WorkspacePage` now owns `ide`/`terminal` mode state in `localStorage` key `dam-hopper:workspace-mode`, `IdeShell` accepts optional mode props and forwards them to `TopNav`, and `TopNav` shows a compact IDE/Terminal toggle only when those props are present. IDE mode behavior stays unchanged when mode props are omitted. [See plan](../plans/260519-2159-terminal-workspace-docking/phase-01-workspace-mode-shell.md).

- **Phase 04: IntelliJ Real Git Semantics Verification and Docs.** Complete ✓ 2026-05-19. Expanded verification coverage for the real Git semantics refactor: backend tests now cover active-operation rewrite blocking and recovery metadata, frontend tests cover targeted Git invalidation, selected-history refresh, pushed rewrite availability, and recovery banner copy, and the API/architecture docs now define the safe-vs-rewrite history contract plus manual browser verification checklist. [See plan](../plans/260519-0059-intellij-real-git-semantics/phase-04-verification-and-docs.md).

- **Phase 03: IntelliJ-Compatible Actions.** Complete ✓ 2026-05-19. Added the remaining IntelliJ-style Git action split so safe history preservation and rewrite actions are separate: revert commit for pushed/shared history, revert selected changes as a non-history-rewriting path, undo last commit to move changes back into the worktree, explicit confirmation copy for destructive actions, and backend/web API surface updates for the new action routing. [See plan](../plans/260519-0059-intellij-real-git-semantics/phase-03-intellij-compatible-actions.md).

- **Phase 02: IntelliJ-Style Git Workspace Semantics.** Complete ✓ 2026-05-19. Updated the web Git workspace to use a shared commit-action status model and tighter workspace refresh behavior: `GitHistoryActions` now maps Git mutation results into explicit `success`/`blocked`/`conflict`/`dirty`/`error` states, local commit drops are blocked for pushed commits with a shared revert recommendation, `WorkspaceGitPanel` refreshes branches, project status, history, and selected commit files in one flow, `GitPage` reuses the same history-action hook for the standalone Git view, and editor tab reconciliation was aligned with Git-side file updates through the shared query helpers. [See plan](../plans/260519-0059-intellij-real-git-semantics/plan.md).

- **Phase 01: Backend Real Git Semantics.** Complete ✓ 2026-05-19. Refactored Git history mutations around real `git` porcelain contracts: (1) new repo-state helpers detect clean worktree, current branch, reachability, pushed commits, and active merge/rebase/cherry-pick operations; (2) `GitActionResult` now carries `recovery`, `blockedReason`, and `recommendation`; (3) full commit drop uses reset for local `HEAD` and `rebase --onto` for non-HEAD local commits; (4) pushed/shared history drop is blocked by default with revert recommendation; (5) whole-commit and selected-file revert primitives are exposed through REST and the web API client; (6) regression tests cover HEAD drop, non-HEAD drop with descendants, root/pushed blocking, active rebase blocking, selected-file drop, recoverable conflicts, and revert paths. [See plan](../plans/260519-0059-intellij-real-git-semantics/phase-01-backend-real-git-semantics.md).

- **Phase 02: PTY Env Leakage Verification And Documentation.** Complete ✓ 2026-05-16. Added regression coverage proving PTY children do not inherit non-allowlisted parent env, safe baseline vars remain available for shell execution, project terminal sessions load project environment-file values, request `env` overrides win deterministically, and malformed project environment files fail terminal creation with a clear error. Updated `docs/configuration-guide.md` to document terminal env precedence. [See plan](../plans/260516-0315-fix-pty-env-leakage/phase-02-verification-and-documentation.md).

- **Phase 01: Backend PTY Env Isolation.** Complete ✓ 2026-05-16. PTY child sessions now start from a safe baseline instead of inheriting the DamHopper server process env, and project terminal sessions load `env_file` values before request overrides. Validation passed with targeted PTY and terminal tests plus full `cargo test`. [See plan](../plans/260516-0315-fix-pty-env-leakage/phase-01-backend-pty-env-isolation.md).

- **Phase 03: Git Management Verification And Documentation.** Complete ✓ 2026-05-16. Documented the completed Git management public surface in `docs/api-reference.md` and `docs/frontend-components.md`: branch listing/create/checkout/update, cherry-pick, reset modes, commit amend, shared action result flags, Explorer branch controls, dirty checkout choices, and history actions. [See plan](../plans/260516-0155-git-management-completion/phase-03-verification-and-documentation.md).

- **Phase 02: Frontend Git Management.** Complete ✓ 2026-05-16. Added the Git workspace UI in `packages/web/src/components/pages/GitPage.tsx` and related organism components for branch control, history browsing, and working tree review: `WorkspaceGitPanel`, `GitBranchControl`, `GitBranchControlDialogs`, `GitHistoryActions`, `GitLogTree`, `GitLocalChanges`, and `ChangedFilesList`. The updated flows wire the frontend to branch/history APIs through the shared API client and keep Git-aware file rows aligned with the shared file decoration registry. [See plan](../plans/260516-0155-git-management-completion/phase-02-frontend-branch-and-history-ui.md).

- **Phase 01: Backend Git Operations.** Complete ✓ 2026-05-16. Expanded git API coverage for branch and history actions: (1) `POST /api/git/:project/branches` creates a branch with optional checkout; (2) `POST /api/git/:project/branches/checkout` supports `normal`, `stash`, and `force`; (3) `POST /api/git/:project/branches/update` updates a branch from its tracking branch; (4) `POST /api/git/:project/cherry-pick` applies a commit; (5) `POST /api/git/:project/reset` supports `soft`, `mixed`, `hard`, and `keep`; (6) `POST /api/git/:project/commit` now accepts `amend`; (7) branch names and commit hashes are validated before execution; (8) destructive modes return structured result flags for dirty/conflict cases. [See plan](../plans/260516-0155-git-management-completion/phase-01-backend-git-operations.md).

- **Phase 01: Port Session Control Data Flow.** Complete ✓ 2026-05-15. Frontend ports state now preserves detected owner sessions and exposes a kill-session mutation: (1) `PortEntry.sessionId` keeps `DetectedPort.session_id` for detected rows; (2) tunnel-only rows keep `sessionId: null`; (3) `usePorts()` exposes `killPortSession(sessionId)` and revalidates `ports` plus terminal session queries after `terminal:kill`; (4) no direct PID/process killing added. [See plan](../plans/260515-2045-control-running-ports/phase-01-port-session-control-data-flow.md).

- **Phase 01: Shared File Decoration Registry.** Complete ✓ 2026-05-15. Centralized frontend file metadata lookup in `packages/web/src/lib/file-decoration.ts`: (1) one registry now drives icon, badge, display-language, and Monaco-language selection; (2) exact filename matches cover dotfiles and toolchain files like `.env`, `.gitignore`, `Dockerfile`, `Makefile`, and lockfiles; (3) extension lookup covers code, docs, data, images, archives, fonts, and common config files; (4) MIME fallback handles generic or missing file types; (5) `file-decoration-icon.tsx` is a thin render wrapper; (6) `mime-to-language.ts` stays as a compatibility wrapper for MIME-only callers; (7) unit tests cover exact-name priority, extension fallback, MIME fallback, and neutral defaults. [See plan](../plans/260514-2330-file-extension-decorations/phase-01-shared-file-decoration-registry.md).

- **Phase 02: Shared File Decoration Integration.** Complete ✓ 2026-05-15. Rolled the shared decorator out to the visible IDE surfaces: (1) `FileTree` now renders file-specific icons through the shared registry; (2) `EditorTab` uses the active file path/name for its decoration instead of a generic file glyph; (3) `SearchPanel` file headers show the same decoration as the explorer and tabs; (4) file rows in git/change views can reuse the same lookup without changing VCS badges; (5) `FilePathLabel` continues to read from the shared helper so path labels stay consistent everywhere. [See plan](../plans/260514-2330-file-extension-decorations/phase-02-integrate-file-decorations.md).

- **IDE Tool Windows Refactoring.** Complete ✓ 2026-04-25. Refactored `IdeShell.tsx` to support a flexible, extensible Tool Window system with an Activity Bar, similar to IntelliJ IDEA: (1) New `ActivityBar` component for switching between tool windows (Files, Terminals, etc.); (2) Extensible `ToolWindowDef` interface for defining tool name, icon, and component; (3) `ToolPanel` container with header, actions, and auto-focusing behavior; (4) Persisted layout state in `IdeShell` (active tool ID, sidebar width); (5) Refactored `IdeShell` to use a cleaner tool window state management pattern; (6) Migrated `FileTree` to the new system as the default 'files' tool; (7) Seamless integration with existing `react-resizable-panels` layout; (8) Full TypeScript coverage and logic verification. [See plan](../plans/20260425-ide-tool-windows/plan.md).

- **Phase 01: OPAQUE PAKE Server Integration (Stealth Encrypted Upload).** Complete ✓ 2026-04-27.
  Server-side OPAQUE password-authenticated key exchange for the encrypt-in-transit file upload feature: (1) New `server/src/crypto/` module — `DamHopperOpaqueSuite` implementing `CipherSuite` (Ristretto255 + TripleDH + Identity KSF, matching `@serenity-kit/opaque` client defaults); (2) `load_or_create_server_setup()` generates or loads the server long-term keypair at `~/.config/dam-hopper/opaque-server-setup` with 0o600 permissions; (3) Registration handlers: `handle_register_start()` / `handle_register_finish()` — stateless two-message flow, returning `RegistrationResponse` and `ServerRegistration`; (4) Login handlers: `handle_login_start()` / `handle_login_finish()` — two-message flow, returning intermediate `ServerLogin` state and final AES key derived via HKDF-SHA256 with label `"dam-hopper-aes-256-gcm-v1"`; (5) `export_key` wrapped in `Zeroizing<Vec<u8>>`, zeroed on drop; (6) New `AppState` fields: `opaque_server_setup: Arc<ServerSetup<DamHopperOpaqueSuite>>` (shared) and `opaque_registrations: OpaqueRegistrations` (in-memory HashMap, ephemeral by design — no disk persistence); (7) 8 new `ClientMsg` WS variants (`auth:register_start/finish`, `auth:login_start/finish`, `fs:put_begin/chunk/commit/save`) and 8 new `ServerMsg` response variants with neutral `auth:*` / `fs:put_*` kind names to avoid IDS/DLP fingerprinting; (8) Full WS dispatch in `ws.rs` with all OPAQUE ops in `spawn_blocking`; per-connection caps: 16 in-flight login states, 16 active session keys; `overwrite: bool` on `auth:register_finish` prevents silent credential overwrite; (9) Phase 04 `fs:put_*` handlers stubbed (return not-implemented error); (10) Identifier validation: alphanumeric + hyphens + underscores, max 128 chars. New Cargo dependencies: `opaque-ke = "4"`, `hkdf = "0.12"`, `rand`, `aes-gcm = "0.10"`, `sha2 = "0.10"`, `zeroize = "1"`. [See plan](../plans/20260425-stealth-encrypted-upload/phase-01-opaque-server.md).

- **Phases 02-04: Combined Ports & Tunnel Panel (F-09 Auto Port Forwarding).** Complete ✓ 2026-04-25. Unified sidebar panel merging port detection and tunnel management into single component: (1) `PortsPanel.tsx` replaces deprecated `TunnelPanel` + `PortsPanel`, deletes former; (2) `usePorts` hook merges `DetectedPort[]` (from `/api/ports` via WS `port:list` channel) with `TunnelInfo[]` (from `/api/tunnels`) by port number into single `PortEntry[]`; (3) Three port row states: A (no tunnel, "Open localhost" button if same-host + "Start tunnel"), B (tunnel starting with spinner), C (tunnel ready with public URL + copy/QR/stop buttons); (4) `isLocalServer()` helper determines if browser and server on same host — gates "Open localhost" button visibility; (5) WS event subscriptions: `port:discovered`, `port:lost`, `tunnel:ready`, `tunnel:failed`, `tunnel:stopped` invalidate queries in real-time; (6) Custom port form allows starting tunnels for specific ports not yet detected; (7) cloudflared installer row preserved (shows missing binary state); (8) Public URL warning banner localStorage-gated, shown once per browser; (9) Sidebar integration: single `{!collapsed && <PortsPanel />}` replaces both former panels; (10) `use-tunnels.ts` kept for Phase 05 evaluation. Zero breaking changes, full backward compatibility with existing port/tunnel infrastructure. [See documentation](./frontend-components.md#combined-ports--tunnel-panel).

- **Phase 02: Drag-to-Split Terminal Layout (F-06 Terminal Splitting).** Complete ✓ 2026-04-24. Interactive terminal pane splitting and tab management via drag-and-drop: (1) New `TabBar` component with draggable tab handles using @dnd-kit/core (PointerSensor 8px activation); (2) `PaneContainer` with `PaneDropZones` (5 zones: top/bottom/left/right edges, center) always mounted for droppable registration; (3) `SplitLayout` wrapped in `DndContext` with `pointerWithin` collision strategy and floating `DragOverlay` showing dragged tab label; (4) Drag-end logic: edge zones trigger `layout.splitPane(paneId, direction)` to create new split pane, center zone triggers `layout.moveTabToPane()` to transfer tab without splitting; (5) Auto-collapse: if last tab leaves source pane, pane node removed from tree; (6) Visual feedback: blue highlight (`bg-blue-500/30 ring-blue-400`) on target zones during drag, zones invisible (pointer-events-none) when not dragging to preserve terminal input; (7) New `moveTabToPane(sessionId, fromPaneId, toPaneId)` hook method for atomic tab transfer; (8) Dependencies: @dnd-kit/core@6.3.1, @dnd-kit/utilities@3.2.2 added to package.json. User-facing: drag tab grip handle to pane edge → creates split; drag to pane center → moves tab (no split); blue highlights appear on targeted zone; floating label shows tab name during drag. Zero breaking changes, fully backward-compatible with existing layout tree. [See Phase 02 documentation](./frontend-components.md#drag-to-split-terminal-layout-phase-02).

- **Phase 03: Port Detection Backend (F-09 Auto Port Forwarding).** In progress. Automatic detection of ports opened by running processes in PTY sessions: (1) `PortForwardManager` in-memory registry (Arc<RwLock<HashMap>>) tracks up to 100 detected ports with states: Provisional, Listening, Closed; (2) PTY stdout scanner: ANSI-strip output, apply 7-pattern regex bank (listening on, localhost:port, http://..., etc.), report first match as provisional; (3) Linux /proc/net/tcp poller (2s interval): confirms provisional → listening, reports lost (close event); (4) Port safety filter: blocks system ports (<1024) and danger list (SSH, SMTP, MySQL, PostgreSQL, Redis, MongoDB); (5) `GET /api/ports` REST endpoint (protected): returns `{ "ports": [...] }`; (6) WS push events: `port:discovered` (stdout or proc confirm) and `port:lost` (close); (7) Lazy regex bank via `once_cell`, Linux-only `procfs` crate for proc polling. Frontend receives port events and can construct proxy URLs. [See Phase 03 implementation](./port-detection-implementation.md) (documentation in progress).

- **Phase 06: Startup Restore (F-08 Terminal Session Persistence).** Complete ✓ 2026-04-17. Automatic session restoration on server startup via SQLite persistence: (1) `restore_sessions()` function in new `persistence/restore.rs` module loads session records and respawns PTY processes; (2) Smart filtering: skip `RestartPolicy::Never` sessions (debug log), skip sessions for removed projects (warning log), skip manually killed sessions during kill window; (3) Config-driven restart retry count via `restart_max_retries` from project config with fallback to default; (4) Lazy buffer loading fallback in `PtySessionManager::get_buffer_with_offset()`: try in-memory first (live sessions), fall back to SQLite load (dead sessions); (5) Main.rs integration calls restore after PtySessionManager created, conditional on `session_persistence` config flag; (6) Startup time < 1s with 10 sessions (150ms SQLite load + 50ms PTY spawn); (7) Graceful error handling: per-session failures logged as warnings, database errors non-blocking; (8) Cleanup of expired buffers (TTL-based) triggered automatically; (9) 3/3 tests passing (skip never-restart, skip removed project, restore restartable); (10) Production-ready with comprehensive error scenarios and logging examples. [See Phase 06 documentation](./phase-06-startup-restore/index.md).

- **Phase 05: Persist Worker (F-08 Terminal Session Persistence).** Complete ✓ 2026-04-17. Async worker thread that batches buffer writes to SQLite without blocking PTY hot path: (1) Dedicated worker thread spawned in main.rs consumes commands from bounded mpsc channel (256 slots); (2) PersistCmd enum with 5 command types (BufferUpdate, SessionCreated, SessionExited, SessionRemoved, Shutdown); (3) Batching via HashMap: only latest buffer per session written on flush, deduplicating N updates → 1 write; (4) Flush triggers: 5-second timer, session exit (immediate), server shutdown (graceful); (5) Critical optimization: 16KB throttling reduces snapshot frequency from 100/sec → 6/sec, cutting memory churn from 256MB/sec → 16MB/sec (16x improvement); (6) Non-blocking integration: all 4 try_send() calls in manager.rs ensure PTY reader never blocks on DB I/O; (7) Graceful shutdown: explicit drop(persist_tx) signals worker to final flush on exit, zero data loss; (8) Bounded channel prevents memory explosion if worker stalls; (9) 5/5 unit tests passing (batching dedup, session create, immediate exit flush, removal, graceful shutdown); (10) Code review score 8.5/10 production-ready. All critical issues from initial review (blocking send, memory churn) resolved. Trade-off: <16KB sessions skip 5s flush but still persist on exit + WS reconnect works. [See Phase 05 documentation](./phase-05-persist-worker/index.md).

- **Phase 01: Buffer Offset Tracking (F-08 Terminal Session Persistence).** Complete ✓ 2026-04-17. Scrollback buffer enhancements for efficient WebSocket reconnect delta replay: (1) Monotonic byte counter `total_written: u64` tracks total bytes ever written, survives buffer eviction; (2) New `current_offset()` method returns checkpoint for client storage; (3) New `read_from(Option<u64>)` method returns (delta bytes, current offset) or fallback to full buffer if offset evicted; (4) O(1) delta calculation with zero-cost implementation; (5) 5 new unit tests + 4 existing tests (9/9 passing) covering fresh buffer, eviction, delta replay, edge cases, and monotonic property. Backward compatible, no breaking changes. Enables Phase 02 WebSocket reconnect to send only new bytes (~90% bandwidth reduction in typical scenarios). [See Phase 01 documentation](./phase-01-buffer-offset-tracking/index.md).

- **Phase 07: Tombstone Idempotency.** Complete ✓ 2026-04-17. Server-side idempotency for terminal creation: (1) `terminal:create` now removes matching dead session tombstone before spawning, eliminating need for client-side alive status filtering; (2) Killed set tracks manually terminated sessions to prevent supervisor from restarting during user kill window; (3) Create inserts ID into `killed` set pre-spawn, removes post-spawn (TOCTOU guard ensures at most one spawn wins during concurrent creates); (4) Lock optimization: lock released before slow I/O (openpty, spawn), reacquired with concurrent create check; (5) Memory leak fix: cleanup task prunes orphaned `killed` set entries every 30s (prevents unbounded growth); (6) New integration test validates create-during-backoff race condition — supervisor respawn correctly cancelled by kill flag. Results: 50-100ms lock contention reduction under load, frontend can safely retry terminal creation without state checks. All tests passing. [See Phase 07 documentation](./phase-07-create-idempotency.md).

- **Phase 06: Terminal Lifecycle UI (Frontend).** Complete ✓ 2026-04-17. Visual indicators for terminal process lifecycle events: (1) Status dots in TerminalTreeView (🟢 alive, 🟡 restarting, 🔴 crashed, ⚪ exited); (2) Restart badge in DashboardPage showing `↻ N` when restartCount > 0; (3) Colored exit banners in TerminalPanel (green for code=0, red for non-zero, yellow for willRestart); (4) Restart banner showing `[Process restarted (#N)]` on process:restarted event; (5) Dim reconnect status banners on WebSocket connect/disconnect. New `session-status.ts` module centralizes lifecycle logic. All components subscribe to Phase 5 WS events. Query invalidation on process restart ensures dashboard auto-refresh. [See Phase 06 documentation](./phase-06-frontend-lifecycle-ui.md) and [Frontend Components guide](./frontend-components.md).

- **Phase 05: Enhanced Exit Events + Channel Decoupling.** Complete ✓ 2026-04-17. Backend WS protocol enhancements: (1) Extended `terminal:exit` with optional `willRestart`, `restartInMs`, `restartCount` fields (backward-compatible); (2) New `process:restarted` event announcing successful restart with restart count and previous exit code; (3) Separate PTY and FS channels (PTY async backpressure, FS graceful overflow) to prevent FS event bursts from crashing PTY connections; (4) New `fs:overflow` event notifies of FS subscription overflow. Frontend: new `onProcessRestarted()` event listener, graceful `fs:overflow` handling. All 8 test matrix rows passing (Phase 04 integration). Resolves Failure Mode 3 (FS pump crushing WS). [See Phase 05 documentation](./phase-05-ws-events-channel-split.md).

- **Phase 04: Auto-Restart Engine.** Complete ✓ 2026-04-16. Process lifecycle management with auto-restart on crash: (1) Configurable restart policy per terminal (never/on-failure/always); (2) Exponential backoff (1s→2s→4s→8s→16s→30s max); (3) Supervisor pattern decouples blocking PTY I/O from async restart logic; (4) Dedicated reader thread handles exit detection and restart decisions; (5) Restart count tracking resets on clean exit (exit_code=0); (6) Session ID reused across restarts so frontend tab stays connected; (7) Extension to config and session metadata (Phase 3). All 8 decision matrix rows validated, 5 integration tests passing. Limitation: exit code always inferred as 0 for natural exits (portable-pty API). [See Phase 04 documentation](./phase-04-restart-engine.md).

- **Phase 04: SQLite Schema + Config.** Complete ✓ 2026-04-17. Session persistence infrastructure for surviving server restarts: (1) New `persistence/` module with SQLite-backed `SessionStore` providing CRUD operations; (2) Two-table schema: `sessions` (metadata + environment) and `session_buffers` (scrollback output); (3) New `[server]` config section with three fields: `session_persistence` (bool, default false), `session_db_path` (string, default ~/.config/dam-hopper/sessions.db), `session_buffer_ttl_hours` (u64, default 24); (4) Database files created with 0o600 permissions (Unix-only, user-exclusive access); (5) Automatic migrations on startup; (6) PersistedSession struct captures meta, env HashMap (JSON-serialized), terminal dimensions (cols, rows); (7) All enums (RestartPolicy, SessionType) stored as lowercase strings for portability; (8) 6 unit tests passing (open, save_session, save_buffer, load_sessions, load_buffer, delete_buffer_before); (9) Integration with Phase 04 auto-restart and Phase 02 buffer offset tracking. Disabled by default to maintain backward compatibility; opt-in via configuration. [See configuration guide](./configuration-guide.md#server-configuration) and [system architecture](./system-architecture.md#persistence-phase-04).

- **Phase 02: Multi-Server Connection Management.** Client-side browser-based profile management for switching between multiple dam-hopper servers without app restart. Stores profiles in localStorage with JSON serialization. Includes: (1) `ServerProfile` interface with UUID id, name, URL, auth type, username, and timestamp; (2) Profile CRUD functions in `server-config.ts` (getProfiles, createProfile, updateProfile, deleteProfile, setActiveProfile); (3) UI components: `ServerProfilesDialog` for list/switch/delete, `ServerSettingsDialog` for create/edit, Sidebar integration; (4) Automatic migration from legacy single-server config to profile system on first app load. All profiles persist across browser tabs and sessions. Password never stored locally (username only for display). Auth tokens remain in sessionStorage (cleared on tab close for security). [See Phase 02 documentation](./user-guide-multi-server-profiles.md) and [API Reference](./api-reference.md#client-side-profile-management-phase-2).

- **Phase 01: Server-Side Auth Bypass.** New `--no-auth` CLI flag for local development. Bypasses MongoDB authentication with production safety guards (fails if MongoDB configured or production environment detected). Includes multi-line warning banner and ERROR-level logging. Auto-generates dev tokens with 30-day expiry. Status endpoint shows `dev_mode: true` flag. All 7 integration tests passing: 3 no-auth mode tests + 3 normal auth regression + 1 production safety test. [See Phase 01 documentation](./phase-01-server-auth-bypass/index.md).

### Previous Releases

#### Unreleased (before Phase 01)

### Added

- **Binary streaming for FsWriteFile protocol.** This feature allows for more efficient writing of large files (>5MB) by using binary frames instead of base64 encoded text frames, reducing bandwidth overhead by ~33%.
- **Disk-backed buffering on the server.** The server now uses `NamedTempFile` for buffering `fsWriteFile` chunks, preventing memory spikes for large saves.
- **Client-side binary transport.** Updated `ws-transport.ts` to support the hybrid JSON+Binary frame protocol.
- **Improved Optimistic Concurrency Control (OCC).** mtime and size enforcement are now more robust and verified with extensive tests.

### Fixed

- **Large file RAM spike during saves.** Previously, the server buffered all chunks in RAM, leading to potential OOM for large files.

### Changed

- **Default encoding for large file writes.** Switched from base64 text frames to binary WebSocket frames for better efficiency.

## [1.0.4] - 2026-04-09

### Added

- **Monaco Editor integration.** Full-featured editor with syntax highlighting and tab management.
- **3-phase WebSocket write protocol.** Robust `begin -> chunks -> commit` flow for file saving.
- **File tiering.** Automatic handling of different file types and sizes (normal, degraded, large, binary).
- **Mtime-guarded atomic writes.** Prevents data loss during concurrent edits.
- **ConflictDialog.** User-friendly handling of save conflicts (overwrite vs reload).
- **LargeFileViewer.** Efficient viewing of files > 5MB via range reads.
- **BinaryPreview.** Hex dump viewer for binary files.

## [1.0.3] - 2026-03-25

### Added

- **IDE Shell layout.** Responsive layout using `react-resizable-panels`.
- **Live file tree.** Syncs in real-time with filesystem changes.
- **TanStack Query hooks.** Robust data fetching and FS subscription management.
- **Feature-gated /ide route.**

## [1.0.2] - 2026-03-10

### Added

- **File watcher.** notify-based real-time notifications for file system events.
- **WebSocket event push.** Efficiently pushes FS events to connected clients.
- **inotify-based debouncing.** Prevents event storms on large file changes.

## [1.0.1] - 2026-02-28

### Added

- **IDE File Explorer REST API.** Endpoints for listing, reading, and stating files.
- **Filesystem sandbox.** Secure path validation to prevent traversal.
- **Binary file detection.** Automatic identification of binary files using MIME guessing.

## [1.0.0] - 2026-02-15

### Added

- Initial release of DamHopper.
- Workspace management and project auto-discovery.
- PTY terminal session management.
- Bulk git operations.
- Agent store distribution via symlinks.

## 2026-08-18

- **Project worktree target lifecycle (Phase 07).** Added exact-target removal
  blockers for dirty editor tabs and live terminal sessions, fresh discovery
  before Git removal, unavailable-target root fallback, preserved editor state,
  and orphaned terminal labels for sessions whose project/cwd still points at a
  disappeared worktree. Added real-repository lifecycle coverage and a
  Chromium coverage through the real `WorkspacePage` surface wiring for the
  selected-target request boundary; broader Explorer, search, replace, Git,
  editor/diff, media, and terminal routing uses the shared target context.
  Terminal creation now carries the selected target through `terminal:create`;
  the server validates and persists canonical `worktreePath` metadata, loads
  the configured environment file relative to that target, and coordinates
  creation/removal ownership checks. Stable opaque target-scoped command/profile
  IDs prevent root/worktree collisions. Legacy sessions still reconcile
  through project/cwd metadata, while target-scoped sessions use their immutable
  server-validated marker. Target-loss create and respawn failures emit
  reconciliation events only after fresh validation confirms disappearance;
  unavailable sessions retain their identity and scrollback for close/retry
  while new work falls back to root.
