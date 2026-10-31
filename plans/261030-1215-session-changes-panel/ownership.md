# Session changes — execution ownership and dependency authority

Planning-only matrix. Canonical overview: [plan.md](plan.md); exact task records live once in linked phases. No new scheduler, lock service, native board or runtime flags. Runtime hydration/claiming belongs to later authorized execution coordinator using installed existing helper; not performed here.

## Integration authority

One **integration owner** owns all shared UI callback/host/stacking work and cross-layer contract reconciliation. Contract owner freezes types/vectors first. Independent owners may edit only literal paths in their task. Missing caller/file or changed shared contract: stop affected workers, send exact conflict to integration owner, reconcile reviewed plan/DAG before resuming. No concurrent format/build/full-suite jobs over half-written sources. Main coordinator verifies each prerequisite locally at coherent handoff (compile/tests/smoke/independent review) before completing it; park affected crate/build writers first. Final integrated full suites are separate, once all source writers terminal; shared reports never imply earlier execution.

## Exact dependency DAG

| Task | Direct predecessors | Phase/owner |
|---|---|---|
| `freeze-session-contract` | none | 01 / Contract owner (sequential prerequisite) |
| `capture-session-baseline` | `freeze-session-contract` | 02 / Snapshot engine owner |
| `compare-session-revision` | `capture-session-baseline` | 02 / Snapshot engine owner |
| `bind-session-terminal-lifetime` | `compare-session-revision` | 03 / Server integration owner (sequential runtime handoffs) |
| `serve-session-private-controls` | `bind-session-terminal-lifetime` | 03 / Server integration owner (sequential runtime handoffs) |
| `serve-session-public-api` | `serve-session-private-controls` | 03 / Server integration owner (sequential runtime handoffs) |
| `await-omp-baseline-receipt` | `freeze-session-contract` | 04 / OMP adapter owner |
| `package-omp-session-adapter` | `await-omp-baseline-receipt` | 04 / OMP adapter owner |
| `query-session-changes` | `freeze-session-contract` | 05 / Feature client owner |
| `render-readonly-session-diff` | `query-session-changes` | 06 / Read-only UI owner |
| `compose-session-review-panel` | `render-readonly-session-diff` | 06 / Read-only UI owner |
| `integrate-session-review-host` | `serve-session-public-api`, `package-omp-session-adapter`, `compose-session-review-panel` | 07 / Sole integration owner (all shared UI callbacks and cross-layer reconciliation) |
| `prove-live-omp-first-turn` | `integrate-session-review-host` | 07 / Sole integration owner (all shared UI callbacks and cross-layer reconciliation) |
| `qualify-session-resource-bounds` | `prove-live-omp-first-turn` | 08 / Single verification coordinator; documentation writer only after qualification |
| `qualify-session-live-ui` | `qualify-session-resource-bounds` | 08 / Single verification coordinator; documentation writer only after qualification |
| `document-session-changes` | `qualify-session-live-ui` | 08 / Single verification coordinator; documentation writer only after qualification |

## Useful execution groups

1. `freeze-session-contract` alone. Do not claim independent engine/adapter/client work before registered types-only Rust/TS modules pass local compile/vector tests/contract smoke and independent review. Freeze owns lib.rs/mod.rs/types_tests.rs; engine subsequently modifies the same modules, never creates a second registration.
2. Three disjoint tracks after freeze: `capture-session-baseline -> compare-session-revision`; `await-omp-baseline-receipt -> package-omp-session-adapter`; `query-session-changes -> render-readonly-session-diff -> compose-session-review-panel`.
3. As soon as comparison is evidence-backed complete, `bind-session-terminal-lifetime -> serve-session-private-controls -> serve-session-public-api` may overlap remaining adapter/UI tracks. Server shared runtime/mod writers deliberately sequential, even when a narrower split might be possible.
4. Join public API + managed adapter + composed panel; `integrate-session-review-host` alone owns entire caller chain; then `prove-live-omp-first-turn` crosses real layers.
5. `qualify-session-resource-bounds -> qualify-session-live-ui -> document-session-changes` sequential. Main verification owner coordinates exact commands; no duplicate suites from implementation workers. Docs owner cannot mark qualification passed from source only.

At every arrow, terminal code is not enough: main coordinator holds other writers to the same Rust crate/TS build at coherent checkpoints, executes local checks/review, completes that task, then releases dependents. Disjoint source tracks can overlap, but compile/browser/full-suite work must not race shared builds. No task requires descendant integration evidence for its own local completion. Dependencies are hard prerequisites; these groups do not introduce a second scheduling model. Authors do not hydrate state or infer task completion from unchecked Markdown.

## Local completion versus release qualification

Each task JSON verification array names its own currently executable compile/tests/smoke/review gate. Freeze's actual Rust vector smoke, engine's real temporary-repository smoke, server's real domain/HTTP/router smoke, adapter's awaited factory/controlled HTTP-boundary smoke, client's captured transport smoke and viewer/panel/host's actual Chromium interaction smoke require no descendants. Boundary doubles test only that local seam; real OMP/model/application/native/human acceptance remains required in `prove-live-omp-first-turn` and `qualify-session-live-ui`. Package installer uses a real temporary agent home without a model. Main coordinator alone releases children after exact local evidence; this plan does not create/hydrate evidence state.

Sequential source transfers: `freeze-session-contract` modifies existing lib.rs and creates types-only mod.rs; `capture-session-baseline` then modifies both; compare/binding/private later modify mod.rs. types_tests.rs stays owned by freeze; root.rs/root_tests.rs/absence.rs/absence_tests.rs are capture-owned. Paths appear as Create only for first creator, Modify thereafter. Original-failure registration state and adopted fromNow activeReview are distinct domain metadata; root/absence budgets are engine-owned, all consumer DTOs frozen before concurrency.

## Full writable path matrix

All paths normalized project-relative literals; full absolute Create/Modify action lists in corresponding phases. No deletes. A row with multiple writers is ordered transitively by DAG; all incomparable task pairs have disjoint files. New tests/reference artifacts are deliberate planned paths, not claims those files exist now. Standard ignored compiler/test output generated by future checks is not source-edit authority; report unexpected tracked writes.

| Literal path | Writer task(s), ordered |
|---|---|
| `docs/CHANGELOG.md` | `document-session-changes` |
| `docs/api-reference.md` | `document-session-changes` |
| `docs/architecture/agent-status.md` | `document-session-changes` |
| `docs/architecture/workbench-files-editor-and-git.md` | `document-session-changes` |
| `docs/code-standards.md` | `document-session-changes` |
| `docs/frontend-components.md` | `document-session-changes` |
| `docs/project-roadmap.md` | `document-session-changes` |
| `docs/system-architecture.md` | `document-session-changes` |
| `packages/ui/browser-tests/session-changes-host.browser.tsx` | `integrate-session-review-host` |
| `packages/ui/browser-tests/session-changes-panel.browser.tsx` | `compose-session-review-panel` |
| `packages/ui/browser-tests/session-changes-viewer.browser.tsx` | `render-readonly-session-diff` |
| `packages/ui/e2e/session-changes-review/compact.png` | `qualify-session-live-ui` |
| `packages/ui/e2e/session-changes-review/evidence.json` | `qualify-session-live-ui` |
| `packages/ui/e2e/session-changes-review/incomplete.png` | `qualify-session-live-ui` |
| `packages/ui/e2e/session-changes-review/inline.png` | `qualify-session-live-ui` |
| `packages/ui/e2e/session-changes-review/omp-session-fixture.ts` | `prove-live-omp-first-turn` |
| `packages/ui/e2e/session-changes-review/review.md` | `qualify-session-live-ui` |
| `packages/ui/e2e/session-changes-review/screenshot.png` | `qualify-session-live-ui` |
| `packages/ui/e2e/session-changes-review/session-changes-review.spec.ts` | `prove-live-omp-first-turn` -> `qualify-session-live-ui` |
| `packages/ui/e2e/session-changes-review/tauri.png` | `qualify-session-live-ui` |
| `packages/ui/src/api/session-changes-client.test.ts` | `query-session-changes` |
| `packages/ui/src/api/session-changes-client.ts` | `query-session-changes` |
| `packages/ui/src/api/session-changes-queries.test.tsx` | `query-session-changes` |
| `packages/ui/src/api/session-changes-queries.ts` | `query-session-changes` |
| `packages/ui/src/api/session-changes-types.test.ts` | `freeze-session-contract` |
| `packages/ui/src/api/session-changes-types.ts` | `freeze-session-contract` |
| `packages/ui/src/api/ws-transport.test.ts` | `query-session-changes` |
| `packages/ui/src/api/ws-transport.ts` | `query-session-changes` |
| `packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.test.tsx` | `integrate-session-review-host` |
| `packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.tsx` | `integrate-session-review-host` |
| `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.test.tsx` | `integrate-session-review-host` |
| `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx` | `integrate-session-review-host` |
| `packages/ui/src/components/organisms/MultiTerminalDisplay.tsx` | `integrate-session-review-host` |
| `packages/ui/src/components/organisms/PaneContainer.test.tsx` | `integrate-session-review-host` |
| `packages/ui/src/components/organisms/PaneContainer.tsx` | `integrate-session-review-host` |
| `packages/ui/src/components/organisms/ReadonlyMonacoDiffViewer.tsx` | `render-readonly-session-diff` |
| `packages/ui/src/components/organisms/SessionChangedFilesList.tsx` | `render-readonly-session-diff` |
| `packages/ui/src/components/organisms/SessionChangesHost.tsx` | `integrate-session-review-host` |
| `packages/ui/src/components/organisms/SessionChangesPanel.tsx` | `compose-session-review-panel` |
| `packages/ui/src/components/organisms/SplitLayout.tsx` | `integrate-session-review-host` |
| `packages/ui/src/components/organisms/TabBar.tsx` | `integrate-session-review-host` |
| `packages/ui/src/components/organisms/TerminalAccessoryControls.tsx` | `integrate-session-review-host` |
| `packages/ui/src/components/organisms/TerminalRuntimeOutput.test.tsx` | `integrate-session-review-host` |
| `packages/ui/src/components/organisms/TerminalRuntimeOutput.tsx` | `integrate-session-review-host` |
| `packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx` | `integrate-session-review-host` |
| `packages/ui/src/components/pages/WorkspacePage.test.tsx` | `integrate-session-review-host` |
| `packages/ui/src/components/pages/WorkspacePage.tsx` | `integrate-session-review-host` |
| `packages/ui/src/lib/session-changes-model-uri.test.ts` | `render-readonly-session-diff` |
| `packages/ui/src/lib/session-changes-model-uri.ts` | `render-readonly-session-diff` |
| `plans/261030-1215-session-changes-panel/reports/integration-smoke.md` | `prove-live-omp-first-turn` |
| `plans/261030-1215-session-changes-panel/reports/qualification.md` | `qualify-session-live-ui` |
| `plans/261030-1215-session-changes-panel/reports/resource-qualification.md` | `qualify-session-resource-bounds` |
| `server/src/agent_status/assets/omp-agent-status.ts` | `await-omp-baseline-receipt` |
| `server/src/agent_status/collector.rs` | `serve-session-private-controls` |
| `server/src/agent_status/integration.rs` | `package-omp-session-adapter` |
| `server/src/agent_status/runtime.rs` | `bind-session-terminal-lifetime` -> `serve-session-private-controls` |
| `server/src/api/mod.rs` | `serve-session-public-api` |
| `server/src/api/router.rs` | `serve-session-public-api` |
| `server/src/api/session_changes.rs` | `serve-session-public-api` |
| `server/src/lib.rs` | `freeze-session-contract` -> `capture-session-baseline` |
| `server/src/main.rs` | `bind-session-terminal-lifetime` |
| `server/src/pty/manager.rs` | `bind-session-terminal-lifetime` |
| `server/src/pty/tests.rs` | `bind-session-terminal-lifetime` |
| `server/src/session_changes/absence.rs` | `capture-session-baseline` |
| `server/src/session_changes/absence_tests.rs` | `capture-session-baseline` |
| `server/src/session_changes/binding.rs` | `bind-session-terminal-lifetime` |
| `server/src/session_changes/capture.rs` | `capture-session-baseline` |
| `server/src/session_changes/capture_tests.rs` | `capture-session-baseline` |
| `server/src/session_changes/comparison.rs` | `compare-session-revision` |
| `server/src/session_changes/comparison_tests.rs` | `compare-session-revision` |
| `server/src/session_changes/control.rs` | `serve-session-private-controls` |
| `server/src/session_changes/inventory.rs` | `capture-session-baseline` |
| `server/src/session_changes/mod.rs` | `freeze-session-contract` -> `capture-session-baseline` -> `compare-session-revision` -> `bind-session-terminal-lifetime` -> `serve-session-private-controls` |
| `server/src/session_changes/root.rs` | `capture-session-baseline` |
| `server/src/session_changes/root_tests.rs` | `capture-session-baseline` |
| `server/src/session_changes/store.rs` | `capture-session-baseline` |
| `server/src/session_changes/text_diff.rs` | `compare-session-revision` |
| `server/src/session_changes/types.rs` | `freeze-session-contract` |
| `server/src/session_changes/types_tests.rs` | `freeze-session-contract` |
| `server/src/state.rs` | `bind-session-terminal-lifetime` |
| `server/tests/agent_status_hooks.rs` | `package-omp-session-adapter` |
| `server/tests/agent_status_integration.rs` | `package-omp-session-adapter` |
| `server/tests/fixtures/session-changes-wire.json` | `freeze-session-contract` |
| `server/tests/omp-agent-status.test.ts` | `await-omp-baseline-receipt` |
| `server/tests/session_changes_adversarial.rs` | `qualify-session-resource-bounds` |
| `server/tests/session_changes_api.rs` | `serve-session-public-api` |
| `server/tests/session_changes_controls.rs` | `serve-session-private-controls` |
| `server/tests/session_changes_lifecycle.rs` | `bind-session-terminal-lifetime` |
| `server/tests/session_changes_protocol.rs` | `prove-live-omp-first-turn` |

## Source boundaries kept read-only

Existing `GitLocalChanges.tsx`, `DiffViewer.tsx`, `ChangedFilesList.tsx`, global `api/ownership.ts`, `TerminalPanel.tsx`, `TerminalKeepAliveHost.tsx`, DB schemas/manifests/version files and Android-native sources are not writable. Their observed rendering/security patterns can inform dedicated feature code. `fs/secure_path.rs` and canonical VCS-root helpers are consumed, not weakened/replaced. Installed `/home/loidinh/WS/oh-my-pi` source is evidence/provisioning input, not patch scope.

Exact UI integration: WorkspacePage -> TraditionalTerminalProjectsDisplay -> MultiTerminalDisplay -> SplitLayout/recursive LayoutTree -> PaneContainer -> TabBar or MobileTerminalAccessoryBar -> TerminalAccessoryControls. Alternate runtime path: WorkspacePage -> ActiveTerminalRuntimeDisplay -> TerminalRuntimeOutput -> MobileTerminalAccessoryBar -> TerminalAccessoryControls; desktop runtime header action included. Only `integrate-session-review-host` writes those source files. Host resolves actual current server incarnation from sessionMap/captured listDetailed, never0 fallback.

## Cross-plan conflict policy

Related `plans/261019-1505-git-conflict-resolver/plan.md` remains unfinished in qualification per repository-evidence:28-30. Classification: **concurrent overlap**, not a requirement to complete its feature qualification and not superseded/merged. Actual shared source/edit seams: `server/src/state.rs`, `server/src/api/router.rs`, `packages/ui/src/components/pages/WorkspacePage.tsx`, transport/Git infrastructure, Monaco lifecycle/stacking conventions and docs. New viewer does not edit existing conflict viewer/model modules. Do not import its unqualified behavior or edit that plan.

Before source execution, coordinator checks whether any actual conflict-resolver writer is active for these literal paths; serialize those writers and common docs finalization, or establish one common integration owner. A plan label is not a lock or proof of completion. No global lock/runtime invention. If active cross-plan ownership cannot be reconciled, conflicting task is blocked, not permission to write concurrently. Within this selected DAG all overlapping writers are already ordered. Other UI/Android plan artifacts grant no extra implementation authority.

## Rollback and handoff

Stop consumers before coherent rollback; remove feature routes/client channels/host/protocol/domain together, restore prior owned managed adapter using existing installer, destroy only private server snapshot artifacts. No working-file/index/branch mutation. Keep original snapshots while service continues; no silent eviction/rebaseline during partial deployment. Never stage/commit/push without separate explicit authorization.

Unresolved questions: no product choice. Runtime gates and cross-plan *active writer* check belong to implementation coordinator at execution time; no active-run ownership claim is made by this authoring artifact.
