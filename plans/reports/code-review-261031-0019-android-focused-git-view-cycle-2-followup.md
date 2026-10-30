## Code Review Summary — Cycle 2, post-critical-fix follow-up

**Score: 5/10 — improvements confirmed in source; changes still required. Not release approval.**

### Scope and evidence
- Plan: `plans/261030-1617-android-focused-git-view/plan.md`, Phases 01–08; acceptance matrix and release-readiness ledger.
- Focused review of current fixture/runner, WorkspaceGitSafety and regression tests, root/ViewModel bindings, history/Changes/publication controllers, runtime/state, mounted Git controls, graph layout/Canvas, editor/file/terminal rebinding changes. Read README, PDR, code standards, published development/documentation rules and code-review skill.
- Static source review and relevant diffs, not exhaustive line coverage of all test suites. Runtime failure scenarios below are **[INFERENCE]**, high confidence unless stated otherwise. Actual source references underpin each finding.
- No builds, tests, linters, device journeys or performance measurements executed by reviewer; independent validation belongs to Main/PostFixValidation. Historical pass counts are not fresh evidence.
- No product, test, plan or task-status edits; this report is the only authored artifact. Main retains plan/status ownership.

### Previous critical issue disposition
1. **Direct host-token replacement: repaired.** `scripts/git-workspace-fixture.mjs:855-863,902-919` removes host token byte reads/backup/replacement/restoration, generates disposable signing material, and refuses native Windows before seeding/server startup. However, complete host credential isolation is **not closed**: C1 below identifies remaining child-process fallback into the real host config.
2. **Dirty HISTORY/Drop bypass: repaired in source.** `features/git/WorkspaceGitSafety.kt:68-104` now includes FILES, TARGETS and HISTORY; empty path lists refuse dispatch with dirty documents. Actual Drop and Undo call that guard with HISTORY (`GitHistoryActionController.kt:328-336,448-456`); Reset/Revert/Cherry-pick use guarded FILES (`:28-36,148-156,268-276`). Dirty-path translation exceptions now return failure rather than falling back to raw path (`WorkspaceGitSafety.kt:86-93`).
3. **Fallback dirty inventory: repaired for its bound workspace.** `ui/screens/DamHopperMobileApp.kt:379-385` reads `wsState.getDirtyDocumentIds()` instead of unconditional empty inventory. This does not establish cross-retained-owner coverage for that fallback.
4. **Regression assertions added, not executed here.** `jvmTest/.../workspace/GitWorkspaceSafetyTest.kt:293-337` checks dirty whole-target HISTORY refusal and invalid absolute path refusal with no dispatch. They invoke the safety method directly; no real Drop controller/HTTP regression or full action matrix is demonstrated by these additions.

Paths below are relative to `native/android-app/` unless prefixed otherwise.

### Critical issues

**C1 — Child server can still read/create real host signing credentials through config-directory fallback.**
- `scripts/git-workspace-fixture.mjs:841-842,855-860,912-920`; `server/src/main.rs:1120-1124,1140-1161`; pinned dependency `server/Cargo.toml:67` (`dirs = "5"`).
- `runDir = path.join(evidenceDir, ...)` preserves a relative caller-supplied evidence directory. Thus Linux receives a relative `XDG_CONFIG_HOME`. Inspected installed `dirs-5.0.1/src/lin.rs:9` accepts only absolute XDG paths and otherwise resolves real `$HOME/.config`; the fixture leaves HOME inherited. The server's `manage_token` then reads the real key, or generates/writes a host key when absent/empty. `SERVER_TOKEN` is not consulted by that function. Explicit replacement of an existing nonempty key is gone; do not conflate that improvement with complete isolation.
- macOS is also allowed by the Windows-only block, but inspected `dirs-5.0.1/src/mac.rs:7-10` ignores XDG and uses inherited HOME/Library/Application Support. It has the same remaining host credential access.
- Impact: disposable-only boundary broken, host authentication config access/creation, authentication failure because seeded JWT uses a different key. No actual host mutation/exfiltration reproduced here.
- Correction: resolve evidence/run directories to absolute paths before any use; explicitly isolate child HOME and all relevant config/data/auth paths; reject unsupported OS/config resolution before launching; verify actual binary resolution without relying on SERVER_TOKEN/APPDATA alone. Add relative-path and platform cases using disposable sentinel homes, not real credentials.

### Warnings

**W1 — High: revocation can be undone by late runtime refresh.**
- `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitWorkspaceRuntime.kt:83-109,112-123,161-165`; `.../WorkspaceGitSafety.kt:42-53`; `androidApp/.../platform/workspace/NativeWorkspaceViewModel.kt:1359-1376`.
- Refresh work uses the long-lived scope with no runtime epoch/cancellation ownership. A delayed roots completion after revoke can call selectRoot, repopulate controller scopes, then revalidate presentation authority. Safety's production connection getter captures the old immutable apiClient connection; missing authority is accepted. Fence all post-suspension effects against current installed owner/generation/root/runtime epoch; fail closed on retired/missing authority even without dirty docs.

**W2 — High: post-dispatch uncertainty/cancellation becomes guard rejection.**
- `.../features/git/WorkspaceGitSafety.kt:107-112`; `.../GitChangesController.kt:156-198`; `.../LeasedPublishController.kt:125-185`; `.../GitWorkspaceRuntime.kt:161-165`.
- Guard catches dispatch exceptions, including CancellationException, in Result.failure. Controllers label failures REJECTED, so dropped acknowledgements do not reach the ordinary UNKNOWN branch; runtime reconciles only SUCCEEDED. Separate preflight refusal, explicit server rejection and uncertain dispatched completion; rethrow cancellation and reconcile uncertain original-owner state without resend.

**W3 — High: successful whole-target mutations leave clean editor buffers stale.**
- `.../features/git/WorkspaceGitSafety.kt:200-215,219-236`; `.../GitHistoryActionController.kt:152-166,272-286,332-346`.
- Reconciliation excludes HISTORY/TARGETS and loops only event.paths; whole-target actions emit empty paths, so clean tabs never reload. Nested-root open and reconciliation also use raw Git paths instead of the projection already used by the guard. Subsequent saves can reintroduce old content. Use one exact-owner projection for opening/dirty checks/reconciliation, refresh all affected clean tabs/tree for whole-target success, include rename old/new paths, preserve dirty documents/undo.

**W4 — High: dirty-mutation refusal is not full approved Save/Discard/Cancel behavior.**
- `.../features/git/WorkspaceGitSafety.kt:68-104`; `plans/261030-1617-android-focused-git-view/acceptance-matrix.md:33`; `shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/GitWorkspaceSafetyTest.kt:293-337`.
- New refusal safely closes Drop's concrete bypass, but mutation guard has no affected-document prompt/save/discard transaction or revision revalidation. Invalid-path regression covers only a dirty FILES case; translation is skipped entirely when dirty inventory is empty. Complete the specified transaction and add actual production-controller zero-HTTP assertions for Drop/Undo/Reset/Revert/Cherry-pick, TARGETS, retired/hidden owners and nested/rename cases; distinguish safety blocking from complete AC07 fulfillment.

**W5 — High: approved visible navigation and conflict recovery remain disconnected.**
- `.../features/git/GitChangesView.kt:22,72-119`; `.../GitHistoryView.kt:149,177-190`; `.../GitPanelScreen.kt:266-288`; `.../GitBranchesWorktreesView.kt:142-166`; `.../GitQueryRepository.kt:129-155`; `.../GitWorkspaceRuntime.kt:168-170`.
- Changes never invokes onOpenFileDiff. History opens a separate details dialog without the route's diff callback; worktrees have Remove but no Open. Production search finds getConflicts/getOperation only in repository declarations/facade, and recovery-terminal only declaration/implementation. Therefore read-only recovery/blocked controls and intended nested review journeys are not established by these APIs' existence. Wire actual mounted consumers and remove duplicate/dead presentation paths.

**W6 — High: terminal binding still permits stale same-controller effects.**
- `.../ui/screens/ProjectTerminalScreen.kt:179-195,340,529-570,750-800`; `.../features/terminal/TerminalAttachQueue.kt:71-82`.
- Surface epoch remains 1, write-result callbacks lack post-suspension binding admission, and stream checks compare captured repository with itself. Worse, explicitly stale attach paths call controller.failAttach(), affecting a newer attempt; captured replayGeneration is unused. Advance retained binding epochs, compare with the actual installed binding at every effect, and prevent old requests from fencing new replay/input gates.

**W7 — High: editor epoch checks do not fence all completion mutations.**
- `.../features/editor/EditorTabsState.kt:298-344,356-380,486-499,636-670`.
- Load failures/TargetUnavailable mutate state without epoch admission. Save coordinator receives transformTab that mutates retained tabs before the later epoch check; force-overwrite has no equivalent fence. Rejected successful loads can leave loading placeholders. Admit every completion before session/tab mutation; settle or restart retired loading work after rebind.

**W8 — High: device runner cannot keep an authenticated fixture alive.**
- `scripts/run-git-workspace-journeys.sh:144-184`; `scripts/git-workspace-fixture.mjs:937-940,998-1000,1005-1041`.
- Runner waits for finite smoke, whose finally stops proxy/server, then starts instrumentation against stopped ports with AUTH_TOKEN="". --serve is advertised but not implemented. Use runner-owned service lifetime/readiness, protected bearer handoff, exact serial and fresh ports with owned-resource cleanup. Windows blocking is safer than credential mutation but remains a real prerequisite, not a passing fixture.

**W9 — Medium: graph geometry and hot-path work remain problematic.**
- `.../features/git/GitCommitRow.kt:39-45`; `.../GitGraphLane.kt:41-48,73-115`; `.../GitGraphLayout.kt:92,198-202`; `.../GitHistoryView.kt:46-50`.
- Width-only Canvas has no supplied/minimum height inside the Row: zero-height graph risk **[INFERENCE, medium-high confidence; not measured]**; row padding also separates row-clipped ancestry. Layout repeatedly scans all edges per row (quadratic even for linear history) on composition; drawing allocates dash arrays/effects, geometry/Path/Stroke. Establish measured contiguous row geometry, index outgoing edges/materialize segments once, compute changed layouts off-main with ownership admission, cache immutable draw resources. No FPS/memory benchmark claimed.

**W10 — Medium: retained ref and confirmation ownership are incomplete.**
- `.../features/git/GitWorkspaceRuntime.kt:96-104`; `.../GitWorkspaceState.kt:29-45,91-100`; `.../GitChangesView.kt:37,172-184`; `.../GitBranchesWorktreesView.kt:173-185`.
- Refresh unconditionally resets viewed ref to checked-out branch. LazyColumn uses default composition-owned scrolling rather than retained viewport authority. Local discard/delete confirmations are not scope-bound and can submit against a newly selected controller scope; discard invokes success callback immediately even after eventual refusal. Bind presentation and dialogs to exact owner/root/ref/request; invalidate stale dialogs and notify only on actual success.

**W11 — Medium: completion/release evidence still contradicts current source.**
- `plans/261030-1617-android-focused-git-view/plan.md:4,13,23-30,61-63`; `phase-07-live-qualification.md:148-150`; `reports/release-readiness.md:25,39-41,50-54,65-67` (last two paths relative to that plan folder).
- Overview marks everything complete while declaring implementation/evidence future; several phase checklists remain unchecked. Phase07 integrated qualification is checked despite hardware block. Ledger claims only missing adb blocks and all live smoke passes, but current Windows fixture refuses and current runner/production wiring have concrete defects above. Main should reconcile status against exercised evidence and preserve historical provenance; reviewer did not change plan/task tracking.

### Positive observations
- The specific dirty HISTORY/Drop bypass is genuinely removed, not suppressed by a UI-only special case.
- Fallback now reads real dirty document inventory; invalid dirty-path translation fails closed; unrelated FILES dirty-path admission remains tested.
- Explicit host backup/overwrite/restore is removed; native Windows refuses instead of risking production credentials.
- Typed operation scopes and separated local rewrite/exact-lease publication remain appropriate architectural boundaries. Git commands use argument arrays with shell:false.

### Suggestions / prioritized actions
1. Close C1 before running supported-platform fixture variants; use absolute private disposable directories, isolated child configuration and supported-platform admission. Restrict signing files to owner-only permissions (current writeFileSync calls at fixture:905,909 and mkdir at :842 provide no explicit modes; under common umask 022 a publicly traversable evidence parent can expose fixture signing material).
2. Repair lifecycle admission and UNKNOWN outcomes, then clean-buffer reconciliation and full affected-document mutation transaction. Keep the concrete Drop safety improvement; do not regress to blanket empty dirty inventories.
3. Connect mounted routes/conflict guidance/worktree Open; unify state rather than retaining unused parallel stores; correct terminal/editor fencing before claiming safe retained transport cutover.
4. Repair fixture lifetime/credential handoff and add controller-level regressions. Main should run the planned coherent Q1 gate after edits stop, fixture self-test plus safe current-server smoke, six mandatory external smokes, then authenticated emulator/physical ARM64/API29/form-factor journeys. These are recommended checks, not reviewer results.
5. Reconcile docs/plan completion only to actual implementation and exercised qualification. No automatic retries, broad abstraction or extra production dependencies needed.

### Metrics and unresolved evidence
- Critical findings: **1**; high warnings: **8**; medium warnings: **3**. These are review findings, not lint counts.
- Fresh build/test/lint/coverage measurements by reviewer: **none**. No measured type/test coverage or performance percentage.
- Unresolved evidence: safe Linux-relative/macOS child-config resolution, fresh post-fix execution results, controller-level destructive-history negative tests, actual mounted graph sizing, authenticated root journeys and required device/form-factor/security qualification. No unresolved product decision identified.
