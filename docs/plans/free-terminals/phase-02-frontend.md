# Phase 02: Frontend — Tree + UI + Handlers

> Parent: [plan.md](./plan.md)
> Dependencies: [Phase 01](./phase-01-backend.md)
> Priority: P1 | Status: DONE | Review: approved | Completed: 2026-03-26

## Overview

Add "Terminals" section to the tree sidebar for free terminals. Implement creation handlers, tab labeling, and tree rendering for standalone terminals.

## Key Insights

- useTerminalTree returns `{ tree, freeTerminals, isLoading }` — `freeTerminals` is a separate sorted array of free terminal sessions
- TerminalsPage orchestrates handlers and maintains `freeTerminalIndexMap` (session ID → 1-based display index) for O(1) label lookups
- Tab labeling in TerminalsPage `tabLabel()` detects `free:` prefix and uses the index map to derive "Terminal N" labels
- TerminalTreeView renders a collapsible "Terminals" section with localStorage persistence (`devhub:expanded-free-terminals`)
- Free terminals use `free:${uuid}` session ID convention (UUIDs instead of timestamps for better uniqueness)

## Requirements

1. "Terminals" section in tree sidebar (above projects)
2. "+" button to create new free terminal
3. Free terminals listed as expandable instances
4. Tab labels: "Terminal 1", "Terminal 2", etc. (auto-incrementing)
5. Click to select/focus free terminal in panel
6. Kill button per free terminal instance

## Related Code Files

| File | Purpose |
|------|---------|
| `packages/web/src/hooks/useTerminalTree.ts` | Tree data structure |
| `packages/web/src/pages/TerminalsPage.tsx` | Page orchestrator, handlers |
| `packages/web/src/components/organisms/TerminalTreeView.tsx` | Tree sidebar rendering |
| `packages/web/src/components/organisms/TerminalTabBar.tsx` | Tab bar (label logic in parent) |

## Architecture

```
TerminalsPage
├── useTerminalTree() → { projects: TreeProject[], freeTerminals: SessionInfo[] }
├── handleAddFreeTerminal() → creates free:${timestamp} session
├── tabLabel(sessionId) → handles "free:" prefix → "Terminal N"
└── TerminalTreeView
    ├── "Terminals" section (collapsible)
    │   ├── Free terminal instance rows
    │   └── "+ New Terminal" button
    └── Project sections (existing)
```

## Implementation Steps

### 1. Update useTerminalTree hook (DONE)
- Exported `FREE_TERMINAL_PREFIX = "free:"` constant for shared use
- Added `freeTerminals: SessionInfo[]` to return value
- Filters sessions with `free:` prefix from session list
- Sorts free terminals by `startedAt` (oldest first)
- Return signature: `{ tree: TreeProject[], freeTerminals: SessionInfo[], isLoading: boolean }`

### 2. Update TerminalsPage handlers (DONE)
- Added `handleAddFreeTerminal()`:
  ```typescript
  const sessionId = `${FREE_TERMINAL_PREFIX}${crypto.randomUUID()}`;
  window.devhub.terminal.create({ id: sessionId, command: "", cols: 120, rows: 30 })
  ```
  - No project/command field passed (interactive shell spawning handled by backend)
  - Command defaults to empty string; backend determines appropriate shell
- Added `freeTerminalIndexMap` useMemo: `Map<sessionId, 1-basedIndex>` for O(1) label lookups
- Updated `tabLabel()` to detect and handle `free:` prefix:
  - Extracts index from map: `const n = freeTerminalIndexMap.get(sessionId); return `Terminal ${n}`
  - Ensures consistent "Terminal N" labels across sessions
- Integrated free terminal callbacks into TerminalTreeView props

### 3. Update TerminalTreeView (DONE)
- Added `freeTerminals: SessionInfo[]` prop
- Added callback props: `onAddFreeTerminal`, `onSelectFreeTerminal`, `onKillFreeTerminal`
- Renders "Terminals" collapsible section at top of tree (above Projects):
  - Header: "Terminals" label with chevron icon, activity count badge, and "+ New Terminal" button
  - Collapse/expand controlled by state: `terminalsExpanded`
  - Children when expanded: list of `FreeTerminalRow` components
  - Empty state message: "No terminals — press + to create one"
- localStorage persistence: key `devhub:expanded-free-terminals` (defaults to `true`)
- Added `FreeTerminalRow` component:
  - Shows status dot (green if alive, red if exited, amber if idle)
  - Displays label (e.g., "Terminal 1", "Terminal 2")
  - Kill button visible on hover (only when alive)
  - Click to select and open in tab

### 4. Tab label derivation (DONE)
- TerminalsPage `tabLabel()` detects `free:` prefix
- Uses pre-computed `freeTerminalIndexMap` for fast O(1) label lookup
- Returns "Terminal N" format consistently
- Additional logic: `tabsWithLiveSession` re-derives labels from map on each render cycle (for responsive updates)

## Todo

- [x] Update useTerminalTree return type and logic
- [x] Add handleAddFreeTerminal in TerminalsPage
- [x] Update tabLabel for free: prefix
- [x] Add free terminal selection handler
- [x] Add "Terminals" section to TerminalTreeView
- [x] Add "+" button and instance rows
- [x] Add localStorage persistence for section expansion
- [x] Test: create, select, kill free terminals

## Success Criteria

- "Terminals" section visible in tree sidebar
- Can create free terminals via "+" button
- Free terminals appear in tree with status dots
- Tab bar shows "Terminal N" labels
- Can switch between free terminals
- Can kill free terminals from tree

## Implementation Details

### useTerminalTree Hook
```typescript
export const FREE_TERMINAL_PREFIX = "free:" as const;

export function useTerminalTree() {
  const { data: projects = [] } = useProjects();
  const { data: sessions = [] } = useTerminalSessions();

  // Build efficient session lookup map
  const sessionMap = useMemo(() => new Map<string, SessionInfo>(sessions.map(s => [s.id, s])), [sessions]);

  // Extract and sort free terminals
  const freeTerminals = useMemo<SessionInfo[]>(() => {
    return sessions
      .filter(s => s.id.startsWith(FREE_TERMINAL_PREFIX))
      .sort((a, b) => a.startedAt - b.startedAt);
  }, [sessions]);

  // Build tree structure...
  return { tree, freeTerminals, isLoading: projectsLoading || sessionsLoading };
}
```

### TerminalsPage Handlers
```typescript
// O(1) lookup: sessionId → 1-based display index
const freeTerminalIndexMap = useMemo(
  () => new Map(freeTerminals.map((s, i) => [s.id, i + 1])),
  [freeTerminals],
);

// Handler to create new free terminal
function handleAddFreeTerminal() {
  const sessionId = `${FREE_TERMINAL_PREFIX}${crypto.randomUUID()}`;
  window.devhub.terminal
    .create({ id: sessionId, command: "", cols: 120, rows: 30 })
    .then(() => {
      queryClient.invalidateQueries({ queryKey: ["terminal-sessions"] });
      openTerminalTab(sessionId, "", "");
    })
    .catch(err => console.error("[TerminalsPage] failed to create free terminal", err));
}

// Label derivation with O(1) index lookup
function tabLabel(sessionId: string, project: string, command: string): string {
  const parts = sessionId.split(":");
  const type = parts[0] ?? sessionId;
  if (type === "free") {
    const n = freeTerminalIndexMap.get(sessionId);
    return `Terminal ${n ?? "?"}`;
  }
  // ... handle other types
}
```

### TerminalTreeView Component
```typescript
interface Props {
  projects: TreeProject[];
  freeTerminals: SessionInfo[];
  selectedId: string | null;
  onAddFreeTerminal: () => void;
  onSelectFreeTerminal: (sessionId: string) => void;
  onKillFreeTerminal: (sessionId: string) => void;
  // ... other callbacks
}

export function TerminalTreeView({
  projects,
  freeTerminals,
  selectedId,
  onAddFreeTerminal,
  onSelectFreeTerminal,
  onKillFreeTerminal,
  // ...
}: Props) {
  const [terminalsExpanded, setTerminalsExpanded] = useState<boolean>(() => {
    const stored = localStorage.getItem("devhub:expanded-free-terminals");
    return stored === null ? true : stored === "true";
  });

  function toggleTerminals() {
    setTerminalsExpanded(prev => {
      localStorage.setItem("devhub:expanded-free-terminals", String(!prev));
      return !prev;
    });
  }

  // Render "Terminals" header with collapsible chevron and + button
  // When expanded, map and render FreeTerminalRow for each session
  // ...
}
```

### FreeTerminalRow Component
```typescript
function FreeTerminalRow({
  session,
  label,
  isSelected,
  onSelect,
  onKill,
}: {
  session: SessionInfo;
  label: string;  // e.g., "Terminal 1"
  isSelected: boolean;
  onSelect: () => void;
  onKill: () => void;
}) {
  return (
    <div onClick={onSelect} className={cn(baseRowClasses, isSelected && selectedClass)}>
      <StatusDot session={session} />
      <Terminal className="h-3 w-3" />
      <span>{label}</span>
      {session.alive && (
        <button onClick={e => { e.stopPropagation(); onKill(); }}>
          <Square className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
```

### localStorage Keys
- `devhub:expanded-free-terminals` — boolean, tracks whether Terminals section is expanded (default: `true`)
- Single source of truth for collapse/expand state across sessions

## Risk Assessment

- **Low**: useTerminalTree return type change is isolated to TerminalsPage consuming code
- **Low**: O(1) index map ensures no performance regression with large numbers of free terminals
- **Note**: Terminal numbering has gaps when terminals are killed — acceptable (matches VS Code behavior)
