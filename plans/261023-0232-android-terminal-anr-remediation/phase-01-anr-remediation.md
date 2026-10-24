# Phase 01 — Android terminal ANR remediation

## Context links

- [Parent plan](./plan.md): reported ANR evidence, approved snapshot/worker architecture, acceptance criteria.
- [Android architecture](../../docs/architecture/android-native-client.md#terminal-lifetime): replay, ownership, terminal retention and input fences.
- [Code standards](../../docs/code-standards.md#kotlin-multiplatform-and-android-native-client-native-app).
- [Native build instructions](../../native-app/README.md), [qualification ledger](../../docs/android-native-acceptance.md).

## Overview

**Priority:** P1. **Implementation status:** pending. **Scope:** existing Kotlin VT engine and both terminal consumers; no server protocol, WebView, rendering-engine or product-navigation replacement.

Remove per-packet `SnapshotStateList` mutation from Main. Serialize terminal ingestion off Main, construct coherent immutable display snapshots at frame cadence, and publish by reference. Keep terminal reconciliation, stable row IDs, ANSI styling, retention, input isolation and lifecycle behavior intact.

This document is an implementation plan, not evidence that remediation or verification has run. Existing documentation's earlier terminal-test results concern the preceding remediation, not this ANR fix.

## Key findings

1. `VtTerminalSurface.syncLinesFromEngine()` currently mutates two snapshot lists per row. The parent investigation attributes the ANR to persistent-list comparisons in that Main-thread loop. Parsing, row rendering, resize and cursor blink also share `bufferLock`.
2. `ProjectTerminalScreen` and `WorkbenchScreen` separately collect live/replay/lifecycle flows. Moving each collector independently to Default would introduce races and would not establish a single FIFO across message types.
3. `VtTerminalRow` already caches styled base/padded/cursor strings. Reuse these caches and `VtTerminalGrid.renderedRowId()`; do not recreate the renderer or compare entire `AnnotatedString` trees on Main.
4. `TerminalSessionController.feedAcceptedOutput()` temporarily toggles `surface.isLiveStream` around a synchronous call. Deferred parsing must carry historical/live provenance in the command itself; a mutable flag around queue submission is incorrect.
5. `beginAttach()` currently closes input synchronously and captures the accepted offset. `TerminalAttachQueue` is Main-confined and serializes attach sends. Preserve that safety boundary while making prior parser work and offset capture awaitable.
6. `encodeSpecialKey()` reads the engine directly, `pasteText()` reads bracketed-paste mode, and search takes the worker lock. These paths need immutable published metadata/snapshot reads, not just a new `LazyColumn`.
7. Workbench currently creates a controller without a surface and `TerminalScreens.kt` falls back to raw-buffer parsing. Both must use the same VT ingestion/snapshot path; keeping only the active project screen fixed is incomplete.
8. Existing replay overflow is explicitly recovered by reattachment. Parent decision: preserve that behavior during gated attachment; ordinary admitted streaming must remain lossless FIFO. Do not reinterpret normal ingestion overflow as permission to drop data.

## Requirements and invariants

### Functional

- One coherent `TerminalDisplaySnapshot(rows, revision, cursorRow, cursorCol, generation)`; `RenderedRow(id, text)` stores immutable styled text.
- Keep read-only `lines`, `lineIds`, `updateRevision` compatibility getters. Callers must not mutate collections or assume publication completes synchronously with admission.
- Off-Main parser/grid ownership; one serialized worker per controller/surface lifetime, with a bounded dedicated FIFO channel.
- Raw live/replay chunks, authoritative resets, clear, resize and lifecycle mutations follow the same ordered command boundary. Normal raw chunks are never conflated, reordered or silently discarded.
- Content publications at a nominal 33 ms minimum interval during bursts; guaranteed scheduled trailing flush when output pauses. Cursor-only blink is a presentation update, not content activity.
- Main rendering, blink, search, key encoding and close never wait on `bufferLock` or a worker join.
- Preserve replay duplicate/overlap/gap logic, lower/empty authoritative resets, truncation metadata, incarnation fencing, historical protocol-reply suppression and inactive/privacy input gates.

### Bounds and explicit guarantee boundary

- Set ingestion raw-payload capacity to **4 * 1024 * 1024 bytes** per controller. A channel's element count alone is not a byte limit; also bound command slots, initially 1,024, to bound tiny/empty-event overhead.
- Account bytes from reservation through queued, active and replay-held ownership. Transfer a reservation to the replay gate; do not release it merely because an event left the channel. Release exactly once after consumption, legitimate duplicate rejection, explicit supersession, cancellation or close.
- Apply suspending backpressure for normal streaming. No `UNLIMITED`, dropping overflow policy, `trySend` failure ignored, or `launch { send(...) }` per incoming packet.
- Preserve existing **gated-attachment overflow/reattach recovery**. If held pre-baseline data prevents byte admission and the baseline is later on the same socket, trigger that recovery rather than suspend forever. Deliver overflow through one coalesced metadata state plus wakeup that does not require a raw-byte reservation or FIFO command slot; do not wait for the baseline inside its collector. Attach/close immediately update their input/publication fence and wake admission waiters even when both bounds are full. A producer already suspended in normal mode must re-evaluate attachment generation on wake and take the gated recovery path when appropriate. Coalesce concurrent recovery requests through the existing attach queue; this control escape must not reorder ordinary admitted raw output.
- Distinguish ordinary lossless FIFO admission from existing recovery semantics: authoritative reset, stale incarnation, duplicates, attachment supersession and gated-overflow recovery may intentionally invalidate bytes. Never describe finite-tail replay as guaranteed lossless recovery under arbitrary overload. Server `SCROLLBACK_CAPACITY` is currently 1 MiB (`server/src/pty/session.rs`); no server change belongs to this phase.
- The 4 MiB limit describes controller-owned pending raw payload, not the complete application heap. Existing `WsConnection` shared-flow buffering is 64 **messages**, not 64 bytes; decoded strings, one transport frame, immutable render state and row caches are separate allocations. Do not advertise a whole-process 4 MiB memory guarantee.
- A single payload exceeding capacity must not wait for impossible whole-message credits. Keep the original decoded message owned by the transport collector; incrementally encode/admit bounded UTF-8 segments after reserving credits, preserving surrogate/scalar boundaries and message end-offset semantics. Do not encode an oversized full `ByteArray` in controller state first. Views into an oversized allocation retain that entire allocation and therefore cannot satisfy a retained-allocation bound merely by charging the view length. Byte-array entry points may transfer a within-budget array or copy only a newly reserved bounded segment from caller-owned storage. No oversized source array may become worker-owned. For an oversized baseline that cannot fit the gated-replay contract, take explicit existing recovery/failure behavior; no silent truncation or deadlock.

## Architecture and contracts

### Data path and ownership

`WsConnection.incomingMessages` → one ordered terminal-event subscription → capture exact current controller on Main → off-Main encoding and suspending FIFO admission → serialized replay/reconciliation and VT parser → deadline-paced immutable candidate → Main generation check and reference swap → `LazyColumn`.

- Add a unified terminal-event flow in `TerminalRepository` by filtering the original incoming stream, not by merging separately collected live/replay flows. Include output, replay, exit, restart and lagged messages. Leave unrelated agent/domain subscriptions unchanged.
- Main owns controller registries, Compose state, selection/attachment tokens, input permission callbacks and UI effects. Worker owns engine/grid mutation, reconciliation state and pending replay bytes. Publish immutable controller status needed by Main; do not mutate Compose maps from Default.
- Resolve controller identity/owner before admission and revalidate after suspensions. Workbench controller creation remains Main-confined. Preserve subscription readiness before any attach send; an effect starting a Default coroutine is not itself proof the subscription is active.
- Worker callbacks needing UI state (`onRequestReattach`, raw input sinks, resize broadcasts) hop to Main with captured owner/controller/incarnation/attempt identity. Suppress historical protocol replies at their source; a queued reply must not become live merely because the gate opened later.
- Input authorization remains immediate and Main-confined. Attach/retirement/close synchronously close an input fence before asynchronous work begins. Delayed replay-ready status carries the exact current attachment token and cannot reopen a newer fence. Do not infer that a completed attach send means replay has completed.

### Snapshot model and rendering

```kotlin
data class RenderedRow(val id: Long, val text: AnnotatedString)

data class TerminalDisplaySnapshot(
    val rows: List<RenderedRow> = emptyList(),
    val revision: Long = 0L,
    val cursorRow: Int = 0,
    val cursorCol: Int = 0,
    val generation: Long = 0L,
)

var displaySnapshot by mutableStateOf(
    TerminalDisplaySnapshot(), referentialEqualityPolicy()
)
    private set
```

- Collections are immutable by ownership, not merely typed `List`: never retain a mutable builder that later changes published contents. Reuse unchanged `RenderedRow` and `AnnotatedString` objects by row ID/base-text reference.
- Define `cursorRow` as the index into published `rows`, including main scrollback; `cursorCol` is a terminal cell column, not a UTF-16 offset. Hidden/out-of-range cursor is represented by immutable cursor visibility metadata, not an invented row.
- Content revision advances for actual base content, row identity/count or geometry changes, including changes within a coalesced batch. It does not advance for blink or cursor-only presentation. Compare cached base-row references on the worker; never structural-equality-check a full row tree on Main.
- Compatibility `lines`/`lineIds` use cached immutable projections per candidate, not `.map` allocations on every getter access. UI captures `val snapshot = surface.displaySnapshot` once, then takes row count, key and text from that same object.
- Keep worker-built cursor-on/off styled variants and base-row metadata in an internal immutable render candidate. Main blink changes only cursor presentation against that candidate; never calls `engine.activeGrid`, `renderLine()` or a worker lock. A one-row immutable overlay view can avoid copying the full list; always anchor it to the canonical rows so blinks do not build chains of overlays.
- On content commit, compose the candidate with the **current Main blink phase**, not the phase captured when the worker started. This prevents an arriving content frame from undoing a more recent blink.
- Publish immutable application-cursor/bracketed-paste modes independently of frame-throttled display publication. For mode-dependent arrows/paste, submit an ordered input intent to the worker after capturing key/modifiers on Main; encode against current worker modes after preceding output, then recheck the immediate Main permission/attachment token before sending. Migrate mode-dependent synchronous encoding callers rather than use a potentially 33 ms stale display mode. Search scans one published snapshot. No production Main caller reads `surface.engine`; engine inspection in tests occurs only after an explicit worker barrier.

### Worker API and lifecycle

- Keep `NativeTerminalSurface.feedOutput()` as the low-level surface contract used by a serialized owner; production screens call suspending controller admission, not this synchronous adapter directly. Separate engine consumption from snapshot building/publication in `VtTerminalSurface`.
- Represent commands explicitly: live output, buffer replay with reset/truncation/incarnation, legacy output if still used, resize, local clear, attach boundary, fail-attach, exit/restart/lagged, and a test/attach barrier. Historical/live mode is immutable command metadata.
- Use an injected scope/worker dispatcher/Main dispatcher/monotonic clock or coroutine delay seam so `runTest` can own all asynchronous jobs. Use one worker coroutine, not a new OS thread per terminal.
- Admission completion means queued, not parsed or painted. Provide an internal ordered barrier for tests and attachment sequencing; no sleeps and no synchronous `runBlocking` on Main. Migrate callers of asynchronous controller operations rather than retain a second synchronous production path.
- Advance `lastSeenOffset` only after parser acceptance succeeds. Queued bytes are not resumable progress; publication can lag accepted offset. If parsing throws, retain the preceding accepted offset, fence input, and use existing error/recovery policy. Always rethrow cancellation.
- `beginAttach` handling: close the input fence immediately; serialize an attach-boundary command after earlier admitted work; await its processed offset before the existing attach queue sends. Do not block Main while waiting. `recover(capturedOffset)` must not reset the gate a second time and lose newly queued live bytes.
- Keep a monotonic surface generation distinct from `ConnectionRef.generation`, PTY incarnation and replay-gate generation. Bump/invalidate publication identity on authoritative reset, attach lifetime transition and disposal. Ordinary reattach retains accepted framebuffer/parser state unless an authoritative reset arrives.
- Main commits check exact owner/controller, surface generation and an internal monotonically ordered publication sequence. Sequence is distinct from content revision because cursor-only states can share a revision. Old candidates cannot revive disposed/reset content.
- Local generation tokens fence local work, not indistinguishable wire responses. Existing protocol carries no attach-attempt ID, and the attach queue orders sends rather than completion of replay responses. Inspect/preserve existing ordered-response and end-offset reconciliation behavior; add a regression for an older same-incarnation replay response arriving after recovery starts, including authoritative lower/empty reset semantics. Do not invent attempt identity for an incoming packet or claim local tokens solve wire correlation.
- Close is idempotent: immediately invalidate Main publication/input identity, clear visible state/listeners, cancel worker/publication tasks, close admission, wake suspended senders and release reservations. Engine cleanup runs with worker ownership; Main never joins or takes its buffer lock. Temporary surface detach does not kill the remote PTY or destroy a retained controller.

### Frame pacing and trailing flush

1. Parsing marks a dirty generation. Build no row snapshot per packet.
2. If no content frame is pending and the last committed/scheduled content frame is at least 33 ms old, build the first candidate promptly; otherwise retain one non-resetting deadline.
3. Consume queued commands continuously, but check the frame deadline and cancellation between bounded parse slices. Start with 16 KiB slices; retain VT UTF-8/ANSI residual state and the original message's reconciliation/reset semantics across slices. A reset executes once, not on each slice.
4. When due, build a coherent candidate on the worker. Main receives at most one pending candidate/publication task; replace superseded **display candidates only**, never raw commands. Do not await a blocked Main dispatcher before continuing ingestion.
5. If the queue becomes idle while dirty, wait on either the next command or the existing deadline. Publish the final prompt even if no further byte ever arrives. Do not cancel/restart a 33 ms debounce on every chunk; that starves continuous output.
6. Main commit checks the ceiling as well as generation/sequence, so delayed Main dispatch cannot cause several queued content commits in one frame. A delayed tick does not create catch-up publications.
7. Under an available worker/Main scheduler, target trailing publication within 33 ms of the last accepted dirty change; if parser work or scheduler starvation exceeds that interval, record the actual latency during qualification rather than claim a hard real-time guarantee.
8. Blink does not build a fresh grid snapshot, affect content revision, restart follow effects or consume the content-publication rate budget. Close/reset invalidation may clear stale visible content immediately.

## File assignments

Paths below are repository-root-relative. Ownership describes implementation responsibilities, not additional agents to spawn. One integration owner resolves controller/surface API changes before UI migration.

| Owner | Action / files | Responsibility |
| --- | --- | --- |
| Surface | Modify `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/VtTerminalSurface.kt` | Atomic snapshot state, worker-only engine methods, snapshot builder, cursor candidate, immutable modes/search, lock-free Main close/blink. |
| Surface | Create `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalDisplaySnapshot.kt` | Snapshot/row value types and small immutable projections; follow existing Kotlin class-file naming. |
| Ingestion / integration | Modify `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalSessionController.kt` | Serialized admission, replay/offset ownership, status publication, mode consumers, callback and lifecycle fences. |
| Ingestion / integration | Create `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalIngestionWorker.kt` | FIFO commands, byte/slot admission, cancellation-safe ownership, deadline scheduler. Keep helper scope terminal-specific. |
| Ingestion / integration | Modify `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalReplayGate.kt` | Credit ownership transfer/accounting and existing gated overflow recovery; preserve replay semantics. |
| Ingestion / integration | Modify `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAttachQueue.kt` | Ordered asynchronous attach boundary/offset capture while preserving immediate input fence and send coalescing. |
| Transport / UI | Modify `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalRepository.kt` | Unified ordered terminal-event flow. Existing `WsConnection` suspending `emit` remains unchanged unless integration proves a required correction. |
| Transport / UI | Modify `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt` and `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt` | One ordered terminal subscriber, off-Main payload work, correct scopes and status callbacks, both surfaces wired to the worker. |
| Transport / UI | Modify `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalScreens.kt` | Workbench VT snapshot renderer with stable row keys; no active VT raw-buffer parsing fallback. Preserve non-VT adapter behavior. |
| Transport / UI | Modify `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalViewport.kt` only if signature requires it | Consume coherent candidate IDs/revision; preserve follow/anchor policy and ignore blink. |
| Tests | Modify existing `VtTerminalSurfaceTest.kt`, `TerminalSessionControllerTest.kt`, `TerminalReplayRenderingTest.kt`, `TerminalReplayGateTest.kt`, `TerminalPresentationPolicyTest.kt`, `TerminalSessionControllerLoggingTest.kt` under `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/` | Migrate assertions to explicit processing/publication barriers and retain all existing coverage. |
| Tests | Create `TerminalIngestionWorkerTest.kt` and `TerminalSnapshotPublicationTest.kt` in that same JVM test directory | Deterministic queue, ordering, frame cadence, trailing flush, cancellation and generation races using the production worker/engine. |
| Tests | Update any affected callers under `native-app/shared/src/commonTest/`, `native-app/shared/src/jvmTest/`, and `native-app/androidApp/src/test/` | Clean API cutover, including ownership/journey fixtures outside the terminal package. |
| Integration / docs | Update `docs/architecture/android-native-client.md`, `docs/system-architecture.md`, `native-app/README.md`, `docs/android-native-acceptance.md`, and this plan's parent status | Record actual implementation, guarantee boundary and exercised results; no claim of physical qualification without device evidence. |

No production file deletions expected. Delete obsolete per-element snapshot mutation, Main engine reads, temporary `isLiveStream` toggling and redundant per-type screen terminal collectors after migration. Do not rewrite VT/grid/reflow behavior or remove unrelated adapters. Existing coroutine-test dependencies suffice; no new library required.

## Implementation sequence and task acceptance

1. **Freeze contracts and baseline regressions.** Assign integration ownership; inventory every controller/surface constructor, feed/resize/clear/attach caller and engine reader. Agree queued-versus-processed-versus-published semantics, byte ownership, snapshot cursor metadata and callback dispatch. Acceptance: both screens and tests have a defined migration path; no duplicate worker ownership.
2. **Implement atomic surface snapshots.** Replace snapshot lists with the value model and referential policy; split consume/build/commit; reuse styled caches and stable IDs; implement cursor-on/off presentation and immutable modes. Acceptance: a published snapshot cannot change retroactively; text/IDs/count/revision always agree; blink needs no engine access and does not change content revision.
3. **Implement serialized bounded ingestion.** Add command channel, byte/slot reservations, worker scope, bounded parse slices, ordered barriers and frame scheduler. Move controller replay mutation to serialized ownership and preserve historical query suppression. Acceptance: no parser/grid work on Main, no lost/reordered normal output, cancellation and close release every reservation.
4. **Integrate attach and overflow lifecycle.** Adapt `TerminalAttachQueue`, immediate input fences, accepted-offset capture, publication generations and gated replay overflow. Acceptance: baseline behind a full prebaseline backlog cannot deadlock; recovery remains explicit, existing lower/empty reset and failure fencing semantics remain intact.
5. **Migrate both UI paths.** Add unified repository stream; retain Main-confined maps and subscription-before-attach ordering; move encoding/admission work off Main; create Workbench VT surface; consume one snapshot with `row.id` keys. Acceptance: project and retained Workbench paths both run the production worker; no VT raw-string rendering bypass and no UI worker-lock dependency.
6. **Complete deterministic regressions.** Extend existing suites and add scheduler/byte-bound/race tests described below. Acceptance: tests observe actual parsing and display commits via injected dispatchers/barriers, not fake output or delays.
7. **Integration verification and documentation.** Main/integration owner runs the commands below once after all changes land, investigates failures, and records device evidence separately. Update architecture/qualification docs to actual results, remove obsolete code, and mark this phase complete only when acceptance is met.

## Edge cases and verification matrix

| Area | Required coverage / observable assertion |
| --- | --- |
| Snapshot coherence | One captured object supplies all row keys/text/count/cursor/revision; retained previous objects never mutate; duplicate text has distinct stable IDs; cached unchanged styled strings retain identity. |
| Content versus cursor | Cursor movement/visibility and repeated blink preserve content revision/row IDs; blank lower cursor row remains padded; moving cursor off a wide glyph leaves no half-glyph/style corruption; stale content candidate cannot reverse current blink. |
| Frame scheduling | Thousands of chunks with no idle gap still publish at the ceiling, not per chunk; isolated final chunk flushes without another message; just-before/at/after-deadline arrivals work; delayed Main commits do not catch up in a burst; no dirty state means no repeated candidate construction. |
| Queue pressure | Capacity minus one/exactly capacity/over capacity; many tiny and zero-byte events; normal producers suspend and later resume FIFO; active bytes stay charged; oversize source encoding never creates a controller-owned oversize allocation; reset flag applied once; no hidden queue of suspended producer coroutines. |
| Replay deadlock | Fill both prebaseline byte and command-slot bounds before baseline arrives; also begin attach while a normal producer is already suspended. Overflow/attach/close wakeups still make progress; gated recovery does not block the shared collector indefinitely; queue-to-gate transfer does not double-charge or prematurely release bytes. |
| Reconciliation | Single replay versus randomly chunked ingestion yields equivalent retained text, IDs where meaningful, cursor, styling, modes and final accepted offset; duplicate/partial-overlap/gap/lower/empty reset/truncated replay; no fabricated continuity after recovery beyond server history. |
| Parser continuity | Splits inside UTF-8 scalar, combining/non-BMP/wide text, CSI/OSC and ANSI color sequences; residual state spans parse slices but authoritative reset clears it; replay and queued-live drain never emit CPR/DA replies. |
| Lifecycle | Reset/resize/clear between chunks, old/new incarnation, failed/superseded attach, immediate input before queued fence runs, profile switch, active session switch, detach/reattach, close while producer waits/worker parses/Main commit is queued, repeated close, callbacks after retirement. |
| Input/control ordering | Application-cursor/bracketed-paste mode changes followed by immediate input use worker-current modes even before a display frame; delayed readiness/input callbacks cannot bypass a newer Main attach/privacy/inactive fence. Older same-incarnation replay after recovery follows actual protocol reconciliation, not guessed local attempt IDs. |
| Worker failures | Parser failure retains last confirmed processed offset and fences input; cancellation rethrows; disposed candidates/replies never escape; accepted byte reservations are released exactly once even when admission/send is cancelled. |
| Rendering/reading | Main/alternate-screen transitions, TUI redraw, bounded 2,000-line history, resize reflow, row-ID anchored reading during continuous append, eviction clamp, follow resume, accessory keys and IME geometry. Feeding 50,000 lines does not mean retaining all 50,000. |
| UI isolation | Stall the worker deliberately: blink, snapshot read/search, key-mode lookup and close return without acquiring its lock; Main controller maps and privacy/selection callbacks remain Main-confined. Both screen integrations exercise actual VT surfaces. |

Use deterministic `runTest`/shared test scheduler for cadence and race assertions. Use real controller/parser/grid/surface objects for correctness; only scheduler/transport boundaries are controlled. Disable blink for replay-versus-chunk equality checks. Do not assert random row IDs match across independent surfaces; compare text/styles/state and row-identity invariants instead.

## Verification commands — implementation owner only

Run from repository root on Windows PowerShell, after all implementation edits land. These commands are prescribed, **not executed by this planning assignment**.

```powershell
# Required parent-plan terminal regression gate
.\native-app\gradlew.bat -p native-app :shared:jvmTest --tests 'dev.damhopper.nativeapp.features.terminal.*'

# Cross-package API/ownership regression gate
.\native-app\gradlew.bat -p native-app :shared:jvmTest :androidApp:testDebugUnitTest

# Required Android compilation/package gate
.\native-app\gradlew.bat -p native-app :androidApp:assembleDebug
```

POSIX equivalent: replace `.\native-app\gradlew.bat` with `./native-app/gradlew`; keep `-p native-app` and task arguments. Record exact command, test counts, failures and artifact paths. A filtered test pass is not proof the full shared/Android tests pass.

### Physical device / emulator ANR qualification

```powershell
adb devices -l
.\native-app\gradlew.bat -p native-app :androidApp:installDebug
adb shell dumpsys gfxinfo dev.damhopper.nativeapp.debug reset

# After exercising the burst/interaction scenarios below:
adb shell dumpsys gfxinfo dev.damhopper.nativeapp.debug framestats
adb shell dumpsys dropbox --print data_app_anr
adb logcat -d -v threadtime
```

- Use an authorized disposable remote terminal fixture. Reattach to a 300–500 KiB buffer, then stream at least 500 KiB / 50,000 short lines as thousands of chunks, plus ANSI full-screen/alternate-screen redraws. Include sustained streaming long enough to exercise several frame intervals and repeated user interactions.
- During load, drag/read scrollback, return to bottom, open/close IME, tap accessory keys and switch sessions. Confirm final prompt on pause, preserved reading anchors and no hidden-terminal input leakage. Test both the active project flow and the retained Workbench renderer through its existing integration/journey coverage; do not mount a new product navigation path merely for qualification.
- Capture device model/API/ABI, app build, fixture size/chunk count, run interval, actual publication count/latency and a Main-thread CPU/Perfetto trace. Trace must show parser/grid/snapshot construction off Main, no row-by-row snapshot-list mutation or UI wait on worker lock, and bounded pending bytes. Test-only counters/hooks are enough; do not add permanent terminal-content telemetry.
- Compare ANR timestamps/process identity to the exercised run; historical DropBox entries alone neither prove failure nor prove remediation. `gfxinfo` statistics alone do not prove touch responsiveness or correct FIFO bytes.
- Capture synthetic fixture diagnostics only; logs/traces may contain unrelated private data and must remain local/redacted. Do not clear user diagnostic buffers or change security settings as part of qualification.
- If no authorized attached target exists, report `BLOCKED_PENDING_DEVICE`; unit/build success must not be promoted to physical ANR qualification.

## Success criteria

- One immutable display reference replaces element-by-element Compose list mutation; normal output never parses/builds rows on Main.
- Dedicated FIFO ingestion obeys 4 MiB raw-payload accounting and bounded command count. Normal streaming has no lost/duplicated/reordered bytes; gated overflow keeps the explicitly approved existing reattach behavior.
- Continuous output produces coalesced nominal 30 FPS snapshots; idle trailing output appears without another packet. Main never waits on the worker lock.
- Stable row IDs, styled-row reuse, blink revision semantics, UTF-8/replay correctness, resize, alternate screen, input/privacy fences and generation isolation all remain covered.
- Both screens use the shared worker/snapshot implementation, affected tests/callers are migrated, obsolete paths removed, and docs describe actual behavior.
- Required terminal tests and Android debug build pass; broader tests and physical interaction/ANR evidence are reported separately and honestly. No claim of unconditional lossless recovery from a finite server tail.

## Risks and security considerations

- **Replay-progress cycle:** backpressure alone cannot solve prebaseline storage exhaustion when the baseline is later on the same transport. Preserve explicit gated-overflow recovery and test this exact ordering.
- **Thread confinement:** moving existing controller methods wholesale onto Default can call UI lambdas or mutate Compose maps off Main. Split worker-owned processing from captured Main effects; review every callback.
- **False 33 ms guarantee:** cooperative coroutines are not real time. Bounded slices/deadline checks prevent avoidable starvation; physical trace establishes actual latency.
- **Async migration:** synchronous unit assertions and attach offsets can silently become stale. Migrate to explicit ordered processing/publication barriers, not sleeps or dual execution modes.
- **Mutable publication:** Kotlin `List` alone does not make backing storage immutable. Treat all published rows/cursor/mode metadata as frozen; never expose worker cells or mutable buffers.
- **Scope creep:** no server changes, new rendering dependency, global transport rewrite, retry framework, unrelated adapter removal or new navigation reachability. No raw terminal content, commands, credentials or private paths in logs; bound diagnostics and preserve connection/privacy fences.

## Handoff and unresolved questions

Implementation owner starts at task 1; verification runs only after integration. Parent owns architecture/documentation edits outside this phase file.

**Unresolved questions:** no remaining product-scope decision; parent resolved normal streaming as strict lossless FIFO with existing gated-attachment overflow/reattach recovery preserved. Implementation prerequisites remain explicit: establish cancellation-safe byte/slot/control progress, incremental source ownership, ordered mode-dependent input and same-incarnation response handling before marking relevant tasks complete. Unconditional lossless recovery under arbitrary overload would require separately approved protocol/storage guarantees and is not claimed here.
