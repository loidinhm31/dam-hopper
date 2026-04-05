# Phase 07: Web App — Remove Electron Dependencies

## Context
- Parent: [plan.md](./plan.md)
- Depends on: [Phase 06](./phase-06-web-configurable-backend.md)

## Overview
- **Priority**: P2
- **Status**: Pending
- **Effort**: 4h

Remove all Electron-specific code from web package. Clean cut — no backward compat needed.

## Requirements

- Remove `IpcTransport` class entirely
- Remove `window.devhub` type declarations
- Remove electron detection logic
- Remove any electron-specific UI branches (e.g., "open folder" dialog)
- Update Vite config: remove electron-specific build config
- Clean up package.json: remove any electron-related dependencies

## Related Code Files

| File | Action | Notes |
|------|--------|-------|
| `packages/web/src/api/ipc-transport.ts` | Delete | No longer needed |
| `packages/web/src/main.tsx` | Modify | Remove isElectron check |
| `packages/web/src/api/transport.ts` | Modify | Remove isWebMode helper |
| `packages/web/src/api/ws-transport.ts` | Modify | Already updated in phase 06 |
| Any component with `isElectron`/`isWeb` guards | Modify | Remove guards |

## Implementation Steps

1. Delete `ipc-transport.ts`
2. Grep for `IpcTransport`, `window.devhub`, `isElectron`, `isWebMode` — remove all references
3. Simplify `main.tsx`: always init WsTransport
4. Remove electron-specific type declarations (if any in `types/` or `global.d.ts`)
5. Clean `package.json` devDependencies
6. Update Vite config — remove any electron-vite references
7. Verify `pnpm build` in web package succeeds
8. Verify all pages render without electron-specific features

## Todo

- [ ] Delete IpcTransport
- [ ] Remove all electron references (grep-verified)
- [ ] Simplify main.tsx
- [ ] Clean package.json
- [ ] Update Vite config
- [ ] Build passes
- [ ] Manual smoke test

## Success Criteria

- `pnpm build` in web package succeeds
- Zero references to electron, IPC, `window.devhub` in web package
- App works in browser connecting to Rust server

## Risk Assessment

- **Hidden electron deps**: Some component may check for electron features without obvious naming. Full grep required.
- **Build config**: electron-vite may have configured Vite in ways that need reverting.

## Next Steps

→ Phase 08: Integration testing
