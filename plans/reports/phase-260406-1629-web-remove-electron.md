# Phase 07 Completion Report: Web App — Remove Electron Dependencies

**Date**: 2026-04-06 | **Plan**: [260405-1644-rust-server-refactor](../260405-1644-rust-server-refactor/plan.md)

## Summary

Removed all Electron-specific code from web package. Clean cut — no backward compat. Web package now targets browser-only deployment against the Rust server.

## Files Deleted

| File | Reason |
|------|--------|
| `packages/web/src/api/ipc-transport.ts` | Electron contextBridge wrapper — no longer needed |
| `packages/web/src/types/electron.d.ts` | `window.devhub` type declarations — no longer needed |

## Files Modified

| File | Changes |
|------|---------|
| `packages/web/src/main.tsx` | Removed `IpcTransport` import + `isElectron` detection; always uses `WsTransport(getServerUrl())` |
| `packages/web/src/api/transport.ts` | Removed `isWebMode()` helper; cleaned stale Electron comments |
| `packages/web/src/App.tsx` | Removed all `isWebMode()` guards; auth check always runs; removed Electron-only `workspace:changed` subscription effect |
| `packages/web/src/hooks/useSSE.ts` | Removed `isWebMode()` guards in `wsStatus` init and status subscription |
| `packages/web/src/pages/WelcomePage.tsx` | Removed `isWebMode()` branch; always renders text-input path; removed `openDialog()`, `api` import |
| `packages/web/src/components/organisms/Sidebar.tsx` | Removed `isWebMode()` guards; server settings button always visible |
| `packages/web/src/api/client.ts` | Moved `SessionInfo` type definition here (from deleted `electron.d.ts`); removed dead `openDialog` stub; fixed stale comment |
| `packages/web/src/api/ws-transport.ts` | Removed `workspace:open-dialog → _no_dialog` sentinel route |
| `packages/web/src/api/queries.ts` + 5 component files | Updated `SessionInfo` import: `@/types/electron.js` → `@/api/client.js` |

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| `SessionInfo` moved to `client.ts` | It's a transport-layer type; `electron.d.ts` was wrong home |
| `agentStore.add` stub kept | Actively called from `useAddToStore` + `AgentStorePage`; not dead — Rust server endpoint pending |
| `openDialog` removed entirely | No UI call sites post-cleanup; no server-side analog exists |

## Tests

- **Build**: `pnpm build` passes, 1852 modules, zero TypeScript errors
- **Zero electron refs**: `grep -r electron/IpcTransport/window\.devhub/isElectron/isWebMode packages/web/src` → CLEAN

## Next Step

→ Phase 08: Integration testing + migration

## Unresolved Questions

- `agentStore.add` routes to `_no_add` sentinel in `ws-transport.ts` — Rust server doesn't implement this endpoint. The UI mutation (`useAddToStore`) calls it. This needs a real Rust endpoint in Phase 08 or Phase 09.
