# Phase 06 Test Execution Report: Cycle 3 Verification

## 1. Request & Authority
- **Operation:** `run` (code validation, Chromium browser component execution, package build & typecheck)
- **Scope:** Phase 06 viewer-client (`phase-06-viewer-client`) Cycle 3 verification following critical fixes (C1/C2/C3 owner/socket fences, privacy lifecycle, input queue/lease bounds).
- **Targets Executed:**
  1. Unit tests:
     `pnpm --filter @dam-hopper/ui test src/api/browser-host-client.test.ts src/browser-host/frame-protocol.test.ts src/browser-host/stream-controller.test.ts src/browser-host/input-controller.test.ts`
  2. Browser component tests in Chromium:
     `pnpm --filter @dam-hopper/ui test:browser browser-tests/host-browser-decoder.browser.tsx browser-tests/host-browser-input.browser.tsx`
  3. UI build & E2E typecheck:
     `pnpm --filter @dam-hopper/ui build`
     `pnpm --filter @dam-hopper/ui test:e2e:typecheck`
- **Authority:** Read-only test execution and reporting (`run`). No code, test, or CI modifications performed.
- **Loaded Policies:** `test-principles.md`, `code-validation.md`.
- **Environment:** Linux 7.2.15-200.fc44.x86_64, Node.js v24.16.0, pnpm 10.4.1, Vitest 4.1.5, Playwright Chromium headless.

---

## 2. Risk Map & Selection
- **Targeted Behavior:**
  - **Frame Protocol & Stream Controller:** BHJF framing, binary unpack/pack, JPEG SOF0 parsing, decimal string sequence validation, geometry bounds validation, one-active-decode + one-pending-frame queuing, canvas clearing and decode fencing on privacy, connection teardown and cleanup.
  - **Input Controller:** Coordinate mapping within letterbox geometry, rejection of out-of-bounds/untrusted geometry or stale viewport epochs, lease token tracking and held input release on token change, microtask pointer move coalescing and barrier flush, special key handling vs text proxy delegation.
  - **Browser Host Client:** Disconnection and staleness fail-fast, capabilities fetching, API error translation, session CRUD, atomic ticket minting with invalidation on profile/generation shift.
  - **Chromium Component Integration:** Real canvas rendering and BHJF frame decoding with capture subscription ACK, canvas blackening and stale-decode fencing on privacy activation followed by fresh socket rebind, pointer events and letterbox rejection, Vietnamese and Japanese IME composition deduplication, plain-text paste sanitization, and focus/blur release of held keys.
  - **Compilation & Type Safety:** Clean TypeScript compilation for `@dam-hopper/ui` library source (`tsconfig.json`) and E2E test harness (`tsconfig.e2e.json`).

---

## 3. Execution Summary

| # | Check / Command | Exit | Duration | Passed | Failed | Skipped | Status |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | `pnpm --filter @dam-hopper/ui test src/api/browser-host-client.test.ts src/browser-host/frame-protocol.test.ts src/browser-host/stream-controller.test.ts src/browser-host/input-controller.test.ts` | 0 | 0.56s | 60 | 0 | 0 | **PASS** |
| 2 | `pnpm --filter @dam-hopper/ui test:browser browser-tests/host-browser-decoder.browser.tsx browser-tests/host-browser-input.browser.tsx` | 0 | 1.39s | 8 | 0 | 0 | **PASS** |
| 3a | `pnpm --filter @dam-hopper/ui build` | 0 | 8.67s | 1 | 0 | 0 | **PASS** |
| 3b | `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | 0 | 1.23s | 1 | 0 | 0 | **PASS** |
| **Total** | **All Verification Targets** | **0** | **11.85s** | **70 checks (68 tests + 2 typechecks)** | **0** | **0** | **PASS** |

---

## 4. Per-Target Breakdown & Evidence

### Target 1: Unit Tests (60 passed, 0 failed, 0 skipped — 563ms)
- `src/browser-host/frame-protocol.test.ts` (16 passed):
  - `parseJpegDimensions`: valid JPEG SOF0 width/height, non-SOI rejection, truncated JPEG rejection.
  - `validateDecimalSequence`: canonical decimal strings accepted, zero/leading zero/signs/whitespace rejected.
  - `validateGeometry`: valid bounds accepted, non-finite values rejected, out-of-bounds width/height/scale/offsets rejected.
  - `packBhjfFrame` / `unpackBhjfFrame`: round-trip encoding, invalid magic rejection, unsupported version/flags rejection, packet length mismatch rejection, SOF dimension mismatch rejection, non-canonical UUID rejection, pixel ceiling violation rejection.
- `src/browser-host/input-controller.test.ts` (15 passed):
  - Modifier bitmasks and mouse button mappings.
  - Letterbox aspect-fit geometry mapping to `[0.0, 1.0]`, rejection of border coordinates, rejection of untrusted input geometry or stale `viewportEpoch`.
  - Lease token change resets sequence and releases held keys/buttons.
  - Pointer events sequence incrementation and border rejection.
  - Pointer move coalescing with barrier event flush.
  - Keyboard and text insertion routing (special keys via keydown/keyup, printable characters via proxy, insertText).
  - Clean held-input release on `releaseAllHeldInput`.
- `src/browser-host/stream-controller.test.ts` (21 passed):
  - Binary frame parsing and validation rules.
  - WebSocket attachment, open state handling, heartbeat.
  - Queuing: 1 active decode + 1 pending frame, discarding intermediate frames.
  - Privacy activation: synchronous canvas clear and late-decode fencing.
  - Pause and visibility state handling.
  - Resource cleanup on dispose.
- `src/api/browser-host-client.test.ts` (8 passed):
  - Fast-fail on disconnected/stale connection.
  - Mid-request staleness detection.
  - Authenticated capabilities fetching with `no-store` headers.
  - Error translation to `BrowserHostClientError`.
  - Session CRUD and navigation endpoints.
  - Control lease, dialog, find, and selected-text endpoints.
  - Atomic ticket minting with subprotocol verification and profile/generation change rejection.

### Target 2: Browser Component Tests in Chromium (8 passed, 0 failed, 0 skipped — 1.39s)
- `browser-tests/host-browser-decoder.browser.tsx` (2 passed):
  - `mounts real canvas, decodes BHJF frame, and ACKs captured subscription` (69ms): Real Chromium canvas mount, WebGL/2D context, BHJF unpacking, image decode, and WebSocket ACK verified.
  - `clears black canvas on privacy, blocks late old-socket decode, and rebinds fresh socket` (66ms): Synchronous black canvas clearing on privacy mode, late decode fencing against old socket frames, and re-binding with fresh ticket/socket.
- `browser-tests/host-browser-input.browser.tsx` (6 passed):
  - `mounts harness, shifts focus to proxy on pointerDown, and sends pointer events` (8ms).
  - `rejects pointerDown in letterbox margin without emitting messages` (2ms).
  - `handles Vietnamese IME composition without duplicate keydown commits` (2ms).
  - `handles Japanese IME composition` (1ms).
  - `handles plain text paste without HTML or binary` (2ms).
  - `releases held input on blur without stuck keys or buttons` (1ms).

### Target 3: UI Package Build & E2E Typecheck (2 passed, 0 failed, 0 skipped)
- `pnpm --filter @dam-hopper/ui build`: Exit code 0 (`tsc -p tsconfig.json` clean, 0 diagnostic errors).
- `pnpm --filter @dam-hopper/ui test:e2e:typecheck`: Exit code 0 (`tsc -p tsconfig.e2e.json` clean, 0 diagnostic errors).

---

## 5. Disposition & Findings
- **Result:** **PASS**. All 4 target suites executed cleanly with zero failures, zero skipped tests, and zero type errors.
- **Unresolved Questions:** None.
