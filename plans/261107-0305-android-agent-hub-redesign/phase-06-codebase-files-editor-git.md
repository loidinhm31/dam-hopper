# P06 — Adapt nested codebase surfaces and canonical documents

## Context links
[Overview](plan.md) | [Binding C1–C10](architecture-contracts.md) | [Ownership/transfers](execution-ownership.md) | [Acceptance matrix](acceptance-matrix.md) | [reports/api-compatibility-evidence.md](reports/api-compatibility-evidence.md) | [reports/android-evidence.md](reports/android-evidence.md) | [reports/android-ui-ux-design.md](reports/android-ui-ux-design.md)

## Overview
- Priority: P1 (safety-critical cutover); status: pending; effort: 24h.
- Owner: Feature06-Codebase. Parallelization group: `G-A`.
- Prerequisite task IDs: `cutover-settings-patches`
- Authoring only. No product execution approved; no build/lint/tests/formatter while authoring or feature writers are active.

## Key evidence
Workspace tree/project marks alter Android-compatible codebase browsing, not just transport. Current FileOwner strips leading slash while ProjectTargetRef preserves it; P02 must remove this inconsistency. Same file via workspace/project/worktree routes must not create competing dirty buffers. Existing Git Changes/History/Branches/Worktrees, CAS and leased publication are already focused features; full conflict resolver/TS engine are out of scope.

## Requirements
Functional: nested Files/Editor/Git in one Hub content host, explicit whole-workspace vs registered-project browse, guarded mark/unmark and project-only Git. File opens switch to Editor with one canonical document across route aliases. Preserve dirty content, native undo, tree expansion/scroll, watcher bounds, CAS, binary/large/media/OPAQUE behavior and read-only conflict handoff.
Nonfunctional: route target and tab incarnation separate from canonical identity; owner endpoint/account/workspace epoch fences never guessed. Reconnect/retirement withdraws save authority without clearing in-memory dirty documents; process death does not promise draft/undo recovery. No WebView, TS engine, full resolver, second content pane or simultaneous Projects+Files rails.

## Architecture and ports
ProjectWorkspaceScreen remains single stage host; P03 provides chrome, this slice provides capability content/Files rail requests. Workspace folder without registered project may browse/edit only authorized target and cannot send Git actions. Mark/unmark invokes settled P02 repository, refreshes registration and preserves canonical document ownership; unmark does not delete files or terminate PTYs.
Existing retained owner owns the canonical holder/map and native document lifetime, keyed by (profileId, endpoint, account, workspaceId, workspaceEpoch, canonicalPath). EditorTabsState/EditorSession aliases hold explicit leases, not disposal authority. P06 proves injected shared-owner factories locally; P07 supplies actual retained cross-workspace scope, not a new registry/runtime. Tab/workspace close releases only its own lease/listeners/exact view. Final dirty alias close runs existing save/discard/cancel guard, retaining accessible original on cancel/failure/busy. Owner retires token then disposes exactly once only with zero aliases, zero active view leases, zero dirty retention and zero in-flight snapshots/saves. Retirement revokes authority immediately but keeps dirty/undo recoverable in process, never promises process-death recovery. Reload/discard/tier replacement is a canonical captured-owner/revision transaction, blocked/busy during save; dirty consent then revalidate, publish one successor to all aliases and rotate every incarnation atomically; failure/staleness preserves original. One active native view per holder, exact widget+lease receipts prevent late old detach from unsubscribing successor, overwriting its view state, disabling current input or disposing document. Old widget cleans only its own resources. Git dirty guards query these canonical holders, not route-local sessions.

## Related files and ownership
Absolute source mapping: every project-relative literal below resolves under `G:/ws/sharing/dam-hopper/`; these are full source paths by that mapping. Runtime report paths listed Create are future evidence artifacts, not files authored during planning. No directory ownership or globs.
### Create (new files; not existing source)
- None.

### Modify (existing files)
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectWorkspaceScreen.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkspaceSearchView.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceScreens.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileScreens.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FilesTopBar.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeItemView.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeState.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileActionDialogs.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileItemActionsModal.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileModalsHost.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinator.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileTreeStateTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinatorTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceStateTest.kt`
- `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/FileScreensPhase08Test.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsState.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepository.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorContentLoader.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabSaveCoordinator.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorSession.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorScreens.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/SaveConflictDialog.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/MediaPreviewCard.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileWatchCoordinator.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorDocument.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurface.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsStateTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorSaveRaceTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorSessionTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepositoryTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileEditorMutationTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileWatchCoordinatorTest.kt`
- `native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorDocumentTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/TestEditorDocument.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/WorkspaceGitSafety.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitWorkspaceRuntime.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitOperationScope.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitWorkspaceState.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitPanelScreen.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitChangesView.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryView.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/WorktreeMutationController.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/DiffReviewScreen.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/GitWorkspaceSafetyTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitFocusedIntegrationTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitWorkspaceNavigationTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitSyncWorktreeSafetyTest.kt`

### Create (coordinator-only completion receipts after stopped task/wave)
- `plans/261107-0305-android-agent-hub-redesign/reports/present-codebase-browser-completion.md`
- `plans/261107-0305-android-agent-hub-redesign/reports/present-codebase-browser-evidence.json`
- `plans/261107-0305-android-agent-hub-redesign/reports/retain-canonical-documents-completion.md`
- `plans/261107-0305-android-agent-hub-redesign/reports/retain-canonical-documents-evidence.json`
- `plans/261107-0305-android-agent-hub-redesign/reports/preserve-focused-git-safety-completion.md`
- `plans/261107-0305-android-agent-hub-redesign/reports/preserve-focused-git-safety-evidence.json`

### Delete
- No whole-file deletions. Remove obsolete replaced methods/callers/navigation assertions inside the modified files; unrelated dormant feature code stays.

### Conflict and transfer rules
The task fences below are exhaustive writable authority. Within this phase, steps execute by their task dependencies. Shared sequential paths transfer `Contract01 -> Api02 -> owning Feature03/04/05/06 -> Integration07 -> Qualification08/docs` only where declared. G-A may read other slices but cannot write their files, common root, shared DTOs or ports. Any missing writable caller blocks the affected task until coordinator deliberately revises that task and reruns structural validation; no compatibility shim or unsanctioned edit. Ownership transfers only after predecessor stopped-wave checks, independent review and evidence-backed completion. Per-task report/evidence grants are coordinator-only after the worker stops. Exact per-path chain: [execution-ownership.md](execution-ownership.md).

## Numbered implementation steps by stable task ID
### present-codebase-browser
1. Add explicit whole-workspace/registered-project browsing selection using P02 target union; show configured/unconfigured/unavailable/unsupported errors. No stripped absolute worktree path, project fallback or discovery authority.
2. Offer mark/unmark for eligible folders through guarded API; explain registration change versus deletion. Refresh projects/tree after confirmed success only, preserve route identity and dirty buffers on unknown/refused result.
3. File selection resolves canonical identity, opens/focuses Editor through existing state and exposes only one rail request. Workspace browsing must not offer Git until a registered project is explicitly selected.
4. Preserve tree state/watch bounds, search/replace and file mutation confirmations. Author whole-workspace vs project target, nested registration, unmark-preserves-file and no-Git-on-unmarked cases; no root wiring edits.
5. Adapt ProjectWorkspaceState.close to release only workspace-owned alias/view leases through P02 ports; never close another workspace/project alias native holder. Preserve existing final-dirty guard and reachable retained recovery state. Hand this bounded browser-state change to retain-canonical-documents after W05 checks.

### retain-canonical-documents
1. Resolve document key only from authorized server FileIdentity plus profile/endpoint/account; no lowercasing canonical path, slash stripping or string-concatenated pseudo identity. Keep access route and tab incarnation distinct.
2. Use existing retained-owner holder/factory from P01/P02 for explicit alias/session leases and one native undo chain. EditorSession.close/EditorTabsState.close/reload and ProjectWorkspaceState.close release only their own lease/listeners/exact widget; another alias/dirty retention/in-flight snapshot keeps native holder alive. Only owner retires/disposes exactly once after every alias/view/dirty/save count is zero. Shared schemas/ports remain read-only; P07 supplies final cross-workspace retained-owner injection, not a new runtime.
3. Save uses original baseline identity/mtime/CAS and current owner/socket/workspace authority. Reconnect/retirement revokes authority synchronously but retains in-memory dirty/undo; exact fresh authorized identity permits explicit rebind, mismatched account/endpoint/epoch never auto-adopts.
4. Final dirty alias close runs canonical save/discard/cancel guard: save awaits captured snapshot and rechecks intervening edits, cancel/failure/busy leaves original reachable, discard is explicit. Reload/discard/tier replacement captures canonical revision/owner, is busy during in-flight saves/snapshots, requires dirty consent then revalidation, publishes successor to every alias and rotates all incarnation guards atomically; no partial replacement or alias-local close. Failed/stale transaction retains original dirty/native undo. Preserve CAS/bounds/invalid UTF-8/media/OPAQUE tiers.
5. AndroidEditorDocument/Surface enforce one active native view and exact widget+lease token. Late old detach cannot unsubscribe successor receipt, overwrite current view state, disable current input or dispose document; cleanup stays on old widget. Author native/JVM regressions: edit A/open B/close A tab and workspace/B undo+save, reverse order, final dirty save/discard/cancel, close/reload while save in flight, all-alias tier replacement and late old detach; retain cross-account/server/epoch and stale completion assertions. Task-local smoke uses actual native component/shared factories now; final MainActivity assertions belong P07/P08.

### preserve-focused-git-safety
1. Gate Git entry/actions to exact registered project/worktree and existing VcsRoot; whole workspace/unmarked folder shows explanatory disabled state, no implicit project/root.
2. Keep Changes, OID DAG History, Branches/Worktrees and nested read-only diffs; preserve secondary-root fetch/pull disablement, CAS inactive rewrites and explicitly leased publication.
3. Query retained canonical dirty docs and live/hidden/restartPending/unknown terminal intent counts before worktree switch/remove. Guard before target-store mutation, revalidate scope after consent; no success invalidation on failed mutation.
4. Keep conflicts/stopped operations read-only Terminal/web CLI handoff; do not enable full conflict resolver, POST resolve/operation or TS engine. Author stale owner, dirty alias, wrong-root, unknown mutation and nested Back regressions.

## Durable task contract
```evcrate-tasks
[
  {
    "id": "present-codebase-browser",
    "title": "Integrate workspace/project browsing and mark/unmark surfaces",
    "blocked_by": [
      "cutover-settings-patches"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectWorkspaceScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkspaceSearchView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceScreens.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileScreens.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FilesTopBar.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeItemView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileActionDialogs.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileItemActionsModal.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileModalsHost.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinator.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileTreeStateTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinatorTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceStateTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/FileScreensPhase08Test.kt",
      "plans/261107-0305-android-agent-hub-redesign/reports/present-codebase-browser-completion.md",
      "plans/261107-0305-android-agent-hub-redesign/reports/present-codebase-browser-evidence.json"
    ],
    "constraints": [
      "Stay within this literal allowlist; escalate additional writes to integration owner before editing.",
      "Implementer authors tests but runs no checks. After every writer in this selected coherent wave stops, coordinator runs applicable compile, focused regressions, separate meaningful task-local smoke and independent review before evidence-backed completion or successor admission; no sibling-edit checks, no defer-to-P08 completion."
    ],
    "acceptance": [
      "User can browse authorized workspace or project, mark/unmark without OS adoption, and open the same content safely.",
      "No project registration means no Git request; unmark never deletes content/PTys or resets dirty documents."
    ],
    "verification": [
      "At this task/wave stop barrier, coordinator runs applicable existing Gradle shared/app compilation and focused owned regression classes from acceptance-matrix command timing; record exact command, exit and assertions. No dependent future root/release work is required for this task's acceptance.",
      "Use actual current browser component with owned server workspace/project: browse, mark/unmark and open file; observe requests/tree changes and zero Git dispatch on unmarked target. No future shared Hub root or alias lifetime wiring required.",
      "Collect terminal implementation and passing independent review after stopped-wave checks; write exact results and reviewer provenance to plans/261107-0305-android-agent-hub-redesign/reports/present-codebase-browser-completion.md and current helper-schema evidence to plans/261107-0305-android-agent-hub-redesign/reports/present-codebase-browser-evidence.json. Smoke/review cannot be waived; failed or missing gates block completion. P08 separately repeats full integrated/live/device release suites."
    ]
  },
  {
    "id": "retain-canonical-documents",
    "title": "Unify aliases while preserving dirty buffers and undo",
    "blocked_by": [
      "present-hub-navigator",
      "present-settings-scopes",
      "present-bounded-attention-feed",
      "present-codebase-browser"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceStateTest.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorContentLoader.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabSaveCoordinator.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorSession.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorScreens.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/SaveConflictDialog.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/MediaPreviewCard.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileWatchCoordinator.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorDocument.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurface.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsStateTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorSaveRaceTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorSessionTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepositoryTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileEditorMutationTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileWatchCoordinatorTest.kt",
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorDocumentTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/TestEditorDocument.kt",
      "plans/261107-0305-android-agent-hub-redesign/reports/retain-canonical-documents-completion.md",
      "plans/261107-0305-android-agent-hub-redesign/reports/retain-canonical-documents-evidence.json"
    ],
    "constraints": [
      "Stay within this literal allowlist; escalate additional writes to integration owner before editing.",
      "Implementer authors tests but runs no checks. After every writer in this selected coherent wave stops, coordinator runs applicable compile, focused regressions, separate meaningful task-local smoke and independent review before evidence-backed completion or successor admission; no sibling-edit checks, no defer-to-P08 completion."
    ],
    "acceptance": [
      "One logical file has one dirty native buffer/undo chain across workspace/project/worktree aliases in the same owner.",
      "Different endpoint/account/workspace epoch never shares authority; retirement retains in-memory draft but disables stale saves.",
      "Alias/tab/workspace close preserves surviving alias undo/save; final dirty choices stay reachable; close/reload is busy during save; canonical tier replacement updates all aliases atomically; late old-view detach cannot damage successor. CAS failures preserve original."
    ],
    "verification": [
      "At this task/wave stop barrier, coordinator runs applicable existing Gradle shared/app compilation and focused owned regression classes from acceptance-matrix command timing; record exact command, exit and assertions. No dependent future root/release work is required for this task's acceptance.",
      "Mount actual native editor component with two EditorTabsState factories sharing the existing retained-owner contract: edit A/open B/close A tab and workspace/B undo+save, reverse order; exercise final dirty save/discard/cancel, close/reload during save, all-alias tier replacement and late old-view detach. Observe real buffer/undo/input/disposal and request bytes, not mocks alone; no future MainActivity wiring required.",
      "Collect terminal implementation and passing independent review after stopped-wave checks; write exact results and reviewer provenance to plans/261107-0305-android-agent-hub-redesign/reports/retain-canonical-documents-completion.md and current helper-schema evidence to plans/261107-0305-android-agent-hub-redesign/reports/retain-canonical-documents-evidence.json. Smoke/review cannot be waived; failed or missing gates block completion. P08 separately repeats full integrated/live/device release suites."
    ]
  },
  {
    "id": "preserve-focused-git-safety",
    "title": "Preserve project-only focused Git and cross-alias dirty guards",
    "blocked_by": [
      "present-terminal-lifetime",
      "preserve-settings-documents",
      "preserve-private-platform-delivery",
      "retain-canonical-documents"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/WorkspaceGitSafety.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitWorkspaceRuntime.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitOperationScope.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitWorkspaceState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitPanelScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitChangesView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/WorktreeMutationController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/DiffReviewScreen.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/GitWorkspaceSafetyTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitFocusedIntegrationTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitWorkspaceNavigationTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitSyncWorktreeSafetyTest.kt",
      "plans/261107-0305-android-agent-hub-redesign/reports/preserve-focused-git-safety-completion.md",
      "plans/261107-0305-android-agent-hub-redesign/reports/preserve-focused-git-safety-evidence.json"
    ],
    "constraints": [
      "Stay within this literal allowlist; escalate additional writes to integration owner before editing.",
      "Implementer authors tests but runs no checks. After every writer in this selected coherent wave stops, coordinator runs applicable compile, focused regressions, separate meaningful task-local smoke and independent review before evidence-backed completion or successor admission; no sibling-edit checks, no defer-to-P08 completion."
    ],
    "acceptance": [
      "Existing focused Git workflows remain available only for a registered exact project target.",
      "Dirty alias documents and qualified terminal state block unsafe worktree transitions; leased push/CAS and read-only conflict handoff preserved."
    ],
    "verification": [
      "At this task/wave stop barrier, coordinator runs applicable existing Gradle shared/app compilation and focused owned regression classes from acceptance-matrix command timing; record exact command, exit and assertions. No dependent future root/release work is required for this task's acceptance.",
      "Use actual focused Git component/current host with owned disposable repo and existing current-server Git oracle; demonstrate dirty-alias/unknown-PTY block and CAS/lease refusal with real repository state. No future MainActivity root required.",
      "Collect terminal implementation and passing independent review after stopped-wave checks; write exact results and reviewer provenance to plans/261107-0305-android-agent-hub-redesign/reports/preserve-focused-git-safety-completion.md and current helper-schema evidence to plans/261107-0305-android-agent-hub-redesign/reports/preserve-focused-git-safety-evidence.json. Smoke/review cannot be waived; failed or missing gates block completion. P08 separately repeats full integrated/live/device release suites."
    ]
  }
]
```

- [ ] <!-- evcrate-task:present-codebase-browser --> Integrate workspace/project browsing and mark/unmark surfaces
- [ ] <!-- evcrate-task:retain-canonical-documents --> Unify aliases while preserving dirty buffers and undo
- [ ] <!-- evcrate-task:preserve-focused-git-safety --> Preserve project-only focused Git and cross-alias dirty guards

## Behavior acceptance and qualification
Each task's acceptance/verification arrays are binding at its own stopped coherent-wave completion barrier; the coordinator runs applicable compile, focused regressions, separate meaningful task-local smoke and independent review before helper evidence-backed completion and dependent admission. Implementers run no checks, and no coordinator checks occur while any sibling writer edits. P01–P06 prove component/provider behavior through settled ports, not unimplemented future MainActivity/release wiring; P07 proves its focused active-root/lifetime behavior sequentially. P08 alone repeats full integrated/live/device/human release suites. Tests alone are not smoke. Missing required runtime/device prerequisites block the affected gate; source-only authoring cannot claim runtime success. Record failures/skips/blockers distinctly; no fabricated pass or waiver.

## Risks, privacy, security, failure and rollback
Risk: lookup deduplication alone does not fix session-owned native disposal. P02 ports/callers, P06 actual shared-factory lease/native smoke and P07 retained-owner wiring are separate completed deliverables; P08 proves full MainActivity aliases. Privacy: memory-only buffers and scoped media. Failure/rollback preserves original dirty/undo and recoverable retained state; withdraw root routes before reversing leaf changes, never dispose another alias or mutate registration as rollback.

## Downstream barrier
present-codebase-browser completes with W05; retain-canonical-documents waits for all W05 tasks and completes with stopped W06; preserve-focused-git-safety waits for all W06 completions and stops/checks/completes alone at W07. P07 starts only after all feature tasks evidence-backed complete. G-A excludes root/ViewModel/Activity/shared DTOs/ports/theme/terminal presentation. Local factory/native smoke must pass before downstream integration, not depend on P07/P08.

## Unresolved questions
None for product design. User confirmed adaptive navigator and all already-connected profiles; no saved-profile auto-connect/keepalive. [Final validation](reports/final-plan-validation.md) preserves C1-C10, task contracts and ownership unchanged. Device/WS/auth/crypto-fixture checks remain explicit implementation gates, not observed passes.
