# Phase 2: Centralized Reconnection & Recovery Supervisor

Priority P1 · pending · 10h · single recovery integration owner. [Overview](plan.md) · [RCA §3](../reports/debugger-261028-1631-android-connection-indicator-rca.md). Depends on Phase1. Implement policy task before retained integration; shared transport files never concurrent writers.

## Frozen architecture contracts

- `ConnectionRef(profileId,generation)` remains authorization lifetime. Transient reconnect replaces only `SocketInstanceRef`; never call registry retirement to retry. Exact endpoint + authenticated account + owner qualify runtime reuse.
- One `WsRecoverySupervisor` per explicitly attached runtime, owned by `NativeWorkspaceViewModel` retained scope, not Compose, Activity or Agents roster. A runtime survives transient sockets and rotation; a socket does not. No connect-all-saved-profiles behavior.
- `WsConnection.connect()` remains the low-level single-attempt operation. Supervisor is its sole production policy caller. Terminal/UI code asks for recovery/current connectivity; it never starts a competing connect loop. Existing per-domain restoration watchers still own their subscriptions.
- Supervisor input: start authorized intent, socket terminal outcome, manual retry, foreground/network reconciliation hint, terminal baseline recovery-required/settled notification, stop/dispose. Output: observable recovery snapshot `{owner, phase, socket?, attempt, nextDelay?, reason}`. Phases: Stopped, Connecting, WaitingRetry, Connected, PausedBackground, WaitingNetwork, AuthBlocked, ConfigurationBlocked. Baseline notifications affect backoff stability only, not transport Connected semantics. Keep wire DTOs unchanged.
- `requestRecovery(reason, expectedSocket?)` coalesces with current work. `awaitConnected()` joins owner recovery and returns the exact Connected socket or explicit unavailable/blocked outcome; it does not imply terminal replay readiness. Cancellation of one waiter never cancels the retained supervisor. Stop and forced replacement are distinct operations.
- Observe WsState before first attempt; handle failure returned as Error as well as thrown establishment errors. Do not infer Disconnected means user intent: supervisor explicit stop clears intent before closing; remote normal close while intent remains is transient.

## Exact ownership

### implement-recovery-supervisor — create
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WsRecoverySupervisor.kt`: event serialization, attempt/delay ownership, observable state, lifecycle hooks. Keep under 200 lines where practical.
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WsRecoveryPolicy.kt`: pure typed close/handshake/failure classification, injectable delay/jitter/monotonic time; no generic retry framework.
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/transport/WsRecoverySupervisorTest.kt`.
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/transport/WsRecoveryPolicyTest.kt`.
Modify `.../core/transport/WsConnection.kt` and `WsTypes.kt` in that common package: propagate typed establishment/close outcomes, add a small revocable runtime-admission latch and bounded replacement/disposal seam; no second scheduler. Runtime IO jobs joined by retirement use non-suspending current-owner snapshots plus the local admission latch, not suspending registry/ProfileRepository calls. Preserve owner-error behavior, revoke-before-successor semantics and exact-socket writer admission; unrelated atomic manual-route registry admission remains unchanged. Do not reuse string-matching raw error text as policy.

### retain-authorized-recovery-runtime — modify
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/profiles/ProfileRepository.kt`: cache exact WsConnection by current ConnectionRef and normalized endpoint under existing mutex; token provider reads current vault token, never caches credentials. Account/generation transition invalidates old entry through awaited retirement. A cache is object reuse, not authority.
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt`: remove startup direct connect; hand runtime to retained services idempotently before recovery starts. Extend existing `RetainedRootServices` in this file for recovery access; keep nullable-service preview/test path explicitly nonconnecting, not a second production fallback owner.
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt`: migrate dormant root connect/teardown calls to the same retained recovery contract when supplied; do not mount the shell or add another supervisor. Terminal callsites move in Phase4.
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt`: own supervisor map beside existing runtime host; register eligible lifetime first; attach existing Agents consumers before start; remove Compose lifetime from connection intent. Final teardown stops recovery before agent/workspace drain, disposes owned clients once.
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/ownership/ConnectionRegistry.kt`: only narrow existing barrier integration/documented invariants if required; do not rewrite generation/retirement algorithm or add socket retry state here. Prefer unchanged implementation when existing registration is enough.
- Tests: `shared/src/jvmTest/.../features/profiles/ProfileRepositoryTest.kt`, `ProfileRepositoryRaceTest.kt`; `androidApp/src/test/.../platform/workspace/NativeWorkspaceViewModelTest.kt`; `shared/src/commonTest/.../core/ownership/ConnectionRegistryTest.kt`. Full literal paths in task contract below.

## State policy / concrete steps

1. Freeze typed failure mapping and implement pure policy first:

| Event | Policy while authorized intent active |
|---|---|
| Initial network/DNS/IO/timeout failure; remote normal/null/1001 close | Retry with bounded backoff |
| 4401 | AuthBlocked / existing login path; no automatic credential challenge |
| 4403 | AuthBlocked / existing MFA path; no generic retry |
| HTTP upgrade 401 | LoginRequired; stop generic loop |
| HTTP upgrade 403 | Auth/access denied; block, do not invent MFA from HTTP status alone |
| 1013 or upgrade 503 | Retry as authentication-service unavailable; do not erase valid credential |
| 4001 overflow | Retry plus invalidate terminal/domain baselines; never replay uncertain mutations |
| TLS certificate/hostname/security refusal; protocol incompatibility 1002/1003/1007/1008/1009 | ConfigurationBlocked with actionable safe reason; retry only after explicit configuration/owner change, not network noise |
| Other HTTP 4xx / malformed upgrade | ConfigurationBlocked unless existing typed auth handling says otherwise |
| Other HTTP 5xx / service restart | Transient retry |
| Cancellation / retirement / explicit disconnect | No retry; stop intent before teardown |

2. Initial attempt immediate. Retry base sequence 1,2,4,8,16,30 seconds; equal jitter in `[base/2,base]`, max actual delay 30s. Inject clock/random/delay for deterministic tests. One scheduled delay and at most one handshake. Keep retrying transient failures while foreground intent exists; no finite retry count requiring user action. Keep accumulated failure count through brief opens; reset only after 30s stable Connected with no outstanding recovery-required attachment/baseline failure. Pure transport runtimes with no terminal demand use transport stability alone. Terminal readiness remains separate from transport Connected; connected-but-perpetually-failed attach cannot reset retry history.
3. Manual Retry may wake one pending transient retry, not bypass auth/configuration or start parallel work. Attach timeout/uncertain-send replacement immediately fences/closes the suspect socket, but establishment always passes through this same retry scheduler and increments failure history; no fresh immediate-connect bypass. Repeated hints share in-flight attempt; network/resume coalescing epoch added Phase3. No periodic REST health polling.
4. Cache/get under profile mutex, but never start supervisor or await socket work there. Root services attach verifies exact client/WS owner, endpoint and authenticated `session.user` before admitting. Supervisor rechecks authority after async work using current snapshot/cancellation; runtime cannot adopt another account on same display label.
5. Before awaiting retirement children, synchronously revoke captured runtime-admission latch, stop intent and detach publication callbacks under its short local gate; then cancel timers/attempt/waiters and await only local IO/close work. Worker creation, post-handshake publication, reader acceptance and cleanup share that revocation boundary and read registry's published usable-owner snapshot without entering its mutex. Profile cache eviction uses captured exact entry/local removal without reacquiring profile mutex. No joined worker may call ProfileRepository or a suspending registry API, including finally/late-handshake branches; token provider is vault-only. Registry/profile locks are absent from joined-worker dependency graph, not merely hoped avoided by cancellation. Preserve C2a1 registration-before-producers, revoke-before-drain and fail-closed aggregation. Deterministic test pauses immediately before post-handshake owner admission, begins retirement while profile mutex is held, then releases handshake: no registry/profile reentry, late publication, deadlock or successor release before drain.
6. Distinguish reusable transient `disconnectSocket` from terminal runtime `stop`/`dispose`. Migrate every production explicit disconnect caller so its intent cannot be accidentally resurrected. Clear cached entry only for matching old object/generation; obsolete callbacks never evict successor. Injected test clients remain caller-owned; default WS HttpClient and scope disposed exactly once at final lifetime end.
7. Extend existing diagnostics only: sanitized reason category, owner/generation/socket ID, attempt, monotonic elapsed time and next delay. Do not include raw exception URL, query credential, command/output or capabilities; no new telemetry service.

## Success and verification

- Virtual-time tests cover full backoff/cap/jitter bounds/stable reset, failed first attempt, normal/abrupt close, each policy row, duplicate start, late callbacks, stopped owner, canceled waiter, manual Retry and no busy loop.
- Integration tests prove two root acquisitions return same current socket object; owner transition returns new object only after drain; rotation retains supervisor; old socket cannot close new; profile B remains live when A fails; logout during token/handshake cannot recreate credentials/socket.
- Existing Agents inventory/reducer watchers see new socket and establish silent baseline. Recovery itself produces no notification attention or automatic navigation.
- Implementation author adds tests; coordinator later runs scoped/full commands in overview. No build/test claimed now.

## Risk / rollback

- Highest risk: profile mutex → retirement drain → child trying profile/registry causes deadlock. Drain uses captured handles only, cancel before join; keep successor unavailable if cleanup fails.
- Cache resource leak and duplicated root calls: exact identity cache + retained supervisor map + once-only dispose tests. Never cache old authenticated account across generation transition.
- Phase2 temporarily leaves terminal callsites until Phase4 clean cutover; do not ship intermediate phases. Low-level mutex still serializes attempts, but final acceptance requires zero direct production screen connect callers.
- Roll back Phase2–4 together if retained owner regression; an isolated heartbeat can remain only if Phase1 qualification passes. No compatibility shims or server migration.

## Durable tasks

```evcrate-tasks
[
  {
    "id": "implement-recovery-supervisor",
    "title": "Implement one owner-scoped recovery state machine",
    "blocked_by": [
      "wire-active-engine-keepalive"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WsRecoverySupervisor.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WsRecoveryPolicy.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WsConnection.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WsTypes.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/transport/WsRecoverySupervisorTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/transport/WsRecoveryPolicyTest.kt"
    ],
    "constraints": [
      "No server, protocol, web or desktop changes; preserve exact owner/socket fences."
    ],
    "acceptance": [
      "One cancellable attempt or delay per runtime; initial and post-drop failures recover without screen action.",
      "Auth/configuration blocks cannot be overridden by hints; overflow forces resync and attach replacement uses same backoff without resetting while baseline remains failed.",
      "Stop cancels intent/delay/handshake; late work cannot mutate successor; no generation bump for transient loss."
    ],
    "verification": [
      "Coordinator runs supervisor/policy JVM tests with virtual time and deterministic jitter.",
      "Race simultaneous timer, retry, resume, network, explicit stop and retirement; maximum concurrent handshakes is one."
    ]
  },
  {
    "id": "retain-authorized-recovery-runtime",
    "title": "Integrate retained runtime, cache and awaited retirement",
    "blocked_by": [
      "implement-recovery-supervisor"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/profiles/ProfileRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/ownership/ConnectionRegistry.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/profiles/ProfileRepositoryTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/profiles/ProfileRepositoryRaceTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModelTest.kt",
      "native/android-app/shared/src/commonTest/kotlin/dev/damhopper/nativeapp/core/ownership/ConnectionRegistryTest.kt"
    ],
    "constraints": [
      "No server, protocol, web or desktop changes; preserve exact owner/socket fences."
    ],
    "acceptance": [
      "Root remount/rotation reuses exact current authorized transport and its supervisor.",
      "Retirement revokes local admission then drains workers without suspending registry/profile dependencies; paused pre-publication handshake cannot deadlock or publish late.",
      "Only explicitly attached authenticated profile runtimes recover; saved unrelated profiles never connected."
    ],
    "verification": [
      "Coordinator runs affected profile/registry/shared tests and retained ViewModel Android unit tests.",
      "Assert exact runtime identity across recreation, no leaked owned client after final disposal, profile A failure does not alter profile B."
    ]
  }
]
```

- [ ] <!-- evcrate-task:implement-recovery-supervisor --> Implement one owner-scoped recovery state machine
- [ ] <!-- evcrate-task:retain-authorized-recovery-runtime --> Integrate retained runtime, cache and awaited retirement
