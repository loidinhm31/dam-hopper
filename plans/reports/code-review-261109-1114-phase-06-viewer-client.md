# Phase 06 viewer-client code review

## Score: 3/10 — changes not ready for Phase 07

Reviewed all 13 requested files, approximately 4,582 lines, against `plans/261108-0237-host-browser-cdp-streaming/phase-06-viewer-client.md` and `architecture-contracts.md` (§§1, 4–8). Also inspected backend wire consumers and frontend ownership conventions. Findings below are source-backed; runtime reproductions were not exercised by this reviewer. No production code or plan/task state modified.

## Critical issues

1. **C1 — owner/target/socket fences missing; reattachment can draw the old owner's frame.** `stream-controller.ts:134-168,239-256,319-346`; `browser-host-client.ts:48-57,423-481`. Attachment credentials carry neither owner nor target/incarnation/profile identity. Incoming frames are only structurally validated; no expected session/process/profile/producer/viewport comparison occurs. `attach()` closes sockets but does not invalidate the active decode or old pending frame. Completion checks only disposed/privacy/decodeEpoch, not originating socket/subscription/current owner. Concrete race: start M1 decode, attach M2 while it is pending, resolve M1 before M2 decodes: M1 still paints. A queued M1 message and old control callback can also affect the replacement (`185-194`). **Correction:** immutable owner+target+admitted socket binding; invalidate on rebind, reject old callbacks before geometry/decode, and compare full binding plus authoritative producer/viewport immediately before draw. Keep dispositions on captured origin. **Confidence: high.**

2. **C2 — hidden/privacy lifecycle can restore stale pixels and retains the old subscription.** `stream-controller.ts:456-550`. Hidden only sends pause; it neither closes the pair nor invalidates active decode. Decode does not check visibility, so a late frame still draws. Becoming visible labels the old socket streaming instead of requiring a fresh pair. Privacy clears pixels but retains lastCachedBitmap/lastDrawnRect; after privacy is disabled, `redrawCachedFrame()` can restore pre-privacy/pre-reset/pre-rebind content without validating its owner or current geometry. **Correction:** synchronously fence decode/cache/input, detach hidden/privacy pairs, resume through fresh tickets/subscription/control, and redraw only an explicitly current validated cache. **Confidence: high.**

3. **C3 — held input and queued commands can cross target/lease boundaries.** `input-controller.ts:25-35,79-84,302-433`. Getters resolve ambient current identity/socket. Pending commands capture message identity but flush through whatever socket is current; releases rebuild identity from the replacement target. No binding-change reset exists, and inputSeq continues across a fresh lease (whose server sequence restarts). Held keys store only code, so Shift/ShiftLeft is released as key:'ShiftLeft', not original key:'Shift'. Concrete races: enqueue move on A, switch socket to B before microtask; or hold Shift on A, switch target, releaseAllHeldInput(): sends to B and clears A's local state without reliable release. **Correction:** capture original binding/socket and original key+code; release or terminate A before replacing it, discard old pending work, reset sequence for a genuinely new admitted lease, and make failed reliable release unavailable rather than silently successful. **Confidence: high.**

## Warnings

- **W1 / High — unsafe geometry may still drive input.** `input-controller.ts:110-160,332-343,381-392`; `stream-controller.ts:23-32,255-256,441-450`. No inputTrusted/inputAvailable gate or comparison between drawnRect.viewportEpoch and current viewportEpoch. An old displayed frame can produce coordinates tagged with a newer epoch, bypassing server stale-epoch rejection. Geometry callback runs on receipt, before that frame is displayed. Add an explicit fail-closed input eligibility gate based on presented authoritative geometry/epoch, and reject nonfinite coordinates rather than manufacturing an epoch fallback of 1.

- **W2 / High — frozen u64 wire contract violated.** `browser-host-types.ts:115-135,182-205,350-358`; `browser-host-client.ts:423-428`; `input-controller.ts:332-343,381-392`. Epochs/inputSeq are numbers or number|string and viewportEpoch is coerced through Number. Values above 2^53 lose authority precision; inputSeq has no u64 exhaustion handling. Architecture requires canonical positive decimal strings. Existing backend also accepts numeric counters (`server/src/browser_host/input.rs:105-115`, REST request DTOs in `server/src/api/browser_host.rs`), so this needs coordinated backend wire correction, not a client-only string change. Input envelope also lacks the contract's top-level kind:'input'; current backend happens to accept that different shape.

- **W3 / High — text commit paths are not mutually exclusive.** `text-input-proxy.tsx:48-90,94-138`; `input-controller.ts:241-299`. beforeinput can send text without preventDefault or a consumed marker, then input sends the resulting textarea value again. compositionend separately sends text without suppressing a trailing final commit. Blur/controller replacement does not clear composition state, allowing a late IME result to commit against a replacement controller. Android deletion inputTypes with null data are ignored. Ctrl/Meta+V keydown is prevented as a remote key, suppressing the browser's normal paste path. Use one explicit commit state machine with composition/final-input deduplication, deletion semantics, cancellation fencing, and browser clipboard-shortcut handling. Add realistic complete event-sequence tests, not compositionend-only tests.

- **W4 / High — outbound limits and failure teardown absent.** `input-controller.ts:22,302-401`; `stream-controller.ts:206-233`. MAX_QUEUE_RECORDS is unused; no bufferedAmount checks, byte cap, congestion policy, or lease termination on send failure. Microtask coalescing normally flushes between separate pointer tasks, so it does not bound high-frequency pointer traffic; the server disconnects above 100 messages/s (`server/src/browser_host/media.rs:872-881`). Saturated sockets may retain unbounded buffered input and releases are not guaranteed. Enforce bounded sends with barrier-preserving coalescing and fail-closed teardown.

- **W5 / High — success is reported without a successful decode/draw.** `stream-controller.ts:296-305,326-354,398-439`. Missing createImageBitmap manufactures a fake ImageBitmap. drawImage errors are swallowed, yet frameAck and present metrics still emit; a null context or zero-sized canvas likewise returns without drawing but is ACKed. Remove production test fallbacks; report unsupported decoder/draw failure and use a correct discard or connection teardown. Keep bitmap ownership in guaranteed cleanup, including exceptional callbacks/draw paths.

- **W6 / High — REST boundary not fully owner-fenced or schema-validated.** `browser-host-client.ts:64-82,108-146`. Owner is checked after fetch headers but not after awaiting body consumption, so a delayed body may deliver after generation invalidation. Responses are unchecked casts; unsupported protocol does not become an actionable unavailable state. Actual capabilities route returns unavailableReason/effectiveLimits/engineQualified (`server/src/api/browser_host.rs:270-275`, `server/src/browser_host/config.rs:527-537`), whereas UI expects reason/effectiveBounds/engineQualification. Completed reset returns newProfileEpoch (`server/src/api/browser_host.rs:1102-1117`), whereas UI requires profileEpoch. Reconcile actual wire DTOs and validate them, recheck after body awaits, and require the owner snapshot rather than ambient URL fallback.

- **W7 / Medium — parser not as strict as contract.** `frame-protocol.ts:149-159,349-361`. JSON.parse silently accepts duplicate required keys; fractional captureTimeUnixMs is accepted because Number.isInteger is not checked. `stream-controller.ts:244-252` only reports malformed/version-mismatched frames and leaves the subscription alive without disposition or explicit fail-closed state. Reject duplicate required keys and fractional timestamps; close an unusable protocol subscription with actionable incompatible state. Add raw-envelope negative tests rather than only pack/unpack roundtrips.

- **W8 / High — touch/text bounds and required controls incomplete.** `input-controller.ts:140-239,289-299`; `canvas-view.tsx:92-100`; `browser-host-client.ts:356-388`. No explicit pointer capture/lost-capture handling or touch drag-to-scroll semantics; touch events become mouse events and touch-none disables native scrolling. Wheel ignores deltaMode and falls back to old coordinates for outside-image events. Text is sliced by UTF-16 code units, not the 4096 UTF-8-byte cap (Vietnamese/Japanese/emoji can exceed it; surrogate pairs can split). Find/copy are unchecked REST wrappers; selection DTOs and reset-status client method are absent despite phase requirements. Implement scoped gesture/cancel behavior and exact bounds; exercise explicit copy/find boundaries. Upstream prerequisite is also incomplete: find always returns zero matches (`server/src/api/browser_host.rs:963-971`); selected-text cache is only populated with an empty string in production (set_selected_text callsite search). Do not claim functioning copy/find from mocked replies.

- **W9 / High — acceptance harness misses the defective paths.** `stream-controller.test.ts:238-298`; decoder browser test `201-298`; input browser test `127-403`. Decoder rebind is tested only after privacy already invalidated the decode, not direct rebind/owner change or hidden during decode. Input browser harness supplies a handwritten DrawnRect, never mounts the real stream controller, and does not exercise full beforeinput/input sequences, trusted input, queue pressure, owner/lease changes, touch scroll/cancel, actual keyboard modifiers, or copy/find. The API CRUD test returns one mock DTO regardless of request body, hiding real schema mismatch. Add the named phase acceptances without requiring full SPA/physical Android (those remain later-phase gates).

## Suggestions / positive observations

- Keep the existing separation between API, framing, stream, canvas placement, and input; no worker/framework is justified yet.
- Useful foundations: byte/prefix/header/JPEG-SOF checks, BigInt decimal parser for media headers, one active decode plus one replaceable pending frame, originating-socket frame disposition, synchronous privacy blackening, memory-only tickets, no target deletion on view disposal, no iframe fallback.
- Parse each incoming frame once: stream controller currently repeats JSON/SOF validation at receipt and decode (`246,291`). Retain its bounded payload view with the header.
- Move createMockJpeg out of frame-protocol.test.ts; importing that file from stream-controller.test.ts registers the parser suite a second time. Restore stubbed globals in deterministic afterEach cleanup and reset harness controller/proxy references between cases.
- Do not add abstractions merely to meet file-length preferences. Prioritize an explicit immutable binding and small lifecycle/commit state machines; split only genuinely separate concerns.

## Reviewed files

- packages/ui/src/api/browser-host-types.ts
- packages/ui/src/api/browser-host-client.ts
- packages/ui/src/api/browser-host-client.test.ts
- packages/ui/src/browser-host/frame-protocol.ts
- packages/ui/src/browser-host/frame-protocol.test.ts
- packages/ui/src/browser-host/stream-controller.ts
- packages/ui/src/browser-host/canvas-view.tsx
- packages/ui/src/browser-host/stream-controller.test.ts
- packages/ui/browser-tests/host-browser-decoder.browser.tsx
- packages/ui/src/browser-host/input-controller.ts
- packages/ui/src/browser-host/text-input-proxy.tsx
- packages/ui/src/browser-host/input-controller.test.ts
- packages/ui/browser-tests/host-browser-input.browser.tsx

Supporting evidence: phase plan/contracts/execution-ownership; README; docs/code-standards.md and project-overview-pdr.md; ownership/connections/server-config/auth-client; UI package/tsconfig/browser-test config; server browser-host input/media/session/config and REST handlers.

## Validation commands / results

- Executed `git diff --stat && git status --short`: exit 0; all scoped additions untracked, therefore no tracked diff to review. Inspected their actual current contents.
- Static read/search review completed for all requested files and listed supporting contracts. No measured type/test coverage percentage or lint count available.
- Build/tests/lint **not run by this reviewer**: shared execution contract reserves coherent checks to integration owner or expressly permitted tester; avoided duplicating EvcTester. No pass claim.
- Required integration commands/results remain unobserved here:
  - `pnpm --filter @dam-hopper/ui build`
  - `pnpm --filter @dam-hopper/ui exec vitest run src/api/browser-host-client.test.ts src/browser-host/frame-protocol.test.ts src/browser-host/stream-controller.test.ts src/browser-host/input-controller.test.ts`
  - `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/host-browser-decoder.browser.tsx browser-tests/host-browser-input.browser.tsx`
  - Scoped ESLint on the 13 reviewed paths.

## Acceptance disposition

All three Phase 06 task acceptances remain technically incomplete: transport lacks identity/wire fences; rendering lacks direct-rebind/hidden/cache fences; input lacks reliable binding lifecycle and complete IME/touch/copy/find proof. Plan/task state intentionally untouched per assignment. Full OS wiring and physical Android remain later-phase gates, not findings against this phase.

## Unresolved questions

- Which coordinated backend/client change will reconcile frozen decimal-string counters and actual capability/reset wire DTOs? Backend changes are outside this review's writable scope; escalated to Main.
- Where is real native copy/find prerequisite implementation/evidence? Current inspected production routes/cache do not establish it; escalated to Main.
- Integration build, unit/browser suite, and lint results were not available to this reviewer; no runtime acceptance inferred.
