# Phase 01 — Integrated Android terminal remediation

## Overview

- **Priority:** P1. **Status:** completed.
- **Parent/design authority:** [plan.md](./plan.md), especially Design and contracts, actor ownership, and acceptance gates.
- **Architecture:** [terminal lifetime and planned remediation](../../docs/architecture/android-native-client.md#terminal-lifetime).
- **Deliverable:** one integrated repair of row rendering/cache, bounded main-buffer resize, demonstrated VT commands, attach/replay reconciliation, and active-screen reading/follow behavior. Keep Kotlin/Compose engine and existing wire protocol.
- **Planning validation:** targeted current-source/callsite inspection only. No source implementation, build, test, lint, formatter, device run, or performance measurement performed for this phase document. Prior debugger probes are diagnostic baseline, not fix evidence.
- No server/web/Tauri edits, terminal replacement, PTY restart, automatic input replay, speculative IME workaround, or static source-wiring tests.

## Source feasibility and integration contracts

Paths below are repository-relative. Source line references describe the inspected baseline; implementations can move them.

| Concern | Current evidence | Required implementation consequence |
|---|---|---|
| Cursor/cache | `features/terminal/VtTerminalSurface.kt:39–45,91–95` rebuilds all rows and increments revision on blink. `VtTerminalEngine.kt:543–550` omits cursor coordinates when hidden; `VtTerminalGrid.kt:330–345` uses those coordinates to decide row count. | Keep render extent based on actual cursor/content, independent of blink/DECTCEM visibility. Cache base styled rows; blink changes only cursor presentation. |
| Row identities | Grid screen/history contain cell arrays, not identity/version/wrap metadata (`VtTerminalGrid.kt:24–25,187–200`). | Internal row metadata required. `VtTerminalSurface.lineIds: List<Long>` is feasible without changing `NativeTerminalSurface` or repository APIs. |
| Resize | `VtTerminalGrid.kt:244–263` copies only top-left intersection; engine resizes both grids. | Replace truncation with bounded main-buffer retention/reflow and cursor mapping; alternate remains isolated without history. |
| VT commands | Grid already has `isAutoWrap`, but engine private mode dispatch omits 7; CSI dispatch omits P (`VtTerminalEngine.kt:273–420`). | Wire DECAWM and DCH into existing parser/grid, not a second parser. |
| Replay | `TerminalSessionController.kt:243–252` feeds replay unconditionally and assigns its offset, unlike reconciled live output at 159–193. | Reconcile same-incarnation deltas with the existing end-offset helper. Preserve reset authority. |
| Attach entry | `requestReattach()` already resets gate before callback (`TerminalSessionController.kt:351–354`); `TerminalReplayGate.resetForAttach()` clears queued chunks (`106–113`). | New `beginAttach(): ULong` is synchronous, non-suspending, preserves surface/accepted offset, closes gate, returns captured offset. Exactly one invocation per attempt. |
| Active bypass | `ProjectTerminalScreen.kt:564–598` fetches REST buffer and feeds surface directly before WebSocket attach. | Remove this prefill branch and its fetch-only diagnostics; keep the repository buffer API unless otherwise unused work is explicitly handed off. |
| UI geometry/follow | `ProjectTerminalScreen.kt:1094–1125,1233–1265` uses one unkeyed list state, revision-driven unconditional scrolling, index keys, hardcoded dp glyph metrics, and wrapping Text. | Session-scoped state, stable row keys, user-controlled following, actual displayed font metrics, exactly one visual row per terminal row. |
| Retained shell | `WorkbenchScreen.kt:552–556` constructs controllers without a surface; its `TerminalPanelScreen` is not the active VT renderer. | Migrate retained attachment callers, but do not mount that shell or retrofit its terminal presentation in this remediation. |

`features/terminal/*` paths in this table are under `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`; UI paths are under its `ui/screens/`.

### Confirmed contract clarification — no signature change

Parent accepted: **beginAttach exactly once per attempt**.

1. Ordinary active/retained UI attachment: capture owner/controller/session, invoke `beginAttach()` synchronously before launch/dispatcher switch/connect/send; send captured offset with `takeIf { it > 0uL }`.
2. Controller recovery from gap/lag/overflow/new incarnation: `requestReattach()` invokes `beginAttach()` and passes its captured result to existing `onRequestReattach(sessionId, fromOffset)` callback. Callback sends that value; it must not call `beginAttach()` again or read a later `lastSeenOffset`.
3. Serialize/coalesce pending attachment sends per controller so repeated refresh/selection/recovery cannot overlap requests. This is request ordering only: no new timeout/retry policy, protocol field, input replay, or background reconnect service.
4. Gate remains closed if send/connect fails, is cancelled, or target ownership is no longer valid. Never call `markReplayCompleted()` to recover an attach exception. Existing explicit restart behavior is separate; preserve its intended tests/fences.
5. `ServerMsg.TermBuffer` (`core/transport/ServerMsg.kt:33–40`) has id/data/end offset/reset/truncated/incarnation, **no attachment-attempt ID**. Same-incarnation reset is authoritative, including a lower offset. Do not infer stale reset provenance from offset or invent perfect cross-attempt reset rejection. Reject stale deltas/older incarnations; serialize requests within this wire limitation.
6. Server contract is already explicit (`server/src/pty/buffer.rs:71–120`): null offset gives reset snapshot; out-of-retained-range/future offset and UTF-8 continuation-boundary requests can also give reset. Truncation is metadata, not permission to append across a gap. Server orders replay/live per socket (`server/src/api/ws.rs:827–845`), but client collectors and bytes sent before attach still require reconciliation.

### Publication and identity rules

- `lines` remains observable `AnnotatedString` rows; `lineIds` aligns one-for-one at every observable publication. Publish both coherently; no intermediate mismatched key/content counts. `updateRevision` tracks content/geometry publications, never blink.
- Carry row identity with row data through scrolling into history, not its index or current text. Two identical rows still have distinct IDs. IDs cannot collide between main/alternate buffers, reset generations, or disposed/recreated surface namespaces used by a UI key.
- Erase/mutation can preserve the row's identity while invalidating its styled cache. A newly inserted row gets a new ID. Restoring main buffer restores its retained row identities, not alternate IDs.
- Width reflow can split/merge physical rows: retain the originating identity on the leading surviving fragment, allocate IDs for new fragments, retire merged-away IDs. Do not promise impossible one-to-many preservation of every physical row ID. UI anchor falls back deterministically if its fragment was merged/evicted; ordinary output and height-only resize must preserve surviving IDs.
- No extra public cursor DTO is required: preserve `updateCursorBlink(Boolean)` and render cursor presentation through cached row variants/local overlay as appropriate. If using annotated variants, padding/render extent must be identical blink-on/off; only old/new cursor rows change presentation. No full-history style rebuilding or full list replacement for a blink.

## Actor ownership and runnable work

**Implementation wave: spawn TerminalCore, ReplayCore, TerminalUi together; wait for all three terminal results; then synthesize.** They write behavioral regressions but run no checks mid-flight. Parent owns integration and explicit handoffs, never concurrent source editing in another actor's files.

### A. TerminalCore — engine/grid/surface

**Modify, exclusive:**

- `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/VtTerminalGrid.kt`
- `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/VtTerminalEngine.kt`
- `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/VtTerminalSurface.kt`
- `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/VtTerminalCell.kt` only if cell/style handling requires it.
- `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/VtTerminalEngineTest.kt`.

**Create only if needed:** narrow terminal row/reflow helper; focused `VtTerminalGridTest.kt` / `VtTerminalSurfaceTest.kt` in the same JVM test directory. No alternate engine or generic cache framework.

**Safe internal sequence:**

1. Add row identity, content version/dirty marker, significant-cell extent, and soft-wrap-versus-hard-break metadata. Centralize mutation invalidation. Move row storage/metadata together into bounded history; do not copy whole history for each render.
2. Cache unchanging `AnnotatedString` rows. Invalidate on printable writes (including styled spaces/wide placeholders), erases, DCH, insert/delete lines, scroll-region shifts, reset, resize/reflow, alternate clear/switch, and any style mutation of stored cells. Cursor-only movement changes cursor presentation, not cached history. Remove unused obsolete rendering paths when callers are migrated; preserve existing public contracts still used by tests/UI.
3. Separate cursor presentation from content geometry/revision. Compute trim extent from grid state including cursor row even when blink is off or `?25l` hides cursor. Blank cursor cells occupy a stable cell footprint. Existing cursor rendering test may change only to reflect this intentional contract, not weaken its position assertion.
4. Rework main-buffer resize using retained cell/logical-line state, not rendered strings/raw replay. Join only soft-wrapped continuations; preserve explicit newlines, styled/trailing significant spaces, wide-cell pairs, and text to the right of the cursor. Reflow retained main history too, so old-width rows do not acquire Compose soft wrapping. Keep current and saved cursor mapped to logical content; preserve deferred-wrap semantics at the right edge. Reset margins coherently to new dimensions, matching the current resize convention.
5. Height shrink/grow must preserve displaced meaningful text within the existing bound and restore its logical ordering/cursor anchor. Important case: cursor is above nonblank lower rows. A history-only top-row shift is insufficient; bounded retained main backing must account for below-viewport displacement too. Do not drop those rows or later resurrect erased content from a stale resize copy. Count all retained off-viewport data against the existing retention policy; no unlimited shadow/raw buffer. On ordinary bottom-anchored output, displaced top rows become history and height growth pulls eligible retained rows back.
6. Treat erase/overwrite/reset as authoritative over retained logical content, including content displaced by resize. Width growth never recovers characters erased after shrinking. Reset clears reflow metadata/history and restores DECAWM defaults. Alternate buffer may crop to its geometry but never spills to main history or revives discarded alternate content.
7. Implement `CSI ?7h/l` and `CSI P`: DCH omitted/zero count means one, large count clamps to remaining columns, cursor stays put, right side becomes blank; preserve moved cell styles. Repair wide pairs intersecting deletion/overwrite boundaries so no orphan width-0 placeholder or duplicated lead survives. DECAWM-off writes overwrite the right edge rather than advancing rows/history; reset restores wrapping for both buffers.
8. Publish `lineIds` and cached `lines` coherently on feed/resize/clear/close. Keep positive dimensions consistent between surface and engine. Send TerminalUi the precise observable behavior of the fixed APIs; do not require UI to inspect mutable grid internals.

**Acceptance:** regression groups C1–C6 below; no source/test execution in actor report. Report any irreconcilable retention/cursor case rather than silently reducing resize preservation.

### B. ReplayCore — controller/gate

**Modify, exclusive:**

- `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalSessionController.kt`
- `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalReplayGate.kt`
- `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalSessionControllerTest.kt`
- `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalSessionControllerLoggingTest.kt`
- `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalReplayGateTest.kt`

**Create if needed:** `TerminalReplayRenderingTest.kt` in that JVM test directory, exercising the real controller plus real VT surface/engine. Existing recording test surfaces may remain for legacy assertions; new end-to-end rendering regressions must not replace the production parser with a fake.

**Safe internal sequence:**

1. Implement exact `beginAttach(): ULong` contract; use it in controller recovery. Preserve accepted offset and rendered text for ordinary reattach. Preserve active replay-write accounting across gate resets.
2. Treat offsets consistently as **UTF-8 end byte offsets**. For non-reset same-incarnation replay use `reconcileTerminalOutput(data, replayEnd, lastSeenOffset)`: Discard leaves offset/text unchanged; Render feeds only unseen suffix and advances accepted offset; Gap leaves text/offset unchanged and requests reattach from captured accepted offset with gate still closed. Empty up-to-date delta is a successful baseline and may drain; empty future/gapped delta is not permission to skip bytes.
3. Reset snapshot bypasses delta dedup and resets parser/grid even if empty, truncated, or its end offset is lower. Set authoritative snapshot offset; reconcile queued same-incarnation live chunks against it. Preserve `isTruncated` information. Do not treat `truncated=true` alone as proof a non-reset gap is safe.
4. Older incarnation replay/live cannot mutate text/offset/readiness. New incarnation cannot append to old grid or reuse its byte offset/parser residual. Reestablish the new baseline from zero/reset; if a newer-incarnation delta arrives without an authoritative baseline, remain gated and request the baseline rather than mix incarnations. Clear/filter queues by incarnation.
5. Drain accepted queued chunks in arrival order with overlap/gap reconciliation, while **outbound input/protocol replies remain fenced until the entire drain succeeds**. Current `drainQueuedChunksAfterReplay()` marks ready before iteration; do not merely retain that ordering. Use an internal reconcile/apply path while readiness is closed, rather than reopening the public live path just to drain. Gap/overflow/new attach during drain must not reopen readiness in a `finally` block.
6. Historical feeds stay `isLiveStream=false`; restore feed mode safely on exceptions. No historical CPR/DA response, synthetic echo, or queued user input. Queued live replay-drain queries cannot leak while gated. Genuinely live queries after ready retain existing behavior. Keep privacy/panel/owner fences and bounded queue limits (1,024 chunks / 4 MiB by default).
7. Communicate callback semantics/serialization needs to TerminalUi. Avoid changing callback signature or adding wire-attempt IDs. Do not broaden recovery into an automatic retry subsystem.

**Acceptance:** R1–R8 below. Any logger assertions inspect metadata/fences, never log terminal payload for proof.

### C. TerminalUi — callers and active presentation

**Modify, exclusive:**

- `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt`
- `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt`

**Create only if needed:** a narrow terminal presentation/follow/geometry helper and behavioral JVM tests (`TerminalPresentationPolicyTest.kt` under the terminal JVM test directory). Keep testable policy free of Android classes. No dependency/UI-test-framework expansion is required for pure policy coverage; actual Compose behavior still needs device smoke.

**Safe internal sequence:**

1. Capture current repository/`ConnectionRef`, controller identity, session/incarnation, active-session epoch and attempt token before asynchronous work; recheck after suspension and immediately before sending. Never resolve an attach against a later ambient repository. Install listeners before first attach. Serialize/coalesce attach sends without inventing response provenance.
2. Ordinary attach calls `beginAttach()` before coroutine dispatch/connect/send and uses its captured offset (zero maps to null). Controller recovery callback already received its captured offset: do not reset again. Preserve cancellation propagation and report existing failure state; attach-send success does not mean replay completed.
3. Remove active REST buffer prefill/direct `feedOutput`. The controller is the only active replay publisher. No fallback that writes bypass data if WebSocket attach is slow/fails.
4. Migrate this complete baseline callsite inventory, not only the active effect:

   | Location | Attach reason |
   |---|---|
   | `ProjectTerminalScreen.kt:392–417` | Controller recovery callback |
   | `ProjectTerminalScreen.kt:543–644` | Initial/selection/refresh attachment effect |
   | `WorkbenchScreen.kt:563–566` | Controller recovery callback |
   | `WorkbenchScreen.kt:575–585` | First available session after refresh |
   | `WorkbenchScreen.kt:1036–1042` | Tab selection |
   | `WorkbenchScreen.kt:1044–1062` | Created session |
   | `WorkbenchScreen.kt:1081–1095` | Fallback session after removal |
   | `WorkbenchScreen.kt:1184–1190,1226–1232` | Both agent-to-session jump paths |

   Resolve lag callback through retained shell's composite controller key, not raw session ID (`WorkbenchScreen.kt:546–547` versus 627–628), because this path must reach the newly fenced recovery. Do not refactor unrelated panel behavior.
5. Key list state/follow flag by owner + session + controller incarnation/lifetime. Switching A→B cannot reuse A's anchor; switching back to a retained A restores A. Disposal drops only local state, never remote PTY. Use `lineIds` for VT row keys, qualified by surface/session lifetime; do not use text/hash/index identity.
6. Track explicit follow intent from user scrolling and the **pre-publication** bottom state. Do not evaluate `canScrollForward` only after appending rows: the new content itself would incorrectly turn following off. Distinguish user gesture away from bottom from programmatic follow/layout changes. User drag disables follow immediately; returning to bottom reenables. Initial ready output defaults to following. Blink has no scroll trigger.
7. While paused, preserve first visible retained row ID and intra-row pixel offset across appended output/history index shifts. If bounded eviction removes that row, clamp to the earliest surviving row, keep follow off; do not jump to newest. Handle reset/alternate/reflow anchor retirement deterministically without reusing stale keys. At bottom, content/geometry updates reveal the latest row only while follow remains enabled. Do not scroll on cursor blink.
8. Measure glyph advance/line height with the exact shared `TextStyle`, monospace family, density and font scale used to draw rows. Subtract actual content padding, use measured line box height including relevant font metrics, floor available pixels to whole cells; minimum one positive row/column, not minimum 40 columns/10 rows that exceeds small/IME layouts. Retain defensible upper bounds, not a second wrapping system. Recompute on text style/density/font-scale/viewport changes, resize only for changed geometry.
9. Draw one line per terminal row (`softWrap=false`, one-line constraint/clip behavior); handle blank rows with the same measured height. Cursor presentation cannot insert a second wrapped line. Test measured-width calculations as pure behavior; validate font fallback/wide glyph placement on device rather than assert universal font compatibility.

**Acceptance:** U1–U5 plus all attach inventory paths. Do not edit `TerminalScreens.kt` or platform IME adapter merely to make the retained shell resemble the active screen.

## Behavioral regression matrix

All new checks execute behavior on real implementation objects. No regex/source/import/AST wiring assertions, snapshot of implementation text, or assertions that merely check an API name exists.

### Core rows, resize, and VT — TerminalCore

| ID | Fixture/action | Exact assertions |
|---|---|---|
| C1 | Surface 8×5; write `A`, position cursor on otherwise blank row 3; blink on/off/on; repeat with `?25l/h`. | Row count, row IDs, content revision stable for blink; cursor on/off has same cell/row footprint; no scroll intent. Cursor position/visibility remains correct. |
| C2 | Populate styled history and active rows; capture row object references and spans; blink repeatedly; change one active row; move cursor; erase/scroll/insert/delete/reset/alternate. | Unchanged cached history `AnnotatedString` references reused; changed rows acquire correct text/spans; old/new cursor row variants only. Unique aligned IDs persist into history and bounded eviction; reset/alt IDs never collide. Reuse assertion is behavioral cache evidence, not an FPS/allocation claim. |
| C3 | Main 8×4 with numbered lines; shrink height to 2, grow to 4; cursor at bottom, then cursor above nonblank lower rows; repeat with history and no history. | Retained ordered text and logical cursor survive; grow restores eligible displaced rows; no duplicated lines. History/offscreen retention stays bounded; oldest eviction is deterministic. |
| C4 | Width 8→4→8 with soft-wrapped text, explicit CRLF, significant styled spaces, `中`/supplementary wide glyph, text beyond cursor, pending right-edge wrap, saved cursor; combined width/height changes. | No character loss/duplication within bound, hard breaks stay hard, styles survive, cursor/saved cursor map coherently, no orphan wide placeholder. Old-width history is reflowed. Include 1-column edge without crash/duplicate glyph; document the single-cell wide-glyph fallback. |
| C5 | Shrink, then erase affected row/display or overwrite retained right-side text; grow; RIS/reset. Enter alt, resize/produce output, leave alt. | Erased/replaced text never returns; authoritative reset empties old history/backing; main and alt never leak rows/styles/IDs. Same-size resize is a no-op; nonpositive caller geometry is handled consistently before publication. |
| C6 | 4-column `?7l` + `ABCDE`; reenable `?7h`, write enough to wrap; reset defaults. DCH `ABCDE`, cursor column 2, `CSI P`, `CSI 0P`, `CSI 2P`, oversized count; wide lead/trailer boundaries; split CSI feeds. | Wrap-off yields right-edge overwrite (`ABCE`) without extra history/row; wrap-on resumes coherent behavior. DCH-one yields `ACDE` plus trailing blank, two yields `ADE` plus blanks; cursor fixed, styles move, row invalidated, no stale suffix/wide half. |

### Replay/controller — ReplayCore

| ID | Fixture/action | Exact assertions |
|---|---|---|
| R1 | Real surface: reset `OLD` at end 3, live `NEW` at end 6; ordinary reattach delta `NEW` end 6; then another live suffix. Also baseline OLD3 → beginAttach → queued NEW6 → replay NEW6. | Display is `OLDNEW` exactly once before suffix; accepted offset never falls back for delta; queued duplicate discarded. `beginAttach()` returns captured offset and preserves old text. |
| R2 | Duplicate and stale same-incarnation deltas, partial-overlap delta (`ABCDEF` end 6, current 3), empty delta at current offset. | Only unseen bytes append (`DEF`); duplicate/stale leaves text/offset unchanged; empty current baseline opens only after successful drain. |
| R3 | Accepted end 3; delta with start 5/end 7, or empty future offset; queued live gap partway through drain. | Missing bytes never skipped; accepted offset/render stays at last contiguous bytes; recovery captures that offset, ready stays false, later queued chunks not blindly applied. |
| R4 | Reset snapshot lower than current, reset empty at offset 0, reset/truncated nonzero retained tail; queued live overlap with snapshot. | Reset clears old parser/grid and takes authoritative end (rollback allowed here), preserves truncation flag, applies subsequent unseen queue suffix once. Non-reset truncated gap does not bypass gap handling. |
| R5 | Old-incarnation live/replay; newer live before baseline; newer reset; newer non-reset delta without baseline. | Old messages change nothing; no cross-incarnation parser/text/offset mixing; new baseline starts independently, old queue discarded, no premature input/reply permission. |
| R6 | Input and CPR/DA during beginAttach, historical feeds, multiple queued chunks/drain; then actual live query after ready. Split UTF-8 and CSI across feed chunks. | No sink bytes while replay/drain gated; no historical response/automatic input replay/local echo; correct live reply afterward; UTF-8 overlap uses bytes, no duplicate/replacement scalar on valid fixture. Observe public readiness from callbacks during drain, not only final state. |
| R7 | Queue at count/byte limits; overflow; reset during active replay write; drain triggering another attach. | Existing bounds enforced; overflow uses captured offset; active-write protection survives reset; failed/superseded drain cannot reopen new gate. |
| R8 | Recovery callback plus UI-style captured offset send, attachment failure/cancellation, repeated pending attach requests. | Single gate reset per actual attempt, no second-reset queue loss; no reading mutable offset at deferred send; no input readiness on send exception. Serialized/coalesced scheduling does not send duplicate overlapping attach requests or infer wire-attempt identity. |

### Presentation policy and actual UI — TerminalUi / Verification

| ID | Behavior | Proof |
|---|---|---|
| U1 | Following at bottom → append; user scroll away → append/blink; return to bottom → append. | Pure policy regression keeps prior follow intent; actual Compose smoke confirms row visibility/gesture behavior. No scroll operation for blink. |
| U2 | Paused first-row ID + pixel offset; append enough output to shift indexes, then evict anchor. | Policy returns retained ID/offset or earliest survivor, never newest; actual list stays anchored while row survives. |
| U3 | Switch A→B→A, different owner with same session ID, new incarnation/reset/alternate. | No state/key collision; retained A restores independent reading position; retired anchors have deterministic fallback. |
| U4 | Known content pixel size, measured glyph advance/line box; small viewport; changed density/font scale; IME shrink/grow. | Whole-cell geometry fits content area, dimensions ≥1, no duplicate unchanged resize; device displays one row per engine row with correct right edge. |
| U5 | Each attach inventory path; ordinary/recovery failures; owner/session changes during suspension. | Behavioral capture of sent target/offset and readiness; actual active root never prefills twice, restores history once, rejects input against uncertain baseline. Retained shell migration does not imply its current-root reachability. |

## Safe integration and verification sequence

1. **Parent contract gate:** distribute parent plan + this phase, exact file ownership/APIs and accepted beginAttach clarification. No implementation actor runs build/test/lint/formatter. Each reports changed files, behavior covered by added tests, API deviations, risks, and `VALIDATION: NOT RUN`.
2. **Parallel implementation wave:** all three actors complete before dependent integration. Parent inspects their terminal reports and contract/callsite compatibility; explicit owner handoff for any correction. No shared-file patching while owner still active.
3. **Single integrated verification owner:** once sources/tests settle, Verification performs one targeted JVM pass and Android debug assembly. No three independent Gradle runs. Stop on real failures, report exact diagnostics; parent sends correction to owning actor, then reruns only affected checks after integration. Never weaken an acceptance case to get green.
4. **Production-class smoke:** include `TerminalReplayRenderingTest` (or equivalent real-controller/real-surface cases in existing tests) in the targeted JVM pass. Exercise OLD/NEW overlap, queued replay, gap/reset, blink row/cache stability and resize on the same object chain. This is a real-class smoke, not a fake parser or standalone substitute implementation. Record commands, failing case names, actual results and external blockers.
5. **Device gate if reachable:** perform actual active-root journey below; otherwise mark Android visual/IME/performance gate `BLOCKED_PENDING_DEVICE`. JVM success/assembly does not substitute for this gate. Do not run old phase structural shell scripts as remediation acceptance.
6. **Review:** one reviewer per cycle after verification; inspect mutation invalidation, retained-width/height semantics, worst-case retained memory, wide-cell repair, follow races, controller serialization and owner/input/reply fencing. Resolve correctness findings under handoff; rerun affected checks only.
7. **Documentation handoff:** docs actor updates `native-app/README.md` and relevant `docs/architecture/android-native-client.md` / `docs/android-native-acceptance.md` after implementation evidence. Parent already owns planned architecture notes: hand off before edits. Distinguish implemented behavior, exercised JVM/Android evidence, and blocked device gate; no FPS/IME-echo claim without measurement/reproduction. No commit/push.

### Commands for Verification actor — not executed by planner

From repository root, Windows PowerShell; use existing wrapper and available supported JDK/SDK configuration:

```powershell
.\native-app\gradlew.bat -p native-app :shared:jvmTest --tests "dev.damhopper.nativeapp.features.terminal.*"
.\native-app\gradlew.bat -p native-app :androidApp:assembleDebug
```

All newly added focused helper/real-class regressions should be in the matching terminal JVM test package so this filter exercises them. Existing test dependencies include kotlin.test/coroutines-test; do not add a UI dependency only to assert source wiring. Collect Gradle's test report and assembly result; record toolchain/network/SDK dependency failures separately from test failures. If unrelated global test coverage is requested by parent, run it only as an explicitly added gate, not concurrently with implementation.

If device is available and authorized for install/smoke:

```powershell
adb devices -l
.\native-app\gradlew.bat -p native-app :androidApp:installDebug
# Only for the approved loopback development backend on host port 4803:
adb reverse tcp:4803 tcp:4803
```

Do not start an unauthenticated LAN server. Use existing authenticated HTTPS setup, or approved loopback development mode through reverse forwarding. Never include bearer tokens/terminal content in diagnostic exports.

### Integrated device smoke journey

- Record device/emulator, Android version, app/build, keyboard/IME, font scale, density and viewport/orientation. Start through **Profile Login → Project List → Project Terminal**, not an unmounted panel preview.
- Use a disposable remote terminal with harmless numbered/styled ASCII and wide-glyph output. Observe rightmost cells, explicit newlines and a cursor on a blank lower row. Wait through several blinks: no disappearing rows, height changes or jumps.
- Accumulate beyond a viewport, scroll to a known retained row, continue producing numbered output and blinking. Same row/pixel anchor remains. Continue to bounded eviction: predictable oldest-survivor clamp, never auto-bottom. Return to bottom; subsequent output follows.
- Switch between two sessions with different reading positions, return, and change project/profile; verify independent state and no misdirected input. Back out/return: remote PTY remains alive, authoritative replay rendered once; a disposed local controller legitimately requests a fresh baseline.
- Open/close IME and rotate/narrow/widen viewport. Main text on bottom/right survives shrink/grow within bound, erased text does not return, cursor follows its logical anchor. Check small viewport and increased font scale; no Compose-created second wraps, clipped cursor row or falsified minimum grid exceeding available space.
- In a harmless terminal fixture, exercise DECAWM toggle and DCH with colored ASCII/wide cells, then an available full-screen TUI enter/exit. Main content restores; alt output never becomes main history. Record any application/font limitation rather than claiming full xterm compatibility.
- Reattach with output occurring near attach, then a controlled transport interruption using the same server-owned PTY. Confirm no repeated numbered suffix, no historical CPR/DA echo and no input accepted before replay/drain completes. Do not replay a failed command automatically. Synthetic ordering variants are covered by real-class JVM regressions; do not claim a transport race was observed unless it actually was.
- Record observed scroll/IME/render results. Performance qualification requires actual profiler/device measurements and named workload; absence of obvious flicker is not a measured FPS or allocation result. Exact previously reported IME echo remains unproven unless reproduced on the named keyboard/application.

## Acceptance checklist

- [x] Three implementation actors return complete reports; every named caller migrated; no bypass REST surface feed remains in active flow.
- [x] `lineIds`/`lines` coherent, unique/stable where rows survive; unchanged styled history reused; blink preserves extent and content revision.
- [x] Main width/height resize preserves bounded displaced text and logical cursor; hard/soft wraps and wide pairs correct; erase/reset/alternate remain authoritative.
- [x] DECAWM/DCH regressions cover defaults, zero/oversized deletion, styles, wide boundaries and split sequences.
- [x] Delta stale/overlap/gap, authoritative reset/truncation, incarnation transition, queue overflow and input/query drain fencing pass on real classes.
- [x] User scroll-follow behavior and session-scoped anchor tests pass; measured geometry/no-second-wrap confirmed through actual UI evidence or explicitly left device-blocked.
- [x] One integrated targeted JVM pass and Android assembly have recorded observed outcomes; no static wiring test counted as behavioral proof.
- [ ] Review correctness findings resolved; docs reflect implemented behavior and actual evidence without claiming device/performance gates passed from JVM results.

## Risks and mitigations

- **Resize is the highest-risk slice:** current arrays contain no logical-line metadata. Cursor above nonblank lower content, soft-wrap boundaries, styled spaces and resize-followed-by-erase must be explicitly represented/tested; a larger cached rectangle is not a coherent preservation implementation.
- **Publication/follow races:** independent row/key mutation or post-append bottom detection can break keys or disable follow. Publish coherent data and test pre-update follow intent plus eviction.
- **Queue-drain readiness:** current public live path requires ready status; an early ready toggle leaks input/replies. Separate internal drain application from outbound readiness; test callbacks during drain and gaps mid-drain.
- **Exactly-once attach entry:** double-reset drops queued data. Ordinary UI entry and controller-triggered callback are different call paths; use the accepted clarification, captured offsets and ordering-only coalescing.
- **Wire limitation:** no attach-attempt correlation field. Legitimate same-incarnation reset stays authoritative, even if its offset decreases. Do not promise arbitrary late-reset provenance checks without a separately approved protocol change.
- **Unicode/font limits:** existing width classification is not full grapheme/xterm conformance. Repair wide-cell integrity for covered operations; report unsupported rendering separately. Do not expand this fix into a Unicode engine replacement.
- **Qualification:** no attached device in preceding investigation, current availability unmeasured here. Build/JVM evidence cannot settle IME echo, real-font row width, FPS or touch anchoring.

## Unresolved questions

- No blocking API-signature correction found. Parent accepted the attach-ownership/wire clarification above; no product decision is needed to start these slices.
- Which real device/IME/font-scale/application reproduces the user's exact echo/visual issue, and is that testbed reachable for final smoke? Device-specific qualification remains open until observed; it does not authorize speculative IME changes.
