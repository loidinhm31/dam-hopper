# Code Review — Phase 06 input interaction defects

## Code Review Summary

### Scope
- Plan: `plans/261112-1205-browser-adaptive-stream-quality-and-performance/phase-06-input-interaction-defects.md`
- Files reviewed: `packages/ui/src/api/browser-host-types.ts`, `packages/ui/src/browser-host/{input-controller.ts,input-controller.test.ts,text-input-proxy.tsx,text-input-proxy.test.tsx,canvas-view.tsx,stream-controller.test.ts}`, `packages/ui/src/os/BrowserStreamKeepAliveHost{.tsx,.test.tsx}`, `packages/ui/browser-tests/host-browser-input.browser.tsx`, `server/src/browser_host/media.rs`, `server/tests/browser_host_input.rs` (Phase 06 tests at 2145-2407); context: `server/src/browser_host/control_input.rs:89-122`, `input.rs:1249`, `docs/architecture/host-browser-cdp-streaming.md`.
- LOC analyzed: ~1.9k changed lines (controller +465/-62, host +176, media.rs fairness hunk ~120, tests ~1k)
- Focus: Phase 06 diff. Working tree also has uncommitted upstream remediation edits in the same files (SI-03 barrier flush, prior-lease release, bufferedAmount close, paired-input lifecycle `active_input`/`admit_control_text`); excluded from scoring except where they interact.
- Updated plans: phase-06 status line, todo checkboxes, review note.

### Overall Assessment
Implementation matches the four requirements and stays scoped: no new wire kind, module, FIFO or server ceiling change. Paste admission is all-or-nothing with exact escape-aware chunking. Capture is bound to accepted downs and has idempotent completion. Wheel normalization happens before coalescing, with clamps. Fair rotation keeps cancel, deadline and pair priority. Main gaps: (1) a lone-surrogate edge case that silently drops a chunk and stalls the sequence; (2) acceptance evidence weaker than the plan's own verification rules (paste and fairness); (3) one warning-erasure ordering bug; (4) docs not reconciled. Score **7/10**.

### Critical Issues
None.

### High Priority Findings
**H1. Lone surrogate in a paste or insertText can silently drop a chunk, then a SequenceGap stalls all later input** (confidence high; server behavior is [INFERENCE] from code plus known serde_json semantics, not executed)
- `input-controller.ts:120-132` treats a lone surrogate as a sendable 6-byte JSON escape (`\udXXX`). `JSON.stringify` emits it that way.
- `serde_json::from_str::<InputMessage>` rejects lone-surrogate escapes into `String`. `control_input.rs:94-95` then silently returns `Ok(false)`. The client has already consumed that `inputSeq`, so the next record fails `input.rs:1249` with `SequenceGap`.
- Effect: the middle of the paste is lost with no feedback and following input is rejected. This violates "never truncate/silently drop".
- Fix: normalize before measuring and splitting, in both `handleInsertText` and `handlePasteText`. Use `text = text.toWellFormed?.() ?? text.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd")`. Then drop the 6-byte lone-surrogate branches (raw 3 = U+FFFD). Add a unit case.

**H2. Paste acceptance not proven end to end, as the plan requires**
- Browser test `host-browser-input.browser.tsx:534-622` builds its "remote DOM" by concatenating mock-socket `insertText`. The plan explicitly says this is not proof ("Native DOM content, not concatenated outgoing mocks alone").
- Rust real-Chromium test `browser_host_input.rs:2145-2206` uses its own Rust splitter, not the client chunker. It has no escape-heavy/control-character text, no cap+1 no-prefix case, no queued-capacity rejection and no interruption case at the native fixture.
- Unit tests cover these locally only.
- Fix: in the Rust live test, add an escape-heavy payload (`"\"\\\n\u0001"` mixes) chunked at the exact client limits (each frame ≤16384 including envelope) and assert native `value`. Optionally emit fixtures from the TS splitter (exported for tests) so both sides use the same algorithm.

### Medium Priority Improvements
**M1. Fairness test doesn't discriminate** (`browser_host_input.rs:2270-2407`)
- The end-state assertions (input eventually lands under yielding churn; update eventually seen) would very likely pass with the old update-first biased select. The churn task `yield_now()`s, so updates are not continuously ready.
- The "cancel" part closes the media socket after input has settled. That tests pair teardown, not "already-ready cancel/deadline wins over ready input".
- Plan asked for deterministic ready-branch barriers and recorded ordering.
- By inspection, `media.rs:2566-2661` is correct:
  - Update sets `prefer_input = true`; Input or WsMessage sets it to false.
  - Initial snapshot is forced.
  - cancel, deadline and pair come first in both arms.
- Suggest a unit-level harness: pre-ready watch plus pre-buffered ws frames. Assert U,I,U,I order and that cancel wins with both ready.

**M2. Paste interruption warning erased on the hidden transition** (`BrowserStreamKeepAliveHost.tsx:1148-1149`)
- `cancelPendingGesture()` → `cancelControlHandoff()` emits "Paste interrupted…" via `onError` → `setControlError(msg)`. Then `setControlError(null)` runs right after, so the last set wins and the warning is lost.
- The diff moved `setControlError(null)` above `releaseAllHeldInput()` precisely to keep these warnings, but `cancelPendingGesture()` still runs first.
- Fix: call `setControlError(null)` before `cancelPendingGesture()`. The session-identity path (1165-1166) clears intentionally (replacement owner); keep that.

**M3. Docs not reconciled** (plan "Next steps")
- `docs/architecture/host-browser-cdp-streaming.md` still has no paste cap/chunking/rejection semantics, wheel unit normalization (line ×16, page × CSS viewport, ±4096 clamp, canonical `delta_x/delta_y`), accepted-pointer capture/lost-capture, or control-select rotation.
- Lines 620/626 describe paste and input only at the pre-Phase-06 level.

### Low Priority Suggestions
- **L1. Envelope sizing uses current epoch widths** (`input-controller.ts:721-729`). This is safe today only because handoff `isCurrentGesture` fences viewport/profile epoch changes and the direct path is synchronous. Always use `MAX_U64_DECIMAL_STR` for `profileEpoch`/`viewportEpoch` in the sample envelope (≈40 B cost) so sizing stops depending on fence coupling.
- **L2. Dead state (YAGNI):**
  - `PasteBatchTracker.total` (`:190`) is never read.
  - `activeCaptureRef.gestureId` / `nextCaptureGestureIdRef` (`Host:566,571,615`) are written but never compared.
  - Splitter override params `maxRawBytes`/`maxMessageBytes` (`:80-81`) are only ever defaulted.
- **L3.** The post-split verification loop (`:738-747`) re-serializes every chunk with the full envelope after an exact splitter. It's cheap (≤7×16 KiB), so keep it as a guard or delete it; not both splitter-exactness claims and a re-check comment saying otherwise.
- **L4.** `handleInsertText` (`:661`) uses a magic `- 1024` envelope margin and routes long IME/beforeinput text to `handlePasteText`, so non-paste input reports "Paste rejected…". Derive the margin from the measured envelope and use neutral wording.
- **L5.** Inline `onPasteError`/`onPasteSuccess` arrows (`Host:2600-2605`) recreate `handlePaste` on every render. Wrap them in `useCallback`.
- **L6.** The `isSyntheticNotFound` carve-out (`Host:603-609`) is a test seam in production code. It's harmless (untrusted events can't hold real capture), but add a comment or move it behind test injection.
- **L7.** Duplicated `tokio::select!` arms (`media.rs:2566-~2620`, ~25 lines each). Extract the deadline future as a local `async` helper or a small macro to keep the arms in sync.
- **L8.** A disposed controller returns `false` silently for a non-empty paste while the proxy clears staging. Trivial, since there's no owner to report to.

### Positive Observations
- Bounded UTF-8 scan (`measureUtf8BytesUpTo`) stops early with no allocation for oversize input. The shared `TEXT_ENCODER` replaces per-call encoders.
- Atomic preflight on both paths: handoff checks records plus bytes; the live path checks the remaining 80/s budget, including the pending coalescable. No prefix is sent before a rejection.
- Paste errors are content-free (the test asserts `SECRET_` is absent). The console now logs `err.message` only. `onError` UI is gated on `isCurrentConnection`.
- Sequences are allocated at send. Per-chunk fences check lease, socket and subscription. The handoff queue keeps trailing typing behind the paste tail.
- Capture: only after `input.handlePointerDown` accepts. `completedNormally` is marked before release, and `hasPointerCapture`/canvas/pointerId checks make lost capture idempotent. Modal, privacy, visibility, unmount and handoff cancel all go through `cancelPendingGesture` → `releaseActiveCapture`. Capture failure sends `pointerCancel`.
- Wheel: deltas validated as finite and the mode known. Page mode needs an input-trusted, epoch-current `geometry.cssWidth/cssHeight` (CSS, not JPEG/DPR). Per-event and accumulated clamps. The camelCase duplicates were removed from the type and consumers.
- Fairness: minimal two-arm rotation, no new worker or queue. Initial snapshot and safety branches unchanged.

### Recommended Actions
1. H1: normalize lone surrogates to U+FFFD before measuring/splitting (both entry points) and add a unit test.
2. M2: in the visibility-hidden effect, move `setControlError(null)` before `cancelPendingGesture()`.
3. H2: extend the Rust live paste test with an escape-heavy payload at exact client frame limits, plus a native-value oracle.
4. M1: add a deterministic select-order test (pre-ready update and input; cancel ready with input ready).
5. M3: update `host-browser-cdp-streaming.md` §input with the Phase 06 contracts.
6. L1-L2: max-width epoch envelope; delete dead fields.

### Metrics
- Type coverage: strict TS; no new `any`. One `(e as { deltaMode?: unknown })` narrowing, which is justified.
- Tests (reported by Phase06Tester; not re-run by reviewer):
  - UI unit 190/190
  - UI browser (Chromium) 27/27
  - `tsc` build exit 0
  - Rust `browser_host_input` 57 + `browser_host_media` 32 passed
  - `--lib browser_host` 145/145
- Linting: not run (no lint step requested); no obvious lint issues seen.

### Validation commands/results
- Reviewer ran: `git status`, `git diff HEAD` for the Phase 06 files, and targeted greps/reads only. No builds or tests re-run, because the tester's results are the receipt.
- Tester receipt (as reported):
  - `pnpm --filter @dam-hopper/ui test` (190/190)
  - `test:browser` (27/27)
  - `build` (exit 0)
  - `cargo test --test browser_host_input --test browser_host_media` (89/89)
  - `cargo test --lib browser_host` (145/145)

### Unresolved Questions
1. Is the `isDisplayOnly()` change (null drawn rect → display-only, `input-controller.ts:467-472`) Phase 06 or upstream? It blocks keyboard and paste before the first frame. It fails closed, which looks intended, but it isn't in the Phase 06 requirements.
2. Upstream SI-03 `releaseAllHeldInput(flushPendingMove=true)` flushes a pending wheel/move on the privacy and modal transitions (`Host:873,1136`), and `flushCoalescable` doesn't check `isInputAllowed`. Is a queued wheel crossing into privacy/modal acceptable? It's outside Phase 06 ownership.
3. Native-dispatch failure after all chunks were sent locally only shows the existing `inputAvailable` status, with no paste-specific "may be incomplete" warning. Is that acceptable as the plan's "native-failure status reaches visible feedback"?
