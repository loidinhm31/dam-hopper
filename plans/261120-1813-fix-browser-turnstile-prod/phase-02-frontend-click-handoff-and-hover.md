# Phase 2: Frontend Pre-Click Hover Replay & Click Dwell

## Context Links
- [BrowserStreamKeepAliveHost.tsx](file:///home/loidinh/WS/dam-hopper/packages/ui/src/os/BrowserStreamKeepAliveHost.tsx)
- [input-controller.ts](file:///home/loidinh/WS/dam-hopper/packages/ui/src/browser-host/input-controller.ts)
- [canvas-view.tsx](file:///home/loidinh/WS/dam-hopper/packages/ui/src/browser-host/canvas-view.tsx)
- [BrowserStreamKeepAliveHost.test.tsx](file:///home/loidinh/WS/dam-hopper/packages/ui/src/os/BrowserStreamKeepAliveHost.test.tsx)
- [input-controller.test.ts](file:///home/loidinh/WS/dam-hopper/packages/ui/src/browser-host/input-controller.test.ts)

## Overview
- **Priority:** P1 | **Status:** Completed | **Effort:** 3h
- Buffer valid pre-click hover moves without stealing control, replay them in order before `pointerDown` upon `acquireBrowserControl` resolution, and preserve human press-to-release dwell (`clamp(upAt - downAt, 45, 180)` ms) before dispatching `pointerUp`.

## Key Insights
- `BrowserInputController.handlePointerMove` coalesces adjacent moves (`input-controller.ts:843-848`), so replaying multiple approach moves needs an `immediate` mode to flush each point distinctly before `handlePointerDown`.
- `surviving` (`BrowserStreamKeepAliveHost.test.tsx:1134-1168`), `after-toolbar` (`:1409-1435`), and `:1681-1703` assert `pointerDown` first when NO pre-click `pointermove` fired, so synthetic pre-click `pointerMove`s must only emit when hover moves were actually buffered.
- `mid-paste` (`:1562-1573`) and `hide-paste` (`:1594-1604`) currently expect chunk 1 to drain at `t=0` upon `lease.resolve`; once click dwell defers `pointerUp` + `completeControlHandoff` by 45 ms, those two tests must advance `45ms` after `lease.resolve` before interrupting paste.
- During an active `upTimer` dwell window (after `pointerup` already happened), subsequent `pointermove` events must not dispatch ahead of `pending.up` (otherwise a click turns into a drag).

## Requirements
- Buffer latest hover position regardless of age while pointer remains on canvas, plus up to 5 recent moves within 600 ms (`Date.now()`), ONLY when `!isController || !leaseToken` and `mapClientToFractions` succeeds. Never acquire control on hover.
- Clear hover buffer on `pointerleave`, window/proxy `blur`, `!isEffectiveVisible`, `isSuppressed`, `navigationRevision`/`viewportEpoch`/session identity change, and `cancelPendingGesture`.
- On `acquireBrowserControl` success: replay buffered approach moves ending at `pending.down` coords and flush before `handlePointerDown(pending.down)`.
- If `pending.up` was captured before lease resolution (`upAt`), hold `handoff` open and schedule a cancellable `clamp(upAt - downAt, 45, 180)` ms timer before dispatching `pending.move` + `pending.up` + `completeControlHandoff`.
- Cancel timer cleanly on `cancelPendingGesture` / `releaseAllHeldInput` (sending `pointerCancel` without `pointerUp`); flush `pending.up` synchronously on successor `handlePointerDown` before starting the second click.

## Related Code Files
- Create `packages/ui/src/os/browser/browser-preclick-hover.ts` (< 100 lines)
- Modify `packages/ui/src/browser-host/canvas-view.tsx`
- Modify `packages/ui/src/browser-host/input-controller.ts`
- Modify `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx`
- Modify `packages/ui/src/os/BrowserStreamKeepAliveHost.test.tsx`
- Modify `packages/ui/src/browser-host/input-controller.test.ts`

## Implementation Steps
1. **Create pure hover & dwell helper (`browser-preclick-hover.ts`):**
   - Implement `createPreClickHoverBuffer`, `clearPreClickHoverBuffer`, `recordPreClickHover` (keeps `latest` + up to 5 entries within 600 ms), `consumePreClickHoverTrail` (returns `[]` if buffer empty; otherwise recent moves or `[latest]`, appending `downPointer` if coords/modifiers differ, and clears buffer), and `computeClickDwellMs(downAt, upAt)` (`Math.min(180, Math.max(45, upAt - downAt))`).
2. **Wire `onCanvasPointerLeave` & non-coalescing replay (`canvas-view.tsx`, `input-controller.ts`):**
   - Add optional `onCanvasPointerLeave` prop to `CanvasViewProps` and pass `onPointerLeave={onCanvasPointerLeave}` to `<canvas>` (`canvas-view.tsx:5-17, 116-131`).
   - Add `immediate = false` to `BrowserInputController.handlePointerMove` and `enqueueCoalescableEvent` (`input-controller.ts:537, 822`): when `immediate === true`, flush any existing `pendingCoalescable` first, enqueue without scheduling a timer, and call `this.flushCoalescable(true)`.
3. **Integrate hover buffering & dwell timer (`BrowserStreamKeepAliveHost.tsx`):**
   - Extend `PendingBrowserPointer` with `downAt`, `upAt`, `preClickMoves`, `upTimer`, and `flushUp`.
   - Track `hoverBufferRef`; clear it on `handlePointerLeave`, `handleWindowBlur`, `cancelPendingGesture`, `!isEffectiveVisible`, `isSuppressed`, `navigationRevision`, `viewportEpoch`, and session identity changes.
   - Update `handlePointerMove`: if `pending?.upTimer !== undefined` buffer into `hoverBufferRef` and return (do not emit move before `pending.up`); if `pending && !pending.replayed` capture `pending.move`; if `latest.tab.isController && latest.tab.leaseToken` clear hover buffer and forward live; else if valid/trusted/mapped record into `hoverBufferRef`.
   - Update `handlePointerDown`: if already controller and `pending?.flushUp` is active, flush `pending.up` synchronously before the new press; otherwise capture `downAt = Date.now()` and `preClickMoves = consumePreClickHoverTrail(...)`.
   - After `acquireBrowserControl` resolves and `isCurrentGesture()` holds: replay `pending.preClickMoves` via `input.handlePointerMove(m, true)`, then `input.handlePointerDown(pending.down)`. If `pending.up` exists, set `pending.replayed = true`, assign `pending.flushUp`, and schedule `pending.upTimer = window.setTimeout(..., computeClickDwellMs(pending.downAt, pending.upAt))` to dispatch `pending.move` + `pending.up` + `completeControlHandoff`. Keep `handoff.onCancel` clearing `upTimer` + `flushUp`.
4. **Update & expand tests (`BrowserStreamKeepAliveHost.test.tsx`, `input-controller.test.ts`):**
   - Forward `onPointerLeave` in `CanvasView` mock (`BrowserStreamKeepAliveHost.test.tsx:221-243`).
   - Advance `45ms` after `lease.resolve` in `mid-paste` (`:1565`) and `hide-paste` (`:1596`) before interrupting paste; verify `:1681-1703` remains unchanged.
   - Add tests for: pre-click hover buffering + clearing triggers, >600ms latest hover + 5 recent approach moves replay order ending at `down`, dwell clamping (`45ms` min, `100ms` preserved, `180ms` max), cancel/blur/privacy during dwell (`pointerCancel`, no `pointerUp`), and successor `pointerDown` flushing pending `pointerUp`.

## Todo List
```evcrate-tasks
[
  {
    "id": "implement-preclick-hover-and-dwell",
    "title": "Buffer pre-click hover moves and preserve click dwell across first-click lease acquisition",
    "blocked_by": [],
    "allowed_files": [
      "packages/ui/src/os/browser/browser-preclick-hover.ts",
      "packages/ui/src/browser-host/canvas-view.tsx",
      "packages/ui/src/browser-host/input-controller.ts",
      "packages/ui/src/os/BrowserStreamKeepAliveHost.tsx",
      "packages/ui/src/os/BrowserStreamKeepAliveHost.test.tsx",
      "packages/ui/src/browser-host/input-controller.test.ts"
    ],
    "constraints": [
      "Never call acquireBrowserControl on hover moves while !isController or !leaseToken.",
      "Do not emit synthetic pre-click pointerMove when no pre-click pointermove occurred (preserves :1681-1703, :1134-1168, :1409-1435).",
      "Keep BrowserStreamKeepAliveHost.test.tsx :1681-1703 exact output [pointerDown, pointerMove, pointerUp].",
      "Keep new helper file under 200 lines and respect strict TypeScript / verbatimModuleSyntax."
    ],
    "acceptance": [
      "Pre-click pointermoves while !isController buffer without stealing control and clear on pointerleave, blur, visibility loss, privacy, and session/epoch change.",
      "First-click acquire replays buffered approach moves ending at down coords before pointerDown, and preserves clamp(upAt - downAt, 45, 180) ms dwell before pointerUp.",
      "Cancellation during dwell emits pointerCancel without pointerUp; successor pointerDown flushes pending pointerUp cleanly before second press."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui build",
      "pnpm --filter @dam-hopper/ui test -- BrowserStreamKeepAliveHost.test.tsx input-controller.test.ts"
    ]
  }
]
```

- [x] <!-- evcrate-task:implement-preclick-hover-and-dwell --> Buffer pre-click hover moves and preserve click dwell across first-click lease acquisition

## Success Criteria & Risks
- **Success:** Typecheck and unit tests pass; Turnstile receives natural `mouseMoved` -> `mousePressed` -> 45-180 ms dwell -> `mouseReleased` even under >100 ms RTT.
- **Risk & Mitigation:** Post-`pointerup` hover jitter firing before `upTimer` completes -> caught by buffering/ignoring moves while `upTimer` is active.

## Security Considerations
- Untrusted/downscaled frames (`!drawn.inputTrusted`), stale `viewportEpoch`, privacy mode, lock screen, and profile fences still reject input buffering and fail closed.
