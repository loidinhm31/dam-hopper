# Editor touch/context-menu scout
- MonacoHost.tsx: no contextmenu/touch/pointer handling; only onMouseDown gutter, blur, shortcuts.
- EditorTabs.tsx wraps each EditorTab in ContextMenu.Root/Trigger and EditorTabContextMenu.
- ContextMenu.tsx ContextMenuTrigger uses Radix asChild and keyboard synthetic contextmenu; no long-press adapter.
- use-browser-context-menu-suppression.ts globally blocks unmarked native menus; marker required.
- Tests: ContextMenu.test.tsx, ContextMenuCompatibility.test.tsx, use-browser-context-menu-suppression.test.tsx; browser-tests consumer-context-menu.browser.tsx, viewport-context-menu.browser.tsx, global-native-context-menu-suppression.browser.tsx.
- No editor touch/long-press browser coverage found. Risk: Monaco surface has no marked trigger, so suppression means long-press there has no app menu.
