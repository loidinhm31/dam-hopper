# Phase 06 viewer-client — Cycle 3 code review

## Score: 4/10 — not ready for Phase 07

Static review of all 13 assigned files against `plans/261108-0237-host-browser-cdp-streaming/architecture-contracts.md` §§1,4–8 and Phase 06 acceptance. No production/test/plan changes. Code-review skill and published development rules applied. Plan/task state intentionally untouched per assignment.

## Prior finding disposition

| Finding | Cycle 3 disposition |
|---|---|
| C1 owner/target/session identity | **Partial, still blocking.** Credentials now carry owner/target/incarnation; direct attach invalidates decode and completion checks original media socket/subscription. Current owner generation, profileEpoch, producer/viewport freshness, stale callbacks and cached pixels remain unfenced. Exact-session reconnect reconciliation absent. |
| C2 hidden detachment/fresh tickets | **Substantially corrected in source.** Hidden now invalidates decode, clears cached bitmap/geometry and closes both sockets; visible transitions to disconnected. Privacy clears cached pixels and closes pair. Fresh ticket minting generates new viewer/subscription IDs. Existing tests do not establish complete hidden-late-decode/fresh-ticket/control-pair acceptance; attach can still run while hidden/private. |
| C3 input safety | **Partial, still blocking.** Snake-case wheel fields now match Rust; UTF-8 truncation preserves character boundaries. Pointer mapping checks inputTrusted/viewportEpoch. Flush-before-release, original-binding cleanup and comprehensive stale/untrusted input gating remain incorrect. |

## Critical issues

1. **C1 — live owner/cache boundaries still permit stale private pixels.** `packages/ui/src/browser-host/stream-controller.ts:135–215,269–286,348–368,487–495`.
   - `credentials.owner` is never checked at attach, message receipt or post-decode. A profile generation retiring during decode does not invalidate it unless an external caller happens to detach.
   - Only session/incarnation are compared; profileEpoch is ignored. Old media/control callbacks remain registered; control callbacks have no originating-socket/disposed/current-owner check. Old media callbacks can publish geometry before socket validity is checked at decode completion.
   - `attach(B)` retains A's cached bitmap/DrawnRect and visible pixels. `redrawCachedFrame()` can repaint A after B is attached. No producer/viewport monotonic fence prevents an old-epoch active decode from drawing after a newer-epoch frame has arrived.
   - Ticket minting (`browser-host-client.ts:436–498`) does not reconcile the exact current server session before attachment.
   **Correction:** immutable validated binding, current-owner checks at async boundaries, exact-session reconciliation, explicit publication/epoch fences, and invalidate/blacken owner-incompatible cache before attach. Fence every old callback. **Confidence: high; source-backed, not runtime-reproduced.**

2. **C3 — release ordering and ambient identity can corrupt the lease input stream.** `packages/ui/src/browser-host/input-controller.ts:319–467`.
   - Pending move/wheel already reserves sequence N. `releaseAllHeldInput()` sends keyUp/pointerCancel with N+1 first and flushes N last: backend contiguous-sequence validation rejects/revokes rather than executing reliable releases in order.
   - Pending messages flush through `getControlSocket()` at execution time, not their originating socket. Lease-change cleanup sets the new lease/reset sequence before releasing previously held keys, so releases are addressed to the replacement lease/target. Changes to session/subscription/socket with the same token are not detected.
   - Saturation/send failure only reports an error; it drops the reserved command/release, retains the channel and can clear local held state without proven remote release.
   **Correction:** capture original full binding/socket with pending and held state; flush before releases; retire/release the original binding before installing a replacement; terminate the original input channel when reliable release cannot enqueue. Update `input-controller.test.ts:196–224`, which currently accepts release under the new sequence instead of asserting original lease/socket identity. **Confidence: high; source-backed, not runtime-reproduced.**

## Warnings

- **W1 / High — input trust fence incomplete.** `input-controller.ts:221–245,248–317,349–360,405–432`. Wheel falls back to `lastPointerCoords` when mapping rejects untrusted/stale/outside geometry, bypassing the new guard. Key/text paths have no current inputAvailable/trust/owner gate. Pending commands are not revalidated after an epoch change. `stream-controller.ts:487–494` redraws a fabricated header without inputTrusted, changing trusted geometry to undefined on resize. Reject new unsafe input centrally; preserve all cached header fields; release original held state through its separate safe teardown path.

- **W2 / High — frozen wire counters still lose precision.** `browser-host-types.ts:115–135,182–205,352–360`; `input-controller.ts:79,349–360,421–432`. Numeric profile/input epochs, number|string revisions and Number(viewportEpoch) violate canonical decimal-u64 contract. Input sequence lacks exhaustion handling; invalid viewport becomes invented epoch 1. Top-level kind:'input' is absent. Existing Rust uses numeric u64 DTOs (`server/src/browser_host/input.rs:105–115`, attachments.rs:83–90), so coordinate a backend/client contract correction rather than making an incompatible client-only change.

- **W3 / High — IME/text commit is heuristic, not exactly once.** `text-input-proxy.tsx:49–100,150–153`. compositionend commits without recording a consumed final commit; a following final input can commit again. beforeinput does not prevent default; duplicate suppression uses text equality and 100ms, which can drop legitimate rapid repeated fallback-input characters. Blur/controller replacement does not reset composition or fence late commit ownership. Null-data mobile deletion inputTypes are unhandled. Test full composition/beforeinput/input orderings and binding cancellation, not compositionend alone.

- **W4 / High — decode/draw failures can be ACKed as successful presentation.** `stream-controller.ts:325–334,348–423,429–470`. Missing decoder manufactures an ImageBitmap; drawImage failure is swallowed; null context/zero canvas returns without drawing, followed by ACK/present metric. Bitmap cleanup is not guaranteed if drawing/callbacks throw. Fail unavailable/discard on actual decode/draw failure, remove test-specific production fallback, and guarantee bitmap close on every exceptional path.

- **W5 / High — typed REST contract differs from actual server responses.** `browser-host-types.ts:40–70,202–205`; `browser-host-client.ts:156–159,166–174,420–429`. Capabilities expects reason/effectiveBounds/engineQualification, but server returns unavailableReason/effectiveLimits/engineQualified (`server/src/browser_host/config.rs:527–537`). Completed reset returns newProfileEpoch, not declared profileEpoch (`server/src/api/browser_host.rs:1102–1117`). Unchecked JSON casts mask this; no protocolVersion fail-closed compatibility state exists. Success-body owner recheck is fixed, but error-body await has no equivalent recheck (`browser-host-client.ts:127–143`). Normalize/validate the real DTO once at the boundary.

- **W6 / High — explicit copy/find/touch acceptance incomplete.** `browser-host-client.ts:369–402`; `canvas-view.tsx:92–100`; `input-controller.ts:145–245`. Copy/find are unchecked wrappers, not bounded explicit controls; selection/reset-status client methods are absent. No pointer capture/lost-capture handling or touch scroll gesture semantics; touch-none prevents browser scrolling while touch drags become mouse moves. Wheel ignores deltaMode. Backend find currently returns constant zero matches without native work (`server/src/api/browser_host.rs:925–970`), an out-of-scope prerequisite blocker, not a working copy/find proof.

- **W7 / Medium — strict parser/protocol failure handling incomplete.** `frame-protocol.ts:149–159,349–361`; `stream-controller.ts:259–267`. JSON.parse accepts duplicate required keys; fractional captureTimeUnixMs is accepted. Invalid/version-mismatched frames only report an error, keeping a subscription with undisposed credit rather than closing fail-closed with actionable compatibility status. Add raw malformed-envelope tests, not only roundtrip tests using the same packer.

- **W8 / High — transport bounds and half-pair lifecycle incomplete.** `stream-controller.ts:185–215,241–248`; `input-controller.ts:371–439`. Media controls have no bufferedAmount bound. One socket closing leaves its mate open (and media heartbeat timer until another explicit detach). Input microtask flushing does not coalesce across normal separate pointer tasks and supplies no 100/s pacing against the server limit (`media.rs:872–881`). Bound sends and close the pair on terminal transport failure; do not add a second transport framework.

- **W9 / High — passing harnesses miss the blocking cases.** `stream-controller.test.ts:242–304`; decoder browser test `209–305`; input browser test `36–76,223–306`. Privacy test resolves old decode before attaching replacement, so it does not prove late completion while replacement is active. Hidden test does not assert control closure/fresh ticket minting/late decode. Input harness mounts a handwritten DrawnRect, not the real stream controller, and omits wheel/touch-scroll/cancel, native beforeinput/input commit order, binding changes, queue pressure and explicit copy/find. No UTF-8 truncation or wheel-wire regression test exists. Correct the coverage without claiming full SPA/physical Android (later-phase gates).

## Suggestions / positive observations

- Good: memory-only ticket protocols, fresh viewer/subscription UUID generation, bounded binary lengths/geometry/JPEG SOF validation, BigInt media counter parsing, one-active/one-pending decode, captured-socket ACKs, synchronous privacy blackening, hidden socket-pair detachment, no iframe fallback or target deletion on dispose.
- Keep existing API/parser/controller/view split; no worker or transport framework justified. Prefer one immutable binding and small explicit lifecycle/commit state machines.
- Parse each frame once instead of twice (`stream-controller.ts:261,320`); retain the validated JPEG view with its header.
- Remove redundant camelCase wheel aliases once all callers use actual snake-case wire fields; current duplicate fields are a compatibility workaround, not clean cutover.
- Extract createMockJpeg from the test module: importing `frame-protocol.test.ts` registers its 16 tests again in `stream-controller.test.ts`. Restore stubbed globals and reset harness/controller references deterministically.

## Reviewed files

All requested files inspected:
- `packages/ui/src/api/browser-host-types.ts`
- `packages/ui/src/api/browser-host-client.ts`
- `packages/ui/src/api/browser-host-client.test.ts`
- `packages/ui/src/browser-host/frame-protocol.ts`
- `packages/ui/src/browser-host/frame-protocol.test.ts`
- `packages/ui/src/browser-host/stream-controller.ts`
- `packages/ui/src/browser-host/canvas-view.tsx`
- `packages/ui/src/browser-host/stream-controller.test.ts`
- `packages/ui/browser-tests/host-browser-decoder.browser.tsx`
- `packages/ui/src/browser-host/input-controller.ts`
- `packages/ui/src/browser-host/text-input-proxy.tsx`
- `packages/ui/src/browser-host/input-controller.test.ts`
- `packages/ui/browser-tests/host-browser-input.browser.tsx`

Supporting evidence: README; PDR/code standards; phase plan and architecture contracts; previous review; backend input/media/config/reset/find/selection routes; package scripts/browser configuration; Cycle 3 tester report.

## Validation commands / results

Reviewer executed only static inspection and `git diff --stat -- <scoped paths>` (exit 0, no tracked diff output). No build/test/lint reruns: tester/integration owns checks.

Existing tester evidence, **reported, not independently executed by reviewer**: `plans/reports/tester-261109-1213-phase-06-cycle-3.md:30–38,86–94`:
- `pnpm --filter @dam-hopper/ui test src/api/browser-host-client.test.ts src/browser-host/frame-protocol.test.ts src/browser-host/stream-controller.test.ts src/browser-host/input-controller.test.ts` — reported exit 0, 60 tests. Includes 16 parser tests registered twice; not 60 distinct test cases.
- `pnpm --filter @dam-hopper/ui test:browser browser-tests/host-browser-decoder.browser.tsx browser-tests/host-browser-input.browser.tsx` — reported exit 0, 8 tests.
- `pnpm --filter @dam-hopper/ui build` — reported exit 0.
- `pnpm --filter @dam-hopper/ui test:e2e:typecheck` — reported exit 0.
- Lint/coverage/performance/real backend interoperability not measured in reviewed evidence. Existing green tests do not resolve the source-backed defects above.

## Acceptance disposition

Transport and input tasks remain technically incomplete; rendering improvements do not yet establish owner/cache and full hidden/rebind acceptance. Do not advance dependent Phase 07 on these checks alone. Full OS wiring, actual physical Android and human visual proof remain properly staged later, not demanded by this review.

## Unresolved questions

1. Which owner will reconcile existing Rust numeric-counter/capability/reset responses with frozen architecture contracts? Backend edits are outside this review scope.
2. Where will actual native find/selected-text prerequisite behavior and evidence be completed before Phase 06 copy/find acceptance can be claimed?
