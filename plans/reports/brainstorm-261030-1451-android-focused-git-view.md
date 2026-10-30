# Android Focused Git View — Approved Design

Status: **approved**. User explicitly selected “Approve specific-project design” after clarification that Git belongs to one project's workspace, not a profile-wide page.
Planning consent: **explicitly deferred by user**. Central plan router not invoked; no plan created. Implementation: not authorized by this brainstorm.

## Problem and final artifact

Expose a usable native Git destination in the active Android project workspace, comparable in behavior—not desktop layout—to web Git. Reuse existing Kotlin/Compose Git code and current server APIs.

This brainstorm produces this decision-ready design report. A later authorized implementation delivers Terminal / Files / Editor / **Git**, with Changes, History, Branches/Worktrees, native commit graph, nested details/diff review, daily Git actions, safe rewrites, and explicit leased publication.

## Agreed requirements and constraints

- User selected focused-project Git, safe history rewrites, worktree management, and required commit graph.
- **No new endpoints, wire fields, server changes, or server deployment prerequisite.** Adapt Android to current contracts.
- Preserve native Kotlin Multiplatform/Compose architecture, Android API 29+, existing authentication/TLS and profile/generation ownership. No React embedding, WebView Git, local Git, or local repositories.
- Work remains remote and online-authoritative. No queued/replayed offline mutations or automatic retry after an uncertain mutation result.
- No timeline or staffing constraint supplied; do not infer one. Existing implementation is not proof of release readiness.

In scope: one selected project/worktree, VCS-root discovery/selection, status, staged/unstaged/untracked files, stage/unstage, file discard, commit/amend, history/search/details/file diffs, branches, fetch/pull/push, message editing/squash, applicable existing history actions, leased publication, worktree discovery/create/open/remove/prune.

Out of scope: standalone multi-project Git, bulk orchestration UI, all-disconnected-branches graph, native conflict editing or operation continue/abort UI, editor-blame parity, editable diff drafts, framework/server/API redesign.

## Options and decision rationale

| Approach | Benefit | Cost/risk | Decision |
| --- | --- | --- | --- |
| Integrate and harden existing Compose Git in retained focused workspace | Reuses native UI/domain code and existing lifecycle; limits navigation impact | Requires correctness repairs, graph rendering, worktree routing | **Recommended** |
| Mount dormant 12-panel Workbench shell | Existing Git/diff wiring | Broad shell cutover; competing retained editor/terminal lifecycles; exposes unrelated surfaces | Reject for this scope |
| Build replacement native Git feature | Fresh UX with no dormant-shell coupling | Duplicates repositories, guards, dialogs and controllers; highest maintenance | Reject; adapt existing components |

Do not copy React components. Share API and behavior contracts; Kotlin and TypeScript remain separate clients. No new dependency is currently justified for the native graph.

## UX and behavior

### Workspace and target context

- Add Git to the existing workspace tab row. Preserve terminal sessions, editor documents/undo, file tree, and Git section/scroll state across tab changes and Activity recreation.
- Git toolbar shows project, selected worktree, VCS root, checked-out branch and viewed history ref; those identities must not be conflated.
- Git follows the **active workspace worktree**, unlike the web workspace panel's configured-root anchoring. Opening another worktree switches the whole workspace target, not Git alone. A root selector changes Git's nested repository, not the workspace target.
- Add a manual worktree switch through existing navigation/departure-guard conventions. Validate discovery again after any dirty-document prompt; update flow and target-store selection consistently. Do not repurpose a notification route or move/kill an old PTY.
- New terminal sessions use the selected target; old sessions remain owned by their original target. Missing targets show unavailable state, never silently redirect a pending action to the configured root.
- Diff/details are nested Git routes. Back closes dialogs, then diff/details, before normal workspace departure. Tab switching preserves Git navigation state without leaving hidden terminal/editor input active.

### Changes and diffs

- Reuse staged/unstaged/untracked sections and existing stage/unstage, discard, commit/amend controls. Use explicit confirmations for destructive actions and explain disk/index versus unsaved-editor content.
- Review diffs read-only; Open in Editor uses the retained editor as the only editable-buffer authority. No second diff draft/save pipeline or hunk-discard UI in this design.
- Historical diffs stay read-only. Binary, deleted, empty and unavailable files have explicit states.
- Keep Git requests root-relative; translate nested-root file paths to workspace-relative paths for editor opening and dirty-buffer checks. Never write historical content into an editor buffer implicitly.

### History and graph

- Reuse history queries and commit details; add a pure Kotlin graph layout with Compose Canvas rows in the existing lazy list. Compute layout per changed dataset, not per draw/scroll frame. Use OIDs, ordered `parents`, and `refs`; do not infer edges from list adjacency.
- Unfiltered history shows graph lanes, merge connections, ref labels, selection and commit metadata. A visible action menu supports touch/accessibility; do not require hover or double-click.
- Filtered literal message search uses a list, as web does: omitted commits must not appear directly connected. Clearing search restores the graph. Debounce typing and fence stale results by request identity, not just project scope.
- Graph covers ancestry returned for the selected ref, not every disconnected branch. Continue unresolved parent lanes at page boundaries; missing/shallow parents are not fabricated commits. Support parents already encountered: server log does not guarantee topological ordering.
- Preserve selected OIDs/viewport on append where possible; deduplicate overlapping pages and reset on observed tip changes. Offset pagination has no server snapshot guarantee; refresh/reload after concurrent history changes rather than claim atomic paging.
- Viewing a branch never checks it out. Use canonical local/remote refs; remote name collisions cannot confer local rewrite eligibility. Detached HEAD remains inspectable.

### Rewrites and publication

- Message editing and squash use agreeing, fresh full-message snapshots and existing `expectedBranch` / `expectedHeadOid` guards. Support eligible active and inactive local branches without changing another branch's checkout/index/files.
- Squash validates actual single-parent chain OIDs and exact oldest-first ordering, not adjacent graph/search rows. Selected commits and rewritten descendants remain subject to server merge/topology checks. Disable squash selection during filtered search.
- Preserve explicit signature-removal consent, server blocked reasons, stale-ref rejection and linked-worktree occupancy guards.
- Applicable cherry-pick/revert/reset/drop/undo and file variants retain existing server restrictions and confirmations; connect any checkout/worktree-changing action to dirty-buffer protection. Do not claim rewrite CAS protects generic mutations.
- After either message edit or squash, offer separate leased publication bound to the returned branch/new tip. Prepare preview, explicit confirmation, exact remote-OID lease; stale remote blocks. Never automatic publication or blind force fallback.
- Unknown/uncertain mutation outcome triggers reconciliation, not automatic resend. Disabling a button or cancelling a client coroutine cannot undo an accepted server mutation.

### Sync, conflicts and API limits

- Use current fetch/pull/push APIs and server-side credentials. Display actual per-target outcome, not HTTP success alone; preserve errors and permit repeated identical error presentation.
- **Existing contract limit:** fetch/pull accept project/worktree targets but no nested VCS `root`. Disable fetch/pull when a secondary root is selected and explain why; never accidentally operate on the primary repository. Existing push supports `root`. No API extension is proposed.
- Discover/show conflict or active-operation state using current read APIs. Do not mount the incompatible native resolver. If pull or a history action conflicts, report it, reconcile state, block incompatible actions and offer Open Terminal / guidance for existing terminal or web recovery. Recovery is not falsely labelled complete.
- Refresh on Git entry, foreground resume, manual refresh, and completed mutations. Reconcile existing worktree events where supported; no new polling service or event protocol. External terminal changes are guaranteed visible on those refresh triggers, not continuously in real time.

## Ownership, safety and touchpoints

Retain logical Git UI state with `ProjectWorkspaceState`. Bind repositories/jobs to the current authenticated API runtime. Recreate/rebind them on connection generation change; invalidate pending confirmations/publication previews and ignore obsolete callbacks. Query identity additionally includes root, viewed canonical ref, normalized search, page and request sequence. No old result may change a new view's eligibility.

Use the existing workspace dirty/departure authority for worktree switching and checks before file-overwriting actions. Refresh clean editor buffers/file-tree state after successful disk changes without overwriting dirty documents. Save/discard confirmation must be followed by revalidation before dispatch.

Worktree removal checks **all retained workspace owners** for dirty buffers plus authoritative target-qualified terminal inventory, not just the visible workspace. Unknown inventory blocks deletion. Re-fetch discovery immediately before dispatch; refuse vanished/non-main-invalid targets. Send the projected `path` under the existing deletion contract; server resolves its `repositoryPath` for removal. Do not swap these identities client-side.

| Touchpoint | Expected responsibility |
| --- | --- |
| `shared/.../ui/screens/ProjectWorkspaceScreen.kt` | Git tab, single content host, nested navigation/back, input gating |
| `shared/.../features/workspace/ProjectWorkspaceState.kt` | Retained Git presentation and lifecycle ownership |
| `shared/.../ui/screens/DamHopperMobileApp.kt`, `ui/flow/AppFlowNavigation.kt` | Qualified runtime binding and guarded worktree switch |
| `androidApp/.../platform/workspace/NativeWorkspaceViewModel.kt` | Runtime rebinding; aggregate retained dirty-state and terminal prechecks |
| `shared/.../features/workspace/ProjectTargetStore.kt` | Worktree discovery/selection/unavailable state; reuse existing contract |
| `shared/.../features/git/` | Existing panels, controllers, repositories, models, diff routing, graph layout/rendering, current-wire alignment |
| `shared/.../ui/screens/WorkbenchScreen.kt` | Reuse source of wiring patterns; avoid a second independent Git state owner; no unrelated shell cutover |
| Existing native JVM tests and Android instrumentation journeys | Behavioral regression coverage and actual active-root qualification |
| Android README, architecture, acceptance ledger, existing changelog | Reachability, scope, limitations and exercised evidence |
| `packages/ui` and `server` | Read-only parity/contract references; no implementation changes expected |

No database/schema migration, dependency upgrade, release agent integration or external service is required. Git operations and remote credentials remain server-owned.

## Required hardening before exposure

- Correct source-confirmed premature discard invalidation and missing details-action reconciliation.
- Re-evaluate ledger H1–H5: checkout/history scope, repeated errors, invalidation and special-character worktree paths. Old ledger entries are not all independently reproduced defects today.
- Existing `GitHistoryController` checks contiguous list indices and local/active branch names; graph integration requires OID-chain checks and canonical-ref identity.
- Existing message edits do not emit the squash publication receipt. Make message-edit publication reachable using existing prepare/publish contracts; no server change.
- Audit late mutation callbacks and background diff-layout publication across generation/query changes. Client ownership checks protect presentation; they are not server-wide transaction guarantees.

## Acceptance and validation

These are future acceptance checks, **not executed results**:

1. Launch the real Android root: select profile/project, enter Git, exercise all three sections and Back/diff/details routes. Switching tabs/rotation preserves terminal identity, editor text/undo and Git state; hidden surfaces accept no input.
2. Against disposable current-server repositories, stage/unstage, commit/amend and confirmed discard produce the expected index/files/commit objects. Refresh after terminal edits shows actual state; failures do not trigger success-only callbacks.
3. Render linear history, merges, detached/empty/shallow history, skewed timestamps, missing parents, branch-name collisions, filtered search and multi-page boundaries. Visible edges correspond to real parent OIDs; page append/refresh introduces no duplicate commits or invented ancestry. Inspect phone-width and tablet UI visually.
4. Edit a message and squash a valid chain on active/inactive local branches. Reject noncontiguous/search/merge-ineligible selections, stale HEAD and another-worktree checkout. Verify tree/index/files preservation required by the contract and explicit signature consent.
5. Separately publish message-edit and squash results against a disposable bare remote. Advance the remote after preparation: publication must block without force fallback. No-op/uncertain results are not fabricated publication receipts.
6. Create/open/remove/prune worktrees, including nested-project mappings and paths with spaces, Unicode, `& + # =`. Dirty documents or live terminals in a non-visible retained workspace prevent removal. Deleted/stale targets refuse pending actions and do not send them to root.
7. With unsaved editor text, attempt checkout, discard, worktree switch and applicable destructive history actions. Cancel preserves text/target; approved transitions revalidate; clean buffers reconcile after disk changes.
8. Switch profiles/reconnect/change root or ref during slow reads and mutations. Old callbacks cannot populate new history, change eligibility, display success on another target or publish an old preview. Lost mutation acknowledgements require reconciliation, not replay.
9. Exercise conflict/active-operation outcomes: clear blocking state and terminal/web handoff, no incompatible `/resolve` payload. A non-Git project shows `GIT_NOT_INITIALIZED`, not misleading empty history.
10. Request evidence shows only existing endpoints/fields. Non-primary-root fetch/pull are visibly unavailable; primary-target sync and root-qualified push target the correct repository.

Use existing native repository/controller tests for uncertain behavior boundaries and add active-root Android instrumentation journeys. Qualification requires real current server, real disposable Git repositories/remotes, emulator plus physical ARM64/API29 coverage under existing release gates. JVM mock-server/static tests alone do not certify integration. No fixed performance/coverage targets or estimates invented here.

## Feasibility, stakeholders and remaining risks

Source-backed feasibility: current server routes cover selected actions; native typed log entries already carry graph parent/ref metadata; active flow carries `activeWorktreePath`; retained workspace owners already include worktree identity. The work requires client integration/hardening and a native graph, not a new backend capability.

Users gain focused mobile workflows without losing editor/terminal state. Developers reuse established domain code; operators deploy no server change. Trade-off: more correctness work than adding a navigation button; no claim of full web UX parity or seamless native conflict recovery.

Remaining risks: dormant code quality and current-wire drift; graph layout under non-topological/offset-paged history; absent snapshot pagination; concurrent external Git operations; physical-device performance; existing fallback account identity in workspace ownership. Preserve current authentication protections; do not broaden authority or cross-account draft adoption. Any blocker outside these constraints returns to design rather than silently adding APIs.

## Evidence and verification status

Both delegated scouts completed. Parent inspected the integration, model, graph, safety and contract sections below. **Static source/document inspection only; no build, tests, server calls or device run.** Documented historical passes are not current evidence. Advisor reviewed the candidate direction and complete proposed design; advice is not runtime verification.

- [Active workspace tabs](../../native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectWorkspaceScreen.kt#L231), [native Git screen](../../native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitPanelScreen.kt#L17).
- [Active worktree owner](../../native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt#L320), [retained owner/rebinding](../../native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt#L1322).
- [Native parent/ref model](../../native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryModels.kt#L9), [native history/selection](../../native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryController.kt#L82), [web graph](../../packages/ui/src/components/organisms/GitLogTree.tsx#L245).
- [Server history parent emission and ordering](../../server/src/git/repository.rs#L1627), [existing routes](../../server/src/api/router.rs#L163), [fetch/pull request shape](../../server/src/api/git.rs#L32).
- [Worktree and rewrite contracts](../../docs/api/git.md), [web history behavior](../../docs/architecture/git-history-search.md), [known native gaps](../../docs/android-native-acceptance.md#L624).
- [Legacy native resolver](../../native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/MergeConflictController.kt#L152), [server rejection](../../server/src/api/git_diff.rs#L291).

## Decision outcome and open questions

- Design approved for specific-project Git; profile-wide multi-project Git remains excluded.
- User explicitly deferred implementation planning. No plan router invoked and no plan path.
- Journal gate incomplete: the installed `/evc-cmd-journal` template was inspected, but this session exposes no native slash-command invocation tool. Command not invoked; no journal created or writer completion claimed.
- Next step: retain this approved design; invoke the decision-summary journal when the native command is callable. Implementation planning remains deferred until separately requested.
- Open design questions: none. Runtime qualification and the documented risks remain implementation acceptance gates, not completed evidence.
