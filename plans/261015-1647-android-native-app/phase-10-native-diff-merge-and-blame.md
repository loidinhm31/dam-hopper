---
title: "Phase 10 — Native diff merge and blame"
description: "Native side-by-side and inline diffs, hunk discard mapping, 3-way merge conflict resolution, git blame debouncing/caching, and zero FABs workbench integration."
status: completed
priority: P2
effort: unestimated
branch: feat/android-native-app
tags: [feature, frontend, android, kotlin, compose, git, diff, merge, blame]
created: 2026-10-15
---

# Phase 10 — Native diff merge and blame

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 09](./phase-09-native-editor-language-services-and-safe-saves.md)

## Overview

- Date: 2026-10-15. Completion date: 2026-10-16 09:48:17 +07:00. Priority: P2. Implementation status: **completed (2026-10-16 09:48:17 +07:00)**. Review status: **User approved score 9/10 (Cycle 5 approved)**. Progress: **100%**.
- Scope: E03–E04.
- Goal: Reproduce current review/conflict/blame user workflows around native editor surfaces.
- Deliverables: Native side-by-side and inline diff models, calculator, and engine (DiffModels.kt, DiffCalculator.kt, LcsDiffEngine.kt, DiffReviewController.kt), editable modified draft with baseline mtime CAS safe saves (saveModified), hunk discard/revert mapping, 3-way merge conflict parser and controller (MergeConflictModels.kt, ConflictParser.kt, MergeConflictController.kt) supporting standard 2-way and 3-way diff3 markers, granular chunk resolution (accept ours, accept theirs, accept base, accept both), custom manual edits, malformed marker handling, /api/git/resolve-conflict CAS resolution and resetBufferState; Git blame engine, validator, and SHA-256 fingerprint LRU cache (BlameModels.kt, BlameRepository.kt, BlameCache.kt, BlameValidator.kt) with 250ms debouncing, partition validation, and commit reveal routing; UI screens (DiffReviewScreen.kt, DiffRowItem.kt, MergeConflictScreen.kt, EditorBlameGutter.kt, WorkbenchScreen.kt) with zero FABs integrated into authoritative 12-panel workbench.

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

- [x] Deliver editable diff/hunk and three-way merge workflows (`DiffModels.kt`, `DiffCalculator.kt`, `LcsDiffEngine.kt`, `DiffReviewController.kt`, `MergeConflictModels.kt`, `ConflictParser.kt`, `MergeConflictController.kt`, `DiffReviewScreen.kt`, `DiffRowItem.kt`, `MergeConflictScreen.kt`).
- [x] Deliver validated/cache-fenced blame and exact commit reveal (`BlameModels.kt`, `BlameRepository.kt`, `BlameCache.kt`, `BlameValidator.kt`, `EditorBlameGutter.kt`, `CommitRevealRequest.kt`).
- [x] Observe real file/index/history outcomes and stale-result rejection (Fenced sequence counters `loadDiffSeq` / `loadConflictsSeq`, baseline mtime CAS conflict check on `saveModified`, `resetBufferState()` on file change, and SHA-256 buffer fingerprint cache invalidation).
- [x] Update requirement/evidence ledger and affected docs after actual runtime proof; record device/server/version limitations (User approved score 9/10; 246 unit tests and 531 static assertions passed; documented in `docs/architecture/workbench-files-editor-and-git.md`, `docs/android-native-acceptance.md`, and roadmap).

## Phase 10 Completion Record (2026-10-16 09:48:17 +07:00)

- **Completed:** 2026-10-16 09:48:17 +07:00
- **Status:** 100% complete
- **Validation:** User approved score 9/10 (Cycle 5 code review approved, score 9/10 per `plans/reports/code-reviewer-261016-1030-phase-10-cycle-5.md`; all critical items resolved, zero critical findings; verified with QA report `plans/reports/qa-261016-0917-phase-10-cycle-2-verification.md`). 100% automated test pass rate across 246 unit test executions (168 in `:shared:jvmTest`, 39 in `:androidApp:testDebugUnitTest`, 39 in `:androidApp:testReleaseUnitTest`) and 531 static invariant assertions across 9 shell test suites (`tests/test-phase-10-diff-merge-blame.sh` [77], `test-phase-09-editor-saves.sh` [70], `test-phase-08-filesystem-watchers.sh` [57], `test-phase-07-terminal-agents.sh` [45], `test-phase-06-shell-workspace.sh` [64], `test-phase-05-proof-gates.sh` [66], `test-phase-04-profiles-auth.sh` [57], `test-phase-03-transport.sh` [48], `test-phase-02-foundation.sh` [47]). Clean `assembleDebug` APK build.
- **Deliverables:**
  - **Native Diff Models & Engine (`DiffModels.kt`, `DiffCalculator.kt`, `LcsDiffEngine.kt`, `DiffReviewController.kt`):** Side-by-side and inline diff models, hunk grouping/navigation, hunk discard/revert mapping, read-only past commit diff inspection, editable working-tree modified buffer with baseline mtime CAS safe saves (`saveModified`), and exit commit diff navigation.
  - **3-Way Merge Conflict Resolution (`MergeConflictModels.kt`, `ConflictParser.kt`, `MergeConflictController.kt`):** Standard 2-way and 3-way `diff3` marker parsing (`<<<<<<<`, `|||||||`, `=======`, `>>>>>>>`), granular conflict chunk resolution (accept ours, accept theirs, accept base, accept both), custom edits with undo, malformed marker error presentation, atomic conflict CAS save and mark-resolved endpoint integration (`/api/git/resolve-conflict`), and safe buffer reset (`resetBufferState()`).
  - **Git Blame Engine & Cache (`BlameModels.kt`, `BlameRepository.kt`, `BlameCache.kt`, `BlameValidator.kt`):** 250ms debounced single-flight queries, SHA-256 UTF-8 buffer fingerprint caching, partition gap/overlap validation, commit index bounds check, instant invalidation on local edits, and exact commit reveal nonce carrying profile/project/root/commit OID.
  - **Native UI Surfaces (`DiffReviewScreen.kt`, `DiffRowItem.kt`, `MergeConflictScreen.kt`, `EditorBlameGutter.kt`, `WorkbenchScreen.kt`):** Side-by-side & inline diff viewer, hunk navigation bar, exit commit diff action, merge conflict multi-file resolver with panel navigation, blame gutter overlay, zero FABs, adhering strictly to single top panel row and adjustResize soft keyboard behavior.
- **Handoff:** Phase 10 completed and verified. Phase 11 (Encrypted transfers media and Android storage) unblocked for next sequence progression and Phase 12 (Complete Git and safe history workflows) unblocked on diff/merge/blame dependency. Physical hardware and live server qualification deferred to Phase 18.

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
