# Phase 04 — Retained runtime, navigation and root integration

Priority P2 · status Complete (administrative; review caveats retained) · owner: ONE retained integration implementer · execution: serial G3 after both branches and writer-release gate. No time estimate.

## Durable tasks

```evcrate-tasks
[
  {
    "id": "reconcile-retained-agent-roster",
    "title": "Integrate retained owner-qualified inventory and typed status availability",
    "blocked_by": [
      "implement-roster-local-store",
      "author-sidebar-ui-tests"
    ],
    "allowed_files": [
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/TerminalAgentsInventoryCoordinator.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/AgentStatusReducer.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/AgentStatusReducerTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/TerminalAgentsInventoryCoordinatorTest.kt"
    ],
    "constraints": [
      "ONE Phase04 integration owner; first obtain explicit cross-plan writer release/current-source W1/W2/W3 prerequisite disposition.",
      "Use only existing attached runtime socket-bound collector, one shared listDetailed reconciler per runtime and one existing snapshot requester.",
      "No periodic polling/new connection/socket/keepalive/scheduler/flag/backend/wire enum or notification-policy change.",
      "Preserve outer retirement discipline: roster barrier never reenters profile/registry; revoke under its own gate then release before child drain, whose children must not need caller-held profile/registry locks."
    ],
    "acceptance": [
      "Publication/cache/purge/activation capture fences include endpoint/account/ConnectionRef/socket plus monotonic host attachmentIncarnation, ticket/revision, registration and reducer authority stamp.",
      "Inactive registered projects refresh from one server list per runtime; lifecycle invalidation during fetch produces trailing refresh, not lost work.",
      "Temporary offline/rebind caches remain display-only Unavailable; identity loss purges exactly affected membership/observations.",
      "Typed ApiRequestError.status 404 yields client Unsupported without text matching/second snapshot requester; notification baseline/admission/high-water unchanged.",
      "TerminalLifecycle generation is not incarnation; same-generation equal sock-1 replacement allocates distinct attachment token and old callbacks cannot publish, purge or route successor state."
    ],
    "verification": [
      "Run node scripts/run-gradle.mjs :shared:jvmTest --tests \"*AgentStatusReducerTest\" and :androidApp:testDebugUnitTest --tests \"*TerminalAgentsInventoryCoordinatorTest\" only after Phase04 lands.",
      "Controlled coroutine completions test in-flight invalidation, late replies, equal-value replacement, offline/rebind cache and current/stale404; reducer tests verify routeAuthorityRevision and typed try-admission release."
    ]
  },
  {
    "id": "implement-verified-agent-navigation",
    "title": "Add retained async guard validation and atomic exact manual route commit",
    "blocked_by": [
      "reconcile-retained-agent-roster"
    ],
    "allowed_files": [
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/TerminalAgentsActivationCoordinator.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/VerifiedTerminalRoute.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigation.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/profiles/ProfileRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectWorkspaceScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WsConnection.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/transport/WsConnectionTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigationTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceDepartureTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/profiles/ProfileRepositoryTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/TerminalAgentsActivationCoordinatorTest.kt"
    ],
    "constraints": [
      "Same integration owner; no notification admission/read/auto-switch semantics migration to manual activation.",
      "Migrate every changed departureGuard/WorkspaceLeave caller/test cleanly; no old signature wrapper or compatibility alias.",
      "Fresh listDetailed must START after dirty confirmation; final synchronous owner/epoch/token check alone is insufficient.",
      "Await profile mutex and registry, then only try roster->captured socket->captured reducer gates; explicit BUSY/STALE refusal, reverse-finally unlock, no network/persist/join/reentry/unknown callback in admitted leaf."
    ],
    "acceptance": [
      "Matching Committed request receipt linearizes with exact retained panel/session, flow and active-profile mutations under all authority exclusions; later cancellation/persistence failure cannot rewrite it.",
      "Final authority checks include attachment object/token, reducer epoch/baseline revision, registry/profile identity, registration/inventory/request tokens and exact terminal metadata; Main alone is not exclusion.",
      "Typed narrow WsConnection/reducer helpers distinguish contention from stale and release finally; existing route shares private mutation-only flow commit, no self-cancellation or async profile selection.",
      "Guard cancellation, replacement, failed Save and teardown spend request token; post-confirmation fresh request refuses disappeared/restarted target.",
      "All existing notification route tests preserve current Boolean committed-or-deferred, feed/read/auto-switch and notificationRouteActive semantics."
    ],
    "verification": [
      "Run node scripts/run-gradle.mjs :shared:jvmTest --tests \"*WsConnectionTest\" --tests \"*AppFlowNavigationTest\" --tests \"*WorkspaceDepartureTest\" --tests \"*ProfileRepositoryTest\" and :androidApp:testDebugUnitTest --tests \"*TerminalAgentsActivationCoordinatorTest\" after Phase04 terminal.",
      "Contend profile/registry and each try-gate deterministically; test pre-admission invalidation, same-value replacement, postcommit invalidation/cancellation, reentrant self-cancel and truthful immutable receipt with zero premature selection."
    ]
  },
  {
    "id": "mount-agents-and-context-settings",
    "title": "Mount one responsive sidebar with retained publication, input cover and contextual HOST/AGENTS",
    "blocked_by": [
      "implement-verified-agent-navigation"
    ],
    "allowed_files": [
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/RetainedTerminalAgentsCoordinator.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectWorkspaceScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsScreens.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsHostView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigation.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/TerminalAgentsSidebarHost.kt"
    ],
    "constraints": [
      "Same integration owner receives sequential write transfer of VM from runtime task and root/workspace/flow files from navigation task.",
      "All service/runtime lifecycle is retained; controlled components cannot own navigation/storage/input cover.",
      "Root covers privacy/Settings/search/departure/terminal modals/sidebar popup/compact Agents; minimal exclusivity and topmost Back/shortcut gating, never a new overlay framework or child-owned input reset.",
      "Selected-workspace Settings target B independent from preference source A; no ambient fallback or Agent Store route."
    ],
    "acceptance": [
      "Both workspace and fallback terminal callers collect current accepted inventories StateFlow, publish visible Traditional membership from exact receipts and pass required instance intent without per-screen refetch/echo loops.",
      "Retained roster includes inactive registered workspaces with canonical dedupe/order, not just controller keys; unmount retains and explicit close/identity loss purges.",
      "One Terminal-only inline trigger/host: >=600dp left pinned 280dp, phone clamped sheet with scrim/Back/Escape/IME/focus, no extra global navigation.",
      "Only matching Committed activation closes origin sheet; rotation/resize preserves process-local open/filter/selection without PTY recreation or duplicate host.",
      "Settings opens retained HOST/AGENTS with independent B/A; optional SettingsScreens USAGE/no-op defaults preserve compiled WorkbenchScreen caller and active root passes explicit intent.",
      "Exact selection never falls back; Agents/search/local modal opening is exclusive, compact sheet suppresses route/panel/search/Projects shortcuts, replacement/resize has no uncovered transition and topmost Back cancels the actual visible surface."
    ],
    "verification": [
      "After complete Phase04, run pnpm native-app:test, pnpm native-app:test:android and pnpm native-app:assembleDebug with recorded actual outcomes.",
      "Phase05 real MainActivity journeys prove input/focus/IME/rotation/Settings/compact-wide behavior; static source scans do not qualify this task."
    ]
  },
  {
    "id": "author-retained-integration-tests",
    "title": "Extend meaningful runtime/root/Settings/exact-selection regressions",
    "blocked_by": [
      "mount-agents-and-context-settings"
    ],
    "allowed_files": [
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModelTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/RuntimeIntegrationReadinessTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/RetainedTerminalAgentsIntegrationTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/SettingsPreferencesPhase17Test.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/ProjectTerminalVisibilityTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsExactSelectionTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceStateTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/ui/flow/AgentSettingsNavigationTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsHttpAvailabilityTest.kt"
    ],
    "constraints": [
      "Same Phase04 owner; tests-only task with no production file edits or source-text tautologies.",
      "Existing unrelated readiness W1/W2/W3 findings remain prerequisite disposition, not silently marked fixed by roster tests.",
      "Do not broaden tests to dormant Workbench Agent Store or replace real host journeys with state-only claims."
    ],
    "acceptance": [
      "Behavior tests include equal ConnectionRef/sock-1 on replacement objects, old callback purge/activation rejection, inactive freshness, and controlled real-HTTP404 through ApiClient->repository->reducer->projection.",
      "Exact-selection tests prove no first fallback for missing/restarted required instance; normal terminal/notification path behavior unchanged.",
      "Settings navigation tests show captured B HOST/AGENTS with source A unchanged, origin/session/dirty editor retained and mismatched target services blocked.",
      "Actual root/host cover tests include Agents->search shortcut, search/local modal->Agents, dirty dialog, resize overlap, reentrant cancellation, matching committed-only close and no transient input/focus lift."
    ],
    "verification": [
      "Run node scripts/run-gradle.mjs :shared:jvmTest --tests \"*TerminalAgentsExactSelectionTest\" --tests \"*AgentSettingsNavigationTest\" --tests \"*ProjectWorkspaceStateTest\" and :androidApp:testDebugUnitTest --tests \"*RetainedTerminalAgentsIntegrationTest\" --tests \"*NativeWorkspaceViewModelTest\" --tests \"*RuntimeIntegrationReadinessTest\" --tests \"*SettingsPreferencesPhase17Test\" after complete integration.",
      "Also run node scripts/run-gradle.mjs :shared:jvmTest --tests \"*TerminalAgentsHttpAvailabilityTest\"; real JDK loopback server returns controlled HTTP404 to real Ktor ApiClient, not method-return mocks or old-version compatibility."
    ]
  }
]
```

- [x] <!-- evcrate-task:reconcile-retained-agent-roster --> Integrate runtime inventory and typed availability
- [x] <!-- evcrate-task:implement-verified-agent-navigation --> Integrate guarded exact navigation
- [x] <!-- evcrate-task:mount-agents-and-context-settings --> Mount sidebar and contextual Settings
- [x] <!-- evcrate-task:author-retained-integration-tests --> Add behavior integration regressions

## Context / architecture / admission gate
Priority P2; Phase04 tasks are Complete per explicit user direction. G3 used one integration owner for all four tasks. The [Cycle 3 review](../reports/code-review-261025-1647-terminal-agents-sidebar-cycle3.md) records the successor-inventory freshness warning and lifecycle/fixture warnings; these are retained as user-approved issues, not described as remediated. [Contracts](contracts.md), [evidence](design-evidence.md), and [overview overlap gates](plan.md#related-plan-overlap--release-gates) remain design references.

VM retains workspaceStates; current screen sessions are composition-local; existing AgentRuntimeHost owns the socket/reducer collector. Join these using narrow new coordinators rather than copying server lists into each workspace, adding a collector or expanding huge root with pure algorithms. One inventory coordinator observes accepted runtime/status input and registrations; service composes it with pure projector/filter store and retained activation coordinator. No second status authority.

## Related files / create-modify-delete / writer transfer
All paths are literal in task allowed_files; no directory/glob grants. CREATE `TerminalAgentsInventoryCoordinator.kt`, `TerminalAgentsActivationCoordinator.kt`, `RetainedTerminalAgentsCoordinator.kt` in Android platform/workspace; `VerifiedTerminalRoute.kt` in shared ui/flow; `TerminalAgentsSidebarHost.kt` in shared ui/components; new explicitly named test files. MODIFY every other allowed file that already exists. DELETE none; remove obsolete local roster refresh/membership paths if replaced, not unrelated terminal output/attachment code.

Sequential transfers only, same owner: runtime -> mount `NativeWorkspaceViewModel.kt`; navigation -> mount `DamHopperMobileApp.kt`, `ProjectWorkspaceScreen.kt`, `ProjectTerminalState.kt`, `AppFlowNavigation.kt`, `AppFlowState.kt`. Navigation owns added `WsConnection.kt`/existing `WsConnectionTest.kt` try-admit API and mutation-only selection hooks; runtime owns reducer stamp/try-admit API/tests; final tests-only task owns new `TerminalAgentsHttpAvailabilityTest.kt` loopback fixture. No concurrent writer, contract edits or silent production reopen.

## reconcile-retained-agent-roster — ordered steps
1. Reconcile writer/readiness prerequisites. Instantiate one inventory coordinator with **shared narrow ReentrantLock authority gate**, registration/order/ticket/revision/cache and attachment map/token. Every roster-authority mutation in host/service/inventory/activation uses this gate; synchronous producers remain short/immediate, no suspension or queued placeholder return.
2. AgentRuntimeHost allocates monotonic attachmentIncarnation whenever WsConnection object changes, even same generation/equal sock-1. Captured object reference/token accompany every collector callback/receipt/target. Map replacement, retire, late cache write and purge must check token under gate; logical display cache remains profile/endpoint/account only.
3. Existing collector/socket-state/reducer callbacks publish **after** source mutex release; no async mirror is final authority. Coalesce one listDetailed per runtime with ticket/revision trailing invalidation. Refresh all existing registrations, no new project discovery or periodic retry; pending/failed refresh makes cache unavailable.
4. Lifecycle generation/restart without incarnation invalidate only; exact non-null TermExit can prune matching instance. Agent removal invalidates membership without inventing terminal deletion; inactive rows cannot stay Working while unqualified.
5. Keep same-logical-owner cache through offline/rebind but old captured targets remain stale; identity loss purges exact owner only. Retirement barrier revokes attachment/registration/request authority under roster gate, releases it, then awaits cancellation/join/provider. Existing outer profile mutex may remain caller-held: barrier/children never acquire/reenter profile/registry or depend on them, and no newly acquired gate spans drain.
6. Existing reducer requester gains typed404 failure plus routeAuthorityRevision for binding/epoch/baseline/failure changes and exact non-suspending tryAdmitTerminalAgentsRoute API from contracts. Preserve high-water/silent admission/notification policy. Tests cover stamp transitions, contention/release and same-value attachment replacement without changing backend/wire.

## implement-verified-agent-navigation — ordered steps
1. Implement frozen `VerifiedTerminalRoute`, `TerminalRouteGate`, `DepartureRequest`. Change guard signature and migrate every existing invocation/assignment in AppFlow, workspace root and tests. Preserve navigate/back/project/notification behavior. Existing notification public API remains semantic implementation sharing a private commit, not a compatibility shim.
2. Add explicit guard cancellation to WorkspaceLeave, including Settings-reset construction. Separate successful completion from cancellation; Save/Discard successful clear does not cancel its callback, Cancel/dismiss/coalesced rejection/authority retirement does. Failed Save invalidates roster request token while keeping current dirty UI; stale continuation cannot later commit. Do not alter existing notification/ordinary departure retry policy.
3. Implement retained activation coordinator: capture exact target/request/origin; request ACTIVATION_VALIDATION and perform fresh initial terminal validation before requesting guard. No profile/target/session effects before successful final commit. Manual activation ignores notification auto-switch preference and admission/read policies; presentation Unknown/Unavailable/Platform unqualified/Unsupported alone does not block selecting an otherwise freshly verified live terminal.
4. Deferred guard callback launches a **new asynchronous inventory request after confirmation**, from retained runtime scope with post-confirmation freshness barrier. Cannot reuse a pre-dialog/pre-confirmation receipt or only check synchronous cached state. Fetch may serve all registered workspaces. Recheck identity before/after network and immediately at commit, including captured server epoch if present.
5. Implement exact bounded protocol from contracts: await existing profile mutex -> await registry admission -> **try** roster gate -> **try** captured socket lifecycle mutex -> **try** reducer mutex. Add owned WsConnection helper/typed result and test contention/stale/finally release. Nested BUSY propagates as explicit busy-retry Refused, never spin/auto-retry. No network/persistence/join/log/unknown callback/reentry inside.
6. Final prechecks use actual locked authorities (attachment object/token, registration/inventory/cancellation, socket, reducer epoch/authority stamp, profile/account/endpoint/generation, exact live metadata). Leaf marks COMMITTING, calls new mutation-only ProjectWorkspaceState/ProjectTerminalState selection, shared private flow-state commit, fixed active-profile setter, then same-request Committed state/receipt while all gates held. Admitted route bypasses ordinary navigation invalidator; reentrant/self/postcommit cancellation cannot reclassify. Controller/focus/log/persistence effects run after reverse unlock.
7. Tests deterministically hold profile/registry and each nested gate, invalidate immediately before admission and after commit, replace same generation/equal sock-1 transport objects, and cancel reentrantly. Assert BUSY vs STALE, no premature side effects and immutable truthful Committed receipt. Existing notification guard/read/feed/auto-switch behavior unchanged; local commit cannot exclude future server change, so exact screen intent remains mandatory.

## mount-agents-and-context-settings — ordered steps
1. Receive explicit sequential file transfers. Implement full `RetainedTerminalAgentsCoordinator : RetainedTerminalAgentsService`, composing completed inventory/activation collaborators, projector and dedicated local store; expose roster `state` and accepted `inventories` StateFlows once through RetainedRootServices and VM. No partial methods/no-op fallbacks. Register workspaces from real authenticated identity with retained registration order; root fabricated display usernames are not authority. Wire current foreground/sidebar/manual refresh signals to existing runtime only.
2. Replace roster-related per-workspace full-list requests with shared inventory consumption, not output/attachment event streams. `ProjectTerminalScreen` collects its exact current runtime receipt from `inventories`, updates composition-local sessions, and publishes accepted selectable tabs + receipt/exclusion set after refresh/destructive changes without refetch or publication echo loop. `ProjectWorkspaceScreen` carries owner/registration/service context. Refresh fan-out updates inactive memberships. Authority stream drops invalidated/offline receipts while private display cache remains unavailable. Panel unmount retains membership, explicit close/revoke purges exact registration; do not mistake temporary transport replacement for account loss.
3. Update **both** root terminal callsites, including fallback. Forward requiredTerminalInstance to workspace/fallback screen. Exact required ID/incarnation never falls through requested-missing path to selectable.firstOrNull; show explicit refusal/refresh. Ordinary terminal project-only behavior otherwise unchanged. Known owner/service absence is explicit unavailable UI, not fake cross-profile membership or new connection.
4. Mount one controlled host on Terminal only, inline trigger and existing widths. Minimal exclusivity: refuse Agents during search/departure/local modal/Settings/privacy; while compact Agents open consume root search/panel/Projects shortcuts and route controls except existing privacy/emergency. Group dirty prompt may appear above sheet; Settings/privacy supersede intentionally. No general overlay stack or unrelated popup repair.
5. One root cover includes privacy, Settings, search, pending departure, terminal create/kill/diagnostics/modal popups, sidebar popup and compact Agents plus existing predicates. Terminal `onLocalCoverChanged` and sidebar popup callback report owned sources only; child disposal cannot clear other cover. Apply source replacement synchronously before old surface teardown: no uncovered/focus-restored gap. Back/Escape targets actual topmost popup/dialog; compact closes before route only when itself topmost. Pinned input requires terminal focus; resize keeps higher covers and hardware/accessory/native IME/shortcut suppression.
6. Contextual Settings B independent A: retained HOST/AGENTS intent with optional SettingsScreens initialHostSection=USAGE/onHostSectionChanged={} preserving compiled WorkbenchScreen default caller; active root supplies explicit values. Queue target selection safely, disable mismatched binding, retain origin/dirty state; no ambient target or Agent Store route.
7. Keep feature logic in narrow files, huge root changes orchestration only. Wire UI filter writes solely on user action; mount/load/rotation must not save or sync. All service/callback production paths complete before tests-only task/qualification.

## author-retained-integration-tests — ordered steps
1. Extend actual service/VM tests for retained multi-profile/worktree inventory, same-generation equal sock-1 object replacement, old publish/purge/activation rejection, inactive freshness and exact identity retirement. W1/W2/W3 remain separate prerequisites, not repaired claims.
2. Exercise complete admitted leaf/required instance demand through actual mutation-only selection seam. Assert each try-gate BUSY, stale pre-admission authority, reentrant/self cancellation and postcommit retirement cannot mutate Committed into Refused; no missing/restarted first fallback.
3. Test root source cover and exclusivity: Agents->search shortcut consumed, search/local modal->Agents disabled, dirty prompt topmost cancellation, popup->Settings replacement, resize with overlap, no transient uncovered state/focus restoration; source A/target B and optional default caller semantics retained. Use real host state, not duplicated formula/source strings.
4. Create `TerminalAgentsHttpAvailabilityTest.kt` with in-file JDK HttpServer ephemeral-loopback fixture using existing ApiClientTest conventions (no dependencies/product hooks). Drive **real Ktor ApiClient -> TerminalRepository -> existing AgentStatusReducer -> DefaultTerminalAgentsProjector**. Return actual controlled HTTP404 bodies, first accepted200 observation then404/cache, delayed old-capture404 after successor200, and non404 body mentioning404. Assert typed Unsupported/current capture only, stale failure rejected, no invented rows/notification and exact request count with no automatic retry loop. This is required transport behavior, **not older-server compatibility**. Run its exact named JVM command; current real two-server MainActivity journey remains separately mandatory.
5. The user-reported aggregate qualification is recorded in Phase05. Individual Phase04 command outcomes are not itemized here; Cycle 3 review and connected-device acceptance remain open, and tests-only ownership cannot silently reopen production paths.

## Acceptance / checks / conflicts
Task-specific behavior checks plus Phase05 full compile/JVM/Android/APK and MainActivity/device matrix. Post-confirmation fresh network request and final qualified atomic commit are both required. Exact route demand survives root-to-screen race; no synthetic notification event or first-terminal substitution. Existing connections may cease under current lifetime: roster becomes unavailable, never extends transport lifetime.

## Risks / security / failure / rollback
- Deadlock: preserve profile/registry discipline; after registry only bounded try-admission roster/socket/reducer, reverse-finally release. Ordinary UI/runtime producers hold no source lock. Existing retirement caller may retain outer profile mutex, but its roster barrier never reenters profile/registry, releases own gate before child drain, and children never depend on caller-held gates. No Main-only exclusion claim.
- In-flight invalidation lost: revision+ticket trailing reconciliation, scoped cancellation; no polling bandaid.
- Privacy/key leakage: no persisted commands/status rows or identity telemetry; local filter only. Target B cannot borrow source A/runtime C authority.
- Rotation and guard lifetime: retained request tokens; Activity disposal detaches widgets only. Cancel/failure cannot navigate from old callback.
- Shared source drift: stop at release gate and reconcile actual source. This feature is not a workaround for unrelated notification readiness defects.
- Roll back only scoped feature integrations + exclusive new files as coherent cutover; retain unrelated callers/notification behavior and remote PTYs. No flags, duplicate service or old-API shim.

## Next dependencies / unresolved questions
Phase05 journey source was authored, but its real-host acceptance remains open per Cycle 3 review. User-reported unit/JVM and APK results are summarized in Phase05; connected-device, API/server and input/visual qualification remain open. Review findings are not treated as fixed by the Complete status.
