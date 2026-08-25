# UI/UX Review: Touch Long-Press Context Menus

## Scope
Read-only review of Explorer rows and editor tabs for plan `plans/260812-0151-touch-long-press-right-click/`. No `docs/design-guidelines.md` exists; review used `docs/frontend-components.md` and `docs/system-architecture.md`.

## Must preserve
- Radix `ContextMenu.Trigger` remains the sole 700 ms non-mouse long-press owner.
- Keep direct `asChild` targets, marker, body portal, one-open coordination, focus restoration, Escape/outside/scroll dismissal, mouse right-click, and keyboard ContextMenu/Shift+F10.
- Preserve Explorer Arborist drag ref, selection, held-row action targeting, scroll/drag cancellation.
- Preserve editor-tab held-tab targeting, close/Git controls, horizontal scroll, and menu actions.
- Monaco, Markdown/image/video, binary, diff, and large-file previews remain out of scope.

## Findings
- `packages/ui/src/components/molecules/EditorTab.tsx:48-61` renders `div[role=tab]` without `tabIndex`; actual tabs are not keyboard-focusable. This is a pre-existing accessibility issue, not silently folded into touch work. Keep shared trigger keyboard coverage and log separate follow-up unless scope is expanded.
- Nested Explorer Git badge (`FileTree.tsx:243-258`) and editor Git/close buttons (`EditorTab.tsx:71-101`) can bubble touch `pointerdown` to the parent Radix trigger. Existing click `stopPropagation` is too late. Test long-pressing nested controls; if parent-menu opening is undesirable, use a local touch/pen-only propagation guard, never a global listener or pointer-default suppression.
- Explorer rows (`rowHeight=24`) and tabs/menu items are dense for touch. Validate on physical devices; target-size redesign is separate scope.
- Existing browser tests cover native contextmenu but not 700 ms pointer holds or editor-tab fixture. Add Chromium touch-emulation coverage for hold, movement/scroll/drag/pointer cancellation/up/unmount, duplicate native fallback, and no accidental activation.

## Unresolved questions
1. Should actual editor-tab keyboard focus be fixed in a separate accessibility issue?
2. Should holding nested close/Git controls open the parent menu or only operate that control?
3. Are 24 px rows acceptable for supported touch devices?
4. Which physical Android/iOS/Tauri environments block release?
5. Should holding an unselected Explorer row change selection? Current plan preserves existing behavior.
