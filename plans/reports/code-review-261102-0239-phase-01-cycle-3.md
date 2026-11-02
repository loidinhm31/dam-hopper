# Cycle 3 Code Review — Phase 01 Lifecycle Prototype

## Score: 4/10 — lifecycle gate NOT satisfied

Read all 16 requested files (~3,351 lines), relevant ownership/resource consumers, Phase 01 acceptance, PDR and coding standards. Source inspection only; no implementation or plan/task-state changes. Loaded code-review skill directly. Existing test evidence is attributed below, not presented as reviewer-executed verification.

### Previous critical issue disposition

| Issue | Disposition |
|---|---|
| C1 — functional adapters, persistent resources, dirty close | **Not resolved.** Browser now renders an iframe, but owns it in a disposable body. Editor parks an empty div with a null editor. Root terminal host receives no sessions. Dirty confirmation exists, but is global and has no save/discard workflow. |
| C2 — denied claim must not steal DOM | **Partially addressed, not resolved.** Initial denied claims block attachment, but render-phase acquisition and mount-frozen results break ownership during effect replay and identity changes. |
| C3 — duplicate tiled maximize mount | **Addressed narrowly.** Single existing frame uses fixed fullscreen styling. Browser test asserts one frame and restore. This does not prove underlying resource lifecycle preservation or split-pane fullscreen geometry. |

## Critical issues — MUST FIX

### M1 — C1: terminals/editor remain nonfunctional lifecycle adapters
- Evidence: `packages/ui/src/os/OsShell.tsx:109`; `OsResourceHost.tsx:11-18`; `apps/TerminalsApp.tsx:16-18,49-58`; `apps/EditorApp.tsx:54-75`; `MonacoKeepAliveHost.tsx:24-34`.
- Root resource host defaults `mountedSessions` to `[]`, and OsShell supplies none. TerminalsApp only tries to attach an already registered terminal, defaulting to a synthetic `${profileId}:default` ID; it neither wires the existing terminal manager nor subscribes to terminal readiness. Ordinary launch has no live terminal.
- EditorApp registers a new empty div with `editor: null`. The only production caller of `registerParkedMonaco` is this empty-container path; no MonacoHost, model, editor-store open/save or dirty tracking is connected. Parking an empty element does not preserve a usable editor or undo state.
- Correction: root-own real terminal/editor controllers and instances; connect adapters to existing owner-bound terminal/editor flows. Window bodies should attach slots and report visibility, not substitute resource placeholders. Unregister/dispose closed resources deliberately; the current ignored Monaco unregister callback also retains entries indefinitely.
- Confidence: high, direct source evidence.

### M2 — C1: BrowserApp destroys the preview on placement changes
- Evidence: `apps/BrowserApp.tsx:66-85`; `DesktopCanvas.tsx:42-55,59-94,106-119`; `OsShell.tsx:213-220`; `OsResourceHost.tsx:15-19`.
- Iframe is a React child of BrowserApp, with no root browser controller/keep-alive host. Tile/float branch changes, minimize, inactive tab selection and desktop changes unmount that body. A replacement iframe loses document/JS state; adding a real iframe did not repair lifetime ownership.
- Correction: use the existing root browser-debug controller/host with a stable iframe parent and per-window viewport/visibility attachment. Do not treat DOM reparenting of an iframe as proof that its browsing context survived; qualify document/JS identity explicitly.
- Confidence: high, lifecycle failure follows directly from render ownership; not browser-reproduced by this reviewer.

### M3 — C2: claims become stale or disappear while a resource stays attached
- Evidence: `apps/TerminalsApp.tsx:20-58`; `apps/EditorApp.tsx:26-75`; `apps/BrowserApp.tsx:18-44`.
- All adapters mutate the registry inside a `useState` initializer. Claim result never updates. On generation/resource change, the cleanup releases the old key but no acquisition occurs for the new key; the old successful boolean still authorizes attachment. A denied result cannot recover when its holder disappears.
- React StrictMode effect replay releases a successful claim during cleanup, while repeated setup only installs another cleanup and never reacquires it. Abandoned renders can leave claims with no committed owner.
- Correction: commit-scoped acquisition/release, keyed by the complete current identity, with reactive claim state. Attach only after the exact committed claim succeeds; revoke/re-evaluate on changes. Add StrictMode, identity-change and holder-release regressions.
- Confidence: high, source-derived lifecycle analysis.

### M4 — owner identity is not verified before attaching resources
- Evidence: `OsShell.tsx:24-27,216-219`; `window-context.tsx:35-47`; `apps/TerminalsApp.tsx:22-28,53-57`; supporting `lib/terminal-host-attachment.ts:23-38` and `lib/terminal-registry.ts:55-67,89-97`.
- Shell reads one non-subscribed snapshot for the currently selected profile and passes its generation to every window, including persisted windows owned by other profiles. Context combines each window's profile with this unrelated generation.
- Terminal attachment resolves an unqualified sessionId through the global registry; a raw-ID alias can resolve a terminal belonging to another profile. Registry claims include neither verified terminal incarnation nor epoch. No adapter gates the resource on connected/revalidated ownership.
- Impact: wrong-profile terminal attachment and incorrect reconnect/claim authorization are possible; fail-closed multi-profile contract is unmet.
- Correction: subscribe to each window's immutable profile runtime, resolve owner-qualified concrete resources, retain verified incarnation separately, and disable input/capabilities until owner revalidation succeeds without destroying parked DOM.
- Confidence: high for missing isolation; cross-profile interaction not executed.

### M5 — session validation accepts invalid placement, context and geometry
- Evidence: `persistence.ts:191-269,343-354`; `lib/tile-tree.ts:52-77`; `window-ops.ts:463-481`.
- Validation checks existence of referenced windows, not exactly-one-placement or agreement with `desktopId`, `mode`, `minimized` and focus. A floating window can also appear in a tile tree or another desktop; a non-minimized window can be unplaced; a pane active ID can name a window absent from its items. These candidates return `valid: true` unchanged.
- `floatBounds`/restore placement are unchecked. Optional project/worktree target types and app minimum context are unchecked. Split ratios are merely numbers. Imported data can therefore create duplicate resource-bearing bodies, inaccessible windows or inconsistent restore behavior.
- Public `dockWindowInDesktopTree` also inserts a window without reconciling floating/source-desktop membership and mode.
- Correction: validate/project a complete session before atomic replacement; enforce finite valid geometry, target types/minimum context, pane active membership, unique placement and valid focus/restore ownership. Keep those invariants in placement operations too. Add duplicate/missing placement and malformed geometry/target tests.
- Confidence: high, explicit validator branches inspected.

## Warnings — SHOULD FIX

1. **Current browser tests are shell smoke tests, not lifecycle proof.** `browser-tests/os-lifecycle.browser.tsx:56-96,98-138,140-185` checks store modes, claim records and frame count without real xterm/Monaco or settled iframe identity. No attach/replay/reset counters, reconnect/incarnation, undo, physical keyboard/paste/pointer or Cognito journey assertions. Phase 01 lines 35-38 require these separately; keep the gate open. Route integration is separately ordered work, not a reason to demand unrelated future phases here.
2. **Dirty close confirmation is not scoped to the closing editor.** `WindowFrame.tsx:100-111` checks any dirty tab across every profile/project; there is no Save/Discard/Cancel action, and an unavailable `confirm` is treated as approval. Connect the actual editor, inspect only its owned buffers, and use a fail-closed target-scoped close decision.
3. **Input precedence contract incomplete.** `input-arbiter.ts:57-82` never bypasses repeats or shortcut-capture targets. `WindowFrame.tsx:115-119` always sets `isFrameFocused: true`, including events originating in app bodies, and ignores `frame-focused-handled`. Plain iframe keyboard events do not bubble into the parent frame. Implement actual frame/app focus, capture exemptions, repeat policy and the existing preview keyboard integration; qualify the zero-PTY-byte chord end to end.
4. **Viewport updates do not reclamp existing floats.** `DesktopCanvas.tsx:26-40` calls `setViewport`, but `window-store.ts:54` only stores the new viewport. `window-ops.ts:31-44` is applied only when bounds are explicitly changed. Resizing/zooming smaller can leave a previously reachable toolbar outside the viewport. Reclamp existing floats in the same viewport transaction.
5. **Two docking algorithms remain.** Generic `lib/tile-tree.ts:188-299` parallels existing `lib/terminal-layout-docking.ts:31-210`; terminal callers still use the latter via `hooks/use-terminal-layout.ts:10-16`. Generic same-pane center docking reorders the active item, whereas terminal docking explicitly activates without reordering. Phase 01 requires common operations, not only a shared recursive renderer. Adapt terminal wire representation at the boundary and share docking logic while preserving browser reserved-pane behavior.
6. **Terminal wire validator is applied to the wrong shape.** `lib/terminal-layout-tree.ts:44-49` now passes legacy `sessionIds` nodes directly to a validator expecting `items`, rejecting valid legacy panes. Separately `lib/tile-tree.ts:326-360` converts unknown wire data before validation; `sessionIds: "ab"` becomes `["a", "b"]`, and extra children are discarded, so malformed payloads can be accepted. Validate the original versioned wire shape before converting. Retain actual v3-key fixtures and negative cases, not only generated happy-path roundtrips.

## Suggestions — NICE TO HAVE

- Preserve structural sharing in terminal adapter helpers. `terminal-layout-tree.ts:57-83,136-143` clones full trees/arrays for reads and no-op updates. Boundary conversion or accessor-based shared traversal can avoid unnecessary allocations without duplicating algorithms.
- Add a focused `focusWindow` regression asserting tab order is unchanged. The non-reordering `updateTilePane` fix at `window-ops.ts:209-218` is appropriate, but current `window-ops.test.ts` does not exercise it.

## Positive observations

Single-frame maximize is simpler and removes duplicate-mount ownership. `focusWindow` no longer uses insertion to activate a tab. Sibling-preserving removal and minimized desktop restore metadata have targeted tests. Corrupt OS bytes are preserved with autosave suspended, and app-state persistence uses an allowlist rather than dumping dirty buffers.

## Reviewed files

All requested files, complete content:
- `packages/ui/src/os/window-ops.ts`
- `packages/ui/src/os/window-ops.test.ts`
- `packages/ui/src/os/apps/TerminalsApp.tsx`
- `packages/ui/src/os/apps/EditorApp.tsx`
- `packages/ui/src/os/apps/BrowserApp.tsx`
- `packages/ui/src/os/persistence.ts`
- `packages/ui/src/os/persistence.test.ts`
- `packages/ui/src/os/input-arbiter.ts`
- `packages/ui/src/os/DesktopCanvas.tsx`
- `packages/ui/src/os/WindowFrame.tsx`
- `packages/ui/src/os/OsShell.tsx`
- `packages/ui/src/os/MonacoKeepAliveHost.tsx`
- `packages/ui/src/lib/tile-tree.ts`
- `packages/ui/src/lib/terminal-layout-tree.ts`
- `packages/ui/src/components/organisms/SplitLayout.tsx`
- `packages/ui/browser-tests/os-lifecycle.browser.tsx`

Supporting files inspected: OS resource host/store/context/registry/types/manifests; terminal host attachment, registry and layout hook/docking; tile-tree tests; relevant editor-store, EditorTabs, MonacoHost and browser keep-alive sections; embed/Cognito integration search results. Plan and task state intentionally unchanged under assigned ownership.

## Validation commands and results

No build/test/lint executed by this reviewer; validation belongs to the integration/testing owner. Read retained outputs in `plans/reports/tester-261102-0236-phase-01-cycle-3-validation.md:25-45,49-143`:

| Exact command | Recorded result |
|---|---|
| `pnpm --filter @dam-hopper/ui test src/lib/tile-tree.test.ts src/lib/terminal-layout-docking.test.ts src/components/organisms/SplitLayout.test.ts src/os` | Exit 0; 7 files, 46 tests passed |
| `pnpm --filter @dam-hopper/ui test` | Exit 0; 335 files, 3,122 tests passed |
| `pnpm --filter @dam-hopper/ui test:browser os-lifecycle.browser.tsx` | Exit 0; Chromium, 5 tests passed |
| `pnpm --filter @dam-hopper/ui build` | Exit 0; `tsc -p tsconfig.json`, 0 compiler errors |

Retained diagnostics: jsdom navigation-not-implemented errors and browser React act-environment warnings. No lint/coverage result available; no coverage percentage inferred. Passing recorded commands do not cover M1-M5 or qualify the prototype gate. Reviewer commands only: initial `git diff --stat`, scoped `git diff`, `wc -l`, and date lookup; none modifies implementation.

## Unresolved questions / evidence

No product clarification needed. Still missing: source-pinned real `/os` lifecycle/reconnect/physical-input evidence with live resources and identity/counter baselines. The retained tester report does not identify an immutable source snapshot for its runs; results are reported as recorded evidence, not a certification of later edits.
