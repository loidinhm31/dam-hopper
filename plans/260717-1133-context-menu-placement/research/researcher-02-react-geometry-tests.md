# React geometry/test research: context menus in floating panels

Research date: 2026-07-17 (Asia/Saigon)

## Executive finding

The bad offset has a concrete CSS-coordinate cause. Floating panels are positioned ancestors with `backdrop-blur-xl` (`backdrop-filter`) and `overflow-hidden`: `TerminalFloatingFilePanel.tsx:200-218` and `TerminalFloatingToolPanel.tsx:148-160`. A filtered ancestor establishes the containing block for descendant `position: fixed`; inline menus then interpret viewport `clientX/clientY` inside the panel coordinate space. Panel offset is effectively added again, and overflow may clip the menu.

Use one body-portaled, fixed-position context-menu surface. Keep click coordinates in viewport space, measure the rendered menu, then flip/clamp against viewport bounds. Do not solve this with panel-relative coordinate subtraction: that remains fragile under drag, nested filters, transforms, scroll, and reuse outside a float.

## Existing implementation surface

- Stack: React/ReactDOM 19 peer + dev dependencies (`packages/ui/package.json:43-57`), Vitest 4.1.5, Playwright 1.61.1, `@vitest/browser-playwright` 4.1.5 (`packages/ui/package.json:48-61`).
- Browser suite: `pnpm --filter @dam-hopper/ui test:browser`; Chromium/headless, `browser-tests/**/*.browser.{ts,tsx}` (`packages/ui/vitest.browser.config.ts:14-21`). Tests mount with React `createRoot` into `document.body` and dispatch real DOM events (`packages/ui/browser-tests/terminal-notification-ui.browser.tsx:27-48,86-139`).
- Floating files panel: filtered/overflow-hidden panel (`TerminalFloatingFilePanel.tsx:200-220`) contains Explorer/FileTree and Editor (`:244-277`).
  - File tree records viewport coordinates (`FileTree.tsx:358-361`) but renders `TreeContextMenu` inline (`:707-723`). Menu is fixed with hard-coded `180x200` clamp and no portal (`TreeContextMenu.tsx:115-171`). This is a direct reproduction path.
  - Editor tabs convert viewport coordinates to container-local values (`EditorTabs.tsx:243-257`) and render an absolute inline menu (`:269-275`; `EditorTabContextMenu.tsx:76-110`). It avoids the same double-offset, but can still be clipped and has a separate hard-coded geometry policy.
- Floating tools panel: filtered/overflow-hidden shell (`TerminalFloatingToolPanel.tsx:148-160,183`) can host Git views with inline fixed menus.
  - Git history uses raw viewport coordinates (`GitLogTree.tsx:280-299,394-420`), renders inline (`:524-537`), and menu uses fixed positioning (`:154-165`): direct failure path.
  - Changed files menu uses inline fixed positioning plus hard-coded clamp (`ChangedFilesList.tsx:183-240`): direct failure path when hosted in a float.
  - Commit file menu clamps raw viewport coordinates on open (`CommitDetailsPanel.tsx:108-125`) and has its own inline menu/outside-click logic (`:265-330`): same risk.
- Existing good escape hatch: branch menu portals directly to `document.body` (`GitBranchContextMenu.tsx:80-118`). It still uses guessed `190x96` geometry and lacks lower-bound/margin clamping (`:4-14`).
- Terminal diagnostics uses fixed viewport coordinates and hard-coded dimensions (`TerminalDiagnosticsContextMenu.tsx:39-55,86-107`) but is rendered at `WorkspacePage.tsx:1574-1583`, outside the floats. Not currently offset; migrate for consistency and future nesting.
- All menus duplicate document `mousedown` + Escape listeners; focus semantics are inconsistent. Diagnostics autofocuses first item (`TerminalDiagnosticsContextMenu.tsx:109-115`); Tree menu lacks `role=menu/menuitem` (`TreeContextMenu.tsx:145-169`).

## Recommended minimal design

### 1. Pure placement helper

Add `packages/ui/src/lib/context-menu-placement.ts` with no React dependency:

```ts
placeContextMenu({ anchor: {x, y}, menu: {width, height},
  viewport: {left, top, right, bottom}, gap: 2, margin: 8 }) => {x, y}
```

Algorithm per axis:

1. Prefer `anchor + gap` (right/below cursor).
2. If it overflows, flip to `anchor - menuSize - gap` (left/above cursor).
3. Clamp final value to `[viewportStart + margin, viewportEnd - margin - menuSize]`.
4. If menu exceeds available viewport, pin start to margin and let surface use `max-width/max-height` + scrolling.

This keeps the menu adjacent to the pointer when space exists. Current `min(anchor, edge-menuSize)` can move a large/tall menu far from the click and relies on guessed dimensions.

Accept viewport rect as input rather than reading globals in the helper. Component can initially use the layout viewport; optionally feed `visualViewport.offsetLeft/Top/width/height` for pinch-zoom support without changing the algorithm.

### 2. Shared body-portaled surface

Add `packages/ui/src/components/ui/ViewportContextMenu.tsx` (name illustrative):

- `createPortal(..., document.body)`, `position: fixed`, high shared z-index; coordinates remain `clientX/clientY`.
- First render hidden at a neutral coordinate; in `useLayoutEffect`, read `ref.getBoundingClientRect()`, call pure helper, set position before paint. Avoid constants for menu height/width because content/error/labels vary.
- Observe size with `ResizeObserver` so async error text or disabled/action changes cannot overflow after open. Recompute on viewport resize; close on scroll is acceptable and simpler than tracking every scrolling ancestor.
- Centralize outside `pointerdown`, Escape, and suppression of nested native `contextmenu`. Keep action construction and styling in current menu components.
- Focus first enabled menuitem after placement. For keyboard invocation (`ContextMenu`, Shift+F10), restore trigger focus on Escape; mouse invocation should not steal focus back from an outside-click target. Existing notification tests demonstrate this distinction (`terminal-notification-ui.browser.tsx:86-139`).
- Convert EditorTabs to retain viewport `event.clientX/clientY`; remove container subtraction once it uses the portal.

KISS boundary: do not add Floating UI/Radix ContextMenu only for this bug. Existing dependencies do not include either, and a two-axis measured placement function plus portal is enough. Do not create one geometry helper per menu.

## Regression test shape

### Pure unit tests

Create `packages/ui/src/lib/context-menu-placement.test.ts`:

- center click => `(anchor + gap)` and remains close;
- right edge flips left; bottom edge flips above; bottom-right flips both;
- negative/top-left input clamps to margin;
- menu larger than viewport pins to margin without negative values;
- non-zero viewport origin (future `visualViewport`) works;
- measured variable height changes result (proves no hard-coded height dependency).

### Real Chromium component regression

Create `packages/ui/browser-tests/viewport-context-menu.browser.tsx`; existing config auto-discovers it.

Build a fixture with an absolutely offset panel (for example left 240/top 160), `overflow:hidden`, and inline `style={{backdropFilter: "blur(8px)"}}`. Put a trigger near its lower-right edge, dispatch a bubbling/cancelable `contextmenu` with coordinates from the trigger rect, and render the shared menu.

Assert:

- menu is portaled under `document.body`, not under filtered panel;
- menu rect is within viewport margin and is not intersected/clipped by panel bounds;
- in open space, menu top/left differ from click by only configured gap (this catches the old panel-offset error);
- near viewport right/bottom, rect flips left/above pointer and remains fully visible;
- a dynamically taller menu repositions after `ResizeObserver` delivery;
- second right-click reanchors existing menu;
- first enabled item receives focus; Escape closes/restores keyboard trigger; outside pointerdown closes while preserving outside target focus;
- action click fires exactly once and native browser menu is prevented.

Prefer bounding-rect assertions with 1px tolerance over screenshots. Pure tests own exact arithmetic; browser test owns CSS containing-block/portal behavior. Do not resize the browser for every case—place triggers relative to `innerWidth/innerHeight` and keep tiny-viewport cases pure.

## Rollout/acceptance

Migrate Tree, Editor Tab, Git History, Changed Files, Commit Details, Branch, and Terminal Diagnostics consumers to the shared surface. Acceptance: right-click within either floating panel opens adjacent to pointer; every menu remains within viewport after panel drag/resize; no clipping by float; keyboard invocation and dismissal remain accessible; unit + Chromium browser suite pass.

## Edge cases / unresolved questions

- Decide whether scroll closes or live-repositions menus. Recommendation: close on scroll for deterministic desktop context-menu behavior.
- Confirm target browser policy for pinch zoom. If required, use `visualViewport`; otherwise layout viewport is lower complexity.
- Audit any dynamically injected/custom tool content not present in static source; it should consume the same surface rather than introduce another inline fixed menu.

## Decision update

The research initially recommended a custom measured surface. Plan validation selected Radix Context Menu as primary, so the browser/component test strategy now verifies Radix Portal, Content collision, trigger compatibility, and dismissable-layer behavior. The custom surface remains the fallback only if the Phase 01 compatibility spike fails.
