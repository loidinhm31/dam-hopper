# IPC and PTY Session Management Analysis

## 1. PtySessionManager (session-manager.ts)
- Sessions: `Map<string, IPty>` + `Map<string, scrollback>` (256KB max)
- ID regex: `/^[\w:.-]+$/`
- **No metadata stored** — only raw PTY object and buffer
- `getAll()` returns `string[]` only

## 2. Terminal IPC Handlers (terminal.ts)
- `terminal.create`: accepts `{ id, project, command, cols, rows }`, resolves env, validates project
- **Context lost after creation** — project/command not persisted
- `terminal.list`: returns `string[]` only
- No metadata, status, or grouping endpoints

## 3. IPC Channels
- `TERMINAL_CREATE` (invoke), `TERMINAL_WRITE` (send), `TERMINAL_RESIZE` (send), `TERMINAL_KILL` (send)
- `TERMINAL_LIST` (invoke), `TERMINAL_BUFFER` (invoke)
- Dynamic: `terminal:data:${id}`, `terminal:exit:${id}`

## 4. Preload Bridge & Types
- Exposes: create, write, resize, kill, list, getBuffer, onData, onExit
- `list()` returns `Promise<string[]>`

## 5. Queries (queries.ts)
- **No terminal-related TanStack queries** — direct IPC calls only

## Key Gaps for Multi-Project Terminal Tree

| Feature | Current | Needed |
|---------|---------|--------|
| Session Metadata | None | Store `{ id, project, command, type, alive }` |
| Query Sessions | `list()` → `string[]` | `listDetailed()` → `SessionInfo[]` |
| Session Status | Only via `onExit` event | Include `alive` flag in metadata |
| Tree Rendering | Parse session IDs manually | API returns structured data |
| React Integration | Direct IPC calls | TanStack Query hooks for caching |

## Recommended Changes

1. **PtySessionManager**: Add `Map<string, SessionMeta>` alongside PTY map
2. **New IPC**: `TERMINAL_LIST_DETAILED` → returns `{ id, project, command, type, alive }[]`
3. **Preload**: Expose `terminal.listDetailed()`
4. **Types**: Add `SessionInfo` interface
5. **Queries**: Add `useTerminalSessions()` hook with polling
