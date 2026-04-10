# Terminal State Management Research

## useTerminalTree Hook
- Returns: `{ tree: TreeProject[], freeTerminals: SessionInfo[], isLoading }`
- Combines `useProjects()` + `useTerminalSessions()` queries
- `FREE_TERMINAL_PREFIX = "free:"` filters unassigned terminals
- Types: TreeCommand (key, label, type, command, cwd, sessionId, sessions[], profileName), TreeProject (name, type, path, commands[], activeCount)

## Query Hooks (queries.ts)
- `useTerminalSessions()`: key `["terminal-sessions"]`, staleTime: Infinity (push-invalidated)
- `useProjects()`: key `["projects"]`, refetchInterval: 30s polling

## useEditorStore (Zustand)
- Tab key: `"${project}::${path}"` compound key
- Tracks: content, savedContent, tier (binary|large|normal|degraded), loading, saving, conflicted
- Actions: open (async fetch), save (mtime conflict), forceOverwrite, reloadTab, setActive, close
- Orthogonal to terminal state — no coupling

## TerminalTreeView (14 callbacks)
- Props: projects[], freeTerminals[], selectedId, + 14 event handlers
- Local state: expandedProjects/Profiles/FreeTerminals (localStorage-backed)
- Renders: collapsible project nodes with build/run/custom/terminal sections + free terminal list

## Sidebar Feature Gating
- `useFeatureFlag("ide_explorer")` gates IDE nav link
- Terminals link always present
- IDE link inserted after Terminals when enabled

## TerminalsPage State Inventory (~727 LOC)
- 7 useState hooks: selection, openTabs, activeTab, mountedSessions, launchForm, savePrompt, freeTerminalSavePrompt
- 3 useMemo derivations: sessionMap, freeTerminalIndexMap, profileSessionIds
- 2 useEffect hooks: URL action param, deep-link session param
- ~15 handler functions for terminal lifecycle
- **Must extract into custom hook** to fit 200 LOC limit and enable reuse

## Key Extraction Strategy
- Create `useTerminalManager` hook housing all state + handlers
- Hook returns: state bag + action bag + derived data
- Page component becomes thin layout wrapper consuming the hook
