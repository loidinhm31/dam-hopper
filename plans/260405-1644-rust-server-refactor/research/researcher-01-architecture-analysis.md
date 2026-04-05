# Researcher 01: Architecture & Dependency Analysis

## Package Dependency Graph

```
@dev-hub/web          (no internal deps — pure React SPA)
@dev-hub/electron     → @dev-hub/core + node-pty + electron-store
@dev-hub/server       → @dev-hub/core + node-pty + fastify
```

Neither electron nor server depend on each other. Both depend only on core. Web depends on nothing — runtime transport detection.

## Core Package (~24K lines)

Pure business logic. **No PTY, no process spawning.**

| Module | Responsibility | Lines (approx) |
|--------|---------------|-----------------|
| config/ | TOML parse/validate (Zod), project discovery, global config, known workspaces | ~4K |
| git/ | simple-git wrapper: status, fetch, pull, push, branches, worktrees, bulk ops (p-limit) | ~6K |
| build/ | Context resolution only — returns `{ command, cwd, env }` | ~2K |
| commands/ | CommandRegistry, tokenized search index | ~1K |
| agent-store/ | Scan, ship/unship/absorb, memory templates, import from repo | ~8K |
| utils/ | fs helpers, env resolution | ~0.5K |

**Critical finding**: `BuildService`, `RunService`, `CommandService` explicitly delegate execution to caller. Core resolves context, PTY layer executes.

## PTY Ownership

- **electron**: `PtySessionManager` at `packages/electron/src/main/pty/session-manager.ts` — node-pty spawn, 256KB scrollback, session lifecycle, 60s TTL for dead sessions
- **server**: Verbatim copy at `packages/server/src/pty/session-manager-impl.ts` — only difference is EventSink injection (WebSocket vs Electron IPC)
- **core**: Zero PTY code

## Server API Surface (from WsTransport channel mapping)

| Domain | Endpoints | Methods |
|--------|-----------|---------|
| Workspace | 7 routes | GET, POST, DELETE |
| Config | 3 routes | GET, PUT, PATCH |
| Git | 7 routes | GET, POST, DELETE |
| Terminal | 6 routes | GET, POST, DELETE |
| Agent Store | 11 routes | GET, POST, DELETE |
| Agent Memory | 5 routes | GET, PUT, POST |
| Agent Import | 3 routes | POST |
| Commands | 2 routes | GET |
| Settings | 4 routes | GET, POST |
| Auth | 2 routes | GET, POST |
| Health | 1 route | GET |
| **Total** | **~51 routes** | |

## WebSocket Protocol

**Inbound** (client → server): `terminal:write`, `terminal:resize`
**Outbound** (server → client): `terminal:data`, `terminal:exit`, `terminal:changed`, `git:progress`, `workspace:changed`
**Auth**: Cookie-based (`devhub-auth`)

## Web Transport

- `WsTransport` hardcodes `location.host` — no configurable backend URL
- `IpcTransport` maps to `window.devhub.*` (electron contextBridge)
- Transport interface: `invoke<T>()`, `onTerminalData()`, `onTerminalExit()`, `onEvent()`, `terminalWrite()`, `terminalResize()`

## Key Conclusion

**Core is the key player** — all business logic lives there. Electron adds only PTY + IPC glue. Server already mirrors electron's functionality via REST+WS. The Rust port target = core logic + PTY management + HTTP/WS layer.
