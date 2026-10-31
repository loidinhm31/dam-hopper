# Independent plan review — Lightweight Session Changes

## Status and scope

**Targeted follow-up complete; R1–R4 resolved in the revised plan.** No new Blocker/High/Medium finding on the changed surfaces. Initial review found **1 Blocker, 2 High, 1 Medium**, retained below as historical evidence. This is plan review, not implementation approval, task execution readiness or runtime qualification. Only this report written.

Reviewed approved invariants, all four phases, task ownership/dependencies, failure/rollback, wire cutover and acceptance. Future unchecked implementation tasks are expected, not findings.

### Initial inspected evidence

Paths below relative to repository unless absolute; ranges are substantive inspected sections, supplemented by symbol searches.

- `plans/reports/design-261031-0949-lightweight-session-changes-refactor.md:1-79`.
- `plans/261031-0949-lightweight-session-changes-refactor/plan.md:1-78`.
- Same directory: `phase-01-config-and-extension-lifecycle.md:1-71`, `phase-02-lightweight-per-file-engine.md:1-94`, `phase-03-omp-tool-event-extension.md:1-69`, `phase-04-settings-toggle-and-ui-qualification.md:1-105` (including full long JSON lines).
- Same directory: `reports/authoring-report.md:1-49`, `tasks.json:1-103` (execution state not audited in full).
- `README.md:1-124`; `docs/project-overview-pdr.md:1-18,46-74,96-102`; `docs/code-standards.md:1-45,112-143`; `docs/system-architecture.md:61-74`; `docs/configuration/server-runtime-settings.md:1-80`.
- `server/src/config/schema.rs:647-733`, `server/src/config/parser.rs:301-378`.
- `server/src/api/config.rs:1-200,313-439,588-719`; `server/src/api/settings.rs:1-95,175-265`; `server/src/api/workspace.rs:81-223`.
- `server/src/agent_status/integration.rs:1-253,269-418`; `server/src/api/agent_status.rs:1-105,379-435`.
- `server/src/session_changes/store.rs:1-228`, `capture.rs:1-203`, `root.rs:1-249`, `inventory.rs:1-243`, `comparison.rs:1-223`, `control.rs:1-263,285-430`, `types.rs:1-108`; `server/src/api/session_changes.rs:1-293`.
- `server/src/persistence/restore.rs:359-393`; searches of `ServerConfig` literals and obsolete protocol consumers across `server/`.
- `server/src/state.rs:140-149,385-389,460-466`, `server/src/main.rs:1118-1123`, `server/src/agent_status/runtime.rs:263-275` (search excerpts).
- `server/src/agent_status/assets/omp-agent-status.ts:1090-1209`; lifecycle/session HTTP symbol searches through that asset.
- `packages/ui/src/components/pages/SettingsPage.tsx:1-158`; `WorkspacePage.tsx:676-774` plus host/trigger search excerpts.
- `packages/ui/src/components/organisms/SessionChangesPanel.tsx:1-273`, `SessionChangesHost.tsx:1-85`; trigger/callback searches in `TabBar.tsx`, `ActiveTerminalRuntimeDisplay.tsx`, `TerminalAccessoryControls.tsx`, `PaneContainer.tsx`, `MobileTerminalAccessoryBar.tsx`, `TerminalRuntimeOutput.tsx`.
- `packages/ui/src/api/session-changes-client.ts:35-173`, `session-changes-queries.ts:1-263`, `queries.ts:969-1001,1188-1220`, `ws-transport.ts:1670-1785`; `client.ts:1887-1890` (search excerpt); `packages/ui/package.json:1-76`.
- OMP prefix `/home/loidinh/WS/oh-my-pi/packages/coding-agent/src/`: `extensibility/extensions/wrapper.ts:270-325,500-555`, `types.ts:540-568,1490-1610,2415-2440`, `tools/ast-edit.ts:1-193`, `edit/schemas.ts:1-49`, `edit/index.ts:232-293`; lineage/lifecycle searches in `runner.ts`, `task/executor.ts`, `sdk.ts`, `session/agent-session.ts`, `registry/agent-registry.ts`.
- Published planning reference `/home/loidinh/.omp/agent/skills/planning/references/task-management.md:23-57,69-120`; actual helper `/home/loidinh/.omp/agent/evcrate/scripts/plan-tasks/{readiness.cjs:7-39,transitions.cjs:31-56,evidence.cjs:6-38}`. Planning/code-review skills, plan-review reference and published development rules also read.

## Initial findings — resolved by targeted revision below

### R1 — Blocker: dependency release requires evidence that the plan defers until its descendants finish

- **Plan evidence:** `plan.md:42-48`; Phase 01 `:12,21-25,30-34`; Phase 03 `:21-25`; Phase 04 `:39-43,83`. All paths under the selected plan directory.
- **Supporting evidence:** installed `plan-tasks/readiness.cjs:13-24,35-39` requires completed dependencies with fresh evidence before claim/start; `transitions.cjs:52-55` requires completion evidence; `evidence.cjs:14-33` requires compile/tests/smoke/review results. Existing bundling uses `include_str!` (`server/src/agent_status/integration.rs:8-9`).
- **Failure scenario:** first task adds the dedicated bundle reference, but its real asset belongs to `omp-tool-event-producer`, transitively blocked by that first task. It cannot compile for completion. More generally, no predecessor can supply the deferred verification evidence until `qualify-integrated-session-changes`, which is blocked by those predecessors. Worker terminal output is not a completed durable dependency. An acyclic JSON DAG therefore still deadlocks operationally.
- **Impact:** execution cannot follow the installed task lifecycle without bypassing dependencies, fabricating evidence or violating the stated verification order. **Confidence: high** (static contract/helper comparison; not executed).
- **Smallest correction:** make the unverified atomic cutover one durable implementation task, with disjoint internal worker slices and finalizer-run evidence before its completion; retain later documentation as a successor. Alternatively permit real per-task verification and reorder the complete producer asset before its bundle consumer. Do not add a fake asset or weaken helper evidence.

### R2 — High: “every config mutation path” is outside the lifecycle task's writable scope

- **Plan evidence:** Phase 01 `:31-34,54-59` promises centralized reconciliation for every mutation, including fail-safe OFF, but grants no ownership of `server/src/api/settings.rs` or `server/src/api/workspace.rs`; no other task owns them.
- **Supporting evidence:** `server/src/api/settings.rs:13-31` reloads directly into `state.config`, bypassing `api/config.rs::reload_config`; `server/src/api/workspace.rs:164-178,186-207` also replaces config directly. Import recovery explicitly restores and reloads the old config at `server/src/api/settings.rs:245-247`.
- **Failure scenario:** enable tracking, then switch/init a workspace whose config omits the flag, or externally change TOML to OFF and use cache-clear. JSON config becomes false while the service gate/managed file remain ON. Conversely, loading ON config does not install/enable. Centralizing only the named reload helper cannot intercept these assignments. Import OFF followed by a cleanup error can also run the existing automatic old-ON recovery, contrary to the plan's no-reenable-on-disable-error rule.
- **Impact:** setting/runtime/disk diverge; OFF can leave tracking active, or fail-safe disable can be undone. **Confidence: high.**
- **Smallest correction:** add both handlers to `server-session-changes-switch.allowed_files`; route all full config replacement through one serialized reconcile/publish contract. Specify import recovery so disable/cleanup failure cannot automatically re-enable. Add cache-clear, workspace init/switch and import-error regression acceptance under an owned test path.

### R3 — High: new required Rust field leaves an exhaustive constructor unowned

- **Plan evidence:** Phase 01 `:31,53` restricts literal migration to owned config files; Phase 02 `:52,55` and Phase 04 `:42-43` require Rust test qualification. No task owns `server/src/persistence/restore.rs`.
- **Supporting evidence:** `server/src/persistence/restore.rs:366-375` exhaustively constructs `ServerConfig`, without `..Default::default()`. `server/src/config/schema.rs:649-680` is the struct receiving the new boolean.
- **Failure scenario:** add `session_changes_enabled` as required; the restore unit-test constructor omits it. Rust unit-test compilation fails with a missing-field error regardless of the Session Changes test-name filter. Serde defaults do not supply fields in Rust literals.
- **Impact:** required test commands cannot compile, and no assigned owner may repair the caller. **Confidence: high** (source-level consequence; no compiler run).
- **Smallest correction:** grant the lifecycle task `server/src/persistence/restore.rs`; migrate that literal to explicit false or a suitable default update. Keep the existing restore test coverage, rather than avoiding unit tests.

### R4 — Medium: mandatory code standards retain the rejected architecture after the docs task

- **Plan evidence:** Phase 04 `:49-52,91-93` requires replacing obsolete descriptions everywhere affected, but omits `docs/code-standards.md` from allowed writes.
- **Supporting evidence:** `docs/code-standards.md:126-136` mandates old 128/512 MiB storage limits, receipt-qualified `sessionStart`/`fromNow` states and `AbsenceTrie` absence certification. Approved design `:19-21,29-31,49-50` deliberately replaces these.
- **Failure scenario:** complete every permitted documentation edit; the mandatory engineering standards still require structures and states the implementation must delete. Future maintainers/reviewers receive contradictory normative contracts.
- **Impact:** incomplete documentation cutover and conflicting resource/provenance standards. **Confidence: high.**
- **Smallest correction:** add `docs/code-standards.md` to the documentation task and replace only its obsolete Session Changes limits/origin/absence clauses; preserve containment, immutable review and Monaco protections.

## Initial invariant coverage and positive observations

- **Default OFF / physical lifecycle:** explicitly covered in overview `:19-22` and Phase 01 `:23-34,46-59`: actual-body SHA-256 ownership, safe paths, install-before-enable, generation-before-purge, conflict preservation, startup and persistence failure behavior. Config entrypoint coverage needs R2.
- **Agent Status independence:** Phase 01 `:23-24,46` and Phase 03 `:10,23-24,54,61` preserve status/notification enablement, remove Session Changes HTTP/barrier coupling and avoid another WebSocket reporter.
- **Zero unviewed work:** Phase 02 `:14,19-21,44-46,76-79` explicitly forbids background reads/diffs, including metadata I/O on settled/status; lazy list/detail/refresh and revision bootstrap are specified. Matches the actual scan/settled code requiring replacement.
- **First-touch / fail-open / unknown:** Phase 02 `:15-17,69-72,86` covers reservations, verified ENOENT, sticky unknown and late publication; Phase 03 `:48-53,59-60` specifies one total 1500 ms deadline, Hashline MV/REM, concrete AST and result-only unknowns. No glob expansion or post-edit baseline retry authorized.
- **Subagent fences:** Phase 03 `:12,23-24,33,47-53,66-68` requires module-shared root lineage, tuple/agent/tool-call keys, unresolved-child refusal, bounded registry, switch/shutdown invalidation and no OFF→ON resurrection. OMP prepared-factory sharing and awaited hooks support feasibility; live behavior remains an execution gate.
- **Settings target and UI:** Phase 04 `:8-12,23-25,66-79` correctly uses `targetOwner`, separates preference source, handles delayed owner responses, owner-specific cache purge, all trigger surfaces, root propagation and revisionless first list.
- **Task structure/ownership:** inspected phases each have one JSON task fence, seven required fields, unique task IDs and matching markers. Declared shared writable paths are ordered transitively; no unordered within-plan writable overlap found. Structural validity does not resolve R1 or missing paths R2–R4.

## Initial checks and exclusions

Performed static design-to-phase comparison, source/callsite searches, manual graph/ownership/schema inspection and helper-code inspection. No build, typecheck, test, formatter, install, hydrate/sync, implementation or native/live-host qualification performed. Test bodies, all fixture vectors, platform packaging and external concurrent-plan state not exhaustively audited; runtime qualification remains explicitly required by Phase 04. No unsupported defect claimed from those exclusions.

## Targeted follow-up — final review status

**Complete; all four accepted corrections verified in actual revised contracts.** This is the one permitted follow-up, limited to R1–R4 and their changed dependency, ownership, intermediate-test and rollback surfaces. It is not a second whole-codebase review.

### Follow-up evidence inspected

- Selected directory `plan.md:1-78`; `phase-01-config-and-extension-lifecycle.md:1-72`; `phase-02-lightweight-per-file-engine.md:1-102`; `phase-03-omp-tool-event-extension.md:1-72`; `phase-04-settings-toggle-and-ui-qualification.md:1-109`; `reports/review-triage.md:1-58`. Full changed long task-contract lines also read.
- `packages/ui/src/api/session-changes-types.test.ts:1-99`: existing valid status fixture keys are explicitly selected (`:18-37`), supporting additive new test vectors while preserving old inputs until TS migration; new fixture sections can avoid changing the existing invalid-vector iteration (`:40-47`).
- Searched service setup references in `server/src/session_changes/{types_tests.rs,root_tests.rs}`, `server/src/agent_status/tests.rs`, `server/tests/{agent_status_runtime.rs,agent_status_integration.rs}` for the expanded lifecycle ownership boundary. No new service-setup consumer found in those searched files.
- Initial supporting source/helper evidence above remains the basis for the original findings; no full source re-audit performed. Coordinator reports successful hydrate/sync with `diagnostics: []`; reviewer did not execute or independently certify those operations.

### Finding disposition

| Finding | Follow-up disposition and exact revised evidence |
|---|---|
| **R1 — resolved** | `plan.md:42-48` now requires task-local evidence before dependency release. Phase 03 `:14,23-27,57` makes the complete producer asset/tests the unblocked root, with independent asset compile/Bun tests/controlled loopback boundary smoke/review; Phase 01 `:12,21-25` bundles only after producer completion. Phase 01 `:31-34,59-60` owns current-protocol publication/test changes needed for its own passing boundary. Phase 02 `:26-30,39-61,79,88` migrates Rust consumers and basic tests in the changing tasks, leaving actual bounded explicit-refresh behavior rather than dangling types. Phase 04 `:16,25-29,34-38,43-47,56,77,87` supplies local UI/docs evidence and reserves integrated qualification as an additional descendant gate. No predecessor's first evidence now depends on a descendant. |
| **R2 — resolved** | Phase 01 `:31-34,54,56-60` owns both `api/settings.rs` and `api/workspace.rs`, explicitly routes cache-clear/import/recovery/init/switch through serialized reconciliation, and latches runtime OFF after applied disable. Import recovery cannot restore old ON; recovery of unrelated fields must overlay OFF, with durable-persistence failure reported. Acceptance and owned lifecycle regressions/smoke cover each bypass and cleanup-error case. |
| **R3 — resolved** | Phase 01 `:31-34,53,60` grants `persistence/restore.rs`, names its exhaustive constructor migration to explicit false/default update, preserves restore tests and requires Rust unit-test compilation plus restore verification before completion. |
| **R4 — resolved** | Phase 04 `:53-56,95` grants `docs/code-standards.md` and explicitly replaces the obsolete limits, trie and receipt-qualified origin requirements while preserving containment/read-only/Monaco protections. Docs checks and independent review are local completion gates. |

### Changed-surface consistency

- Revised graph is acyclic by inspection; producer regression work is disjoint from managed installer work, and expanded Rust test ownership transfers along dependencies.
- Shared fixture ownership is now serialized engine → regression → UI (`plan.md:45`; Phase 04 `:34-35,77`). Transitional legacy vectors are test inputs only, with explicit final cleanup and Rust consumer rerun (`Phase 02:30`; `Phase 04:38,77`), not a production compatibility shim.
- Existing approved default-OFF, managed ownership/Agent Status separation, metadata-only settled/status, bounded first-touch/unknown capture, lineage fencing and targetOwner requirements remain in the revised contracts. Changed ordering does not authorize an independently shipped intermediate protocol.
- No new material finding identified on inspected revisions. Actual implementation correctness and platform/live-host evidence remain future required gates.

**Follow-up checks:** static contract/readiness/ownership comparison and focused fixture-consumer inspection only. No build, test, smoke, formatter, install, helper-state mutation or product changes. Existing task states/reopening and final user validation remain coordinator-owned.

## Unresolved questions

None outstanding from this bounded review. R1–R4 are resolved at plan level; no further independent review pass is requested. Final user validation, task-state readiness and implementation qualification are not granted by this report.
