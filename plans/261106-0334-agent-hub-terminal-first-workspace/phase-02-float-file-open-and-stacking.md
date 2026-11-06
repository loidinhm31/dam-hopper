# Phase 02 — Float file-open + float/maximized stacking

## Context Links
- Evidence A "file:open & window placement", B2, C (z-order, file reuse): `./reports/scout-261106-0334-evidence-and-decisions.md`
- Design §5 "Floating File Window Lifecycle", §6.1–6.2, AC1–AC2: `../reports/ui-ux-designer-261106-0226-agent-hub-workspace-flow.md`
- P01 contracts: `./phase-01-shared-contracts.md` (`mode?: "float"`, `revealWindow`)

## Overview
- Priority: P1 · Status: completed · Effort: 10h
- `file:open {mode:"float", generation}` always yields a visible floating editor on the active desktop (reusing the canonical window atomically); float windows stack above the maximized plane while a float is focused.

## Parallelization Info
- Group A · Depends on: P01 · Blocks: P06 · Concurrent peers: P03, P04, P05 (disjoint files).
- Serialize with `plans/261103-1608-workspace-file-tree-project-marks` Phase 03/04 (`OsShell.tsx`, `stores/editor.ts`, `EditorApp.tsx`, canonical editor identity) and check `plans/261103-2016-user-concerns-resolution` (in_progress, edits `EditorApp.tsx`) before touching EditorApp — never concurrent.

## Key Insights
- Handler `packages/ui/src/os/OsShell.tsx:458-563`: generation fence only when generation given (`:459-474`); dedupe (`:501-531`); reuse only restores minimized + focus (`:532-542`); create uses `defaultWindowPlacement ?? "float"` (`:546`) on `session.activeDesktopId` (`:560`).
- `focusWindow` neither changes desktop nor mode (`packages/ui/src/os/window-ops.ts:365-406`); `setWindowMode` float clears `maximized`, sets bounds, removes from tree (`:485-538`); `moveWindowToDesktop` on minimized windows only updates membership (`:454-457`); `restoreWindow` handles minimized→restorePlacement and maximized→unmaximize (`:665-732`).
- Z-order `packages/ui/src/os/DesktopCanvas.tsx:244-288`: float layer `zIndex: floatOnTop ? 60 : 20`; maximized layer `40`, focused maximized slot `50`. When focused window is float, float layer elevates to `60` (above maximized `40/50`). Focusing a maximized window restores maximized layer to `50` (above float `20`).
- Existing DesktopCanvas maximized tests: `packages/ui/src/os/maximized-presentation.test.tsx:43`.
- No direct test of the `file:open` handler exists (only via `deep-links.test.ts:84`, `FilesApp.test.tsx:287`).
- F1 (review): a window's effective owner generation is derived from the CURRENT snapshot (`packages/ui/src/os/window-context.tsx:42-45,83-95`), not `window.ctx.generation`; EditorApp claims with that owner. So an old window kept with its original `ctx.generation` is NOT retired/read-only — leaving ctx unchanged does not prevent a later save through the rebound owner. Dedupe keys (`editorFileTabKey(targetRef, filePath)`) carry no generation, so a G document is found by a G+1 request.
- `maximized-presentation.test.tsx` runs in jsdom (`:1,19-25`) → no real layout/hit-testing; Chromium checks belong in the browser file (F5).
- BrowserApp iframes live in a separate fixed host with `zIndex: 20` outside DesktopCanvas (`packages/ui/src/os/OsResourceHost.tsx:129-152`, P03-owned file).
- V1 endpoint identity: `ConnectionSnapshot.serverUrl` (`packages/ui/src/api/connections.ts:91-100`) is the live endpoint; `connectProfile` sets it to the normalized profile URL (`:430-437`, profile URL from `:415`). Same-endpoint reconnect/server restart only bumps generation (`handleDrop` `:277-290`, `connectProfile` `:432`) and serverEpoch. Editor writes resolve the CURRENT transport at write time (`packages/ui/src/stores/editor.ts:409-424` `resolveTabTransport`): `save` (`:1216-1258` `fsWriteFile`) and `forceOverwrite` (`:1415-1473` `fsWriteFile`); loads go through `open` (`:862`), `reloadTab` (`:1542`), `loadContent` (`:1775`). Only load-failure text is rendered by EditorApp today (`packages/ui/src/os/apps/EditorApp.tsx:384`). Tests: `packages/ui/src/stores/editor.test.ts`; no EditorApp unit test exists.

## Requirements
- R1 `mode:"float"` without `generation` → `{status:"unhandled", reason}`; with retired/disconnected generation → existing rejection (no window/document mutation, no `useEditorStore.open`).
- R2 Reuse path (float mode, approved policy "reuse, convert to float, restore, bring to Hub desktop"): a matched existing editor window is reused when `ctx.profileId === payload.profileId` AND normalized target equal (existing dedupe comparison) AND (`ctx.generation === undefined` OR `ctx.generation === payload.generation`). The request generation itself is already fenced against the live snapshot (R1). Windows with undefined `ctx.generation` are live-owner windows: the handler sets `ctx.generation = intent.payload.generation` (`OsShell.tsx:475-481`, undefined for FilesApp/deep-link/Search callers) and `window-context.tsx:43` derives their owner generation from the live snapshot, so they already follow the current connection. Reuse = one store transaction `presentWindowAsFloat(windowId, activeDesktopId)` = restore (minimized or maximized) → `setWindowMode float` if tiled → `moveWindowToDesktop(activeDesktopId)` → focus; then existing `line` update + `useEditorStore.open` unchanged. Never close/recreate window, never rewrite `ctx`/`generation`, never re-key document. Live-owner windows keep their pre-existing save semantics (covered by the residual below, not worsened).
- R2a Owner mismatch (fail closed) ONLY when the matched window's `ctx.generation` is DEFINED and differs from `payload.generation` (window opened at a now-retired generation): call store `revealWindow(existing.id)` (P01) and return `{status:"unhandled", reason:"Document belongs to a retired connection; reopen it from its window"}` WITHOUT `useEditorStore.open`, without `line` update, without `presentWindowAsFloat`, and without rebinding ctx — dirty buffer and undo stay untouched. No new window is created for that tuple.
- R3 Create path (float mode): `mode:"float"` regardless of `defaultWindowPlacement`.
- R4 Legacy callers (no `mode`) unchanged byte-for-byte in behavior.
- R5 Stacking (B2, global): when the active desktop's `focusedWindowId` is a non-minimized, non-maximized float window, the float layer renders above the maximized layer; focusing a maximized window puts the maximized plane back on top (no un-maximize). Pointer events reach only the topmost layer's window frames; maximized windows beneath remain clickable where not covered.
- Non-goals: no WindowFrame changes; no change to tile behavior; no generation-based save fence (V1).
- R6 BrowserApp iframe layer (fixed z 20, P03-owned `OsResourceHost.tsx`) is out of B2 scope — DECIDED documented limitation (V4). The Chromium suite characterizes float-editor vs visible BrowserApp iframe stacking so the limitation is explicit and any change visible; P07 records it.
- R7 Endpoint-identity save fence (V1, user decision A; F1 provenance). `endpointIdentity = { profileId, serverUrl: normalized snapshot.serverUrl }` is bound to the document's CONTENT BASELINE, not to the last successful read:
  - R7a Capture: every server read (`open`, `reloadTab`, `loadContent`, new `discardAndReload`) captures the identity of the snapshot whose transport it uses BEFORE I/O (same point as `resolveTabTransport`).
  - R7b Commit only on replacement: the captured identity is written to the tab AND its canonical `documents[documentKey]` entry only in the branch where that read's content replaces `content`/`savedContent` (non-dirty branches `reloadTab` `:1615-1626`, `loadContent` `:1883-1896`, new-doc branch of `open` `:989+`). Dirty-skip branches (`reloadTab` `:1608-1614`, `loadContent` `:1875-1882`) and alias/canonical reuse of an existing document (`open` `:957-986`) RETAIN the identity that travels with the retained content (`existingDoc.endpointIdentity`, never the new read's). Rule: identity is copied wherever content/savedContent is copied, from the same source.
  - R7c Rebind only via explicit discard: new store action `discardAndReload(key)` (user-initiated, behind ConfirmDialog in EditorApp) performs a read that replaces the dirty buffer of the tab and its document with server content and commits that read's captured identity; on read failure nothing changes (buffer, identity, block kept). `reloadTab`'s existing dirty-retaining behavior is unchanged.
  - R7d Write check: `save` and `forceOverwrite` compare the document's identity with live `getConnectionSnapshot(profileId)` BEFORE `fsWriteFile`; mismatch, missing snapshot, or MISSING identity → deny, no request, keep dirty buffer + undo, set `saveBlockedReason` ("This file was loaded from <old or unknown endpoint>; reload to discard your changes or copy them first."). Same endpoint with newer generation/serverEpoch saves normally. Never fence on generation.
  - R7e Persistence — DECIDED (V6, user): `endpointIdentity` is added as an optional field to the persisted dirty tab/document slice (`partialize` `:2036-2072`, dirty buffers already persisted at `:2049-2050,2069-2071`) so restored dirty tabs keep their provenance; tabs/documents hydrated without it (legacy payloads) fail closed once per R7d until discard/reload. No version bump (optional field; `migrateEditorState` must tolerate absence — verify).
  - R7f Scope: store-level, so live-owner (undefined `ctx.generation`) windows are covered. EditorApp renders `saveBlockedReason` next to the existing error rendering (`EditorApp.tsx:384`) with a "Discard changes and reload" action (ConfirmDialog → `discardAndReload`).

## Architecture
- `window-ops.ts`: `presentWindowAsFloat(session, windowId, desktopId, viewport?)` pure composite; result must satisfy `validateOsSession` (`docs/code-standards.md:171`). Store action `presentWindowAsFloat(windowId, desktopId)` single `set`.
- `OsShell.tsx` `file:open` only: branch on `intent.payload.mode === "float"` for R1/R2/R2a/R3; legacy branch untouched.
- `DesktopCanvas.tsx`: derive `floatOnTop = focused window is float && !minimized && !maximized`; float layer `zIndex` 60 when `floatOnTop` else 20; maximized layer unchanged. Keep stable portal containers (no remount: `DesktopCanvas.tsx:290-318`).

## Related Code Files
- Modify: `packages/ui/src/os/OsShell.tsx` (file:open handler only), `packages/ui/src/os/window-ops.ts`, `packages/ui/src/os/window-ops.test.ts`, `packages/ui/src/os/window-store.ts`, `packages/ui/src/os/DesktopCanvas.tsx`, `packages/ui/src/os/maximized-presentation.test.tsx`, `packages/ui/src/stores/editor.ts`, `packages/ui/src/stores/editor.test.ts` (R7), `packages/ui/src/os/apps/EditorApp.tsx` (R7 notice only)
- Create: `packages/ui/browser-tests/os-file-open-float.browser.tsx`
- Delete: none

## Ownership & Conflict Prevention
- Exclusive in Group A for all files above. `window-ops.ts`/`window-ops.test.ts`/`window-store.ts` previously written by P01 (sequential). `OsShell.tsx`: only the `file:open` handler block; no other handler edits (P03 does not touch OsShell; `OsResourceHost` mount at `OsShell.tsx:1601` stays unchanged). Amendment (V1): `stores/editor.ts`, `stores/editor.test.ts`, `os/apps/EditorApp.tsx` belong to P02 only; no other phase of this plan writes them.

## Implementation Steps
1. `p02-present-window-as-float`: add pure op + store action; unit tests for tiled, minimized (from tile and from float), maximized, other-desktop (incl. minimized on other desktop), already-float-same-desktop (no-op apart from focus), multiple maximized windows on the target desktop; each asserts `validateOsSession`.
2. `p02-file-open-float-handler`: implement R1–R4 in `OsShell.tsx`; keep dedupe logic identical; on reuse (ctx.generation undefined or equal) call store `presentWindowAsFloat(existing.id, session.activeDesktopId)` instead of restore+focus; on defined-mismatch apply R2a.
3. `p02-float-stacking`: implement R5 in `DesktopCanvas.tsx`; extend `maximized-presentation.test.tsx` (jsdom) with STRUCTURAL assertions only: float focused over maximized → float layer `style.zIndex` > maximized layer; focus maximized → maximized slot z on top and float layer back to 20; two maximized + one float; portal containers keep identity (no remount).
4. `p02-float-browser-qualification` (Chromium): tiled/minimized/maximized/other-desktop reuse (generation-equal windows); a Files-opened window (no `ctx.generation`, tiled, on another desktop) is reused, restored, floated and moved to the active desktop by a Hub float request without document recreation; dirty Monaco buffer + undo stack unchanged after reuse (same model instance, `getAlternativeVersionId()` and `canUndo` preserved, editor tab `dirty` unchanged); reconnect G→G+1 with a dirty doc open in a window whose `ctx.generation` = G (opened via float/generation-bearing request) → G+1 float request reveals the old window, returns unhandled, performs no load/rebind/overwrite, dirty buffer + undo unchanged; profile re-pointed to another serverUrl with a dirty Files-opened editor → save shows the blocked notice, buffer + undo intact; a Hub float request for the same file via the re-pointed profile (alias/canonical reuse) still blocks save; "Discard changes and reload" (ConfirmDialog) rebinds and save then succeeds; generation retired rejection; float without generation rejected; legacy (no mode) path still honors `defaultWindowPlacement: "tile"`; identical relative path across two profiles/worktrees → two windows, same tuple → focus existing without claim conflict (AC2); closing dirty float shows `ConfirmDialog` (`WindowFrame.tsx:639-653`). Stacking (moved from jsdom): `elementFromPoint` hit-testing lands on float frame when on top; uncovered background clicks reach the maximized window beneath; focus return after closing the float (next zOrder window); keyboard routing goes to the focused float, not the maximized app; multiple maximized windows; BrowserApp iframe characterization (R6).
5. `p02-editor-save-endpoint-fence`: implement R7a–R7f in `stores/editor.ts` + EditorApp notice/action. `editor.test.ts` cases (each asserting no `fsWriteFile` call when denied, dirty content + undo-relevant state unchanged, `saveBlockedReason` set):
   - same-endpoint reconnect (generation G→G+1, new serverEpoch) saves; disconnected snapshot → denied.
   - A-dirty → profile re-pointed to B → `reloadTab` from B (dirty-skip) → save and forceOverwrite denied; identity still A.
   - A-dirty → B → `loadContent` (dirty-skip) → denied.
   - A-dirty doc → `open` of an alias/canonical path resolving to the same `documentKey` via B → reuse keeps A identity → denied in both tabs.
   - A-dirty → B → `discardAndReload` succeeds → buffer = B content, identity = B, save succeeds; `discardAndReload` read failure → buffer, identity A and block unchanged.
   - hydrated dirty tab without `endpointIdentity` → denied with notice; hydrated dirty tab with matching persisted identity → saves.
   - non-dirty reload from B replaces content and commits B identity (replacement branch).
   - live-owner window (undefined `ctx.generation`) gets the same fence.

```evcrate-tasks
[
  {
    "id": "p02-present-window-as-float",
    "title": "Pure presentWindowAsFloat composite and store action",
    "blocked_by": ["p01-terminal-claim-key", "p01-terminal-runtime-identity", "p01-hub-terminal-mounts-store", "p01-open-workspaces-union", "p01-file-open-mode-contract", "p01-reveal-window", "p01-terminal-presentation-input"],
    "allowed_files": ["packages/ui/src/os/window-ops.ts", "packages/ui/src/os/window-ops.test.ts", "packages/ui/src/os/window-store.ts"],
    "constraints": ["Single pure transition + single store set (code-standards single-transaction rule).", "Do not alter existing ops or P01 revealWindow semantics."],
    "acceptance": ["For tiled, minimized, maximized and other-desktop windows the result is a focused, non-minimized, non-maximized float on the requested desktop and validateOsSession passes.", "Window id, appState and ctx are unchanged by the composite."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/os/window-ops.test.ts"]
  },
  {
    "id": "p02-file-open-float-handler",
    "title": "Honor file:open float mode with mandatory generation fence and atomic reuse",
    "blocked_by": ["p01-file-open-mode-contract", "p02-present-window-as-float"],
    "allowed_files": ["packages/ui/src/os/OsShell.tsx"],
    "constraints": ["Edit only the file:open handler (OsShell.tsx:458-563).", "Legacy payloads without mode keep current behavior exactly (Invariant C file reuse).", "Reuse when ctx.profileId and normalized target match and ctx.generation is undefined or equals the request; reveal-only fail closed (R2a) only when ctx.generation is defined and differs. Never rewrite ctx/generation or recreate the window/document."],
    "acceptance": ["mode float without generation, or with retired/disconnected generation, returns unhandled and performs no window/editor-store mutation (AC1).", "mode float creates a float editor even when defaultWindowPlacement is tile; reuse of a generation-equal or live-owner (undefined ctx.generation, e.g. Files-opened) window restores/floats/moves/focuses it on the active desktop without recreating the document (AC1, AC2).", "A matched window whose defined ctx.generation differs from the request is only revealed; the handler returns unhandled with a retired-connection reason and never calls editor-store open or updates line (AC1, F1)."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/os/deep-links.test.ts src/os/apps/FilesApp.test.tsx", "pnpm --filter @dam-hopper/ui build"]
  },
  {
    "id": "p02-float-stacking",
    "title": "Float layer above maximized plane while a float window is focused",
    "blocked_by": ["p01-terminal-claim-key", "p01-terminal-runtime-identity", "p01-hub-terminal-mounts-store", "p01-open-workspaces-union", "p01-file-open-mode-contract", "p01-reveal-window", "p01-terminal-presentation-input"],
    "allowed_files": ["packages/ui/src/os/DesktopCanvas.tsx", "packages/ui/src/os/maximized-presentation.test.tsx"],
    "constraints": ["Global OS behavior (B2); preserve stable portal containers (no window remount).", "Do not change window-ops focus semantics."],
    "acceptance": ["When the desktop's focused window is a float, the float layer z-index exceeds the maximized layer; focusing a maximized window returns it on top without un-maximizing (B2).", "jsdom tests assert structure/z-index only (multiple maximized windows, layer swap, stable portal containers); no hit-testing claims in jsdom (F5)."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/os/maximized-presentation.test.tsx"]
  },
  {
    "id": "p02-float-browser-qualification",
    "title": "Browser regression for float file-open reuse, dirty buffers and stacking",
    "blocked_by": ["p02-file-open-float-handler", "p02-float-stacking", "p02-editor-save-endpoint-fence"],
    "allowed_files": ["packages/ui/browser-tests/os-file-open-float.browser.tsx"],
    "constraints": ["Real Chromium via vitest browser config; no mocked window-store transitions.", "Escalate instead of editing other test files."],
    "acceptance": ["Reuse from tiled/minimized/maximized/other-desktop, including a Files-opened live-owner window without ctx.generation, floats it on the active desktop and keeps the same Monaco model with unchanged dirty flag, alternativeVersionId and undo availability (AC2).", "Reconnect G->G+1 with a dirty document open in a window whose ctx.generation is G: a Hub float request at G+1 reveals the existing window without load/rebind/overwrite and dirty buffer + undo stay unchanged (AC1, F1).", "With the profile re-pointed to a different serverUrl, saving a dirty editor shows the blocked-save notice and keeps buffer + undo, also after a float reopen of the same file via the re-pointed profile; Discard changes and reload rebinds and the next save succeeds; after a same-endpoint reconnect the original save succeeds (V1, F1).", "Identical relative paths across profiles/worktrees open distinct windows; same tuple focuses existing without duplicate claim; dirty close triggers ConfirmDialog; legacy no-mode path unchanged (AC1, AC2).", "Chromium: float frame wins hit-testing above a maximized window, uncovered background clicks and focus return behave correctly, keys route to the focused float, multiple maximized windows handled; BrowserApp iframe stacking characterized as documented limitation (B2, F5, V4)."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/os-file-open-float.browser.tsx"]
  },
  {
    "id": "p02-editor-save-endpoint-fence",
    "title": "Endpoint-identity save fence for editor documents",
    "blocked_by": ["p01-terminal-claim-key", "p01-terminal-runtime-identity", "p01-hub-terminal-mounts-store", "p01-open-workspaces-union", "p01-file-open-mode-contract", "p01-reveal-window", "p01-terminal-presentation-input"],
    "allowed_files": ["packages/ui/src/stores/editor.ts", "packages/ui/src/stores/editor.test.ts", "packages/ui/src/os/apps/EditorApp.tsx"],
    "constraints": ["Fence on endpoint identity (profileId + normalized ConnectionSnapshot.serverUrl) bound to the content baseline: captured from the read's transport before I/O and committed to tab + canonical document only when that read replaces the buffer; never on generation (V1, F1).", "Dirty-skip branches of reloadTab/loadContent and alias/canonical reuse in open retain the identity of the retained content; only user-initiated discardAndReload with a successful replacing read rebinds (F1).", "Missing identity (incl. hydrated dirty tabs without persisted identity) fails closed; identity persisted only as an optional field of the existing dirty-tab/document persist slice, no version bump.", "EditorApp.tsx edited only to render saveBlockedReason and the ConfirmDialog-guarded Discard changes and reload action; serialize with plans 261103-1608 (Phase 03/04) and 261103-2016 on editor.ts/EditorApp.tsx."],
    "acceptance": ["Same-endpoint reconnect or server restart (new generation/serverEpoch) still saves; a profile re-pointed to a different serverUrl denies save and forceOverwrite without any write request, keeping dirty buffer and undo, and shows a visible notice (AC1, AC2, V1).", "A-dirty buffer followed by reloadTab, loadContent or alias/canonical open reuse via endpoint B keeps identity A and save/forceOverwrite stay denied (F1).", "discardAndReload from B replaces the buffer, rebinds to B and the next save succeeds; a failed discardAndReload read leaves buffer, identity and block unchanged (F1).", "Hydrated dirty tab without identity is denied with notice; with matching persisted identity it saves; live-owner windows (undefined ctx.generation) are covered by the same fence (V1, F1)."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/stores/editor.test.ts", "pnpm --filter @dam-hopper/ui build"]
  }
]
```

- [x] <!-- evcrate-task:p02-present-window-as-float --> Pure presentWindowAsFloat composite and store action
- [x] <!-- evcrate-task:p02-file-open-float-handler --> Honor file:open float mode with mandatory generation fence and atomic reuse
- [x] <!-- evcrate-task:p02-float-stacking --> Float layer above maximized plane while a float window is focused
- [x] <!-- evcrate-task:p02-float-browser-qualification --> Browser regression for float file-open reuse, dirty buffers and stacking
- [x] <!-- evcrate-task:p02-editor-save-endpoint-fence --> Endpoint-identity save fence for editor documents

## Success Criteria
- AC1 (float even with tile preference; generation fence; visible over maximized Hub), AC2 (distinct keys/windows, reuse without duplicate claims, dirty ConfirmDialog). B2 implemented globally with C z-order tests. V1 endpoint save fence closes the former save-through-rebound-owner residual.

## Risk Assessment
- Global z-order change could affect existing maximized flows → keep focused-maximized slot logic; regression via `maximized-presentation.test.tsx` and `os-desktop-polish.browser.tsx` (run, not edited).
- Live-owner windows (undefined `ctx.generation`) are reused and follow the current connection; their saves are protected by the R7 endpoint fence like every other editor document.
- R7 touches `stores/editor.ts` (2000+ lines, shared with plan 261103-1608 canonical identity) → identity capture/commit at the three read sites, copy-with-content at alias reuse, `discardAndReload`, pre-write check in two write paths, optional persist field; serialized with that plan; existing editor tests run unchanged.
- Provenance drift (F1): any future code path that copies content without its identity would weaken the fence → rule "identity travels with content" + alias/dirty-skip tests; missing identity always fails closed.
- Legacy persisted dirty tabs lack identity → denied until user copies or discards (decided fail-closed, V6; one-time after upgrade; P07 lists it under known limitations).
- Endpoint comparison uses normalized URLs; a profile re-pointed to a URL that normalizes identically is treated as the same endpoint (by design).
- BrowserApp iframe layer not covered by B2 (R6) — decided documented limitation (V4).
- Input arbitration: float above maximized must not route keys to hidden maximized app → Chromium keyboard-routing assertion; `input-arbiter.test.ts` run unchanged.

## Security Considerations
- Mandatory generation for float mode; reuse only for generation-equal or live-owner (undefined `ctx.generation`) windows; defined-generation mismatches fail closed (reveal only, no load/rebind) (AC1, F1). Writes are fenced on the content baseline's endpoint identity so a buffer loaded from one server is never saved to a different server, including after dirty-skip reloads and alias reuse (V1, F1-V1); same-endpoint reconnects keep working. Persisted identity contains only profileId + normalized serverUrl (`[INFERENCE]` already present in persisted profile config; no secrets).

## Rollback
- Revert P02 commit; legacy branch untouched so callers without mode unaffected. Stacking change is GLOBAL (all desktops/apps), isolated to one derived z-index; reverting P06 alone leaves it active (see integrated rollback order in `plan.md`).

## Next Steps
- P06 dispatches float intents from Hub trees (via P05 payload); P07 live checks.

## Unresolved questions
- None (V1 resolved by R7; V4 iframe stacking decided as documented limitation; V6 decided: endpoint identity persisted with dirty tabs, legacy entries fail closed once).
