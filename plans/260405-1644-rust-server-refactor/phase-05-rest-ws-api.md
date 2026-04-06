# Phase 05: REST API + WebSocket Layer

## Context
- Parent: [plan.md](./plan.md)
- Depends on: [Phase 01](./phase-01-rust-scaffold-config.md), [Phase 02](./phase-02-pty-session-management.md), [Phase 03](./phase-03-git-operations.md), [Phase 04](./phase-04-agent-store-commands.md)

## Overview
- **Priority**: P1
- **Status**: Done ✓
- **Effort**: 12h

Wire all services into Axum HTTP routes + WebSocket handler. Must be API-compatible with current Node server so `WsTransport` works unchanged.

## Key Insights

- ~51 REST endpoints to implement (exact mapping from WsTransport)
- WebSocket: 2 inbound message types, 5 outbound event types
- Auth: token-based via httpOnly cookie (`devhub-auth`)
- Current server disables CORS (`origin: false`) — new server must enable CORS for cross-origin web app
- Rate limiting: 200 req/min (only on auth endpoints currently)

## Requirements

- All REST endpoints matching current server API (see WsTransport mapping)
- WebSocket endpoint at `/ws` with terminal I/O + push events
- Bearer token auth middleware (`Authorization: Bearer <token>` header)
- CORS configured for configurable allowed origins
- Rate limiting on auth endpoints
- Health check endpoint (`GET /api/health`)
- Structured JSON error responses
- No static file serving (web runs separately)

## Architecture

```
src/api/
├── mod.rs
├── router.rs           # Axum Router assembly
├── auth.rs             # Token middleware + auth routes
├── workspace.rs        # Workspace routes
├── config.rs           # Config routes
├── git.rs              # Git routes
├── terminal.rs         # Terminal routes
├── agent_store.rs      # Agent store routes
├── agent_memory.rs     # Memory routes
├── agent_import.rs     # Import routes
├── commands.rs         # Command routes
├── settings.rs         # Settings routes
└── ws.rs               # WebSocket handler

src/state.rs            # AppState (shared across handlers)
```

**AppState** (shared via `Arc`):
```rust
struct AppState {
    config: RwLock<WorkspaceConfig>,
    pty_manager: PtySessionManager,
    git_service: GitService,
    bulk_git: BulkGitService,
    agent_store: AgentStore,
    command_registry: CommandRegistry,
    ws_broadcast: broadcast::Sender<WsEvent>,
    auth_token: String,
}
```

## REST Endpoint Mapping

### Workspace (7 routes)
| Method | Path | Handler |
|--------|------|---------|
| GET | /api/workspace/status | workspace status |
| GET | /api/workspace | get workspace config |
| POST | /api/workspace/init | init workspace |
| POST | /api/workspace/switch | switch workspace |
| GET | /api/workspace/known | list known workspaces |
| POST | /api/workspace/known | add known workspace |
| DELETE | /api/workspace/known | remove known workspace |

### Config (3 routes)
| Method | Path | Handler |
|--------|------|---------|
| GET | /api/config | get config |
| PUT | /api/config | update config |
| PATCH | /api/config/projects/:name | update project |

### Git (7 routes)
| Method | Path | Handler |
|--------|------|---------|
| POST | /api/git/fetch | fetch projects |
| POST | /api/git/pull | pull projects |
| POST | /api/git/push | push project |
| GET | /api/git/:project/worktrees | list worktrees |
| POST | /api/git/:project/worktrees | add worktree |
| DELETE | /api/git/:project/worktrees | remove worktree |
| GET | /api/git/:project/branches | list branches |
| POST | /api/git/:project/branches/update | checkout branch |

### Terminal (6 routes)
| Method | Path | Handler |
|--------|------|---------|
| POST | /api/terminal | create session |
| GET | /api/terminal | list sessions |
| GET | /api/terminal/detailed | list detailed |
| GET | /api/terminal/:id/buffer | get buffer |
| DELETE | /api/terminal/:id | kill session |
| DELETE | /api/terminal/:id/remove | remove session |

### Agent Store (11 routes), Memory (5), Import (3), Commands (2), Settings (4), Auth (2), Health (1)

*(Full mapping in WsTransport channelToEndpoint — must match exactly)*

## WebSocket Protocol

**Endpoint**: `GET /ws` (upgrade)
**Auth**: Bearer token in `Sec-WebSocket-Protocol` header or query param `?token=` on upgrade

**Inbound**:
```json
{ "type": "terminal:write", "id": "session-id", "data": "ls\n" }
{ "type": "terminal:resize", "id": "session-id", "cols": 80, "rows": 24 }
```

**Outbound** (via broadcast):
```json
{ "type": "terminal:data", "id": "session-id", "data": "output..." }
{ "type": "terminal:exit", "id": "session-id", "exitCode": 0 }
{ "type": "terminal:changed" }
{ "type": "git:progress", "payload": { ... } }
{ "type": "workspace:changed", "payload": { ... } }
```

## Implementation Steps

1. Define `AppState` struct, wrap in `Arc`
2. Implement auth middleware: extract `Authorization: Bearer <token>` header → validate against stored token
3. Implement each route group as Axum Router
4. Compose all routers with auth middleware layer
5. WebSocket handler: parse JSON messages, dispatch to PTY manager
6. WS broadcast: subscribe to PTY events + git progress, fan out to all connected clients
7. CORS: `tower-http::cors::CorsLayer` with configurable allowed origins
8. Rate limiting: `tower_governor` or custom middleware for auth routes
9. Error handling: consistent JSON error responses with `IntoResponse`
10. Integration tests: start server, hit endpoints, verify responses

## Todo

- [ ] AppState defined
- [ ] Auth middleware
- [ ] Workspace routes
- [ ] Config routes
- [ ] Git routes
- [ ] Terminal routes
- [ ] Agent store routes
- [ ] Agent memory routes
- [ ] Agent import routes
- [ ] Command routes
- [ ] Settings routes
- [ ] WebSocket handler
- [ ] CORS configuration
- [ ] Error handling
- [ ] Integration tests

## Success Criteria

- Every endpoint returns compatible JSON with current Node server
- WsTransport connects and works without modification
- Auth flow: token cookie set on login, verified on subsequent requests
- WebSocket streams terminal output in real-time

## Risk Assessment

- **API drift**: Must maintain exact compatibility. Use current WsTransport as contract spec.
- **WebSocket backpressure**: If client can't keep up with terminal output, buffer or drop. Don't block PTY reader.
- **Concurrent state access**: `AppState` fields behind RwLock/Mutex — profile for contention.

## Security Considerations

- Token comparison: constant-time (`subtle` crate) to prevent timing attacks
- CORS: whitelist specific origins, not `*`
- Rate limit auth endpoints to prevent brute force
- WebSocket: validate message schema, reject oversized messages
- No path traversal in project name URL params

## Next Steps

→ Phase 06: Web app configurable backend (can start once API contract is defined)
