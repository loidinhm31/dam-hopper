# Phase 06 Completion Report: Web App — Configurable Backend URL

**Date**: 2026-04-06 | **Plan**: [260405-1644-rust-server-refactor](../260405-1644-rust-server-refactor/plan.md)

## Summary

Implemented cross-origin backend URL configuration for web app. Rust server now accepts `Authorization: Bearer <token>` headers alongside existing cookie auth. Web app added runtime server URL/token settings dialog, updated API layer to support absolute URLs and Bearer auth, and added connection status display. Web app now fully configurable for standalone deployment against local or remote Rust backend.

## Files Created

| File | Purpose |
|------|---------|
| `packages/web/src/api/server-config.ts` | URL/token persistence (localStorage/sessionStorage, auto-protocol detection) |
| `packages/web/src/components/server-connection/server-settings-dialog.tsx` | Runtime server URL + token config dialog with validation & test-connection |

## Files Modified

| File | Changes |
|------|---------|
| `server/src/api/auth.rs` | Added `require_auth` middleware accepting Bearer header; `extract_token()` + `token_matches()` helpers; `auth::status` endpoint support |
| `server/src/api/tests.rs` | 3 new Bearer auth tests (protected route, wrong token, auth/status) |
| `packages/web/src/api/ws-transport.ts` | Accepts `baseUrl` constructor param; builds absolute fetch URLs; adds Bearer header on requests; appends `?token=` to WS URL |
| `packages/web/src/api/transport.ts` | Added `reconfigureTransport(transport)` export |
| `packages/web/src/main.tsx` | Passes `getServerUrl()` to WsTransport constructor |
| `packages/web/src/App.tsx` | Auth check uses `${getServerUrl()}/api/auth/status` with Bearer headers + 5s timeout |
| `packages/web/src/pages/LoginPage.tsx` | Cross-origin path: Bearer token verification; same-origin path: cookie auth unchanged |
| `packages/web/src/components/atoms/ConnectionDot.tsx` | Status type: `connected | connecting | disconnected | error` with appropriate colors/labels |
| `packages/web/src/hooks/useSSE.ts` | Added `resetTransportListeners()` export; real WsStatus in `useIpc()` via duck-typed interface |
| `packages/web/src/components/organisms/Sidebar.tsx` | Server settings button (web mode only), opens ServerSettingsDialog |

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Bearer header priority over cookie | Cross-origin gets preference; same-origin cookie still works for backward compat |
| `window.location.reload()` on server change | Simplest safe fix for transport listener re-registration race condition |
| sessionStorage for token, localStorage for URL | Token cleared on tab close (security); URL shared across tabs |
| Auto-prepend `http://` for bare hostnames | UX: users can enter just `localhost:4800` |
| URL scheme validation (block non-http(s)) | XSS prevention: reject `javascript:` and other injection vectors |
| `?token=` query param for WS | WebSocket protocol doesn't support Bearer header; necessary evil for cross-origin |

## Code Review Fixes Applied

- Middleware ordering: Bearer extraction before cookie fallback in `auth.rs`
- Error message clarity in test assertions
- WS reconnection logic stabilized with connection status tracking
- SessionStorage scope isolation (per-tab, not per-domain)

## Tests

- **Rust**: 111/111 passing (108 existing + 3 new Bearer auth tests covering protected route, wrong token, auth/status)
- **Web**: Vite build clean, no TypeScript errors
- Manual validation: cross-origin login → token persistence → reconnect works

## Next Step

→ Phase 07: Remove Electron dependencies from web package (`electron-preload`, `ipc-bridge`, migrate to pure REST client)

## Unresolved Questions

None identified; cross-origin auth flow fully specified and tested.
