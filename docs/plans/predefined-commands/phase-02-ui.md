---
parent: plan.md
phase: "02"
status: done
completed: 2026-03-27
effort: 3h
dependencies: [phase-01-core.md]
---

# Phase 02: Electron + Web — Autocomplete UI & IPC

## Context

- Parent: [plan.md](plan.md)
- Depends on: [Phase 01](phase-01-core.md) (command database, BM25 search)

## Overview

Wire the BM25 search from core through Electron IPC to a reusable autocomplete input component in the web layer. Integrate into terminal creation flow and existing command inputs in the tree.

## Key Insights

- Search must run in main process (core runs in Node.js, not renderer)
- Debounce search queries (150ms) to avoid excessive IPC calls
- Autocomplete component should be reusable — used in multiple places
- Current `CommandRow` shows `cmd.key` as label — suggestion input replaces or enhances the "new command" flow
- `TerminalTreeView` has `onLaunchTerminal` callback — suggested commands flow through the same path

## Requirements

1. Add IPC handler in Electron for command search queries
2. Add IPC handler for getting all commands by project type
3. Update preload bridge with search/getCommands methods
4. Create `CommandSuggestionInput` atom component with dropdown
5. Create `useCommandSearch` hook with debounced IPC calls
6. Integrate into terminal creation (new command input in tree)
7. Integrate into existing command input areas

## Related Code Files

| File | Action |
|------|--------|
| `packages/electron/src/main/ipc/commands.ts` | **Create** — IPC handlers for search |
| `packages/electron/src/main/ipc/ipc-channels.ts` | **Edit** — add COMMAND_SEARCH, COMMAND_LIST channels |
| `packages/electron/src/main/main.ts` | **Edit** — register command IPC handlers |
| `packages/electron/src/preload/index.ts` | **Edit** — expose commands.search, commands.list |
| `packages/web/src/components/atoms/CommandSuggestionInput.tsx` | **Create** — autocomplete component |
| `packages/web/src/hooks/useCommandSearch.ts` | **Create** — debounced search hook |
| `packages/web/src/api/queries.ts` | **Edit** — add useCommandList query |
| `packages/web/src/components/organisms/TerminalTreeView.tsx` | **Edit** — integrate suggestion input |
| `packages/web/src/pages/TerminalsPage.tsx` | **Edit** — wire suggestion launch flow |

## Implementation Steps

### 1. IPC Channels (`ipc-channels.ts`)

```typescript
export const COMMAND_SEARCH = "commands:search";
export const COMMAND_LIST = "commands:list";
```

### 2. IPC Handlers (`commands.ts`)

```typescript
import { CommandRegistry } from "@dev-hub/core";

const registry = new CommandRegistry();

export function registerCommandHandlers() {
  ipcMain.handle(COMMAND_SEARCH, async (_event, { query, projectType, limit }) => {
    if (projectType) {
      return registry.searchByType(query, projectType, limit);
    }
    return registry.search(query, limit);
  });

  ipcMain.handle(COMMAND_LIST, async (_event, { projectType }) => {
    return registry.getCommands(projectType);
  });
}
```

### 3. Preload Bridge (`preload/index.ts`)

```typescript
commands: {
  search: (query: string, projectType?: string, limit?: number) =>
    ipcRenderer.invoke(COMMAND_SEARCH, { query, projectType, limit }),
  list: (projectType: string) =>
    ipcRenderer.invoke(COMMAND_LIST, { projectType }),
},
```

### 4. useCommandSearch Hook

```typescript
export function useCommandSearch(projectType?: string) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const debouncedQuery = useDebounce(query, 150);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      return;
    }
    window.devhub.commands
      .search(debouncedQuery, projectType, 8)
      .then(setResults);
  }, [debouncedQuery, projectType]);

  return { query, setQuery, results };
}
```

### 5. CommandSuggestionInput Component

```
┌─────────────────────────────────────────┐
│ 🔍 Type a command...           [project]│
├─────────────────────────────────────────┤
│ ▸ mvn clean install -DskipTests         │
│   Build without running tests     ★ 4.2 │
│ ▸ mvn package -DskipTests              │
│   Package artifact (skip tests)   ★ 3.8 │
│ ▸ mvn test                              │
│   Run unit tests                  ★ 2.1 │
└─────────────────────────────────────────┘
```

Props:
```typescript
interface CommandSuggestionInputProps {
  projectType?: ProjectType;   // filter by project type
  onSelect: (command: CommandDefinition) => void;
  onSubmitCustom: (command: string) => void;  // user types custom command
  placeholder?: string;
  autoFocus?: boolean;
}
```

Behavior:
- Type to search (BM25 results appear in dropdown)
- Arrow keys navigate results
- Enter selects highlighted result (or submits custom text if no result selected)
- Escape closes dropdown
- Click on result selects it
- Show command name, description, and relevance score
- If query matches no results, allow submitting as custom command

### 6. Integration Points

**Terminal creation (TerminalTreeView `+` button per project):**
- Currently opens a shell via `onAddShell`
- Add option: clicking `+` shows `CommandSuggestionInput` inline
- Selecting a suggestion creates terminal with that command
- Session ID: `custom:{projectName}:{sanitizedCommandName}`

**Existing command inputs:**
- `CommandRow` — on hover, show a small edit/search icon that opens suggestion input to change the command
- Free terminal creation — suggestion input available (searches all project types)

## Todo

- [x] Add COMMAND_SEARCH and COMMAND_LIST IPC channels
- [x] Create IPC handler with CommandRegistry
- [x] Update preload bridge
- [x] Implement useCommandSearch hook with debounce
- [x] Create CommandSuggestionInput component
- [x] Keyboard navigation (arrows, enter, escape)
- [x] Integrate into TerminalTreeView project "+" flow
- [x] Integrate into free terminal creation
- [x] Test: search results appear, selection launches terminal

## Success Criteria

- Typing "build skip" in maven project input shows "mvn clean install -DskipTests" as top suggestion
- Selecting a suggestion launches a terminal with that command
- Custom commands (not in database) can still be typed and submitted
- Keyboard navigation works (up/down/enter/escape)
- Search responds in < 200ms (debounce + IPC)
- Works in both project-scoped and global contexts

## Risk Assessment

- **Low**: IPC pattern is well-established in the codebase
- **Medium**: Autocomplete dropdown positioning — may need portal/z-index handling in the tree
- **Low**: Debounce prevents IPC flooding

## Security Considerations

- Search queries stay local (no external calls)
- Command strings pass through existing TERMINAL_CREATE flow (already sanitized)
