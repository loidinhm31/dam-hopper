# Phase 04 — Settings toggle, UI semantics and integrated qualification

Priority P1 · pending · 0.50d · owners: settings/UI implementer, sole integration finalizer, then docs owner.
Context: [approved design](../reports/design-261031-0949-lightweight-session-changes-refactor.md), [engine DTO/lazy contract](phase-02-lightweight-per-file-engine.md), [producer lifecycle](phase-03-omp-tool-event-extension.md).

## Existing UI and boundaries

`SettingsPage.tsx` computes `targetOwner` from Settings Target Server and uses `useConfig(targetOwner)`/`useUpdateConfig(targetOwner)`. Follow that convention; Workbench Preferences Source and active workspace server are not the setting authority. `api/client.ts::DamHopperConfig` currently omits the server shape; extend it minimally without discarding unrelated server fields during full config replacement.

`WorkspacePage.tsx::handleOpenSessionChanges` opens the sole `SessionChangesHost`; triggers exist in `TabBar.tsx`, `ActiveTerminalRuntimeDisplay.tsx` and mobile `TerminalAccessoryControls.tsx`, reached through the existing shell callback chain. Gate by each terminal's actual owner, not one ambient profile flag. Preserve one host above responsive shells, focus/keyboard isolation, capability-free Monaco and Git Changes behavior.

`SessionChangesPanel.tsx` currently requires a comparison revision before `/files` and auto-refreshes an empty comparison; its copy says session-start snapshot. New metadata-only status must not deadlock initial files fetch. Opening the panel is the explicit viewer boundary; do not mount viewer queries while closed/disabled or eagerly compare when a terminal becomes idle.

## Completion evidence policy

Every task below has its own local compile/typecheck (or justified Markdown-only not-applicable), focused tests, local smoke and review gate before completion. Earlier phase tasks follow the same policy. The coordinator serializes shared build lanes at coherent boundaries; no checks run against another worker's half-edited tree. `qualify-integrated-session-changes` is the additional final cross-layer suite/live journey, never a substitute for predecessor evidence. Per-task reports/evidence are collected by the coordinator under its explicit report scope.

## Durable tasks

```evcrate-tasks
[
  {
    "id": "settings-toggle-owner-binding",
    "title": "Add target-server Session Changes toggle with lifecycle feedback",
    "blocked_by": ["server-session-changes-switch"],
    "allowed_files": ["packages/ui/src/components/pages/SettingsPage.tsx", "packages/ui/src/components/pages/SettingsPage.test.tsx", "packages/ui/src/api/client.ts", "packages/ui/src/api/queries.ts"],
    "constraints": ["Use targetOwner with existing useConfig/useUpdateConfig; setting belongs to server config, never workbench preferences/localStorage.", "Preserve all existing config fields during update; fence target profile/generation changes and prevent concurrent toggle mutations.", "Do not claim tracking active in an already-running OMP session immediately after enabling; show restart notice and managed-file conflicts."],
    "acceptance": ["Accessible ON/OFF control reflects server.sessionChangesEnabled, defaults visually OFF until authoritative config is available, and disables without a valid ready owner.", "Toggling only updates selected Settings Target Server; Workbench Preferences Source and active workspace selection do not redirect requests or late responses.", "Successful ON shows Restart active OMP sessions to load the Session Changes extension; OFF clears this notice and surfaces any physical-uninstall conflict honestly.", "Mutation failure restores authoritative config view and exposes actionable error; unrelated config fields and Agent Status settings remain unchanged."],
    "verification": ["At this task boundary run pnpm --filter @dam-hopper/ui build and pnpm --filter @dam-hopper/ui test src/components/pages/SettingsPage.test.tsx.", "Smoke the actual Settings section with the completed config lifecycle against isolated server A/B or a controlled HTTP config peer: change target during delayed toggle, verify persisted flag/restart notice/errors and owner isolation. Collect local review plus compile/tests/smoke evidence now; do not require later panel or integrated OMP tasks."]
  },
  {
    "id": "lazy-panel-and-triggers",
    "title": "Migrate lazy viewer contracts and gate all terminal review triggers",
    "blocked_by": ["settings-toggle-owner-binding", "qualify-engine-protocol"],
    "allowed_files": ["packages/ui/src/api", "packages/ui/src/components/pages/WorkspacePage.tsx", "packages/ui/src/components/organisms/SessionChangesPanel.tsx", "packages/ui/src/components/organisms/SessionChangesHost.tsx", "packages/ui/src/components/organisms/SessionChangedFilesList.tsx", "packages/ui/src/components/organisms/TabBar.tsx", "packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.tsx", "packages/ui/src/components/organisms/TerminalAccessoryControls.tsx", "packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx", "packages/ui/src/components/organisms/TerminalRuntimeOutput.tsx", "packages/ui/src/components/organisms/PaneContainer.tsx", "packages/ui/browser-tests/session-changes-panel.browser.tsx", "packages/ui/browser-tests/session-changes-host.browser.tsx", "packages/ui/browser-tests/session-changes-viewer.browser.tsx", "server/tests/fixtures/session-changes-wire.json"],
    "constraints": ["Reuse existing owner-bound API/query keys and one modal host; no new global preferences store or duplicated responsive host.", "No current-file/diff requests when panel closed or owning server disabled; cached data must not leak after OFF, disconnect or generation switch.", "Remove obsolete fromNow/barrier clients, types, decoder vectors and transport channels, migrating every affected caller/test; preserve Git Changes and read-only Monaco.", "Use tool-observed first-touch wording, explicit unknown coverage and root/revision-fenced detail; do not promise bash/eval or complete attribution."],
    "acceptance": ["Desktop tab, active-runtime and mobile triggers hide/disable when their terminal-owning server is OFF, unknown or unavailable; direct stale open callbacks are refused too.", "An open panel closes or transitions to disabled immediately on authoritative OFF, cancels queries and removes retained session query data for that owner only.", "Panel opens from metadata-only ready status without existing comparison, lazily fetches first files revision and supports all 500 observed paths via bounded pagination.", "Files/detail/refresh propagate rootId and owner/epoch/baseline/revision fences; stale detail clears/reloads safely, not rendering mixed revisions.", "Copy says tool-observed edits since first touch, explains restart/new-session availability, unknown paths and external writers, and points script mutations to Git Changes."],
    "verification": ["At this task boundary run pnpm --filter @dam-hopper/ui build and pnpm --filter @dam-hopper/ui test src/api/session-changes-types.test.ts src/api/session-changes-client.test.ts src/api/session-changes-queries.test.tsx src/api/ws-transport.test.ts, then pnpm --filter @dam-hopper/ui test:browser browser-tests/session-changes-panel.browser.tsx browser-tests/session-changes-host.browser.tsx browser-tests/session-changes-viewer.browser.tsx.", "Smoke the mounted viewer against the completed server/API using seeded temp-project captures; check closed/disabled zero requests, lazy bootstrap, owner switch, pagination, revision changes and keyboard isolation. Collect local review and fresh evidence before completion; live installed OMP/Tauri/human visual release gates remain additional final qualification.", "After removing legacy fixture vectors, rerun cargo test --manifest-path server/Cargo.toml session_changes::types to prove remaining shared-vector consumers still pass; the engine regression prerequisite serializes shared fixture ownership."]
  },
  {
    "id": "qualify-integrated-session-changes",
    "title": "Qualify complete default-off lifecycle and live tool-observed review",
    "blocked_by": ["qualify-engine-protocol", "qualify-omp-producer", "lazy-panel-and-triggers"],
    "allowed_files": ["plans/261031-0949-lightweight-session-changes-refactor/reports/integration-report.md"],
    "constraints": ["One finalizer runs the final coherent cross-layer suites/live journey only after evidence-backed prerequisite completion; local task checks already passed and no source/test fixes are authorized here.", "Record exact commands, outcomes and actual runtime/platform versions; fixture results are not live OMP/Tauri proof.", "Failure blocks release and returns to the responsible owning task; do not weaken tests or mark unsupported surfaces passed."],
    "acceptance": ["Rust domain/integration suites, Bun producer/status suites, UI typecheck/unit/browser checks execute with exact pass/fail evidence.", "Real Linux OMP journey covers default OFF, physical ON install/restart notice, first-touch main/task edits, lazy review/revert, fail-open unknown and physical OFF remove/purge with Agent Status still reporting.", "No-viewer run proves no session-start/settled/status content reads or diffs, while bounded tool capture alone performs expected original reads; quota/race cases remain covered.", "Independent implementation review and shared web/Tauri UI qualification are recorded; unavailable platform or visual gates remain explicit blockers, never fabricated passes."],
    "verification": ["At this task boundary rerun cargo check --manifest-path server/Cargo.toml and the Rust/Bun/UI suites listed in phases as one coherent cross-layer qualification; record fresh integrated outputs in integration-report.md, distinct from prerequisite-local evidence.", "Smoke real installed OMP write, multi-file Hashline edit/MV/REM, concrete AST, glob AST unknown and in-process task edits; compare displayed originals to files prepared before tools.", "Use isolated loopback test server/temp project and measured I/O/diff evidence for no-viewer behavior; verify 1500 ms fail-open under unavailable capture and immediate OFF rejection/purge.", "Check responsive browser and shared Tauri read-only review, focus isolation and owner changes; collect independent integrated review and human visual result before this task completes, or report the exact missing prerequisite."]
  },
  {
    "id": "document-lightweight-session-changes",
    "title": "Document first-touch semantics, resource bounds and operator lifecycle",
    "blocked_by": ["qualify-integrated-session-changes"],
    "allowed_files": ["docs/system-architecture.md", "docs/api-reference.md", "docs/configuration/server-runtime-settings.md", "docs/codebase-summary.md", "docs/code-standards.md", "docs/CHANGELOG.md", "docs/project-roadmap.md"],
    "constraints": ["Use current installed docs conventions and update existing files; do not edit prior plan history or invent verification/approval.", "Replace old session-start/AbsenceTrie/barrier/background-scan descriptions everywhere affected; preserve unrelated subsystem documentation.", "No version bump, release commit/push or Android-native feature scope is authorized by this task."],
    "acceptance": ["Architecture/API/config docs describe server default OFF, JSON/TOML names, separate managed extension ownership, ON restart notice and immediate OFF purge/rejection/removal.", "Docs state tool-observed first-touch scope, supported tools/subagents, unknown timeout/glob paths, no bash/eval capture, lazy viewer work and 2 MiB/64 MiB/500/32 bounds.", "Code standards replace obsolete Session Changes clauses at docs/code-standards.md:126-136: remove trie/128-512 MiB/receipt-qualified origins and mandate bounded first-touch provenance, metadata-only settled/status and lazy viewer work; preserve containment/read-only/Monaco safeguards.", "Changelog/roadmap/codebase summary reflect actual implemented cutover and measured qualification status, including any platform or operator cleanup limitations."],
    "verification": ["Compile/typecheck is not applicable to this Markdown-only task; document that reason in its own evidence rather than borrowing a descendant compile result. Perform focused doc-to-final-schema/fixture/config checks and changed-link checks now.", "Smoke operator-facing examples/links against the already qualified config/API behavior, verify OFF rollback wording and absence of obsolete Session Changes normative claims, then obtain independent local docs review before completing this task."]
  }
]
```

- [ ] <!-- evcrate-task:settings-toggle-owner-binding --> Add target-server Session Changes toggle with lifecycle feedback
- [ ] <!-- evcrate-task:lazy-panel-and-triggers --> Migrate lazy viewer contracts and gate all terminal review triggers
- [ ] <!-- evcrate-task:qualify-integrated-session-changes --> Qualify complete default-off lifecycle and live tool-observed review
- [ ] <!-- evcrate-task:document-lightweight-session-changes --> Document first-touch semantics, resource bounds and operator lifecycle

## Ordered implementation

### `settings-toggle-owner-binding`

1. Extend `api/client.ts::DamHopperConfig` with server flag shape, preserving actual response object/server siblings. Do not round-trip only workspace/projects or substitute a browser-local switch. Reuse existing config endpoint/mutation and serialize requests.
2. Add a collapsed Settings section using existing `SettingsSectionAccordion` convention and an accessible labeled toggle. Bind to `config.server.sessionChangesEnabled`, `targetOwner`, loading/pending/error states. Display both selected-server scope and exact active-OMP restart notice on enable.
3. Capture target profile/generation at action start; do not apply late notices to a new target. Keep server response authoritative after failures, including OFF accepted with cleanup conflict; refetch selected owner config/status rather than optimistically declaring physical deletion.
4. Invalidate config/Session Changes queries only for the mutated owner. Test two profiles with different flags, preference-source independence, double-click and delayed response/generation replacement.

### `lazy-panel-and-triggers`

1. Migrate TS types/decoders/client/queries/transport and tests to Phase 02 wire vectors. Remove `startFromNow`, `useSessionChangesFromNowMutation`, transport `sessionChanges:fromNow`, barrier/origin assumptions and legacy fixture vectors once their last TS consumers migrate. Shared fixture ownership follows `qualify-engine-protocol` completion; rerun remaining Rust vector consumers before completion. Propagate `rootId` through status/files/detail/refresh with correct keys/body/query mapping.
2. Query each trigger terminal's owner config with existing owner-bound facilities; use a small shared helper within existing API module only if it avoids duplicate logic. Thread eligibility through existing props only where needed; do not widen shell ownership or depend on the active workspace profile for foreign terminals. Recheck enablement and owner generation in `WorkspacePage::handleOpenSessionChanges` after awaits.
3. Hide/disable trigger while OFF/unknown/loading/unavailable. `SessionChangesHost` rejects disabled mount; when authoritative OFF arrives, close/disable open panel, cancel work and clear that owner's sensitive Session Changes cache. Old requests may not repopulate cache/UI; preserve other servers' queries.
4. Replace revision-required initial files gate: panel-mounted metadata-ready identity requests `/files` without revision, receives comparison/revision, then enables detail and subsequent cursor pages. Refresh has root identity and returns coherent revision; stale-revision errors clear old selection/detail and fetch a new first page. No effect outside mounted visible panel calls refresh.
5. Replace session-start/initializing capture copy with “Tool-observed edits since first touch”; empty record means no supported tool paths yet, not a missing full snapshot. Explain supported tool limits, unknown paths, external writers and Git Changes for script mutations. Keep unavailable/restart messaging truthful for active sessions that have not loaded the extension.
6. Implement load-more/cursor behavior for up to 500 paths using existing page limit 200, without broadening discovery. Derive absence/unknown detail from server presence, never empty content. Preserve read-only Monaco and bounded metadata-only cases.
7. Update current API/unit/browser tests for flag gating across desktop/runtime/mobile, zero closed-panel comparison requests, no-comparison bootstrap, unproven rows, reversion, paging, OFF during requests and owner/root/revision replacement.

### `qualify-integrated-session-changes`

1. After every prerequisite is evidence-backed completed (not merely worker-terminal), sole finalizer reads applicable installed test principles and runs the additional coherent cross-layer compile/tests, live smoke and independent integrated review. Earlier task-local evidence already exists; it was not deferred to this task. Final failures reopen the responsible scoped work with coordinator-managed invalidation, never fabricated retroactive evidence.
2. Use isolated temp agent home/project and loopback-only server; never install into the operator's real extension directory during tests. Confirm default OFF absence, ON managed install, restart notice, OMP restart, supported main/task writes, and expected first-touch original/current rows.
3. With no browser viewer, measure content reads/diff invocations across registration, repeated settle and status calls. Capture itself is allowed one bounded original read per new path; distinguish it from forbidden background comparisons. Then open panel and observe lazy current reads/stats only on viewer requests.
4. Inject capture timeout/unavailable transport, glob AST result-only path, late completion, modified managed file and OFF race. Confirm tool latency bound, unknown provenance, no late repopulation, zero retained accounting/temp payloads, file preservation on conflict and intact status/notification reporting.
5. Check browser responsive/mobile/shared Tauri read-only and keyboard behavior, review accurate copy, record exact platform qualifications. Linux producer is scoped; do not expand Windows/Android tracking. Required unexercised gates block release rather than turning into a vague follow-up.

### `document-lightweight-session-changes`

1. Read affected existing docs, including `docs/code-standards.md:126-136`, then replace old inventory/trie/barrier/from-now/settled-background-diff explanations with final tool-event contracts. Update API endpoint/body/error/revision and config examples. In code standards replace the obsolete metadata-tree/resource/origin/absence mandates while preserving root containment, immutable review, keyboard isolation and Monaco protections.
2. Document root/task lineage coverage, first-touch/unknown semantics, managed file conflicts, active-session restart on ON, immediate OFF effect and rollback. No universal attribution or retroactive capture claims.
3. Update existing changelog and roadmap using integration evidence only; no release version changes. Confirm old plan remains historical and this overview is the selected authority.

## Failure, rollback and security/bounds

- Toggle errors are actionable server conflicts, not reasons to silently enable UI-local tracking. Disable must remain authoritative even if a modified extension cannot be deleted; report the remaining physical file and operator action.
- Never use an ambient default owner for a qualified terminal. Keep profile/generation/terminal incarnation/root/session/epoch/baseline/revision guards through asynchronous responses and model URIs.
- Opening the viewer is read-only; no workspace/index/HEAD mutation, commands, terminal input, download/export of original bytes, new telemetry or renderer capability widening.
- Operational rollback: OFF → immediate server gate/purge → safe managed file removal; old originals cannot be restored. A fresh ON requires restarting active OMP sessions and starts new first-touch history.
- No implementation or product test execution occurs during plan authoring. Coordinator owns plan review, hydration/sync, task claims and eventual implementation authorization.

## Unresolved questions

None in selected product design. Actual runtime/tool availability and required review/visual qualification are execution gates; record failures precisely if encountered.
