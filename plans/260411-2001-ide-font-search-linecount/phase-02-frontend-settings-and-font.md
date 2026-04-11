# Phase 02 — Frontend: Settings Store + Appearance UI + Font Apply

## Context links
- Plan: ../plan.md
- Phase 01: ./phase-01-backend-config-and-search.md

## Overview
- Date: 2026-04-11
- Description: Create `useSettingsStore` (Zustand) hydrated on boot from `/api/global-config`, render an Appearance section in `SettingsPage`, apply system font via CSS var on `:root`, apply editor font via Monaco `updateOptions`, and add Ctrl+Shift+MouseWheel handler with debounced server save.
- Priority: P2
- Implementation status: done
- Review status: done
- Completed: 2026-04-11

## Key Insights
- Existing `useUpdateConfig` flow in `api/queries.ts:151` is the pattern for `useUpdateUiConfig`.
- `MonacoHost.tsx` is lazy-loaded; settings store must be imported eagerly in app shell so font applies before Monaco mounts.
- Monaco's `mouseWheelZoom` only handles Ctrl; for Ctrl+Shift we attach a `wheel` listener to `editor.getDomNode()`.
- `index.css` lacks `--app-font-size` var; need to wire one and reference from `body`.

## Requirements
- `useSettingsStore`: state `{ systemFontSize, editorFontSize, editorZoomWheelEnabled, hydrated }`, actions `{ hydrate, set(partial), saveDebounced(partial) }`.
- Hydration on app boot in `App.tsx` (single fetch, then mark hydrated).
- Settings page: Appearance section. Two number inputs (system, editor) clamped 10-32, toggle for Ctrl+Shift+Wheel zoom. Debounced 500ms via `saveDebounced`.
- CSS var `--app-font-size` set on `:root` whenever store changes.
- Monaco subscribes to store on mount; calls `editor.updateOptions({ fontSize })` on change.
- Wheel handler: `if (e.ctrlKey && e.shiftKey && wheelEnabled) { e.preventDefault(); store.set({ editorFontSize: clamp(current ± delta, 10, 32) }); store.saveDebounced(...) }`.

## Architecture
```
App.tsx
  └─ on mount: useSettingsStore.hydrate() → fetch /api/global-config → set store
       └─ store change → set --app-font-size on :root
MonacoHost
  └─ on mount: subscribe to store.editorFontSize → editor.updateOptions
  └─ on mount: addEventListener("wheel", wheelHandler) on editor.getDomNode()
SettingsPage
  └─ Appearance section → bind to store + saveDebounced
```

## Related code files
- packages/web/src/api/queries.ts
- packages/web/src/components/pages/SettingsPage.tsx
- packages/web/src/components/organisms/MonacoHost.tsx
- packages/web/src/index.css
- packages/web/src/App.tsx
- packages/web/src/stores/editor.ts (reference for Zustand pattern)

## Implementation Steps
1. **Store:** Create `stores/settings.ts` with Zustand. State + `hydrate()` + `saveDebounced()` (`setTimeout` ref).
2. **Query/mutation:** Add `useUiConfig` (read) and `useUpdateUiConfig` (POST `/api/global-config/ui`) in `api/queries.ts`. Add transport case in `ws-transport.ts` for `global-config:updateUi`.
3. **Boot hydration:** In `App.tsx`, call `useSettingsStore.getState().hydrate()` once on mount.
4. **CSS var apply:** Subscribe to store outside React: `useSettingsStore.subscribe(s => document.documentElement.style.setProperty("--app-font-size", s.systemFontSize + "px"))`.
5. **CSS rule:** In `index.css`, add `:root { --app-font-size: 14px; } body { font-size: var(--app-font-size); }` (verify no conflicts).
6. **Settings UI:** New `SettingsAppearanceSection.tsx` with two number inputs + toggle. Bind via `useSettingsStore`.
7. **Monaco apply:** In `MonacoHost.tsx::handleMount`, read `useSettingsStore.getState().editorFontSize`, set in options. Add subscribe-then-updateOptions useEffect.
8. **Wheel handler:** In `MonacoHost.tsx::handleMount`, attach `wheel` listener on `editor.getDomNode()`. Cleanup on unmount.
9. **Manual smoke:** Reload, change font in Settings, verify both Monaco and body font update; verify Ctrl+Shift+Wheel changes editor font and persists across reload.

## Todo list
- [ ] Create `stores/settings.ts`
- [ ] Add `useUiConfig` + `useUpdateUiConfig` queries
- [ ] Add `global-config:updateUi` to ws-transport
- [ ] Hydrate on App mount
- [ ] Wire CSS var subscription
- [ ] Add `--app-font-size` to `index.css`
- [ ] Build `SettingsAppearanceSection`
- [ ] Apply font in MonacoHost + wheel handler
- [ ] Smoke test reload + persistence

## Success Criteria
- Changing font in Settings page updates body text and editor immediately.
- Ctrl+Shift+Wheel inside editor changes editor font (not body) and persists after reload.
- Toggling "wheel zoom enabled" off disables the wheel handler.
- Out-of-range input clamped client-side AND rejected server-side.

## Risk Assessment
- **CSS var collisions:** Audit `index.css` for existing `font-size` rules. If `body` already has explicit `font-size`, use `font-size: var(--app-font-size, 14px)`.
- **Wheel handler stealing scroll:** Only `preventDefault` when modifier keys held — pass-through otherwise.

## Security Considerations
- Client clamps but server is source of truth for validation.
- Debounce prevents request flooding (one save per 500ms idle).

## Next steps
Phase 03 adds the search panel scope toggle and selection-to-search wiring.
