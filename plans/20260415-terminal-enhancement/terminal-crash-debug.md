# Terminal Crash/Break — Root Cause Analysis

> Date: 2026-04-15
> Scope: Why terminal sessions appear to crash or break in DamHopper

---

## How Terminal I/O Works (Fast Path)

```
Browser xterm.js → WsTransport.terminalWrite() → ws.send({kind:"terminal:write"})
                                                          ↓
                                         [Axum ws.rs] TermWrite handler
                                                          ↓
                                         PtySessionManager.write(id, bytes)
                                                          ↓
                                         PTY stdin → shell process

Shell process → PTY stdout → reader_thread → buf.push() + sink.send_terminal_data()
                                                          ↓
                                         BroadcastEventSink → broadcast::channel
                                                          ↓
                                         pump_pty() → out_tx (mpsc, cap=512)
                                                          ↓
                                         writer task → ws_tx.send() → browser
                                                          ↓
                                         WsTransport.onmessage → dataListeners
                                                          ↓
                                         xterm.js.write(data)
```

---

## Failure Mode 1: WebSocket Disconnects While Terminal Is Active

### What happens
- Network hiccup, laptop sleep, server restart, or auth expiry drops the WS connection
- `ws.onclose` fires → `WsTransport.scheduleReconnect()` → exponential backoff 1s→2s→4s→…→30s
- **During reconnect gap:** any `terminalWrite()` or `terminalResize()` calls are **silently dropped** ([ws-transport.ts L730-738](file:///home/loidinh/ws/sharing/dam-hopper/packages/web/src/api/ws-transport.ts#L729-L738)):
  ```ts
  terminalWrite(id: string, data: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {  // ← silently dropped if not open
      this.ws.send(...);
    }
  }
  ```
- **After reconnect:** `TerminalPanel` is already mounted. It subscribed to `onTerminalData(sessionId, …)` once on mount — those listeners survive WS reconnect because they're on the transport object, not the WS socket. **Output resumes automatically.**
- **BUT:** any keystrokes typed during the gap are lost. xterm.js receives nothing. Looks "frozen/broken".

### Classification: **Intended design gap** — not a bug, but poor UX
### Impact: Input silently lost post-disconnect; user unsure if terminal is alive

---

## Failure Mode 2: PTY Reader Thread EOF — Session Appears Dead

### What happens
1. Process inside PTY exits (e.g. `mvn` finishes, shell `exit`, program crashes)
2. `reader_thread` detects EOF → calls `harvest_exit_code()` → transitions to `DeadSession`
3. `sink.send_terminal_exit(id, Some(exit_code))` fires → WS broadcasts:
   ```json
   {"kind":"terminal:exit","id":"run:api","exitCode":1}
   ```
4. `WsTransport` calls `onTerminalExit` listeners → `TerminalPanel.onExit?.(exitCode)` is called
5. **TerminalPanel does nothing with the exit event** ([TerminalPanel.tsx L117-119](file:///home/loidinh/ws/sharing/dam-hopper/packages/web/src/components/organisms/TerminalPanel.tsx#L117-L119)):
   ```ts
   unsubExit = transport.onTerminalExit(sessionId, (exitCode) => {
     onExit?.(exitCode);  // ← passed up to parent, not displayed in terminal
   });
   ```
6. xterm.js shows nothing special — terminal just goes silent. The status dot in the tab bar turns red/amber, but **the terminal itself shows no message**.

### Classification: **Design gap** — exit is handled at the tab level but not shown inline
### Impact: User sees a silent terminal, no indication process exited or what the exit code was

---

## Failure Mode 3: mpsc Queue Overflow → WS Connection Closed (Code 4001)

### What happens
- Each WS connection has a `CONN_CHAN_CAP = 512` message buffer ([ws.rs L27](file:///home/loidinh/ws/sharing/dam-hopper/server/src/api/ws.rs#L27))
- FS event pump uses `try_send` ([ws.rs L973-978](file:///home/loidinh/ws/sharing/dam-hopper/server/src/api/ws.rs#L973-L980)):
  ```rust
  Err(mpsc::error::TrySendError::Full(_)) => {
    warn!(sub_id, cap = CONN_CHAN_CAP, "fs pump mpsc full — closing connection (4001)");
    let _ = out_tx.try_send(WireMsg::CloseOverflow);
    break;
  }
  ```
- **BUT the PTY pump uses `.await` (blocking)** ([ws.rs L882-884](file:///home/loidinh/ws/sharing/dam-hopper/server/src/api/ws.rs#L882-L884)):
  ```rust
  if out_tx.send(WireMsg::Text(msg)).await.is_err() {
    break;
  }
  ```
- High PTY output (e.g. `cat bigfile.txt`) + a slow network → mpsc fills → PTY pump blocks the writer task → FS events back-pressure → **FS pump triggers 4001 close**
- Browser WsTransport receives close → reconnects via backoff
- **On reconnect: TerminalPanel is still mounted but its `onTerminalData` listeners are still registered on the (now-reconnected) transport. PTY session still alive server-side. Output resumes.**
- But: xterm.js missed output during the gap. No replay of missed output after reconnect (scrollback only served on initial `terminal:buffer` call, not on reconnect).

### Classification: **Bug** — FS overflow causes entire WS to drop, including unrelated terminals
### Impact: Sudden disconnect with no user-visible reason; missed terminal output

---

## Failure Mode 4: TerminalPanel Reconnect — Stale vs. Live Check Race

### What happens
In `TerminalPanel`, on mount ([TerminalPanel.tsx L95-108](file:///home/loidinh/ws/sharing/dam-hopper/packages/web/src/components/organisms/TerminalPanel.tsx#L95-L108)):
```ts
api.workspace.status()
  .then(() => transport.invoke<Array<{ id: string }>>("terminal:list"))
  .then((alive) => {
    if (alive.some((s) => s.id === sessionId)) {
      // reconnect path — replay buffer
      return transport.invoke<{ buffer: string }>("terminal:buffer", sessionId)
        .then(({ buffer }) => { if (buffer) term.write(buffer); });
    }
    // create path
    return transport.invoke<string>("terminal:create", { id: sessionId, ... });
  })
```

**Race condition:** `terminal:list` returns the current live sessions. If:
- A WS reconnect happens between `terminal:list` response and `terminal:create` call
- The session exists in `live` map but races with a concurrent kill or natural exit
- The buffer could be **empty or stale** if scrollback was cleared

**Separate issue:** `terminal:list` returns **ALL sessions including dead ones** (`list()` in manager.rs returns both live + dead). The check `alive.some(s => s.id === sessionId)` may match a dead session, skipping creation → terminal never spawns a new process → xterm.js appears broken.

```rust
pub fn list(&self) -> Vec<SessionMeta> {
    let inner = self.inner.lock().unwrap();
    let mut result: Vec<SessionMeta> = inner.live.values().map(...).collect();
    result.extend(inner.dead.values().map(|d| d.meta.clone()));  // ← dead sessions included
    result
}
```

### Classification: **Bug** — dead session in `terminal:list` can block recreation
### Impact: Terminal panel tries to reconnect to a dead session, buffer replay shows stale output, no new process spawned

---

## Failure Mode 5: Dead Session Tombstone Expiry (60s TTL)

### What happens
- Dead sessions are retained for `DEAD_SESSION_TTL = 60s` ([manager.rs L19](file:///home/loidinh/ws/sharing/dam-hopper/server/src/pty/manager.rs#L19))
- After 60s, `spawn_cleanup_task` sweeps them out
- If user switches away from terminal tab for >60s after process exits, then returns:
  - `terminal:list` no longer contains the session → TerminalPanel tries `terminal:create` with the same ID
  - This is **correct behavior**, new process spawns
  - BUT: the terminal display shows the stale scrollback from xterm.js's in-memory buffer (up to `scrollback: 5000` lines in xterm config), then suddenly a new shell prompt appears mid-screen

### Classification: **Intended design** but visually confusing
### Impact: Old output + new shell in same xterm view, no visual separator

---

## Summary Table

| # | Failure | Bug or Design? | Severity | Fix Needed? |
|---|---|---|---|---|
| 1 | WS disconnect → keystrokes lost | Design gap | Medium | Show "Reconnecting…" in xterm; buffer locally |
| 2 | Process exit shows nothing inline | Design gap | Medium | Print exit code banner in xterm.js |
| 3 | FS overflow kills WS (4001) | **Bug** | High | Decouple FS pump overflow from PTY connection |
| 4 | Dead session blocks recreation | **Bug** | High | Filter `alive=true` in reconnect check |
| 5 | Stale xterm + new shell | Intended but confusing | Low | Print separator on recreation |

---

## Highest Priority Fixes

### Fix 1 (Bug #4): Filter dead sessions in reconnect check — trivial

In `TerminalPanel.tsx`:
```ts
// Current (buggy):
if (alive.some((s) => s.id === sessionId)) {

// Fix:
if (alive.some((s) => s.id === sessionId && s.alive)) {
```

Also the API call should use `terminal:list` which returns `SessionInfo[]` including `alive` field, or use `terminal:listDetailed` — the `alive` field is already in `SessionMeta`.

### Fix 2 (Bug #3): Decouple FS overflow from PTY — medium

The `pump_pty` uses waiting `.await` send which is correct for backpressure, so it won't overflow.
The `pump_fs_events` uses `try_send` which triggers 4001.
**Root issue:** both FS and PTY share the same `out_tx: mpsc::Sender<WireMsg>(512)`. A burst of FS events fills the channel.

Options:
- Increase `CONN_CHAN_CAP` from 512 → 2048
- Or: give FS and PTY separate channels, only kill one on overflow

### Fix 3 (Design Gap #2): Show exit banner inline in xterm — trivial

In `TerminalPanel.tsx`, inside the `onTerminalExit` handler:
```ts
unsubExit = transport.onTerminalExit(sessionId, (exitCode) => {
  // Print visible exit banner so user knows the process stopped
  const color = exitCode === 0 ? "\x1b[32m" : "\x1b[31m";
  term.write(`\r\n${color}[Process exited with code ${exitCode ?? "?"}]\x1b[0m\r\n`);
  onExit?.(exitCode);
});
```

### Fix 4 (Design Gap #1): Show reconnecting indicator — minor

In `WsTransport.scheduleReconnect()` or in `TerminalPanel`, detect `status === "disconnected"` and write a banner to xterm.

---

## Unresolved Questions

1. Should the dead-session 60s TTL be extended? Currently if user is away and returns after >60s, old output is gone from server but still visible in xterm. Extending TTL to 5min would reduce confusion.
2. Should `terminal:create` be idempotent for dead sessions (auto-cleanup before re-create) rather than requiring the client to detect the `alive` field?
