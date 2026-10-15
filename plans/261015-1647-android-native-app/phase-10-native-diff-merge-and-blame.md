# Phase 10 — Native diff merge and blame

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 09](./phase-09-native-editor-language-services-and-safe-saves.md)

## Overview

- Date: 2026-10-15. Priority: P2. Implementation status: **pending**. Review status: **pending**. Progress: **0%**.
- Scope: E03–E04.
- Goal: Reproduce current review/conflict/blame user workflows around native editor surfaces.
- No implementation performed by this plan. Paths and commands below are future work; evidence must be observed, not inferred.

## Key Insights

- A single-buffer editor does not provide Monaco diff/merge behavior automatically.
- Blame/reveal must match current owner, root, model identity/version, edit/repository epochs and buffer fingerprint.

## Requirements

- Editable side-by-side and inline diffs, prev/next hunk, hunk revert and current save/read-only/history gates.
- Theirs/result/ours merge, malformed marker/error UI, targeted accept and resolve with correct undo/dirty behavior.
- Line-change/blame gutters, bounded cache, dirty/EOL projection and exact commit reveal.

## Architecture

Shared review/blame controllers implement deterministic line/model operations and identity; Android widgets draw native gutters/synchronised panes. Reuse existing server diff/blame/resolve routes; no client-side ref rewrite or language server assumed.

## Related Code Files

Existing references (read/reuse contracts; no server/web modification by default):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/components/organisms/DiffViewer.tsx`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/components/organisms/MergeConflictEditor.tsx`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/lib/conflict-parser.ts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/hooks/use-editor-git-blame.ts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/lib/editor-git-blame-cache.ts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/architecture/workbench-files-editor-and-git.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/api/git_blame.rs`

Proposed implementation files (create unless introduced earlier; modify thereafter):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/DiffReviewController.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/MergeConflictController.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/BlameRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/BlameCache.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/CommitRevealRequest.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/NativeReviewSurfaces.kt`

No deletion of existing web/Tauri hosts or unrelated files. Any necessary backend contract change requires a documented design/compatibility review before code.

## Implementation Steps

1. Implement native diff model/layout using existing server original/modified text and a proven diff algorithm; support inline/side-by-side with synchronized geometry and added/deleted/history read-only rules.
2. Implement hunk navigation/revert as precise version-checked model edits with undo/save semantics; no blanket file discard where user requested one hunk.
3. Port conflict region parsing/accept semantics, malformed-marker handling and ours/theirs/result layout adapted to phone/tablet; retain all data/actions rather than deleting panels for small screens.
4. Resolve only through current target-bound route after remaining-conflict checks; observe actual repository index/worktree result and preserve server mutation errors.
5. Implement blame request byte/line bounds, 250ms edit debounce/single-flight behavior and response partition validation; immediately invalidate visible attribution on edits.
6. Implement bounded completed-result cache using SHA256 UTF8 fingerprints and owner/target/root/HEAD/epoch identity; preserve CRLF/lone-CR display alignment and Uncommitted semantics from current contract.
7. Implement native gutter/context/focus interaction and commit-reveal nonce carrying original owner/target/root/OID; ensure-open Git inspection must not discard dirty buffers or accept stale model results.
8. Exercise partial hunk revert, multi-conflict acceptance/undo/malformed markers, dirty/CRLF blame, same-path profiles and delayed stale reveals against real repositories.

## Todo List

- [ ] Deliver editable diff/hunk and three-way merge workflows.
- [ ] Deliver validated/cache-fenced blame and exact commit reveal.
- [ ] Observe real file/index/history outcomes and stale-result rejection.
- [ ] Update requirement/evidence ledger and affected docs after actual runtime proof; record device/server/version limitations.

## Success Criteria

- Hunk and conflict operations modify exactly intended regions; read-only historical/deleted/unavailable contexts cannot mutate.
- Attribution stays aligned and never shows stale committed identity after edits; old reveal cannot select another root/profile.
- Small-screen presentation retains inline/side-by-side capability and all conflict actions, not an unapproved feature reduction.
- Verification: run changed consumer behavior and record actual output/state; use [execution guide](./execution-guide.md). Compilation/tests alone do not satisfy native-surface acceptance.

## Risk Assessment

- Independent text models can drift in scroll/selection/undo; geometry/model identity must be explicit.
- Caching under HEAD alone serves wrong dirty/index/project results; fingerprint and shared invalidation required.

## Security Considerations

- Diff/blame buffers are sensitive; no content/absolute paths in logs or generic telemetry.
- No direct Git plumbing in APK; server remains authorization/rewrite authority.

## Next Steps

Phase12 integrates review with full Git workflow; Phase18 qualifies current-editor parity excluding only approved browser previews.

## Unresolved Questions

- Resolve this phase's dependency/device/license/capability decisions in the acceptance ledger before marking done; escalate retained requirements that cannot be met rather than narrowing scope.
