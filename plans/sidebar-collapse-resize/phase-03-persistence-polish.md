# Phase 03 -- Persistence & Polish

> Parent: [plan.md](./plan.md)
> Dependencies: Phase 01, Phase 02

## Overview

- **Date**: 2026-03-24
- **Description**: Final polish -- ensure persistence works, add keyboard shortcut, handle edge cases.
- **Priority**: P2
- **Implementation status**: done
- **Review status**: approved

## Key Insights

- localStorage is synchronous and available in Electron renderer
- Sidebar state read in two places (AppLayout + TerminalsPage) -- must stay in sync via localStorage
- xterm fitAddon may fire rapidly during CSS transition -- may need debounce

## Requirements

1. Persist sidebar collapsed state: `devhub:sidebar-collapsed`
2. Persist tree width: `devhub:tree-width`
3. Keyboard shortcut: `Ctrl/Cmd+B` toggles sidebar (nice-to-have)
4. No xterm flicker during sidebar transition
5. All 4 pages work correctly with collapsed sidebar

## Related Code Files

- `packages/web/src/components/templates/AppLayout.tsx`
- `packages/web/src/pages/TerminalsPage.tsx`
- `packages/web/src/components/organisms/TerminalPanel.tsx` (ResizeObserver)

## Implementation Steps

### 1. localStorage Persistence (covered in Phase 01/02)

Already handled in Phase 01 (sidebar) and Phase 02 (tree width). This phase verifies correctness:
- Sidebar: `localStorage.getItem("devhub:sidebar-collapsed") === "true"`
- Tree width: `parseInt(localStorage.getItem("devhub:tree-width") || "224", 10)`

### 2. Keyboard Shortcut (nice-to-have)

Add to AppLayout and TerminalsPage:
```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "b") {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      toggleSidebar();
    }
  };
  document.addEventListener("keydown", handler);
  return () => document.removeEventListener("keydown", handler);
}, [toggleSidebar]);
```

Guard against firing inside xterm: check if `document.activeElement` is inside `.xterm` container.

### 3. Transition Polish

- If xterm flickers during sidebar transition, debounce `fitAddon.fit()` by 200ms in TerminalPanel's ResizeObserver callback
- Test: collapse sidebar while terminal is active, verify no visual glitch

### 4. Testing Checklist

- [ ] Sidebar collapse on Dashboard page
- [ ] Sidebar collapse on Terminals page
- [ ] Sidebar collapse on Git page
- [ ] Sidebar collapse on Settings page
- [ ] Tree panel resize (drag left to 160px min)
- [ ] Tree panel resize (drag right to 400px max)
- [ ] Sidebar state persists across page nav
- [ ] Tree width persists across page nav
- [ ] Both persist across app restart
- [ ] xterm refits after sidebar collapse
- [ ] xterm refits after tree resize
- [ ] No text selection during drag
- [ ] Keyboard shortcut Ctrl/Cmd+B toggles sidebar

## Success Criteria

- All persistence verified across navigation + restart
- No visual glitches or layout breakage
- Keyboard shortcut works (if implemented)

## Risk Assessment

- **Low**: `storage` event could sync tabs in future multi-window scenario -- not needed now
- **Low**: xterm flicker during transition -- debounce as mitigation

## Security Considerations

None.

## Next Steps

Plan complete. Ready for implementation.
