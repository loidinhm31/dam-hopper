# Scout 3 — touch long-press contracts

## Shared UI/browser contracts
- `packages/ui/src/components/ui/ContextMenu.tsx`: `ContextMenuRoot`, forwarded-ref `ContextMenuTrigger`, `ContextMenuPortal`, `ContextMenuContent`. Radix owns context-menu pointer anchoring, collision, focus, keyboard and dismissal. Trigger is always `asChild`; enabled triggers receive `data-dam-hopper-context-menu-trigger`; disabled triggers do not. Keyboard `ContextMenu` / Shift+F10 synthesizes a `MouseEvent("contextmenu")` at trigger center.
- `packages/ui/src/lib/context-menu-trigger-marker.ts`: composed-path marker check used by global policy.
- `packages/ui/src/hooks/use-browser-context-menu-suppression.ts`, installed once in `packages/ui/src/embed/dam-hopper-app.tsx:318-320`: document capture listener prevents native context menu on every unmarked element, never stops propagation; marked Radix triggers are skipped so Radix opens. Touch-generated `contextmenu` must preserve this path.
- `packages/ui/src/lib/context-menu-coordinator.ts`: module-scoped one-open coordination; avoid app state for gesture timers.
- `packages/ui/src/index.css:112-118`: only explicit touch policy is xterm viewport `touch-action: pan-y` plus overscroll containment. No global `touch-action:none` convention.

## Consumers / event policy
- Consumers: `packages/ui/src/components/organisms/{TreeContextMenu,GitBranchContextMenu,EditorTabContextMenu,TerminalDiagnosticsContextMenu}.tsx`; integration `ContextMenuConsumers.test.tsx`, organism tests, and `packages/ui/browser-tests/consumer-context-menu.browser.tsx`.
- Direct right-click surfaces: `packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.tsx` (`onContextMenu` opens diagnostics), `packages/ui/src/components/molecules/EditorTab.tsx` accepts `onContextMenu`; wiring also in `GitBranchControl.tsx`, `FileTree.tsx`, `WorkspacePage.tsx`.
- React convention uses `onContextMenu`; pointer handlers are reserved for explicit mobile drag behavior (`use-mobile-panel-trigger-drag.ts`, `MobileWorkspaceShell.tsx`). Avoid duplicate listeners.

## Validation and patterns
- `packages/ui/src/components/ui/ContextMenu.test.tsx`, `ContextMenuCompatibility.test.tsx`: shared exports, SSR, trigger compatibility, keyboard, dismissal, lifecycle, disabled items.
- `packages/ui/src/hooks/use-browser-context-menu-suppression.test.tsx`: capture suppression, propagation, cleanup, enabled/disabled triggers; synthetic events explicitly `cancelable:true`.
- Browser: `packages/ui/browser-tests/{consumer-context-menu,global-native-context-menu-suppression,viewport-context-menu}.browser.tsx`; use Chromium touch emulation for long-press, not only synthetic contextmenu.
- `docs/project-roadmap.md:343-346` explicitly records touch long-press untested in headless Linux. Invariant/test boundary: `docs/system-architecture.md:2032-2042`. Prior plan: `plans/260718-1559-global-native-context-menu-suppression/{plan.md,phase-01-global-native-context-menu-suppression.md}`.
- `packages/ui/package.json`: Radix `^2.2.6`, React 19, Vitest/JSDOM, Playwright; no gesture dependency. Lock resolves Radix 2.3.3 (`pnpm-lock.yaml:169,1036,5499`).
- Android policy/tests: `packages/ui/browser-tests/android-chrome-input-policy.browser.ts`, `packages/ui/src/lib/android-chrome-input-policy.test.ts`; no native context-menu bridge found.

## Risks / compatibility / accessibility
- Long-press competes with scrolling, Arborist drag, text selection, Monaco/xterm gestures, and OS callouts. Do not apply `touch-action:none` globally; preserve terminal `pan-y`; cancel on movement, up, cancel, lost capture, unmount.
- `preventDefault()`/capture can suppress scrolling, selection, click and native accessibility behavior. Preserve keyboard ContextMenu/Shift+F10 and Radix focus.
- Mobile Safari/Chrome may delay/omit contextmenu or emit compatibility mouse events. Prevent duplicate opens; test movement cancellation and real Chromium mobile emulation.
- One timer per active pointer; clear it on every termination path.
- Existing global suppression blocks native menus for unmarked app elements; route only configured triggers and avoid breaking copy/selection.

## Backend/native impact
No API, server, database, WebSocket, auth, persistence, or Rust contract appears involved; menus are frontend-only. Tauri/Android WebView can affect gesture behavior, but no native bridge/protocol change is indicated.

## Unresolved questions
- Exact trigger scope: all Radix triggers or only Explorer/branch/editor (terminal/browser surfaces may need exclusion)?
- Required duration and movement tolerance; gate on coarse-pointer detection?
- Required environments: Chromium mobile emulation, physical Android/iOS, Tauri WebView?
- Should text selection/callout remain available on unconfigured surfaces despite global suppression?
