# Scout Report: Touch Long-Press as App Right-Click

## Scope
- Repository: `/mnt/data/ws/sharing/dam-hopper`
- Isolated worktree: `.worktree`, branch `feat/touch-long-press-right-click`
- Target: touch long-press invokes existing app context-menu behavior; whole-project review, focus Explorer and Editor.
- Scout inputs: Explorer scout terminal report; editor scout retry report; shared-contracts scout report.

## Explorer
- `packages/ui/src/components/organisms/FileTree.tsx`
  - `NodeRenderer` (~137–219): virtualized Arborist row; forwards drag handle; has context-menu wiring but no touch/pointer long-press handling.
  - `handleActivate` (~501), `getContextNodes` (~614), `handleMove` (~700), `<Tree>` (~978), render callback (~1024).
  - Language-filter rows intentionally have no menus/dragging; `UploadDropzone` is a separate external-drop surface.
- `packages/ui/src/components/organisms/TreeContextMenu.tsx`: existing file/folder menu actions; must be reused, not duplicated.
- Shared context-menu boundary:
  - `packages/ui/src/components/ui/ContextMenu.tsx`
  - `packages/ui/src/lib/context-menu-trigger-marker.ts`
  - `packages/ui/src/lib/context-menu-coordinator.ts`
  - `packages/ui/src/hooks/use-browser-context-menu-suppression.ts`
- Relevant tests: `ContextMenuConsumers.test.tsx`, `TreeContextMenu.test.ts`, `ContextMenu.test.tsx`, `ContextMenuCompatibility.test.tsx`, browser context-menu suites under `packages/ui/browser-tests/`.
- Risks: preserve Arborist drag refs; cancel gesture on movement/up/cancel/lost capture/unmount; track pointer id; avoid duplicate native touch menus; define selection behavior for existing/multi-selected rows.

## Editor
- `packages/ui/src/components/organisms/MonacoHost.tsx:102-205`: save, Git gutter, blur, resize, search, wheel zoom; no context-menu/pointer/touch/long-press handling.
- `packages/ui/src/components/organisms/EditorTabs.tsx:200-260`: tab menus use Radix `ContextMenu.Root`/`Trigger`; active editor surface begins around `:262` and is not wrapped.
- `packages/ui/src/components/molecules/EditorTab.tsx:48-62`: ref-forwarding, `select-none` tab with click/context-menu support; Radix owns its menu trigger behavior.
- `packages/ui/src/components/organisms/EditorTabContextMenu.tsx`: Close, Close Other Tabs, Close All only.
- `packages/ui/src/components/ui/ContextMenu.tsx`: Radix trigger plus keyboard ContextMenu/Shift+F10 synthesis; no touch adapter.
- `use-browser-context-menu-suppression.ts` is installed from `packages/ui/src/embed/dam-hopper-app.tsx:317-320`; unmarked Monaco surface context menus are suppressed.
- `MonacoHost.test.tsx` covers Android read-only/blur, not gestures; no editor long-press browser coverage.
- Key ambiguity: existing app menu actions exist for editor tabs, not Monaco text. Do not invent a Monaco text menu without a product decision. If text long-press is required, it needs a dedicated editor-to-context-menu bridge around `editor.getDomNode()` and defined actions.

## Shared contracts and whole-project impact
- `ContextMenuTrigger` is `asChild`; enabled triggers receive `data-dam-hopper-context-menu-trigger` and are exempt from global native-menu suppression. Keyboard context-menu behavior must remain.
- Global suppression prevents native context menus on unmarked elements without stopping propagation. Touch-generated `contextmenu` must route through a marked Radix trigger or an explicit app bridge.
- Existing touch policy is narrow: `packages/ui/src/index.css:112-118` uses `touch-action: pan-y` for xterm. Do not add global `touch-action: none`.
- Pointer handlers are currently reserved for explicit mobile drag behavior (`use-mobile-panel-trigger-drag.ts`, `MobileWorkspaceShell.tsx`). Avoid duplicate listeners and unrelated backend/native changes.
- Dependencies: React 19, Radix `^2.2.6` (lock resolves 2.3.3), Vitest/JSDOM, Playwright; no gesture dependency.
- No API, server, database, WebSocket, auth, persistence, or Rust contract appears affected.
- `docs/project-roadmap.md:343-346` records touch long-press as untested in headless Linux; `docs/system-architecture.md:2032-2042` defines the context-menu boundary.

## Likely smallest design boundary
1. Add one reusable long-press adapter at the shared context-menu trigger boundary, gated to `pointerType === "touch"`/coarse pointers, or a focused hook composed by the existing trigger. Reuse the bubbling `contextmenu` path so Radix and global suppression remain the source of truth.
2. Apply it to Explorer rows and editor tabs first, preserving existing right-click, keyboard, selection, drag, scrolling, text selection, and Radix focus behavior.
3. Treat Monaco text as a separate decision/scope; current evidence does not show an existing app context menu for text.
4. Use real Chromium mobile emulation for browser validation; supplement with unit tests for timer lifecycle and duplicate/cancel behavior.

## Risks and validation cases
- Cancel on movement threshold, pointerup, pointercancel, lostpointercapture, and unmount.
- Prevent duplicate opens when a browser emits a native `contextmenu` after the synthetic one.
- Long-press must not trigger click/open, start tree drag, interfere with scrolling, or break selection/callouts.
- Validate selected and unselected Explorer rows, multi-selection, drag initiation, editor tab targeting, keyboard ContextMenu/Shift+F10, Escape/outside dismissal, and desktop mouse right-click.

## Unresolved questions
1. Does Editor scope mean editor tabs only, or Monaco text/preview surfaces too?
2. What long-press delay and movement tolerance should product use?
3. Should long-press on an unselected Explorer row select it before opening, while preserving multi-selection on an already-selected row?
4. Which physical/browser environments are release requirements: Chromium mobile emulation, Android Chrome, iOS Safari, Tauri/WebView?
