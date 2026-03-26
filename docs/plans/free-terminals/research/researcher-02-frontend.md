# Research: Frontend Terminal Tree + UI for Free Terminals

## Key Findings

### 1. useTerminalTree.ts
- Returns `TreeProject[]` — no non-project section exists
- Extend to return both projectTree and freeTerminals
- Filter sessions with `free:*` prefix from sessionMap

### 2. TerminalsPage.tsx
- Session IDs: `terminal:${project}:${name}:${timestamp}`
- Add `free:${Date.now()}` convention for free terminals
- `tabLabel()` needs `free:` prefix case
- Need new `handleAddFreeTerminal()` handler

### 3. TerminalTreeView.tsx
- Renders only TreeProject[] with expandable nodes
- Add new "Terminals" section above/below projects
- New props: `freeTerminals`, `onSelectFreeTerminal`, `onAddFreeTerminal`
- localStorage key for expansion state

### 4. TerminalTabBar.tsx
- Label logic delegated to parent — no direct changes needed

### 5. electron.d.ts
- `project: string` mandatory in SessionInfo — make optional
- TerminalCreateOpts.project also needs to be optional

## Summary
Frontend needs more changes than backend:
1. useTerminalTree: return free terminals alongside project tree
2. TerminalsPage: new handlers + session ID convention
3. TerminalTreeView: new "Terminals" section in tree
4. Types: make project optional
