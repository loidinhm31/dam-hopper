# Phase 4: Terminal Status Indicator & Stream Readiness Decoupling

Priority P1 · pending · 16h (runtime 8h, presentation 2h, journey authoring/qualification/docs 6h). Depends on Phase3. One terminal integration owner; tasks execute serially where writable files overlap. [Overview](plan.md) · [RCA §§5–8](../reports/debugger-261028-1631-android-connection-indicator-rca.md).

## Architecture and exact recovery contract

`retained runtime / current socket → retained TerminalRuntimeCoordinator → controller + replay gate → shared presentation → screens`.

Move required runtime ownership, not every UI concern: retained terminal message collectors, attach sequencing, controller dispatch callbacks and FIFO writer live beside `ProjectTerminalState`. Screens retain widgets/selection UI and observe retained outcomes; no composable-owned recovery jobs, no stale captured repository/banner closures in surviving controllers. Existing Files/Agents coordinators keep their own snapshot/subscription authority. Reuse existing socket-bound WS stream; do not create parallel domain sockets or polling.

### Required invariants

1. Loss/reconcile/retirement synchronously clears controller current-attachment socket, fences replay/input, advances input epoch and invalidates pending attach completion. Genuine background synchronously marks environment unverified before retained workspace can next become visible; first resumed frame cannot expose stale READY. Preserve accepted surface contents, offset, scroll anchor, drafts, last-known PTY metadata and uncertain failures. Never manufacture `alive=false`, kill/create/restart PTY, or discard dirty editor state on disconnect.
2. Define current attachment identity `(ConnectionRef, SocketInstanceRef, terminalId, incarnation, localAttachRevision)`. Local revision fences callbacks/parser drains; **not** a wire attempt ID. One attach in flight for a terminal on one socket; no overlapping attach sends on same terminal/socket. Collector installed before sending `term:attach`.
3. Only accept `SocketBoundMessage` for currently authorized exact socket; then route matching terminal/incarnation to controller. Use existing terminal incarnation/reset/truncation/byte-offset rules. Old-socket buffer/output/restart/exit, late REST inventory and parser drains cannot certify new readiness. Current process-restarted events cannot bypass a pending/failed current-socket baseline.
4. On new Connected socket, mark inventory stale until accepted current runtime receipt/REST result, reconcile each already-retained controller's session identity, then attach existing eligible sessions from controller accepted UTF-8 byte end offset. New incarnation/reset follows existing authoritative reset path, not old offset reuse. Missing/exited sessions stay unavailable/exited; never auto-create replacement. No attach for every server session: only local retained controllers/membership.
5. Hidden Files/Editor panels still reconcile retained output/attachments; only input is visibility gated. No dependency on `ProjectTerminalScreen` being composed. A new selected session without controller creates it through existing factory/selection path; renderer mounting is not recovery authority.
6. Successful attach send != readiness. READY requires verified current foreground/route environment, exact current connected socket, accepted current attachment buffer, completed parser writes + queued-live drain and current PTY/incarnation. Input additionally requires existing visibility/foreground/privacy/selection policy; a hidden retained stream may reconcile without receiving input. Keep active parser accounting across reset to suppress terminal protocol replies during historical replay.
7. An attach has no server request/attempt ID. Coalesce ordinary requests while in-flight. Baseline receipt deadline starts at successful attach dispatch, default 15s; allow parser/drain until total 30s readiness deadline. Both are provisional testable policy values. On uncertain send/timeout fence attempt, close suspect socket and request **supervisor replacement before any retry of that terminal**; establishment obeys same capped retry backoff, never an immediate attach-driven bypass. Report outstanding baseline failure to supervisor so repeated bad replay cannot reset retry history merely by opening transport for 30s. Never retry unresolved attach on same socket and mistake late `term:buffer` for successor. New socket restores every relevant controller once. Gap/overflow reattach remains serialized; unresolved earlier attach requires replacement. No independent attach backoff/connect loop.
8. Input record captures socket + selection/input epoch + controller/incarnation at enqueue, not only at dequeue. On loss advance epoch and fail/drop unsent queued items; they cannot become eligible after new replay. At final writer admission use `sendOnSocket(expected)` and revalidate epoch/incarnation/policy. Missing WS is explicit unavailable/not-submitted, never a nullable early-return success. Bytes admitted before transport loss may be uncertain; never auto-resend commands, keystrokes, resize-as-input, writes, or capability decisions. Latest valid geometry can be explicitly reissued as idempotent resize after new attachment; no queue replay.
9. Keep command-history behavior bounded to its existing policy, but do not call local enqueue evidence PTY execution confirmation. Retained result events record unsent versus submitted/uncertain without retaining Activity/Compose lambdas. UI banner may consume those events; it does not own dispatch.

## Exact ownership / restore-current-socket-terminal-streams

Create focused files (<200 lines where practical; split by actual concern, not wrappers):
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalRuntimeCoordinator.kt`: current-socket collectors, inventory/session reconciliation, retained attach/deadline/replacement coordination and observable attachment state.
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalInputDispatcher.kt`: migrate existing bounded FIFO worker and controller raw-input/recovery callbacks from screen; preserve epoch, uncertain-outcome, privacy and selection checks. Never retain UI closures.
Modify:
- `.../features/terminal/TerminalSessionController.kt`: invalidate/bind current socket; qualify replay completion and parser callbacks; preserve accepted offset/surface. `isReplayCompleted` remains replay information; expose separate current-stream-ready state instead of overloading it.
- `.../features/terminal/TerminalReplayGate.kt`: only minimal invalidation/generation hooks; preserve active write accounting, UTF-8 overlap/gap handling, limits and historical-reply suppression.
- `.../features/terminal/TerminalAttachQueue.kt`: remove direct-connect callback, require captured current socket; coalesce serialized sends and give retained coordinator a cancel/fence result. It remains queue, not reconnection scheduler. In-flight send supersession must not fence a newer accepted attempt.
- `.../features/terminal/TerminalRepository.kt`: terminal operations used by runtime accept expected socket and use sendOnSocket; expose socket-qualified events or let coordinator subscribe directly. Migrate retained and dormant callers; remove obsolete unqualified terminal stream aliases when no callers remain. No missing-transport no-op for attach/input. Keep wire `term:attach/fromOffset`, `term:buffer`, `term:write`, `term:resize` unchanged.
- `.../ui/screens/ProjectTerminalState.kt`: owns coordinator/dispatcher, observable metadata freshness/attach/error state, input socket/epoch; close once at true workspace teardown. Authority rebind must capture exact new runtime rather than resurrect old connectionRef.
- `.../ui/screens/ProjectTerminalScreen.kt`: remove moved LaunchedEffect message collectors/FIFO worker/direct connect and composition-capturing controller callbacks; use retained coordinator. Null inventory receipt invalidates freshness instead of returning while presenting old metadata as current. Widget detach never closes retained controller/recovery.
- `.../features/terminal/TerminalScreens.kt`: migrate retained dormant renderer/controller attach/input consumers to same qualified primitives. A composition-owned fallback may own a local coordinator for that shell only, but joins supplied supervisor; no new transport/retry authority. Never mount dormant Workbench as part of this fix.
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt`: bind/rebind terminal coordinators to existing authorized runtime independently of panel; stop on owner retirement before disposal; leave Agents inventory/notification rebaseline to existing owners.
- JVM tests listed in full in durable contract: controller, replay gate, repository integration, visibility and new `TerminalRuntimeCoordinatorTest.kt`. Repository paths abbreviated above use `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/` prefix; contract contains exact writable literals.

### Ordered steps

1. Implement controller socket invalidation and input epoch first; a disconnect after completed replay immediately yields nonready with retained text.
2. Migrate socket-qualified repository dispatch/collectors and callback ownership together. Remove old screen effects in same task to prevent doubled output/sends. Audit all terminal stream/attach/input callers, including Workbench through TerminalScreens; unrelated Agents flows intentionally unchanged.
3. Bind coordinator for every retained terminal state before recovery begins; install collectors before attach. Reuse accepted inventory receipt when available, or one owner-scoped existing REST detailed-session refresh after connection; deduplicate shared inventory work, reject stale receipt/REST completion by owner/socket. A REST read is process inventory, not proof old WS health.
4. Attach selected/retained sessions serially per controller with bounded queue; no unbounded parallel launch over server inventory. Existing buffer queue memory bounds preserved. Keep UI-thread mutable terminal state confined to Main; IO/recovery scheduling off Main.
5. Move input callbacks/results into dispatcher; preserve raw terminal/IME/privacy fencing and input dropped versus uncertain classification. Current-socket write admission rejects predecessor queues even when new connection is Ready.
6. Expose immutable observable per-session readiness/errors/freshness, sufficient for both renderers; no UI reads from unobserved mutable Boolean that fails to recompose on disconnect.

## Exact ownership / decouple-terminal-status-presentation

Create `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalConnectionPresentation.kt` and matching JVM `TerminalConnectionPresentationTest.kt`. Modify the two renderers above only after runtime task lands. Existing `TerminalPresentationPolicy.kt` handles geometry/follow, not connection status; separate small pure policy avoids mixing concerns.

| Inputs / precedence | Status / color / accessible wording |
|---|---|
| Retired/stopped runtime | OFFLINE / neutral; process “last known alive/exited; unavailable” if stale |
| Login/MFA/configuration blocked | SIGN IN / MFA REQUIRED / CONNECTION BLOCKED; warning/error + actionable existing flow |
| Connecting/backoff/network recovery | CONNECTING / RECONNECTING / WAITING FOR NETWORK; warning, optional next-delay text |
| No usable transport outside blocked/connecting states | OFFLINE / neutral; last-known PTY explicitly stale |
| Connected but foreground/route environment unverified | VERIFYING CONNECTION / neutral-warning; never stale READY on first resumed frame |
| Connected but process inventory stale | VERIFYING SESSION / neutral-warning; not Ready |
| Fresh authoritative exited PTY, or qualified exit | EXITED / error; exit code if known; do not falsely call transport dead |
| Fresh alive PTY but no completed current-socket attachment | REPLAYING / warning; attach failure explicit and Retry routed through owner |
| Verified environment + current connected socket + fresh alive PTY + accepted current baseline/drain | READY / success; “Shell alive; stream ready” |

- Connection/stream dot means availability/readiness, **not command activity**. An idle shell can be READY; never describe it busy/working because alive or because output is recent. Server schema lacks authoritative command-busy information; new activity feature explicitly out of scope.
- Show separate PTY alive/exited text/semantics; preserve restart count as historical metadata, not perpetual warning/reconnecting predicate. No exit/green from stale inventory alone. Offline overrides global ready copy while last-known process information remains visible.
- Replace active empty-buffer “Terminal connected. Interactive session ready.” and dormant READY/REPLAYING logic with shared current status. Include semantic text/contentDescription so color is not sole signal; selected-tab colors/contrast remain existing theme.
- Acceptance table tests all combinations including idle, noisy active command, restarted live shell, real exit, stale alive, lost receipt, dropped socket after ready, attach failure, new socket replay and auth-stop. Both renderers consume same model; no copied when(alive/restartCount).

## Verification & Test Strategy

### Authoring and regression coverage

- Meaningful deterministic JVM tests: supervisor virtual time/jitter/cap/stable reset; whole-attempt cancellation; old socket response fencing; current attach baseline/drain; partial UTF-8 overlap, gaps, lower-offset reset, truncation/incarnation; old parser drain; queue overflow; input admission race, privacy/panel/foreground and uncertain writes. No sleeps for backoff tests.
- Integration JVM tests use real existing loopback WS/HTTP fixture where appropriate. They qualify shared behavior on Java engine, **not Android OkHttp keepalive**. Assert remote observed bytes/session inventory, not circular assertions against same computed UI state.
- Android unit tests qualify actual engine builder policy, retained VM lifetime and network callback mapping. Avoid isReturnDefaultValues turning unimplemented Android mocks into “network unavailable” proof.
- `author-recovery-device-journeys` creates `androidApp/src/androidTest/.../AndroidConnectionRecoveryJourneys.kt` and `AndroidWsFaultFixture.kt`; modifies existing `RetainedWorkspaceLifecycleTest.kt`. Use actual production shared Android engine against isolated RFC6455 test endpoint supporting Ping/Pong and controllable missing Pong/reset. No production transport mock; fixture path does not modify Rust server. Keep fixture deterministic/bounded and close sockets/threads in finally.
- Mounted real-server journey uses unchanged existing server/REST inventory as independent oracle: same session ID/incarnation and no duplicate create/kill, exact byte suffix after replay, input never reissued, UI semantics go unavailable→replaying→ready. Do not mistake a fixture success for real-server/OS qualification.

### Coordinator commands (future execution, repository root)

```powershell
.\native\android-app\gradlew.bat -p native/android-app :shared:jvmTest :androidApp:testDebugUnitTest :androidApp:assembleDebug :androidApp:compileDebugAndroidTestKotlin
.\native\android-app\gradlew.bat -p native/android-app :androidApp:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=dev.damhopper.nativeapp.AndroidConnectionRecoveryJourneys,dev.damhopper.nativeapp.RetainedWorkspaceLifecycleTest
```

POSIX equivalent uses `./native/android-app/gradlew`. For failure localization use existing Gradle `--tests` selectors per task; do not rerun reported failures merely to reconfirm. Main coordinator owns integrated builds/tests/review after writers finish, and reruns failed checks plus affected regressions after authorized repairs; “once integrated” is not a ban on post-fix evidence. Implementers do not run mid-flight suites. JDK17/SDK35 and documented Gradle environment required. No dependency/SDK installation by planner. Record exact commands, exit codes, case counts, device/API and unresolved failures; no fabricated coverage percentage. `qualify-integrated-android-recovery` is verification-only (no writable product paths); repairs return to owning task, not unbounded verifier edits.

| Required scenario | Observable acceptance |
|---|---|
| No-FIN/RST missing Pong, idle terminal | Active Android engine detects foreground blackhole, UI nonready, one recovery sequence; record timing against 15s policy |
| Failed startup then endpoint returns; server reset/normal close | Autonomous eventual connect/attach without session switch/recompose/user Retry |
| 4401/4403/1013/4001; upgrade401/403/503; TLS refusal | Exact auth/transient/configuration policy; no credential storms or security downgrade |
| Wi-Fi loss/restoration/roaming/cellular/VPN | Current route hints coalesced; no old onLost teardown of replacement; LAN no-Internet still attempted |
| Background/Doze→foreground; rotation during connect/replay | First resumed frame never stale READY; genuine resume reconciles; no uninterrupted-background promise; config recreation retains runtime/socket if otherwise healthy |
| Terminal hidden by Files/Editor/Settings | Transport and retained output recover; drafts/scroll/dirty files intact; hidden input stays disabled |
| Loss after ready, partial replay, gap/overflow/incarnation change | Readiness revoked; correct offset/reset; old frames/drains ignored; ambiguous attach replaces socket |
| Loss between input enqueue/check/admission; late queued key | No predecessor input reaches replacement; submitted bytes marked uncertain; never auto-replayed |
| Two attached profiles; logout/edit/retirement during retry | Only exact eligible runtime changes; no late reauth/socket; C2a1 completes without deadlock or successor leak |
| Reconnect repeated/soak and rapid hints | Max one handshake per runtime, no growing callback/collector/thread count, no duplicated output/subscriptions or catch-up notifications |

Qualification includes x86_64 emulator and physical arm64-v8a, min supported API29 and one API33+ environment across matrix; record which scenario ran where. Real OS Doze/network controls need attached device and approved isolated route/server. Release acceptance blocked for missing hardware/network evidence; unit/build success cannot waive it. Observe idle battery/radio behavior and terminal high-output replay/ANR regression; no invented measured budgets. Also run existing file-watch, Agents inventory/readiness, notifications, transfer and retained workspace suites included by full commands; streams/mutations never auto-replayed.

## Rollback & Risk Mitigation

- Highest risks: late same-socket buffer, stale UI callbacks retained by controllers, current-socket input TOCTOU, duplicated collectors, parser drain reopening gate, shared profile retirement deadlock. Explicit identity/serialization/admission tests above are release gates.
- Attach deadlines can be too short on slow large replay; tune measured values, never solve by marking Ready early. One session timeout may rotate shared socket and affect other domains; coalesce replacement, preserve offsets and global backoff. No automatic attach retry storm.
- Keep memory bounded by existing replay queue/output limits; no transcript duplication for diagnostics/recovery. Logs contain categories/IDs/timings only, no terminal content/tokens/capabilities.
- Ship Phases2–4 as cohesive change after matrix passes, not half-integrated retry owner. Rollback to prior signed APK/previous scoped change set on repeated reconnect, lost text, auth-loop or input isolation regression. Server binary/config and profile/credential storage schema unchanged; do not clear user vault/profiles/drafts as rollback.
- Phase1 may be retained independently only with its engine/security qualification. If full rollback loses automatic recovery, disclose it; preserve existing user-driven retry rather than fake healthy UI. No runtime feature-flag framework or compatibility aliases required.

## Documentation / completion boundary

`document-android-recovery-contract` updates existing `native/android-app/README.md` only: correct currently overstated active factory settings, describe canonical heartbeat/timeout/backoff, background policy, status meanings, no command replay, diagnostics, commands and remaining qualification limitations; add scoped change note. This non-code documentation exception stays inside native/android-app. Root docs/architecture and changelog remain read-only under assignment; architecture blueprint here is intended design, not claim deployed docs already updated. Coordinator may separately authorize root-doc synchronization; no implementation code outside shared/androidApp.

All new code files target <200 lines; existing huge screens/VM get narrow wiring plus extraction of moved runtime logic, not unrelated rewrite. Tests split by responsibility if needed. No product implementation or verification executed during plan authoring. Planning/independent review/final validation are coordinator gates, not these future implementation task receipts.

## Durable tasks

```evcrate-tasks
[
  {
    "id": "restore-current-socket-terminal-streams",
    "title": "Move terminal stream and input recovery to retained ownership",
    "blocked_by": [
      "reconcile-lifecycle-and-network"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalRuntimeCoordinator.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalInputDispatcher.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalSessionController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAttachQueue.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalReplayGate.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalScreens.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalRuntimeCoordinatorTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalSessionControllerTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalReplayGateTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalRepositoryIntegrationTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/ProjectTerminalVisibilityTest.kt"
    ],
    "constraints": [
      "No server, protocol, web or desktop changes; preserve exact owner/socket fences."
    ],
    "acceptance": [
      "Disconnect immediately revokes readiness and old-input epoch without discarding accepted output/drafts or faking PTY exit.",
      "Hidden retained terminals reattach from exact accepted offset/incarnation on new socket; old callbacks/frames/drains cannot reopen readiness.",
      "One attach per terminal/socket; ambiguous timeout requires socket replacement through shared backoff without false stable-reset bypass.",
      "Missing transport is explicit not-submitted; stale queued writes never replay on replacement socket; submitted uncertainty preserved."
    ],
    "verification": [
      "Coordinator runs all terminal controller/replay/runtime/repository/visibility JVM tests.",
      "Inject loss at input admission, late predecessor frames, same-socket late buffer after timeout and hidden Files/Editor reconnect."
    ]
  },
  {
    "id": "decouple-terminal-status-presentation",
    "title": "Render distinct transport, stream and process status",
    "blocked_by": [
      "restore-current-socket-terminal-streams"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalConnectionPresentation.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalScreens.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalConnectionPresentationTest.kt"
    ],
    "constraints": [
      "No server, protocol, web or desktop changes; preserve exact owner/socket fences."
    ],
    "acceptance": [
      "Both renderers use one pure status policy; no alive/restartCount-only connection dot.",
      "Ready requires verified foreground/route environment, current connected socket, accepted attachment/drain and current metadata; idle shell never described busy.",
      "Lost inventory/transport shows stale process state and offline/reconnecting/auth status while preserving text."
    ],
    "verification": [
      "Coordinator runs presentation table-driven tests and connected UI semantics assertions.",
      "Check idle/live command/exited/restarted and disconnected-after-ready in active ProjectTerminalScreen and dormant renderer tests."
    ]
  },
  {
    "id": "author-recovery-device-journeys",
    "title": "Author active-engine and mounted recovery qualification journeys",
    "blocked_by": [
      "decouple-terminal-status-presentation"
    ],
    "allowed_files": [
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/AndroidConnectionRecoveryJourneys.kt",
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/AndroidWsFaultFixture.kt",
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/RetainedWorkspaceLifecycleTest.kt"
    ],
    "constraints": [
      "No server, protocol, web or desktop changes; preserve exact owner/socket fences."
    ],
    "acceptance": [
      "Real shared Android engine tested against controlled Ping/Pong blackhole fixture.",
      "Mounted MainActivity journeys assert unchanged PTY/session identity, hidden output catch-up, input fencing and visible status.",
      "OS network/lifecycle and real unchanged server coverage distinguished from fault fixture and unit tests."
    ],
    "verification": [
      "Coordinator compiles Android instrumentation sources and runs AndroidConnectionRecoveryJourneys and retained lifecycle instrumentation on declared devices.",
      "Absent device/server/network control is an explicit qualification blocker, never a fixture pass substituted for production proof."
    ]
  },
  {
    "id": "qualify-integrated-android-recovery",
    "title": "Run integrated tests and real-device recovery matrix",
    "blocked_by": [
      "author-recovery-device-journeys"
    ],
    "allowed_files": [],
    "constraints": [
      "No server, protocol, web or desktop changes; preserve exact owner/socket fences."
    ],
    "acceptance": [
      "Shared JVM and Android unit suites/debug build pass with exact counts and recorded command results.",
      "Active Android engine blackhole and real-server lifecycle/network/hidden-terminal/multi-profile matrix pass on named emulator and physical device.",
      "No forbidden implementation paths, server API/schema changes, blind input replay or duplicated recovery ownership."
    ],
    "verification": [
      "Run commands and scenario matrix in this phase; record exact device/API, engine/runtime versions, failures/skips and timings.",
      "Independent code reviewer evaluates cancellation, admission, retirement and token redaction; unresolved severe issue blocks acceptance."
    ]
  },
  {
    "id": "document-android-recovery-contract",
    "title": "Update native documentation with qualified behavior and limitations",
    "blocked_by": [
      "qualify-integrated-android-recovery"
    ],
    "allowed_files": [
      "native/android-app/README.md"
    ],
    "constraints": [
      "No server, protocol, web or desktop changes; preserve exact owner/socket fences."
    ],
    "acceptance": [
      "Existing README describes actual production engine, policy timings, best-effort background behavior and separate process/stream/transport semantics.",
      "Change note and exact verification evidence distinguish unit/JVM/device results; no false always-on or command-activity promise."
    ],
    "verification": [
      "Inspect README links/commands and compare descriptions with integrated implementation/reported qualification."
    ]
  }
]
```

- [ ] <!-- evcrate-task:restore-current-socket-terminal-streams --> Move terminal stream and input recovery to retained ownership
- [ ] <!-- evcrate-task:decouple-terminal-status-presentation --> Render distinct transport, stream and process status
- [ ] <!-- evcrate-task:author-recovery-device-journeys --> Author active-engine and mounted recovery qualification journeys
- [ ] <!-- evcrate-task:qualify-integrated-android-recovery --> Run integrated tests and real-device recovery matrix
- [ ] <!-- evcrate-task:document-android-recovery-contract --> Update native documentation with qualified behavior and limitations
