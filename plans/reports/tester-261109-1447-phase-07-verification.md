# Phase 07 Test Execution Report: Root Browser Lifecycle & Iframe Path Retirement

## 1. Request & Authority
- **Operation:** `run` (code validation, Chromium browser component execution, package build & typecheck)
- **Scope:** Phase 07: Integrate root Browser lifecycle and retire iframe path.
- **Targets Executed:**
  1. TypeScript compilation:
     - `pnpm --filter @dam-hopper/ui build`
     - `pnpm --filter @dam-hopper/ui test:e2e:typecheck`
  2. Phase 07 Unit Test Suites:
     - `pnpm --filter @dam-hopper/ui test src/os/resource-registry.test.ts src/os/deep-links.test.ts src/os/persistence.test.ts src/os/recipes/recipe-source-context.test.ts src/os/recipes/recipe-engine.test.ts src/os/recipes/schema.test.ts src/os/window-ops.test.ts`
  3. Phase 07 Chromium Browser Component Tests:
     - `pnpm --filter @dam-hopper/ui test:browser browser-tests/os-lifecycle.browser.tsx browser-tests/os-input-isolation.browser.tsx browser-tests/host-browser-lifecycle.browser.tsx`
  4. Regression Verification:
     - `pnpm --filter @dam-hopper/ui test src/api/browser-host-client.test.ts src/browser-host/frame-protocol.test.ts src/browser-host/stream-controller.test.ts src/browser-host/input-controller.test.ts`
- **Authority:** Read-only test execution and reporting (`run`). No code, test, or CI modifications performed.
- **Loaded Policies:** `test-principles.md`, `code-validation.md`.
- **Environment:** Linux 7.2.15-200.fc44.x86_64, Node.js v24.16.0, pnpm 10.28.2, Vitest 4.1.5, Playwright Chromium headless.

---

## 2. Risk Map & Selection
- **Targeted Behavior:**
  - **Root KeepAlive & Lifecycle Management:** Root-owned `BrowserStreamKeepAliveHost` preserving background streaming/DOM state across window minimize, float/tile transitions, maximize, and desktop switching without re-initiating WebSockets or losing canvas state.
  - **Browser App & Presentation Modes:** `BrowserApp` handling viewer-local presentation claims, capabilities error banners, view-only mode vs control mode, and graceful degradation on unsupported capabilities.
  - **Sanitization & Security Invariants:** Persistence and recipe models stripping live session authority, tokens, and credentials while retaining URLs and non-secret logical session references.
  - **Window Close Policy:** Explicit captured window close destroying backend server sessions while keeping unmount/hide/desktop moves non-destructive. Sibling/shared viewers remain isolated and preserved.
  - **Input Isolation & Cognito Privacy:** Synchronous canvas clearing, pointer/input event suppression, chord masking, and focus protection during Cognito privacy mode.
  - **Regression Safety:** Frame protocol BHJF framing, decimal sequence parsing, aspect-fit coordinate projection, pointer move coalescing, and client staleness fail-fast mechanisms.

---

## 3. Execution Summary

| # | Check / Command | Exit | Duration | Passed | Failed | Skipped | Status |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| 1a | `pnpm --filter @dam-hopper/ui build` | 0 | 8.84s | 1 | 0 | 0 | **PASS** |
| 1b | `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | 0 | 1.25s | 1 | 0 | 0 | **PASS** |
| 2 | `pnpm --filter @dam-hopper/ui test src/os/resource-registry.test.ts src/os/deep-links.test.ts src/os/persistence.test.ts src/os/recipes/recipe-source-context.test.ts src/os/recipes/recipe-engine.test.ts src/os/recipes/schema.test.ts src/os/window-ops.test.ts` | 0 | 0.66s | 124 | 0 | 0 | **PASS** |
| 3 | `pnpm --filter @dam-hopper/ui test:browser browser-tests/os-lifecycle.browser.tsx browser-tests/os-input-isolation.browser.tsx browser-tests/host-browser-lifecycle.browser.tsx` | 0 | 10.39s | 22 | 0 | 0 | **PASS** |
| 4 | `pnpm --filter @dam-hopper/ui test src/api/browser-host-client.test.ts src/browser-host/frame-protocol.test.ts src/browser-host/stream-controller.test.ts src/browser-host/input-controller.test.ts` | 0 | 0.56s | 60 | 0 | 0 | **PASS** |
| **Total** | **All Verification Targets** | **0** | **21.70s** | **208 checks (206 tests + 2 typechecks)** | **0** | **0** | **PASS** |

---

## 4. Per-Target Breakdown & Evidence

### Target 1: TypeScript Compilation (2 passed, 0 failed, 0 skipped)
- `tsc -p tsconfig.json` (`@dam-hopper/ui build`): Exit 0, 0 errors.
- `tsc -p tsconfig.e2e.json` (`@dam-hopper/ui test:e2e:typecheck`): Exit 0, 0 errors.

### Target 2: Phase 07 Unit Test Suites (124 passed, 0 failed, 0 skipped — 657ms)
- `src/os/recipes/recipe-source-context.test.ts` (20 passed):
  - Window collection from split panes and floating list without duplicates.
  - Fleet utility classification (recipes, system-monitor, settings, agent-hub).
  - Profile name disambiguation and worktree grouping without false contexts.
  - Candidate projection, desktop default matching, and empty state diagnostics.
- `src/os/recipes/schema.test.ts` (8 passed):
  - Well-formed RecipeV1 validation.
  - Rejection of invalid version, non-object, and duplicate step keys.
  - Reference integrity enforcement across layout and stepKey.
  - Schema rejection of forbidden env/credential fields and unknown OsAppIds.
  - Portable JSON export/import inertness and malformed JSON rejection.
- `src/os/resource-registry.test.ts` (5 passed):
  - Deterministic claim key formatting with optional qualifiers.
  - Exclusive claim gating and conflict rejection.
  - Claim release, window cleanup, and reactive subscriber notifications.
- `src/os/recipes/recipe-engine.test.ts` (11 passed):
  - Profile/project candidate filtering with excluded window reasoning.
  - Topology pruning: collapse single-child splits, renormalize pane sizes.
  - Build recipe from desktop subset with worktree path propagation.
  - Launch preflight: cross-desktop move consent and Web Lock concurrency.
  - Profile alignment enforcement between apiClient and target launch.
- `src/os/deep-links.test.ts` (22 passed):
  - Fail-closed security for missing/unknown profiles and unprojected apps.
  - Parsing of project-scoped, editor (file+line), and terminal focus intents.
  - Session-changes owner tuple and generation validation.
  - Action-only triggers preventing ambient command execution.
  - Legacy route translations (`/workspace`, `/terminals`, `/devices`, etc.) and removal flags (`/usage`, `/ssh-forwarding`).
  - Approved 60/40 project desktop layout template generation.
- `src/os/persistence.test.ts` (19 passed):
  - Session loading, saving, and roundtrip serialization.
  - State sanitization: allowlisted view fields only; stripping of credentials, runtimeIdentity, and review tuples.
  - Exactly-one-placement validation across desktop tree and float lists.
  - Autosave suspension on corrupt state preserving raw bytes.
  - Dock pins 4-namespace envelope export/import with exception handling.
- `src/os/window-ops.test.ts` (39 passed):
  - Clean OS session defaults, tiled/floating placement, focus management.
  - Sibling pane preservation on window close or float switch.
  - Viewport bounds clamping and 8-way float resizing.
  - Window cascade positioning and small viewport header accessibility.
  - Atomic maximize/unmaximize transitions.
  - Cross-desktop moves, un-minimizing, and revealWindow/presentWindowAsFloat single subscriber notifications.

### Target 3: Phase 07 Chromium Browser Component Tests (22 passed, 0 failed, 0 skipped — 10.39s)
- `browser-tests/os-lifecycle.browser.tsx` (13 passed):
  - Mounts OsShell with root bar and default desktop (99ms).
  - Launches terminals window, claims resource slot, verifies frame controls (213ms).
  - Rejects duplicate resource claims and renders focus-existing button (152ms).
  - Renders pane tabs for multi-window tiled pane and toggles tiled maximize (87ms).
  - Adds and switches desktops (36ms).
  - Preserves live preview streamed canvas and DOM state across tile, float, maximize, minimize, and desktop switches (176ms).
  - Isolates input and suppresses stream during Cognito privacy mode (65ms).
  - Displays actionable unsupported reason banner when browser capability is disabled (61ms).
  - Allows two windows to view the same target without resource exclusion (72ms).
  - Preserves live terminal and editor resource instances across tile, float, maximize, minimize, and desktop moves (665ms).
  - Handles keyboard shortcut focus cycling via Ctrl+Alt+Escape (123ms).
  - Toggles window mode on titlebar double-click and suppresses on drag threshold (97ms).
  - Atomically unmaximizes and switches mode on titlebar double-click when maximized (90ms).
- `browser-tests/host-browser-lifecycle.browser.tsx` (3 passed):
  - Explicit close of one target leaves sibling target live (174ms).
  - Closing one viewer of a shared target preserves the other viewer (135ms).
  - Desktop switch and unmount does not destroy session or target (67ms).
- `browser-tests/os-input-isolation.browser.tsx` (6 passed):
  - Blocks all physical keyboard inputs when Cognito privacy mode is active (65ms).
  - Redacts notification entries immediately when Cognito is activated (73ms).
  - Passes through IME composition and AltGr events without chord interference (43ms).
  - DOM keydown listeners suppress command palette trigger when Cognito privacy mode is active (51ms).
  - DOM listener suppresses focus cycling when modal is active (74ms).
  - Isolates browser canvas pointer and input events during Cognito privacy mode (67ms).

### Target 4: Regression Verification (60 passed, 0 failed, 0 skipped — 559ms)
- `src/browser-host/frame-protocol.test.ts` (16 passed):
  - JPEG SOF0 parsing, SOI validation, truncated header detection.
  - Canonical decimal sequence parsing and sign/whitespace rejection.
  - Geometry validation and non-finite / out-of-bounds rejection.
  - BHJF frame packing/unpacking roundtrip, magic, version, UUID, and pixel limit checks.
- `src/browser-host/input-controller.test.ts` (15 passed):
  - Modifier bitmasks and mouse button mappings.
  - Aspect-fit letterbox geometry mapping to `[0.0, 1.0]` and border rejection.
  - Lease token change resets sequence and releases held keys/buttons.
  - Pointer event sequencing and coalescing with barrier event flush.
  - Text insertion routing (special keys via keydown/keyup, printable chars via proxy).
- `src/browser-host/stream-controller.test.ts` (21 passed):
  - WebSocket attachment, open state handling, heartbeat.
  - 1 active decode + 1 pending frame queuing policy.
  - Synchronous canvas clear and late-decode fencing on privacy activation.
  - Visibility/pause handling and clean disposal.
- `src/api/browser-host-client.test.ts` (8 passed):
  - Fast-fail on disconnected/stale connection.
  - Authenticated capabilities fetching with `no-store` headers.
  - Error translation to `BrowserHostClientError`.
  - Session CRUD, navigation, control lease, dialog, find endpoints.
  - Atomic viewer ticket minting with profile/generation change invalidation.

---

## 5. Disposition & Findings
- **Result:** **PASS**. All 208 verification checks (206 test cases + 2 typecheck passes across 14 test files) passed cleanly with 0 failures, 0 skipped tests, and 0 compiler errors.
- **Unresolved Questions:** None.
