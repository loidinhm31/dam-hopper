# Phase 1: Engine Keepalive & Timeouts

Priority P1 · pending · 4h · integration owner: transport implementer. Dependency: none. [Overview](plan.md) · [RCA §§1–2](../reports/debugger-261028-1631-android-connection-indicator-rca.md).

## Evidence and architecture

Production path is `ProfileRepository → WsConnection(default HttpClient) → createDefaultHttpEngine(android)`. Dormant `AndroidHttpClientFactory` settings do not affect it. Ktor 3.1.0 OkHttp sessions use engine-owned ping; `WebSockets.pingIntervalMillis` alone is ineffective. Existing server sends 30s ping / 90s deadline; no backend change needed. Read/write HTTP timeout is not a WS idle deadline. Do not infer original physical drop cause from these gaps.

## Exact ownership / wire-active-engine-keepalive

Modify:
- `native/android-app/shared/src/androidMain/kotlin/dev/damhopper/nativeapp/core/transport/PlatformHttpEngine.android.kt`: canonical OkHttp policy; preserve disabled HTTP/TLS redirects and `retryOnConnectionFailure(true)`.
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WsConnection.kt`: bounded single-attempt handshake and owner-safe teardown, not retry scheduling.
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/transport/WsConnectionTest.kt`: deterministic deadline/cancellation/socket-fencing regression tests.
Create:
- `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/network/AndroidWsEnginePolicyTest.kt`: inspect/configure actual shared Android engine through a narrow internal test seam; no duplicate factory solely for tests.
Delete:
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/network/AndroidHttpClientFactory.kt`: RCA found no consumers. Before deletion search imports/DI/callers; migrate any current consumer to canonical engine, never retain second configuration. Escalate ownership if a newly discovered caller is outside this task.

## Concrete implementation sequence

1. Set OkHttp builder `pingInterval(15, SECONDS)`, `connectTimeout(15, SECONDS)`, `writeTimeout(30, SECONDS)`; preserve current read-timeout behavior rather than applying a global streaming cutoff. Explicitly document that HTTP read limits are not WS liveness. No Ktor application Ping frames, JSON heartbeat, terminal probe or endpoint addition.
2. Wrap token lookup + URL construction + `webSocketSession` in a 20s cancellable whole-attempt deadline. Engine connect timeout handles TCP stages; whole-attempt limit also covers token/TLS/upgrade. Own-deadline expiry becomes typed retryable `ConnectTimeout`, using a timeout-result boundary that distinguishes it from parent/stop/retirement cancellation; do not classify every `TimeoutCancellationException` as external cancellation. Existing correlated request 30s deadlines remain separate and unchanged.
3. Keep `WsConnection.connect()` a single serialized attempt. Existing calls observing Connected return without claiming health. Add narrow internal attempt/teardown seams only where required by cancellation tests; do not expose retry policy here.
4. Check cancellation after credential lookup/handshake and before publication. Own attempt expiry reports `ConnectTimeout`; external cancellation propagates and never schedules retry. A canceled/retired attempt closes any obtained session and cannot bind correlator/writer/state to it. Phase2 supplies the non-reentrant owner-admission gate; checkpoints alone are not proof retirement cannot race registry entry.
5. On detected close/error synchronously invalidate socket identity, receipt and writer before any suspending cleanup; publish unavailable state without waiting on best-effort close. Capture old resources so delayed cleanup cannot clear a successor. Bound graceful close to 2s, then cancel session and owned pending work. Do not let reader self-cancellation skip resource cleanup. Normal closeReason awaiting also belongs inside bounded cancellation-safe lifecycle handling.
6. Keep current admission/serialized binary-pair invariants. A failed cleanup that cannot establish local quiescence must keep retirement unavailable; do not silently release resources/ownership. Do not close injected externally owned HttpClient; final runtime disposal closes the default owned client exactly once (Phase2 ownership integration).

## Verification specification

- Tests: hanging token provider, hanging handshake, own deadline expiry followed by autonomous retry, external cancellation without retry, late handshake completion, old reader error after replacement, explicit close during connect, response-correlator cancellation/capacity and atomic writer regression.
- Production-construction Android test asserts the effective OkHttp interval/redirect policy, not the removed factory's constants. Use actual Android engine; helper configuration assertion alone does not prove timers/network detection.
- Future device target: while execution/network permitted, blackhole missing Pong produces unavailable approximately within two 15s ping intervals; record observed timing and scheduling tolerance, not a universal 30s guarantee. No finite wall-clock guarantee in Doze.
- No checks run by planner or phase implementer mid-flight. Coordinator executes once after all selected tasks land; commands in overview/Phase4.

## Risks / rollback / security

- 15s traffic increases battery/radio use; initial candidate from dormant settings, not measured optimum. Qualify idle foreground/background on real device; tune one canonical value if needed.
- Whole-attempt limit can reject slow TLS/token paths; retain typed cause and sanitized timeout category. Never log token-bearing URL, credentials, terminal content or capability.
- Shared engine also backs REST; heartbeat affects WS only, connect/write limits can affect slow HTTP uploads. Include large-upload regression and do not introduce a global request/call timeout for long streams.
- Rollback: revert engine/deadline changes as one transport unit if qualification fails; never disable TLS, redirects or owner fencing. No server/storage migration.

## Durable tasks

```evcrate-tasks
[
  {
    "id": "wire-active-engine-keepalive",
    "title": "Wire production Android heartbeat and bounded WS attempts",
    "blocked_by": [],
    "allowed_files": [
      "native/android-app/shared/src/androidMain/kotlin/dev/damhopper/nativeapp/core/transport/PlatformHttpEngine.android.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WsConnection.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/network/AndroidHttpClientFactory.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/transport/WsConnectionTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/network/AndroidWsEnginePolicyTest.kt"
    ],
    "constraints": [
      "No server, protocol, web or desktop changes; preserve exact owner/socket fences."
    ],
    "acceptance": [
      "Actual Android engine initiates RFC6455 pings at 15s; no Ktor-only or JSON heartbeat.",
      "Whole WS attempt including token retrieval expires after 20s; cancellation never publishes a late socket.",
      "Redirect/TLS/token security preserved; unused factory removed after caller search."
    ],
    "verification": [
      "Coordinator runs :shared:jvmTest --tests *WsConnectionTest and :androidApp:testDebugUnitTest --tests *AndroidWsEnginePolicyTest after integrated changes.",
      "Phase4 real Android blackhole qualification proves active-engine behavior; JVM Java engine is not proof."
    ]
  }
]
```

- [ ] <!-- evcrate-task:wire-active-engine-keepalive --> Wire production Android heartbeat and bounded WS attempts
