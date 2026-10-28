# Android connection stability, recovery, and terminal indicator — RCA

## Executive summary

**Scope:** `native/android-app/`; read-only source investigation. No source/config/test edits; no fixes implemented. Requested report is the deliverable. `debugging`, `mobile-development`, `problem-solving`, and `docs-seeker` skill instructions read and applied.

**Evidence boundary:** user-reported symptoms accepted. Current production callsites, state transitions, existing test definitions, official Android documentation, Ktor 3.1.0 source, and published OkHttp 4.12.0 source inspected. No app/device reproduction, incident logs, packet capture, build, lint, or test execution. Findings below establish source-level defects and symptom mechanisms; **initial physical/network cause of the reported drop remains unconfirmed**. Statements marked **[INFERENCE]** describe conditional runtime consequences.

### Principal findings

| Issue | Source-established cause | Impact / priority |
| --- | --- | --- |
| Silent/half-open connection persists | Active Android engine has no client-initiated WebSocket ping/pong deadline. Configured 15-second engine lives in unused `AndroidHttpClientFactory`; actual `WsConnection` uses another engine factory | **P1**: no application-owned bound on detecting a silent partition while foreground execution is available |
| Connection does not recover automatically | Reader failure/close paths terminate connection; no reconnect-on-drop scheduler/backoff owner. Root reconnect effect depends on profile/URL/generation, not socket state. Attach queue performs requested attempts, not autonomous retries | **P1**: detected transient failure remains unavailable until another qualifying action |
| Idle terminal green | Both tab renderers use PTY `session.alive` and historical restart count, not command activity, WebSocket health, or replay readiness | **P1 UX**: an idle live shell legitimately matches green; users interpret it as something else |
| Green/ready survives disconnect | Active terminal preserves local session metadata when current inventory receipt disappears; controller replay gate receives no disconnect reset. Dot never reads transport availability; ready copy uses replay completion alone | **P1 state presentation**: last-known server/process state presented without freshness qualification |

**Important correction:** current Rust server **already sends WebSocket pings every 30 seconds**, with a **90-second server-side liveness deadline**. OkHttp automatically answers server pings. Thus “no keepalive traffic anywhere” is false for this source tree. Missing **client-side failure detection**, missing **recovery ownership**, and misleading **presentation** remain separate confirmed gaps. Server-side detection cannot guarantee a partitioned phone learns of closure within 90 seconds.

**Recommended direction:** one owner-qualified connection lifecycle; engine-native heartbeat plus foreground/network reconciliation; cancellable single-flight backoff recovery; terminal status separates transport availability/freshness, PTY lifecycle, and attach/replay readiness. Keep buffers and server-owned PTYs; never manufacture `alive=false` merely because observation is unavailable.

## 1. Production construction path: configured factory bypassed

```text
MainActivity
  -> DamHopperMobileApp.RootContent
  -> ProfileRepository.getOrCreateWsConnection(profileId)
  -> WsConnection(connection, baseUrl, authTokenProvider, registry)
       default HttpClient(createDefaultHttpEngine()) { install(WebSockets) }
  -> Android actual createDefaultHttpEngine()
       OkHttp.create { redirects disabled; retryOnConnectionFailure(true) }
```

Evidence:

- `MainActivity.kt:235-244`: mounts `DamHopperMobileApp`, passes retained ViewModel services/workspace provider.
- `DamHopperMobileApp.kt:249-279`: creates API/WS/terminal repositories and attempts `ws.connect()`.
- `ProfileRepository.kt:191-203`: directly constructs `WsConnection`; **does not supply `httpClient`**. Despite its name, this method constructs a new object on each invocation; no cached socket/retry supervisor here.
- `WsConnection.kt:45-53`: constructor default installs `WebSockets` without `pingIntervalMillis` configuration.
- `PlatformHttpEngine.kt:5-10`: expect/actual platform boundary; Android selects OkHttp.
- `PlatformHttpEngine.android.kt:6-12`: only redirects and `retryOnConnectionFailure(true)` configured.
- `shared/build.gradle.kts:43-51`: Android uses Ktor OkHttp; JVM uses Java engine. JVM transport tests do not qualify Android engine behavior.

### Active versus dormant configuration

| Setting | Active shared Android engine + WS client | `AndroidHttpClientFactory` |
| --- | --- | --- |
| Engine creation | `createDefaultHttpEngine()` | `createEngine()` |
| Redirects | HTTP/TLS redirects disabled | HTTP/TLS redirects disabled |
| OkHttp connection retry flag | `true` | `true` |
| OkHttp ping interval | Not set; default zero disables client-originated ping | `15 seconds`, lines 22-31 |
| Ktor WebSockets ping | Plain `install(WebSockets)` | `pingIntervalMillis = 15_000`, lines 37-41 |
| Explicit HTTP timeout policy | No factory-specific timeouts installed in `WsConnection` | Connect 15s, read/write 30s; Ktor request/socket 30s, lines 24-26,43-47 |
| Actual production use | Yes, profile construction chain above | No consumer found; search of Android app/shared sources finds definition only |

**Root configuration defect:** intended Android connection settings exist but are not wired into the actual production transport path. Editing only dormant factory would not affect current socket behavior.

### Ktor/OkHttp semantics: avoid ineffective remediation

Repo pins Ktor **3.1.0** (`gradle/libs.versions.toml:8,24-30`). Ktor's tagged version catalog specifies OkHttp **4.12.0**. This is upstream declared dependency evidence, not a Gradle-resolved runtime dependency report.

- Ktor 3.1.0 `OkHttpWebsocketSession.pingIntervalMillis` **reads the engine interval**; setter throws “OkHttp doesn't support dynamic ping interval … engine configuration.” Use OkHttp builder `pingInterval` for this engine, not Ktor plugin setting alone. Adapter also rejects unsupported outgoing control-frame types; manually sending `Frame.Ping` through its ordinary outgoing channel is not a suitable substitute.
- Published OkHttp 4.12.0 `OkHttpClient.kt:497,1019-1033`: default interval zero; configured periodic ping expects pong within the interval, otherwise listener receives failure. `RealWebSocket.kt:267-272,554-565` supplies timer/failure mechanism.
- `retryOnConnectionFailure(true)` handles request establishment/route/pooled-connection recovery. It does **not** recreate an established WebSocket, authenticate again, or reattach terminals after a drop.
- HTTP connect/read/write timeouts are not an idle WebSocket watchdog. Published `WebSocketReader.kt:110-122` explicitly clears the read timeout while waiting for the first byte of a new frame. A 30-second HTTP socket timeout therefore does not establish “disconnect after 30s without terminal output.”
- `WsConnection.request()` / `requestOnSocket()` have 30-second correlated-response limits (`:203-224,258-297`). Timeout unregisters/completes that request; **does not close socket, change `WsState`, or schedule reconnect**. Terminal attach/write uses `send`, not a correlated request (`TerminalRepository.kt:231-258`).

Upstream sources/provenance listed in §9. Published source JAR was inspected in memory, without creating repository files, to cross-check consequential OkHttp implementation claims after an anomalous GitHub redirect.

## 2. Stability: what is missing, what already exists

### Missing client-side failure detector

`WsConnection.readLoop` waits on `session.incoming` (`:315-345`); no heartbeat job, incoming-silence deadline, or periodic health probe in this class. It handles text protocol frames; other frames ignored at this layer. This is **not** evidence server pings go unanswered: OkHttp processes control frames below Ktor application delivery.

**[INFERENCE] Silent-partition scenario:** network path disappears without locally observable FIN/RST/close/error. No new application messages arrive; socket/session may remain locally active and `WsState.Connected` remains unchanged. Nothing in the active native transport creates its own periodic round-trip deadline to force a failure transition. Detection then depends on OS/TCP/library events, future traffic, or a close/error that actually reaches the phone.

Consequential guard: `WsConnection.connect():114-116` returns immediately while state is `Connected` or `Connecting`. An attach-triggered call to `connect()` is not a health check and does not force replacement of a stale-but-locally-connected socket.

### Existing server heartbeat — material qualification

- `server/src/idle_suspend/client_presence.rs:28-32`: heartbeat interval **30s**, deadline **90s**.
- `server/src/api/ws.rs:387-449`: dedicated control-frame reader; Ping/Pong and data activity update presence; Ping answered with Pong.
- `server/src/api/ws.rs:454-491`: heartbeat task sends pings; exceeding deadline marks closing and cancels socket tasks. A bounded five-second enqueue also guards heartbeat delivery to server writer channel.
- Published OkHttp `RealWebSocket.kt:341-347`: received server Ping enqueues Pong automatically.

Therefore a working current-version server/client pair is not truly silent on the wire merely because shell is idle. Existing 30-second traffic can preserve some NAT/proxy state. Missing client ping still matters for **local detection of missing inbound traffic/round trips**, especially when server's eventual closure cannot traverse failed path. Do not claim this gap alone proves the original connection physically dropped.

### Android environmental factors

**[INFERENCE] Possible triggers:** Wi-Fi loss/roaming, Wi-Fi→cellular route change, NAT/proxy expiration, screen-off/sleep, OS network restrictions, server/proxy restart. None established as the incident trigger.

Official Android Doze documentation confirms CPU/network work can be deferred and network access suspended. A heartbeat cannot guarantee continuous service while Android prevents execution/network access. Foreground resumption must reconcile transport; perpetual background keepalive/wakelock is not the default remedy. Radio dormancy alone is not evidence TCP was closed.

Missing information: device model/API, foreground/background timing, network topology, proxy timeout, server version, close codes, and log timestamps. No defensible drop-rate or failure-detection latency measurement available.

## 3. Detected close/failure: terminal state, no autonomous recovery

### Exact transition chain

```text
session.incoming ends normally
  -> await session.closeReason
  -> handleCloseReason(reason, capturedSocket)
  -> if captured socket still active: closeInternal(nextState)

session.incoming throws non-cancellation Throwable
  -> handleSocketFailure(error, capturedSocket)
  -> if captured socket still active: closeInternal(Error(error))

closeInternal
  -> clear activeSocketRef + currentReceipt
  -> cancel pending correlated requests
  -> cancel reader job
  -> best-effort close active session
  -> clear session + writer
  -> publish next WsState
  -> return; no reconnect timer/job
```

Evidence: `WsConnection.kt:315-357,384-442`.

Close classification (`WsConnection.kt:384-392`; `WsTypes.kt:8-30`):

| Event/code | Published state | Recovery policy in current native transport |
| --- | --- | --- |
| Normal/other/null close reason | `Disconnected` | None scheduled |
| Reader failure | `Error(cause)` | None scheduled |
| `4403` | `MfaRequired` | No automatic challenge/retry here |
| `4401` | `LoginRequired` | No automatic login flow here |
| `1013` | `AuthUnavailable` | No delayed retry here |
| `4001` | `Overflow` | No delayed reconnect/resync here |

Reader `CancellationException` returns without `handleSocketFailure` (`:346-351`). Explicit `disconnect()` already invokes cleanup (`:311-313`). Normal `closeReason.await()` is outside the loop's try/catch. Neither cancellation nuance proves an observed cleanup failure; no runtime evidence for one.

Socket-identity checks prevent obsolete reader callbacks from closing a replacement. Preserve this invariant in any recovery design. `closeInternal` cancels its own reader before best-effort session close; do not label this a separate proven bug without exercising it.

### Why upper layers do not restart the socket

| Layer | Actual responsibility | Why no reconnect-on-drop |
| --- | --- | --- |
| `WsConnection` | Single connection object's connect/send/request/read/close lifecycle | Failure and close methods contain no scheduler; failed handshake sets `Error` and returns (`:133-150`) |
| `ProfileRepository` | Profiles, credentials, auth, generation-qualified construction | `getOrCreateWsConnection` constructs object only; no state collector/backoff (`:191-203`) |
| `ConnectionRegistry` | Monotonic profile generation and retirement authority | Tracks ownership, not live socket health (`:20-79`). Ordinary socket failure does not call retirement or change root's generation key |
| `DamHopperMobileApp` | Builds repositories and connects once per effect-key change | `LaunchedEffect(activeProfileId, baseUrl, generation)` (`:249-289`); neither `WsState` nor network/foreground state a key |
| `ProjectTerminalScreen` | Session loading/selection and explicit attaches | Attach keys session ID/incarnation/revision/repository/connection key (`:743-771`); no direct WS-state collector or drop-driven attach trigger |
| `TerminalRepository` | REST/session operations and filtered message streams | No reconnect policy or connection-state aggregation (`:225-286`) |
| `TerminalAttachQueue` | Coalesces/orders requested attachments per controller | One `connect()` then one `send()` per enqueued request; catches/fences failure, calls result, moves on (`:49-95`). No backoff, delayed re-enqueue, replay-completion timeout, or automatic retry |
| `NativeWorkspaceViewModel` / `AgentRuntimeHost` | Observes existing socket for Agents authority/snapshots | State collectors invalidate inventory or react to an already-connected socket; **do not invoke connect** (`:579-595,634-644`) |

Production `connect()` callsite search found root startup, ProjectTerminalScreen attach/recovery callbacks, attach queue's supplied callback, and dormant Workbench equivalents. No separate connection supervisor identified.

### Recovery opportunities that DO exist

“No automatic reconnect-on-drop” does **not** mean “no retry anywhere.”

- Active-session selection/changed incarnation/attachment revision/remount can run attach effect; callback calls `ws.connect()` then `attachTerminal()` (`ProjectTerminalScreen.kt:743-771`). If state is already `Disconnected/Error`, another attempt can establish a socket.
- Attach failure banner **Retry** increments `attachmentRevision` (`:1005-1022`), causing another requested attach. This is not a forced reconnect when transport still says `Connected`.
- Controller output gap, queue overflow, incarnation change, or lagged notification requests reattach (`TerminalSessionController.kt:69-74,139-145,182-198,413-432`). Screen callback requires current selected controller and active panel (`ProjectTerminalScreen.kt:517-540`). It cannot fire from messages that never arrive during a silent partition.
- Successful session refresh normally bumps attachment revision (`ProjectTerminalScreen.kt:634-636`). Shared inventory consumption explicitly uses `bumpAttachment=false` (`:706-710`); merely publishing a fresh inventory is not a universal reattach trigger.
- Profile/endpoint/generation change recreates root services. Navigation/remount may supply another attach opportunity; not a durable autonomous recovery contract.

**[INFERENCE] Failure after successful attach:** no attach error is generated merely by socket loss. Thus Retry banner may never appear; stale green dot and old replay-ready state survive until unrelated action or observation changes them.

## 4. Lifecycle/network recovery: hooks exist, wrong responsibility

Blanket “native has no lifecycle handling” would be incorrect.

- `AndroidLifecycleCoordinator.kt:24-34`: Activity `onStart`→shared foreground; `onStop`→background; `onResume` invokes supplied callback.
- `MainActivity.kt:69-74`: resume callback refreshes notification platform status, not socket health.
- `LifecycleCoordinator.kt:25-33,56-81`: shared lifecycle fanout intentionally separates background pause from owner retirement.
- `ProjectWorkspaceState.kt:154-184`: foreground/background forwarded to terminal state and file watching.
- `ProjectTerminalState.kt:125-145,178-204`: foreground/background updates input eligibility. No connect/probe, attach invalidation, or replay-gate reset.
- `NativeWorkspaceViewModel.kt:1114-1122`: background→foreground calls Agents `refreshAll(FOREGROUND)`.
- `RetainedTerminalAgentsCoordinator.kt:109-115`: refreshes inventory for `currentRuntimeKeys()` only.
- `TerminalAgentsInventoryCoordinator.kt:233-239`: excludes attachments without a socket. Known disconnected runtime therefore skipped; refresh never creates a new socket. Stale `Connected` runtime may issue HTTP inventory read, which does not prove original WS healthy.

Targeted Android/shared source search found **no `ConnectivityManager`, `NetworkCallback`, `registerNetworkCallback`, `registerDefaultNetworkCallback`, or connectivity broadcast recovery integration**.

**Conclusion:** current resume hooks restore demand/input/inventory, not WebSocket recovery. Need owner-scoped liveness reconciliation on foreground and network restoration, coordinated with one reconnect job. Network availability alone is not proof server/WS reachable.

## 5. Terminal green dot: process liveness mistaken for activity/connectivity

### Actual active screen

`MainActivity.kt:235-244`→`DamHopperMobileApp`→focused `ProjectWorkspaceScreen`; terminal panel mounts `ProjectTerminalScreen` (`ProjectWorkspaceScreen.kt:266-285`).

`TerminalScreens.kt` exposes `TerminalPanelScreen`, whose only located common-source consumer is `WorkbenchScreen.kt:1114`. `WorkbenchScreen` has no located production mounting caller; native README `:34` confirms separate shell dormant. Both renderers analyzed because both share defect; `ProjectTerminalScreen` is relevant to current app route.

### Exact color predicates

`ProjectTerminalScreen.kt:1944-1950` and `TerminalScreens.kt:318-324`:

```kotlin
when {
    !session.alive -> DamHopperColors.Error
    session.restartCount > 0u -> DamHopperColors.Warning
    else -> DamHopperColors.Success
}
```

Inputs absent: transport state, socket identity, last successful observation, controller exit flag, replay readiness, recent output timestamp, foreground process/command activity, agent working/idle state.

Consequences:

1. **Idle shell at prompt:** green is expected under implemented contract. Shell process still exists even if no child command executing and no output arriving.
2. **Exited PTY with refreshed `alive=false`:** red. Not literally hardcoded “always green.”
3. **Live restarted PTY:** warning indefinitely while `restartCount>0`; count records history, not current connection/recovery progress.
4. **Previously live PTY, now unknown/offline:** remains green if metadata stays `alive=true` and restart count zero.

### Server meaning of `alive`

- `TerminalModels.kt:43-68`: detailed DTO includes `alive` (default true), exit code, restart count, buffer bytes; no command-busy or transport-health field. Default true is not needed to explain an ordinary idle shell and is not evidence server omitted the field.
- `server/src/pty/session.rs:144-168`: newly created session metadata sets `alive=true`.
- `server/src/pty/session.rs:371-389`: naturally exited process tombstone sets `alive=false`, exit code, exit time.
- `server/src/pty/manager.rs:2414-2422`: `is_alive` checks server live-session membership; list includes live metadata and dead tombstones.

No relationship between waiting at prompt and PTY exit. “Nothing running” as “no foreground command” differs from “PTY/shell process terminated.” A busy/activity indicator needs actual activity semantics; simply negating `alive` would be wrong.

## 6. Why disconnect does not clear green or ready

### There IS indirect socket observation — terminal fails to consume its negative result

1. `ProjectTerminalScreen.kt:195-215` remembers session list by repository and profile/generation/project key. Same connection object dropping does not change these keys.
2. Session list set after accepted inventory/REST refresh (`:548-588`); intentionally preserved when inventory unavailable (`:560-575`). No disconnect branch marks metadata stale.
3. `NativeWorkspaceViewModel.kt:582-591` **does** observe WS state. Non-Connected maps socket to null and calls inventory `onSocketState`.
4. `TerminalAgentsInventoryCoordinator.kt:291-299,368-377` changes socket, invalidates receipt, marks unavailable, and does not fetch while socket null. `dropReceiptLocked():457-462` removes published inventory receipt.
5. Screen receives inventory map change (`ProjectTerminalScreen.kt:704-707`), computes `currentReceipt=null`, then **returns immediately** from effect. Does not clear/update `sessions`, fence controllers, or advance attachment revision.
6. `TerminalSessionTabs` continues rendering old `session.alive`. Missing receipt/freshness never enters color function.

Thus statement “no layer observes disconnect” would be false. Correct defect: **connection loss is not propagated into active terminal presentation/readiness**. Agents roster has a distinct unavailable model; Files also reacts correctly within its own domain (`FileTreeState.kt:171-183`; `FileWatchCoordinator.kt:137-162` clears write readiness/subscriptions). Those reactions do not reset terminal controller replay gates.

### Replay completed is not connection ready

- `TerminalSessionController.kt:33-34`: `isReplayCompleted = gate.hasAttachBufferBeenReceived && gate.isLiveStreamReady`.
- `TerminalReplayGate.kt:109-123`: new attach resets buffer/live readiness; failed attach fences live readiness.
- `TerminalSessionController.kt:85-95`: `beginAttach` / `failAttach` expose these transitions.
- No controller disconnect-state subscription/reset method. `ProjectTerminalState` foreground/authority policy only gates input; does not reset replay completion (`:125-152,199-204`).
- `TerminalScreens.kt:550-551`: **READY/green** versus **REPLAYING/warning** based solely on `isReplayCompleted`.
- Active screen `ProjectTerminalScreen.kt:1470-1475` uses same flag for “Terminal connected. Interactive session ready.” when buffer empty. That string asserts connectivity without transport evidence.
- Screen disposal (`:774-802`) keyed to composition/repository/connection key, not WS state. Retained-state disposal detaches widgets, preserving controllers by design.

**[INFERENCE] Completed replay before loss:** absent another attach/reset, replay flags stay true after recognized or unrecognized drop. Header/empty-buffer copy can remain “ready/connected.” Redrawing does not help; even a fresh recomposition reads same stale predicates.

### Input consequence — not automatic command replay

`ProjectTerminalScreen.kt:379-425` checks epoch, session, incarnation, panel/foreground policy and replay gate, then sends. No explicit transport availability/freshness check in those eligibility predicates. Detected disconnect normally leaves no writer and send fails; banner/history can report uncertain delivery. Half-open send may be locally queued without proof remote PTY accepted bytes. Do not treat send enqueue success as round-trip readiness or automatically resend uncertain keystrokes/commands after recovery.

## 7. Desktop/web comparison: native lacks lifecycle owner

`packages/ui/src/api/connections.ts`:

| Capability | Desktop/web evidence | Active Android counterpart |
| --- | --- | --- |
| Drop callback wired | `:547-555`: `WsTransport(onDrop -> handleDrop)` | Reader handlers publish state, no recovery consumer |
| Teardown/fencing | `:281-298`: validate generation, invalidate old owner, advance generation, destroy transport/API | Socket identity guards and receipt revocation exist; registry generation independent of drop |
| Automatic transient retry | `:329-340`: with intent, publish offline/reconnecting and schedule | No scheduler |
| Exponential backoff | `:125-126,261-278`: 1s,2s,4s,8s,16s,30s cap; one pending timer; intent/tombstone checks | Attach queue one requested attempt; no timer/backoff |
| Failed initial attempt | `:532-538`: offline + schedule | Handshake failure sets Error and returns |
| Reset after success | `:588-608`: backoff reset to 1s | No retry state to reset |
| Auth-required stop | `:300-327`: MFA/login stop generic loop | Typed states exist, but no recovery coordinator applying policy |
| WS connect deadline | `:569-577`: 10s WS-connect stage timer | No analogous explicit whole-attempt timer in WsConnection |

Desktop/web is a recovery-policy reference, not proof its half-open detection or background behavior is flawless. Do not add an independent retry loop per screen; central owner should coordinate attempts and restoration.

## 8. Causal reconstruction, priorities, and validation recommendations

### Logical failure timeline — inferred, not measured incident timestamps

| Stage | Source-established behavior / conditional consequence |
| --- | --- |
| T0 connect/attach | WS connected; metadata alive=true; accepted replay makes controller ready |
| T1 path interrupted | **[INFERENCE]** silent network partition or explicit close; actual trigger unknown |
| T2a silent case | No client round-trip deadline; state may remain Connected; repeated `connect()` returns immediately |
| T2b recognized case | Reader closes/fails; socket/receipt/writer removed; typed disconnected/error state published |
| T3 recovery gap | No drop-triggered reconnect timer; profile/generation keys unchanged; foreground inventory refresh not a reconnect |
| T4 presentation gap | Inventory receipt withdrawn but screen returns on null; last-known alive and replay-ready survive; green/ready can persist |
| T5 incidental recovery | User retry/session switch/remount/generation change can request attach/connect; no guaranteed automatic restoration |

### Prioritized remediation — recommendations only

**P1 — Own connection recovery centrally.**

- Locate owner alongside retained profile/runtime services, not per terminal composable. Single reconnect attempt/job per authorized runtime, tied to current profile/generation/socket intent.
- React to detected transient drops and failed initial connect; bounded exponential backoff with jitter, cancel on explicit disconnect/logout/retirement/owner change.
- Classify auth closures: pause for MFA/full login; handle auth-backend-unavailable and overflow using explicit transient/resync policy. Do not blindly reconnect every typed state or bypass authentication.
- On success restore relevant subscriptions and terminal attach from accepted offset/incarnation. Reset replay/input readiness on socket loss and keep fenced until new current-socket baseline/drain accepted. Must also work while Files/Editor selected, not depend on terminal remount.

**P1 — Wire real client heartbeat and reconciliation.**

- Consolidate effective Android engine configuration; apply engine-native ping interval on the actual construction path. Existing dormant 15s value is a candidate, not a device-qualified universal requirement.
- Preserve redirect/security settings. Ktor plugin ping alone insufficient on OkHttp. Do not use terminal input/output as health probes.
- Foreground/network restoration should reconcile/probe or replace stale transport, not just fetch inventory over separate HTTP. Coordinate with retry owner; avoid concurrent loops and rapid reconnect storms.
- Bound relevant connect stages and make cancellation/teardown owner-safe. No guaranteed deadline while Android suspends execution/network; promptly re-evaluate on resume.

**P1 — Correct terminal status contract.**

- Transport unavailable/reconnecting/auth-blocked overrides “connected/ready.” Preserve local output/drafts and last-known process metadata, label freshness unknown/stale; do not kill/remove PTYs or pretend process exited.
- Separate PTY alive/exited from command working/idle. If dot remains process-liveness-only, label it so users cannot mistake green for activity or connection health. For genuine activity, use authoritative busy/idle observations; recent output alone not reliable command completion.
- Derive READY from current transport/socket + successful current attach/replay; distinct OFFLINE/CONNECTING/REPLAYING/READY presentation. Apply to active renderer and duplicate dormant renderer if retained.

**P2 — Improve targeted diagnostic evidence.**

- Extend existing `connecting`, `status:connected`, `status:disconnected`, `ws.error`, attach/replay diagnostics with owner/socket, monotonic timings, retry reason/attempt/next delay, foreground/network transition, and liveness timeout category.
- Log reconnect and restoration boundaries, not terminal content, bearer token, handshake query token, or connection capability. Existing diagnostics are source definitions, not captured incident evidence.
- Correlate phone events with server heartbeat-deadline/close logs. Distinguish detected disconnect, half-open suspicion, retry blocked by auth, and attachment still replaying.

### Recommended validation matrix — NOT EXECUTED

| Scenario | Required observable result after remediation |
| --- | --- |
| Silent packet blackhole, no FIN/RST | Foreground client reaches unavailable within configured heartbeat policy; no permanent green/READY; one bounded-backoff recovery sequence |
| Server closes socket / resets connection | Immediate typed state; transient reconnect without user action; old reader cannot close replacement |
| Initial WS handshake fails then service returns | Bounded single attempt; retry progression; successful eventual restoration without screen remount |
| Wi-Fi→cellular / network loss→restoration | Network signal prompts reconciliation, not false connected; no concurrent attempts |
| Background / Doze / foreground | No promise of uninterrupted background socket; resume revalidates stale state and restores subscriptions/input only after accepted replay |
| Drop while Files/Editor visible | Connection recovery independent of terminal composition; retained buffers intact; terminal correct on return |
| Live idle shell versus active command versus exited shell | Distinct intended semantics; idle shell not shown busy merely because alive; actual exit reflected by authoritative metadata |
| `4401`, `4403`, `1013`, `4001` | Correct login/MFA/transient/backpressure policy; no auth retry storm or security bypass |
| Loss after completed replay | Readiness revoked for prior socket; current-socket attach/replay required before READY and input |
| Delayed old-socket callback / profile switch / logout | Generation/socket fencing and cancellation reject stale work; no successor teardown or cross-owner subscription |
| Delivery uncertain before drop | No blind keystroke/command replay, no duplicate PTY creation; explicit uncertain outcome remains visible |
| Rapid reconnect/repeated foreground events | One recovery owner, no duplicate subscriptions/attach jobs; restored offset/incarnation reconciles without duplicated output |

Existing `WsConnectionTest.kt:59-122,180-261,263-303` covers correlator capacity/cancellation/fencing and explicit connect/disconnect admission. Read as definitions only. No claim these tests passed; no inspected test establishes Android keepalive, autonomous recovery, or stale active-terminal dot behavior. JVM tests use a different engine, so Android instrumentation/real-device network qualification needed.

## 9. Source index and external references

All local citations above relative to repository root. Short filenames map below; line numbers refer to inspected source snapshot.

| Short name | Full path |
| --- | --- |
| WsConnection.kt | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WsConnection.kt` |
| WsTypes.kt | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WsTypes.kt` |
| PlatformHttpEngine.kt | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/PlatformHttpEngine.kt` |
| PlatformHttpEngine.android.kt | `native/android-app/shared/src/androidMain/kotlin/dev/damhopper/nativeapp/core/transport/PlatformHttpEngine.android.kt` |
| AndroidHttpClientFactory.kt | `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/network/AndroidHttpClientFactory.kt` |
| TerminalRepository.kt | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalRepository.kt` |
| TerminalSessionController.kt | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalSessionController.kt` |
| TerminalAttachQueue.kt | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAttachQueue.kt` |
| TerminalReplayGate.kt / TerminalModels.kt / TerminalScreens.kt | Same `features/terminal/` directory as TerminalRepository |
| ProjectTerminalScreen.kt / ProjectTerminalState.kt / ProjectWorkspaceScreen.kt / DamHopperMobileApp.kt / WorkbenchScreen.kt | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/` |
| ProfileRepository.kt | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/profiles/ProfileRepository.kt` |
| ConnectionRegistry.kt | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/ownership/ConnectionRegistry.kt` |
| LifecycleCoordinator.kt | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/lifecycle/LifecycleCoordinator.kt` |
| ProjectWorkspaceState.kt | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt` |
| FileTreeState.kt / FileWatchCoordinator.kt | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/` |
| MainActivity.kt | `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt` |
| AndroidLifecycleCoordinator.kt | `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/lifecycle/AndroidLifecycleCoordinator.kt` |
| NativeWorkspaceViewModel.kt / TerminalAgentsInventoryCoordinator.kt / RetainedTerminalAgentsCoordinator.kt | `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/` |
| WsConnectionTest.kt | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/transport/WsConnectionTest.kt` |

External evidence:

1. [Ktor 3.1.0 OkHttp WebSocket adapter](https://github.com/ktorio/ktor/blob/3.1.0/ktor-client/ktor-client-okhttp/jvm/src/io/ktor/client/engine/okhttp/OkHttpWebsocketSession.kt): engine-owned interval, supported frame handling, listener/channel lifecycle.
2. [Ktor 3.1.0 dependency catalog](https://github.com/ktorio/ktor/blob/3.1.0/gradle/libs.versions.toml): upstream OkHttp 4.12.0 declaration.
3. [Published OkHttp 4.12.0 sources, Maven Central](https://repo.maven.apache.org/maven2/com/squareup/okhttp3/okhttp/4.12.0/okhttp-4.12.0-sources.jar): inspected `okhttp3/OkHttpClient.kt`, `okhttp3/internal/ws/RealWebSocket.kt`, `okhttp3/internal/ws/WebSocketReader.kt`; default zero ping, failure deadline, automatic Pong, idle read timeout behavior. GitHub contents discovery unexpectedly returned a fork URL; consequential claims independently cross-checked against this published artifact. Runtime-resolved app artifact not inspected.
4. [Current Ktor WebSockets client documentation](https://ktor.io/docs/client-websockets.html): general plugin/session API; current page newer than repository pin, so version-specific conclusions based on tagged source above.
5. [Android: Optimize for Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby): background CPU/network restrictions, maintenance windows, device test procedures.

## Unresolved questions

1. Which server build/version and network/proxy route were used during failure? Does deployed endpoint run current 30s/90s server heartbeat?
2. Was failure silent blackhole, explicit close, heartbeat timeout, TLS/handshake error, server restart, or auth closure? Need correlated redacted phone/server timestamps and close/error evidence.
3. Device model/API, battery policy, foreground/background/screen-off timing, Wi-Fi/cellular transition? NAT/proxy timeout or packet loss measured?
4. Which visible indicator/copy user saw: active project tab dot, empty-buffer “connected” copy, or separate Agents roster? Static active-tab defect established; UI screenshot would identify exact reported surface.
5. Desired product semantics for green: process alive, command active, connected transport, or fully interactive current attachment? Must choose/label distinct states rather than overload one Boolean.
6. What foreground detection/recovery latency and battery budget should govern heartbeat/retry policy? No measured service target or device qualification supplied.
