## Code Review Summary

### Scope
- Focus: Android connection recovery, lifecycle/network reconciliation, retained terminal recovery, status and input safety. Static working-tree review; **changes required**.
- Plan: `plans/261028-1659-android-connection-recovery-lifecycle/plan.md` and all four phase contracts.
- Reviewed production files under `native/android-app/`:
  - `shared/src/androidMain/kotlin/dev/damhopper/nativeapp/core/transport/PlatformHttpEngine.android.kt`.
  - `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/{WsConnection,WsTypes,WsRecoveryPolicy,WsRecoverySupervisor}.kt`.
  - `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/lifecycle/ConnectionEnvironment.kt`.
  - `androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/network/AndroidNetworkMonitor.kt`, deleted `AndroidHttpClientFactory.kt` via diff.
  - `androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/lifecycle/AndroidLifecycleCoordinator.kt`, `MainActivity.kt` changed wiring.
  - `androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt` relevant runtime/retirement/lifecycle sections.
  - `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/profiles/ProfileRepository.kt`.
  - `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/{TerminalScreens,TerminalSessionController,TerminalConnectionPresentation}.kt` relevant sections.
  - `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/{DamHopperMobileApp,ProjectTerminalScreen}.kt` relevant sections; native README diff.
- Reviewed tests: shared JVM `WsConnectionTest`, `WsRecoveryPolicyTest`, `WsRecoverySupervisorTest`, `TerminalConnectionPresentationTest`; Android unit `AndroidNetworkMonitorTest`, `AndroidWsEnginePolicyTest`.
- Supporting evidence: `ConnectionRegistry`, `LifecycleCoordinator`, `TerminalRepository`, `TerminalAttachQueue`, `TerminalReplayGate`, `ProjectTerminalState`, `ProjectWorkspaceScreen`, `WsHandshakeUrl`, `AppLogger`; root README, PDR, code standards and native architecture.
- Approximately 4,000 relevant source/test lines inspected, plus plan/docs and diff. Not an entire-repository audit.
- Updated plans: none. Assignment prohibits TODO tracking; coordinator retains plan/task ownership. Only this report written.

### Overall Assessment
Actual Android engine keepalive is now configured on the production construction path. Owner/generation reuse and pure backoff policy are useful improvements. Implementation does **not** yet deliver the cohesive recovery contract: authentication blocks can be bypassed, healthy-looking stale sockets survive resume/network changes, terminal attachment remains composition-owned, and shutdown is not awaited. Status color changes alone cannot establish current-socket terminal readiness.

### Acceptance Criteria
| Criterion | Assessment | Evidence / gap |
|---|---|---|
| Zero server API/protocol changes | **Satisfied by inspected diff** | Tracked product edits confined to `native/android-app/`; additional untracked product files also Android-local. `WsTypes` adds only a local exception; existing close-code values and terminal wire messages unchanged. Planning artifacts outside product subtree are documentation only. |
| Active production `pingInterval(15, SECONDS)` | **Source wiring satisfied; runtime unqualified** | Android engine lines 16–29; default `WsConnection` client uses `createDefaultHttpEngine()` at lines 54–56; profile factory uses that constructor at lines 201–208. Effective missing-Pong detection on Android not exercised. |
| Single-flight centralized recovery, backoff/jitter, stop on 4401/4403 | **Not satisfied** | Equal jitter/cap implemented; low-level mutex serializes real connect calls. Direct terminal connect callers remain, auth hints bypass blocks, no configuration blocking, no shared attach-failure/stability accounting. R2, R4, R7. |
| Rotation safe, resume liveness validation, clean network unregister | **Partial** | Configuration stop guard present; application context and idempotent unregister present. Connected sockets are not revalidated on genuine resume/route changes, initial environment lost. No recreation/OS callback execution evidence. R3, R8. |
| Transport/process/stream status decoupling; disconnect overrides green; readiness reset | **Not satisfied** | Policy receives three inputs, but Overflow can render READY; reset is asynchronous/composition-bound, not exact-socket readiness. Retained hidden recovery missing. R4–R6. |
| No leaks, unclosed resources, mutex deadlocks | **Not established; resource defects found** | Async stop can be cancelled before disconnect; owned WS client/scope has no final disposal; deleted profiles remain cached. No concrete mutex deadlock established in inspected paths; that is not proof of deadlock freedom. R1, R9. |

### Critical Issues
None established by static inspection. No runtime race or exploit reproduction claimed.

### High Priority Findings

#### R1 — Runtime retirement can cancel socket cleanup before it runs
**Evidence:** `NativeWorkspaceViewModel.kt:555,580–582` passes the runtime's own scope to the supervisor. `WsRecoverySupervisor.kt:78–94` implements `stop()` by launching into that scope. Host `stopLocked()` calls it, then immediately cancels/joins that same runtime job (`NativeWorkspaceViewModel.kt:645–654`). `WsConnection.kt:54–64,192–194` owns a separate HttpClient and reader scope; cancellation of the host job does not dispose either.

**Failure / impact:** Logout, replacement or ViewModel teardown can return from the runtime drain after cancelling the queued stop coroutine, without executing `wsConnection.disconnect()`. Old session/reader can survive retirement. Even successful transient disconnect has no final owned-client/scope disposal API. `closeInternal()` also catches graceful-close failure/timeout without a forced session cancellation (`WsConnection.kt:450–469`), so local quiescence is not guaranteed. Reader-initiated close cancels its own job before that suspending cleanup.

**Correction:** Make shutdown suspending and awaited, revoke intent/admission before child cancellation, perform bounded cancellation-safe local socket cleanup and force cancellation after grace expiry. Dispose default-owned client/scope once at final lifetime end; preserve caller ownership of injected clients. Do not repair by introducing registry/profile lock reentry during drain.

**Required regression:** Block stop dispatch, retire runtime, assert remote socket closed and no reader/timer remains before drain returns; repeat during connect/read/close and final clear. **Confidence: high**; scheduling race not executed.

#### R2 — Auth-blocked recovery is restarted by ordinary hints and terminal attachment
**Evidence:** `WsRecoverySupervisor.kt:110–119,137–145` schedules any non-Connected state on foreground/network availability, including `MfaRequired`/`LoginRequired`. `requestRecovery()` also has no blocked-state guard (`96–106`). Background/network checks precede classification (`209–229`), hiding an auth termination behind PAUSED/WAITING_NETWORK. Production terminal screen still directly calls `.connect()` (`ProjectTerminalScreen.kt:543,768`); `WsConnection.connect()` rejects only Connected/Connecting (`121–127`).

**Failure / impact:** Receive 4401/4403, then background/resume, change route, switch terminal or request recovery: a new handshake can occur without authentication changing. Auth-stop criterion violated; repeated rejected handshakes and misleading reconnect UI possible.

**Correction:** Retain an auth/configuration block independent of environment state; clear only after explicit authorized auth/config transition. Classify before pause policy. Migrate terminal callsites to the retained recovery owner; hints join/coalesce work, never bypass blocks/backoff.

**Required regression:** For both close codes, run foreground/network/manual/terminal-attach hints and assert zero additional attempts until explicit auth transition. **Confidence: high**.

#### R3 — Resume and route changes do not reconcile a nominally Connected socket
**Evidence:** `WsRecoverySupervisor.kt:110–119` does nothing to a Connected socket on genuine resume; `137–145` also skips it on changed default route. Network loss only cancels attempt/switches supervisor snapshot (`150–157`), leaving transport state/socket available. `requestRecovery()` only schedules `connect()`, which returns immediately if Connected (`WsConnection.kt:124–126`). Background cancels only WAITING_RETRY, not an in-progress connection (`WsRecoverySupervisor.kt:124–133`). `ConnectionEnvironment.kt:7–12` is unused outside its declaration.

**Failure / impact:** Resume after suspend, Wi-Fi→cellular handoff or known network loss can keep old transport marked Connected and terminal green/input-eligible until engine failure detection. Foreground does not prove liveness. In-progress establishment may finish in background. README's immediate resume/default-network reconnection claim is unsupported.

**Correction:** Retain foreground/route revisions; synchronously mark pre-event transport/environment unusable, cancel obsolete establishment, replace suspect exact socket once through supervisor, and join attempts already started after latest revision. Background keeps established socket best-effort but prevents establishment; environment state must gate status/input independently.

**Required regression:** Connected→background→resume, Connected→route replacement, connected network loss, background during handshake, duplicate hints and rotation: check replacement counts and first-frame nonready behavior. **Confidence: high**.

#### R4 — Socket recovery does not restore retained terminal attachments
**Evidence:** Terminal collectors remain in `ProjectTerminalScreen.kt:661–710`, FIFO writer in `388–448`, attachment in `752–781`, recovery/result callbacks in `473–550`. `ProjectWorkspaceScreen.kt:266–289` removes that composition when Files/Editor is selected. Attachment effect keys do not include connected socket (`753`); fresh shared inventory is deliberately applied with `bumpAttachment = false` (`716–721`). Supervisor onConnected wiring refreshes Agents, not retained terminal streams (`NativeWorkspaceViewModel.kt:657–662`).

**Failure / impact:** A terminal ready on socket A loses transport. Supervisor connects socket B, but unchanged selection/incarnation/revision does not trigger `term:attach` on B. Shared inventory refresh need not change these keys. Terminal can remain fenced without a baseline until user selection/remount. While Files/Editor is visible there are no terminal screen collectors or attachment orchestration; retained controllers alone do not retain execution. Surviving controller callbacks still capture old composition/repository/banner state.

**Correction:** Move terminal collectors, attach sequencing, dispatch callbacks and FIFO writer into retained terminal ownership. React to each exact new socket, reconcile accepted inventory and reattach existing local controllers from accepted offsets, including hidden panels. Add bounded baseline/drain deadlines; unresolved/ambiguous attach requests socket replacement via shared backoff, not same-socket retry. Feed outstanding baseline failure into stable-backoff reset policy.

**Required regression:** Drop after READY with same PTY/incarnation; recover without navigation. Repeat hidden in Files/Editor and through rotation, missing buffer and late same-socket buffer. Assert unchanged PTY identity, exact output suffix and current-socket READY. **Confidence: high**; end-to-end sequence not executed.

#### R5 — Readiness/input admission is not fenced by exact socket identity
**Evidence:** New disconnect hook only calls `gate.failAttach()` (`TerminalSessionController.kt:97–104`). Its sole production caller is asynchronous `LaunchedEffect(terminalWsState)` (`ProjectTerminalScreen.kt:239–243`), absent when screen unmounted and skipped for directly observed Connected replacement. Queue record creation captures selection epoch/controller/incarnation, not socket (`481–489`); dequeue checks these old facts, then hops to Default (`393–421`). Final submission uses generic `ws.send`, not `sendOnSocket(expected)` (`TerminalRepository.kt:231–233`). Terminal events remain unqualified `incomingMessages` (`261–277`). Missing WS still silently succeeds for input/attach/resize (`231–248`).

**Failure / impact:** Disconnect reset is not synchronous with loss, and current replay completion does not identify the socket that earned it. **[INFERENCE, not reproduced]** Loss/replacement between input admission and the Default-thread send can submit an old queued keystroke on the successor socket before its terminal baseline. Unqualified predecessor events/parser callbacks cannot be reliably rejected by socket identity. Nullable transport can also be reported as successful submission/attach.

**Correction:** Capture exact attachment socket and local attach revision in retained controller/runtime; advance input epoch and fence immediately on loss/reconcile. Capture socket in queue item at enqueue, drop unsent predecessor records, and use `sendOnSocket(expected)` with final policy/epoch checks. Consume `SocketBoundMessage`; explicitly fail missing transport. Preserve submitted uncertainty without replay.

**Required regression:** Suspend between enqueue/check/final writer admission, replace socket, release dispatch and assert no bytes reach successor. Inject predecessor frames/drains after replacement and verify they cannot open readiness. **Confidence: high** for missing contract; concurrency consequence inferred.

#### R6 — Overflow state can fall through to green READY
**Evidence:** `TerminalConnectionPresentation.kt:37–77` handles Disconnected/Connecting/Error/AuthUnavailable/MFA/Login, but omits `WsState.Overflow`. With alive=true, streamReady=true and restartCount=0, Overflow reaches Success/READY (`73–76`). Overflow is a transport termination (`WsConnection.kt:407–431`), not a usable connection. Presentation tests omit this state.

**Failure / impact:** Backpressure close 4001 can display green using stale readiness; directly violates disconnect-overrides-green criterion, especially before asynchronous reset runs.

**Correction:** Exhaustively classify transport first; only `WsState.Connected` may proceed to process/stream readiness. Include Overflow as unavailable/resynchronizing.

**Required regression:** Table every WsState with stale-ready=true; all non-Connected states must be non-green. **Confidence: high**.

#### R7 — Permanent auth/configuration failures are retried indefinitely
**Evidence:** `WsRecoveryPolicy.kt:45–50` retries every `WsState.Error`; no branch constructs ConfigurationBlocked. `WsConnection.kt:140–167` wraps upgrade/security failures in generic Error. `handleCloseReason()` maps unrecognized protocol/policy close codes to ordinary Disconnected (`407–415`). Stability resets solely on transport Connected, ignoring failed terminal baseline (`WsRecoverySupervisor.kt:197–202`).

**Failure / impact:** Upgrade401/403, certificate/hostname refusal or protocol incompatibility enter the transient loop rather than actionable blocked state. Retrying does not fix configuration and produces persistent network/battery load; no TLS bypass found. A transport repeatedly opening without usable terminal replay can reset failure history.

**Correction:** Preserve typed establishment/termination outcomes: upgrade401 login block, upgrade403 access/config block without inventing MFA, 503/1013 transient, TLS/security/protocol refusal configuration block. Use safe reason categories. Reset stable history only when required baselines have settled.

**Required regression:** Real/deterministic upgrade401/403/503, TLS refusal and protocol closes, plus 30s transport-open with unresolved baseline. Assert classifications, attempt counts and no block bypass. **Confidence: high**.

### Medium Priority Improvements

#### R8 — Network/environment state is neither initially delivered nor retained for new runtimes
**Evidence:** Monitor seeds `activeNetworkId` but emits no initial availability (`AndroidNetworkMonitor.kt:61–69`); duplicate initial onAvailable is discarded (`30–35`). Host forwards hints only to existing runtime values (`NativeWorkspaceViewModel.kt:628–642`). Every new supervisor defaults online/foreground (`WsRecoverySupervisor.kt:63–65`). VM registers monitor at `947–951`, before `runtimes` initializes at `1082–1089`.

**Impact:** Cold-start offline or attach after prior network/background event begins recovery using false environment assumptions. **[INFERENCE]** A route callback during construction can dereference not-yet-initialized `runtimes`; monitor registration exposes that window. Callback unregister uses application context and an atomic idempotence guard, but initial/late-callback behavior is not qualified.

**Correction:** Initialize recovery host before registering callbacks; maintain latest serialized environment snapshot independent of attached runtimes, seed each attachment, and resnapshot on genuine resume without treating route existence as Internet validation. Preserve exact predecessor-onLost filtering.

**Regression:** Offline startup, attach after loss/background, route callback during initialization, close versus queued callback, network A→B followed by late lost(A). **Confidence: high** for lost state; construction crash is inferred.

#### R9 — New WebSocket cache retains deleted profiles
**Evidence:** `ProfileRepository.kt:52,193–210` strongly caches every WS object; eviction occurs only in `retireProfileConnection()` (`308–311`). `deleteProfile()` calls `registry.removeProfile()` directly and never evicts (`116–130`).

**Impact:** Deleted profile transport/client/scope and token-provider closure remain referenced for repository lifetime. Repeated create/delete grows the cache; deleting an unattached cached connection has no runtime cleanup owner.

**Correction:** Evict exact old cache entry on delete and all final retirement paths; integrate once-only resource disposal after awaited drain without repository reentry from barriers. Failed transition must remain fenced, not lose its cleanup handle.

**Regression:** Create/cache/delete several profiles, including never-attached WS; assert cache eviction and owned-client/scope disposal once. **Confidence: high**.

### Low Priority Suggestions
- `TerminalConnectionPresentation.kt:68–71` makes any historical restart a permanent warning/RESTARTED instead of READY for a subsequently healthy shell; plan Phase4 lines64–65 requires restart count as historical metadata, not readiness predicate.
- Active empty-screen copy and dormant equivalent still use separate transport/replay conditions (`ProjectTerminalScreen.kt:1480–1489`, `TerminalScreens.kt:585–590`) and always say “Reconnecting” for auth-blocked states. Reuse shared status/action wording. Dormant tab dots lack the new accessible description applied to active tabs (`TerminalScreens.kt:322–340` versus `ProjectTerminalScreen.kt:1982–1986`).

### Positive Observations
- Canonical active Android engine now has 15s OkHttp pings, 15s TCP connect, 30s write and redirect refusal. No Ktor-only heartbeat or server heartbeat introduced.
- Whole-attempt timeout covers token lookup and handshake; typed timeout is distinguished from external cancellation; added tests inspect both paths.
- Equal jitter bounds and 30s cap are straightforward and tested as a pure policy.
- Profile mutex protects exact owner/base-URL cache reuse; transient recovery need not churn generation.
- Configuration-change stop guard avoids treating ordinary Activity recreation as deliberate backgrounding at source level.
- Network monitor uses application context, ignores predecessor onLost and provides idempotent unregister. No Activity context retained there.
- No automatic PTY creation/kill or explicit uncertain command resend introduced in reviewed changes.

### Test Coverage and Verification Limits
- **No build, test, lint, formatter, device or smoke command run by reviewer.** Coordinator owns integrated verification per assignment/plan. Only static reads/searches and working-tree diff/status executed.
- New supervisor tests (`WsRecoverySupervisorTest.kt:18–92`) cover three basic start/pause/network scenarios with overridden/no-op connect; do not establish production single-flight retries, auth-stop across hints, retirement quiescence or terminal restoration.
- `AndroidWsEnginePolicyTest.kt:12–22` checks constants and non-null construction, not effective client's ping interval, redirect behavior or missing-Pong detection; constructed engine also not closed in test.
- `AndroidNetworkMonitorTest.kt:14–34` supplies null service: proves only no-service/idempotent-close path, not registration/unregister, route mapping or callback races. Build has `unitTests.isReturnDefaultValues = true`; do not treat that as OS evidence.
- Presentation tests cover seven common cases but not Overflow, restart history, stale metadata/environment or exact socket attachment. New WS tests cover token-delay timeout and cancellation before handshake; not paused post-handshake publication/retirement.
- Required active-engine fault fixture and recovery journeys were not found by scoped glob: `AndroidWsFaultFixture`, `AndroidConnectionRecoveryJourneys`; no retained terminal runtime/coordinator implementation found. Existing instrumentation sources are not new recovery qualification evidence.
- No fresh execution report supplied/located. Attempt to locate build test-result artifacts denied by harness `build/` access policy; not bypassed. Type/test coverage percentages, test counts and lint status therefore **not measured**.
- Mutex inspection: WS lifecycle gate serializes establishment; correlated response waits occur outside that gate (`WsConnection.kt:275–313`); registry documents/runs retirement barriers outside its own mutex. No concrete cycle established. New cleanup/cancellation behavior still needs blocked-handshake/retirement/admission concurrency tests; “no deadlocks” cannot be certified statically.

### Plan Completeness
Plan remains pending; phase task boxes unchecked. Source substantiates partial engine wiring/policy/runtime/presentation work, **not end-to-end completion**. Retained current-socket terminal recovery and input cutover incomplete (R4–R5); lifecycle reconciliation incomplete (R3/R8); recovery/auth/resource safety incomplete (R1/R2/R7/R9). Journey authoring absent in inspected tree; integrated device qualification unreported. README changed but overstates synchronous readiness revocation and immediate resume/route reconnection. Do not mark those contracts complete based on helper existence or config tests.

### Recommended Actions
1. Repair awaited runtime disposal and dominant auth/config blocks before acceptance; preserve registry/profile no-reentry retirement contract.
2. Finish retained terminal current-socket collector/attach/input cutover together with environment reconciliation. Remove direct production screen connect calls; no compatibility path carrying unfenced input.
3. Make non-Connected status fail closed, then align both renderers, freshness and wording with retained current-stream state.
4. Add meaningful regressions for each finding; coordinator then runs planned integrated command from repo root:
   ```powershell
   .\native\android-app\gradlew.bat -p native/android-app :shared:jvmTest :androidApp:testDebugUnitTest :androidApp:assembleDebug :androidApp:compileDebugAndroidTestKotlin
   ```
5. Author and qualify real active-engine missing-Pong and mounted unchanged-server journeys. Execute declared emulator/physical API29/API33+ matrix: startup failure, auth/protocol/TLS outcomes, Wi-Fi/cellular/VPN/offline restoration, Doze/resume, rotation during connect/replay, hidden Files/Editor, two-profile retirement and queued-input races. Record exact device/API, counts, timings, failures/skips and callback/resource stability. Unit/build success cannot replace this evidence.

### Metrics
- Findings: 0 Critical, 7 High, 2 Medium; low-priority presentation suggestions above.
- Type coverage: not measured; Kotlin scope, no TypeScript changes.
- Test coverage/pass counts: unavailable; no execution claim.
- Linting issues: not measured.

### Unresolved Questions / Evidence Gates
- Main coordinator must supply fresh integrated build/test outcomes after repairs; none evaluated here.
- Effective Android timer, real OS lifecycle/network transitions, leak/deadlock soak and unchanged-server/device journeys remain unqualified. No assertion that required hardware/server controls are available or unavailable.
