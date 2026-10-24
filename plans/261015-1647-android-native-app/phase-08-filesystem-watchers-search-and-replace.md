# Phase 08 — Filesystem watchers search and replace

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 06](./phase-06-adaptive-shell-projects-worktrees-and-config.md)

## Overview

- Date: 2026-10-15. Completion date: 2026-10-16. Priority: P2. Implementation status: **completed (2026-10-16)**. Review status: **Cycle 2 user approved (6/10) with documented open limitations** (see `plans/reports/code-reviewer-261016-0617-phase-08-cycle-2-filesystem-watchers.md`; open limitations: H1 lossy UTF-8 replace, H2 root-only watch & reconnect rebind, H3 timeout-as-cancellation, H4 secondary-profile target, H5 dirty gate pending Phase 09, H6 outcome UI, H7 behavioral tests). Progress: **100%** (implementation & automated test gates complete; runtime device qualification deferred to Phase 18).
- Scope: F01–F02.
- Goal: Deliver native file navigation/mutation and qualified search over current filesystem contracts.
- No implementation performed by this plan. Paths and commands below are future work; evidence must be observed, not inferred.

## Key Insights

- The owner transport that created a subscription also owns event handling and unsubscribe.
- Federated result labels need original target identity; equal paths across servers are different resources.

## Requirements

- Lazy tree/list/stat, file/directory create/rename/move/delete, hidden-file/current decorations and bounded error isolation.
- Qualified watcher events/overflow/rebind, filename/content search and current safe replace behavior.
- Explicit limits/truncation, inaccessible/symlink/binary/large-file states; no filesystem sandbox duplication on Android.

## Architecture

FileRepository and SearchRepository receive explicit target/owner; shared immutable tree/search state retains scoped subscriptions and request epochs. Editor opening delegates to a qualified resource route, not ambient selection.

## Related Code Files

Existing references (read/reuse contracts; no server/web modification by default):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/architecture/workbench-files-editor-and-git.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/api/filesystem-and-media.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/api/fs.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/api/ws_protocol.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/components/organisms/FileTree.tsx`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/api/ws-transport.ts`

Proposed implementation files (create unless introduced earlier; modify thereafter):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeState.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/SearchRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileScreens.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/ReplaceCoordinator.kt`

No deletion of existing web/Tauri hosts or unrelated files. Any necessary backend contract change requires a documented design/compatibility review before code.

## Implementation Steps

1. Implement list/stat/read metadata and lazy tree expansion keyed by profile/project/worktree; map server path/permission/missing/binary outcomes explicitly.
2. Implement current fs:op CRUD/move/rename/delete wire contract and destructive intent, without treating remote server paths as Android filesystem paths.
3. Implement subscription response/event matching, overflow/refetch and watchOnly where needed; serialise rebind/cleanup with exact original transport/sub_id and discard stale responses.
4. Implement content/name search, per-target cancellation, case/max/scope options and all-connected-profiles federation with owner metadata and 500-match cap/truncation warnings.
5. Implement safe result navigation and current replace preview/apply behavior by enumerated target files. Use expected revision/mtime and per-file partial-failure results; do not create a new server replace endpoint.
6. Invalidate only matching tree/search/editor/Git resources after mutations; isolate a tree failure so terminals and other panels stay usable.
7. Exercise multi-profile equal paths, removed/recreated worktree, delayed subscribe completion, watcher overflow, rename/move across loaded folders, interrupted replace and concurrent remote edits.

## Todo List

- [x] Implement native tree/CRUD and watch lifecycle (`FileRepository.kt`, `FileTreeState.kt`, `FileTreeSubscription.kt`, `FileMutationCoordinator.kt`, `FsWriteCoordinator.kt`).
- [x] Implement qualified search/federation/replace (`SearchRepository.kt`, `FederatedSearchCoordinator.kt`, `ReplaceCoordinator.kt`, `FileScreens.kt`).
- [x] Prove stale-owner and concurrent-mutation safety on host (mutex-serialized mutations, generation-fenced subscription manager, fail-closed truncation checks; behavioral WS mock & runtime device proof open under Phase 18).
- [x] Update requirement/evidence ledger and affected docs after automated proof; record device/server/version limitations (H1–H7 open limitations recorded in ledger; physical device runtime proof deferred to Phase 18).

## Completion Summary (2026-10-16)

- **Status:** Host implementation completed and verified by automated test suites (100% pass); user authorized marking Phase 08 DONE with documented open limitations (technical review: CHANGES REQUESTED 6/10); Phase 09 unblocked.
- **Automated Validation:**
  - Unit tests: 194 executions passed (116 in `:shared:jvmTest`, 39 in `:androidApp:testDebugUnitTest`, 39 in `:androidApp:testReleaseUnitTest`).
  - Static assertions: 384 passed across 7 suites (`tests/test-phase-08-filesystem-watchers.sh` [57], `test-phase-07-terminal-agents.sh` [45], `test-phase-06-shell-workspace.sh` [64], `test-phase-05-proof-gates.sh` [66], `test-phase-04-profiles-auth.sh` [57], `test-phase-03-transport.sh` [48], `test-phase-02-foundation.sh` [47]).
  - Build: `:androidApp:assembleDebug` completed successfully (65 tasks).
- **Documented Open Limitations:**
  - H1: Lossy UTF-8 decode in `FileRepository.readFile` for invalid UTF-8 sequences past 8 KiB boundary; needs strict decode / binary classification to avoid silent replacement corruption.
  - H2: Server watcher is non-recursive; live events only cover root directory (`path=""`). Expanded subfolder updates rely on client re-fetch upon expand. Socket reconnect rebind requires identity trigger on `Connected(socketRef)`.
  - H3: `TimeoutCancellationException` from `withTimeout` treated as `CancellationException`, which can abort entire batch replace and hide per-file outcomes; requires distinguishing timeout failure from parent scope cancellation.
  - H4: Multi-profile federated search target resolution for non-active profiles uses profile display name instead of active project/workspace target.
  - H5: Authoritative dirty-buffer provider interface pending Phase 09 native editor implementation; Replace All currently defaults to `isDirtyFile = { false }`.
  - H6: Partial failures and per-file replace outcomes not surfaced in UI detail cards (currently counts only); file preview cards lack profile/project qualifier when matching identical relative paths across servers.
  - H7: Behavioral tests with mocked WebSocket events (early buffering, reconnection rebind, batch CAS conflicts) to be expanded in downstream qualification.
- **Downstream Impact:** Phase 09 (Native editor language services and safe saves) is unblocked and consumes `FileRepository`, `ReplaceCoordinator`, and qualified file paths. Editor buffer dirty checking will be wired into `ReplaceCoordinator` during Phase 09.

## Success Criteria

- Search/file actions always reach captured target; stale watchers never update another target or release replacement subscriptions.
- Replacement reports exact changed/conflicted/failed files and preserves unsaved/remote newer content.
- Tree failures/overflow surface explicit state without tearing down live terminal sessions.
- Verification: run changed consumer behavior and record actual output/state; use [execution guide](./execution-guide.md). Compilation/tests alone do not satisfy native-surface acceptance.

## Risk Assessment

- Source docs may present watcher fields in different casing; actual serde/TS request shape wins.
- Bulk replace is not necessarily atomic; disclose partial completion instead of synthetic all-success.

## Security Considerations

- Server sandbox remains authority; never follow arbitrary user-returned local paths on Android.
- No file-body/search-context diagnostics or implicit force_git/destructive bypass.

## Next Steps

Phase09 consumes qualified reads/replace/open intents; Phase11 completes upload/download/media.

## Unresolved Questions

- Resolve this phase's dependency/device/license/capability decisions in the acceptance ledger before marking done; escalate retained requirements that cannot be met rather than narrowing scope.
