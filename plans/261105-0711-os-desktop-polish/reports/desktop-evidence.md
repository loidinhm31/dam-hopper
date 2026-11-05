# Desktop, dock, layout, and interaction evidence

Status: complete, source inspection only. Planning authorization: native-user `plan/parallel`, protocol v3; no implementation. Root `/home/loidinh/WS/dam-hopper`; Linux x64, React 19/Rust/pnpm; date `261105`; branch `main`.

## Observed contracts & existing source anchors

### 1. Dock, persistence & icons launcher
- `packages/ui/src/os/Dock.tsx:13-31`: `APP_ICONS` uses 17 ASCII/emoji string glyphs (`>_`, `{ }`, `📁`, etc.), no SVG icons.
- `packages/ui/src/os/Dock.tsx:34,40-42`: `pinnedApps` initialized via `loadDockPins()`, saved via `saveDockPins()`.
- `packages/ui/src/os/Dock.tsx:87-91`: flush `<aside>` with `w-[var(--os-dock-width)]`, `border-r`, zero outer/inner spacing or radius.
- `packages/ui/src/os/Dock.tsx:93-150`: renders only `pinnedApps`; running unpinned apps omitted; right-click context menu absent.
- `packages/ui/src/os/Dock.tsx:153-160`: static non-interactive "OS" footer text; permanent Apps launcher/catalog trigger missing.
- `packages/ui/src/os/persistence.ts:677-717`: `OS_DOCK_STORAGE_KEY = "dam-hopper:os:v1:dock"`. `:698` resets empty pins array `[]` to `DEFAULT_DOCK_PINS` (`valid.length > 0 ? valid : [...DEFAULT_DOCK_PINS]`), preventing persistence of empty dock.
- `packages/ui/src/os/app-registry.ts:3-157`: 17 manifests define metadata but lack icon component bindings; Lucide icons exist in repo (`package.json:40`, `lucide-react: ^0.577.0`).

### 2. Layout containing blocks & maximize tile/float
- `packages/ui/src/os/OsShell.tsx:1660-1672`: workspace container `<div className="flex flex-1 min-h-0 w-full overflow-hidden">` contains `<Dock>` and `<main className="flex-1 min-h-0 relative overflow-hidden" role="main">` with `<DesktopCanvas>`.
- `packages/ui/src/os/DesktopCanvas.tsx:101-124`: root container is `relative flex-1 w-full h-full overflow-hidden`. Tile layer at `:108-118` is `absolute inset-0`; floating layer at `:121` renders directly as canvas children.
- `packages/ui/src/os/WindowFrame.tsx:380-406`:
  - Maximized (`:380-387`): `position: "fixed", inset: 0, zIndex: 50, width: "100vw", height: "100vh"`. Covers browser viewport, obscuring TopBar (`--os-topbar-height`), Dock, and notification layers.
  - Floating (`:388-401`): `position: "absolute"`, `zIndex: isFocused ? 30 : 20`, bounded within canvas.
  - Tiled (`:402-406`): `position: "relative", width: "100%", height: "100%"`.
- `packages/ui/src/os/window-ops.ts:594-609`: `toggleMaximizeWindow(session, windowId)` only flips `maximized: !window.maximized`.
  - Tiled windows: window remains in `desktop.tree`; frame switches to `fixed` (`100vw, 100vh`) over sibling tiles, breaking work area without restructuring tile topology.
  - Floating windows: un-maximize restores to saved `floatBounds`, but maximize breaks outside canvas containing block.
  - Required work area: Maximize must fill desktop work area within canvas bounds (`<main>`), leaving TopBar and floating Dock accessible.

### 3. Viewport-vs-canvas support thresholds
- `packages/ui/src/os/DesktopCanvas.tsx:24-38`: `ResizeObserver` on `containerRef` calls `setViewport({ width: entry.contentRect.width, height: entry.contentRect.height })`. Sets store `viewport` to *canvas* dimensions (excluding TopBar and Dock).
- `packages/ui/src/os/use-os-viewport.ts:13-25`: reads canvas `viewport` from store; line 24 evaluates `isUnsupported: width < 1024 || height < 640`.
  - Defect: at minimum supported browser viewport `1024×640`, canvas width is `~980px` (< 1024) and height is `~606px` (< 640), incorrectly triggering `isUnsupported: true`.
  - Thresholds (`isUnsupported`, `isCompact`, `isStandard`) must observe browser viewport (`window.innerWidth/innerHeight`), while window layout uses canvas content dimensions.
- `packages/ui/src/os/os.css:1-20,64-69`: `--os-topbar-height: 40px/36px/34px`, `--os-dock-width: 48px/44px`, `.os-viewport-fallback`.

### 4. Context menus, coordinator, Cognito & cursor scoping
- `packages/ui/src/lib/context-menu-coordinator.ts:1-27`: module-scoped singleton `claimContextMenu`/`releaseContextMenu` with global scroll listeners.
- `packages/ui/src/lib/context-menu-trigger-marker.ts:1-10`: marker attribute `data-dam-hopper-context-menu-trigger`.
- `packages/ui/src/components/ui/ContextMenu.tsx:20-65,72-110`: wraps `@radix-ui/react-context-menu`; handles `ContextMenu` / `Shift+F10` keyboard triggers. `:112-125`: `ContextMenuPortal` mounts into `document.body`.
- Desktop canvas background: currently lacks a context menu trigger element; right-click is unhandled.
- Cognito isolation: `useCognitoModeStore.getState().active` checked in `WindowFrame.tsx:88-97` and `CommandPalette.tsx:87-92`, but `context-menu-coordinator.ts` lacks Cognito subscription. Open context menus must auto-dismiss on Cognito activation.
- Cursor scoping: Radix portals mount into `document.body` outside `.os-shell`. Themed cursor styling (`system` vs `theme`) must apply to `document.body[data-os-cursor]` or portal container, preserving semantic cursors (`cursor-pointer`, `cursor-move`, `cursor-*-resize`, `cursor-grab`).

### 5. Full-app E2E fixtures & human review convention
- Fixtures:
  - `packages/ui/e2e/fixtures/application-fixture.ts:28-82`: `test.extend` provides `appServices` (isolated backend container), `authenticatedContext`, `authenticatedPage`.
  - `packages/ui/e2e/fixtures/application-services.ts`: starts backend container, manages seed digest and token.
  - `packages/ui/e2e/fixtures/capture-evidence.ts:22-70,120-220`: evidence session staging (`.e2e-staging`), checksum calculation, PNG validation.
- Standard viewport checkpoints: `screenshot.png` (1440×900), `fhd.png` (1920×1080), `compact.png` (1024×640).
- Review convention: `packages/ui/e2e/os-cutover/review.md:1-23` and `os-lifecycle/review.md:1-23`:
  Status `PENDING_HUMAN_REVIEW`, resolution checklist, and `evidence.json` tracking PNG SHA256 hashes and dimensions.
- Existing test commands:
  - `pnpm --filter @dam-hopper/ui test`: vitest unit tests.
  - `pnpm --filter @dam-hopper/ui test:browser`: vitest browser-playwright suite.
  - `pnpm --filter @dam-hopper/ui test:e2e`: Playwright containerized E2E suite.

## Architecture recommendation: module boundaries & sequential integration

### Disjoint module boundaries (isolated implementation)
1. `packages/ui/src/os/app-icons.tsx` (new): pure mapping of 17 `OsAppId`s to themed Lucide SVG icons.
2. `packages/ui/src/os/dock-context-menu.tsx` (new): Radix context menu for dock items (pin/unpin, new window, running instances).
3. `packages/ui/src/os/DesktopContextMenu.tsx` (new): background canvas context menu (Apps submenu, New Terminal with context, Palette, Appearance).
4. `packages/ui/src/os/cursor.ts` (new): cursor token and attribute synchronization for `system` / `theme` modes.

### Sequential shell & CSS integration order
1. `packages/ui/src/os/os.css`: CSS variables for floating dock padding, item spacing, outer margin, corner radius, work-area positioning, theme cursors.
2. `packages/ui/src/os/persistence.ts`: fix `loadDockPins` to permit empty array `[]` without falling back to defaults.
3. `packages/ui/src/os/use-os-viewport.ts`: decouple window viewport thresholds from canvas dimensions.
4. `packages/ui/src/os/Dock.tsx`: floating dock geometry, Lucide icons, running unpinned apps display, permanent Apps launcher button.
5. `packages/ui/src/os/DesktopCanvas.tsx` & `packages/ui/src/os/WindowFrame.tsx`: work area containing block for maximize (filling canvas, leaving TopBar/Dock visible) and blank desktop context menu trigger.
6. `packages/ui/src/os/window-ops.ts`: maximize handling for tiled/floating windows preserving tree topology and float bounds.
7. `packages/ui/src/lib/context-menu-coordinator.ts` & `packages/ui/src/components/ui/ContextMenu.tsx`: Cognito dismissal listener and portal cursor scoping.
8. `packages/ui/src/os/OsShell.tsx`: sequential layout integration connecting floating dock, canvas, and cursor attribute.
9. `packages/ui/e2e/os-desktop-polish/`: full-app E2E visual review and capture spec.

## Exact source file ownership list
- `packages/ui/src/os/os.css`
- `packages/ui/src/os/app-icons.tsx` (new)
- `packages/ui/src/os/Dock.tsx`
- `packages/ui/src/os/persistence.ts`
- `packages/ui/src/os/use-os-viewport.ts`
- `packages/ui/src/os/DesktopCanvas.tsx`
- `packages/ui/src/os/WindowFrame.tsx`
- `packages/ui/src/os/window-ops.ts`
- `packages/ui/src/os/DesktopContextMenu.tsx` (new)
- `packages/ui/src/os/dock-context-menu.tsx` (new)
- `packages/ui/src/os/cursor.ts` (new)
- `packages/ui/src/lib/context-menu-coordinator.ts`
- `packages/ui/src/components/ui/ContextMenu.tsx`
- `packages/ui/src/os/OsShell.tsx`
- `packages/ui/e2e/fixtures/application-fixture.ts` (reference)
- `packages/ui/e2e/fixtures/capture-evidence.ts` (reference)

## Status & checks
- Status: complete. Source code inspection and architectural mapping complete. No runtime tests, builds, lints, or implementation executed.
- Unresolved questions: none blocking.
