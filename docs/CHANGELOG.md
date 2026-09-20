# 2026-09-20
- **Windows server path/config normalization — Phase 01 complete
  (2026-09-20).** Registry parsing/writing now keeps Windows drive, mixed
  separator, UNC, and verbatim project paths TOML-safe; terminal relative
  paths use forward slashes; worktree matching shares one case-insensitive
  extended-prefix-aware identity; disk selection and Agent Store
  import/distribution use the same `dunce` path boundary. Documentation now
  records the lexical validation, containment, symlink, and fallback rules.
  See the [Phase 01 plan](../plans/260920-1312-windows-server-build-and-verify/phase-01-path-and-config-normalization.md),
  [Configuration Guide](./configuration-guide.md), and
  [System Architecture](./system-architecture.md).

- **Multi-profile Host Resources watch — Phase 04 verification and testing complete (100%; 2026-09-20).** Focused unit/component and Chromium validation passed **102/102** tests (83 unit/component; 19 browser), and the UI TypeScript check passed with 0 errors. Coverage proves watch scope, owner/generation isolation, tiered polling, unread partitioning, single-profile compatibility, accessibility, responsive layout, and security negatives. The parent plan is now **COMPLETE (4/4 phases; 100%)**. See the [Phase 04 plan](../plans/260920-0137-multi-profile-host-resources/phase-04-verification-and-testing.md), [tester report](../plans/reports/tester-260920-1130-phase04-multi-profile-host-resources.md), [code review](../plans/reports/code-review-260920-1132-phase04-verification-and-testing.md), and [roadmap](./project-roadmap.md).


- **Multi-profile Host Resources watch — Phase 02 fleet deck and cards complete (100%; 2026-09-20).** Added ordered semantic `HostResourceFleetDeck` composition and profile-scoped `HostResourceFleetCard` summaries with connected-only inspection, empty/partial states, last-known offline qualifiers, finite memory/battery facts, safe long-text wrapping, and display-only sample-age formatting.
- The deck/cards remain read-only presentation over the Phase 01 owner/generation view model: no connection actions, metric averaging, host mutations, or per-card polling. See the [Phase 02 plan](../plans/260920-0137-multi-profile-host-resources/phase-02-fleet-deck-and-card-components.md), [frontend component architecture](./frontend-components.md#host-resource-fleet-deck-and-cards-phase-02), and [system architecture](./system-architecture.md#multi-profile-host-resource-fleet-deck-phase-02).

- **Multi-profile Host Resources watch — Phase 01 multi-profile state and hooks complete (100%; 2026-09-20).** Added owner-safe automatic watch scope, generation-qualified resource-snapshot `useQueries`, per-profile alert presentation, deterministic fleet aggregation, stale-generation fencing, and offline auto-connect last-known handling without connection or host-action side effects.
- Focused Phase 01 UI validation passed **58/58 tests** across the pure host-resource state and multi-profile hook suites; `pnpm --filter @dam-hopper/ui build` passed with no TypeScript errors. Subsequent Phase 02–04 entries complete the parent plan.
- See the [Phase 01 plan](../plans/260920-0137-multi-profile-host-resources/phase-01-multi-profile-state-and-hooks.md), [code review](../plans/reports/code-review-260920-0828-multi-host-resources-phase01.md), [parent plan](../plans/260920-0137-multi-profile-host-resources/plan.md), and [roadmap](./project-roadmap.md).

# 2026-09-17
- **Unified multi-profile workbench — Phase 09 integration and qualification complete; release cutover closed (2026-09-17; 100%).** Parent plan is now complete: all 10/10 phases (Phase 00 through Phase 09) delivered.
- Qualification passed **3,504 tests** with **0 failures** (9 skipped/ignored) across Rust, UI unit/browser, shared, browser bridge, native, live-harness, and embedded-browser suites. The live dual-server harness passed **24/24** S01–S12 assertions; Cycle 2 code review approved **9.8/10**.
- Release cutover is qualified for web and Linux, with explicit `Profile → Project` ownership, independent connection state, matched frontend/backend protocol contracts, media-v2 isolation, and incarnation-bound Browser artifacts. Windows S13 runtime evidence remains a separately tracked native-platform follow-up, not a web release blocker.
- See the [parent plan](../plans/260916-2137-unified-profile/plan.md), [Phase 09 plan](../plans/260916-2137-unified-profile/phase-09-integration-and-qualification.md), [verification matrix](../plans/260916-2137-unified-profile/verification-matrix.md), [qualification report](../plans/reports/tester-260917-2156-phase09-integration-qualification.md), [Cycle 2 review](../plans/reports/code-review-cycle2-260917-2307-phase09-integration.md), and [roadmap](./project-roadmap.md).

- **Unified multi-profile workbench — Phase 08 native scope concurrency and platform integration complete (100%; 2026-09-17).** Delivered concurrent admitted SSH scopes with scope-keyed runtime state, scoped teardown and secret cleanup, true client-epoch global teardown, atomic Tauri IPC/permission cutover, explicit per-scope TypeScript/UI adapters, and one Browser lease.
- Phase 08 focused validation passed **135/135** on Linux: shared Vitest 15/15, native Vitest 48/48, UI focused Vitest 25/25, and native Cargo 47/47; scoped TypeScript checks passed. Post-fix code review approved **9.6/10**. Windows-only S13 live traffic, DPAPI and WebView2 proof remains unverified and is tracked as a native-platform follow-up; it does not block the qualified web cutover.
- See the [Phase 08 plan](../plans/260916-2137-unified-profile/phase-08-native-scope-concurrency.md), [tester report](../plans/reports/tester-260917-2012-phase-08-native-scope-concurrency.md), [post-fix code review](../plans/reports/code-review-260917-2014-phase-08-native-scope-concurrency.md), and [roadmap](./project-roadmap.md).

- **Unified multi-profile workbench — Phase 07 media isolation and encryption complete (100%).** Added required UUIDv4 `mediaClientId` bindings, namespaced v2 media cookies, ticket-selected cookie authorization, fail-closed duplicate parsing, and actor/client-scoped logout and revocation.
- Added bounded `RemoteCleanupHandle` lifecycle for native image/video capabilities and owner-qualified, memory-only encryption state with queued prompts, collision-resistant OPAQUE identifiers, zeroed stale keys, and single-transport encrypted writes without plaintext fallback.
- See the [Phase 07 guide](./phase-07-media-isolation-and-encryption.md), [API Reference](./api-reference.md), [roadmap](./project-roadmap.md), and [Phase 07 plan](../plans/260916-2137-unified-profile/phase-07-media-isolation-and-encryption.md).
- **Unified multi-profile workbench — Phase 06 preferences, Settings, usage, and host resources complete (100%).** Added independent preference-source and Settings-target selectors, captured owner/generation fences for debounced saves and delayed imports, profile-qualified Usage queries/deep links, owner-local host snapshots/alerts/pinned mounts, and revision-fenced Force Machine to Sleep confirmation.
- Phase 06 validation passed **87/87 targeted tests** and **1,760/1,760 full Vitest tests**; TypeScript and modified-file ESLint checks were clean, with a **9.5/10** code review. See the [Phase 06 guide](./phase-06-preferences-settings-usage-and-host.md), [roadmap](./project-roadmap.md), and [plan](../plans/260916-2137-unified-profile/phase-06-preferences-settings-usage-and-host.md).
- **Unified multi-profile workbench — Phase 04 terminals, workflow, and owner-directed navigation complete (100%).** Delivered shared keep-alive PTY continuity across shell/project focus changes, owner-qualified terminal layouts/history/pins/incarnations, owner-bound workflow links and notification navigation, profile-isolated diagnostics exports, and fresh-state reset.
- Scoped Phase 04 UI suites passed **42/42 tests** and the UI TypeScript build completed cleanly; Cycle 3 code review approved **8.8/10** with no critical issues. Follow-up warnings remain non-blocking.
- [Phase 04 guide](./phase-04-terminal-continuity-workflow-navigation.md) · [Phase 04 plan](../plans/260916-2137-unified-profile/phase-04-terminals-workflow-and-navigation.md) · [Parent plan](../plans/260916-2137-unified-profile/plan.md) · [Final code review](../plans/reports/code-review-260917-1321-phase-04-terminals-and-workflow.md).
- **Unified multi-profile workbench — Phase 05 agents, ports and Browser complete (100%).** Delivered owner-qualified agent catalogs/imports/memory drafts and same-owner distribution; qualified port/tunnel rows; explicit Browser target revision, lease and trust invalidation; owner-local capability availability; and same-owner terminal artifact capture with server-enforced incarnation-safe PTY handoff.
- Phase 05 targeted validation passed **44/44 tests**; UI TypeScript build and Rust `cargo check` completed successfully; Cycle 2 review approved **9.5/10** with no critical issues. Live-browser and Windows runtime proof remain Phase 08/09 qualification work. [Phase 05 plan](../plans/260916-2137-unified-profile/phase-05-agents-ports-and-browser.md) · [QA report](../plans/reports/qa-260917-1517-phase-05-agents-ports-browser-validation.md) · [Cycle 2 review](../plans/reports/code-review-260917-1522-phase-05-cycle2.md).

- **Unified multi-profile workbench — Phase 02 complete (100%).** Delivered
  independent profile connections and controls, endpoint-bound credentials,
  grouped `Profile → Project` navigation, fresh browser-resource reset,
  independent selectors, and explicit host bootstrap without page reloads or
  focus-triggered reconnects.
- Non-Windows native now rejects unsupported cross-origin profiles before
  auto-login or connection traffic; profile edits, removals, and cross-tab
  credential changes remain generation/endpoint fenced.
- Final UI/native/web builds passed and the full Vitest suite passed
  **1,766/1,766**. Coverage percentages remain unreported because the optional
  `@vitest/coverage-v8` provider is not installed.
- [Phase 02 plan](../plans/260916-2137-unified-profile/phase-02-unified-shell-and-profile-migration.md) ·
  [Parent plan](../plans/260916-2137-unified-profile/plan.md) ·
  [Final code review](../plans/reports/code-review-260917-0847-phase-02-unified-shell-cycle-3.md).
- **Unified multi-profile workbench — Phase 03 files, editor, search, and Git.**
  Added profile/worktree-qualified filesystem CRUD, watchers, uploads, previews,
  editor models, federated search, target-captured Replace Next/All, and
  target-aware Git result/retry documentation. Dirty tabs remain isolated and
  are not overwritten by watcher or Git reloads; federated search warns when
  its 500-match aggregate is truncated.
- See [Phase 03 Files, Editor, Search, and Git](./phase-03-files-editor-search-git.md),
  [API Reference](./api-reference.md), and [System Architecture](./system-architecture.md).

# 2026-09-16

- **Settings Page workspace TOML import & export restored.** Fixed the
  browser-native import/export flow across the web UI and Rust API:
  - Export: `GET /api/settings/export/workspace.toml` returns the active
    `dam-hopper.toml` bytes unchanged as `application/toml; charset=utf-8`,
    preserves comments/whitespace/order, forces
    `Content-Disposition: attachment; filename="dam-hopper.toml"`, and sets
    `Cache-Control: no-store`; the browser downloads it through a Blob.
  - Import: `POST /api/settings/import/workspace.toml` accepts the raw TOML
    payload (optional UTF-8 charset) with a route-local 1 MiB cap, validates
    UTF-8/TOML/schema/path rules and protected telemetry/idle-suspend fields,
    creates an exclusive mode-`0600` `dam-hopper.toml.bak.<UTC>` containing
    exact prior bytes, atomically publishes the request bytes, and reloads
    runtime state.
  - Failure safety: A reload failure atomically restores the prior file bytes
    and reapplies prior runtime state; the transaction backup is removed only
    after confirmed rollback and is retained if recovery fails.
  - Retention: Successful imports best-effort keep the five newest server
    backups whose names match the exact UTC timestamp format; manual backups with other names,
    including similar-prefix names, are preserved.
  - Error handling: HTTP `415` rejects non-TOML content types, `413` rejects
    oversized payloads, and `409` rejects a workspace change during admission.

# 2026-09-15

- **Linux release manager v0.3.1 upgrade & rollback resilience fix.** Fixed
  two-stage activation and rollback failure during upgrade from v0.2.0:
  - Reconciled existing API state directories `/var/lib/dam-hopper`,
    `/var/lib/dam-hopper/.config`, and `/var/lib/dam-hopper/.config/dam-hopper`
    by safely tightening directory permissions from legacy `0755` to required
    `0700` (`fchmod` via descriptor) after validating genuine directory and
    expected UID:GID ownership.
  - Added backward-compatible reading of installed Manifest v1 for managed
    active and previous releases (`schemaVersion: 1`, optional legacy API
    `identity: "root"` field, and inventory validation without requiring
    idle-suspend helper components introduced in v0.3.0) during rollback,
    active preflight, recovery, and retention. External candidate staging and
    publishing remain strictly Manifest v2.

# 2026-09-14

- **Production idle-suspend diagnostics — Phase 07 complete.** Cross-layer
  verification, architecture reconciliation, read-only Linux smoke, security
  review, documentation, and rollout qualification are complete.
- Added `server/tests/idle_suspend_phase07.rs` with 2/2 deterministic automatic
  and manual lifecycle checks. Added the six-module
  `server/tests/idle_suspend_diagnostics.rs` suite with 8/8 deterministic
  fault, redaction-corpus, bounds, role/EUID, local-API, and atomic-output
  checks.
- Added the explicitly ignored
  `server/tests/idle_suspend_diagnostics_linux_smoke.rs` production-adapter
  smoke with temporary output and unchanged host/configuration/audit, RTC, and
  API/helper unit snapshots.
- The five-command focused gate recorded **223/223 aggregate executions** with
  zero failures; the separate cross-layer target passed **2/2** and the latest
  cycle-2 review approved the scope at **10.0/10**. No coverage percentage or
  real suspend/resume canary is claimed.
- Reconciled architecture, API, configuration, security, Linux/systemd,
  codebase-summary, PDR, and rollout/rollback documentation with the delivered
  fixed-source, bounded, privacy-safe collector.

- **System daemon state configuration — Phase 01 complete (2026-09-14).**
  Canonical API configuration is `/var/lib/dam-hopper/dam-hopper.toml`
  (final API UID:GID, mode `0600`); `/etc/dam-hopper/dam-hopper.toml` is a
  validated, read-only, copy-once migration source. Server timing/manual audit
  state is `/var/lib/dam-hopper/idle-suspend-audit.jsonl`. Provisioning walks
  trusted descriptors, stages exact bytes in a no-follow sibling, publishes
  with Linux `renameat2(RENAME_NOREPLACE)`, synchronizes the state directory,
  and cleans only identity-matching unpublished objects. Unsafe metadata,
  invalid legacy state, races, and publication failures fail closed. See
  [Linux API Runtime Provisioning](./linux-release-runtime-provisioning.md).
- **System daemon state configuration — Phase 02 complete (2026-09-14).**
  Aligned the API systemd template, checked-in unit, strict rendered policy,
  and staged output on canonical `/var/lib/dam-hopper/dam-hopper.toml`.
- `validate_api_unit_policy` now requires exactly one canonical `ExecStart`
  and the sole zero-operand privileged `provision-api-runtime` prestart;
  legacy `/etc` paths, duplicates, alternate operands, and extra arguments
  are rejected.
- Focused unit-policy and staging evidence passed **29/29**; cycle-2 review
  approved the phase **10/10**. Existing identity, HOME/XDG, hardening,
  lifecycle hooks, and restart behavior remain unchanged.
- [Phase 02 plan](../plans/260914-0854-system-daemon-state-config/phase-02-systemd-unit-template-checked-in-unit-and-policy.md) ·
  [Cycle-2 review](../plans/reports/code-review-260914-1805-phase02-systemd-unit-template-and-policy-cycle2.md).

- **System daemon state configuration — Phase 03 complete (2026-09-14).**
  Preflight now performs server-role-only, read-only canonical/legacy SQLite
  discovery with bounded no-follow TOML inspection, API HOME/working-directory
  path semantics, stable deduplication, and database/WAL/SHM holder protection.
  The release installer stages pending bytes without daemon-TOML provisioning;
  first Server/Both start remains the runtime provisioner's boundary, while
  Web-only installs remain API-state-free.
- Reset now defaults to `/var/lib/dam-hopper/dam-hopper.toml` and performs
  refusal-based, API-identity same-directory atomic disablement while
  preserving audits and foreign RTC state. Clean-install, security, reset,
  migration, rootless, and release-artifact checks passed; the focused Rust
  preflight suite passed **11/11** and Cycle-2 review approved **10/10**.
- Architecture, configuration, release-manager, systemd, roadmap, and
  codebase-summary docs now describe these authorities and repair workflow;
  final documentation validation passed **327 internal links across 29 files**.
  Protected Fedora runtime qualification requires dedicated runner hooks and
  is not claimed as local execution.
- [Phase 03 plan](../plans/260914-0854-system-daemon-state-config/phase-03-preflight-installer-reset-and-smoke-tests.md) ·
  [Cycle-2 review](../plans/reports/code-review-260914-2028-phase03-preflight-installer-reset-and-smoke.md).

- **System daemon state configuration — Phase 00 merge reconciliation complete
  (2026-09-14).** Reconciled `origin/main` into
  `feat/terminal-idle-suspend` without importing recursive `chown`; preserved
  refusal-based descriptor provisioning, aligned the API systemd template/unit
  policy, accepted upstream `use-clipboard.ts` and `WATCHDOG.yml` changes, and
  synthesized all conflicting docs plus the workflow context page.
- Cycle-2 review approved **10/10** and confirmed 85 staged files, 0 unmerged
  files, and 0 conflict markers. The merge commit remains pending; daemon-state
  cutover is Phase 02–03 scope. [Phase 00 plan](../plans/260914-0854-system-daemon-state-config/phase-00-merge-origin-main-and-reconcile-conflicts.md) ·
  [Cycle-2 review](../plans/reports/code-review-260914-1158-phase-00-merge-origin-main-cycle2.md).

# 2026-09-13

- **Interactive Script and Sandbox Enhancements in HTML Preview.** Added `html-preview-transform.ts` and updated `HtmlPreview.tsx` to enable full interaction with embedded `<script>` tags, forms, and browser APIs inside sandboxed HTML previews while strictly maintaining `null`-origin parent isolation (omitting `allow-same-origin`).
  - Added `allow-forms`, `allow-popups`, and `allow-pointer-lock` to iframe sandbox attributes (`sandbox="allow-scripts allow-modals allow-forms allow-popups allow-pointer-lock"`), enabling form submissions, button interactions, popups, and pointer-lock APIs.
  - Injected an in-memory `localStorage` and `sessionStorage` fallback shim to prevent fatal `SecurityError: The document is sandboxed and lacks the 'allow-same-origin' flag` exceptions when user scripts access storage.
  - Injected an in-frame visual modal alert fallback for `window.alert()` to overcome modern browser suppression of native dialogs in cross-origin/sandboxed iframes.
- Validation: Vitest unit tests **59/59 passed** across all HTML preview suites (including 4 new tests in `html-preview-transform.test.ts`). Chromium browser tests **14/14 passed** across `consumer-context-menu.browser.tsx` and `script-interaction.browser.tsx` verifying DOM manipulation, interactive counter script, form submission, in-memory localStorage, and in-frame alert modal. TypeScript build (`tsc -p tsconfig.json`) passed cleanly.

- **Production idle-suspend diagnostics — Phase 06 Linux CLI integration complete (2026-09-13).** Added the exact `dam-hopper diagnose --json` grammar, role-aware fixed host/API/command/probe adapters, non-root permission boundaries, atomic root/user output (`0700`/`0600`), path-only stdout, and complete/partial/fatal exit mapping (`0`/`2`/`1`). Phase 07 rollout remains planned.
- **Production idle-suspend diagnostics — Phase 05 bundle/correlation engine complete (2026-09-13).** Delivered the pure bundle-v1 model, bounded no-follow JSONL readers, strict privacy projection, source completeness/status, exact UUID correlation, gap/restart/orphan analysis, and deterministic 8-MiB whole-record reduction.
- Validation passed: **202/202 tests** (**16 diagnostics + 186 `idle_suspend`**); Cycle 2 code review approved **9.5/10**; canonical advisor lifecycle completed. [Phase 05 plan](../plans/260912-0027-production-idle-suspend-diagnostics/phase-05-bundle-correlation-engine.md) · [Code review](../plans/reports/code-review-260913-2327-phase-05-bundle-correlation-engine-cycle2.md).

- **Production idle-suspend diagnostics — Phase 03 coordinator integration complete (2026-09-13).** `AppState` now owns one optional canonical event writer; the coordinator emits authoritative automatic/manual lifecycle events, preserves exact UUID correlation through helper dispatch, audit, accepted responses, outcome, and reconciliation, and keeps event emission silent for scheduled samples.
- Validation passed: focused coordinator event tests **7/7**, full `idle_suspend::tests::` unit filter **84/84**, and `server/tests/idle_suspend` integration tests **19/19**; code review approved **9.3/10** with no critical findings. [Phase 03 test report](../plans/reports/tester-260913-1806-phase03-server-coordinator-instrumentation.md) · [Code review](../plans/reports/code-review-260913-1807-phase03-coordinator-instrumentation.md).
- **Production idle-suspend diagnostics — Phase 04 helper audit milestone enrichment complete (2026-09-13).** Evolved the existing root helper audit in place to schema v2 with producer identity/sequence, typed rejection/capability/preflight/RTC/invocation/outcome milestones, exact UUID propagation, durable intent ordering, secure bounded pruning, and legacy protocol/action compatibility.
- Validation passed: focused helper tests **23/23**, full `idle_suspend` module **172/172**, and helper binary build; Cycle 2 code review approved **9.8/10** with no critical or high findings. [Phase 04 plan](../plans/260912-0027-production-idle-suspend-diagnostics/phase-04-helper-milestone-enrichment.md) · [Test report](../plans/reports/tester-260913-1935-phase04-helper-audit-milestone-enrichment-cycle2.md) · [Code review](../plans/reports/code-review-260913-1937-phase-04-helper-milestone-enrichment-cycle2.md).

- **Production idle-suspend diagnostics — Phase 02 canonical event foundation complete (2026-09-13).** Added the closed canonical event model, boot/producer identity, checked sequence and UUID correlation primitives, plus a bounded mode-0600 no-follow synced JSONL writer. Existing untagged server-audit behavior remains unchanged; at that point Phases 03–07 were pending.
- Validation passed: canonical event tests **11/11**, server-audit compatibility **1/1**, and full `idle_suspend::` module **143/143**; code review approved **9.5/10** with no critical findings. [Phase 02 test report](../plans/reports/tester-260913-1637-phase02-canonical-event-foundation.md) · [Code review](../plans/reports/code-review-260913-1639-phase02-event-writer.md).

# 2026-09-12

- **Phase 03: Explorer Context Menu Integration and Test Coverage.** Added "Preview" action with `Eye` icon to `TreeContextMenu.tsx` for HTML files. Integrated preview handler in `FileTree.tsx` guarded by a 5MB size safety threshold (`node.size < 5 * 1024 * 1024`), setting view mode to `"preview"` before triggering `onFileOpen`. Introduced `HTML_VIEW_MODE_CHANGED_EVENT` (`dam-hopper:html-view-mode-changed`) dispatched by `saveHtmlViewMode` and observed by `HtmlHost.tsx` to ensure mounted tabs immediately switch to preview mode when launched from Explorer.
- Validation: Vitest unit tests **55/55 passed** across context menu consumers, TreeContextMenu, HtmlHost, HtmlPreview, html-file, and html-view-mode-persistence test suites. Chromium browser tests **10/10 passed** in `consumer-context-menu.browser.tsx` verifying context menu preview rendering, file opening, preference persistence, and non-HTML filtering. UI build (`tsc -p tsconfig.json`) passed cleanly. [Phase 03 Plan](../plans/260912-2240-explorer-html-preview/phase-03-explorer-menu-and-tests.md).
- **Phase 02: HtmlHost Editor Component and EditorTabs Routing.** Added `HtmlHost.tsx` containing Edit | Split | Preview mode toggle controls, lazy-loaded MonacoHost editor integration, and `HtmlPreview` pane. Implemented Edit mode (100% Monaco), Split mode (50/50 Monaco and sandboxed preview with divider), and Preview mode (100% sandboxed preview), with preferences persisted to `dam-hopper:html-view-mode:v1` and support for `initialMode` overrides. Integrated lazy-loaded `HtmlHost` routing with Suspense in `EditorTabs.tsx` for HTML files matching `isHtmlFile(activeTab.name)`.
- Validation: Vitest unit tests **6/6 passed** in `HtmlHost.test.tsx` (default mode rendering, initialMode override, mode toggling, preference persistence, readOnly propagation). Full suite across HTML preview helpers and components **28/28 passed**. TypeScript compilation passed. [Phase 02 Plan](../plans/260912-2240-explorer-html-preview/phase-02-html-host-and-editor-tabs.md).
- **Phase 01: HTML File Helper, Mode Persistence, and Sandboxed HtmlPreview.** Added `html-file.ts` with case-insensitive `.html`/`.htm`/`.xhtml` detection and MIME resolution, `html-view-mode-persistence.ts` storing `"edit" | "split" | "preview"` mode under `dam-hopper:html-view-mode:v1` (defaulting to `"edit"`), and the sandboxed `HtmlPreview.tsx` iframe component with `sandbox="allow-scripts allow-modals"` (opaque origin isolation), 200ms debounce, and reload button. Also resolved timer typing in `use-clipboard.ts`.
- Validation: Vitest unit and component tests **22/22 passed** across `html-file.test.ts`, `html-view-mode-persistence.test.ts`, and `HtmlPreview.test.tsx`. TypeScript build (`tsc -p tsconfig.json`) passed cleanly. [Phase 01 Plan](../plans/260912-2240-explorer-html-preview/phase-01-helpers-and-html-preview.md).

# 2026-09-11

- **Configured-agent activity idle suspend — Phase 08 documentation, runbooks, and controlled rollout complete (2026-09-11).** Integrated operator documentation, operations runbooks, controlled rollout stages, and rollback procedures across all system guides.
- Delivered across: `system-architecture.md` (implemented dataflow & heuristic boundaries), `api-reference.md` (v1 status DTO, all enums, nullable counts, privacy boundaries), `configuration-guide.md` (exact paths, startup immutability, TOML examples, rollout stages, two-level rollback), `terminal-idle-suspend-security.md` (unprivileged procfs/netlink boundaries, fail-closed policy, warning exclusions, final race caveat, canary prerequisites), `linux-systemd.md` (observer qualification, operator reason guide, observation soak, bounded canary, stop criteria, rollback runbooks), `linux-release-manager.md`, `code-standards.md`, `codebase-summary.md`, `project-overview-pdr.md`, `project-roadmap.md`, `docs/README.md`, `README.md`, and `scripts/run-uat.sh`.
- Validation passed: boundary checks **14/14**; idle-suspend integration exercised **20/20** scenarios (**19/19** default tests plus **1/1** ignored live Linux smoke in **0.74s**, with 2 other tests ignored); Chromium browser tests **16/16**; full UI suite **1606/1606** across 233 files (1,642 qualified tests plus 14 boundary checks); code review approved **9.6/10**. See [Phase 08 QA](../plans/reports/qa-260911-1207-phase08-idle-suspend-rollout.md) and [code review](../plans/reports/code-review-260911-1208-phase08-docs-rollout-rollback.md).
- Plan progress: **COMPLETE (100%; 8/8 phases done; 111/111h)**. Real-host automatic suspend canary remains an explicit Operations-supervised deployment gate with host qualification, exclusive RTC ownership, and bounded wake.

- **Configured-agent activity idle suspend — Phase 07 integrated qualification complete (2026-09-11).** Qualified managed PTY output/input, attributable TCP traffic, protected status/API warnings, Chromium rendering, fake suspend admission, recovery, and shutdown.
- Validation passed: backend/PTY/API/integration **323 passed**, security boundary **14/14**, Chromium **16/16**, and the ignored live Linux PTY/TCP smoke **1/1 in 0.72s**; code review approved **9.4/10**. Automated evidence used fake suspend outcomes and did not invoke host suspend, RTC programming, helper execution, sudo, or root installation.
- **Configured-agent activity idle suspend — Phase 06 complete.** Added a
  strict `unknown`-to-`IdleSuspendStatusV1` decoder with exact two-field
  old-server normalization and fail-closed malformed/partial response
  handling. The protected status remains version 1, authenticated, and
  `Cache-Control: no-store`.
- Extended `HostIdleSuspendStatus` with policy, aggregate measurement state and
  reason, nullable/unknown counts, TCP4/TCP6 coverage, persistent heuristic
  limits, bounded measurement-warning duration and PID/safe identity examples,
  and the sole `armDeadlineMs` countdown. Manual force confirmation still uses
  actual fleet counts and existing handoff/409/no-retry behavior.
- Validation passed: protected API **9/9**, frontend unit **41/41**, Chromium
  **13/13**; code review approved **9.7/10**. Warning serialization tests
  reject command arguments, matcher data, socket details, terminal/session
  identities, and tokens. Integrated real-observer qualification remains Phase
  07 work.

- **Configured-agent activity idle suspend — Phase 05 complete.** Added the
  dedicated joinable transactional sampler worker, sequential process/TCP
  prepare with raw-output and manager invalidation fences, one-deep
  retryable-close-race retry, back-to-back baseline commit, and opaque final
  admission tickets.
- Added manager-locked automatic admission for policy, request/activity/epoch/
  timing revisions, quiet deadline, observation age, input/generation/root/
  output fences, and PTY lifecycle blockers. Public status now requires
  `automaticPolicy`, reports nullable `activity`, and projects bounded
  `measurementWarning` process identities (maximum 32, no args or socket
  details). Coordinator recovery latches spent epochs and joins the sampler
  before PTY teardown.

- **Configured-agent activity idle suspend — Phase 02 complete.** PTY sessions now capture qualified root `(pid, start_ticks)` identity per incarnation, count raw PTY reads with a saturating counter, fence accepted input before writer dispatch, reject writes during handoff, and expose bounded private observation snapshots without leaking terminal content.
- Validation passed: focused PTY activity tests **8/8**; PTY module suite **159 passed, 1 ignored** (pre-existing performance gate). Code review scored **9.5/10** with no critical issues. At that point, Phase 03 and Phase 04 completion entries followed and Phases 05–08 were pending.
- **Configured-agent activity idle suspend — Phase 03 complete.** Added private bounded `ProcessDiscovery<S>` over `ProcessSource`/`LinuxProcSource`, exact identity-safe root/retained descendant attribution, finite executable matching, same-namespace socket ownership, and transactional prepared samples.
- Enforced caps for 256 roots, 8,192 scanned processes, 1,024 relevant processes, 4,096 FDs per process, 8,192 socket inodes, and 16 KiB command lines; incomplete, stale, and ambiguous observations fail closed.
- Validation passed: latest focused process discovery validation **18/18**, idle-suspend **100/100**, and PTY **187/187** (one pre-existing performance test ignored). Code review approved **9.0/10** with no critical issues. At that point, Phase 04 and later phases were pending.
- **Configured-agent activity idle suspend — Phase 04 complete.** Added direct unprivileged `NETLINK_SOCK_DIAG` TCP4/TCP6 byte observation, bounded multipart framing and `TCP_INFO` parsing, persistent cookie/family/namespace identity, per-socket differential activity, transactional prepare/commit, and fail-closed transport/privacy handling.
- Validation passed: Phase 04 TCP/netlink focus **40/40**, latest activity suite **59/59**, full idle-suspend library **128/128**, and crate-wide **142/142**; all reported runs passed. Cycle-2 code review approved **9.8/10** with no critical issues. At that point, Phases 05–08 were pending.

# 2026-09-10

- **Production CLI Deployment Setup for Idle Suspend Helper & Socket — Phases 01–04 complete.** Phase 04 closes staged-unit, rendered-policy, role-isolation, boundary, and CLI status verification; release-manager activation starts the helper before the API with non-fatal fallback, and rollback/recovery retain helper ownership.
- Validation passed: `linux_release_staging` **9/9**, `linux_release_unit_policy` **10/10**, `idle_suspend` library **69/69**, `idle_suspend` integration **14/14** (**102/102** focused Rust tests); `verify-idle-suspend-boundary.sh` **14/14** checks; `dam-hopper status --json` reports API and helper under `server`.
- Boundary checks 13 and 14 assert API `PIDFile`/`ExecStartPost`/`ExecStopPost` hooks and helper release-manager registration, staging, activation, and status inspection. Automated tests use temporary files/fakes and do not invoke host suspend or real RTC hardware.

# 2026-09-09

- **Production CLI Deployment Setup for Idle Suspend Helper & Socket — Phase 01 complete.** Systemd API/helper units now create and remove `/run/dam-hopper/server.pid`, share a group-writable runtime directory, and expose the helper socket to the authorized API service group.
- Validation passed: systemd unit verification, release/unit-policy tests, idle-suspend tests, and boundary checks **102/102**; cycle-2 review approved **10/10**. Release-manager staging, lifecycle, and end-to-end phases remain pending.

# 2026-09-07

- **Plan item notes and editing.** Restored selected Plan item note rendering with multiline bodies, semantic timestamps, and per-note deletion. Added inline title/summary editing across desktop Deck and compact Sheet, reusing existing workflow PATCH/delete-note mutations with fresh request IDs and exact CAS timestamps.
- Validation: focused workflow Vitest suites **27/27 passed** across action hooks, selected-item UI, responsive Surface, Deck, and Sheet. Changed-file TypeScript checks passed; coverage provider unavailable and an unrelated `use-clipboard.ts` type error remains. Code review 8.5/10, no critical issues; asynchronous edit rejection retention remains a non-blocking follow-up. [Plan](../plans/260907-0013-plan-item-notes-and-edit/plan.md) · [QA report](../plans/reports/qa-260907-0029-plan-item-notes-and-edit.md) · [Review report](../plans/reports/code-review-260907-0031-restore-plan-item-notes-and-edit.md).

- **Cross-Origin Port Transport Guard Fix.**
  Aligned privileged mutation CSRF guards on idle-suspend (`force-suspend`, `timing`) and host actions (`intents`, `approve`, `executions`) with validated Bearer authentication and the server's exact CORS origin allowlist (`AppState::origin_is_allowed`).
  Resolved `403 invalidOrigin` failure on split-port architectures (e.g. UAT web `:4804` / API `:4803`; production `:4802` / `:4801`) where browsers send `credentials: "include"`.
  Applied zero-allocation iterator checks to header cardinality validation; strict foreign, duplicate-Origin, and userinfo rejection preserved.

# 2026-09-06

- **Authenticated Manual Force Sleep — Phase 01 protocol/helper complete.**
  Extended the version-1 enrolled helper execution domain to accept
  `wakeAfterSeconds: 0` as an indefinite-sleep sentinel while keeping persisted
  automatic timing at `60..=86400`.
- Zero converts to clear-only RTC behavior: write and verify `0`, with no
  target-epoch arithmetic or write. Timed values clear and verify, calculate a
  checked target, write it, and verify the readback.
- Added fail-closed RTC ownership preflight (`RtcAlarmBusy`), explicit
  zero-valued helper intent/completion audit records, and no-suspend behavior
  for RTC, audit, capability, inhibitor, or preflight failures.
- Added protocol, backend, preflight, helper IPC, audit, and automatic timing
  regression coverage using temporary files and fake backends only; tests never
  invoke host suspend, logind, or real RTC hardware.

- **Authenticated Manual Force Sleep — Phase 02 coordinator/fleet complete.**
  Added generation-fenced forced fleet admission that bypasses only active-fleet
  quiescence, preserves audit/capability/inhibitor/RTC/peer gates, serializes
  manual work with automatic timing, and releases the handoff on every outcome.
- **Authenticated Manual Force Sleep — Phase 03 REST API complete (2026-09-06 12:00:21 +07:00).**
  Added the protected `POST /api/system/idle-suspend/v1/force-suspend` endpoint
  with strict DTOs and wake bounds, cookie same-origin and enabled-actor
  enforcement, a 16 KiB body cap, coordinator-only dispatch, audited `202`
  admission, typed fleet/handoff conflicts, sanitized closed errors, and
  `Cache-Control: no-store` responses.
- **Authenticated Manual Force Sleep — Phase 04 host popover UI and confirmation dialog complete (2026-09-06 12:20:00 +07:00).**
  Added the destructive "Force Machine to Sleep" action within
  HostIdleSuspendStatus and HostResourcePopover with clean modal handoff to
  Radix ForceSleepDialog, indefinite default (`wakeAfterSeconds: 0`), optional
  bounded RTC wake duration input, active managed session warning and
  confirmation checkbox, authoritative 409 conflict refresh, disabled
  controls during pending mutation, live regions, and 44px touch targets.
- **Authenticated Manual Force Sleep — Phase 05 integration, qualification, and documentation complete (2026-09-06 15:45:00 +07:00).**
  Closed the requirements-to-evidence matrix, protocol/coordinator/REST/UI integration gates, non-privileged boundary verifier, rollback review, and synchronized architecture, API, configuration, security, operations, product, and codebase documentation.
- Validation passed: 81/81 Rust idle-suspend tests, 3/3 UI Vitest tests, 10/10 Chromium browser tests, 12/12 boundary checks, and `cargo check`. Automated evidence uses fakes and temporary files only; the indefinite real-host canary remains explicitly deferred pending Operations approval and verified physical/out-of-band recovery.

# 2026-09-02

- **Phase 01: Workflow tracking domain and relational persistence.** Added the
  additive `010_workflow_tracking.sql` migration for workspace identities,
  Plan/Phase/Task items, manual sessions, terminal/agent resource links,
  durable notes, and append-only activity events. Existing terminal-session
  tables remain unchanged and all workflow tables share the configured
  `sessions.db`.
- Added serializable workflow models and closed enums for item kind/status,
  session lifecycle, resource observations, provenance, and event types.
  Validation enforces bounded titles/bodies/identifiers/payloads, timestamps,
  transitions, and the Plan-first hierarchy (Plan root → Phase → Task, with
  standalone or Plan-level tasks).
- Added `WorkflowStore` repositories for workspace/item/session/resource/note/
  event CRUD, bounded overview aggregation, keyset history, and retention.
  Mutations use SQLite transactions; optional audit events commit atomically,
  event IDs are retry-idempotent, and resource observations never rewrite
  session lifecycle state.
- `server/src/workflow/tests.rs` covers model rules, migration preservation,
  hierarchy/scope checks, idempotency, overlapping sessions, note retention,
  overview progress, pagination, and purge. Workflow HTTP/WebSocket routes
  remain outside this phase. [See phase plan](../plans/260901-0919-workflow-tracking-notes/phase-01-domain-and-relational-persistence.md).
- **Phase 02: Workflow service and REST API.** Added the profile/workspace-
  scoped `WorkflowService` and protected `/api/workflow/*` routes for bounded
  overview/history, Plan-first item CRUD, manual session lifecycle,
  terminal/agent links, durable notes, and explicit history purge.
- REST mutations use strict camelCase DTOs, UUID request replay keys,
  optimistic `updatedAt` CAS for item/note/link updates, typed sanitized
  workflow errors, and a focused 32 KiB body limit. Events use opaque keyset
  cursors; automatic retention purges in bounded batches.
- Added API integration coverage in `server/tests/workflow_api.rs` for auth,
  hierarchy, overview, replay/CAS, sessions, links, notes, pagination, limits,
  invalid transitions, and purge. [See workflow API reference](./workflow-api.md).
- **Phase 03: Terminal lifecycle correlation and agent adapter.** Added the
  closed `WorkflowObservation` contract and clone-cheap PTY recorder. A bounded
  `sync_channel(256)` worker keeps workflow SQLite off PTY input/output/restart
  hot paths; queue-full and storage failures are counted/logged without
  blocking terminal operation.
- Lifecycle payloads are strictly allowlisted (terminal ID, incarnation,
  configured project, validated worktree target, server time, exit/restart
  metadata, and action). Command lines, arguments, CWD, environment, prompts,
  output, and arbitrary adapter payloads are excluded.
- Terminal links transition through `attached`, `stale`, `exited`, `crashed`,
  and `detached` with incarnation ordering and deterministic replay
  suppression. Final exit/removal may suggest an end time but never changes
  manual session status or `startedAt`/`endedAt`.
- Startup restores PTYs before reconciling persisted terminal links against
  live `(sessionId, incarnation)` identities. Agent links remain bounded manual
  `harnessLabel`/`runId` metadata; no automatic harness producer or generic
  observation endpoint was added. Direct Plan sessions do not synthesize
  Phase/Task children.
- Phase 03 review reports 28 workflow tests and 907 full-server tests passing;
  review approved 9.8/10. [Code review](../plans/reports/code-reviewer-260902-0420-phase-03-terminal-lifecycle-correlation.md).
- **Phase 04: Client types, transport, and query state.** Added strict shared-UI workflow DTOs and domain helpers, all 13 protected REST operation mappings, profile/transport-generation-isolated React Query hooks, mutation invalidation and request-ID replay handling, and manual timestamp/resource-observation helpers. Existing terminal navigation and localStorage state remain unchanged.
- Validation: Targeted Phase 04 UI tests 51/51, full UI suite 1,452/1,452, and Rust server 907/907 executed tests passed (2 ignored); code review approved 10/10. Formal source coverage was not generated because the UI coverage provider is unavailable, and the existing React `act(...)` warning is non-blocking. [Test report](../plans/reports/tester-260902-1139-phase-04-client-types-transport-query-state.md) · [Review report](../plans/reports/code-reviewer-260902-1144-phase-04-client-types-transport-query-state.md) · [Phase plan](../plans/260901-0919-workflow-tracking-notes/phase-04-client-types-transport-and-query-state.md).
- **Phase 05: Responsive workflow context surface.** Added the Plan-first ambient context ribbon, responsive desktop deck, mobile segmented safe-area sheet, optional Phase/Task capture, direct notes/sessions/execution links, manual timestamp/**Now** controls, observed terminal suggestions, focus-safe shortcut ownership, and loading/error/empty states.
- Validation: targeted Phase 05 UI tests passed 62/62 (100%), full UI suite passed 1,493/1,493 (100%), and Rust server executed tests passed 907/907 (2 ignored). Review approved 9.8/10. Responsive browser geometry, safe-area, and terminal/editor continuity remain Phase 07 validation work. [Test report](../plans/reports/tester-260902-1243-phase-05-responsive-workflow-context-surface.md) · [Review report](../plans/reports/code-reviewer-260902-1245-phase-05-responsive-workflow-context-surface.md) · [Phase plan](../plans/260901-0919-workflow-tracking-notes/phase-05-responsive-workflow-context-surface.md).
- **Phase 06: WorkspacePage and shell integration.** Complete / DONE
  2026-09-02. Mounted one `WorkflowContextSurface` through the existing
  `toolbarActions` companion row in `IdeShell`, `TerminalWorkspaceShell`, and
  `MobileWorkspaceShell`; no route, activity-bar tool, mobile surface, TopNav
  item, or duplicate PTY lifecycle.
- Added pure `packages/ui/src/lib/workflow-workspace-integration.ts` decisions:
  `deriveWorkflowTerminalCandidates` merges mounted/session-map observations
  with target-unavailable state without command, CWD, or output;
  `resolveWorkflowTerminalReveal` rejects missing/profile-mismatched/stale IDs,
  reuses `handleSelectTerminal`, and requests the compact Terminal surface only
  in compact mode; `resolveWorkflowTargetSelection` validates configured
  project/worktree availability before using existing workspace and
  project-target stores.
- Wired `onOpenTerminal` through `WorkflowContextSurface`,
  `WorkflowContextDeck`, `WorkflowContextSheet`, `WorkflowExecutionList`, and
  `WorkflowSessionCard`; wired `onSelectTarget` through the surface,
  deck/sheet, and `WorkflowProjectList`. Keyed the surface by
  `activeProfileId` so profile changes reset workflow presentation state while
  terminal/editor/Browser keep-alive state remains mounted.
- Validation: targeted UI 62/62, full UI 1,515/1,515, relevant Chromium
  smoke 8/8, Rust 907/907 executed (2 ignored), and UI TypeScript compilation
  passed; review approved 9.8/10. [Test report](../plans/reports/tester-260902-1430-phase-06-workspace-page-and-shell-integration.md) · [Review report](../plans/reports/code-reviewer-260902-1440-phase-06-workspace-page-and-shell-integration.md) · [Phase plan](../plans/260901-0919-workflow-tracking-notes/phase-06-workspace-page-and-shell-integration.md).
- **Phase 07: Verification, rollout, observability, and docs.** Completed the additive migration/restart/rollback rehearsal, privacy-safe workflow diagnostics, old-server compatibility, responsive accessibility contracts, real-terminal continuity, and documentation gates. Migration 010 remains additive; rollback retains workflow tables/data, and older binaries ignore them.
- Added fixed-cardinality workflow diagnostics in `DiagnosticStore`: `workflow_operation_duration_seconds` (duration capped at 60 seconds), `workflow_queue_dropped_total` (non-blocking 256-entry observation queue drops), `workflow_reconciliation_total` (attached/detached counts capped at 1,000), and `workflow_storage_errors_total` (bounded store-failure outcomes). Operation/result dimensions are enums; duration, row, event, and count fields are bounded. No IDs, projects, paths, notes, external runs, commands, CWD, environment, prompts, or output are recorded.
- Older servers that return HTTP 404 for `GET /api/workflow/overview` now produce a profile-scoped feature-unavailable state, suppress query retries, close/hide workflow controls, and announce the unavailable state. Authentication and 5xx failures remain explicit errors with retry behavior; other workflow 404s retain their API semantics.
- Keyboard/focus contracts preserve editor and xterm ownership, return focus to the workflow trigger on Escape, expose named regions and status text, enforce 44px touch targets, bound the desktop deck and mobile 35/90dvh sheet, honor safe-area and reduced-motion behavior, and prevent horizontal overflow.
- Validation: focused Rust gates **134/134 passed**, focused UI Vitest **122/122 passed** across 13 files, and real-server Chromium browser **4/4 passed** against the actual no-auth backend, covering workflow state/actions, responsive keyboard/focus behavior, unavailable fallback, and terminal continuity. [Phase 07 plan](../plans/260901-0919-workflow-tracking-notes/phase-07-verification-rollout-observability-and-docs.md).
- **Workflow note and summary multiline Textarea improvement.** Added the shared `Textarea` atom primitive (`packages/ui/src/components/ui/Textarea.tsx`) matching the `glass-input` design tokens and focus ring styling. Updated `WorkflowSelectedItemBar` to use `Textarea` for note drafting with multiline input, autoFocus, explicit `aria-label="Note content"`, Ctrl+Enter / Meta+Enter submission, and Escape cancellation. Updated `WorkflowQuickCapture` summary region to use `Textarea` for multiline item summary descriptions.

# 2026-08-31

- **Preserve Explorer Tree Expansion & Editor View Scroll Position (Phases 01–03).**
  - **Explorer Tree Expansion Store (Phase 01):** Added persistent Zustand store `useExplorerTreeStore` to preserve directory open/closed states across sidebar tool switching, shell layout changes (IDE vs. Terminal workspace modes), sidebar collapsing/reopening, and browser page reloads. Scoped per project and worktree target (`dam-hopper:explorer-tree-state`). Includes cascading auto-hydration on remount and pruning/renaming synchronization. [See plan](../plans/260831-1802-preserve-explorer-tree-and-editor-scroll/phase-01-explorer-tree-expansion-store.md).
  - **Editor ViewState Persistence (Phase 02):** Added Monaco editor `viewState` (cursor position, column, scroll offsets, and code folds) persistence across tab switches, unmounts, and browser page reloads under `dam-hopper:editor-state`. Implemented race-safe view state capture via `prevTabKeyRef` and originating `targetKey` attribution. [See plan](../plans/260831-1802-preserve-explorer-tree-and-editor-scroll/phase-02-editor-viewstate-persistence.md).
  - **Integration & Verification (Phase 03):** Verified end-to-end tree expansion preservation across all three shell surfaces (main IDE sidebar, compact mobile surface, and floating terminal files panel) and editor scroll/cursor retention across tab switches and page reloads. Full test suite passing (213 files / 1,422 unit tests, UI build, browser tests, and zero ESLint errors). [See plan](../plans/260831-1802-preserve-explorer-tree-and-editor-scroll/phase-03-integration-and-verification.md).
- **Runtime terminal custom-name persistence.** Added nullable runtime `name` independent of configured profile names, SQLite migration 009, and persistence-first acknowledgements for rename, removal, and reusable `dispose`; replacement/restore cleanup is race-safe.
- Create and authenticated `PATCH` rename trim/validate names (≤64 Unicode scalars, no control characters) and blank/`null` clear overrides. Names flow through respawn/restore, API/WebSocket, and frontend terminal labels; rename UX is durable and cleared names return to existing fallback labels.
- Validation: backend full `cargo test` **874 tests, 2 ignored**; UI full **212 files / 1,411 tests**; production build and focused browser smoke passed. Broad browser remains **183/187**, with four failures in unchanged baseline areas: `app-zoom` (320×180 expected, 352×198 received), `ssh-forward-multi-connection` (switches expected disabled, enabled), and `terminal-panel-replay-notifications` (activity expected inactive, active). No restart-persistence manual claim: graceful stop removes sessions by design.
- **Traditional-mode Global Search focus retention.** Callback-only pane
  rerenders no longer move focus from Global Search to xterm while typing;
  semantic pane/session focus and native-input suppression remain intact.
- **Traditional active-pane floating scroll controls.** Enabled
  `TerminalScrollButtons` now render only for the active Traditional pane above
  `MobileTerminalAccessoryBar` with the Runtime-compatible accessory-rail
  contract; inactive panes and Browser remain excluded. Runtime source and
  behavior remain unchanged.
- Focused validation passed: UI TypeScript build, focused unit tests (2 files/5
  tests), focused Chromium tests (2 files/8 tests), and actual-app smoke
  confirming three-character search focus retention, scroll trigger/group
  placement above keyboard controls, no xterm focus on scroll activation, and
  Runtime contrast. Final code review found no issues; no broad repository-suite
  or production/cross-platform release validation is claimed. [See plan](../plans/260831-0629-traditional-terminal-search-scroll-fix/plan.md).
- **Traditional terminal close selection fix.** Closing a Traditional terminal now
  keeps the selected terminal within the same project instead of selecting one
  from another project; Runtime behavior is preserved. Focused validation passed:
  23 unit tests, 9 Traditional Chromium tests, and the UI TypeScript build.
  Production-like callback integration coverage remains a follow-up.

# 2026-08-30

- **Browser Debug/native support documentation refresh.** Recorded the Windows
  WebView2 v1 gate, Linux runtime-unverified status, macOS deferral, Android
  iframe fallback, profile-scoped storage, generation/nonce/request validation,
  raw bounds plus mirrored app zoom, relay capabilities, and popup/download/
  permission/console boundaries. See [Native Browser Debug Support](./native-browser-debug-support.md).

# 2026-08-15

- **Native SSH port-forwarding Windows gate (Phase 07; complete for Windows-only scope).** Added Windows CI and release pre-bundle checks for Rust formatting/lint/unit coverage, the real temporary OpenSSH remote-loopback forwarding gate, deterministic smoke/evidence validation, WebView2/OpenSSH preflight, no-bundle Tauri compilation, protected same-commit evidence binding, and the unsigned NSIS package profile. Protected packaged-runtime evidence remains a production-release prerequisite; cross-platform support and signed updater artifacts are deferred to a separate scope. [See phase gate](../plans/260808-1310-ssh-port-forwarding-control/phase-07-cross-platform-release-gates.md).

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

- **Native embedded browser controller (Phase 03).** Added the Tauri desktop child-WebView controller, build-time bridge injection, loopback/HTTPS tunnel navigation policy, bounded native relay validation, profile-isolated browser storage, lifecycle/geometry commands, and fail-closed popup, download, redirect, external-scheme, and permission handling. Windows WebView2 is the verified implementation target; Linux now has a WebKitGTK relay implementation but remains runtime-unverified, and macOS is deferred. See [Native Browser Debug Support](./native-browser-debug-support.md).

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

- **Explorer: Copy Path context menu.** Complete ✓ 2026-07-14. Added "Copy Absolute Path" and "Copy Relative Path" items to the Explorer (file-tree) right-click menu for both files and folders. Absolute path joins the server-resolved absolute project root (`useProject(name).data.path`) with the node's project-relative path using the native separator (backslash on Windows, forward slash elsewhere); relative path is always forward-slash POSIX. Path computation and the menu item list are extracted into pure `buildTreeCopyPaths` / `getTreeContextMenuItems` helpers for SSR unit testing, mirroring the `getEditorTabContextMenuItems` pattern. The absolute item disables when the project root is unknown; a transient "Copied to clipboard" toast reuses the existing `useCopyToClipboard` hook. Frontend-only; no backend/API changes. Validation: `pnpm --filter @dam-hopper/ui build`, `pnpm --filter @dam-hopper/ui test` (422 passing), changed files lint-clean. Historical plan source unavailable.

## 2026-07-08

- **Bottom Panel Maximize Toggle.** Complete ✓ 2026-07-08. Added an IntelliJ-style maximize/restore toggle to the IDE bottom tool panel header. Maximizing hides the top area (explorer/editor/right panels) and expands the bottom panel to fill the workspace body; activity bars stay visible so tools remain switchable. State is session-only (not persisted), closing the maximized bottom tool resets it, and the terminal keep-alive element stays in the same React tree position so no PTY is remounted or duplicated on toggle. Layout decisions were extracted into a pure `resolveBottomPanelLayout` helper for SSR unit testing (toggle/restore/reset-on-close), plus an `IdeShell` SSR contract test for button presence/absence. ESLint config now ignores Rust/Tauri `target/` build artifacts that previously produced ~200 false parsing errors. Historical plan source unavailable.

- **Bottom panel maximize: auto-restore on top tool selection.** Enhanced the maximize toggle so clicking maximize also unselects any active top tools on both sides (the activity bar no longer highlights them while the bottom panel covers the top area). Selecting a top tool from the activity bar again — or triggering a reveal-active-file request — automatically restores the normal (non-maximized) layout. Maximize/top-tool state transitions are extracted into pure `resolveMaximizeToggle` / `resolveTopToolToggle` helpers for SSR unit testing.

## 2026-05-31

- **Phase 04: Diagnostic Log Capture.** Complete ✓ 2026-07-07. Added Settings > Maintenance `Export Diagnostics` in the UI and a protected `POST /api/diagnostics/export` flow that sends the canonical `frontend` snapshot payload plus default 60-minute and terminal-tail settings. Downloads use `dam-hopper-diagnostics-{timestamp}.json`. Exported terminal tails are included by default and should be reviewed before sharing because they can still contain sensitive local/dev output.

- **Phase 03: PTY And WebSocket Instrumentation.** Complete ✓ 2026-07-07. Added backend terminal diagnostics events for PTY create/spawn failure/EOF/read error/exit/kill/remove/restart decisions, WS terminal control tracing, frontend transport lifecycle tracing, TerminalPanel attach/create/replay diagnostics, renderer-mode instrumentation, and capped terminal-tail export. Export scopes `terminals.sessions` and `terminals.tails` to requested terminal ids and keeps input data redacted as byte counts only.

- **Shared terminal rendering and resize smoothing.** Added WebGL2-backed xterm rendering across browser, desktop Tauri, and Android WebView hosts with quiet DOM-renderer fallback when unsupported, initialization fails, or the WebGL context is lost. Centralized animation-frame terminal fitting and host attachment to coalesce live-resize work while preserving split-pane docking, tab keep-alive behavior, and mobile native-keyboard focus suppression.

- **Terminal mode switching buffer readability fix.** Kept xterm instances mounted across Traditional ↔ Runtime terminal view switches so historical output is not replayed and rewrapped at a different width during Runtime navigator resizing.

## 2026-05-25

- **Phase 04: Responsive Companion Layout.** Complete ✓ 2026-05-25. Added the compact responsive workspace shell with shared media-query helpers, safe-area/dynamic-height CSS primitives, mobile/tablet surface switching, and terminal refit handling for hidden-panel transitions. Reused the existing editor, terminal, fleet, ports, Git, and project surfaces without duplicating business logic. Hardened `MobileWorkspaceShell` for empty-surface fallback, improved TopNav selector layering and compact/tablet behavior, and aligned compact navigation behavior with zoomed and iPad-sized layouts. Validation passed for `pnpm --filter @dam-hopper/ui test`, `pnpm --filter @dam-hopper/ui build`, `pnpm build`, and `pnpm dev` startup verification. Historical plan source unavailable.

- **Phase 03: Tauri Native Shell.** Implemented 2026-05-25. Added `@dam-hopper/native` as a thin Tauri v2 host that mounts the shared `@dam-hopper/ui` app, configures the shared logger and TanStack Query, uses an idle transport until a server profile exists, and keeps the native shell remote-client-only with `core:default` permission. Added native Vite config on port 1420 with HMR port 1421, minimal `src-tauri` Rust entrypoint/config/capability, restrictive CSP, root native scripts, native build coverage in `pnpm check`, CORS documentation for Tauri origins, and a committed native Cargo lockfile. Validation passed for native TypeScript and Vite build; full desktop Tauri runtime validation is blocked locally by missing Linux prerequisites (`webkit2gtk-4.1`, `rsvg2`, `dbus-1.pc` / `libdbus-1-dev`, `pkg-config`). Historical plan source unavailable.

- **Phase 02: Shared Logger And Runtime Utilities.** Complete ✓ 2026-05-25. Added the dependency-free `@dam-hopper/shared` logger API (`configureLogger`, `getLoggerConfig`, `resolveLogLevel`, and `logger.debug/info/warn/error`) with recursive sensitive-metadata redaction before the sink, wired web bootstrap log level selection to Vite env with dev-debug / prod-warn fallback, and replaced direct `console` usage in high-value transport/auth/terminal/dashboard/error-boundary/fs paths. `packages/ui` keeps `cn` as-is. Verification passed for shared tests/build, ui tests/build, and web build.

## 2026-05-23

- **Phase 01: Root-Aware Git Push and SSH Retry Flow.** Complete ✓ 2026-05-23. Rebuilt push on top of libgit2 so `POST /api/git/push` keeps the root-aware UI/API contract while the backend now uses `Remote::push(...)` with the same credential callback order as fetch/pull: loaded key, SSH agent, credential helper, then default credentials. `ProjectInfoPanel`, `WorkspaceGitPanel`, and `GitPage` all preserve the selected VCS root in the push payload, the shared SSH retry hook still normalizes single-result versus array Git responses before auth detection, and successful pushes still invalidate the broader Git cache set. Focused Rust coverage now includes successful local bare-remote push, missing-upstream failure, nested-root isolation, and callback-level remote rejection reporting. Historical plan source unavailable.

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

- **Phase 01: Workspace Split.** Complete ✓ 2026-05-24. Split the web frontend into a thin `apps/web` Vite host plus a shared `packages/ui` React package, preserving current browser behavior while moving shared components, hooks, styles, tests, assets, and transport-facing UI code behind explicit UI package exports. No native behavior was added yet in this phase. Historical plan source unavailable.

- Root-aware force-push support on the actual push flow. `POST /api/git/push` now accepts `force: true`, and the Push entrypoints in `ProjectInfoPanel`, `WorkspaceGitPanel`, and `GitPage` expose a confirmed `Force Push` action that reuses the same libgit2 credential callback path as normal push. This stays separate from the guarded history-rewrite endpoints: pushed/shared-history drop and undo flows still recommend revert instead of silently overriding safety checks.
- Shared Git push feedback in the web UI. The SSH retry status banner now also confirms successful push completion, so regular push, force push, and passphrase-retry push all report a visible result after the request finishes.

- **Phase 02: Terminal Workspace Shortcut Routing.** Complete ✓ 2026-05-19. Added configurable terminal workspace switching: `UiConfig` now carries `terminalWorkspaceShortcut` with default `Mod+Shift+Backquote`, the settings UI exposes a Terminal workspace row, `WorkspacePage` toggles IDE/Terminal mode from the configured shortcut, and `TerminalPanel` plus `PaneContainer` suppress that shortcut from xterm input so the binding stays global. [See plan](../plans/260519-2159-terminal-workspace-docking/phase-02-configurable-mode-shortcut.md).

- **Phase 01: Workspace Mode Shell.** Complete ✓ 2026-05-19. Added persisted workspace mode for the main shell: `WorkspacePage` now owns `ide`/`terminal` mode state in `localStorage` key `dam-hopper:workspace-mode`, `IdeShell` accepts optional mode props and forwards them to `TopNav`, and `TopNav` shows a compact IDE/Terminal toggle only when those props are present. IDE mode behavior stays unchanged when mode props are omitted. [See plan](../plans/260519-2159-terminal-workspace-docking/phase-01-workspace-mode-shell.md).

- **Phase 04: IntelliJ Real Git Semantics Verification and Docs.** Complete ✓ 2026-05-19. Expanded verification coverage for the real Git semantics refactor: backend tests now cover active-operation rewrite blocking and recovery metadata, frontend tests cover targeted Git invalidation, selected-history refresh, pushed rewrite availability, and recovery banner copy, and the API/architecture docs now define the safe-vs-rewrite history contract plus manual browser verification checklist. [See plan](../plans/260519-0059-intellij-real-git-semantics/phase-04-verification-and-docs.md).

- **Phase 03: IntelliJ-Compatible Actions.** Complete ✓ 2026-05-19. Added the remaining IntelliJ-style Git action split so safe history preservation and rewrite actions are separate: revert commit for pushed/shared history, revert selected changes as a non-history-rewriting path, undo last commit to move changes back into the worktree, explicit confirmation copy for destructive actions, and backend/web API surface updates for the new action routing. [See plan](../plans/260519-0059-intellij-real-git-semantics/phase-03-intellij-compatible-actions.md).

- **Phase 02: IntelliJ-Style Git Workspace Semantics.** Complete ✓ 2026-05-19. Updated the web Git workspace to use a shared commit-action status model and tighter workspace refresh behavior: `GitHistoryActions` now maps Git mutation results into explicit `success`/`blocked`/`conflict`/`dirty`/`error` states, local commit drops are blocked for pushed commits with a shared revert recommendation, `WorkspaceGitPanel` refreshes branches, project status, history, and selected commit files in one flow, `GitPage` reuses the same history-action hook for the standalone Git view, and editor tab reconciliation was aligned with Git-side file updates through the shared query helpers. [See plan](../plans/260519-0059-intellij-real-git-semantics/plan.md).

- **Phase 01: Backend Real Git Semantics.** Complete ✓ 2026-05-19. Refactored Git history mutations around real `git` porcelain contracts: (1) new repo-state helpers detect clean worktree, current branch, reachability, pushed commits, and active merge/rebase/cherry-pick operations; (2) `GitActionResult` now carries `recovery`, `blockedReason`, and `recommendation`; (3) full commit drop uses reset for local `HEAD` and `rebase --onto` for non-HEAD local commits; (4) pushed/shared history drop is blocked by default with revert recommendation; (5) whole-commit and selected-file revert primitives are exposed through REST and the web API client; (6) regression tests cover HEAD drop, non-HEAD drop with descendants, root/pushed blocking, active rebase blocking, selected-file drop, recoverable conflicts, and revert paths. [See plan](../plans/260519-0059-intellij-real-git-semantics/phase-01-backend-real-git-semantics.md).

- **Phase 02: PTY Env Leakage Verification And Documentation.** Complete ✓ 2026-05-16. Added regression coverage proving PTY children do not inherit non-allowlisted parent env, safe baseline vars remain available for shell execution, project terminal sessions load project environment-file values, request `env` overrides win deterministically, and malformed project environment files fail terminal creation with a clear error. Updated `docs/configuration-guide.md` to document terminal env precedence. Historical plan source unavailable.

- **Phase 01: Backend PTY Env Isolation.** Complete ✓ 2026-05-16. PTY child sessions now start from a safe baseline instead of inheriting the DamHopper server process env, and project terminal sessions load `env_file` values before request overrides. Validation passed with targeted PTY and terminal tests plus full `cargo test`. Historical plan source unavailable.

- **Phase 03: Git Management Verification And Documentation.** Complete ✓ 2026-05-16. Documented the completed Git management public surface in `docs/api-reference.md` and `docs/frontend-components.md`: branch listing/create/checkout/update, cherry-pick, reset modes, commit amend, shared action result flags, Explorer branch controls, dirty checkout choices, and history actions. [See plan](../plans/260516-0155-git-management-completion/phase-03-verification-and-documentation.md).

- **Phase 02: Frontend Git Management.** Complete ✓ 2026-05-16. Added the Git workspace UI in `packages/web/src/components/pages/GitPage.tsx` and related organism components for branch control, history browsing, and working tree review: `WorkspaceGitPanel`, `GitBranchControl`, `GitBranchControlDialogs`, `GitHistoryActions`, `GitLogTree`, `GitLocalChanges`, and `ChangedFilesList`. The updated flows wire the frontend to branch/history APIs through the shared API client and keep Git-aware file rows aligned with the shared file decoration registry. [See plan](../plans/260516-0155-git-management-completion/phase-02-frontend-branch-and-history-ui.md).

- **Phase 01: Backend Git Operations.** Complete ✓ 2026-05-16. Expanded git API coverage for branch and history actions: (1) `POST /api/git/:project/branches` creates a branch with optional checkout; (2) `POST /api/git/:project/branches/checkout` supports `normal`, `stash`, and `force`; (3) `POST /api/git/:project/branches/update` updates a branch from its tracking branch; (4) `POST /api/git/:project/cherry-pick` applies a commit; (5) `POST /api/git/:project/reset` supports `soft`, `mixed`, `hard`, and `keep`; (6) `POST /api/git/:project/commit` now accepts `amend`; (7) branch names and commit hashes are validated before execution; (8) destructive modes return structured result flags for dirty/conflict cases. [See plan](../plans/260516-0155-git-management-completion/phase-01-backend-git-operations.md).

- **Phase 01: Port Session Control Data Flow.** Complete ✓ 2026-05-15. Frontend ports state now preserves detected owner sessions and exposes a kill-session mutation: (1) `PortEntry.sessionId` keeps `DetectedPort.session_id` for detected rows; (2) tunnel-only rows keep `sessionId: null`; (3) `usePorts()` exposes `killPortSession(sessionId)` and revalidates `ports` plus terminal session queries after `terminal:kill`; (4) no direct PID/process killing added. [See plan](../plans/260515-2045-control-running-ports/phase-01-port-session-control-data-flow.md).

- **Phase 01: Shared File Decoration Registry.** Complete ✓ 2026-05-15. Centralized frontend file metadata lookup in `packages/web/src/lib/file-decoration.ts`: (1) one registry now drives icon, badge, display-language, and Monaco-language selection; (2) exact filename matches cover dotfiles and toolchain files like `.env`, `.gitignore`, `Dockerfile`, `Makefile`, and lockfiles; (3) extension lookup covers code, docs, data, images, archives, fonts, and common config files; (4) MIME fallback handles generic or missing file types; (5) `file-decoration-icon.tsx` is a thin render wrapper; (6) `mime-to-language.ts` stays as a compatibility wrapper for MIME-only callers; (7) unit tests cover exact-name priority, extension fallback, MIME fallback, and neutral defaults. [See plan](../plans/260514-2330-file-extension-decorations/phase-01-shared-file-decoration-registry.md).

- **Phase 02: Shared File Decoration Integration.** Complete ✓ 2026-05-15. Rolled the shared decorator out to the visible IDE surfaces: (1) `FileTree` now renders file-specific icons through the shared registry; (2) `EditorTab` uses the active file path/name for its decoration instead of a generic file glyph; (3) `SearchPanel` file headers show the same decoration as the explorer and tabs; (4) file rows in git/change views can reuse the same lookup without changing VCS badges; (5) `FilePathLabel` continues to read from the shared helper so path labels stay consistent everywhere. [See plan](../plans/260514-2330-file-extension-decorations/phase-02-integrate-file-decorations.md).

- **IDE Tool Windows Refactoring.** Complete ✓ 2026-04-25. Refactored `IdeShell.tsx` to support a flexible, extensible Tool Window system with an Activity Bar, similar to IntelliJ IDEA: (1) New `ActivityBar` component for switching between tool windows (Files, Terminals, etc.); (2) Extensible `ToolWindowDef` interface for defining tool name, icon, and component; (3) `ToolPanel` container with header, actions, and auto-focusing behavior; (4) Persisted layout state in `IdeShell` (active tool ID, sidebar width); (5) Refactored `IdeShell` to use a cleaner tool window state management pattern; (6) Migrated `FileTree` to the new system as the default 'files' tool; (7) Seamless integration with existing `react-resizable-panels` layout; (8) Full TypeScript coverage and logic verification. Historical plan source unavailable.

- **Phase 01: OPAQUE PAKE Server Integration (Stealth Encrypted Upload).** Complete ✓ 2026-04-27.
  Server-side OPAQUE password-authenticated key exchange for the encrypt-in-transit file upload feature: (1) New `server/src/crypto/` module — `DamHopperOpaqueSuite` implementing `CipherSuite` (Ristretto255 + TripleDH + Identity KSF, matching `@serenity-kit/opaque` client defaults); (2) `load_or_create_server_setup()` generates or loads the server long-term keypair at `~/.config/dam-hopper/opaque-server-setup` with 0o600 permissions; (3) Registration handlers: `handle_register_start()` / `handle_register_finish()` — stateless two-message flow, returning `RegistrationResponse` and `ServerRegistration`; (4) Login handlers: `handle_login_start()` / `handle_login_finish()` — two-message flow, returning intermediate `ServerLogin` state and final AES key derived via HKDF-SHA256 with label `"dam-hopper-aes-256-gcm-v1"`; (5) `export_key` wrapped in `Zeroizing<Vec<u8>>`, zeroed on drop; (6) New `AppState` fields: `opaque_server_setup: Arc<ServerSetup<DamHopperOpaqueSuite>>` (shared) and `opaque_registrations: OpaqueRegistrations` (in-memory HashMap, ephemeral by design — no disk persistence); (7) 8 new `ClientMsg` WS variants (`auth:register_start/finish`, `auth:login_start/finish`, `fs:put_begin/chunk/commit/save`) and 8 new `ServerMsg` response variants with neutral `auth:*` / `fs:put_*` kind names to avoid IDS/DLP fingerprinting; (8) Full WS dispatch in `ws.rs` with all OPAQUE ops in `spawn_blocking`; per-connection caps: 16 in-flight login states, 16 active session keys; `overwrite: bool` on `auth:register_finish` prevents silent credential overwrite; (9) Phase 04 `fs:put_*` handlers stubbed (return not-implemented error); (10) Identifier validation: alphanumeric + hyphens + underscores, max 128 chars. New Cargo dependencies: `opaque-ke = "4"`, `hkdf = "0.12"`, `rand`, `aes-gcm = "0.10"`, `sha2 = "0.10"`, `zeroize = "1"`. Historical plan source unavailable.

- **Phases 02-04: Combined Ports & Tunnel Panel (F-09 Auto Port Forwarding).** Complete ✓ 2026-04-25. Unified sidebar panel merging port detection and tunnel management into single component: (1) `PortsPanel.tsx` replaces deprecated `TunnelPanel` + `PortsPanel`, deletes former; (2) `usePorts` hook merges `DetectedPort[]` (from `/api/ports` via WS `port:list` channel) with `TunnelInfo[]` (from `/api/tunnels`) by port number into single `PortEntry[]`; (3) Three port row states: A (no tunnel, "Open localhost" button if same-host + "Start tunnel"), B (tunnel starting with spinner), C (tunnel ready with public URL + copy/QR/stop buttons); (4) `isLocalServer()` helper determines if browser and server on same host — gates "Open localhost" button visibility; (5) WS event subscriptions: `port:discovered`, `port:lost`, `tunnel:ready`, `tunnel:failed`, `tunnel:stopped` invalidate queries in real-time; (6) Custom port form allows starting tunnels for specific ports not yet detected; (7) cloudflared installer row preserved (shows missing binary state); (8) Public URL warning banner localStorage-gated, shown once per browser; (9) Sidebar integration: single `{!collapsed && <PortsPanel />}` replaces both former panels; (10) `use-tunnels.ts` kept for Phase 05 evaluation. Zero breaking changes, full backward compatibility with existing port/tunnel infrastructure. [See documentation](./frontend-components.md#combined-ports--tunnel-panel).

- **Phase 02: Drag-to-Split Terminal Layout (F-06 Terminal Splitting).** Complete ✓ 2026-04-24. Interactive terminal pane splitting and tab management via drag-and-drop: (1) New `TabBar` component with draggable tab handles using @dnd-kit/core (PointerSensor 8px activation); (2) `PaneContainer` with `PaneDropZones` (5 zones: top/bottom/left/right edges, center) always mounted for droppable registration; (3) `SplitLayout` wrapped in `DndContext` with `pointerWithin` collision strategy and floating `DragOverlay` showing dragged tab label; (4) Drag-end logic: edge zones trigger `layout.splitPane(paneId, direction)` to create new split pane, center zone triggers `layout.moveTabToPane()` to transfer tab without splitting; (5) Auto-collapse: if last tab leaves source pane, pane node removed from tree; (6) Visual feedback: blue highlight (`bg-blue-500/30 ring-blue-400`) on target zones during drag, zones invisible (pointer-events-none) when not dragging to preserve terminal input; (7) New `moveTabToPane(sessionId, fromPaneId, toPaneId)` hook method for atomic tab transfer; (8) Dependencies: @dnd-kit/core@6.3.1, @dnd-kit/utilities@3.2.2 added to package.json. User-facing: drag tab grip handle to pane edge → creates split; drag to pane center → moves tab (no split); blue highlights appear on targeted zone; floating label shows tab name during drag. Zero breaking changes, fully backward-compatible with existing layout tree. [See Phase 02 documentation](./frontend-components.md#drag-to-split-terminal-layout-phase-02).

- **Phase 03: Port Detection Backend (F-09 Auto Port Forwarding).** In progress. Automatic detection of ports opened by running processes in PTY sessions: (1) `PortForwardManager` in-memory registry (Arc<RwLock<HashMap>>) tracks up to 100 detected ports with states: Provisional, Listening, Closed; (2) PTY stdout scanner: ANSI-strip output, apply 7-pattern regex bank (listening on, localhost:port, http://..., etc.), report first match as provisional; (3) Linux /proc/net/tcp poller (2s interval): confirms provisional → listening, reports lost (close event); (4) Port safety filter: blocks system ports (<1024) and danger list (SSH, SMTP, MySQL, PostgreSQL, Redis, MongoDB); (5) `GET /api/ports` REST endpoint (protected): returns `{ "ports": [...] }`; (6) WS push events: `port:discovered` (stdout or proc confirm) and `port:lost` (close); (7) Lazy regex bank via `once_cell`, Linux-only `procfs` crate for proc polling. Frontend receives port events and can construct proxy URLs. Historical implementation source unavailable; documentation in progress.

- **Phase 06: Startup Restore (F-08 Terminal Session Persistence).** Complete ✓ 2026-04-17. Automatic session restoration on server startup via SQLite persistence: (1) `restore_sessions()` function in new `persistence/restore.rs` module loads session records and respawns PTY processes; (2) Smart filtering: skip `RestartPolicy::Never` sessions (debug log), skip sessions for removed projects (warning log), skip manually killed sessions during kill window; (3) Config-driven restart retry count via `restart_max_retries` from project config with fallback to default; (4) Lazy buffer loading fallback in `PtySessionManager::get_buffer_with_offset()`: try in-memory first (live sessions), fall back to SQLite load (dead sessions); (5) Main.rs integration calls restore after PtySessionManager created, conditional on `session_persistence` config flag; (6) Startup time < 1s with 10 sessions (150ms SQLite load + 50ms PTY spawn); (7) Graceful error handling: per-session failures logged as warnings, database errors non-blocking; (8) Cleanup of expired buffers (TTL-based) triggered automatically; (9) 3/3 tests passing (skip never-restart, skip removed project, restore restartable); (10) Production-ready with comprehensive error scenarios and logging examples. Historical documentation source unavailable.

- **Phase 05: Persist Worker (F-08 Terminal Session Persistence).** Complete ✓ 2026-04-17. Async worker thread that batches buffer writes to SQLite without blocking PTY hot path: (1) Dedicated worker thread spawned in main.rs consumes commands from bounded mpsc channel (256 slots); (2) PersistCmd enum with 5 command types (BufferUpdate, SessionCreated, SessionExited, SessionRemoved, Shutdown); (3) Batching via HashMap: only latest buffer per session written on flush, deduplicating N updates → 1 write; (4) Flush triggers: 5-second timer, session exit (immediate), server shutdown (graceful); (5) Critical optimization: 16KB throttling reduces snapshot frequency from 100/sec → 6/sec, cutting memory churn from 256MB/sec → 16MB/sec (16x improvement); (6) Non-blocking integration: all 4 try_send() calls in manager.rs ensure PTY reader never blocks on DB I/O; (7) Graceful shutdown: explicit drop(persist_tx) signals worker to final flush on exit, zero data loss; (8) Bounded channel prevents memory explosion if worker stalls; (9) 5/5 unit tests passing (batching dedup, session create, immediate exit flush, removal, graceful shutdown); (10) Code review score 8.5/10 production-ready. All critical issues from initial review (blocking send, memory churn) resolved. Trade-off: <16KB sessions skip 5s flush but still persist on exit + WS reconnect works. Historical documentation source unavailable.

- **Phase 01: Buffer Offset Tracking (F-08 Terminal Session Persistence).** Complete ✓ 2026-04-17. Scrollback buffer enhancements for efficient WebSocket reconnect delta replay: (1) Monotonic byte counter `total_written: u64` tracks total bytes ever written, survives buffer eviction; (2) New `current_offset()` method returns checkpoint for client storage; (3) New `read_from(Option<u64>)` method returns (delta bytes, current offset) or fallback to full buffer if offset evicted; (4) O(1) delta calculation with zero-cost implementation; (5) 5 new unit tests + 4 existing tests (9/9 passing) covering fresh buffer, eviction, delta replay, edge cases, and monotonic property. Backward compatible, no breaking changes. Enables Phase 02 WebSocket reconnect to send only new bytes (~90% bandwidth reduction in typical scenarios). Historical documentation source unavailable.

- **Phase 07: Tombstone Idempotency.** Complete ✓ 2026-04-17. Server-side idempotency for terminal creation: (1) `terminal:create` now removes matching dead session tombstone before spawning, eliminating need for client-side alive status filtering; (2) Killed set tracks manually terminated sessions to prevent supervisor from restarting during user kill window; (3) Create inserts ID into `killed` set pre-spawn, removes post-spawn (TOCTOU guard ensures at most one spawn wins during concurrent creates); (4) Lock optimization: lock released before slow I/O (openpty, spawn), reacquired with concurrent create check; (5) Memory leak fix: cleanup task prunes orphaned `killed` set entries every 30s (prevents unbounded growth); (6) New integration test validates create-during-backoff race condition — supervisor respawn correctly cancelled by kill flag. Results: 50-100ms lock contention reduction under load, frontend can safely retry terminal creation without state checks. All tests passing. Historical documentation source unavailable.

- **Phase 06: Terminal Lifecycle UI (Frontend).** Complete ✓ 2026-04-17. Visual indicators for terminal process lifecycle events: (1) Status dots in TerminalTreeView (🟢 alive, 🟡 restarting, 🔴 crashed, ⚪ exited); (2) Restart badge in DashboardPage showing `↻ N` when restartCount > 0; (3) Colored exit banners in TerminalPanel (green for code=0, red for non-zero, yellow for willRestart); (4) Restart banner showing `[Process restarted (#N)]` on process:restarted event; (5) Dim reconnect status banners on WebSocket connect/disconnect. New `session-status.ts` module centralizes lifecycle logic. All components subscribe to Phase 5 WS events. Query invalidation on process restart ensures dashboard auto-refresh. Historical Phase 06 documentation source unavailable; see [Frontend Components guide](./frontend-components.md).

- **Phase 05: Enhanced Exit Events + Channel Decoupling.** Complete ✓ 2026-04-17. Backend WS protocol enhancements: (1) Extended `terminal:exit` with optional `willRestart`, `restartInMs`, `restartCount` fields (backward-compatible); (2) New `process:restarted` event announcing successful restart with restart count and previous exit code; (3) Separate PTY and FS channels (PTY async backpressure, FS graceful overflow) to prevent FS event bursts from crashing PTY connections; (4) New `fs:overflow` event notifies of FS subscription overflow. Frontend: new `onProcessRestarted()` event listener, graceful `fs:overflow` handling. All 8 test matrix rows passing (Phase 04 integration). Resolves Failure Mode 3 (FS pump crushing WS). Historical documentation source unavailable.

- **Phase 04: Auto-Restart Engine.** Complete ✓ 2026-04-16. Process lifecycle management with auto-restart on crash: (1) Configurable restart policy per terminal (never/on-failure/always); (2) Exponential backoff (1s→2s→4s→8s→16s→30s max); (3) Supervisor pattern decouples blocking PTY I/O from async restart logic; (4) Dedicated reader thread handles exit detection and restart decisions; (5) Restart count tracking resets on clean exit (exit_code=0); (6) Session ID reused across restarts so frontend tab stays connected; (7) Extension to config and session metadata (Phase 3). All 8 decision matrix rows validated, 5 integration tests passing. Limitation: exit code always inferred as 0 for natural exits (portable-pty API). Historical documentation source unavailable.

- **Phase 04: SQLite Schema + Config.** Complete ✓ 2026-04-17. Session persistence infrastructure for surviving server restarts: (1) New `persistence/` module with SQLite-backed `SessionStore` providing CRUD operations; (2) Two-table schema: `sessions` (metadata + environment) and `session_buffers` (scrollback output); (3) New `[server]` config section with three fields: `session_persistence` (bool, default false), `session_db_path` (string, default ~/.config/dam-hopper/sessions.db), `session_buffer_ttl_hours` (u64, default 24); (4) Database files created with 0o600 permissions (Unix-only, user-exclusive access); (5) Automatic migrations on startup; (6) PersistedSession struct captures meta, env HashMap (JSON-serialized), terminal dimensions (cols, rows); (7) All enums (RestartPolicy, SessionType) stored as lowercase strings for portability; (8) 6 unit tests passing (open, save_session, save_buffer, load_sessions, load_buffer, delete_buffer_before); (9) Integration with Phase 04 auto-restart and Phase 02 buffer offset tracking. Disabled by default to maintain backward compatibility; opt-in via configuration. [See configuration guide](./configuration-guide.md#server-configuration) and [system architecture](./system-architecture.md#persistence-phase-04).

- **Phase 02: Multi-Server Connection Management.** Client-side browser-based profile management for switching between multiple dam-hopper servers without app restart. Stores profiles in localStorage with JSON serialization. Includes: (1) `ServerProfile` interface with UUID id, name, URL, auth type, username, and timestamp; (2) Profile CRUD functions in `server-config.ts` (getProfiles, createProfile, updateProfile, deleteProfile, setActiveProfile); (3) UI components: `ServerProfilesDialog` for list/switch/delete, `ServerSettingsDialog` for create/edit, Sidebar integration; (4) Automatic migration from legacy single-server config to profile system on first app load. All profiles persist across browser tabs and sessions. Password never stored locally (username only for display). Auth tokens remain in sessionStorage (cleared on tab close for security). [See Phase 02 documentation](./user-guide-multi-server-profiles.md) and [API Reference](./api-reference.md#client-side-profile-management-phase-2).

- **Phase 01: Server-Side Auth Bypass.** New `--no-auth` CLI flag for local development. Bypasses MongoDB authentication with production safety guards (fails if MongoDB configured or production environment detected). Includes multi-line warning banner and ERROR-level logging. Auto-generates dev tokens with 30-day expiry. Status endpoint shows `dev_mode: true` flag. All 7 integration tests passing: 3 no-auth mode tests + 3 normal auth regression + 1 production safety test. Historical documentation source unavailable.

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
