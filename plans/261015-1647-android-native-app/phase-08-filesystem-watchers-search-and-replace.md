# Phase 08 — Filesystem watchers search and replace

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 06](./phase-06-adaptive-shell-projects-worktrees-and-config.md)

## Overview

- Date: 2026-10-15. Priority: P2. Implementation status: **pending**. Review status: **pending**. Progress: **0%**.
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

- [ ] Implement native tree/CRUD and watch lifecycle.
- [ ] Implement qualified search/federation/replace.
- [ ] Prove stale-owner and concurrent-mutation safety.
- [ ] Update requirement/evidence ledger and affected docs after actual runtime proof; record device/server/version limitations.

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
