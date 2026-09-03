# DamHopper Project Roadmap

This document outlines the high-level roadmap for DamHopper development, tracking progress across major phases and milestones.

### Linux Release Installer Architecture (2026-09-04)

- **Phase 01 — [COMPLETED 2026-09-03 16:07:45 +07:00]**: established the strict release-manifest v1 contract, lockstep `vX.Y.Z`/SemVer/component-version validation, Fedora 44 x86_64 systemd profile constants, role-scoped inventory projections, bounded canonical JSON, path/file-type/security exclusions, service/rollback invariants, and matching JSON Schema.
- Validation: vendored all-target `cargo check` passed; focused manifest suites passed 20/20 and the `linux_release` filter passed 10/10 (30/30 executed test invocations); scoped code review approved 9.5/10 with no blocking findings.
- **Phase 02 — [COMPLETED 2026-09-03]**: delivered the Rust `dam-hopper` CLI grammar and privilege matrix (`fetch`, `install`, `role set`, `start`, `status`, `rollback`, `recover`, `version`), Fedora 44/x86_64/systemd profile validation, bounded GitHub acquisition, mandatory SHA-256 with optional attestation, root-safe staging with source-integrity checks, strict archive traversal, role projections, and durable pending metadata without service activation.
- Validation: `cargo check --manifest-path server/Cargo.toml --bin dam-hopper --tests` passed; `linux_release_*` suites passed **45/45 across 7 suites**; scoped clippy and `systemctl --version` checks passed; code review approved **8.8/10** with no blocking findings. Non-blocking hardening recommendations remain recorded in the [review report](../plans/reports/code-review-260903-1644-phase-02-rust-cli-acquisition-staging.md).
- **Phase 03 — [COMPLETED 2026-09-03]**: delivered the non-writing `dam-hopper-web` static host on port `4802`, reserved health/runtime-config routes, strict safe-path and cache policies, bounded runtime-origin bootstrap, managed-profile token invalidation, API-only server defaults, and explicit Docker combined-mode `--web-dir`.
- Validation: `linux_release_web_host` passed **8/8**; API-only/default and API-health focused tests passed **2/2**; runtime/server-config Vitest passed **72/72**; vendored all-target Cargo check plus UI/web builds exited `0`; code review approved **8.5/10** with no blocking findings. [Phase 03 plan](../plans/260903-0919-linux-release-installer-architecture/phase-03-web-host-runtime-origin-health.md).
- **Phase 04 — [COMPLETED 2026-09-03 20:57:20 +07:00]**: delivered role-aware independent API/web systemd unit templates, strict placeholder rendering and policy validation, exact role inventory, dedicated `dam-hopper-web` sysuser, ownership/mode checks, process/listener evidence, root-private pending-unit staging, atomic host configuration, and no-shell systemd adapters. API runs as `root` per the accepted MVP directive; web remains separately unprivileged and isolated. [Phase 04 plan](../plans/260903-0919-linux-release-installer-architecture/phase-04-role-aware-systemd-ownership.md).
- Validation: Linux release integration suites passed **66/66 across 10 suites**; vendored all-target `cargo check` passed with no warnings; scoped review approved **9.0/10** with no blocking findings. Non-blocking hardening recommendations remain recorded in the [review report](../plans/reports/code-review-260903-2025-phase-04-role-aware-systemd-ownership.md).
- **Phase 05 — [COMPLETED 2026-09-03 23:45:08 +07:00]**: delivered durable state/journal records, fsync-backed activation transactions, exact process/listener/health stability probes, automatic/manual rollback, boot-time recovery, and reference-safe retention. [Phase 05 plan](../plans/260903-0919-linux-release-installer-architecture/phase-05-durable-activation-rollback-recovery.md).
- Validation: vendored all-target `cargo check` passed; Phase 05 suites passed **19/19**; full `linux_release*` matrix passed **77/77**; Cycle 2 review approved **9.8/10** with no blocking findings. [Review report](../plans/reports/code-review-260903-2332-phase-05-durable-activation-rollback-recovery.md).
- **Phase 06 — [COMPLETED 2026-09-04 01:05:00 +07:00]**: delivered the central stable-tag GitHub publisher, desktop/stable tag namespace split, deterministic archive assembly, external Manifest v1 and SPDX SBOM generation, exact four-asset local/draft gate, four-subject artifact attestations, and a non-root bootstrap that ends at pending staging. [Phase 06 plan](../plans/260903-0919-linux-release-installer-architecture/phase-06-central-github-publisher-bootstrap.md).
- Validation: publisher contract tests passed **24/24**; `pnpm release:verify`, shell syntax, Node syntax, and vendored all-target `cargo check` passed with no warnings. Cycle 2 review approved **9.5/10** with no blocking findings. [Review report](../plans/reports/code-review-260904-0115-phase-06-central-github-publisher-bootstrap.md).
- **Phase 07 — [COMPLETED 2026-09-04]**: delivered exact read-only legacy
  format-2 verification, same-device sibling staging at
  `/opt/.dam-hopper-migration.<tx_id>`, Linux `renameat2(RENAME_EXCHANGE)`
  cutover, rollback restoration, imported-format-2 retention, and retirement
  of the checkout-built runner scripts, fixed unit, fixture, and aliases.
  [Phase 07 plan](../plans/260903-0919-linux-release-installer-architecture/phase-07-format-2-migration-runner-retirement.md).
- Validation: focused migration fixture/drift/exchange suites passed **14/14**;
  the Fedora rehearsal passed at fixture level; Cycle 2 review approved **9.0/10**
  with no blocking findings. No production-host deployment claim is implied.
- Parent plan progress: **Phases 01–07 complete; Phases 08–09 pending**.
  [Parent plan](../plans/260903-0919-linux-release-installer-architecture/plan.md).

### Preserve Explorer Tree Expansion & Editor View Scroll Position (2026-08-31)

- **Phases 01–03 — [COMPLETED 2026-08-31]**:
  - **Phase 01**: persistent Explorer tree expansion store `useExplorerTreeStore` delivered with target scope isolation (`${project}::${targetKey}`), automatic cascading child loading on remount, folder prune/rename synchronization on deletion/move/rename, and unit test coverage.
  - **Phase 02**: editor Monaco `viewState` (cursor position, column, scroll state, and code folds) persisted to `dam-hopper:editor-state` across tab switching, component unmounting, and browser page reloads; race-safe `tabKey` scoping on `onViewStateChange` prevents tab switch cross-contamination.
  - **Phase 03**: end-to-end integration and regression validation across IDE workspace, compact mobile layout, and floating terminal panels; verified preserved tree expansion, cascading child folder loading, and editor line position retention across tab switches and reloads.
- Validation: full UI Vitest (213 files / 1,422 tests passed), UI TypeScript build passed. [Plan](../plans/260831-1802-preserve-explorer-tree-and-editor-scroll/plan.md).

### Runtime Terminal Custom-Name Persistence (2026-08-31)

- **Feature — [COMPLETED 2026-08-31; final review approved]**: Added nullable runtime custom names independent of configured profile names. SQLite migration 009 and persistence-first acknowledged rename/removal/dispose keep names and lifecycle cleanup durable; race-safe replacement/restore cleanup prevents stale identities from mutating newer sessions.
- Create and authenticated `PATCH` rename validate trimmed names (≤64 Unicode scalars, no control characters), with blank/`null` clear. Names propagate through create, respawn, restore, API/WebSocket, and frontend terminal surfaces; durable rename UX uses custom labels with existing fallback labels when cleared.
- Validation: backend full `cargo test` passed **874 tests, 2 ignored**; full UI Vitest passed **212 files / 1,411 tests**; production build passed; focused browser smoke passed. Broad browser remains **183/187**, with four failures in unchanged baseline areas (`app-zoom` expected 320×180, received 352×198; `ssh-forward-multi-connection` expected switches disabled, enabled; `terminal-panel-replay-notifications` expected inactive activity, active). No restart-persistence manual claim is made because graceful stop removes sessions by design.

### Traditional Terminal Search Focus and Floating Scroll Controls (2026-08-31)

- **Bug fix — [COMPLETED 2026-08-31; final review found no issues]**:
  Traditional-mode Global Search keeps focus through callback-only pane rerenders;
  semantic pane/session focus and native-input suppression remain intact.
  Enabled `TerminalScrollButtons` render only in the active Traditional pane
  above `MobileTerminalAccessoryBar` with the Runtime-compatible accessory-rail
  contract; inactive panes and Browser remain excluded. Runtime source and
  behavior remain unchanged.
- Focused validation passed: UI TypeScript build, focused unit tests (2 files/5
  tests), focused Chromium tests (2 files/8 tests), and actual-app smoke
  confirming three-character search focus retention, scroll trigger/group
  placement above keyboard controls, no xterm focus on scroll activation, and
  Runtime contrast. No broad repository-suite or production/cross-platform
  release validation is claimed. [Plan](../plans/260831-0629-traditional-terminal-search-scroll-fix/plan.md).

### Traditional Terminal Projects Panel Selection Fallback (2026-08-31)

- **Bug fix — [COMPLETED 2026-08-31; review approved 8.5/10]**: Traditional mode now supplies a same-project fallback after closing an active terminal; Runtime global-last behavior remains unchanged.
- Focused unit, browser, and build checks passed. Production-like callback integration coverage remains a required follow-up.

### Touch Long-Press Right-Click (2026-08-12)

- **Phases 01–03 — [COMPLETED 2026-08-12; review approved 8.5/10]**: preserved Radix's single 700 ms touch/pen trigger contract and existing Explorer row/editor-tab menus; added focused hold, targeting, cancellation, nested-control, marker/suppression, mouse/keyboard, focus, portal, dismissal, and native-fallback deduplication coverage. Focused browser **17/17**, full UI unit **992/992**, and serial full browser **120/120** passed.
- ⚠️ Parallel browser runs retain a known unrelated image/video readiness flake (**117–119/120** in reported runs; isolated media and serial runs pass). Physical Android Chrome/iOS Safari native long-press/callout validation remains follow-up. `coverage-v8` was unavailable because the plugin is not installed; no coverage percentage is claimed.

### Explorer Browser Video Playback and Direct Download (2026-08-10)

- **Phase 01 — [COMPLETED 2026-08-10 11:51:39 +07:00]**: purpose-bound playback/download ticket issuance and lifecycle delivered: authenticated opaque capabilities, sandboxed resource/version binding, independent purpose isolation, initial capacity and TTL policy, authenticated revoke, and workspace-change invalidation. Later lifecycle-policy changes are tracked separately.
- **Phase 02 — [COMPLETED 2026-08-10]**: shared bounded Range stream and inline/attachment response policy delivered with purpose-bound disposition and resource revalidation.
- **Phase 03 — [COMPLETED 2026-08-10]**: Explorer browser playback/download UX delivered for the browser host without whole-file buffering or Blob allocation.
- **Phase 04 — [COMPLETED 2026-08-10 15:25:44 +07:00]**: protocol, browser, and resource-safety release gates completed; browser-host scope validated. Caveats: `pnpm check` is blocked by missing `TAURI_SIGNING_PRIVATE_KEY`; final reviewer noted the stale-ticket Chromium assertion accepts any `DELETE`, approved by the user. Tauri support and performance tuning remain deferred follow-ups.

### Explorer Native Image Preview (2026-08-10)

- **Phase 01 — [COMPLETED 2026-08-10]**: shared media-ticket lifecycle, authenticated image ticket/stream APIs, sandbox and regular-file enforcement, closed raster allowlist, version invalidation, range/HEAD/media response behavior, and security regressions delivered.
- **Phase 02 — [COMPLETED 2026-08-10]**: image tier routing, preview-only editor lifecycle, legacy-tab normalization, native `<img>` UI states, and client tests delivered.
- **Phase 03 — [COMPLETED 2026-08-10]**: shared-store/API regression coverage, authenticated Chromium lifecycle coverage, checked-in raster fixture, API/architecture/frontend documentation, and release gates completed. The browser harness validates client capability behavior; the Rust suite remains authoritative for backend security and stream semantics. Release caveat: `pnpm check` reached web/native builds and bundling but remains blocked because `TAURI_SIGNING_PRIVATE_KEY` is unset while a public key is configured; signing configuration was not changed.

## Status Overview

### Browser Debug and Native Child WebView (current status, 2026-08-30)

- Windows v1 is supported only after the WebView2 runtime/evidence gate. The child is least-privileged, profile-scoped, generation/nonce/request validated, and reports raw rendered bounds while mirroring app zoom.
- Linux child/relay code and CI artifacts exist, but runtime behavior and permission policy are unverified. macOS is deferred. Android/mobile uses the iframe adapter.
- Native relay v1 advertises picker/navigation; console forwarding is disabled. Popup/download/permission boundaries remain enforced where verified.
- See [Native Browser Debug Support](./native-browser-debug-support.md). Historical phase/test/performance counts elsewhere in this ledger are dated records, not current release guarantees.

### Terminal Touch Keyboard and Smooth Scroll (2026-08-28)

- **Phases 01–02 — [COMPLETED 2026-08-29 16:48:06 +07:00]**: terminal scroll controls no longer focus xterm input or open the soft keyboard; xterm v6 coarse-pointer touch scrolling uses buffered custom `scrollLines` handling with bounded fling, plus explicit `touch-action: none` and contained overscroll/momentum CSS. Validation: UI TypeScript build PASS; full UI Vitest 1347/1347; focused terminal browser regressions 10/10; Chromium mobile-emulation swipe moved the xterm scrollbar from 280px to 158px. Physical Android hardware validation remains a release follow-up. [Plan](../plans/260828-1430-terminal-touch-keyboard-and-smooth-scroll/plan.md).


### Terminal Floating Controls UX (2026-08-29)

- **Phase 01 — [COMPLETED 2026-08-29; final code review approved]**: responsive floating terminal controls now use a 48px plus safe-area-bottom baseline; the scroll rail reserves `6.25rem` plus gap and switches to compact two-column controls in short viewports. Expanded panels reserve a `6.875rem` trailing lane plus safe-right, stay max-height bounded, and contain horizontal scrolling.
- Terminal Keys order is `Esc`, `Tab`, `Ctrl+C`, `Enter`, `PgUp`, `PgDn`, arrows; Enter sends CR to the active session. Custom Type is a five-row US 60%-style physical layout with Enter and Backspace on base/function layers. Keycaps adapt 24px–44px widths and 4px–8px gaps, maintain 44px minimum height, center/stretch rows, and contain narrow-width horizontal scrolling; Shift labels and modifier-aware ARIA are preserved. Compact shell avoids double bottom safe-area reservation.
- Verification: focused UI units **4 files/24 tests passed**, UI TypeScript build passed, direct Chromium accessory browser checks **10/10 passed**, final scroll/pane browser checks **7/7 passed**. Physical Android/iOS validation remains a release follow-up; no failure is claimed.
- [Plan](../plans/260829-1726-terminal-floating-controls-ux/plan.md).

### Linux Systemd Server-Only Production Runner (2026-08-22)

- **Completed**: production build/stage/install verification now packages only
  the Rust server binary and systemd unit. UI build/test/typecheck and web asset
  installation were removed from this service gate; guarded legacy rollback
  remains available. Validation passed: backend test suite, release server
  build, Bash syntax checks, and Linux deployment fixtures.
  Historical plan source unavailable for the completed server-only production-runner entry.

### Terminal Font Size and Shortcuts (2026-08-16)

- **Phase 01 — [COMPLETED 2026-08-16]**: persisted terminal font size and editable increase/decrease shortcuts, live xterm refit/PTY geometry updates, accessible Settings controls, and regression coverage delivered. Validation: 1,079 UI tests, 124 Chromium tests, UI build/lint, and 74 Rust config tests passed. [Plan](../plans/260816-1356-terminal-font-size-shortcuts/plan.md).

### Terminal Output Activity Indicator (2026-08-17)

- **Phases 01–03 — [COMPLETED 2026-08-17 01:20:11 +07:00]**: browser-local per-session receiving/quiet/unavailable/stopped indicator, lifecycle/replay/hidden-kept-alive coverage, accessibility and bounded-render regressions delivered. Validation: focused UI 26/26, focused browser 6/6, full UI 1,096/1,096, full browser 127/127, UI/root build, lint, and diff-check passed. Docs validation warn-only; no backend, transport/SSE, persistence, or output-content retention changes. [Plan](../plans/260816-1854-terminal-output-activity-indicator/plan.md).

- **Current Phase:** Session Model Delegation Audit complete (Phase 07 released 2026-08-01)
- **Last Milestone:** Release gates, tests, and documentation completed (review approved 9.3/10)
- **Total Phases Completed:** 36 phases (prior roadmap phases plus Terminal Usage Analytics 03–07 and completed Session Model Delegation Audit 01, 02, 04–07)
- **Next Milestone:** Product follow-ups: terminal commit status Phase 03 validation and release checks
- **Current Feature:** Settings commit summary Phase 01 and terminal scroll-control redesign Phase 02 completed 2026-07-26; terminal commit status Phase 03 planned

### Native SSH Port-Forwarding Control (2026-08-09; superseded)

- The initial Phase 01 blocked/no-go entry is superseded by the completed Phase 01–06 Windows-only milestone below; Phase 07 release gates remain deferred.

### Native SSH Port-Forwarding Control (2026-08-15)

- **Phases 01–06 — [COMPLETED 2026-08-14; Windows-only scope]**: Phase 01 Windows dependency/ACL feasibility, Phase 02 native contracts and scope retention, Phase 03 SSH transport/trust, Phase 04 manager/IPC lifecycle, Phase 05 browser-safe host/adapter, and Phase 06 desktop-only control surface are complete. The delivered surface is host-gated to the native desktop, uses explicit reviewed endpoints and lifecycle actions, exposes agent/opaque-key inventory and host-key approval/remediation, and keeps browser/mobile forwarding routes and calls absent. Validation passed: UI 181 files/1,050 tests, Chromium 28 files/121 tests, and Rust 140 passed/1 ignored; build, lint, `cargo check`, `cargo fmt`, and diff checks passed. [Plan](../plans/260808-1310-ssh-port-forwarding-control/plan.md).
- **Phase 07 — [COMPLETED 2026-08-15; WINDOWS-ONLY SCOPE]**: Windows CI/release gates cover Rust format/lint/unit checks, the ignored real OpenSSH remote-loopback forwarding test, deterministic smoke/evidence validation, no-bundle Tauri compilation, and the explicit unsigned NSIS package profile. WebView2/OpenSSH preflight and protected same-commit evidence binding are implemented. Protected runtime evidence remains a production-release prerequisite; macOS, Linux, Android, iOS, signed updater artifacts, and platform expansion are deferred to a separate plan.

### Programming Language Navigation in Explorer (2026-08-10)

- **Phase 03 — [COMPLETED 2026-08-10 00:36:17 +07:00]**: full-project Rust/JS-TS/Java navigation, manual scan states, navigation-only capability gating, selection cleanup, commit-gated reveal, and focused release validation completed.
- Release caveats: temporary-file checks require a `TMPDIR` workaround for exhausted `/tmp` quota; `pnpm check` is blocked at native package validation by disk quota; broad browser coverage retains an unrelated terminal import failure.

### Terminal Pinning and Runtime Contrast (2026-08-08)

- **Phases 01–02 — [COMPLETED 2026-08-08]**: session-only terminal pin protection, shared Traditional/Runtime controls, Runtime contrast/framing, focused DOM coverage, and implementation review completed.
- Manual Chromium contrast/reparent, PTY identity, resize/refit, and host/renderer checks remain documented follow-ups; no fresh validation commands were rerun during tracking update.

### Deferred: terminal runtime activity (2026-08-09)

- The runtime-activity implementation from `0ad51a5` was removed after it was implicated in a Codex terminal-notification regression.
- Revisit this only as a separate PTY-lifecycle design: preserve raw terminal notification signals through shutdown/replacement, order persistence removal after reader drain, and add race coverage for an OSC notification emitted while a session is being replaced or removed.

### Host Resource Monitor Restoration Alerts (2026-08-11)

- **Phase 01 — [COMPLETED 2026-08-11 03:00:34 +07:00]**: monitor signal/keyed alert model accepted. Validation: 58 focused Rust tests, `cargo check` all targets, scoped `rustfmt`, and diff check passed.
- **Phase 02 — [COMPLETED 2026-08-11]**: added bounded, additive `currentAlerts` for concurrent thermal/disk incidents without changing the legacy memory alert; merged memory and resource incidents into newest-first bounded history; published compatible `host:alertChanged` payloads; and added strict client validation, old-server omission compatibility, and per-target recovery handling. Accepted UI caveat: a resource-only critical badge can be info-colored after acknowledgement. [Plan](../plans/260811-0145-host-resource-monitor-restoration-alerts/plan.md).
- **Phase 03 — [COMPLETED 2026-08-11 07:18:58 +07:00]**: restored accessible legacy temperature disclosure with explicit unavailable state and a keyboard-operable, collapsed all-disk storage disclosure while preserving CPU/workspace summary and open-only polling. Review approved 9/10.
- **Phase 04 — [COMPLETED 2026-08-11 09:15:59 +07:00]**: test, validation, and documentation handoff approved; bounded/authenticated/additive alert behavior and accessible disclosure release gate closed. Residual: manual Linux hardware sensor verification remains host-dependent. [Plan](../plans/260811-0145-host-resource-monitor-restoration-alerts/plan.md).

### Host Resource Battery and Energy Telemetry (2026-08-13)

- **Phase 01 — [COMPLETED 2026-08-13 10:15:26 +07:00]**: additive v1 battery DTO, bounded Linux power-supply collector, truthful direct energy/power aggregation, degradation/stale handling, and focused Rust/API validation delivered and approved.
- **Phase 02 — [COMPLETED 2026-08-13 11:08:43 +07:00]**: diagnosis battery/status, remaining-energy (Wh), and instantaneous-power (W) rows delivered with old-server absence tolerance, invalid-value omission, and focused/browser regressions.
- **Phase 03 — [COMPLETED 2026-08-13 11:39:20 +07:00]**: API/frontend contract documentation, Rust/UI/browser/repository release gates, compatibility review, and architecture-drift review completed. Validation caveat: the `TAURI_SIGNING_PRIVATE_KEY` native signing gate was explicitly waived; signing configuration was not changed.

### Compact High-Contrast Host Resource Panel (2026-08-15)

- **Phase 01 — [COMPLETED 2026-08-15 09:42:35 +07:00]**: presentation redesign and deterministic effective-status state completed per approved plan. Phase 02 responsive, accessibility, regression, and review validation remains pending. Historical plan source unavailable.
- **Phase 02 — [COMPLETED 2026-08-15 11:15:14 +07:00]**: automated validation gates and headed-Xvfb smoke passed; regression, accessibility, responsive, and review validation closed. Actual browser-menu 200% zoom and the 100% visual state sweep remain manual/unavailable in this environment, so they remain residual follow-up risk. Historical plan source unavailable.

### Linux Host Resource Monitoring and Gated Remediation (2026-08-08)

- **Phases 01–03, 06 — [COMPLETED 2026-08-08–09]**: delivered the read-only monitoring threat model, bounded contracts/parsers, cached monitor/read APIs, sustained alerts, and in-app diagnosis. No host mutation is enabled.
- **Phase 07 packaging, validation, rollout/rollback — [COMPLETED 2026-08-10 18:23 +07:00]**: release owner accepted completion after local Linux packaging/soak, bounded fixture, Docker, and Chromium evidence. The still-unobserved Windows CI result, intended-canary-host profiling, staged monitor/in-app-alert canary, and rollback rehearsal are explicitly deferred follow-up work, not passed gates. Historical plan source unavailable.
- **Operational/security sign-offs remaining**: real-systemd-host caller/enrollment validation and security-owner acceptance of enrolled-server-compromise residual risk. Privileged helper/actions are not implemented or approved for rollout.

### Floating Terminal Key Controls (2026-08-06)

- **Phase 01 — Implement and verify: [COMPLETED 2026-08-06 22:51 +07:00]**: floating Keys/Type controls delivered for active desktop/mobile terminal surfaces with split-session ownership preserved; 19/19 focused unit and 16/16 relevant Chromium checks passed, builds/lint/formatting/diff checks passed, review approved 9/10.
- Unrelated stale `terminalRegistry` browser import failure remains; remaining warnings are non-blocking and tracked separately.

### Terminal Floating Panel Z-Order (2026-08-07)

- **Phases 01–02 — [COMPLETED 2026-08-07 19:58 +07:00]**: shell-local interaction/focus-aware stacking implemented and verified with 41/41 focused unit tests and 3/3 Chromium hit-testing tests; active panels use z-index 25, peers 20, and higher global layers remain above.
- `pnpm check` reached successful web/native builds and deb/rpm bundling, then was blocked by missing native release-signing setup; no code or configuration change made for the environment-only blocker.

### Production Git Changes Resilience

- **Phase 01 Git-unavailable state — [COMPLETED 2026-08-01]**: typed non-Git API outcome, client/query mapping, and Changes UI unavailable state with mutation suppression.
- **Phase 02 Stale-chunk recovery — [COMPLETED 2026-08-01]**: one guarded reload for recognizable stale Vite module failures, with fallback preservation for repeat or unrelated errors.
  - ✅ ErrorBoundary focused tests: 10/10; browser regression: 64/64; UI production build passed.
  - ⚠️ Full UI baseline: 748/750; two failures are Phase 01 filename-convention checks.
- **Phase 03 Validation and release checks — [PENDING]**: production deployment, stale-tab smoke test, and authenticated real-Git verification remain.

### Terminal Usage Analytics (historical; superseded by the Codex-only OTel contract)

**Live Usage Insights Settings: Phase 01 Runtime Lifecycle and API — [COMPLETED 2026-07-26]**

- [x] Live telemetry activation/deactivation with stable PTY runtime proxy
- [x] Loopback collector reconfiguration with stop-before-bind and rollback
- [x] Protected setup/status API and serialized delete/retention transitions
- [x] Managed Codex exporter, Settings UX, and final verification (Phases 02–04)

**Phase 03: SQLite Store, Retention, Privacy — [COMPLETED 2026-07-26]**

- [x] Separate privacy-preserving telemetry SQLite store and migrations
- [x] Bounded non-blocking writer with WAL and graceful shutdown
- [x] UTC rollup/purge, project exclusion, delete-all, and retention controls _(historical terminal analytics; superseded by the Codex-only contract, which has no project exclusion)_
- [x] DB/API privacy scan and read-only/corrupt store fault coverage

**Phase 04: Aggregate API and Controls — [COMPLETED 2026-07-26; APPROVED WITH WARNINGS]**

- [x] Protected, bounded aggregate endpoints and privacy-safe response contracts
- [x] Settings roundtrip/runtime apply and explicit delete confirmation/reset behavior
- [x] Client DTOs/query keys and API response content scan
- [x] Full-delete HMAC rotation and serialized settings/retention/delete coordination

**Phase 05: Codex Loopback OTel Adapter — [COMPLETED 2026-07-26; APPROVED]**

- [x] Loopback-only authenticated binary receiver with bounded decoding and retry-safe dedupe
- [x] Field-level forward compatibility with partial/unavailable token coverage
- [x] Explicit managed local exporter setup with exact ownership/conflict protection, atomic
  `0600` writes, no bearer disclosure; Codex restart remains a separate user action

**Phase 06: Usage UI and Compact Navigation — [COMPLETED 2026-07-26; APPROVED]**

- [x] Responsive aggregate dashboard, UTC filters, coverage state, pause/exclusion controls *(historical terminal analytics; superseded by the Codex-only contract and its Codex telemetry pause control)*
- [x] Explicit all/range deletion confirmation and no-cost/no-productivity interpretation copy

**Phase 07: Security, Fault, Performance, Documentation — [VALIDATED; REVIEW APPROVED 2026-07-26; PLATFORM CHECKS PENDING]**

- [x] Focused PTY, telemetry, API, OTLP, UI unit, and Chromium browser validation
- [x] SQLite read-only/concurrent/corrupt regression coverage and privacy-safe release documentation
- [ ] External Zsh/Fish, IME, screen-reader, and renderer checks where host executables/devices are unavailable

### Session Model Delegation Audit (2026-08-01)

- **Phase 01 Codex 0.146.0 compatibility gate — [HISTORICAL; COMPLETED (FAIL); review approved 9/10, 2026-08-01]**: app-server responses failed the required content-free boundary; exact lineage work cancelled and superseded by the Codex-only OTel contract.
- **Phase 02 opt-in correlation/model types — [HISTORICAL; COMPLETED 2026-08-01; review approved 8.5/10]**: flat OTel model/token fallback delivered; terminal correlation and `lineage_unavailable` behavior are superseded by the Codex-only contract.
- **Phase 03 metadata adapter/source join — [N/A]**: disabled by failed Phase 01 hard gate; no parent edges may be inferred.
- **Phase 04 `agent_runs` summary persistence — [HISTORICAL; COMPLETED 2026-08-01]**: flat OTel-only model/token summaries persisted with `lineage_unavailable`; replay/conflict handling, retention finalization, overlap deletion, key rotation, and 100k-node indexed performance coverage completed. The historical `agent_runs`/lineage wording is superseded by the current flat Codex session contract. Migration SQL remains runtime-managed; failed rotation may leave a temporary `.next` keyring file until retry.
- **Phase 05 protected session-audit API — [COMPLETED 2026-08-01]**: protected list/detail contracts and deletion/retention semantics delivered; review approved after cycle 3.
- **Phase 06 shared Usage session-audit UI — [COMPLETED 2026-08-01; superseded by Codex-only contract]**: shared browser/native session list/detail, token states, accessibility/deep-link behavior, and degraded/error states are delivered. The current contract is flat Codex summaries with no terminal, tree, lineage, or correlation fields.
- **Phase 07 release gates, tests, and docs — [COMPLETED 2026-08-02; superseded by Codex-only contract]**: Rust/UI/browser/privacy/host-smoke evidence and 100k aggregate/list p95 gates pass for the Codex-only API. Current validation also covers bounded model summaries, strict removed-key rejection, active-session cursors, and flat session detail.
- **Codex OTel-only Usage refactor Phase 05 — [COMPLETED 2026-08-05; review approved 8/10]**: Automated validation, reset/reopen/privacy/terminal-dependency gates, and documentation finalization complete. Release follow-ups: signing key, manual PTY benchmark, and pinned Codex compatibility tests.

## Roadmap Phases

### Phase 01: IDE File Explorer

**Status: [COMPLETED 2026-05-15]**

- [x] Filesystem sandbox
- [x] List/read/stat REST endpoints
- [x] Binary detection
- [x] Path validation and security checks

### Phase 07: Compact Top Navigation (UI/UX Redesign)

**Status: [COMPLETED 2026-04-29]**

- [x] Replace vertical Sidebar with horizontal `TopNav`
- [x] Inline menu toggle (Ctrl+B) with glassmorphism
- [x] Adapted `WorkspaceSwitcher` for compact layout
- [x] Vertical layout refactoring (`AppLayout`, `IdeShell`)
- [x] Responsive design and accessibility polish

### Phase 02: Terminal Workspace Shortcut Routing

**Status: [COMPLETED 2026-05-19]**

- [x] Added configurable `terminalWorkspaceShortcut` to Rust `UiConfig` and TS UI config defaults
- [x] Exposed Terminal workspace shortcut in Settings Keyboard Shortcuts
- [x] Wired `WorkspacePage` to toggle IDE/Terminal modes from the configured shortcut
- [x] Suppressed the shortcut from `TerminalPanel` and `PaneContainer` xterm input
- [x] Validation passed: `pnpm --filter @dam-hopper/web test -- --run src/lib/shortcuts.test.ts src/lib/ui-config.test.ts`, `pnpm build`, `cargo test ui_config`

### Phase 02: File Watcher

**Status: [COMPLETED]**

- [x] inotify integration (Linux) / notify crate (Cross-platform)
- [x] WebSocket subscription + fs:event push
- [x] Live tree sync on file changes
- [x] Debounced events for UI performance

### Phase 03: IDE Shell

**Status: [COMPLETED]**

- [x] react-resizable-panels layout (tree | editor | terminal)
- [x] react-arborist file tree with live sync
- [x] TanStack Query + useFsSubscription hook
- [x] /ide lazy route with feature gate

### Phase 04: Monaco Editor + Save

**Status: [COMPLETED]**

- [x] Monaco integration with tab management
- [x] Ctrl+S save via 3-phase WS write protocol (begin → chunks → commit)
- [x] File tiering (normal <1MB, degraded 1-5MB, large ≥5MB, binary)
- [x] Mtime-guarded atomic writes (conflict detection)
- [x] ConflictDialog (overwrite or reload on concurrent edits)
- [x] LargeFileViewer (range reads), BinaryPreview (hex dump)
- [x] **Performance Optimization: Binary Streaming for Large Files** (Completed 2026-04-14)
  - [x] Binary protocol for `fsWriteFile`
  - [x] Disk-backed buffering via `NamedTempFile`
  - [x] Optimized client-side transport for binary frames

### Terminal Enhancement Feature (F-01) — Process Lifecycle + Auto-Restart

**Phase 04: Auto-Restart Engine (Backend)**
**Status: [COMPLETED 2026-04-16]**

- [x] Restart policy configuration (never/on-failure/always)
- [x] Exponential backoff logic (1s→30s)
- [x] Supervisor pattern for async restarts
- [x] Restart count tracking (resets on clean exit)
- [x] Session ID reuse across restarts
- [x] All 8 decision matrix rows validated
- [x] 5 integration tests passing

**Phase 05: Enhanced Exit Events + Channel Decoupling (Backend/Frontend WS)**
**Status: [COMPLETED 2026-04-17]**

- [x] Extended `terminal:exit` event with `willRestart`, `restartInMs`, `restartCount`
- [x] New `process:restarted` event
- [x] Separate PTY/FS channels (prevent FS overflow from crashing PTY)
- [x] New `fs:overflow` event for graceful degradation
- [x] Frontend: `onProcessRestarted()` event listener
- [x] All tests passing; Failure Mode 3 (filesystem pump overflow) resolved

**Phase 06: Terminal Lifecycle UI (Frontend)**
**Status: [COMPLETED 2026-04-17]**

- [x] `session-status.ts` helper module (lifecycle status determination)
- [x] Status dots in TerminalTreeView (🟢 alive, 🟡 restarting, 🔴 crashed, ⚪ exited)
- [x] Restart badge in DashboardPage (`↻ N` when restartCount > 0)
- [x] Exit banners in TerminalPanel (color-coded by exit code + willRestart)
- [x] Restart banners (`[Process restarted (#N)]`)
- [x] Reconnect status banners (dim, on WS events)
- [x] Query invalidation on process restart
- [x] All manual test scenarios passing
- [x] Unit tests for session-status helpers

**Phase 07: Create Idempotency (Backend)**
**Status: [COMPLETED 2026-04-17]**

- [x] Auto-clean dead session tombstones on terminal:create
- [x] Killed set prevents supervisor from restarting during user kill window
- [x] Idempotent create logic with TOCTOU guard
- [x] Lock optimization (release before slow I/O, reacquire with concurrent check)
- [x] Memory cleanup task for orphaned killed set entries every 30s
- [x] Integration test for create-during-backoff race condition
- [x] All tests passing; 50-100ms lock contention reduction under load

### Terminal Session Persistence Feature (F-08) — WebSocket Reconnect + Delta Replay

**Phase 01: Buffer Offset Tracking (Backend)**
**Status: [COMPLETED 2026-04-17]**

- [x] Monotonic byte counter `total_written: u64` to track cumulative bytes written
- [x] `current_offset()` method for client checkpoint storage
- [x] replay API with `reset`/`truncated` metadata for efficient delta replay
- [x] O(1) delta calculation with zero overhead
- [x] Graceful fallback to full buffer when offset evicted
- [x] 5 new unit tests + 4 existing tests (9/9 passing)
- [x] Backward compatible, all regression tests pass
- [x] Documentation: Quick start guide + technical implementation + completion summary

**Phase 02: WebSocket Reconnect Handler (Planned)**

- [ ] Accept `last_offset` on reconnect message
- [ ] Call `buffer.read_from()` to get delta
- [ ] Send (delta bytes, new offset) to client
- [ ] Client updates terminal with only new bytes
- [ ] Measures: ~90% bandwidth reduction vs full buffer resend

**Phase 03: Frontend Reconnect UI (Planned)**

- [ ] Implement xterm.js terminal reconnect UI
- [ ] Session recovery on WebSocket reconnect
- [ ] Visual status indicators during reconnect
- [ ] Graceful fallback to full buffer on replay

**Phase 04: SQLite Schema + Config (Backend)**
**Status: [COMPLETED 2026-04-17]**

- [x] Added rusqlite dependency
- [x] Created persistence module with SessionStore CRUD operations
- [x] Created SQL schema with sessions and session_buffers tables
- [x] Added ServerConfig to config schema with session_db_path and session_buffer_ttl_hours
- [x] Parse [server] section in config loader
- [x] Initialize SessionStore in main.rs when enabled
- [x] 6 unit tests passing (all CRUD operations covered)
- [x] Code review score: 9/10 (after critical fixes)
- [x] Security: Database file permissions (0o600), SQL injection prevention
- [x] Files: 12 files created/modified, ~480 lines

**Phase 05: Persist Worker (Completed 2026-04-17)**

- [x] Implement background worker for periodic session snapshots
- [x] Buffer flushing to SQLite on configurable interval
- [x] TTL-based buffer cleanup
- [x] Integration with SessionStore
- [x] 5/5 tests passing
- [x] Code review: 9/10, all critical issues resolved
- [x] Production ready for Phase 06

**Phase 06: Startup Restore (Planned)**

- [ ] Load persisted sessions on server startup
- [ ] Restore buffer content to memory
- [ ] Maintain session IDs across restarts
- [ ] Handle corrupted database gracefully

**Phase 07-Additional Session Persistence Features (Planned)**

- [ ] Session snapshots (save/restore terminal state)
- [ ] Offline replay (queue commands during disconnect)
- [ ] Cross-browser session recovery
- [ ] History search and replay UI

### Phase 05: Write Operations

**Status: [PLANNED]**

- [ ] Create file/directory
- [ ] Delete file/directory
- [ ] Move/rename operations
- [ ] Undo/history tracking

### Phase 06+: Advanced Features

**Status: [PLANNED]**

- [ ] Advanced Terminal (split panes, session persistence, search)
- [ ] Git integration UI (blame, diff)
- [ ] AI assistant integration (Gemini/Claude)
- [ ] Multi-workspace management UI

## Recent Milestones

- **2026-08-31:** Completed Preserve Explorer Tree Expansion & Editor View Scroll Position Phase 03: Integration and Verification (Verified Explorer tree expansion persistence across IDE/mobile/terminal surfaces, editor viewState preservation on unmount/tab-switch/reload, zero test regressions across 213 files / 1,422 tests, UI TypeScript build passed).

- **2026-08-31:** Completed Preserve Explorer Tree Expansion & Editor View Scroll Position Phase 02: Editor ViewState Persistence (Monaco viewState persistence to `dam-hopper:editor-state`, unmount/pre-tab-switch key-scoped viewState save, hydration & migration support, full UI suite passed).

- **2026-08-31:** Completed Preserve Explorer Tree Expansion & Editor View Scroll Position Phase 01: Explorer Tree Expansion Store (Zustand persistent store, target scoping, cascading child load on remount, rename/prune synchronization, full UI suite passed).

- **2026-07-19:** Completed Codex terminal notification controls Phase 03: Wire delivery gates and Settings UI (review approved 01:45 +07).
  - ✅ Kept notification history independent while gating in-app toast, browser popup, and synthesized chime delivery from their persisted preferences.
  - ✅ Added accessible child controls, selected sound style/volume preview, and preserved master-switch-only Codex TUI synchronization.
  - ✅ Retained explicit browser permission/audio interactions and delivery bounds for replay, rate limits, toast, and history.

- **2026-07-19:** Completed Codex terminal notification controls Phase 02: Implement selectable synthesized chimes (review approved 01:22 +07).
  - ✅ Added fixed Default, Soft, Two-tone, and Urgent Web Audio patterns with one reusable audio context.
  - ✅ Preserved the legacy Default 880 Hz sine timing and normalized volume semantics.
  - ✅ Added scheduling, cleanup, unavailable-API, autoplay-rejection, and zero-volume coverage.

- **2026-07-19:** Completed Codex terminal notification controls Phase 01: Persist delivery and pattern preferences (review approved 01:07 +07).
  - ✅ Added backward-compatible persisted toast/browser delivery preferences and constrained synthesized-chime pattern selection.
  - ✅ Preserved Codex TUI synchronization as a master-switch-only side effect; child-setting changes are config-only.
  - ✅ Added compatibility, partial-merge, invalid-pattern, and sync-isolation coverage.

- **2026-07-18:** Completed context-menu trigger refactor Phase 03: consumer integration and browser regression coverage.
  - ✅ Verified production `FileTree` / Arborist lifecycle coverage, production `GitBranchControl` / `SelectItem` handoff coverage, and shared context-menu dynamic positioning behavior.
  - ✅ Focused tests/build validation passed for the targeted consumer and browser checks.
  - ✅ Added focused Chromium coverage for Radix touch-held Explorer rows and editor tabs, including marker/ref flow, one-open/native-fallback deduplication, held-target actions, cancellation, and nested-control protection.
  - ⚠️ Browser pointer sequences are synthetic app-level evidence; physical Android Chrome and iOS Safari checks remain required because native long-press/context-menu ordering and callouts differ.

- **2026-07-18:** Completed context-menu trigger refactor Phase 02: Git branch Select handoff.
  - ✅ Restored the local-branch right-click handoff without changing Select value or checkout behavior.
  - ✅ Preserved the lifted Radix presenter, keyboard invocation, dismissal behavior, and current-branch delete guard.

- **2026-07-17:** Completed context-menu placement Phase 02: consumer migration.
  - ✅ Routed the existing context-menu consumers through the shared Radix foundation with forwarded trigger refs.
  - ✅ Kept branch `Select` isolated from the generic context-menu trigger path.
  - ✅ Lifted the diagnostics trigger into dedicated consumer wiring; Phase 01 foundation stays unchanged.

- **2026-07-17:** Completed context-menu placement Phase 03: unit and component verification.
  - ✅ Marked Radix wrapper and consumer coverage complete in the Phase 03 plan.
  - ✅ Recorded Phase 03 status as Done with 2026-07-17 23:17 +0700 timestamp.

- **2026-07-17:** Completed context-menu placement Phase 01: Radix shared foundation.
  - ✅ Added direct `@radix-ui/react-context-menu` integration with body-only portal protection, `Trigger asChild`, collision defaults, and available-space sizing.
  - ✅ Added module-scoped one-open coordination and capture-level scroll close without app-wide state.
  - ✅ Added JSDOM wrapper, lifecycle, and five-category trigger compatibility coverage; UI validation passed: 107 files / 556 tests and TypeScript check.
  - ⏭️ Phase 02 will migrate the seven existing context-menu consumers; Phase 03/04 retain keyboard/focus and Chromium geometry regression coverage.

- **2026-07-16:** Completed Codex terminal notification replay Phase 01: Replay-safe delivery lifecycle (review approved 13:14 +07).
  - ✅ Replayed OSC 9 is suppressed until xterm reports buffer-write completion; concurrent live chunks flush in order afterward.
  - ✅ Focused lifecycle and affected UI validation passed; Phase 02 regression coverage remains pending.

- **2026-07-16:** Completed Safe Inline Terminal Suggestions Phase 03: Suggestion Controller and History/Search Separation (review approved 05:07 +07).

- **2026-07-16:** Completed Safe Inline Terminal Suggestions Phase 05: Release Validation, Documentation, and Rollout (review approved).
  - ✅ Automated validation passed for the shipped inline-suggestion behavior and documentation/rollout work
  - ✅ Automatic suggestions remain fail-closed and retain the immediate kill switch and unsupported-session fallback
  - ⚠️ External release gates remain: manual real-PTY zsh/fish/Bash, IME, screen-reader, and WebGL/renderer checks; none are claimed completed

- **2026-07-16:** Completed Safe Inline Terminal Suggestions Phase 02: Verified Shell Lifecycle Integration.
  - ✅ Added per-PTY-incarnation nonce-backed lifecycle validation and zsh/fish launch adapters
  - ✅ Added bounded OSC 633 parsing with legal transition checks, exact validated command capture, and malformed-byte preservation
  - ✅ Broadcast lifecycle state/generation without serializing the nonce; reset trust on reattach, respawn, invalid markers, and TUI alternate buffers
  - ✅ Kept unsupported shells fail-closed; Bash support uses guarded exact-command capture
  - ✅ Validation passed: focused shell lifecycle parser tests (7/7) and lifecycle protocol coverage

- **2026-07-26:** Completed Phase 02: Validated shell lifecycle capture.
  - ✅ Bash, Zsh, and Fish completion markers now carry optional bounded exit status with versioned adapter capabilities and legacy status-less compatibility.
  - ✅ PTY lifecycle capture emits privacy-safe normalized command events with terminal-run/sequence identity through a bounded non-blocking sink; raw command text does not cross the event contract.
  - ✅ The default path remains no-op and non-durable. `ChannelTelemetrySink` is the intentional Phase 03 durable-worker boundary; telemetry storage, worker processing, and usage APIs remain out of scope.

- **2026-07-26:** Completed Terminal Usage Analytics Phase 03: SQLite store, retention, and privacy.
  - ✅ Added isolated telemetry storage with privacy-safe schema, migrations, and connection pragmas.
  - ✅ Added bounded non-blocking persistence, UTC rollup/purge, project exclusion, and deletion controls. This historical project-exclusion behavior is superseded by the Codex-only contract.
  - ✅ Validated backpressure behavior, database/API privacy, and the 100k-row aggregate benchmark (p95 <200 ms on the validation run; hardware-dependent).

- **2026-07-16:** Completed Safe Inline Terminal Suggestions Phase 01: Security containment and history privacy.
  - ✅ Removed PTY-silence authorization, automatic overlay rendering, input interception, and automatic command recording
  - ✅ Kept all native terminal input byte-for-byte passive while automatic suggestions are unavailable
  - ✅ Added browser-local history clear/disable controls and preserved exact commands for direct API writes
  - ✅ Retained legacy browser history unchanged with no automatic purge; users may clear it explicitly in Settings
  - ✅ Validation passed: focused containment, capability, command-history, prompt-detector, and settings tests

- **2026-07-16:** Completed Codex Terminal Notification Center.
  - ✅ Added bounded session-only notification history with unread badge, item read, mark-all-read, and clear actions
  - ✅ Added responsive top-right bell/feed and a maximum-three toast viewport with automatic and manual dismissal
  - ✅ Preserved native browser notifications while ensuring denied native permission cannot suppress in-app delivery
  - ✅ Reused terminal selection navigation and kept the existing Codex notification setting as the master gate
  - ✅ Validation passed: UI TypeScript compile, 93 files / 482 UI tests, 2 files / 10 browser tests, changed-file ESLint, and feature diff/whitespace checks
  - ⚠️ Root lint remains blocked by three unrelated pre-existing errors in `EditorTabs.tsx` and `use-coarse-pointer.ts`

- **2026-07-14:** Completed Explorer Copy Path context menu (Copy Absolute / Copy Relative Path on file-tree right-click; pure helpers + unit tests; native separators; 422 tests passing).
- **2026-07-09:** Completed Phase 03 TerminalPanel xterm integration for xterm agent notifications.
  - ✅ Wired BEL, OSC, output, command, and exit events into the notification tracker
  - ✅ Final review approved by user, score 9.3/10
  - ✅ No critical issues or warnings

- **2026-05-26:** Completed Tauri v2 Shared UI Native Phase 05: Verification And Documentation.
  - ✅ Fixed compact workspace hook/lint regressions in `WorkspacePage` without changing desktop shell behavior
  - ✅ Revalidated shared, UI, web, native, root build, and lint targets
  - ✅ Updated system architecture, codebase summary, frontend components, and configuration docs for the `apps/web` + `apps/native` + `packages/ui` split
  - ⚠️ Documented remaining manual validation blockers: Tauri Linux prerequisites, sandboxed browser probing limits, and local no-auth server env/persistence issues

- **2026-05-25:** Completed Tauri v2 Shared UI Native Phase 04: Responsive Companion Layout.
  - ✅ Added compact workspace responsive behavior with `MobileWorkspaceShell`, shared compact breakpoint helpers, and safe-area/dynamic-height CSS primitives
  - ✅ Reused existing editor, terminal, fleet, ports, Git, and project surfaces without duplicating business logic or PTY lifecycle
  - ✅ Added terminal refit/layout revision handling for compact surface switches and hardened empty-surface mobile shell behavior
  - ✅ Fixed TopNav compact/tablet behavior, selector layering, project/branch visibility on small screens, and compact connection/status typography
  - ✅ Validation passed: `pnpm --filter @dam-hopper/ui test`, `pnpm --filter @dam-hopper/ui build`, `pnpm build`, and `pnpm dev` boot verification

- **2026-05-25:** Completed Tauri v2 Shared UI Native Phase 02: Shared Logger And Runtime Utilities.
  - ✅ Added dependency-free `@dam-hopper/shared` logger package with scoped `debug/info/warn/error` calls
  - ✅ Added recursive sensitive metadata redaction before sink delivery, plus focused logger tests
  - ✅ Configured web bootstrap log level from Vite env with dev `debug` and production `warn` fallback
  - ✅ Replaced direct `console` usage in high-value transport, auth, terminal, dashboard, error-boundary, and filesystem paths
  - ✅ Validation passed: `pnpm --filter @dam-hopper/shared test`, `pnpm --filter @dam-hopper/shared build`, `pnpm --filter @dam-hopper/ui test`, `pnpm --filter @dam-hopper/ui build`, `pnpm --filter @dam-hopper/web build`

- **2026-05-24:** Completed Tauri v2 Shared UI Native Phase 01: Workspace Split.
  - ✅ Split the frontend into `apps/web` thin host and `packages/ui` shared React UI package
  - ✅ Preserved browser behavior while moving transport, components, styles, tests, and assets into the shared UI package
  - ✅ Added package exports for `DamHopperApp` and shared styles, with the host owning transport/query bootstrapping
  - ✅ Validation passed: `pnpm --filter @dam-hopper/web build`, `pnpm --filter @dam-hopper/web exec tsc -p tsconfig.json`, `pnpm --filter @dam-hopper/ui build`, `pnpm --filter @dam-hopper/ui test`

- **2026-05-20:** Completed Terminal Workspace Docking Phase 05.
  - ✅ Verified `pnpm --filter @dam-hopper/web test`, `pnpm build`, and focused Rust `ui_config` tests
  - ✅ Real-browser verification caught a swapped split-action mapping in the terminal tab bar
  - ✅ Fixed `Split Right`/`Split Down` direction wiring and added a focused regression test
  - ✅ Kept Ports visible in Terminal mode below Fleet Terminal for development port access
  - ✅ Documented terminal workspace persistence keys and runtime verification boundaries

- **2026-05-19:** Completed Terminal Workspace Docking Phase 02.
  - ✅ Added configurable terminal workspace shortcut with default `Mod+Shift+Backquote`
  - ✅ Moved shortcut config through Rust UiConfig, TS UiConfig, and settings UI
  - ✅ Made `Ctrl+Backquote` exact so new-terminal no longer conflicts
  - ✅ Validation passed: `pnpm --filter @dam-hopper/web test -- --run src/lib/shortcuts.test.ts src/lib/ui-config.test.ts`, `pnpm build`, `cargo test ui_config`

- **2026-05-20:** Completed Terminal Workspace Docking Phase 04.
  - ✅ Added intent-based docking targets for pane center, pane edge, and tab insertion index
  - ✅ Added labeled pane docking previews and stronger drag overlay context
  - ✅ Added tab reorder and cross-pane insertion behavior without PTY remount changes
  - ✅ Validation passed: `pnpm --filter @dam-hopper/web exec vitest run src/lib/terminal-layout-docking.test.ts`, `pnpm --filter @dam-hopper/web build`

- **2026-05-19:** Completed Terminal Workspace Docking Phase 01.
  - ✅ Workspace mode state added for IDE/Terminal shell switching
  - ✅ Top nav toggle wired through `WorkspacePage`, `IdeShell`, and `TopNav`
  - ✅ Validation passed: `pnpm --filter @dam-hopper/web test` (123/123), `pnpm build`

- **2026-05-19:** Completed IntelliJ-Compatible Actions Phase 03.
  - ✅ Added safe revert path for pushed/shared commits
  - ✅ Split revert selected changes from drop selected changes
  - ✅ Added undo last commit semantics for local rewrite recovery
  - ✅ Confirmation copy now separates safe vs destructive Git actions
  - ✅ Status updated in plan and phase docs

- **2026-05-16:** Completed PTY Env Leakage Fix Phase 01.
  - ✅ PTY child env now starts from a safe baseline instead of inheriting server process env
  - ✅ Project `env_file` values load into terminal sessions before request overrides
  - ✅ Validation passed: `cargo test --manifest-path server/Cargo.toml pty`, `cargo test --manifest-path server/Cargo.toml terminal`, full `cargo test`

- **2026-05-16:** Completed PTY Env Leakage Fix Phase 02.
  - ✅ Added PTY regressions for synthetic parent-env leakage and safe-baseline shell vars
  - ✅ Added API coverage for project environment-file loading, override precedence, and malformed-file rejection
  - ✅ Documented terminal env precedence in `docs/configuration-guide.md` and recorded completion in `docs/CHANGELOG.md`
  - ✅ Full verification passed: `cargo test --manifest-path server/Cargo.toml`

- **2026-05-15:** Completed Control Running Ports Phase 02.
  - ✅ `PortsPanel` now exposes a confirmed kill action for detected ports with owner sessions
  - ✅ `usePorts()` kill mutation revalidates ports and terminal session data
  - ✅ Validation passed: web build + web tests

- **2026-05-15:** Completed File Extension Decorations Phase 01.
  - ✅ Shared file decoration registry added in `packages/ui/src/lib`
  - ✅ MIME fallback compatibility kept in `mime-to-language.ts`
  - ✅ Unit coverage added for exact-name, extension, and fallback cases

- **2026-04-29:** Completed Compact Top Navigation Redesign.
  - ✅ Replaced vertical sidebar with horizontal `TopNav`
  - ✅ Maximized vertical space for terminal and editor
  - ✅ Implemented glassmorphism and modern toggle menu
  - ✅ Refactored `AppLayout` and `IdeShell` for vertical stacking
  - ✅ Repurposed `Ctrl+B` for top menu visibility

- **2026-04-25:** Completed IDE Tool Windows Refactoring.
  - ✅ Flexible Tool Window system with Activity Bar (IntelliJ style)
  - ✅ Extensible `ToolWindowDef` for new tool integrations
  - ✅ Persisted layout state (sidebar width, active tool)
  - ✅ Refactored `IdeShell` for better state management
  - ✅ Migrated File Tree to the new system

- **2026-04-17:** Completed Phase 05: Persist Worker (F-08 Terminal Session Persistence).
  - ✅ Background worker for async session snapshots
  - ✅ Buffer flushing to SQLite on configurable interval (default 5s)
  - ✅ TTL-based buffer cleanup (default 24h)
  - ✅ Integration with SessionStore for CRUD operations
  - ✅ 5/5 persistence worker tests passing
  - ✅ Critical issues resolved: try_send() hot path, buffer cloning optimization, field cleanup
  - ✅ Code review score: 9/10, approved for merge
  - ✅ 0 critical issues, 0 warnings
  - ✅ Production ready for Phase 06 (Startup Restore)

- **2026-04-17:** Completed Phase 01-04: Session Persistence Infrastructure (F-08).
  - ✅ Phase 01: Buffer Offset Tracking — Monotonic byte counter, delta replay API
  - ✅ Phase 02: Protocol Extension — `terminal:attach` and `terminal:buffer` messages
  - ✅ Phase 03: Frontend Reconnect UI — xterm.js reconnect, "Reconnecting..." overlay, 3s timeout fallback
  - ✅ Phase 04: SQLite Schema + Config — sessions and session_buffers tables, ServerConfig extension
  - ✅ Backend: 128/128 tests passing
  - ✅ Frontend: 0 type errors, production ready

- **2026-04-17:** Completed Phase 01: Buffer Offset Tracking (F-08 Terminal Session Persistence).
  - ✅ Monotonic byte counter `total_written: u64` tracks cumulative bytes written
  - ✅ `current_offset()` method returns checkpoint for client storage
  - ✅ Replay API provides delta/full snapshot metadata
  - ✅ O(1) delta calculation, zero performance overhead
  - ✅ Graceful fallback to full buffer when offset evicted
  - ✅ 9/9 tests passing (5 new + 4 existing)
  - ✅ Backward compatible, no breaking changes
  - ✅ Enables Phase 02 WebSocket reconnect with ~90% bandwidth reduction

- **2026-04-17:** Completed Terminal Enhancement Phases 04–07 (F-01 series).
  - **Phase 06: Terminal Lifecycle UI (Frontend)**
    - ✅ Status dots (🟢 alive, 🟡 restarting, 🔴 crashed, ⚪ exited)
    - ✅ Restart badge (`↻ N`) in DashboardPage
    - ✅ Exit/restart/reconnect banners in TerminalPanel
    - ✅ ANSI color-coded banners (green/red/yellow/dim)
    - ✅ Query invalidation on `process:restarted`
    - ✅ All 7 manual test scenarios passing
    - ✅ New `session-status.ts` helper module with unit tests
  - **Phase 05: Enhanced Exit Events + Channel Decoupling (2026-04-17)**
    - ✅ Extended `terminal:exit` with `willRestart`, `restartInMs`, `restartCount` (backward-compatible)
    - ✅ New `process:restarted` event
    - ✅ Separate PTY/FS channels (prevent FS overflow from crashing PTY connections)
    - ✅ New `fs:overflow` degradation event
    - ✅ Frontend: `onProcessRestarted()` listener
    - ✅ Resolves Failure Mode 3 (FS pump overflow)
  - **Phase 04: Auto-Restart Engine (2026-04-16)**
    - ✅ Configurable restart policy (never/on-failure/always)
    - ✅ Exponential backoff (1s→2s→4s→8s→16s→30s max)
    - ✅ Supervisor pattern for safe async restarts
    - ✅ Restart count tracking (resets on clean exit)
    - ✅ Session ID reuse (frontend stays connected)
    - ✅ All 8 decision matrix rows validated
    - ✅ 5 integration tests passing

- **2026-04-16:** Completed Phase 01: Multi-Server Auth Bypass.
  - ✅ Added `--no-auth` CLI flag for dev mode authentication bypass
  - ✅ Updated AppState with `no_auth: bool` field
  - ✅ Modified auth middleware, login handler, and status endpoint
  - ✅ Added production safety guards (panics if no_auth + MongoDB or prod env)
  - ✅ Created 7 integration tests (all passing)
  - ✅ Code reviewed: 9.5/10 (critical security issue resolved)

- **2026-04-14:** Implemented Binary Streaming for Large File Writes.
  - Switched `fsWriteFile` from base64 text frames to zero-overhead binary frames for large files.
  - Introduced `NamedTempFile` buffering on the server to prevent RAM spikes during large saves.
  - Updated `ws-transport.ts` to support the hybrid JSON+Binary protocol.

- **2026-04-09:** Completed Phase 04: Monaco Editor + Save.
- **2026-03-25:** Completed Phase 03: IDE Shell.

## Success Metrics Tracking

| Metric                   | Target   | Current  | Status    |
| ------------------------ | -------- | -------- | --------- |
| Workspace load time      | <200ms   | ~150ms   | ✓ Passing |
| File explorer response   | <100ms   | ~45ms    | ✓ Passing |
| Large file save (10MB)   | <2s      | ~1.2s    | ✓ Passing |
| Memory usage (10MB save) | Constant | Constant | ✓ Passing |
