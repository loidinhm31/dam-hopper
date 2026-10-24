# Native terminal large-history ANR — root-cause investigation

## Executive summary

**Confirmed: main-thread starvation / Android ANR, not a 300–500KB WebSocket size-limit exception.**

The terminal publishes every incoming live chunk synchronously on Android's UI thread. Once the retained terminal reaches roughly 2,000 history rows, scrolling shifts row identities and rendered text at almost every index. `VtTerminalSurface.syncLinesFromEngine()` individually updates two `SnapshotStateList`s. Each same-size `SnapshotStateList.set()` compares the new persistent list against the old list, walking its unchanged prefix. Updating N indices therefore performs **O(N²) list-element comparisons per chunk**, despite `Snapshot.withMutableSnapshot`.

A history burst delivered in thousands of small live frames repeatedly pays that cost without sufficient opportunity for input handling. Android reports a 5-second input-dispatch timeout. The three pre-existing ANRs and both new reproductions stop in precisely this list-equality path.

**Reopening works because a new empty surface receives the accumulated history as one full replay and publishes it once. It does not resume from a persisted client offset, and the server buffer is not consumed or truncated by reading.** Reproduced the complete sequence with a **368,207-byte server buffer**: live generation → ANR → restart → `fromOffset=null`, full 368,207-byte replay, `reset=true`, `truncated=false`, replay completed in **368ms**, then a small command worked normally.

No tracked files edited. No fix implemented.

## Evidence and experiments

Environment: supplied API-36 emulator, installed debug app, existing loopback server. The app initially used its authenticated remote profile; those pre-existing ANRs were retained. Reproduction used the local development profile and two newly created diagnostic terminal sessions only.

### 1. Existing failures already identify the mechanism

`adb shell dumpsys activity exit-info dev.damhopper.nativeapp.debug` returned:

| Time | PID | Recorded exit |
| --- | --- | --- |
| 01:56:54 ANR / 01:57:07 exit | 12179 | reason=6 (ANR), user request after error, MotionEvent timeout 5001ms |
| 01:58:21 ANR / 01:58:25 exit | 13413 | reason=6 (ANR), MotionEvent timeout 5002ms |
| 02:06:04 ANR / 02:06:08 exit | 13530 | reason=6 (ANR), MotionEvent timeout 5001ms |

Crash logcat buffer was empty. `dumpsys dropbox --print data_app_anr` exposed the retained ANR stacks without root access. All three main-thread stacks contained `SnapshotStateList.set → VtTerminalSurface.syncLinesFromEngine`, at project lines **117**, **115**, and **117**, respectively. All three were handling **live output**, not `handleBufferReplay`.

This distinction matters: the reported “crash” was an unresponsive app subsequently closed, not an observed uncaught Java exception or OOM.

### 2. A single existing 522KB replay succeeds

Opened the existing local dam-hopper terminal without changing its command/history:

```text
02:17:25.841 terminal.attach fromOffset=null
02:17:26.018 buffer_replay byteCount=522272 offset=522272 reset=true truncated=false
02:17:26.197 buffer_replay_complete queuedChunkCount=0
```

The replay handler's logged interval was **179ms**. Terminal rendered and remained usable. This directly rules out a deterministic 300–500KB frame ceiling in this environment.

### 3. Live burst reproduces ANR

Created isolated session `crash-probe-261023-0211`, shell `sh`, 54 columns × 41 rows, project dam-hopper. Sent only to that owned session:

```sh
node -e "for(let i=0;i<6400;i++) console.log(String(i).padStart(79,'x'))"
```

An independent WebSocket observer received **3,717 terminal:output frames / 588,690 payload bytes** by the first completed observation. Frame sizes included 1-byte and 8-byte fragments. Windows PTY terminal-control/redraw bytes explain why payload bytes exceed the nominal 518,400 printable/newline bytes.

At **02:19:51**, Android reported:

```text
ANR in dev.damhopper.nativeapp.debug
PID: 13791
Input dispatching timed out ... Waited 5000ms for MotionEvent
main thread: 100% user CPU during ANR sampling interval
memory pressure some/full avg10=0.00
```

The main thread was runnable, not waiting on a socket, database, or mutex:

```text
kotlin.jvm.internal.Intrinsics.areEqual
kotlin.collections.AbstractList$Companion.orderedEquals (AbstractList.kt:168)
kotlin.collections.AbstractList.equals (AbstractList.kt:68)
kotlin.jvm.internal.Intrinsics.areEqual
androidx.compose.runtime.snapshots.SnapshotStateList.set (SnapshotStateList.kt:827)
VtTerminalSurface.syncLinesFromEngine (VtTerminalSurface.kt:117)
VtTerminalSurface.feedOutput (VtTerminalSurface.kt:87)
TerminalSessionController.feedAcceptedOutput (TerminalSessionController.kt:293)
TerminalSessionController.applyReconciledOutput (TerminalSessionController.kt:201)
TerminalSessionController.handleLiveChunk (TerminalSessionController.kt:164)
ProjectTerminalScreen...emit (ProjectTerminalScreen.kt:496)
SharedFlowImpl.collect
AndroidUiDispatcher.performTrampolineDispatch
Handler / Looper / ActivityThread.main
```

After force-stop/relaunch and reopening this same session:

```text
02:20:40.410 terminal.attach fromOffset=null
02:20:40.541 buffer_replay byteCount=589007 offset=589007 reset=true truncated=false
02:20:40.807 buffer_replay_complete queuedChunkCount=0
```

Full replay completed in **266ms**. No server restart or buffer clearing performed.

### 4. Exact requested size range reproduces the same failure

Created second isolated session `crash-probe-400k-261023-0211`; same command with **4,000** instead of 6,400 lines.

- Observed **2,372 live output frames**, **367,890 payload bytes** from the burst.
- Server buffer reached **368,207 bytes**, including the pre-existing shell prompt/setup bytes.
- At **02:21:50**, PID **14612** ANRed: MotionEvent timeout **5002ms**.
- Main thread sampled at **99% user CPU**.
- Stack again: `AbstractList.orderedEquals → SnapshotStateList.set → VtTerminalSurface.syncLinesFromEngine:117 → handleLiveChunk → AndroidUiDispatcher`.
- `adb shell input tap` did not complete within the experiment's 25-second command deadline.

Force-stopped/relaunched the app; reopened the same session:

```text
02:22:42.119 terminal.attach fromOffset=null
02:22:42.304 buffer_replay byteCount=368207 offset=368207 reset=true truncated=false
02:22:42.672 buffer_replay_complete queuedChunkCount=0
```

**Same complete buffer, same end offset, no truncation, 368ms replay.** UI hierarchy showed final numbered history rows and the prompt. Sent `printf 'post_restart_ok\n'` to the owned session; the UI showed the command, `post_restart_ok`, and a new prompt. This reproduces the user's reopen/normal-use observation without assuming offset persistence or server-side consumption.

### 5. Focused JVM real-source benchmark isolates the algorithm

Compiled the existing, unchanged Kotlin terminal surface, engine, grid, row, reflow, cell, and interface sources with cached Kotlin 2.1.10 / Compose Desktop 1.7.3 dependencies. Temporary harness and compiler output are outside the repository. This was a diagnostic harness, not a repository test-suite run. JVM timings are not Android latency predictions.

For the **same 518,400-byte generated history**, same 80×41 surface, same final 2,041 rendered rows:

| Feed chunk size | Total elapsed | Largest individual feed |
| --- | ---: | ---: |
| 518,400 bytes, one feed | 35ms | 33ms |
| 16,384 bytes | 1,281ms | 80ms |
| 4,096 bytes | 4,784ms | 66ms |
| 1,024 bytes | 22,476ms | 76ms |

The same payload becomes **~640× more expensive** when delivered as 1KB chunks instead of one feed. The Android PTY reproductions contained thousands of even smaller frames.

A separate counted-equality probe used real `SnapshotStateList` inside `Snapshot.withMutableSnapshot`, replacing each index once:

| N elements | Calls to element `equals` |
| ---: | ---: |
| 500 | 125,250 |
| 1,000 | 500,500 |
| 2,000 | 2,001,000 |

Exactly `N(N+1)/2`. Snapshot atomicity does **not** eliminate per-operation persistent-list equality checks.

## Execution path and exact project references

Paths below are relative to repository root.

| Stage | Source evidence | Thread / behavior |
| --- | --- | --- |
| OkHttp engine | `native-app/shared/src/androidMain/kotlin/dev/damhopper/nativeapp/core/transport/PlatformHttpEngine.android.kt:6-11` | Uses Ktor OkHttp, no custom incoming limit. |
| WebSocket reader | `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WsConnection.kt:44-48,144-146,209-235,272-275` | Reader launched in `CoroutineScope(Dispatchers.Default + Job())`; `frame.readText()` and JSON decode occur there; emits decoded message. |
| Full replay model | `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ServerMsg.kt:31-40` | One `TermBuffer` contains one whole `String`, offset/reset/truncated/incarnation. |
| Repository | `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalRepository.kt:239-243` | `filterIsInstance` only; no `flowOn` or parser dispatcher. |
| Screen collectors | `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt:492-513` | `LaunchedEffect` child launches inherit Compose's Android UI dispatcher. `UNDISPATCHED` changes startup, not subsequent dispatcher. Both `encodeToByteArray` and controller handling execute on UI thread. ANR stacks independently prove `AndroidUiDispatcher`. |
| Replay admission | `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalSessionController.kt:264-299` | Reset replay directly calls synchronous `feedAcceptedOutput`; no suspension/offload. Offset committed around feed; failures restore/fence then rethrow. |
| Live admission | `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalSessionController.kt:149-164,168-203` | Each accepted live frame calls the same surface synchronously, independently. |
| Surface feed | `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/VtTerminalSurface.kt:80-88` | Under `bufferLock`: reset if requested, parse whole chunk, then synchronize all displayed lines once per chunk. |
| Byte parser | `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/VtTerminalEngine.kt:125-158,179-182,522-533` | Synchronous loop over entire payload; creates character strings/cells; non-ASCII path additionally copies/decodes each scalar. UI-thread work in this call chain. |
| Bounded grid | `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/VtTerminalGrid.kt:6-18,206-214,274-279,340-359` | 2,000 **offscreen** rows plus viewport, not exactly 2,000 total. Scrolling evicts oldest history row and shifts visible retained indices. Observed viewport 41 rows → 2,041 total. |
| Publication hotspot | `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/VtTerminalSurface.kt:99-126` | Visits all retained rows. Calls `renderLine` twice each. Adds initial rows at 110/112, changes existing IDs at **115** and text at **117** inside a mutable snapshot. |
| Render caches | `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/VtTerminalRow.kt:19-23,45-80` | Row render results cached until invalidation. Therefore “two renderLine calls” does **not** mean two newly built annotated strings per row on every feed. New/dirty rows build cell-wise spans; shifted existing rows still move through expensive snapshot-list updates. |
| Compose display | `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt:1191-1207` | `LazyColumn`, stable row keys, bounded one-line fixed-height Text. Does not eagerly compose 2,041 Text widgets just because snapshot has that many rows. |
| Viewport following | `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalViewport.kt:94-104` | Content revision triggers follow/anchor scroll work after publication; not the sampled ANR hotspot. |

### Why the snapshot block remains quadratic

Downloaded the versioned Compose 1.7.3 source artifact used by the focused probe. Extracted `SnapshotStateList.kt`:

- Lines **139-140**: `set` delegates to `update { it.set(index, element) }`.
- Lines **204-208**: `update` delegates to `conditionalUpdate`.
- Lines **225-226**: computes a new persistent list, then `if (newList == oldList)`.

For an update at index `i`, equality walks equal elements 0 through `i-1` before reaching the changed element. A full shifted-row refresh updates nearly every ID and usually every rendered text entry. Two lists therefore approach **N(N+1)** element comparisons per frame: roughly **4.17 million at N=2,041**, before parser, formatting, snapshot bookkeeping, layout, and other UI work.

`Snapshot.withMutableSnapshot` makes the changes visible atomically; it does not convert the indexed operations into a single bulk replacement or remove the equality comparisons. A long run of queued UI-dispatcher collectors can starve input even if each individual feed is shorter than five seconds. The focused benchmark's individual feeds were under 81ms while total chunked work exceeded 22 seconds.

## Why reopening changes behavior, precisely

1. New screen uses `remember` maps, not persisted terminal state: `ProjectTerminalScreen.kt:171-199`. New surface/controller created at **335-345**. Closing composition closes/clears local controllers/surfaces at **581-600**.
2. `TerminalSessionController.lastSeenOffset` starts at **0uL**, `TerminalSessionController.kt:27-28`. `beginAttach()` returns current in-memory offset at **85-89**.
3. `TerminalAttachQueue.kt:33` captures that offset; **70** sends `offset.takeIf { it > 0uL }`. Consequently a fresh controller requests **null**, not wire offset 0. `TerminalRepository.kt:225-236` sends it as `from_offset`.
4. `server/src/api/ws.rs:827-847` creates one replay response for this connection. `server/src/pty/manager.rs:2024-2051` locks and **reads/clones** the existing buffer snapshot.
5. `server/src/pty/buffer.rs:76-84` returns all retained data with `reset=true` for null offset. `read_replay` takes `&self`, returns slices, and does not mutate/drain it. Eviction happens on writes exceeding capacity, **30-54**. Server capacity is **1MiB**, `server/src/pty/session.rs:26`.
6. The new empty surface parses the complete replay first, then appends the final retained rows once. Appends change list size, so equality does not repeatedly scan equal-length prefixes as every indexed replacement does.
7. By then the history burst has ended. Normal short output does not repeat thousands of full-window shifts. A later comparable live burst **can trigger the ANR again**; restarting is not a real fix.

A retained-controller reconnect **within the same screen/process** can instead request a positive offset and receive a delta; that is a different case. There is no client offset persistence in this screen/controller path, and the successful restart experiments explicitly logged null offset and full buffer.

Opening a terminal also broadcasts measured geometry: `ProjectTerminalScreen.kt:1080-1083,347-351`; controller `TerminalSessionController.kt:595-607`; server `ws.rs:799-810`, `session.rs:250-260`. **[INFERENCE]** An AI harness redraw caused by a new viewport size is one way “opening history” can generate a live-output flood immediately after replay. The historic ANR stacks establish live-output processing, but do not prove which harness operation initiated each original flood.

## Frame limits, memory, and Compose alternatives ruled out

- Ktor version **3.1.0**, `native-app/gradle/libs.versions.toml:8`. `WsConnection.kt:44-46` installs WebSockets without a custom cap.
- Ktor's WebSockets `Config.maxFrameSize` default is `Int.MAX_VALUE`; more importantly, its **OkHttp session** reports `maxFrameSize=Long.MAX_VALUE` and rejects dynamically setting it. Exact downloaded Ktor 3.1.0 source: `OkHttpWebsocketSession.kt:44-46`; text callback **105-107** wraps the full text as a byte-array Frame.
- Server configured incoming message and frame caps are **128MiB**: `server/src/api/ws.rs:59-62,255-257`. Its replay response is one serialized text message at **836-845**.
- A 500KB JSON frame does incur full-message string/byte/JSON allocation and copying; it is not streamed into the terminal parser. Transport decode is on Default, then the UI collector re-encodes the terminal data. These allocations are additional pressure, **not the observed fatal mechanism**.
- A real **522,272-byte replay succeeded**; full **368,207-byte replay succeeded** after a live-output ANR. Neither reproduction shows an incoming-size exception.
- Historic/reproduced ANR traces show runnable UI-thread list equality, not OOM, SQLite work, network blocking, deadlock, or duplicate LazyColumn keys. This is not an assertion that those failures are impossible elsewhere.
- LazyColumn virtualizes composition/layout, not the application's eager creation/publication of all annotated rows. Two thousand items are not inherently a Compose crash condition. State publication and key/content changes still invalidate downstream work, but the measured hotspot precedes LazyColumn composition.
- `TerminalReplayGate.kt:74-75` bounds queued replay/live data to 1,024 chunks / 4MiB; `WsConnection.kt:62` has 64 extra SharedFlow slots. These limit some buffering, but do not bound CPU time per UI turn or coalesce surface publication. The observed stacks are the live-ready path, not replay queue overflow.
- Server live reader uses up to **4,096 bytes per read**, `server/src/pty/manager.rs:3032,3138-3149`, and publishes each decoded chunk at **3078-3087,3120-3127**. `server/src/api/ws.rs:3143-3153` forwards those messages without UI-oriented batching. Real reads in the probe were often far smaller than 4KB.

## Recommended remediation direction — not implemented

1. **P0: Remove quadratic indexed SnapshotStateList publication.** Use a presentation representation/update strategy that publishes a bounded frame once, and does not run whole-list equality per changed row. Preserve stable row identity, atomic text/ID visibility, replay fencing, and reading anchors. Merely wrapping the current loop in a mutable snapshot is already done and is insufficient.
2. **P0: Coalesce ordered input for presentation.** Parse every byte in order, but do not rebuild/publish the retained viewport for every tiny network frame. Apply a bounded cadence/budget so continuous history output cannot monopolize the UI dispatcher. Merely splitting a 500KB replay into many calls to current `feedOutput` makes this workload worse, as the probe demonstrates.
3. **P1: Separate parser cost from UI publication.** A single serialized parser owner off Main can handle large byte streams, with immutable/stable render results published safely to Compose. Dispatcher migration alone leaves the quadratic work intact and must not introduce parser/resize/cursor/replay races.

Acceptance evidence for a future fix should cover the reproduced 368KB/2,372-frame burst and the same bytes as one replay, input responsiveness during output, >2,000-row eviction, existing replay/offset fencing, and reading-position preservation. No implementation or repository test suite run performed in this investigation.

## Artifacts and cleanup

Report: `plans/reports/large-buffer-crash-debugger-261023-0211-terminal-anr-root-cause.md`.

Raw evidence and reproducible JVM probe retained outside repository:

`C:/Users/loidi/AppData/Local/Temp/damhopper-crash-njaikh4m/`

Key artifacts:

- `exit-info.txt`: original Android exit reasons.
- `dropbox-anr.txt`: three original ANR stacks.
- `dropbox-anr-after-repro.txt`: includes first new ANR; hot stack **7827-7862**.
- `dropbox-anr-400k.txt`: includes exact-range ANR; hot stack **10556-10594**.
- `experiment-logcat.txt`: first ANR **9-76**; 400KB-range ANR **166-230**; successful same-buffer replay **257-262**.
- `post-restart-ui.xml`: successful synthetic history / post-restart command UI.
- `ReplayProbe.kt`, `probe.jar`, `probe-output.txt`: unchanged real-source diagnostic harness and results.
- `SnapshotStateList.kt`, `OkHttpWebsocketSession.kt`, `WebSockets.kt`: extracted versioned dependency sources.

Both owned diagnostic server sessions removed (HTTP 204), observer WebSocket closed, logcat subprocess stopped, owned device XML removed. Original remote profile reselected and authenticated; app left on its project list. No existing terminal was killed or removed. Opening existing terminals did issue their normal geometry updates.

### Primary library sources consulted

- [Compose Runtime 1.7.3 sources](https://repo.maven.apache.org/maven2/org/jetbrains/compose/runtime/runtime-desktop/1.7.3/runtime-desktop-1.7.3-sources.jar), `commonMain/androidx/compose/runtime/snapshots/SnapshotStateList.kt` and `Snapshot.kt`.
- [Ktor OkHttp 3.1.0 sources](https://repo.maven.apache.org/maven2/io/ktor/ktor-client-okhttp-jvm/3.1.0/ktor-client-okhttp-jvm-3.1.0-sources.jar), `jvmMain/io/ktor/client/engine/okhttp/OkHttpWebsocketSession.kt`.
- [Ktor Client Core 3.1.0 sources](https://repo.maven.apache.org/maven2/io/ktor/ktor-client-core-jvm/3.1.0/ktor-client-core-jvm-3.1.0-sources.jar), `commonMain/io/ktor/client/plugins/websocket/WebSockets.kt`.
- [Android lazy list documentation](https://developer.android.com/develop/ui/compose/lists): lazy components compose/layout viewport items, not all list entries.

## Unresolved questions

- The exact user/harness action initiating each original remote live-output flood was not recorded. A resize-triggered redraw is plausible, not proven. The ANR hot path itself is established by all three original stacks and two controlled reproductions.
- A failure caused solely by one isolated 300–500KB replay, with no concurrent live flood or other workload, was **not reproduced**; observed large single replays succeeded. Do not mislabel the confirmed live-update ANR as a universal frame-size threshold.
