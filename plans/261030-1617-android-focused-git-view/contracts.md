# Focused Git contracts and execution authority

Status: proposed implementation contracts; source facts explicitly labelled. Planning is not implementation approval.
Repository root anchor: `G:/ws/sharing/dam-hopper/`. All writable paths elsewhere are normalized relative to this root.

## Authority and evidence
- [Approved design](../reports/brainstorm-261030-1451-android-focused-git-view.md), [coordinator evidence](reports/coordinator-evidence.md), [Git evidence](reports/git-contract-evidence.md), [workspace evidence](reports/workspace-safety-evidence.md).
- [Intended architecture](../../docs/architecture/android-native-client.md#intended-increment-focused-project-git-not-implemented), [current API](../../docs/api/git.md), [native standards](../../docs/code-standards.md), [acceptance traceability](acceptance-matrix.md).
- Static facts below came from source inspection, not HTTP/device execution. 01 implements only compile-closed additive contracts; active wire/scope/diff cutovers03, receipt/publication04 and runtime/host constructor cutover06 each own all callers. Writing this document proves neither compiled code nor passing evidence.
- Keep immutable per-generation `FileRepository`, `EditorRepository`, `ApiClient`, `WsConnection`. Rebind their retained consumers, not the identity inside old transports. No new dependency, API, migration, scheduler or service.

## Four identities; final scope cutover03 and additive identity01
Existing `WorkspaceFileOwner` equality is the logical authority: profile, normalized endpoint, verified server account, project, normalized projected worktree. No display-label account fallback. Root selection does not change that owner. Viewed ref never changes checkout.

```kotlin
data class GitOperationScope(
    val owner: WorkspaceFileOwner,
    val generation: Long,
    val root: String? = null,
) {
    val profileId: String // require non-null verified owner profile
    val project: String // owner.project
    val worktreePath: String? // owner.worktreePath
    val targetRef: ProjectTargetRef // owner.toProjectTargetRef()
    fun matches(other: GitOperationScope?): Boolean // complete value equality
    companion object {
        fun from(owner: WorkspaceFileOwner, connection: ConnectionRef,
                 root: String? = null): GitOperationScope
    }
}
data class GitRequestIdentity(
    val owner: WorkspaceFileOwner,
    val generation: Long,
    val root: String?,
    val ref: String,
    val search: String,
    val offset: Int,
    val sequence: Long,
)
fun gitWorkspaceRelativePath(rootPath: String, gitPath: String): String
```
The final GitOperationScope definition above is implemented atomically03 with all callers, not01.01 adds GitRequestIdentity independently of the live baseline scope constructor. `from` rejects owner/profile mismatch. Owner endpoint/account must already be verified against the live runtime; a ConnectionRef alone cannot prove them. No legacy constructor/from overload retained. Root is current discovered server root selector (root.path), not an arbitrary absolute filesystem path. Primary root wire omission is allowed only when current discovery identifies primary; never map an unavailable explicit root to null. Store selected rootId plus resolve its path from current roots; invalidate if gone/unmapped.

Path helper: normalize separators; primary `.`/empty becomes empty prefix; reject absolute input, NUL, traversal/escaping segments using `DocumentId.normalizeRelativePath`; join normalized root.path and root-relative path, normalize again. Do not join absolutePath/repositoryPath. Requests keep original validated root-relative path plus root selector. Editor opens/dirty checks use mapped workspace-relative path. For rename/copy destructive checks include both old/new paths. Reject unsupported/unmapped roots, not silent primary fallback.

Request acceptance: capture identity before suspend; compare exact scope and the relevant query/ref/search/offset/sequence before every state/error/loading/details/layout/callback publication. Separate sequences for independent details/file reads; latest matching request wins. Cancellation saves work but never substitutes identity checks or reverses a server mutation. Search is trimmed literal case-insensitive server message search, not regex; debounce in controller with coroutine delay, no scheduler service. Identity includes normalized value actually sent. Retain typed search text independently if needed.

## Proposed host ports: one guard authority
Define interface/value types in new `GitWorkspaceContracts.kt`01 without changing active controller constructors. Real runtime06 implements after02 safety +03/04 behavior are complete; controllers consume the REQUIRED host only in the same06 atomic caller cutover. Names/types below are frozen design API, not existing implementations.

```kotlin
enum class GitRefreshReason { ENTRY, FOREGROUND, MANUAL, MUTATION, RECONCILE }
enum class GitMutationImpact { REFS, INDEX, FILES, HISTORY, TARGETS, PUBLICATION }
enum class GitOutcomeKind { SUCCEEDED, REJECTED, UNKNOWN }
data class GitMutationEvent(val scope: GitOperationScope,
    val impact: GitMutationImpact, val kind: GitOutcomeKind,
    val paths: List<String>, val message: String?)
interface GitHostPorts {
    suspend fun <T> withMutationGuard(scope: GitOperationScope,
        impact: GitMutationImpact, paths: List<String>,
        dispatch: suspend () -> T): Result<T>
    suspend fun preflightRemoval(scope: GitOperationScope,
        worktree: ProjectWorktree): WorktreeRemovalPrecheck
    suspend fun requestWorktreeSwitch(scope: GitOperationScope,
        target: ProjectTargetRef): Result<Unit>
    suspend fun openWorkspaceFile(scope: GitOperationScope,
        rootRelativePath: String): Result<Unit>
    fun onMutationOutcome(event: GitMutationEvent)
    fun refresh(reason: GitRefreshReason)
    fun openRecoveryTerminal(scope: GitOperationScope)
}
```
`withMutationGuard`: validate live exact runtime/target/root/known conflict state; for FILES and checkout/worktree effects capture dirty revisions, show existing Save/Discard/Cancel authority; after decision recheck revisions/runtime/discovery immediately before invoking dispatch once. Empty paths means whole exact target; no generic Git server CAS claimed. Prompt cancellation returns failure without request. Save failure or changed revision keeps guard closed. Discard must actually reload/close/discard the selected retained drafts through editor authority, not just continue with dirty buffers. REFS/INDEX/HISTORY/PUBLICATION still validate ownership/availability and relevant operation restrictions; no unnecessary dirty prompt for object-only message/squash. Guards cannot lock out external writers: server restrictions remain authoritative.

Controller calls onMutationOutcome exactly once per observed result on matching scope. SUCCEEDED only when response domain says success; REJECTED retains error and does not run success callbacks; UNKNOWN reconciles reads and blocks repeats until resolved or user explicitly takes a fresh action after reconciliation. Timeout/disconnect after dispatch/cancelled acknowledgement is not definitely rejected. Preserve unknown operation record with captured owner/action/branch/tip in presentation until reconciled; never auto-resend. Stale completions do not display success/error on new owner; record unresolved status under original owner for later explicit reconciliation. Fresh equal error text gets a fresh monotonically increasing event identity; no equal-string suppression.

`preflightRemoval` fresh listDetailed from exact owner transport, all retained exact logical owner dirty docs (including hidden/retired states); marker-qualified sessions are authoritative; legacy project+cwd containment uses normalized segment boundaries and target discovery mapping, not string prefix. Unknown/unclassifiable live session or failed inventory blocks. It never kills PTYs. Controller re-fetches discovery immediately before dispatch; absent, main, bare, locked, unavailable or changed projected mapping refuses. Recheck exact scope and dirty state after suspension; force does not bypass client safety. DELETE body path is projected worktree.path. Removing currently selected target requires a separately guarded transition to a freshly validated available target first; never execute a captured action against root as fallback.

`openRecoveryTerminal` selects existing Terminal surface for the same workspace; does not route via notification, create/retarget/kill an old PTY, or pretend recovery completed. Explain nested root path for manual cd; user-created new PTY uses current selected worktree.

## Retained safety02 versus actual runtime06
New GitWorkspaceState and WorkspaceGitSafety belong02; GitWorkspaceRuntime is introduced ONLY06 with every consumed controller constructor/revoke/property implemented and every caller migrated.01 types/interfaces are complete additive values, not executable placeholders. State is per logical owner, in-memory only; no process-death persistence promise.

```kotlin
class GitWorkspaceState {
    val section: StateFlow<GitPanelSection>
    val route: StateFlow<GitRoute>
    val modal: StateFlow<GitModalState>
    fun selectSection(section: GitPanelSection)
    fun navigate(route: GitRoute)
    fun updateModal(modal: GitModalState)
    fun back(): Boolean
    fun invalidateAuthority()
}
sealed interface GitRoute {
    data object Overview : GitRoute
    data class Details(val oid: String) : GitRoute
    data class Diff(val path: String, val commitOid: String?) : GitRoute
}
class GitWorkspaceRuntime(
    val owner: WorkspaceFileOwner, val connection: ConnectionRef,
    val repository: GitRepository, val presentation: GitWorkspaceState,
    val safety: WorkspaceGitSafety, coroutineScope: CoroutineScope,
) : GitHostPorts, AutoCloseable {
    val history: GitHistoryController
    val changes: GitChangesController
    val branches: GitBranchController
    val worktrees: WorktreeMutationController
    val rewrite: GitRewriteActionController
    val actions: GitHistoryActionController
    val leased: LeasedPublishController
    val sync: GitSyncController
    val diff: DiffReviewController
    val roots: StateFlow<List<VcsRoot>>
    val scope: StateFlow<GitOperationScope?>
    fun selectRoot(rootId: String)
    fun refresh(reason: GitRefreshReason)
    fun revoke()
    override fun close()
}
```
State also retains per-section first visible OID/index+offset, selected OIDs, checked-out metadata separately from viewed canonical ref, search and nested route across tab/rotation; constructor has no runtime transport. `invalidateAuthority` spends confirmations/receipts/previews, preserves logical navigation/scroll, marks old content non-authoritative until refreshed. GitPanelSection moves from GitPanelScreen.kt into contracts01 to avoid a lane host dependency.

Proposed additions to existing types (implemented02, not shims): `ProjectWorkspaceState.rebindAuthority(expectedOwner: WorkspaceFileOwner, newConnection: ConnectionRef): Boolean` requires the actual current connection (remove synthetic generation1 fallback/default); `rebindTransports(newFileRepo: FileRepository,newEditorRepo: EditorRepository,newConnection: ConnectionRef): Boolean` calls each narrow consumer rebind plus `terminalState.rebindTransports(newConnection, TerminalRepository(newFileRepo.apiClient,newFileRepo.wsConnection))` before authority re-enable. Retain original same-owner arbiter in fresh FileRepository constructor.

 `ProjectWorkspaceState.val gitState: GitWorkspaceState` is added02; ONLY06 adds `var gitRuntime: GitWorkspaceRuntime?` private-set; `bindGitRuntime(runtime: GitWorkspaceRuntime): Boolean` requires exact owner and current generation; revoke/close forwards; WorkspacePanel.GIT and its exhaustive host branches are added atomically06, gating hidden editor/terminal input;02 leaves existing panel enum intact. `suspend AppFlowNavigation.requestWorkspaceTarget(target: ProjectTargetRef, revalidate: suspend () -> Boolean, onCommitted: () -> Unit): Result<Unit>` runs existing departure guard first, revalidates fresh target/current owner after confirmation, then commits same-stage project/worktree and clears only old session intent. Caller-owned coroutine awaits the existing guard with a one-shot continuation; cancellation/retirement spends it. AppFlowNavigation constructor remains unchanged. targetStore.selectTarget only in onCommitted, synchronous non-suspending commit pair on UI dispatcher. No intermediate store selection before guard. No use of routeToTerminal/commitVerifiedTerminalRoute.

VM02 adds `fun retainedDirtyDocuments(owner: WorkspaceFileOwner): List<DocumentId>` matches exact profile/endpoint/account/project/normalized worktree across retained states including retired; `suspend fun preflightGitWorktreeRemoval(scope: GitOperationScope, worktree: ProjectWorktree): WorktreeRemovalPrecheck`; ONLY06 adds `fun gitHostPorts(owner: WorkspaceFileOwner): GitHostPorts`. Root uses verified effectiveAccountUser in remember key and state provider, client/ws complete ConnectionRef equality + endpoint. Missing account/transport rejects/revokes; no synthetic dev/authenticated-user adoption or widening auth. ONLY06 `RetainedRootServices` gains `fun gitHostPorts(owner: WorkspaceFileOwner): GitHostPorts`; VM implements; root passes that exact implementation. Do not add ports to MainActivity just for convenience.

Required narrow consumer rebind02 (providers AND all root/VM/workspace/screen/test callers owned atomically): `EditorTabsState.rebindRepository(repository: EditorRepository): Boolean` changes repo/saveCoordinator, reattaches provider/saveGate, increments transport epoch and fences late loads/saves, preserves documents/undo/incarnations; `FileTreeState.rebindRepository(repository: FileRepository): Boolean` retires old watchCoordinator/subscriptions/collector, replaces with new coordinator, retains expanded/selected/filter/scroll data and renews demands before refresh; `FileMutationCoordinator.rebindRepository(repository: FileRepository): Boolean` retires stale submissions/dialog authority and preserves shared arbiter/quarantine across generation for same owner (new FileRepository gets existing arbiter); `ProjectTerminalState.rebindTransports(newConnection: ConnectionRef, repository: TerminalRepository): Boolean` updates current generation only after full owner validation at workspace boundary; existing `rebindAuthority(newConnection: ConnectionRef): Boolean` only re-enables the already rebound exact connection and refuses a different generation, drops queued outbound input and retires old attachment queues/sinks; calls new `TerminalSessionController.rebindTransport(connection: ConnectionRef, repository: TerminalRepository): Boolean` on retained controllers, preserving the same controller/surface/VT engine, accepted grid/scrollback/lastSeenOffset/incarnation, active ID, session drafts and reading positions. `rebindTransport` closes replay/input via existing beginAttach/failAttach boundary, changes only current connection/repository, clears old rawInputSink/reattach callback, then ProjectTerminalScreen explicitly reinstalls fresh resize/raw-input/recovery/reattach callbacks for BOTH retained existing and newly created controllers, and replays from accepted offset; new incarnation/reset follows existing server-authoritative reset behavior. Old-generation chunks/attach callbacks must be rejected by captured binding epoch, and queued writes never drain under new authority. Do not call removeSessionLocal/close on retained grid merely to update generation. No remote PTY create/delete/move, no document/undo replacement. Constructor-bound transport vars become private-set; not a generic mutable transport registry. These are prerequisite safety repairs only, no terminal/auth redesign.

## Final constructor/callback signatures: atomic introduction06
All repository methods not explicitly changed below retain source signatures/current payloads. Existing controller constructors remain LIVE baseline through03/04 and are NOT converted to adapters/shims. The following REQUIRED host constructors and real revoke methods are implemented atomically06 together with runtime + ALL production/test callers; no earlier runtime references them. Existing controller methods remain except listed replacements. Public constructors keep named first two parameters `repository: GitRepository, coroutineScope: CoroutineScope`; `GitChangesController`, `GitBranchController`, `GitSyncController`, `GitHistoryActionController`, `GitRewriteActionController`, `LeasedPublishController` add REQUIRED third `host: GitHostPorts`. `GitHistoryController(repository, coroutineScope)` unchanged. `WorktreeMutationController(repository: GitRepository, coroutineScope: CoroutineScope, host: GitHostPorts)` replaces synchronous dirty/terminal lambdas and removal callbacks; `suspend fun validateRemovalPrecheck(worktree: ProjectWorktree): WorktreeRemovalPrecheck` replaces the synchronous precheck; views launch it in their existing coroutine scope. No defaults masking missing safety. `updateScope(scope: GitOperationScope)` remains on controllers; history `updateScope(scope, viewed: GitBranch?, active: GitBranch?)` retains types but uses fullRef values. New `revoke(): Unit` on every controller cancels/invalidates request tokens and spends transient mutation authority; keeps no ambient runtime.

ONLY04 implement-safe-rewrites atomically replaces `GitRewriteModels.SquashReceipt` with `RewriteReceipt(branch: String, sourceOid: String, oldHeadOid: String, targetOid: String, rewrittenCount: Int, scope: GitOperationScope)`; sourceOid is actual new branch tip, targetOid new rewritten target (not necessarily tip). `GitRewriteActionController.lastRewriteReceipt: StateFlow<RewriteReceipt?>` replaces lastSquashReceipt; `clearReceipt()` remains. Both edit/squash retain current method arguments and `(GitActionResult)->Unit` result callback, emit receipt only ok && !noOp && not publication-uncertain && full actual returned canonical branch/newHeadOid/newTargetOid + oldHeadOid agreeing with snapshot; mismatched fields reconcile, not synthesized receipt. `LeasedPublishController.prepareWithReceipt(receipt: RewriteReceipt): Job` only entry for rewrite publication; remove independent public prepare(branch,sourceOid) to prevent unbound preview. Preview must equal receipt.branch/sourceOid and exact scope, preserve all server snapshot identities unchanged. confirmPublish uses frozen preview, explicit consent; unknown remains unresolved, no force.

ONLY03 implement-readonly-git-diff atomically with DiffReviewScreen and ALL Workbench constructor/load/save/detail consumers, `DiffReviewController(repository: GitRepository, coroutineScope: CoroutineScope)` replaces direct ApiClient/targetStore/draft authority. `fun loadDiff(scope: GitOperationScope, path: String, commitHash: String? = null): Unit`; `fun revoke(): Unit`; existing read state/layout/hunk navigation retained. Remove updateModifiedDraft/saveModified/discardHunk/baselineMtime and dirty draft flows in that SAME03 task, never06. Always read-only; no fs:stat for root-relative Git path. Fence both network and background layout sequence/scope/layout revision before publication. `DiffReviewScreen(controller: DiffReviewController, onOpenInEditor: (String) -> Unit, modifier: Modifier = Modifier)` replaces save callback. Open maps current workspace path, historical content never imported.

ONLY06 `GitModalState` retains existing target fields and adds `capturedScope: GitOperationScope? = null` for every pending intent; null cannot authorize dispatch. Event identity is a controller-local monotonic Long, not a wire field.

Callbacks/UI ownership: existing section views keep callable baseline callbacks until the task that replaces each type;03 diff,04 receipt and06 runtime all include their complete caller closure. Each phase records exact changed callsites. `GitPanelScreen(runtime: GitWorkspaceRuntime, state: GitWorkspaceState, modifier: Modifier = Modifier)` and `GitModalsHost(runtime: GitWorkspaceRuntime, state: GitWorkspaceState)` are proposed06 replacements, no parallel lane writes. All leaf mutation callbacks return actual controller outcome; shared host performs reconciliation via ports, never UI eager success. GitCommitRow remains history04; graph05 supplies independent `GitGraphLane` for06 placement, not row edits. WorkbenchScreen adds REQUIRED `gitWorkspace: ProjectWorkspaceState` input and consumes its exact retained gitState/gitRuntime for Git and diff; static source search found no callers of WorkbenchScreen. Remove its private Git controller construction/scope effects and diff writer callbacks06, no second controller bundle. Its selected target/connection must match supplied workspace or show explicit unavailable context; never synthesize an owner/fallback runtime. Do not change unrelated Workbench panels or activate this unused shell. No general 12-panel activation.

## Exact current-wire operation inventory (static facts)
Shorthand below: P = encodePathSegment(project), H = encodePathSegment(full OID). WT/root = optional worktreePath/root fields. All optional omissions preserve exact selected target semantics; profile/endpoint/account/generation/query sequence are client-only. Repositories use ApiClient parameter encoding/serialization, never hand-concatenate user paths.

| Operation / facade | Current verb + route | Existing request fields | Response / rule |
|---|---|---|---|
| roots / query.listRoots(project,worktreePath) | GET /api/git/P/roots | query WT, **no root** | List<VcsRoot>; status is server GitStatus |
| branches / query.listBranches(project,worktreePath,root) | GET /api/git/P/branches | query WT/root | List<GitBranch>, shorthand name + isRemote; client fullRef disambiguates |
| history / getLog(project,WT,limit,offset,ref,messageQuery,root) | GET /api/git/P/log | query limit,offset,ref,messageQuery,WT/root | List<GitLogEntry>; ordered parents, no topo/snapshot promise |
| changes / query.getDiffSummary(project,WT,root) | GET /api/git/P/diff | query WT/root | **DiffResponse {entries,untrackedTruncated,untrackedTotal}**, not staged/unstaged envelope |
| untracked / query.getUntracked(project,WT,offset,limit,root) | GET /api/git/P/untracked | query offset,limit,WT/root | same DiffResponse envelope, not bare list |
| file diff / query.getFileDiff(project,path,WT,root) | GET /api/git/P/diff/file | query path,WT/root | FileDiffContent {path,original?,modified?,language,hunks,lineChanges,isBinary} |
| details / query.getCommitDetails(project,hash,WT,root) | GET /api/git/P/commit/H/details | query WT/root | GitCommitDetails fullMessage + author/committer fields |
| files / query.getCommitFiles(project,hash,WT,root) | GET /api/git/P/commit/H/files | query WT/root | List<DiffFileEntry> (not DiffResponse) |
| historical diff / query.getCommitFileDiff(project,hash,path,WT,root) | GET /api/git/P/commit/H/diff | query path,WT/root | FileDiffContent; read-only |
| full message / query.getCommitMessage(project,hash,WT,root,branch) | GET /api/git/P/commit/H/message | query branch full refs/heads/...,WT/root | CommitMessageSnapshot {message,branch,headOid} |
| stage / unstage | POST /api/git/P/stage, /unstage | body paths,WT/root | {ok}; false is failure |
| whole-file discard | POST /api/git/P/discard | body path,WT/root | {ok}; confirmation + retained dirty guard |
| commit / amend | POST /api/git/P/commit | body message,amend,WT/root | CommitResponse {ok,hash?,error?} |
| create branch | POST /api/git/P/branches | name,startPoint?,checkout,WT/root | GitActionResult |
| checkout | POST /api/git/P/branches/checkout | branch,startPoint?,create,strategy,WT/root | GitActionResult, conflict/dirty/blocked not success |
| delete branch | DELETE /api/git/P/branches | name,WT/root | GitActionResult |
| update branch | POST /api/git/P/branches/update | branch?,WT/root | BranchUpdateResult {branch,success,reason?} |
| fetch / pull | POST /api/git/fetch, /pull | targets:[{project,worktreePath?}] OR projects | List<GitOpResult>; focused UI sends one exact target; **no root supported** |
| ordinary push | POST /api/git/push | project,WT/root | GitOpResult; fast-forward only, no force fallback |
| worktree discovery | GET /api/git/P/worktrees | none (configured repository/project) | List<ProjectWorktree>, projected path != repositoryPath |
| add worktree | POST /api/git/P/worktrees | branch,path?,createBranch?,baseBranch? | ProjectWorktree; no WT/root selector |
| remove worktree | DELETE /api/git/P/worktrees | path=projected target path,force? | {ok}; no repositoryPath field |
| prune worktrees | POST /api/git/P/worktrees/prune | {} | {ok}; no target/root selector |
| cherry-pick | POST /api/git/P/cherry-pick | hash,WT/root | GitActionResult |
| reset | POST /api/git/P/reset | hash,mode,WT/root | GitActionResult |
| undo last | POST /api/git/P/undo-last-commit | query WT/root; body {} | GitActionResult |
| drop / revert | POST /api/git/P/commit/H/drop, /revert | query WT/root; body {} | GitActionResult |
| cherry-pick/drop/revert files | POST /api/git/P/commit/H/cherry-pick-files, /drop-files, /revert-files | body paths,WT/root | GitActionResult; restrictions remain server-owned |
| edit message | POST /api/git/P/commit/H/message | message,expectedBranch,expectedHeadOid,allowSignatureRemoval,WT/root | GitActionResult actual rewrite fields, noOp/uncertain handling |
| squash | POST /api/git/P/squash | hashes oldest-first full OIDs,message,expectedBranch,expectedHeadOid,allowSignatureRemoval,WT/root | same rewrite result |
| prepare leased publication | POST /api/git/P/push/prepare | branch?,WT/root | PublishPreview ready/blocked + exact snapshot |
| publish confirmed lease | POST /api/git/P/push/publish | snapshot,WT/root | PublishResult status enum; unknown != success |
| read conflicts (new native decoder only) | GET /api/git/P/conflicts | query WT/root,cursor? | {targetRevision,entries:[{conflictId,path,status,isBinary,unsupportedReason?}],truncated,nextCursor?} |
| read operation (new native decoder only) | GET /api/git/P/operation | query WT/root | operation,canContinue,canAbort,stoppedReason?,operationFingerprint,fullIndexFingerprint,stageRoleLabels?,terminalHandoffRequired?,blockers |
| terminal preflight (existing) | GET /api/terminal/detailed | none, exact owner's API client | List<TerminalSessionDetailed>; immutable worktreePath marker + project/cwd legacy classification |

Not mounted/sent by focused Git: discard-hunk, POST /resolve, POST /operation. Legacy MergeConflictController/Models stay unmounted; do not adopt their old conflict response/resolve payload. No server fixes authorized. Existing project status GET /api/projects/P/status?worktreePath remains available but **not needed**: use roots' embedded GitStatus, avoiding redundant status request.

### Phase03 exact atomic DTO/repository/scope changes
- Replace GitRootStatus with `GitStatus(projectName:String,branch:String,isClean:Boolean,ahead:Int,behind:Int,staged:Int,modified:Int,untracked:Int,hasStash:Boolean,lastCommit:GitLastCommit,pathExists:Boolean?=null,statusError:String?=null)` matching camelCase. `GitLastCommit(hash:String,message:String,date:String)` matches server types.rs:3-8; no guessed headCommit/isDetached fields. Detached state uses current branch/branch-list/operation data, not invented wire field.
- Add `GitDiffResponse(entries:List<DiffFileEntry>,untrackedTruncated:Boolean,untrackedTotal:Int)`; change getDiffSummary and getUntracked return type to GitDiffResponse in query and facade. Split staged/unstaged/untracked in changes controller03, preserving count/truncation/load-more, same path can appear staged and unstaged. Add server fields additions/deletions/rootId/rootPath/submodule on DiffFileEntry with correct optional metadata; use exact `GitSubmoduleGitlink(path:String,objectId:String,moduleName:String?=null,url:String?=null)` (server types.rs:74-80); VcsRoot.gitlink and DiffFileEntry.submodule use it.
- Add `GitConflictSummary`, `GitConflictSummaryEntry`, `GitOperationStatus` native DTOs in GitModels.kt (unknown operation string must block, no permissive safe default); `GitQueryRepository.getConflicts(project:String,worktreePath:String?=null,root:String?=null,cursor:String?=null): GitConflictSummary`; `getOperation(project:String,worktreePath:String?=null,root:String?=null): GitOperationStatus`. No native mutation counterpart.
- Exact added DTO constructors (all `@Serializable`, camelCase wire names): `GitConflictSummary(targetRevision:String,entries:List<GitConflictSummaryEntry>,truncated:Boolean,nextCursor:String?=null)`; `GitConflictSummaryEntry(conflictId:String,path:String,status:String,isBinary:Boolean,unsupportedReason:String?=null)`; `GitOperationStatus(operation:String,canContinue:Boolean,canAbort:Boolean,operationFingerprint:String,fullIndexFingerprint:String,stoppedReason:String?=null,stageRoleLabels:GitStageRoleLabels?=null,terminalHandoffRequired:GitTerminalHandoff?=null,blockers:List<String>=emptyList())`; `GitStageRoleLabels(ours:String,theirs:String,base:String?=null)`; `GitTerminalHandoff(reason:String,worktreeRoot:String)`. String operation/status values preserve unknown wire values for blocking presentation, never map unknown to safe `none`.
- Exact `DiffFileEntry` constructor after normalization: `(path:String,status:String,staged:Boolean,additions:Int,deletions:Int,oldPath:String?=null,rootId:String?=null,rootPath:String?=null,submodule:GitSubmoduleGitlink?=null)`. `VcsRoot` keeps existing root identity/path/kind/mapping/warnings and uses `status:GitStatus?=null,gitlink:GitSubmoduleGitlink?=null`; metadata omissions are nullable, not invented clean state. Consumers/fixtures migrate to these required change-count/status fields; no silent old-shape success.
- Preserve existing GitLogEntry ordered parents/full hash/ref fields, message snapshot/result, GitOpResult and PublishSnapshot wire fields. Never invent snapshot pagination/generation wire fields. Error 409 `GIT_NOT_INITIALIZED` gets explicit non-Git state; unavailable/auth/decode failure is not empty clean data. Operation unknown/unsupported, truncated conflicts or failed operation query must not confer mutation eligibility.
- LastCommit and SubmoduleGitlinkInfo were refreshed from server types.rs:3-8,74-80 during authoring; mirror the exact fields above and test source-shaped fixture JSON. No current-wire field choice remains open.

## Graph contract (proposed pure input/output)
01 implements ONLY immutable graph data models below. Actual layout and Canvas function bodies are implemented05, not bodyless declarations01.04 does not depend on05;06 imports completed05:
```kotlin
data class GitGraphPoint(val row: Float, val lane: Int)
data class GitGraphSegment(val from: GitGraphPoint, val to: GitGraphPoint,
    val parentOid: String, val parentIndex: Int, val unresolved: Boolean)
data class GitGraphRow(val oid: String, val rowIndex: Int, val lane: Int,
    val segments: List<GitGraphSegment>)
data class GitGraphLayout(val rows: List<GitGraphRow>, val laneCount: Int)
// Implement05, no runtime/controller dependency:
fun layoutGitGraph(entries: List<GitLogEntry>): GitGraphLayout
@Composable fun GitGraphLane(row: GitGraphRow, laneCount: Int,
    modifier: Modifier = Modifier)
```
Full dataset indexes OID->row first; ordered parent edge maps to actual parent row even if earlier (upward edge), else unresolved page/shallow stub with same parentOid. No phantom node for missing OID, no adjacency ancestry. Deterministic lane/interval allocation, split long edges into row-local segments; merge/octopus second+ parents separate with parentIndex; avoid allocating/recomputing graph inside draw. Canvas consumes immutable row primitives; themed lane palette/selection semantics not only color. History04 does not import implementation05; integration06 adds optional precomputed graph row to GitCommitRow and graph-free filtered list. Offset append dedup preserves first accepted row/OID and selection anchor; offset advances by raw response count, not dedup count. Before append validate current viewed tip using bounded offset0 read; observed difference resets dataset/selection/receipt. No atomicity promised across that check and page read; explicit refresh handles concurrent external writes.

## Evidence-complete scheduling / ownership
Eight deliverable phases retained. Only genuine concurrency: mainline `01 ->02 ->03 ->04 ->06` and pure graph `01 ->05 ->06`;06 requires evidence-complete04 AND05. Then07 ->08. Every durable task boundary has coherent provider+caller code, applicable compile, scoped behavioral tests, real consumer/current-server smoke and passing review BEFORE completion/unblocking. Implementation terminal alone never completes prerequisite. One verifier after bounded editors are terminal, not tests over half-edited working tree. Full Q1 after06 is ADDITIONAL integration evidence. No shims/fake hosts/scaffolds/test waiver or helper semantics change.

01 additive contracts leave live DTO/scope/receipt/constructors untouched.02 creates real retained safety/presentation only and no runtime property/constructor.03 atomically changes active wire/scope and all consumers, then diff definition/ALL callers.04 atomically changes rewrite receipt/producer/view/panel/leased/tests.06 owns the larger final constructor/revoke/host/runtime/root/leaf/test cutover; its size follows actual API coupling, not arbitrary file-count splitting. Old APIs remain live baseline until replaced, then are removed in same task, not compatibility code.

### Exact source-mapped breaking caller closures
All prefixes below expand literally in the owning phase task arrays; additional new tests created earlier are also explicitly migrated06.
| Cutover | Definition and complete discovered consumer closure | Atomic task |
|---|---|---|
| Current status/diff envelopes | GitModels; GitQueryRepository; GitRepository; GitChangesController62–67 and leaf; GitModelsSerializationTest optional old root status assertion; GitRepositoryTest/GitHistoryAndBranchRepositoryTest fixtures | align-current-git-wire03 |
| Owner-rich scope constructor/from | GitOperationScope; Workbench749–755 with real AuthStatus.user; GitControllersAndEligibilityTest47/86/120/147; new02 WorkspaceGitSafety/GitWorkspaceSafetyTest scope checks/callers | align-current-git-wire03 |
| Read-only diff API | DiffReviewController; DiffReviewScreen; Workbench constructor328/load824/editor-diff1237/screen1255+save1258/details1365/return1385; new same-task GitReadOnlyDiffTest | implement-readonly-git-diff03 |
| Rewrite receipt/unbound prepare removal | GitRewriteModels; GitRewriteActionController; GitHistoryView22/27/113–120; GitPanelScreen40/114–115/131; LeasedPublishController50/59; leased/dialog callers; GitControllersAndEligibilityTest166; same-task rewrite/publication tests | implement-safe-rewrites04 |
| Final host constructors and revoke | Eight controller definitions, GitPanelScreen/GitModalsHost/leafs, old Workbench348–365 bundle, all existing mixed/new03/04 constructor tests, new real runtime + VM/root/workspace/screen/services | mount-focused-git-host06 |
| Runtime visibility/retention | GitWorkspaceRuntime; ProjectWorkspaceState.gitRuntime/WorkspacePanel.GIT and ProjectWorkspaceScreen; VM + DamHopperMobileApp RetainedRootServices definition/sole VM implementation; new runtime/root tests | mount-focused-git-host06 |
| Terminal rebind / QueuedWrite token | ProjectTerminalState, TerminalSessionController, ProjectTerminalScreen448–553/664–708/756–788; ProjectWorkspaceState/VM/root; QueuedWrite constructor in visibility test149 | rebind-workspace-transports02 |

Source anchors are static inspected locations, not runtime reproduction; refresh before coding. Search exact symbol/constructors across native/android-app before each atomic task. If a real additional caller exists, coordinator explicitly revises the task literal write set before implementation, never postpones it to a dependent or supplies default/no-op compatibility behavior.

### Real workspace safety02 and final host06
02 adds `WorkspaceGitSafety` with bound exact WorkspaceFileOwner, live immutable repository/connection getters and existing workspace/flow/target/retained-dirty/terminal providers. It implements the guard/preflight/switch/open/reconcile operations in the GitHostPorts semantics above as real production methods. Before03 enriches scope, compare existing profile/generation/target/root fields against its independently verified bound owner;03 updates full scope.owner comparison and tests atomically.02 does NOT implement fake refresh/controller/revoke methods or instantiate a future runtime. Final06 GitWorkspaceRuntime implements full GitHostPorts using this safety plus actual completed controllers/current-operation state/refresh. Constructor builds controllers with host=this but performs no callback/request before initialization completes.

### Required terminal screen binding repair02 (F2)
`ProjectTerminalScreen.kt` is an explicit02 product writer, not assumed unchanged glue. Its existing same-incarnation early return bypasses callback installation. Refactor only callback installation/admission: get or create controller, installCurrentControllerBinding for BOTH paths, then return. Testable internal binding routine stays in that screen; production Compose path and scoped regression invoke the SAME installer. Preserve identical controller/surface/VT grid/scrollback/accepted offset/incarnation/drafts/document/undo. No remote PTY create/kill/restart/move.

Binding token captures complete logical owner/current ConnectionRef, repository object identity, controller/incarnation and monotonic attachment/surface epoch. Reinstall resize/raw input/reattach/recovery/input-policy closures on generation AND same-generation surface reattachment. QueuedWrite adds required captured token; screen and existing visibility test migrate atomically. Fence before every collector dispatch (output, buffer, exit, lagged, process restart), attach/recover connect/send/completion, resize, write queue admission/drain/result and asynchronous banner/history publication. Old callbacks/chunks cannot modify retained new-binding grid or authorize input. Preserve accepted replay data; beginAttach closes gate until actual new replay completes. Already sent uncertain input is never resent on rebind.
Source-backed queue dependency: `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAttachQueue.kt:25-35,60-83,92-94` begins/fails a retained controller gate on stale request/cancellation; screen token checks alone do not prevent its internal `failAttach`.02 explicitly owns this file and `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAttachQueueBindingTest.kt`. Preserve constructor/method signatures, but require per-request captured generation/binding predicate for every admission/success/failure/cancel effect, including `beginAttach`, `fenceIfLatest` and cancellation handler `failAttach`. Old queue never closes/reopens current replay/input gates; current admitted failure still closes only its binding. Test stale connect/send/error/cancel after new same-controller binding, plus current replay-readiness behavior. No broader queue/recovery redesign.

Exact recovery-plan writer arbitration includes `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt` plus state/controller/VM/root; inspect active claims and serialize. This is the narrow acceptance-required binding repair, not terminal/auth/recovery redesign.

## Stable-task verification / real smoke recipes (future only)
Every implementation task explicitly names current source-set compile + relevant test classes + smoke + review. Stop editing first. Verifier may pause disjoint graph/mainline editors to ensure coherent compiler input; no task completes with deferred compile, tests or smoke. Task checks never import a later task's class/function/API. Documentation-only compile applicability uses installed not_applicable reason, not an implementation waiver.

- Compile command: `& .\native\android-app\gradlew.bat -p native/android-app :shared:compileKotlinJvm :androidApp:compileDebugKotlin :androidApp:compileDebugAndroidTestKotlin`; scoped tests use :shared:jvmTest --tests exact class, plus relevant :androidApp:testDebugUnitTest. Scoped reviewer must pass before evidence completion.01 pure helpers/05 graph use actual deterministic consumer smoke, not fake services/source strings.
- Default-suite isolation (bounded residual correction):01 owns FUTURE `native/android-app/shared/build.gradle.kts` configuration. Apply `exclude("**/*LiveSmoke.class")` ONLY to existing `jvmTest` task provider, not all Test tasks. Register test-only `jvmGitSmoke: Test`, dependsOn("jvmTestClasses"), with `testClassesDirs` and `classpath` from the existing jvmTest provider, and `include("**/*LiveSmoke.class")`. Do not copy that provider's exclusion/filter to new task. No product runtime/scheduler/API/flag/dependency introduced; full default jvmTest/Q1 needs no external env.
- Same-task standalone external classes under `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/`:03 wire `GitWireLiveSmoke.kt`, diff `GitDiffLiveSmoke.kt`, sync `GitSyncLiveSmoke.kt`;04 history-query `GitHistoryQueryLiveSmoke.kt`, history-action `GitHistoryActionsLiveSmoke.kt`, rewrites/publication `GitRewriteLiveSmoke.kt`. ONLY mandatory current-server methods go there, executed by `:shared:jvmGitSmoke --tests "dev.damhopper.nativeapp.features.git.<ExactLiveSmokeClass>"` before that task completes; missing fixture fails explicit smoke, never skips/assumes. Regular tests keep deterministic local/HttpServer consumer smokes only.06 owns/migrates every live-smoke constructor caller in its same atomic cutover and reruns all six explicit classes.
-01 discovery smoke uses one-shot temporary DiscoveryProbeLiveSmoke class in its already-owned GitContractTest.kt, an observable real test body. Default jvmTest with live env absent must not execute it; explicit jvmGitSmoke --tests exact probe must execute it. Remove temporary class after recording discovery/body/results evidence, no permanent wiring/source-text assertion. No future03 class or07 fixture required for this configuration check.
- S-WIRE/S-DIFF/S-SYNC/S-HISTORY/S-REWRITE: configure test-only `DAMHOPPER_GIT_SMOKE_SERVER_URL`, `DAMHOPPER_GIT_SMOKE_AUTH_TOKEN`, `DAMHOPPER_GIT_SMOKE_PROJECT` and explicit scenario WT/root ONLY for the corresponding standalone *LiveSmoke class through jvmGitSmoke. Use existing current-server binary/prebuilt application_e2e_seed, protected --stdin secret input, disposable config/SQLite/registry/Git+bare remote and existing authenticated bootstrap; no07 fixture/dependency installation/product server edit. Missing fixture blocks explicit task smoke, not deterministic default JVM/Q1. Boundary doubles cover controlled races but do not replace required real-server smoke.
- Setup smoke with existing documented seed/current daemon CLI: `application_e2e_seed --stdin` with JSON `{ "sqlite_path":"<isolated-auth.db>", "server_token":"<isolated-signing-secret>", "username":"git-fixture" }` over protected stdin (optional mongodb_uri/database/session_id omitted; source example52–60), then `dam-hopper-server --config <disposable-registry.toml> --host 127.0.0.1 --port <isolated-port>` under isolated APPDATA/config and DAM_HOPPER_LITE_MODE=true/DAM_HOPPER_AUTH_SQLITE_PATH. Consume actual SeedOutput camelCase token/username/sessionId/database/expiresAt (example62–69), never use signing secret as bearer; no production credentials. Temporary directories/processes only. Independently run `git -C <repo> status --porcelain=v2 --untracked-files=all`, `ls-files --stage`, `rev-parse <ref> <ref>^{tree}`, `diff --binary`, `diff --cached --binary`, `cat-file -p`, bare remote `rev-parse`; compare before/after to actual app/controller actions, not app echo.
- S-ROOT06 uses SAME-TASK `FocusedGitRootSmokeTest` (installed Compose/ActivityScenario deps already present), secure fixture profile bootstrap plus server auth refresh returning verified user, actual MainActivity Git clicks/back/dirty Cancel and unchanged PTY evidence. Direct Gradle connected class command with mandatory args runs before06 completes. Device absence blocks06 root smoke, not a reason to defer its task evidence to07.07 later extends all10 criteria and physical ARM64/API29/form-factor qualification.
-07 fixture task independently runs Node `--self-test` (protocol/CLI/negative checks) and `--smoke-current-server` (real authenticated server/Git/proxy oracle) implemented in that task, WITHOUT ADB/journey class. Only next07 task creates/compiles/runs NativeGitWorkspaceJourneys via Q2.07 full current-server/device/Q1–Q6 gates are additional, not prerequisites masquerading as later work.

No checks run during authoring. Old source-wording suites are not runtime evidence; remove obsolete owned assertions rather than re-pin new text. No fixed coverage/performance/timeline threshold. Parent owns installed source.load check (observed F3 failure not rerun here), independent targeted follow-up and final plan validation; no hydration/alternate task engine.

Legacy overlap: link `plans/261015-1647-android-native-app/plan.md` from overview; exact superseded source phase is `plans/261015-1647-android-native-app/phase-12-complete-git-and-safe-history-workflows.md` in prose only, never an external phase Markdown link in overview. Broader Phase18/19 obligations remain.

## Failure, security and rollback invariants
- No mutation retry loop/offline queue; outcome ambiguity retained and reconciled per original owner.
- Auth/TLS/token restrictions unchanged. Do not log tokens, raw remote URLs, full messages/file content or sensitive terminal commands in reports.
- Generic mutation guard is client safety, not global transaction/remote CAS. External process races can still be rejected by server; display actual block.
- Rollback installed Android client change set to previous qualified build; preserve remote refs/index/files/PTYS. No server deployment or destructive Git reset as rollback.
- Required implementation gates remain pending. Unresolved product choices: none. Parent independent review/validation not claimed here.
