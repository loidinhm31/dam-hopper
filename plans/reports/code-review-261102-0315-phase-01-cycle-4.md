# Cycle 4 Code Review — Phase 01: Lifecycle prototype first

## Score: 5/10 — changes required; lifecycle gate remains open

### Scope / assessment

Reviewed Cycle 3 M1–M5 and W1–W6 against current OS/layout sources, supporting production resource implementations, tests and Phase 01 acceptance. Security, resource lifetime, placement invariants, performance, KISS/DRY prioritized. Loaded published `code-review/SKILL.md` directly; read README, PDR, code standards and development rules.

Meaningful improvements: real MonacoHost now mounts; terminal panels now mount at the root; preview iframe has a stable React parent; claims acquire/release in effects and expose reactive snapshots; session placement validation substantially stronger. These changes do **not** yet establish functioning, owner-safe lifecycle adapters. Two critical defects, six high-priority warnings below.

Implementation and plan/task state unchanged; report only. Plan explicitly assigns verification to integration owner after writers join. No build/test/lint run by this reviewer. Existing tester evidence attributed separately, not represented as reviewer verification.

## Cycle 3 disposition

| Item | Cycle 4 disposition |
|---|---|
| M1 — live editor / terminal integrations | **Partial, not resolved.** Actual Monaco and TerminalPanel instantiated, but no editor tab opening/loading or terminal-manager creation/discovery subscription; default terminal ID remains invented. Monaco parking also moves a React-owned node. |
| M2 — stable browser controller/host | **Partial, not resolved.** Stable iframe parent addresses placement remounting structurally. Existing browser-debug controller/keep-alive integration still absent; duplicate hidden frames load before claims; overlay geometry/stacking incorrect. |
| M3 — commit-scoped reactive claims | **Addressed in implementation, regression evidence incomplete.** `useResourceClaim` acquires in effect, releases on cleanup/key changes, retries after holder release, reads current-key status through `useSyncExternalStore`. No render-phase acquisition remains. No hook-level StrictMode/identity-change tests inspected. |
| M4 — profile subscription / qualified terminal lookup | **Partial, not resolved.** Profile-specific status subscribed and object-qualified `getTerminal` used. Shell still overrides every window's generation with selected profile generation; unknown owners can enter ambient TerminalPanel transport path; concrete incarnation not pinned/revalidated. |
| M5 — strict persistence / docking | **Partial, not resolved.** Exactly-one-placement, finite positive bounds, pane-active membership and desktop ownership/focus checks added. Docking can still invalidate source focus or orphan a window; app minimum contexts/appState and restore ownership not fully validated. |

## Critical issues — MUST FIX

### C1 — New Monaco surface can silently lose edits; its save callback bypasses encrypted-save policy

**Evidence:** `packages/ui/src/os/MonacoKeepAliveHost.tsx:127-145,155-167`; `apps/EditorApp.tsx:22-36`; `OsShell.tsx:52-70`; supporting `stores/editor.ts:575-640,878-902,915-921`; `components/organisms/EditorTabs.tsx:130-172`.

- OS code computes a tab key but never opens/creates the corresponding editor-store tab. Launch produces `untitled.ts`, possibly project `global`, and passes empty content to a writable MonacoHost. `setContent` only maps existing tabs; `save` returns false if the tab is missing. Typing appears to work, but does not create dirty state or a saveable buffer. Closing disposes the editor without a dirty warning because no store tab exists. **[INFERENCE] User edits are lost on close.** Imported file paths likewise are not loaded through the existing owner-bound open flow.
- When an existing matching tab does exist, OS `onSave` calls `useEditorStore.save` directly. That method dispatches ordinary `fsWriteFile`; existing EditorTabs checks encryption mode and uses `encryptedWrite.saveText` instead. **[INFERENCE] Saving an existing tab through OS can downgrade an encryption-enabled project to plaintext**, unlike the existing editor surface.
- Root content lookup uses `getState`, not a reactive tab selector; asynchronous loads/reloads do not reliably propagate as the controlled `content` prop without another root-window update.

**Correction:** establish a real owner-bound tab/buffer before enabling editing; subscribe to that exact tab's content/status; reuse/extract the existing save policy including encryption, generation fencing, conflict/error handling. Missing/unavailable target is explicit and non-writable, not a fabricated `global` file. Dirty close must operate on this same buffer.

**Confidence:** high for missing state/save-policy wiring; data-loss/plaintext outcomes source-derived, not runtime reproduced.

### C2 — Owner fail-closed contract still bypassed; selected-profile generation leaks into all windows

**Evidence:** `OsShell.tsx:24-27,216-219`; `DesktopCanvas.tsx:15-18,47-52`; `window-context.tsx:38-41`; `OsResourceHost.tsx:183-217`; `apps/TerminalsApp.tsx:22-35,46-61`; supporting `TerminalPanel.tsx:415-435,549-568,664-690,1097-1111`; `lib/terminal-incarnation-state.ts:44-54,78-85`.

- `WindowContextProvider` subscribes to the window profile, but `propGeneration ?? snap.owner.generation` always selects the generation supplied by Shell. Shell reads the currently selected profile once, without subscription. A window for profile B therefore uses profile A's generation even when B reconnects.
- Imported sessions accept any nonempty profile ID. Root immediately mounts owner-qualified TerminalPanels for those IDs. Existing TerminalPanel, when no snapshot exists for that profile, falls back to `getTransport()` and uses an ambient owner. New OS host never checks owner availability before mounting this path. **[INFERENCE] An unavailable persisted profile can subscribe/write to an equal raw terminal ID on the ambient server.** Qualified DOM lookup alone does not prevent this transport fallback.
- `owner.isConnected` is exposed but unused by all three adapters. Terminal incarnation is the latest mutable observation, not a separately pinned verified identity; its map has no subscription here. Existing TerminalPanel accepts newer incarnations. An old window therefore does not implement the plan's explicit unavailable/recovery state for replaced PTYs.

**Correction:** remove selected-profile generation plumbing; derive owner identity from each window's immutable profile. Fail closed before entering any ambient-capable resource path for missing/retired owners. Retain parked instances on disconnect, block input/capabilities, and revalidate pinned target/incarnation/epoch before permitting reconnect attachment. Add two-profile equal-ID, missing-profile, reconnect and changed-incarnation regressions.

**Confidence:** high for wiring/fallback paths; cross-profile network/input outcome source-derived, not executed.

## Warnings — SHOULD FIX

### H1 — Monaco parking moves a React-owned node and creates duplicate resource instances

**Evidence:** `MonacoKeepAliveHost.tsx:60-85,102-113,115-147,155-167,194-200`; `apps/EditorApp.tsx:62-68`. Existing terminal precedent: `TerminalPanel.tsx:324-339,1138-1140`.

`ParkedMonacoItem` returns a React-owned outer div under the parking host; attachment moves that exact div into the window slot. React still believes the parent is the parking host. Removing the last window deletes that keyed child during the mutation phase, before passive cleanup can park it. **[INFERENCE] Close can throw a DOM `removeChild`/NotFoundError.** Moving/removing app bodies also disconnects the surface until passive parking runs.

Additionally, `editorEntries` maps windows rather than unique tab keys: two windows for the same file create two MonacoHosts with duplicate React keys and competing registry entries, even when the second claim is denied. Unregister callbacks delete by key without checking which entry is current; either duplicate can remove the other's registration/model ownership.

**Correction:** root-own one editor resource per stable file identity, use an imperatively owned attachment boundary or stable-parent viewport design, and identity-check unregister/disposal. Add real Monaco open/duplicate/close/StrictMode and undo-preserving placement tests. Do not dispose the same editor independently in competing owners.

**Confidence:** high structural concern; DOM exception not browser reproduced.

### H2 — Terminal root is still not backed by live manager state; session deduplication crosses profiles

**Evidence:** `OsResourceHost.tsx:183-213`; `apps/TerminalsApp.tsx:18-20,56-60`; `OsShell.tsx:52-70`; `TerminalPanel.tsx:941-942`.

Root derives a purported MountedSession from each window, using `${profileId}:default` and empty launch metadata. No `useTerminalManager` subscription, real terminal selection, creation or Traditional display flow is present in OS sources. Registry-change subscription retries DOM attachment only; it is **not** a live backend/session-manager subscription. TerminalPanel explicitly does not create missing PTYs. Ordinary launch still targets a nonexistent default session.

Merge uses `Set(sessionId)` instead of owner-qualified identity. Profiles A and B with equal raw session IDs collapse to one root TerminalPanel; the second qualified slot cannot resolve a live resource. Window worktree/cwd are also not carried into the derived mounted-session target.

**Correction:** consume existing manager sessions and explicit owner-bound launch/selection; preserve the manager UI-key/backend-ID distinction and qualify deduplication with profile/resource identity. Keep root resources independent of disposable window bodies.

**Confidence:** high, direct source evidence.

### H3 — Stable preview host is a second implementation, with wrong geometry/stacking and claim-independent loads

**Evidence:** `OsResourceHost.tsx:23-47,85-120,124-147,152-172`; `apps/BrowserApp.tsx:25-55`; `WindowFrame.tsx:195-211`; existing `BrowserDebugKeepAliveHost.tsx:20-27,72-82`.

- New raw iframe path does not use the required browser-debug controller/host, target resolution, bridge generation or capability lifecycle. Default URL is the local development UI, unrelated to the window owner's remote target.
- Every browser window creates an iframe before its visible-slot claim succeeds. Duplicate denied previews and inactive imported windows still load/run scripts; claim denial does not prevent duplicate underlying preview resources.
- Overlay updates on resize/scroll, not on slot position changes. Dragging a float changes left/top without changing dimensions, so ResizeObserver need not fire. **[INFERENCE] Preview stays at the old position.**
- Overlay z-index is fixed at 20; focused float frame is 30 and maximized frame 50, both with opaque backgrounds. **[INFERENCE] Their preview is painted behind its own frame.** Other app stacking/focus likewise not represented.
- `updateBrowserSlot` mutates the stored object, then subscriber calls `setSlot` with that same object. Visibility/slot-only updates can be skipped by React's equality bailout.

**Correction:** integrate the existing root browser controller/keep-alive host with stable identity and explicit owner/visibility/viewport versions; tie resource creation to the unique resource owner, not all windows; participate in window stacking and position invalidation. Test actual visible hit targets and document state while dragging/maximizing, not merely iframe node existence.

**Confidence:** high source evidence; painting/drag outcomes not visually reproduced.

### H4 — Dock reconciliation can produce sessions rejected by the new validator

**Evidence:** `window-ops.ts:463-530`; `lib/tile-tree.ts:267-322`; regression currently only `window-ops.test.ts:143-165`.

- Cross-desktop dock removes the source placement but leaves source `focusedWindowId` pointing to the moved window. New validator rejects that foreign-desktop focus.
- Target desktop/pane not validated before source removal and mode mutation. Dock a float to a missing pane in an existing nonempty tree: insertion does nothing, float membership is removed, window becomes unplaced. Missing desktop similarly leaves invalid desktop ownership. Stale drag targets must be harmless no-ops, not partial transactions.
- `findTilePaneContaining(...) !== null` is always true when lookup returns `undefined`; unrelated desktop trees are needlessly processed.

**Correction:** resolve/validate source and target before mutation; update source focus, target placement/mode and restore metadata atomically; reject invalid targets without changes. Add cross-desktop and stale-target tests asserting `validateOsSession(result).valid` after every operation.

**Confidence:** high, deterministic control-flow analysis.

### H5 — Input arbitration still misidentifies app focus and cannot intercept preview chords

**Evidence:** `WindowFrame.tsx:151-189,218-224,327-331`; `input-arbiter.ts:58-83`; `OsResourceHost.tsx:124-147`.

Frame handler looks for `[data-os-window-body]`, but rendered body is `[data-os-window-slot]`. App events are therefore classified as frame events. `frame-focused-handled` is then ignored, and shortcut-capture targets have no exemption. Repeat is excluded from the global chord now, but no capture-target contract exists.

Iframe is rendered outside the frame React subtree; iframe keyboard events also do not bubble into the parent document. No browser-debug keyboard integration is wired, so Ctrl+Alt+Escape cannot reliably perform the promised focus transfer from preview. Cognito browser test only checks pointer-events CSS; it does not prove terminal/editor/paste/physical-input isolation or a remapped dismissal path.

**Correction:** use the real slot marker and explicit chrome/app focus contract, honor capture exemptions, integrate existing preview input coordination, then exercise physical input with PTY byte counters and Cognito journey assertions.

**Confidence:** high for marker mismatch/missing paths; physical input not executed.

### H6 — Session validator still trusts appState and ignores manifest minimum context

**Evidence:** `persistence.ts:209-281,468,542-553`; `app-registry.ts:13-20`; app adapter casts/defaults; `MonacoKeepAliveHost.tsx:158-165`.

Editor requires project context in its manifest, yet validator accepts an editor with only profile context; host fabricates project `global`. Imported `appState` is not validated/projected at all: wrong-type filePath/sessionId/url survive the cast to OsSessionV1 and reach resource key/rendering code. `defaultCtx` also unchecked. Restore desktop only needs to exist, not match the minimized window's owner desktop. Distinct panes/splits can share IDs, making resize/docking address multiple nodes ambiguously.

**Correction:** validate/project app-specific stable state and minimum context before atomic replacement; validate default/restore context and globally unique tree node IDs. Reject malformed fields rather than relying on TypeScript casts or ambient/default targets. Keep persistence allowlisting already present.

**Confidence:** high, direct validator inspection.

## Cycle 3 warnings W1–W6

| Prior warning | Disposition / evidence |
|---|---|
| W1 — lifecycle test depth | **Open.** Browser test named “JavaScript state” only writes `iframe.dataset.domMarker`; no awaited document load or in-frame JS marker (`browser-tests/os-lifecycle.browser.tsx:218-299`). No real PTY identity/attach/replay/reset, Monaco undo, reconnect or physical-input assertions. No `packages/ui/e2e/os-lifecycle` journey found. |
| W2 — scoped dirty close | **Partial.** Missing confirm now fails closed; profile/project/path filters added (`WindowFrame.tsx:100-149`). Missing appState.filePath matches every file; absent worktree acts as wildcard, so main-worktree window can match another worktree. No Save/Discard/Cancel workflow and no exact `editorFileTabKey` lookup. C1 prevents dirty tracking for ordinary launch. |
| W3 — input precedence | **Partial/open.** Repeat bypass added for OS chord, frame/app classification attempted; marker mismatch and preview/capture gaps remain (H5). |
| W4 — viewport reclamp | **Partial.** `window-store.ts:55-79` reclamps current floatBounds in same transaction. Minimized restorePlacement retains old bounds (`window-ops.ts:406-415`), so restore can put the window back offscreen after shrink. No viewport-aware clamp on new opens/mode changes either. Add shrink → restore regression and centralize clamping at placement boundaries. |
| W5 — common docking / tab order | **Partial.** Same-pane center docking now activates without reordering (`tile-tree.ts:298-306`); focus-order regression added (`window-ops.test.ts:167-194`). Two independent docking algorithms still exist: terminal hook imports `terminal-layout-docking` (`hooks/use-terminal-layout.ts:10-16`), not generic docking. Common-operations acceptance remains incomplete. |
| W6 — raw wire validation | **Addressed structurally.** `terminal-layout-tree.ts:44-50` uses raw-shape validator; `tile-tree.ts:371-418` validates sessionIds arrays and exact child count before conversion, then validates canonical tree. Prior string-spread/extra-child acceptance repaired. Tests still lack malformed-wire and actual v3-key fixture regressions (`tile-tree.test.ts:145-204`). |

## Suggestions — NICE TO HAVE

1. **Avoid full-tree conversion on every helper call.** `terminal-layout-tree.ts:53-79,106-139` repeatedly copies complete trees and arrays for reads and no-op updates. Boundary conversion once or accessor-based shared traversal preserves structural sharing without duplicating docking algorithms. Retain no-op reference identity.
2. **Reduce registry bookkeeping allocations/leaks.** `ResourceRegistry.notify` clones the full claim map separately for each subscriber (`resource-registry.ts:85-88`) although hook listeners need only invalidation; denied-status cache retains every holder window ID forever (`101-121`). Stable scalar/version snapshots and bounded/removed cache entries suffice.
3. Add hook-level claim regressions: StrictMode setup-cleanup-setup, complete key changes, denied holder release and abandoned renders. Current `resource-registry.test.ts:91-119` tests a plain registry notification, not `useResourceClaim`.
4. Keep one controller/identity authority per resource. Reuse existing manager/browser/editor policy instead of additional default IDs, raw iframe implementation and window-derived duplicate resources. This is necessary KISS/DRY, not a request for a plugin framework or broader abstraction.

## Positive observations

- Effect-scoped reactive claim hook replaces render-phase registry mutation.
- Qualified terminal DOM resolution removes the previous raw-ID registry alias exposure at attachment lookup.
- Placement validator now rejects tree/float mode disagreement, duplicate/missing placement, minimized visible placement and invalid pane active IDs.
- Finite positive geometry and split-weight checks added; raw terminal wire validation happens before normalization.
- Stable iframe React parent is the correct direction for browsing-context retention; single-frame maximize remains simpler than duplicate mounts.
- Corrupt OS bytes remain preserved with autosave suspended; app-state persistence remains allowlisted and separate from terminal v3 keys.

## Reviewed files

Primary source/test inspection (complete files unless ranges stated):
- `packages/ui/src/os/MonacoKeepAliveHost.tsx`
- `packages/ui/src/os/OsResourceHost.tsx`
- `packages/ui/src/os/apps/{EditorApp,TerminalsApp,BrowserApp}.tsx`
- `packages/ui/src/os/resource-registry.ts`
- `packages/ui/src/os/window-context.tsx`
- `packages/ui/src/os/{resource-registry.test,persistence,persistence.test,window-ops,window-ops.test,window-store,input-arbiter,app-registry,types}.ts`
- `packages/ui/src/os/{OsShell,DesktopCanvas,WindowFrame}.tsx`
- `packages/ui/src/lib/{tile-tree,tile-tree.test,terminal-layout-tree,terminal-layout-docking,terminal-host-attachment,terminal-registry,terminal-incarnation-state}.ts`
- `packages/ui/src/components/organisms/SplitLayout.tsx:1-230` plus scoped diff; `SplitLayout.test.ts`
- `packages/ui/browser-tests/os-lifecycle.browser.tsx`

Supporting sections:
- `components/organisms/MonacoHost.tsx:1-253,485-572`
- `components/organisms/TerminalPanel.tsx:165-231,320-447,549-568,664-690,941-942,1089-1155` (some sections located through search)
- `components/organisms/{TerminalKeepAliveHost,BrowserDebugKeepAliveHost}.tsx`
- `components/organisms/EditorTabs.tsx:1-190`; close/save callsite search
- `components/organisms/BrowserDebugIframeHost.tsx` geometry/stacking search
- `stores/editor.ts:70-115,550-640,750-810,875-930`; editor API search
- `hooks/use-terminal-layout.ts:1-75`
- Phase 01 plan, Cycle 3 review and Cycle 4 tester report; README, PDR, code standards and published review/development guidance.

## Validation commands / results

**Reviewer:** source inspection, `git status --short && git diff --stat`, scoped `git diff -- ...SplitLayout.tsx ...terminal-layout-tree.ts`, `date +%y%m%d`. No executable product verification or changes to implementation/plan.

**Recorded tester evidence only:** `plans/reports/tester-261102-0310-phase-01-cycle-4-validation.md:19-31,48-81` records HEAD `d2b4b65d12753270d0533864062f229f17e84b4d` plus dirty-source fingerprint `02c5bd99aee9c06bf2c9abda899ed57cf9f211f672629c8ab3d7d530ecda15a6`. Fingerprint not independently recomputed in this review.

| Command | Recorded result |
|---|---|
| `pnpm --filter @dam-hopper/ui test src/lib/tile-tree.test.ts src/lib/terminal-layout-docking.test.ts src/components/organisms/SplitLayout.test.ts src/os` | Exit 0; 7 files, 52 tests passed |
| `pnpm --filter @dam-hopper/ui test` | Exit 0; 335 files, 3,128 tests passed |
| `pnpm --filter @dam-hopper/ui test:browser os-lifecycle.browser.tsx` | Exit 0; Chromium, 7 tests passed |
| `pnpm --filter @dam-hopper/ui build` | Exit 0; `tsc -p tsconfig.json`, 0 compiler diagnostics |

Retained diagnostics: two jsdom navigation-not-implemented errors; repeated React act-environment warnings. No lint output, code/test coverage percentage or real lifecycle E2E result available. Passing recorded commands do not cover the critical paths above.

## Recommended actions / plan completeness

1. Repair editor buffer/save policy and fail-closed owner routing first (C1/C2).
2. Finish root controller/manager integration and safe single-resource Monaco/browser ownership; fix docking transaction and input paths.
3. Extend regressions to reproduce findings; integration owner runs targeted/full UI tests, browser tests and TypeScript build once source writers join. Add encryption-policy, two-profile/unknown-owner, real Monaco close/undo, browser document/geometry and docking validity coverage.
4. Keep `implement-os-lifecycle`, route integration and prototype qualification open. `generalize-tile-tree` is currently checked complete at phase lines 272–275, but common docking operations and specified v3 fixture regressions remain incomplete; coordinator should reconcile that status. No plan/task edits made under report-only ownership.
5. Qualify real `/os` lifecycle on a coherent source-pinned artifact: same xterm/editor/model/iframe document identities, zero placement-only attach/replay/reset deltas, separate reconnect/incarnation and physical Cognito/input evidence. Route integration remains separately ordered work, not an excuse to certify current adapters.

## Unresolved questions / evidence

No product clarification required. Missing evidence: settled live PTY/Monaco/preview journey, encrypted OS save behavior, unknown-profile fail-closed transport behavior, physical keyboard/paste/pointer isolation, and placement/reconnect identity/counter baselines. Findings labeled `[INFERENCE]` are source-derived failure paths, not reviewer-executed reproductions. No Phase 01 acceptance approval implied.
