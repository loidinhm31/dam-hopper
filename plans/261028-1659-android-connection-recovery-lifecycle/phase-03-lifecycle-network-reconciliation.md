# Phase 3: Android Lifecycle & Network Change Reconciliation

Priority P1 · pending · 6h · one lifecycle/network integration owner. Depends on Phase2 retained integration. [Overview](plan.md) · [RCA §4](../reports/debugger-261028-1631-android-connection-indicator-rca.md).

## Architecture / accepted behavior

Use current `AndroidLifecycleCoordinator → LifecycleCoordinator → retained workspace` fanout; add a small platform-neutral connection-environment signal, not another lifecycle framework. A default-network callback is a recovery hint, never proof server reachable. A REST success cannot certify an old WS. Because the pinned OkHttp adapter cannot safely accept arbitrary application Ping frames and no existing dedicated health probe is established, conservatively replace a suspect socket after a genuine background/resume or changed default route. No server API extension.

### Foreground and network epoch contract

- Retained environment tracks logical foreground/background epoch, current default-network identity/route revision, and whether a live socket predates an unreconciled event. Merge duplicate resume/onStart/network hints into one newest desired environment revision.
- First app start creates first socket, not a redundant replacement. Genuine background→foreground sets one reconcile request even if transport locally says Connected. `onResume` without a background transition (e.g. permission UI) does not independently force replacement. Notification permission status still refreshes on every resume.
- Rotation/configuration detaches Activity adapters but does not advance logical background epoch or replace runtime/socket. Pass `isChangingConfigurations` through the Activity adapter's stop/detach decision; retained coordinator state is already foreground for the replacement Activity. Instrumentation recreation must prove this, not assume all stop/start callbacks mean Doze.
- During background keep established socket best-effort; engine-native pings and existing attached streams may continue while OS allows, with no wake lock/foreground service/WorkManager. Pause new retries and cancel in-progress establishment; preserve authorized intent. Synchronously mark environment unverified before publishing background/foreground state, so first resumed frame cannot show stale READY; terminal input disabled until new current-socket baseline/drain. Existing best-effort background observation preserved, not a notification-delivery or uninterrupted-streaming promise.
- When Android reports no default network, invalidate usable transport and close exact socket, cancel pending establishment/delay, enter WaitingNetwork. Suspend retries until an available default network or explicit foreground resnapshot. Route existence, not `VALIDATED` Internet status, gates attempts: LAN/private/VPN servers may be reachable without Internet validation. Captive portal still fails via ordinary transport deadline/backoff.
- New default network/route while foreground makes the current old-route socket suspect and replaces it once; while background mark dirty, wait for foreground. Initial callback matching the startup snapshot is not a change. Ignore delayed onLost for a predecessor network. A new network change arriving after a handshake began can invalidate that attempt; never allow it to publish against an older environment revision.
- Coalescing: foreground reconciliation resnapshots network first, then handles latest revision. If an already-running attempt began after that revision, join it; otherwise cancel/fence old attempt and establish once on newest revision. Duplicate hints do not reset backoff. Genuine foreground/network restoration may wake one pending transient retry immediately; repeated identical signals cannot continuously bypass backoff.
- AuthBlocked/ConfigurationBlocked/Stopped and retired owners dominate every environment signal. No route callback selects another profile, refreshes credentials automatically or resurrects cleared intent.

## Exact ownership / reconcile-lifecycle-and-network

Create:
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/network/AndroidNetworkMonitor.kt`: application-context `ConnectivityManager.registerDefaultNetworkCallback`, initial snapshot, matching-network filtering, deduplicated event delivery and unregister/close. No Activity retained; minSdk29 needs no compatibility branch. Reuse existing `ACCESS_NETWORK_STATE` manifest permission; no permission additions.
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/lifecycle/ConnectionEnvironment.kt`: small immutable neutral environment/revision type, no Android `Network` type exposed to common code.
- `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/network/AndroidNetworkMonitorTest.kt`: injected callback-registration/snapshot boundary tests; actual Android callback behavior separately instrumented.
Modify:
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/lifecycle/AndroidLifecycleCoordinator.kt`: suppress configuration-only background signal and preserve resume callback semantics.
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/lifecycle/LifecycleCoordinator.kt`: expose/reuse logical foreground revision without duplicate listener dispatch; background remains nondestructive.
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt`: wire configuration state/resume to retained ports, keep notification refresh; no retry jobs here.
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt`: own one network monitor; route environment to existing attached supervisors; unregister during final retained teardown. Avoid duplicate Agents refresh storms; existing inventory watcher refreshes after actual socket connection.
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WsRecoverySupervisor.kt`: apply environment revisions, replacement versus ordinary connect, foreground/network eligibility and cancellation. Socket replacement clears current receipt/readiness before reconnect.
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt`: preserve file watcher pause/resume and retained buffers; hand terminal lifecycle state into retained stream coordinator, never connect directly.
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalState.kt`: background suspends input immediately; resume only restores visibility eligibility, not old replay-ready. Phase4 current-socket stream authority remains additional mandatory gate.
- Tests: existing `LifecycleCoordinatorTest.kt`, `WsRecoverySupervisorTest.kt`, `NativeWorkspaceViewModelTest.kt` at literal paths in contract.

## Concrete sequence / acceptance

1. Implement monitor with registration token and idempotent close; marshal callbacks into retained serialized recovery context. Callback must not perform network IO or Compose mutation on Android callback thread. Fetch and apply latest snapshot without registration/snapshot race; compare exact network identity before clearing route.
2. Add environment revision semantics and cancellation tests before Activity wiring. Route hints from every existing attached runtime, including known Disconnected/Error; do not reuse `currentRuntimeKeys()` inventory filter, which excludes disconnected sockets.
3. In genuine foreground event fence old terminal readiness first, resnapshot route then request supervised replacement/join. Output buffers, scroll position, drafts, selected session/incarnation and dirty editor state remain; no PTY create/kill/restart side effects. File subscriptions continue using their existing socket-qualified restoration.
4. Bind adapter/monitor to retained VM lifetime. Configuration destruction detaches widgets only; final onCleared stops producers, unregisters monitor, drains supervisors and releases listeners once. No observer/callback leak across repeated recreation.
5. Keep terminal input disabled throughout foreground reconciliation until Phase4 baseline/drain. Files/Editor selected during recovery must not block connection restoration or hidden terminal output catch-up.

## Verification / risks / rollback

- Virtual-time tests: initial snapshot+onAvailable deduplication, B replaces A then stale onLost(A), loss/restoration, route changes during handshake, network+resume+retry simultaneous, background during backoff/handshake, repeated same revision, auth-stop dominance and retirement races.
- Lifecycle tests: initial foreground, real background, resume, repeated onResume, configuration recreation, monitor unregister, surviving workspace/editor buffers and no controller closure. Unit callback doubles qualify mapping only, not actual OS network behavior.
- Real journeys: Wi-Fi→cellular and back, airplane mode restoration, VPN/private LAN without Internet validation, screen-off/Doze→resume, Files/Editor foreground, rotate during connect/replay. Record device/API, route, time unavailable→connected→replay-ready and max attempt concurrency. Doze restrictions mean no continuous background service guarantee.
- Risks: conservative replacement costs handshake/replay and may interrupt uncertain writes. Preserve uncertain outcomes; never resend. Ping battery cost continues best-effort in background by explicit policy; measure rather than imply retries paused means zero radio traffic. Route-flap storms bounded by epoch coalescing/backoff.
- Rollback: remove monitor forwarding and restore previous lifecycle behavior together with dependent Phase4 integration if qualification fails. Keep retained PTYs/drafts; never introduce destructive background cleanup. Phase1 heartbeat independent only after qualification.

## Durable tasks

```evcrate-tasks
[
  {
    "id": "reconcile-lifecycle-and-network",
    "title": "Reconcile genuine foreground and default network changes",
    "blocked_by": [
      "retain-authorized-recovery-runtime"
    ],
    "allowed_files": [
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/network/AndroidNetworkMonitor.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/lifecycle/ConnectionEnvironment.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/lifecycle/AndroidLifecycleCoordinator.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/lifecycle/LifecycleCoordinator.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WsRecoverySupervisor.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalState.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/lifecycle/LifecycleCoordinatorTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/transport/WsRecoverySupervisorTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/network/AndroidNetworkMonitorTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModelTest.kt"
    ],
    "constraints": [
      "No server, protocol, web or desktop changes; preserve exact owner/socket fences."
    ],
    "acceptance": [
      "Genuine resume/route change replaces suspect pre-event socket once; rotation alone does not.",
      "No retries started in background or known network loss; resume/restoration wakes one owner recovery.",
      "Default-network callbacks use exact network identity; availability never marks Connected or overrides auth/retirement.",
      "Background synchronously invalidates environment freshness; first resumed frame cannot show stale READY; buffers/drafts retained until current-socket replay."
    ],
    "verification": [
      "Coordinator runs lifecycle/supervisor JVM tests and network/ViewModel Android unit tests.",
      "Device journeys exercise Doze, airplane/network switch, duplicate hints, foreground while disconnected and rotation during handshake."
    ]
  }
]
```

- [ ] <!-- evcrate-task:reconcile-lifecycle-and-network --> Reconcile genuine foreground and default network changes
