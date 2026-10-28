# Native connection stability and terminal indicator investigation

## Executive summary

**Scope:** read-only investigation of Tauri desktop host `apps/native/` and shared `@dam-hopper/ui`. No source/config/test fixes. Only this requested report created. Debugging, problem-solving/inversion, and docs-seeker skills read and applied.

**Evidence:** current source and existing test definitions; official WebSocket/Tauri documentation. No native application run, network capture, incident logs, build, lint, or tests executed. Existing test definitions are not passing-test evidence. Actual cause of the user's physical connection loss remains unconfirmed without runtime evidence; source-level recovery gaps and indicator semantics below are concrete.

### Principal findings

| Finding | Classification | Impact / priority |
| --- | --- | --- |
| Connection auth preflight has no application deadline or attempt-owned cancellation; single-flight promise blocks subsequent connect calls while preflight hangs | Confirmed code gap; indefinite incident stall is conditional, not reproduced | **P1**: recovery can remain `connecting` before WS timeout even exists |
| No application-level client WS heartbeat/deadline; no connection-registry wake/online/foreground reconciliation | Confirmed code gap; half-open/sleep incident mechanism **[INFERENCE]** | **P1**: stale `connected` snapshot can survive until webview detects failure |
| Tree green means PTY process alive, not command busy, output arriving, or network healthy | Confirmed exact semantic cause of green at an idle shell | **P1 UX/state semantics** |
| Modern tab/runtime green means nonempty output within three seconds, not process alive alone | Confirmed; permanent idle green not explained by this predicate | Must identify which indicator user saw |
| Recognized profile loss does clear activity for all mounted panels, including hidden keep-alive panels; disconnected aggregate sessions are excluded, and retained tabs can be marked `alive:false` | Confirmed; contradicts proposed blanket stale-state explanation | Do not implement an active-tab-only reset fix |
| Top-nav green means **any** configured profile connected, not active terminal's profile connected | Confirmed aggregation semantics | **P2**: one healthy peer masks another failed profile in aggregate color |
| Native missing `initTransport` and unused startup imports are real, but shared lazy idle transport and shared React bootstrap already cover those roles | Confirmed; not established root cause | Startup parity cleanup alone will not fix established-connection loss |
| Drop teardown leaves ambient singleton pointing to destroyed transport, unlike explicit disconnect | Confirmed lifecycle inconsistency; visible impact depends on ambient consumer | **P2**: stale ambient capability/status bindings |

**Recommended architecture:** one profile/generation-owned connection lifecycle, bounded/cancellable whole connect attempt, same-WS liveness check plus wake reconciliation, and terminal presentation deriving separately from connection freshness, process lifecycle, stream readiness, recent output. Never equate unavailable observation with confirmed PTY exit.

## 1. Startup: native versus web

### Actual sequence

- Native marks host/platform before mounting: `apps/native/src/main.tsx:33-56,96-102`; runs fresh-state reset and profile migration; mounts `DamHopperApp` at `:154-170`.
- Native imports `getProfiles`, `connectProfile`, and `isProfileSupportedOnNative` at `:13-19` but never calls them in this entrypoint. Native does not call `initTransport`.
- Web explicitly installs shared `IdleTransport` at `apps/web/src/main.tsx:30-37`, optionally reconciles managed runtime config at `:39-42`, then mounts the **same** `DamHopperApp` at `:55-59`. Its `getProfiles` / `connectProfile` imports are also unused in the entrypoint.
- `packages/ui/src/api/transport.ts:136-140` lazily creates shared `IdleTransport` when the singleton is absent. Missing native `initTransport` therefore does **not** mean missing usable fallback or an automatic exception before render.
- Both hosts use shared startup effect: `packages/ui/src/embed/dam-hopper-app.tsx:305-353`. It reads saved profiles, skips `autoConnect === false` at `:313`, optionally logs in no-auth profiles at `:315-340`, then calls `connectProfile(profile.id)` at `:343`.
- Shared registry enforces host support itself at `packages/ui/src/api/connections.ts:406-435`, using `server-config.ts:762-788`: browser and native Windows allow remote profiles; other native hosts require exact same origin. The unused native helper duplicates that policy (`apps/native/src/native-server-url.ts:11-22`).
- `apps/native/src/idle-transport.ts:7-39` is not used by native main. Shared fallback is `packages/ui/src/api/idle-transport.ts:9-21,49-51`; it reports disconnected, not connected. Native-local idle would report `idle`, but it is not the active startup fallback.

**Conclusion:** native entrypoint omissions are bootstrap inconsistency/dead imports, not proof of absent startup connection, and cannot by themselves explain a socket dropping after it was established. Adding another startup connect loop would duplicate shared bootstrap and risk extra auth work.

### Real startup edges

1. Shared no-auth bootstrap performs login **before** registry URL/platform support gate. Unsupported non-Windows profiles can therefore still cause a login request (`dam-hopper-app.tsx:315-319` versus `connections.ts:412-423`). This contradicts native helper comment “produce no fallback traffic.”
2. No-auth login is awaited serially per profile. The 10-second abort timer is cleared after response headers (`dam-hopper-app.tsx:317-325`), before `res.json()` at `:327`. A stalled response body has no remaining app timer and can delay later profiles indefinitely. Fetch rejection leaves timer to fire later; it is not a durable retry timer wedge.
3. Authenticated/basic profile without stored token stops at `login-required` (`connections.ts:457-464`); `autoConnect:false` is intentionally not startup-connected. Neither means unstable transport.
4. No-app-deadline auth-status preflight affects startup **and every retry**, detailed next.

## 2. Connection lifecycle and retry ownership

### Established connection → recognized drop → retry

```text
WsTransport onclose / onerror
  -> transport status disconnected / error
  -> registry onDrop(profileId, capturedGeneration)
  -> handleDrop: settle attempt, unsubscribe bridge, invalidate owner
  -> increment generation; destroy WS/resources; clear transport + API
  -> auth close: stop for login/MFA
  -> ordinary close with intent=true: offline + schedule reconnect
  -> timer fires: clear handle, call connectProfile
  -> auth preflight -> new WsTransport -> connected -> reset backoff
```

**Exact evidence:**

- `WsTransport` starts a browser/webview `WebSocket`, not a Rust IPC backend connection: `packages/ui/src/api/ws-transport.ts:2320-2363`.
- Registry always supplies `onDrop`: `packages/ui/src/api/connections.ts:547-555`. Thus this normal profile path uses **registry retries**, not transport-local retries.
- Close rejects pending WS operations, clears socket receipt, emits disconnected, forwards close code/reason: `ws-transport.ts:2890-2928`.
- Error emits error, clears receipt, tries close, calls `onDrop` without close classification: `ws-transport.ts:2932-2954`. If error arrives first and registry destroys transport, later old close callback is ignored by the `closed` guard. Handshake auth rejection may therefore enter ordinary retry first; auth preflight on next attempt must determine login/MFA.
- Drop ignores stale generations/tombstones, settles connect, invalidates generation, destroys transport: `connections.ts:281-298`. Old socket callbacks cannot validly drop the replacement generation.
- `4403` / `MFA_REQUIRED` → `mfa-required`, no generic reconnect; `4401` / `AUTH_REQUIRED` → clear token, `login-required`, no generic reconnect: `connections.ts:300-327`.
- Ordinary loss with `intent:true` → offline and schedule: `connections.ts:329-340`. Manual disconnect clears intent and timer: `:621-649`. Missing profile / unsupported URL / incompatible workbench protocol return rather than retry: `:393-435,498-505`.

### Backoff and timer-wedge question

`connections.ts:125-126,261-278`:

- Delays: **1s, 2s, 4s, 8s, 16s, 30s, 30s…**; no jitter; no generic retry-count cap.
- Only one scheduled reconnect per entry; refuses absent entry, false intent, existing timer, removed profile.
- Timer callback sets `entry.reconnectTimer = null` **before** calling `connectProfile` (`:273-276`). A fired timer retaining a non-null handle is **not** supported by current code.
- Explicit connect/disconnect clears timer (`:438-439,634`); successful WS open resets backoff to 1s (`:588-600,606-617`).
- Briefly successful WS opens always reset backoff. **[INFERENCE]** a server/proxy that repeatedly accepts then quickly closes can produce a sustained approximately 1-second reconnect cadence instead of reaching 30s. It is not two simultaneous retry loops.
- Webview suspension can postpone timer callbacks; no maximum wake recovery latency is enforced.

Transport-local fallback (`ws-transport.ts:2915-2928,2958-2970`) is used only when no `onDrop` supplied. It clears its handle before reconnect too. That fallback's backoff is not reset in `onopen` (`:2351-2363`), unlike registry backoff. Do not confuse the two implementations. Alternate `reinitializeTransport` can construct unmanaged `WsTransport` (`packages/ui/src/api/transport-utils.ts:20-50`), but searched current UI/native callers only found its test import; no production caller established for this incident.

### Confirmed recovery gap: unbounded auth preflight

Source chain:

1. `connectProfile` returns current in-flight promise at `connections.ts:380-381`; only `.finally` removes it at `:383-389`.
2. `performConnectProfile` sets state `connecting` and `intent:true` at `:448-455`.
3. It awaits `checkAuthStatus(cleanUrl, token)` at `:467`, **without signal or timeout**.
4. `checkAuthStatus` accepts optional signal but creates no timeout/controller: `packages/ui/src/api/auth-client.ts:420-449`. It awaits both fetch and response JSON.
5. WS's 10-second connect timer is created **later**, only after preflight, transport, and API creation: `connections.ts:547-577`.

**Exact failure condition:** preflight fetch or body remains pending. Then no WS exists, WS timer is absent, no fetch catch schedules another retry, and further `connectProfile` calls return same pending promise. This is an application-unbounded wait; actual eventual browser/network timeout is environment-dependent. `reconnectTimer` may correctly be null while recovery is effectively wedged in `inFlightConnects`.

Disconnect clears registry single-flight and generation-fences stale completion (`connections.ts:629-634`), but does not abort that preflight fetch; no attempt-owned controller is stored. Explicit disconnect followed by reconnect may escape deduplication while orphaned old network work remains. Do not present repeated clicks as the permanent fix.

## 3. Why connections may drop / remain falsely connected

### Heartbeats: server exists, client supervisor absent

- Server ping interval **30 seconds**, liveness deadline **90 seconds**: `server/src/idle_suspend/client_presence.rs:28-32`.
- Dedicated WS reader handles control frames independently of long application operations; Pong, Ping, text, binary refresh presence: `server/src/api/ws.rs:387-449`.
- Server supervisor checks deadline and enqueues Ping; timeout closes/cancels server connection: `server/src/api/ws.rs:454-490`. The 5-second timeout at `:478-480` bounds queue enqueue, not all underlying socket writes.
- Client transport has no application ping/pong message, last-receive deadline, or active half-open watchdog. Status becomes connected on WS `onopen` (`ws-transport.ts:2351-2363`) and changes via browser callbacks / auth drop, not periodic liveness validation. Ordinary REST timeout/network exceptions do not call generic `handleDrop`; only specified auth errors do (`:3011-3018,3047-3099`).
- WebSocket control Ping/Pong is **not exposed to JavaScript**; browser engine handles it. Missing JS `ping()` is not itself failure to answer server pings. Official reference: [WHATWG WebSockets, Ping and Pong frames](https://websockets.spec.whatwg.org/#ping-and-pong-frames).

**[INFERENCE] half-open scenario:** network path disappears without delivered Close/error. Registry remains connected; no reconnect timer scheduled; cached sessions may still say alive; tree stays green. Server can declare its side dead at a heartbeat check, but that does not guarantee a close packet reaches client. Client recovery waits for webview/OS failure detection unless another lifecycle action intervenes. “90 seconds” is not a guaranteed client recovery SLA.

### Blur, minimize, sleep/wake, interface change

- No intentional main backend disconnect on plain blur found in native bootstrap or registry/WS transport.
- Native Rust main-window handler handles CloseRequested/Destroyed only (`apps/native/src-tauri/src/lib.rs:171-183`); run handler handles exit (`:190-211`). No bridge to connection registry on foreground/resume/network restoration.
- No `online`/`offline`/focus/visibility wake reconciliation installed by `connections.ts` or `ws-transport.ts`. Existing resource SSE visibility/page listeners (`packages/ui/src/api/host-resource-stream-coordinator.ts:327-337`) manage resource streaming, not backend WS recovery. Editor/notification focus listeners likewise do not restore profile WS liveness.
- **[INFERENCE]** sleep pauses JavaScript timers; server heartbeat may retire session; wake can encounter queued close, stale half-open connection, or delayed reconnect. Network-interface changes need browser failure notification before registry retry begins. None of these events is proven to cause the reported incident without webview/OS logs.
- Native main window has no background-throttling override (`apps/native/src-tauri/tauri.conf.json:12-23`). Official [Tauri backgroundThrottling configuration](https://v2.tauri.app/reference/config/#backgroundthrottling) documents background task throttling and says the override is **unsupported on Windows/Linux/Android**. Do not propose setting `backgroundThrottling:disabled` as a universal or verified Windows fix. Actual installed engine behavior requires device evidence.

### Confirmed server-side close triggers; incident trigger not yet attributable

| Trigger | Source / observable signature | Retry effect |
| --- | --- | --- |
| Heartbeat deadline | `server/src/api/ws.rs:468-475`; warning “no pong in 90s” | Ordinary reconnect after client notices |
| Incoming application queue saturation, capacity 64 | `ws.rs:390,430-438`; overflow warning; close `4001` at `:334-340`, constant at `:49` | Ordinary reconnect |
| MFA due / session expired / revoked / user modified | `ws.rs:529-601`; codes `4403`, `4401` (`:50-51`) | Intentional user-auth gate; no generic retries |
| Auth DB error or >2s verification timeout, checked every 5s | `ws.rs:529,555-618`; close `1013`, auth warning (`:52`) | Ordinary reconnect; can flap if infrastructure remains unhealthy |
| Socket read/send failure | `ws.rs:402-414,379-384` | Ordinary reconnect after client notices |
| Browser-origin authorization failure during upgrade | `ws.rs:148-158,262-273`; HTTP 403 “Origin not allowed” | Browser error/abnormal close; can retry indefinitely if REST succeeds but upgrade stays blocked |

Native uses webview fetch/WebSocket, so backend CORS/origin allowlist, TLS, proxies, and remote host routing still matter. Native CSP permits HTTP(S)/WS(S) connections (`tauri.conf.json:25`); that permission does not bypass server origin checks. No incident evidence establishes any of these as the actual trigger.

### Native SSH forwarding is a different transport

Tauri Rust hosts native browser-debug and Windows SSH-forwarding commands (`lib.rs:81-149`); it does not own the UI's backend WebSocket. SSH uses separate Rust keepalive configuration, 30 seconds / max 2 (`apps/native/src-tauri/src/ssh_forward/ssh_client.rs:41-48,261-264`), and its v2 retry loop is bounded by policy with 1,2,4,8,16-second capped delays (`ssh_forward/manager.rs:4900-4925`). Those features cannot be credited as UI WS heartbeat/retry. If backend URL traverses a native SSH forward, both lifecycles must be correlated; such topology is not established here.

## 4. Terminal green indicators: distinct signals, distinct meanings

### 4.1 Tree lifecycle dot: exact reason idle shell remains green

`packages/ui/src/components/organisms/TerminalTreeView.tsx:82-90` computes:

```text
StatusDot(session)
  -> getSessionStatus(session)
  -> session.alive ? "alive" : restarting/crashed/exited
  -> bg-green-500 for alive
```

Exact predicate `packages/ui/src/lib/session-status.ts:22-32`; color `:38-47`; optional alive glow helper `:54-59`. Applied to command row at `TerminalTreeView.tsx:195`, session rows at `:370,461`.

Server initializes PTY session metadata `alive:true` (`server/src/pty/session.rs:153-168`), marks false on process exit (`:371-381`). An idle interactive shell is still a running process. No foreground command, recent output, connection status, or heartbeat freshness enters `getSessionStatus`.

**Confirmed semantic root cause:** “nothing running in terminal” as “shell idle at prompt” is not the metric rendered by this tree dot. Green is expected under current implementation; misleading if users interpret green as command busy or online. Do not infer busy solely from `alive` or output volume.

### 4.2 Modern tabs and runtime navigator: activity dot, not tree dot

Callsites:

- `TerminalTabBar.tsx:105-110` and `TabBar.tsx:103-108`: pass session alive and explicit owner/ref.
- `TerminalRuntimeNavigatorItem.tsx:183-188`: passes runtime alive/ref. Runtime projection takes alive from tab metadata (`packages/ui/src/lib/terminal-runtime-tree.ts:239-267`).
- All render `TerminalActivityIndicator`, whose state mapping is `packages/ui/src/components/atoms/TerminalActivityIndicator.tsx:16-35,118-126`.

Predicate `packages/ui/src/lib/terminal-output-activity.ts:15-21`:

| State | Presentation | Actual meaning |
| --- | --- | --- |
| `alive === false` | stopped / danger | Process metadata says stopped; takes precedence |
| `streamReady === false` | unavailable / muted | No usable observed stream |
| ready + recent output | receiving / green | Output observed recently |
| ready + no recent output | quiet / warning-orange | Stream ready, quiet |

Recent-output window is **3,000 ms** (`terminal-output-activity.ts:3`); timer expiry clears recentOutput (`:94-117`), readiness false clears both activity/timer (`:130-148`). Merely leaving streamReady true does **not** keep this dot green indefinitely: expiry makes it quiet/orange.

Nonempty accepted live bytes mark activity (`TerminalPanel.tsx:511-514`); replay sets readiness only after replay drain (`:612-638`). Terminal escape/control sequences count as nonempty output too: no foreground command can still produce green if prompt redraws or background output arrive at least every three seconds. Replay history alone is not explicitly marked as live output; queued live data drained after replay can be.

**[INFERENCE]** throttled/frozen event loop can delay three-second expiry; renderer/color persistence under suspension is not proof recent output is really flowing. No report evidence identifies control traffic or delayed timer as the user's actual cause.

### 4.3 Recognized connection loss resets background terminals too

The proposed “only active TerminalPanel resets streamReady” is contradicted by current code:

1. `TerminalKeepAliveHost.tsx:59-98` mounts a `TerminalPanel` for **each** mounted session in hidden parking host (`:43-57`). Hidden is not unmounted or disconnected from subscriptions.
2. Each panel binds its explicit profile/generation (`TerminalPanel.tsx:405-442`) and subscribes registry changes unconditionally (`:1095-1116`). No active-tab check.
3. When snapshot ceases to be connected, `nextOwner` becomes null; previous connection cleanup runs (`:1099-1111`). Cleanup calls `outputActivity.dispose()` (`:1062-1082`), which clears streamReady and recentOutput (`terminal-output-activity.ts:141-149`).
4. Additionally transport status other than connected resets activity directly (`TerminalPanel.tsx:1019-1029`, helper `:453-458`).
5. New attach starts unavailable (`TerminalPanel.tsx:944-951`), only replay/current generation reopens readiness (`:624-632`). Stale callbacks check ownership.

**Conclusion:** active and inactive **profile-bound** panels are covered after a recognized drop. No global reset-only patch justified. If backend is half-open and registry never transitions offline, neither cleanup route fires; then streamReady can remain true, but recent-output expiration should still make modern dots orange.

### 4.4 Session caches: retained data exists, but normal offline rendering does not simply preserve green

- `handleDrop` does not itself rewrite all SessionInfo objects or purge all terminal query data (`connections.ts:281-340`). Cached metadata and tab/PTY surfaces may remain in memory; network loss does not prove server PTY died.
- However aggregate hook subscribes registry status/generation (`use-aggregated-terminal-sessions.ts:42-52`) and selects disconnected query key instead of prior connected-generation key (`:54-82`). That disconnected query is disabled; no prior connected result is explicitly supplied as placeholder. Aggregation collects only current query result data (`:103-107`). Under the configured clients/current hook, a normal recognized drop excludes that profile's old connected data from current session list rather than intentionally showing it alive forever.
- `useTerminalTree` derives tree sessions from that aggregate, qualifying IDs (`use-terminal-tree.ts:150-176,217-241`); tree has no independent connection-aware status, but source data normally loses the disconnected session.
- `buildTerminalDisplayTabs` can fall back to `tab.session` when session map lacks entry (`use-terminal-manager.ts:435-448`). This is a stale metadata boundary, but not the whole story.
- Manager invokes `deriveTerminalAutoAttachState` whenever session list changes (`use-terminal-manager.ts:785-835`); missing session is explicitly rewritten to `alive:false` (`terminal-auto-attach.ts:172-180`), and tab equality checks alive (`use-terminal-manager.ts:397-411`), so change is retained. Mounted terminal surfaces remain preserved (`terminal-auto-attach.ts:228-245`).

**Important correction:** blanket claim “connection loss never marks client session state dead/offline, therefore green always persists” is not accurate for present implementation. There is instead a second semantic problem: offline/missing observation can be represented as stopped `alive:false` in retained tabs even though remote shell may still run. Proposed remediation should add availability/unknown rather than rely on this false-dead inference.

### 4.5 Project dot: green for any receiving tab, orange for everything else

`TraditionalTerminalProjectsNavigator.tsx:204` renders shared `TerminalProjectActivityIndicator`. It is **implemented in** `components/atoms/TerminalActivityIndicator.tsx:44-93`, not defined locally in navigator.

- `tabs.some(status === "receiving")` at `:60-75` → green + `status-glow-green` (`:83-86`).
- Every other aggregate (quiet, unavailable, stopped, no tabs) → orange + `status-glow-orange`. No separate offline/unknown/dead aggregate presentation.
- A single noisy background terminal can keep project green; selected terminal being idle does not force orange.
- Latent identity hazard: subscribes to `tab.sessionId` at `:49-53`, but reads `terminalRef` / `{profileId,id}` at `:65-70`. If sessionId is raw and profile/ref explicit, keys differ (`ownership.ts:126-128,173-187`); changes/expiry may not notify project subscriber. **Not a demonstrated normal-flow bug:** normal manager/tree uses already-qualified JSON sessionId (`use-terminal-tree.ts:154-157`, `terminal-auto-attach.ts:102-110`), and grouping preserves tab objects (`traditional-terminal-projects.ts:35-64`), so matching qualified keys can work. Unify target derivation and test both input shapes; do not claim every project dot currently misses resets.

### 4.6 Top navigation connection dot: aggregate connectivity, not terminal activity

`ConnectionDot.tsx:15-19,29-33`: connected → green glow/“online”; connecting → yellow pulse; disconnected → muted; error → red. Component simply maps passed state.

`TopNavConnectionButton.tsx:43-65` counts **all profiles**:

- No profiles → disconnected.
- At least one connected profile → connected/green, even if active profile offline or another connecting.
- No connected but any connecting → connecting.
- Otherwise → disconnected; login/MFA/offline/unsupported all collapse here.

**Fallback correction:** `fallbackStatus` initializes variable at `:56`, but exhaustive `if/else` overwrites it at `:57-65`. A passed fallback `connected` cannot by itself make this button green in current code. Green requires at least one profile snapshot actually connected. One half-open/stale-connected profile or a genuinely healthy peer is sufficient; zero running terminals has no relationship to this dot.

## 5. Drop versus explicit disconnect: ambient lifecycle inconsistency

Registry connection is copied into ambient transport on open (`connections.ts:596-599,612-615`). Explicit disconnect detects ownership and swaps to shared IdleTransport (`:625-644`). `handleDrop` destroys entry transport and nulls it but does not swap ambient singleton (`:291-298`). `WsTransport.destroy()` closes/nulls socket and clears status listeners, but does not set/publish disconnected status itself (`ws-transport.ts:2286-2317`).

Consequences, scoped:

- After WS close/error, an earlier disconnected/error notification normally exists. After REST/SSE-auth-triggered drop, destroyed transport can still report its old connected internal status.
- Ambient singleton/getTransportGeneration does not change merely from drop; some ambient consumers can retain destroyed transport/listeners until reconnection/profile switch.
- Profile-bound terminals are protected by registry subscription and owner fencing; this is **not** proof hidden profile terminals remain live-ready.
- TopNav uses registry counts, not this ambient fallback, so this inconsistency is not its direct permanent-green explanation.

## 6. Causal timelines and discriminating evidence

No wall-clock incident timeline supplied. The following are source-derived conditional sequences, not observed reproductions.

### A. Half-open network loss

`t0` socket open / registry connected → `t1` network silently blackholes → no close/error → no handleDrop/retry → tree's last alive observation green; aggregate nav connected → server eventually retires its side → client remains stale until engine detects failure or a user lifecycle action changes owner.

Discriminator: no frontend disconnected/error event despite failed I/O; server heartbeat warning may precede client transition. Modern receiving indicator should expire orange unless output/timer subscription behavior intervenes.

### B. Recognized drop followed by preflight hang

`t0` client close/error → registry offline/generation advance; all profile panels unavailable → timer delay → state connecting → `/api/auth/status` stays pending → no WS created; subsequent connect requests reuse pending promise.

Discriminator: offline then connecting with pending auth request and no new WS; not a retained reconnectTimer handle.

### C. Repeated server close after successful open

WS open resets retry to 1s → server auth DB/backpressure/proxy closes → reconnect → next open resets again. Discriminator: repeated open/close pairs and server codes/reasons; distinguish auth user gates from network retries.

### D. Green mistaken for busy / active-profile health

Shell still alive → tree green at prompt; or profile B connected while selected profile A offline → aggregate nav green; or another background terminal continuously outputs → project green. Discriminator: indicator location/title, per-profile snapshot, stream activity timestamps.

## 7. Concrete remediation options — proposals only

### P1: bound and own whole connection attempt

- ConnectionEntry owns attempt AbortController + total deadline covering auth status fetch **and body**, WS open, cancellation, and teardown. Pass signal through existing `checkAuthStatus` API.
- On timeout, settle/remove single-flight deterministically; advance/fence owner as needed; schedule one retry if intent remains true. Disconnect/removal aborts preflight rather than only forgetting promise. Fence completion **and finalization** by attempt identity: an old finally must not delete a newer in-flight promise or clear its controller/timer after disconnect/reconnect.
- Preserve auth-required / MFA-required / unsupported gates; do not bypass authentication or auto-retry user-action states.
- Keep registry as sole normal-profile retry owner. Add jitter and consider resetting backoff only after stable connection, not momentary open, if flapping is confirmed.

### P1: explicit end-to-end liveness plus lifecycle reconciliation

- Add application-level request/response heartbeat on the **same WS**, with monotonic attempt/socket identity and finite deadline; browser JS cannot send/control native Ping frames. Server control heartbeat remains useful independently.
- A successful unrelated REST request must not certify WS push/input path. If choosing REST probe instead, model REST reachability separately from WS health.
- On online/pageshow/visible/focus and native resume, check elapsed liveness; if stale, initiate one bounded fresh probe or controlled socket replacement through existing single-flight gate. These events are hints, not proof of connectivity. Preserve manual-disconnect intent and auth gates.
- Timers cannot run during sleep: reconcile elapsed deadline once on resume, never replay a backlog of missed heartbeat failures. Avoid reconnect-on-every-blur and concurrent retry storms. Do not claim background-throttling config guarantees Windows continuity.

### P1/P2: one terminal status model with separate axes

Prefer derived model keyed by TerminalRef plus current owner generation:

```text
connection: connected-fresh | reconnecting | offline | auth-blocked | unknown
process: alive | restarting | exited | crashed | unknown
stream: attaching | ready | unavailable
activity: recent-output | quiet
```

- Connection unavailable/auth-blocked takes precedence for **connectivity** rendering while preserving last-known process truth. Do not convert network absence into actual process exit.
- Tree lifecycle dot either clearly labeled “shell/process alive” or adopts common output/connection presentation; command-busy state requires verified shell/agent lifecycle, not `alive`.
- Tab/runtime/project use same canonical TerminalRef subscription target. Project aggregate should distinguish offline/unknown from quiet; any-output aggregation should be explicit in tooltip.
- Top nav shows active-profile health separately from fleet `N/M connected`, with partial-failure styling. Remove unreachable fallback as cleanup only if code changes later authorized.
- Expire recent output using elapsed time on resume, not only a delayed timer callback. Preserve current all-panel cleanup/owner fencing.

### P2: canonical ambient lifecycle

- On current ambient owner's drop, replace ambient transport with idle/unavailable and notify generation consumers, just as explicit disconnect does; ensure generation fencing precedes consumer rebinding. Require exact current-transport identity/current owner match: a delayed drop from A must never replace B's newly active transport.
- Avoid raw, independently reconnecting transport creation for profiles. Consolidate/remove unused lifecycle utilities only in an authorized implementation; do not install a second native transport stack.

### P3: bootstrap consistency, not a connection-loss fix

- Shared initialization helper used by both hosts; explicit idle init if desired for deterministic generation notification.
- Gate native profile support before no-auth login. Bound full login response, clear timers in finally, prevent one profile's stalled login from blocking all later profiles.
- Remove dead native helper/imports only when ownership consolidated. No duplicate startup connect loop.

## 8. Validation handoff — not executed

Existing relevant definitions inspected: `packages/ui/src/api/connections.test.ts`, `components/organisms/TerminalPanel.test.tsx:289-381`, `lib/terminal-output-activity.test.ts:12-38,117-151,184-239`. Panel test already models owner A offline while B stays live; not evidence tests were run, nor full hidden-host status coverage.

Main agent, after any separately authorized fix, should run scoped UI Vitest suites via package's `test: vitest run` script (`packages/ui/package.json:6-10`). Suggested initial command:

```sh
pnpm --filter @dam-hopper/ui test src/api/connections.test.ts src/api/connections-mfa.test.tsx src/api/ws-transport.test.ts src/lib/terminal-output-activity.test.ts src/lib/session-status.test.ts src/lib/terminal-auto-attach.test.ts src/components/organisms/TerminalPanel.test.tsx src/components/organisms/TerminalKeepAliveHost.test.tsx src/components/organisms/TerminalTabBar.test.tsx src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx
```

Required behavioral cases beyond checking existing definitions:

| Case | Acceptance |
| --- | --- |
| Auth fetch never resolves; headers arrive but JSON body stalls | Finite attempt timeout; in-flight clears; exactly one next retry; disconnect aborts |
| Old attempt resolves/finalizes after disconnect then replacement attempt starts | Old completion and finally cannot alter newer single-flight, timer, controller, snapshot, or ambient transport |
| Repeated offline retries / close+error race | Single retry owner; correct 1→30s policy; stale owner cannot retire replacement |
| MFA 4403 / auth 4401 / unavailable 1013 | Correct user gate versus transient retry; no credentials leaked |
| Active + multiple parked panels, profile A drops, B healthy | All A streams unavailable, stale callbacks fenced, B unaffected; retained xterms preserved |
| Quiet shell / continuous background output / >3s silence | Lifecycle and output semantics explicit; receiving expires, including delayed wake callbacks |
| Raw and qualified sessionId with explicit TerminalRef | Project/tab/runtime listeners subscribe to exactly snapshots they read |
| Profile A offline, B connected | Active versus fleet status distinguishable; fallback cannot mask zero-connected state |
| Backend path blackholed without Close; sleep/wake; Wi-Fi/VPN change | Detect stale WS on deadline/resume; one reconnect; no false command/process death |
| No-auth profiles with first login stalled / unsupported native profile | Other allowed profiles can progress; unsupported profile emits no login traffic |

Runtime collection to pinpoint original incident, without source edits:

- Native Shift+F12 opens existing devtools (`apps/native/src/main.tsx:59-82`); capture failed auth-status/login requests, upgrade response, WS open/close code and timing. Redact token query parameters and Authorization headers.
- Existing frontend diagnostics initialized at native startup `main.tsx:96`; storage key `damhopper_diagnostics_frontend_v1`, defaults 1-hour retention / 1,000 entries (`packages/ui/src/lib/diagnostics-client.ts:9-12`), so capture promptly. WS status and error diagnostics already recorded (`ws-transport.ts:1961-1966,2939-2941`). Registry retry scheduling lacks equivalent detailed event in shown scheduler, so absence of `reconnect_scheduled` does not prove registry failed; that event name belongs to transport-local fallback.
- Correlate backend heartbeat, overflow, auth-store timeout, origin rejection and restart logs with client timestamps; capture installed app version/build and WebView2 version. Avoid confusing this branch's current source with possibly older installed artifact.

## Unresolved questions

1. Exact indicator location/title user saw: tree lifecycle, tab/runtime activity, project aggregate, or top-nav connection?
2. Installed native artifact matches inspected source? Native version shown in current config is 0.15.3; deployed build/commit unknown.
3. During incident did registry ever become offline, or remain connected while I/O stalled? This separates cleanup failure from missing liveness detection.
4. First backend/client loss signature: heartbeat timeout, network/engine error, proxy close, origin failure, server restart, MFA/expiry, auth DB failure, or SSH-forward interruption? No logs/capture supplied.
5. Any background prompt redraw/control output within three seconds, frozen timers, or noncanonical terminal IDs at failing project-indicator callsite? Static source establishes possibilities, not occurrence.
