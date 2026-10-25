# Native Traditional terminal Agents contracts

Status: proposed freeze; P2; all implementation pending. Phase01 must establish these signatures before either branch. This document is design authority, not implemented API evidence. [Evidence](design-evidence.md) supplies verified source and decisions; existing Kotlin PascalCase filenames prevail. Types below live in `dev.damhopper.nativeapp.features.terminal` unless explicitly stated. Collections exposed as read-only snapshots; producers defensively copy mutable input at publication, never leak mutable backing collections.

## 1. Scope and type ownership

All retained open/selectable Traditional terminal tabs in **already-registered retained workspaces on already-attached runtimes**. Never discover/register another workspace from server inventory; never connect another saved profile or keep a socket alive for the roster. Existing process-retained workspace map remains authoritative. No process-death PTY/output persistence. No backend, wire schema/enum, notification policy, scheduler, flag, connection manager or periodic polling addition.

Phase01 creates only four narrow contract files under `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/`: `TerminalAgentsModels.kt`, `TerminalAgentsProjection.kt`, `TerminalAgentsPorts.kt`, `TerminalAgentsSidebarModels.kt`. No implementation in these ports and no additions to huge root/VM files until Phase04. Phase02 implements ports; Phase03 consumes immutable presentation types/callbacks. Contract edits after freeze stop both branches and require coordinator-approved propagated revision, not aliases/shims.

## 2. Qualified ownership, membership and inventory

Use existing `ConnectionRef`, `SocketInstanceRef`, `WorkspaceFileOwner`, `TerminalSessionDetailed`, `TerminalAgentStatusRow`, `AgentStatusState`; do not duplicate transport identities or serialize roster types.

```kotlin
data class TerminalAgentsRuntimeKey(
    val connection: ConnectionRef,
    val socket: SocketInstanceRef,
    val attachmentIncarnation: Long,
    val endpoint: String,
    val accountUser: String,
)
data class TerminalAgentsInstanceKey(
    val profileId: String, val terminalId: String, val incarnation: ULong,
)
data class TerminalAgentsRegistration(
    val owner: WorkspaceFileOwner, val registrationId: Long, val order: Long,
)
data class TerminalAgentsInventoryReceipt(
    val runtime: TerminalAgentsRuntimeKey,
    val requestTicket: Long,
    val invalidationRevision: Long,
    val sessions: List<TerminalSessionDetailed>,
)
data class TerminalAgentsWorkspaceSnapshot(
    val registration: TerminalAgentsRegistration,
    val runtime: TerminalAgentsRuntimeKey,
    val inventoryTicket: Long,
    val visibleTabs: List<TerminalSessionDetailed>,
    val excludedTerminalIds: Set<String>,
)
data class TerminalAgentsTarget(
    val registration: TerminalAgentsRegistration,
    val runtime: TerminalAgentsRuntimeKey,
    val instance: TerminalAgentsInstanceKey,
    val serverEpoch: ULong?,
    val statusAuthorityRevision: Long,
)
enum class TerminalAgentsRefreshReason {
    CONNECTED, FOREGROUND, SIDEBAR_OPENED, USER_RETRY, TERMINAL_LIFECYCLE,
    AGENT_MEMBERSHIP_CHANGED, ACTIVATION_VALIDATION, POST_GUARD_VALIDATION,
}
enum class TerminalAgentsInventoryHealth { CURRENT, REFRESHING, UNAVAILABLE, CONFLICT }
```

`endpoint` uses `WorkspaceFileOwner.normalizeBaseUrl`; worktrees use existing `normalizeWorktree`, not OS-dependent/case-folded paths. Required equality: non-null profileId; profile/endpoint/account match logical owner; socket.connection equals connection; registered current connection/generation/socket exactly match runtime. `registrationId` is monotonically allocated, changes on explicit close/re-register; `order` retains first-registration order through same-logical-owner rebinding. Re-registering a closed workspace cannot revive old receipts/targets.

`attachmentIncarnation` is a positive monotonically allocated retained-host token, not a socket ID or wire field. Allocate a new token whenever `AgentRuntimeHost` replaces the WsConnection **object**, including same ConnectionRef and equal `sock-1` values; do not reset the sequence during retained-host lifetime. Retain it through events from that attachment, capture it in every inventory/status publication and activation target via runtime key, and check it before accepting cache writes, pruning/purging, request completion or navigation. Old attachment callbacks may neither rebind nor erase a successor. Logical display-cache identity remains only profile + normalized endpoint + authenticated account; its cached targets retain their old token and cannot silently upgrade to a replacement.

**Pure membership algorithm:** iterate registrations by `order`, use accepted server inventory in its accepted tab-list order, join against explicitly published visible/selectable tab membership for that registration. A fresh candidate requires accepted current-owner inventory, matching ID/incarnation in published tab and inventory, alive, `sessionType == "traditional"`, not targetUnavailable, not locally destroying/excluded, exact project and normalized nullable worktree equal registered owner. Canonical workspace is selected by metadata, never active workspace or map iteration. Only already-registered exact metadata match can own it. Cached-display exception uses the last successfully qualified inventory/tab/status join of the same logical owner as described below; it never establishes fresh authority. Native correction: roster worktree matching is deliberately narrower than today's terminal screen project-only selector; do not blanket change unrelated selection behavior.

Dedupe key is `(profileId, terminalId, incarnation)`, not bare ID, command or controller. Same key in identical canonical metadata emits once. Conflicting duplicates, incompatible metadata or simultaneous incarnations of one profile/ID in one accepted response fail closed for that terminal, mark inventory CONFLICT and offer refresh; no guessing. No matching authoritative agent observation means **no agent row**: never infer harness from process name or manufacture Unknown status. Runtime-level errors/Unsupported can still show as sidebar diagnostics without inventing agents. Status-less open PTYs are not agent counts.

### Publication and refresh authority

Composition-local `sessions` in `ProjectTerminalScreen` is not retained membership; controller keys are not a substitute. Phase04 publishes each successful accepted tab projection into the retained service with its registration and inventory receipt. On panel switch/unmount, keep registered membership. On workspace explicit close, retire exact registration. Runtime inventory reconciliation derives new selectable lists for **every already-registered workspace for that runtime**, including inactive ones, applying their last explicit exclusion set. Accept results only for live logical identity, current runtime and current ticket/revision. Screen requests consume the shared accepted inventory instead of fetching full server lists per workspace.

The existing `AgentRuntimeHost` socket-bound collector is the only new event observer. Existing connected baseline, foreground, sidebar opening, manual retry, lifecycle/exit/restart, agent removal/invalidation and mismatching incarnation trigger a coalesced `listDetailed` refresh once per runtime. Each trigger increments invalidation revision; one in-flight fetch may be shared, but an invalidation during it schedules a trailing fetch. Do not drop that invalidation because a job is active; do not spin retry on failure. Retained runtime scope owns jobs, cancellation, receipts and teardown. Activation may join only an appropriately fresh fetch: post-confirmation validation must start after confirmation, never join a pre-confirmation fetch.

`TerminalLifecycle.generation` is NOT PTY incarnation; `ProcessRestarted` has none. These messages invalidate inventory, not directly delete/replace instances. `TermExit` may directly prune only when its non-null incarnation exactly matches the owned instance; otherwise reconcile. Agent-status removal removes exact observation and invalidates inventory; it does not by itself prove terminal deletion. Missing lifecycle evidence marks cached state unavailable until reconciliation, never leaves an inactive stopped terminal Working.

## 3. Effective availability and observation cache

```kotlin
enum class TerminalAgentsAvailability { READY, UNAVAILABLE, PLATFORM_UNQUALIFIED, UNSUPPORTED }
enum class TerminalAgentsSnapshotFailure { HTTP_NOT_FOUND, OTHER }
data class TerminalAgentsRuntimeSnapshot(
    val runtime: TerminalAgentsRuntimeKey,
    val isCurrentIdentity: Boolean,
    val isCurrentConnectedSocket: Boolean,
    val inventoryHealth: TerminalAgentsInventoryHealth,
    val inventory: TerminalAgentsInventoryReceipt?,
    val statusBaselineInstalled: Boolean,
    val statusAuthorityRevision: Long,
    val status: AgentStatusState,
    val snapshotFailure: TerminalAgentsSnapshotFailure?,
    val cachedObservations: List<TerminalAgentStatusRow>,
)
data class TerminalAgentsProjectionInput(
    val workspaces: List<TerminalAgentsWorkspaceSnapshot>,
    val runtimes: List<TerminalAgentsRuntimeSnapshot>,
    val profileLabels: Map<String, String>,
)
```

Runtime/registry/auth/socket truth overrides cached READY. Purged/invalid logical identities produce no rows. Same logical owner across disconnect/generation/socket replacement can retain last qualified membership + observations for display only; use UNAVAILABLE until current socket, accepted inventory and status baselines requalify. For cached display, locate runtime by profile/normalized endpoint/account, permit its `inventory` receipt/workspace runtime to retain the prior connection/socket, and join cachedObservations against that prior accepted tab snapshot only. A current response supersedes that cache; never mix old observation incarnation with new metadata. Cached target retains its captured old runtime and is refused on click; never silently upgrade a click to a successor. Epoch replacement likewise invalidates captured routing authority. Cache is display-only, not notification/reducer admission or a second status store authority.

Effective precedence: identity lost => purge; not current connected socket or inventory not CURRENT => UNAVAILABLE; current typed snapshot HTTP404 => UNSUPPORTED; other snapshot failure or missing installed baseline => UNAVAILABLE; installed `PLATFORM_UNQUALIFIED` => PLATFORM_UNQUALIFIED; installed wire UNAVAILABLE => UNAVAILABLE; only qualified wire READY => READY. Snapshot loading/invalidation closes current qualification (cached rows may remain unavailable). A successful current snapshot clears the typed failure. An HTTP404 on a superseded capture cannot affect the successor.

Use existing `ApiRequestError.status == 404` in `AgentStatusReducer.reloadSnapshot`; add `AgentStatusState.snapshotFailure: TerminalAgentsSnapshotFailure?` with capture-qualified reset/publication. Preserve `lastError` for human diagnostics but never parse its text. No new `AgentStatusAvailability` wire value and no second snapshot requester. Preserve reducer silent baseline, high-water/tombstones, event admission and notification filters. Roster projection/refetch/filter never emits attention or invokes notification delivery.

Reducer `AgentStatusState` also exposes `routeAuthorityRevision: Long = 0`. Increment it under the existing reducer mutex whenever binding/retirement, epoch, baseline installation/loading/closure/invalidation or typed snapshot-failure authority changes; ordinary same-baseline status-row updates do not create a new route fence. RuntimeSnapshot/target capture this exact value, not an asynchronously sampled revision mirror. Final admission checks it under the same reducer mutex; presentation still does not become notification admission.

Required HTTP404 qualification is a controlled **real HTTP** loopback response through real Ktor ApiClient -> TerminalRepository -> this existing reducer -> native projector, owned by Phase04 `TerminalAgentsHttpAvailabilityTest.kt` with an in-file ephemeral JDK HttpServer fixture following ApiClientTest. Assert typed current404, stale capture rejection, non404 text independence and request count/no automatic loop. No method-return mock, product hook, dependency or old-version artifact. It is explicitly not older-server compatibility; current real two-server MainActivity qualification is separate.

## 4. Pure status, groups, filter and cycling

```kotlin
enum class TerminalAgentsStatus { NEEDS_ATTENTION, WORKING, IDLE, UNKNOWN, UNAVAILABLE, PLATFORM_UNQUALIFIED, UNSUPPORTED }
sealed interface TerminalAgentsFilterSelection {
    data object All : TerminalAgentsFilterSelection
    data class Selected(val statuses: List<TerminalAgentsStatus>) : TerminalAgentsFilterSelection
}
data class TerminalAgentsPresentation(
    val status: TerminalAgentsStatus, val reason: BlockedReason?,
    val doneTurnEnded: Boolean, val source: AgentObservationSource,
    val coverageHint: String?,
)
data class TerminalAgentsRow(
    val target: TerminalAgentsTarget,
    val projectLabel: String, val profileLabel: String, val terminalTitle: String,
    val agentKind: AgentKind, val presentation: TerminalAgentsPresentation,
)
data class TerminalAgentsGroupKey(
    val workspace: WorkspaceFileOwner, val status: TerminalAgentsStatus,
    val reason: BlockedReason?,
)
data class TerminalAgentsGroup(
    val key: TerminalAgentsGroupKey,
    val projectLabel: String, val profileLabel: String,
    val members: List<TerminalAgentsRow>,
    val agentKinds: List<AgentKind>, val sources: List<AgentObservationSource>,
    val coverageHints: List<String>, val doneTurnEnded: Boolean,
)
data class TerminalAgentsCounts(val all: Int, val byStatus: Map<TerminalAgentsStatus, Int>)
data class TerminalAgentsProjection(
    val rows: List<TerminalAgentsRow>, val groups: List<TerminalAgentsGroup>,
    val counts: TerminalAgentsCounts, val filteredCount: Int,
)
interface TerminalAgentsProjector {
    fun rows(input: TerminalAgentsProjectionInput): List<TerminalAgentsRow>
    fun project(input: TerminalAgentsProjectionInput, selection: TerminalAgentsFilterSelection): TerminalAgentsProjection
    fun nextTarget(group: TerminalAgentsGroup, active: TerminalAgentsInstanceKey?): TerminalAgentsTarget?
}
interface TerminalAgentsFilterCodec {
    fun decode(raw: String?): TerminalAgentsFilterSelection
    fun encode(selection: TerminalAgentsFilterSelection): String
    fun normalize(statuses: List<TerminalAgentsStatus>): TerminalAgentsFilterSelection
}
```

Implement `DefaultTerminalAgentsProjector`, `DefaultTerminalAgentsFilterCodec`. `rows` joins exact membership/status incarnation, dedupes and preserves accepted registration/tab ordering. Availability maps first, then READY state: blocked=>Needs attention (Approval/Question/Error only for blocked), working=>Working, idle=>Idle, unknown=>Unknown. `doneTurnEnded` only READY+IDLE+ENDED+null turnId, secondary text “Done (turn ended)” never task success. Source labels “Lifecycle observation”/“Hook observation”; hooks show “Hook observation (limited coverage; quiet reasoning and long waits become Unknown)”.

`project` counts all qualified rows before filtering; initialize all seven status counts to zero, `all=rows.size`. Filter presentation status, then group by canonical workspace/status/reason. `rows` in result remains unfiltered for count/cycle reference; `groups` and filteredCount reflect filter. Projects keep first eligible encounter, statuses fixed as enum order above, reasons alphabetically by rendered English label with null first, harnesses OMP/CODEX/CLAUDE, member tab order unchanged. Preserve unique source/coverage hints in encounter order. Done hint shown only when unanimous. Empty groups prohibited. `nextTarget` returns next exact active member/wrap, first if active elsewhere, null for defensive empty input; never bare-ID cycling across profiles.

Filter normalized list is deduplicated and canonical status order; empty/all-seven=>All. Decode missing/unreadable/invalid=>All; accept `all`, exact English scalar labels, JSON arrays of valid English labels, discarding invalid array members. Save All as `all`, singleton as scalar, multi as canonical JSON array. This defensive decoder does not imply legacy native bytes exist or authorize a migration.

## 5. Dedicated device-local store

```kotlin
interface TerminalAgentsFilterStore {
    fun load(): TerminalAgentsFilterSelection
    fun save(selection: TerminalAgentsFilterSelection)
}
```

`AndroidTerminalAgentsFilterStore(context: Context, codec: TerminalAgentsFilterCodec)` uses application Context + dedicated SharedPreferences file `terminal_agents_sidebar`, key `status_filter`. Load never writes/removes; save only user filter actions. Storage failures do not crash UI or mutate remote prefs; preserve selected process-local value. No profile names, IDs, commands or observations persisted. No WorkbenchPreferences, settings envelope, sync, export or source-A changes; no invented web-to-native/legacy-key migration. Adapter tests exercise bytes and actual preference calls, not code-string scans.

## 6. Retained service and controlled Compose ports

```kotlin
data class TerminalAgentsActivationReceipt(val requestId: Long, val result: TerminalAgentsActivationResult)
sealed interface TerminalAgentsActivationResult {
    data object Committed : TerminalAgentsActivationResult
    data class Deferred(val requestId: Long) : TerminalAgentsActivationResult
    data class Refused(val reason: String) : TerminalAgentsActivationResult
}
data class TerminalAgentsState(
    val projection: TerminalAgentsProjection,
    val filter: TerminalAgentsFilterSelection,
    val loading: Boolean, val refreshNotice: String?,
    val lastActivation: TerminalAgentsActivationReceipt?,
)
interface RetainedTerminalAgentsService {
    val state: StateFlow<TerminalAgentsState>
    val inventories: StateFlow<Map<TerminalAgentsRuntimeKey, TerminalAgentsInventoryReceipt>>
    fun registerWorkspace(owner: WorkspaceFileOwner): TerminalAgentsRegistration
    fun closeWorkspace(registration: TerminalAgentsRegistration)
    suspend fun refreshInventory(runtime: TerminalAgentsRuntimeKey, reason: TerminalAgentsRefreshReason): TerminalAgentsInventoryReceipt?
    fun publishWorkspaceTabs(registration: TerminalAgentsRegistration, receipt: TerminalAgentsInventoryReceipt, visibleTabs: List<TerminalSessionDetailed>, excludedTerminalIds: Set<String>)
    fun setFilter(selection: TerminalAgentsFilterSelection)
    suspend fun activate(target: TerminalAgentsTarget): TerminalAgentsActivationReceipt
}
```

`RetainedRootServices` adds `val terminalAgents: RetainedTerminalAgentsService`; VM constructs exactly one implementation in retained runtime scope. No Activity/composable scope retained. Register only with authenticated server-returned account and normalized endpoint, not root fallback label identities. Runtime host/coordinator internal methods attach current runtime, accept reducer state, invalidate/reconcile and retire exact identity; these are not new sockets. Root fallback `ProjectTerminalScreen` caller also receives registration/service when real owner is known; if services/owner unavailable render explicit unavailable sidebar and disable navigation, never fake global membership.

`inventories` publishes only accepted current-owner/current-ticket receipts, one per runtime; remove authority entries on invalidation/transport loss/retirement while retaining display cache privately. Active terminal screens collect their exact runtime receipt and update composition-local selectable session state from it, so background refresh does not leave the mounted tab inventory stale. Requests and the stream share the same coalesced runtime fetch; no extra per-screen requester. `publishWorkspaceTabs` updates visible/excluded membership from that exact receipt without itself initiating another fetch or echo loop. Screen disposal stops its collection but does not close registration.

`activate` returns receipt for this request, not global latest. Immediate valid no-guard commit returns Committed; accepted dirty guard returns Deferred(requestId), which is **not success**. `state.lastActivation` publishes subsequent Committed/Refused with same request ID. Cancelled/replaced request, guard cancellation/failure, owner retirement or scope teardown invalidates request token and prevents any late continuation. A newer request supersedes older deferred work without overwriting an already-active dirty prompt. User-visible explicit refusal; origin compact sheet stays open on Deferred/Refused. Close it only for matching origin/request Committed, never a different request's commit.

```kotlin
enum class TerminalAgentsSidebarMode { PINNED, SHEET }
data class TerminalAgentsSidebarUiState(
    val projection: TerminalAgentsProjection,
    val selection: TerminalAgentsFilterSelection,
    val loading: Boolean, val notice: String?,
    val active: TerminalAgentsInstanceKey?, val activationPending: Boolean,
)
data class TerminalAgentsSidebarCallbacks(
    val onGroupClick: (TerminalAgentsGroupKey) -> Unit,
    val onFilterChange: (TerminalAgentsFilterSelection) -> Unit,
    val onRefresh: () -> Unit,
    val onOpenSettings: () -> Unit,
    val onDismiss: () -> Unit,
    val onPopupVisibilityChanged: (Boolean) -> Unit,
)
```

Phase03 exports in `ui.components`:
`@Composable fun TerminalAgentsSidebar(state: TerminalAgentsSidebarUiState, mode: TerminalAgentsSidebarMode, callbacks: TerminalAgentsSidebarCallbacks, modifier: Modifier = Modifier)`; internal `TerminalAgentsFilterMenu` and `TerminalAgentsGroupRow` take only immutable data + callbacks. UI never reaches repositories/navigation/storage/service nor recomputes grouping. Group callback resolves latest group/active instance through projector in Phase04, then captures exact target before asynchronous work. Controlled filter menu toggles normalized status sets (All or multi-select); transient menu expansion may remain local UI state, not authoritative selection. Distinguish no observed agents from no matching filter; counts before filter, coverage/help and refresh errors accessible. Semantic labels expose project/profile/status/reason/count/source, group count and selection state, without relying on color. No component-owned polling/jobs except ordinary ephemeral Compose UI effects.

## 7. Verified navigation and commit seam (Phase04 only)

New `ui/flow/VerifiedTerminalRoute.kt` defines:

```kotlin
data class VerifiedTerminalRoute(
    val profileId: String, val project: String, val worktreePath: String?,
    val sessionId: String, val incarnation: ULong, val notificationRouteActive: Boolean,
)
enum class TerminalRouteGate { PROCEED, DEFERRED }
data class DepartureRequest(
    val targetStage: AppFlowStage,
    val onProceed: () -> Unit,
    val onCancelled: () -> Unit,
)
```

`AppFlowNavigation.departureGuard` becomes `((DepartureRequest) -> Boolean)?`. Migrate every existing invocation and both assignment tests; no old signature shim. Existing navigate/back/project methods supply no-op cancellation callbacks, preserve existing routing. `WorkspaceDepartureIntent.WorkspaceLeave` gains `onCancelled: () -> Unit`; all constructions (workspace root, Settings-reset root, tests) supply it explicitly. Prompt cancellation/rejection/supersession/retirement invokes cancellation exactly once; successful clear-before-proceed must not invoke it. Separate `clearPendingDeparture()` cancellation from `completePendingDeparture(intent)` success so Save/Discard do not cancel their own continuation. A failed Save invalidates pending roster activation; existing dirty error UI remains and ordinary notification/departure retry behavior is unchanged. Coalesced new request receives cancellation, never hijacks the first prompt.

New methods on `AppFlowNavigation`:
- `fun requestVerifiedTerminalRoute(route: VerifiedTerminalRoute, onProceed: () -> Unit, onCancelled: () -> Unit): TerminalRouteGate`: same exact workspace=>PROCEED; otherwise calls existing guard with callbacks, returns DEFERRED if intercepted. Does not mutate route/profile/session. On PROCEED caller starts validation/commit; on later confirmed callback caller launches retained asynchronous validation.
- `fun commitVerifiedTerminalRoute(route: VerifiedTerminalRoute): Unit`: admitted, non-suspending mutation-only entry into the **same private route-state commit** used by existing routing. Caller must hold all authority gates below; method does not revalidate, invoke user callbacks, cancel its own request, log, launch jobs, persist or attach controllers. Ordinary navigation invalidates pending roster requests before routing; this admitted path does not call that ordinary invalidator.
- Existing notification `routeToTerminal` remains its current public semantic API (Boolean committed-or-deferred), delegates its existing synchronous revalidation + guard path into that same private commit. Preserve nullable notification session/generic behavior, notificationRouteActive=true, attention admission, read/feed effects and auto-switch preference. Manual route uses notificationRouteActive=false. Do not substitute notification resolver/target for manual activation.

`AppFlowState` adds `requiredTerminalInstance: TerminalAgentsInstanceKey? = null`, a captured exact-selection intent (not a feature flag). Verified manual commit sets it; existing notification route keeps its existing behavior and does not invent an incarnation. Root forwards it through both workspace and fallback paths as `ProjectTerminalScreen(requiredTerminalInstance: TerminalAgentsInstanceKey? = null)`. For an exact intent, refresh/attach selects only that ID+incarnation: if missing/restarted it shows explicit refusal/refresh state and never executes `selectable.firstOrNull()`. Retain the requirement until deliberate different session/route selection; same-target attachment callbacks must not accidentally clear it. Clear on explicit different session/project/profile/back navigation. This closes the post-commit-to-screen-inventory race without changing ordinary terminal or notification fallback policy.

### Local admission protocol and exact Phase04 APIs

Main-thread execution alone is **not** authority serialization: runtime collectors run Default. Use this concrete order for the final local transaction: **await ProfileRepository mutex -> await ConnectionRegistry.admitCurrentOwner -> try roster authority gate -> try captured WsConnection.lifecycleMutex -> try captured AgentStatusReducer mutex**. Everything after registry acquisition is nonblocking and released in reverse order in `finally`; no network, persistence, coroutine launch, join, reentry or unknown callback inside. All final UI mutations execute on Main, but Main is only the UI-write requirement, not the concurrency proof.

Freeze these narrow APIs in existing owned files (enums declared beside their API, not wire models):
- `ProfileRepository.kt`: `enum class ProfileRouteAdmission { COMMITTED, BUSY, STALE }`; `suspend fun commitExistingProfileRoute(connection: ConnectionRef, endpoint: String, accountUser: String, admitRoute: (publishActiveProfile: () -> Unit) -> ProfileRouteAdmission): ProfileRouteAdmission`. It awaits its existing mutex, checks exact profile/endpoint/auth account, then awaits registry admission. Its supplied `publishActiveProfile` is a fixed non-suspending `_activeProfileId.value = connection.profileId` operation, called **inside the deepest admitted leaf**, not after inner gates unlock. `admitRoute` is exclusively the private known roster/socket/reducer chain below, not an extensible/user callback. Registry denial before callback => STALE.
- `WsConnection.kt`: `enum class WsSocketAdmission { COMMITTED, BUSY, STALE }`; `fun tryAdmitCurrentSocket(expected: SocketInstanceRef, commit: () -> Boolean): WsSocketAdmission`. Use `lifecycleMutex.tryLock()` only; BUSY if unavailable (including same-coroutine reentry), otherwise compare private activeSocketRef and Connected state on this captured object, STALE if unequal, then invoke only the known next admission step. Boolean false means no commit. Unlock in `finally`. Do not use an overrideable/cached activeSocketRef read as locked authority or change connect/close behavior.
- `AgentStatusReducer.kt`: `enum class AgentRouteAdmission { COMMITTED, BUSY, STALE }`; `fun tryAdmitTerminalAgentsRoute(owner: ConnectionRef, socket: SocketInstanceRef, expectedEpoch: ULong?, expectedAuthorityRevision: Long, commit: () -> Boolean): AgentRouteAdmission`. Try existing mutex, BUSY on contention; while locked compare actual bound owner/socket, actual known epoch (null before known baseline) and `routeAuthorityRevision`, STALE on mismatch. Do not require READY/admissionOpen for manual selection. Invoke only the known mutation leaf on match; unlock in `finally`.
- `ProjectTerminalState.kt`: `fun commitVerifiedSelection(instance: TerminalAgentsInstanceKey): Unit` writes already-prevalidated active ID/selection epoch only, no logger, caller callback, attach/controller creation or IO. `ProjectWorkspaceState.kt`: `fun commitVerifiedTerminalSelection(instance: TerminalAgentsInstanceKey): Unit` sets its TERMINAL panel plus that exact terminal selection, using the mutation-only hook. Ordinary input-policy/log/attachment effects happen after admission releases; they cannot reclassify the committed receipt.

Nested result propagation retains an inner BUSY even when its enclosing Boolean callback returns false; otherwise stale predicates => STALE. Map BUSY to explicit `Refused("Terminal state is busy. Try again.")`; no spin, queued automatic retry or reuse of stale evidence. A new user click captures/fetches afresh. Awaited profile/registry locks keep their existing semantics; only the nested independent gates use try-admission.

Roster gate is one narrow Android `ReentrantLock` in `TerminalAgentsInventoryCoordinator.kt`, shared by inventory/service/activation/host mutations. Synchronous Phase01 ports remain synchronous: register/close/publish/filter use short ordinary producer lock sections with immediate real results, not queued/throw-on-busy/suspend-only behavior. Ordinary UI/runtime producers hold no profile/registry/socket/reducer lock; callbacks publish after source locks release. Exception is the existing retirement caller's already-held outer profile mutex: its roster barrier acquires only its own short gate, never registry/socket/reducer/profile reentry, releases before child drain, and children cannot depend on caller-held gates. Admission exclusively tryLocks roster gate. No suspension, store save, network, observer-dependent effect or drain under it; registry callback never waits. Reentrant cancellation of COMMITTING/COMMITTED request cannot rewrite it; ordinary cancellation of other pending requests remains effective.

| Mutation / authoritative source | Required exclusion / boundary |
|---|---|
| Profile/account/endpoint/auth and active-profile publication (`ProfileRepository.kt`) | Existing profile mutex; profile publication additionally inside final nested leaf; no profile reentry |
| Registry generation/current-owner/retirement (`ConnectionRegistry.kt`) | Existing registry admission; no registry reentry or blocking below it |
| Host attachment map/token, registration/order/close, inventory ticket/revision/current receipt, visible/excluded membership, cache accept/purge, activation tokens/cancellation (`NativeWorkspaceViewModel.kt`, inventory/service/activation coordinators) | Every read/write affecting admission under the **same roster gate**, including ordinary navigation cancellation; never treat a StateFlow collector/mirror as authority |
| Current socket/connect/close/failure (`WsConnection.kt`) | Existing lifecycleMutex; final helper try-locks that exact captured object while roster gate proves attachment object/token is still current |
| Epoch/binding/baseline/failure/routeAuthorityRevision (`AgentStatusReducer.kt`) | Existing reducer mutex; final helper try-locks it, not sampled status StateFlow |
| Retained panel/session, flow exact target, active profile, matching Committed receipt | Main + **all five exclusions held**; fixed mutation-only operations, no unknown callback |

Before the first mutation, validate exact attachment/map/token, registration incarnation, inventory ticket/revision and live/traditional/alive/nonexcluded project/worktree/ID/incarnation plus locked socket/reducer/profile facts. Then execute only: mark this request COMMITTING; write retained TERMINAL panel/exact selection; write flow route/requiredTerminalInstance; call fixed `publishActiveProfile`; install this request's terminal COMMITTED record and matching `state.lastActivation` receipt. This bounded leaf is the **local linearization point**. All preconditions established before mutation, no failure-capable/user operations afterwards. The self route does not invoke ordinary navigation cancellation; synchronous/reentrant cancellation observing COMMITTING/COMMITTED is a no-op for this request, not a later Refused overwrite. StateFlow publications do not rely on observer execution. After reverse unlock, apply UI/controller policy, notices, sheet close and metadata persistence; cancellation/failure/retirement after linearization cannot erase/reclassify the actual Committed receipt.

Retirement/replacement first revokes exact attachment/registration/request authority under roster gate, releases it **before** awaiting runtime children/provider/drain, and never reacquires profile/registry from the barrier. Preserve the existing outer ProfileRepository retirement discipline: caller may already hold its profile mutex across registry retirement, but the roster barrier acquires no profile/registry gate, no child requires/reenters those caller-held gates, and no newly acquired roster/socket/reducer gate spans drain. This plan does not restructure unrelated retirement. Late callbacks check attachment token before cache/purge writes. Admission excludes competing local authority mutations, not future server change; requiredTerminalInstance covers postcommit server/screen race. No new runtime/scheduler/connection.

Activation algorithm in retained `TerminalAgentsActivationCoordinator.kt`:
1. Capture target with attachmentIncarnation/statusAuthorityRevision and request/origin token; check logical identity/account/endpoint/generation/current attachment/socket/epoch. Request ACTIVATION_VALIDATION; require live detailed metadata matching ID/incarnation/alive/traditional/project/worktree. Unknown/Unavailable/Platform unqualified/Unsupported presentation alone is not manual navigation denial.
2. Request guard without selection effects. PROCEED uses freshly fetched evidence only while its fences remain exact; DEFERRED returns request receipt. Cancellation/failure invalidates token under roster gate.
3. After confirmation start **fresh async listDetailed after confirmation**, never join an older fetch or use synchronous-only revalidation. Recheck all captured authority before/after fetch; require matching attachment, incarnation/metadata and captured reducer fence. Refuse stale target rather than upgrading it.
4. On Main enter the exact nested admission above. BUSY/STALE => explicit Refused without route/profile/session mutation. Only the admitted leaf publishes matching Committed and permits origin-sheet close. Deterministic tests contend each gate, invalidate before admission, replace equal-value socket attachments, cancel reentrantly and invalidate immediately after commit; receipt must remain truthful.

## 8. Overlay and Settings authority

Only Terminal panel exposes inline Agents trigger; >=600dp left pinned 280dp, phone sheet clamped to available width. Process-retained open/filter/selection survive rotation without duplicate host/PTY recreation. No new global nav/FAB/rail or general overlay framework. Pinned sidebar focus/menus suspend terminal input unless terminal actually owns focus; terminal input also requires every existing panel/foreground/authority predicate.

ONE root effective cover enumerates **privacy, Settings, workspace search, pending departure dialog, local terminal create/kill/diagnostics/touch-or-keyboard-modal popups, sidebar popup, compact Agents**. Preserve hidden-panel/authority predicates too. Existing owned root/workspace/terminal files suffice; keep a narrow cover record/helper in `TerminalAgentsSidebarHost.kt`, not a parallel overlay stack. `ProjectTerminalScreen(onLocalCoverChanged: (Boolean) -> Unit = {})` reports the OR of its actual local modal/popups upstream with exact host-owner token; disposal clears only its own source. Sidebar `onPopupVisibilityChanged` reports its actual filter/help popup. Neither child calls `setInputSuspended(false)` or controls another source. Root recomputes/apply cover synchronously on transitions, including fallback path, and retains cover while any source remains active.

Minimal exclusivity: opening Agents is disabled/refused while search, departure, terminal local modal, Settings or privacy is active. While compact Agents is open, root search/panel/Projects shortcuts and corresponding route controls are consumed/disabled (except existing privacy/emergency dismissal); no routing under the sheet. A group activation may open its departure dialog **above** the sheet; Settings/privacy may intentionally supersede it. Sidebar-popup -> Settings, sheet -> departure, privacy/Settings changes and resize update effective source replacement before dismantling the old surface: no uncovered frame or transient terminal focus restoration. Search -> Agents and local-modal -> Agents attempts do nothing, not close another surface behind the user. Do not repair unrelated popup behavior.

Back/Escape dispatches to the **actually rendered topmost** covering surface/owned popup: its own dismissal/cancellation consumes first; lower Agents never steals Back from privacy/Settings/departure/search/local modal. With only compact Agents, close it before route back. Use existing composition/owned handlers plus exclusivity, no arbitrary static priority stack. Compact scrim consumes touch and hides IME; privacy masks sidebar too. Restore terminal focus only after effective cover is empty, terminal panel visible/eligible and terminal explicitly regains focus; pinned sidebar/search/popup focus is not terminal focus. Hardware/accessory/native IME input and global shortcuts obey this same cover. Resize never clears Settings/search/departure/local cover just because Agents becomes pinned.

Settings context = selected/current workspace B, not clicked group; validate captured logical owner or show explicit target choice, no ambient fallback. SettingsOverlay retains `hostSection: String?`, `targetProfileId: String?`, origin and existing subSection. `openAgentSettings(origin: SettingsOrigin, targetProfileId: String?)` opens existing HOST/AGENTS. Freeze added SettingsScreens parameters as **optional UI defaults**: `initialHostSection: HostSettingsSection = HostSettingsSection.USAGE`, `onHostSectionChanged: (HostSettingsSection) -> Unit = {}`. These intentionally preserve the compiled dormant WorkbenchScreen caller (no new alias, no Workbench migration); active root explicitly supplies retained HOST/AGENTS intent and callback, forwarding existing SettingsHostView ports. Invalid names fall back safely, new intent updates remembered section deterministically. Existing queued `settingsRepository.setSettingsTarget(B)` remains independent of source A; services blocked until selected B and exact binding match. Preserve source A/target B labels, return panel/session/dirty editor; no Agent Store route.

## 9. Freeze and failure boundaries

Phase01 proof-of-freeze: all four files contain the above immutable types/ports, existing imports resolve against verified source, no pure/runtime/UI implementation added, signatures and nullable/default semantics match this contract; coordinator records shared API acceptance before both branches start. Later integration-only method additions above are owned solely by Phase04, already frozen here for planning.

No tests/builds/device evidence obtained by this plan. Phase05 specifies actual qualification. Related notification W1/W2/W3, editor writers, source reconciliation and writer release are external prerequisites, not repairs or closed findings. Existing broader Android caveats remain. Roll back feature by reverting only its exclusive changes and dedicated local key; preserve unrelated feature changes, notification policy, remote config and server PTYs. No flag-based parallel path or compatibility shim.

## Unresolved questions

No product/contract questions. [Plan review and final validation](reports/final-validation.md) complete at design/artifact level only. Implementation prerequisites remain explicit overlapping-writer release/current-source reconciliation and honest runtime/device/server availability; no implementation or native qualification is implied.
