# Editor touch/context-menu scout (retry)

## Findings

- `packages/ui/src/components/organisms/MonacoHost.tsx:102-205` is the Monaco lifecycle boundary. It restores view state, installs save, handles only Git gutter `onMouseDown` (`:124-137`), blur, resize, keyboard search, and wheel zoom. No contextmenu, pointer, touch, selection, or long-press handling. It retains `editor.getDomNode()`, making it the smallest text-surface observation boundary.
- `MonacoHost.test.tsx` covers Android read-only/blur and mount plumbing only; no selection, cursor, pointer, contextmenu, or touch tests. Its fake editor surface/`lastOnMount` seam can support focused unit tests; real gesture generation needs browser coverage.
- `EditorTabs.tsx:200-260` clearly separates tab bar from editor area. Each tab is `ContextMenu.Root` + `ContextMenu.Trigger` (`:209-252`) with `EditorTabContextMenu`; active editor/viewers start at `:262` and are not wrapped in a trigger.
- `EditorTab.tsx:48-62` is the ref-forwarding, `select-none` tab div with click and optional contextmenu. Close/Git buttons stop clicks. No touch adapter. Radix wrapping owns tab menu behavior.
- `EditorTabContextMenu.tsx` only provides Close / Close Other Tabs / Close All actions; no editor text actions.
- `ContextMenu.tsx:67-110` forwards Radix `Trigger` with `asChild`, marks enabled triggers for suppression, and synthesizes `contextmenu` for ContextMenu / Shift+F10 (`:81-99`). It adds no custom touch handling.
- Global suppression is `use-browser-context-menu-suppression.ts:8-23`, installed once at `dam-hopper-app.tsx:317-320`. Capture prevents every unmarked contextmenu; only marked shared triggers are exempt. Monaco is unmarked, so a touch-generated contextmenu is currently suppressed before app handling.

## Smallest maintainable boundary

Clarify what “existing app right-click/context-menu behavior” means: app menu exists for editor **tabs**, but no editor-content consumer/action model exists. If target is tabs, keep implementation at the tab `ContextMenu.Trigger` (Radix owns long-press), with browser coverage. If target is Monaco text actions, add a dedicated Monaco-host context-menu consumer/trigger around `editor.getDomNode()` (or explicit Monaco bridge), and route touch/mouse/keyboard through one path. Do not put tab actions into Monaco or add a global touch listener.

Avoid global `ContextMenu.tsx` changes unless policy is intended app-wide. Avoid preventing touchstart/pointerdown: it can break selection, cursor placement, scroll, and accessibility. Any custom long-press must cancel on movement/up/cancel, preserve mouse right-click and keyboard invocation, and deduplicate timer plus browser contextmenu.

## Validation cases

1. Tab desktop right-click and touch long-press open exactly one menu targeting that tab; close/Git controls do not open it accidentally.
2. Monaco caret placement, drag selection, scrolling, wheel zoom, gutter click, and Android read-only remain unchanged; long-press opens the explicitly chosen app menu at touch coordinates (if defined).
3. Movement threshold, pointer cancel/up, duplicate timer+contextmenu, reanchor, Escape/outside close.
4. ContextMenu/Shift+F10 retain Radix focus/ARIA behavior.
5. Unconfigured surfaces stay native-menu suppressed; configured triggers open app menus. Use real Chromium mobile emulation, not only synthetic events.
6. Unit candidates: `ContextMenu.test.tsx`, `ContextMenuCompatibility.test.tsx`, suppression hook test, `MonacoHost.test.tsx`; browser candidates: `consumer-context-menu.browser.tsx`, `global-native-context-menu-suppression.browser.tsx`, `viewport-context-menu.browser.tsx`.

## Unresolved questions

- What menu/actions should Monaco text long-press invoke? None currently exist.
- Does “existing behavior” mean Monaco built-in menu, tab Close menu, or suppression semantics?
- Is scope tabs only, Monaco text, or preview surfaces too?
