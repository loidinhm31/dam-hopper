# Phase 06: Web App — Configurable Backend URL

## Context
- Parent: [plan.md](./plan.md)
- Depends on: Phase 05 API contract defined

## Overview
- **Priority**: P1
- **Status**: Pending
- **Effort**: 6h

Modify `WsTransport` to support configurable backend URL instead of hardcoded `location.host`. Add UI for server connection settings.

## Key Insights

- Current `WsTransport.invoke()` uses relative fetch URLs (`/api/*`) — these must become absolute when cross-origin
- WebSocket URL hardcoded: `${proto}//${location.host}/ws`
- Need both build-time env var and runtime settings UI
- Auth switches to Bearer token in `Authorization` header — no cookie cross-origin issues

## Requirements

- Configurable server URL (default: same-origin for backward compat)
- Runtime server URL change without app reload (reconnect WS)
- Connection status indicator in UI
- Build-time env var: `VITE_DEV_HUB_SERVER_URL`
- LocalStorage persistence for chosen server URL
- Bearer token auth (stored in sessionStorage)

## Architecture

```
packages/web/src/
├── api/
│   ├── ws-transport.ts     # MODIFY: accept baseUrl param
│   ├── transport.ts        # MODIFY: add reconfigure support
│   └── server-config.ts    # NEW: server URL management
├── components/
│   └── server-connection/
│       ├── connection-status.tsx    # NEW: status indicator
│       └── server-settings.tsx      # NEW: URL config dialog
```

## Implementation Steps

1. Create `server-config.ts`:
   - `getServerUrl()`: check localStorage → env var → same-origin fallback
   - `setServerUrl(url)`: persist to localStorage, trigger reconnect
   - `isConfigured()`: whether explicit URL set
2. Modify `WsTransport` constructor to accept `baseUrl`:
   - REST: `fetch(${baseUrl}/api/...)`
   - WS: `${wsProto}//${new URL(baseUrl).host}/ws`
   - Add `Authorization: Bearer <token>` header to all fetch calls
3. Modify `transport.ts`:
   - Add `reconfigureTransport(url)`: teardown old WsTransport, init new one
   - Invalidate all TanStack Query caches on reconnect
4. Update `main.tsx`: remove `isElectron` check, always use WsTransport
5. Create `ConnectionStatus` component: green/yellow/red dot based on WS state
6. Create `ServerSettings` dialog: URL input, test connection, save
7. Add connection status to app header/navbar
8. Handle auth flow for remote servers (token input or redirect)

## Todo

- [ ] server-config.ts module
- [ ] WsTransport accepts baseUrl
- [ ] Fetch with credentials: 'include'
- [ ] Transport reconfigure support
- [ ] main.tsx simplified (no electron detection)
- [ ] ConnectionStatus component
- [ ] ServerSettings dialog
- [ ] Auth token flow for remote servers
- [ ] Tests

## Success Criteria

- App connects to `localhost:4800` by default
- Can switch to remote `https://devhub.example.com:4800` via settings
- Connection status reflects actual WS state
- All API calls work cross-origin with proper CORS

## Risk Assessment

- **Mixed content**: HTTP page can't connect to WS on HTTPS server (and vice versa). Enforce consistent protocol.
- **TanStack Query cache**: Stale data from previous server must be purged on switch.

## Security Considerations

- Store auth token in sessionStorage (not localStorage — cleared on tab close)
- Validate server URL format before connecting
- Show warning when connecting to non-localhost servers

## Next Steps

→ Phase 07: Remove remaining Electron dependencies from web package
