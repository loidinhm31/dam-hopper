# Phase 12 — Complete Git and safe history workflows

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 06](./phase-06-adaptive-shell-projects-worktrees-and-config.md), [Phase 10](./phase-10-native-diff-merge-and-blame.md)

## Overview

- Date: 2026-10-15. Priority: P2. Implementation status: **pending**. Review status: **pending**. Progress: **0%**.
- Scope: G01–G03, G02 worktree mutations.
- Goal: Implement all current non-browser Git operations and publication safety through server APIs.
- No implementation performed by this plan. Paths and commands below are future work; evidence must be observed, not inferred.

## Key Insights

- Viewing a local inactive branch is not the same as checked-out branch; operation eligibility differs.
- Local rewrite and remote publication are separate steps with exact-OID leases.

## Requirements

- Roots/branches/history/search/details, stage/unstage/discard/commit and fetch/pull/normal push with progress.
- Branch create/delete/update/checkout, worktree add/remove/prune, history/file variants currently exposed.
- Edit/squash/drop/reset/undo/cherry-pick/revert safeguards, signature-loss consent and separate leased publication.

## Architecture

Qualified GitRepository + operation snapshot/receipt state; UI captures target/root/branch/HEAD and server capability. Mutation results invalidate matching target caches/editor epochs only, never implicit cross-profile batches.

## Related Code Files

Existing references (read/reuse contracts; no server/web modification by default):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/api/git.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/architecture/git-history-search.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/api/router.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/components/pages/GitPage.tsx`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/components/organisms/WorkspaceGitPanel.tsx`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/code-standards.md`

Proposed implementation files (create unless introduced earlier; modify thereafter):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitOperationState.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/HistoryScreens.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/WorktreeMutationController.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/LeasedPublishController.kt`

No deletion of existing web/Tauri hosts or unrelated files. Any necessary backend contract change requires a documented design/compatibility review before code.

## Implementation Steps

1. Build root/branch/history/filter/pagination/commit detail views with literal case-insensitive server history search and qualified selection; distinguish nonGit/unavailable/bare/detached/remote branch contexts.
2. Implement stage/unstage/discard/file/hunk/commit plus fetch/pull/normal fast-forward push; present per-target batch outcomes and current progress without attributing request-level failures to unrelated targets.
3. Implement branch create/delete/update/checkout and exact registered worktree add/remove/prune; precheck live PTY/dirty-tab ownership and preserve server dirty/foreign-worktree guards.
4. Map every current routed history/file action from Phase01 ledger: message edit, contiguous squash, drop/drop-files, cherry-pick/file variants, revert/file variants, reset and undo-last-commit. Do not invent stash/rebase actions with no baseline API.
5. Capture exact operation snapshot; distinguish inactive local branch permitted rewrites from active-only checkout-sensitive actions. Preserve operation-in-progress, checked-out-elsewhere and signature-loss confirmation errors.
6. Implement prepare/publish leased-push UI as separate explicit step tied to receipt target branch and expected local/remote OIDs; stale remote aborts, never force-push or automatic publication.
7. Reconcile qualified editor/tree/blame/history caches after each observed mutation; ambiguous request failure refreshes authoritative state without blindly replaying a mutation.
8. Exercise real disposable multi-root/worktree repositories, active/inactive branches, dirty/untracked files, remote fast-forward races and stale rewrite/lease attempts; compare actual refs/tree/index/files and visible results.

## Todo List

- [ ] Deliver current Git/branch/worktree operation inventory.
- [ ] Implement snapshot/receipt/confirmation and leased publication gates.
- [ ] Verify real repository integrity and cross-profile invalidation.
- [ ] Update requirement/evidence ledger and affected docs after actual runtime proof; record device/server/version limitations.

## Success Criteria

- All baseline routed Git actions are reachable with correct eligibility; no native direct Git execution.
- Stale HEAD/remote/worktree conditions fail safely; inactive rewrites do not alter active index/worktree/untracked files.
- No history rewrite publishes automatically; leased publish uses exact expected OIDs and cannot fall back to force.
- Verification: run changed consumer behavior and record actual output/state; use [execution guide](./execution-guide.md). Compilation/tests alone do not satisfy native-surface acceptance.

## Risk Assessment

- Phone interaction can hide destructive branch context; show explicit target/root/branch and consequences before mutation.
- Server errors may represent partial batch success; retain granular outcomes and refresh before new intent.

## Security Considerations

- Server authorization/ref CAS remains authority; no client role/label trust or silent operation retry.
- Signature loss and destructive filesystem/history intent require deliberate consent and native accessibility.

## Next Steps

Core editor/Git workbench is feature-complete only after regression and Phase18 real-device journeys.

## Unresolved Questions

- Resolve this phase's dependency/device/license/capability decisions in the acceptance ledger before marking done; escalate retained requirements that cannot be met rather than narrowing scope.
