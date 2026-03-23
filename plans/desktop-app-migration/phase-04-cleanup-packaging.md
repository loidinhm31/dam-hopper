---
parent: plan.md
phase: "04"
status: done
completed: 2026-03-23
priority: P1
effort: 3h
depends_on: ["01", "02", "03"]
---

# Phase 04: Cleanup + Packaging

## Context

- Parent: [plan.md](./plan.md)
- Depends on: [Phase 01](./phase-01-electron-shell.md), [Phase 02](./phase-02-ipc-api-layer.md), [Phase 03](./phase-03-pty-terminal.md)

## Overview

Remove CLI and server packages, clean up dead code, configure electron-builder for cross-platform packaging, and update project documentation.

## Key Insights

- CLI package (`@dev-hub/cli`) is fully replaced by Electron app
- Server package (`@dev-hub/server`) route logic absorbed into IPC handlers (Phase 02)
- Server's static file serving + SPA fallback no longer needed (Electron loads files directly)
- Some core services may have server-only code that can be simplified
- Build process: `electron-vite build` handles everything, then `electron-builder` packages

## Requirements

### 1. Remove `@dev-hub/cli`

- Delete `packages/cli/` entirely
- Remove from `pnpm-workspace.yaml` if explicitly listed
- Remove any root `package.json` references
- Update `@dev-hub/core` if it has CLI-specific exports

### 2. Remove `@dev-hub/server`

- Delete `packages/server/` entirely
- Server tests that validate API behavior → adapt relevant ones to test IPC handlers
- Remove Hono, @hono/node-server dependencies
- Remove `dev:server`, `dev:debug` root scripts

### 3. Clean Up Core Package

- Remove server-specific exports if any
- `BuildService`, `RunService`, `CommandService` — already stripped of execa execution in Phase 03
- Verify `execa` dependency removed from core if no other usage remains
- Keep `resolveEnv()`, config parsing, git operations unchanged

### 4. Clean Up Web Package

- Remove `BuildLog.tsx` (replaced by TerminalPanel)
- Verify `client.ts` has no remaining HTTP/fetch code (should be IPC-only after Phase 02)
- Verify all SSE/EventSource code removed (should be gone after Phase 02)
- Remove unused queries/hooks that were HTTP-specific

### 5. electron-builder Configuration

```yaml
# packages/electron/electron-builder.yml
appId: dev.hub.app
productName: Dev Hub
directories:
  output: release
  buildResources: build
files:
  - dist/**/*
  - node_modules/@dev-hub/core/**/*
  - node_modules/@dev-hub/web/dist/**/*
linux:
  target: [AppImage, deb]
  category: Development
win:
  target: [nsis, portable]
```

**Target platforms: Windows + Linux only.** No macOS targets.

### 6. Build Pipeline

```bash
# Full build
pnpm build              # electron-vite build (core + web + electron)
pnpm package            # electron-builder → installers
pnpm package:linux      # Linux only (AppImage, deb)
pnpm package:win        # Windows only (nsis, portable)
```

Build order: `@dev-hub/core` → `@dev-hub/web` → `electron-vite build` → `electron-builder`

### 7. Update Documentation

- Update `CLAUDE.md` — new architecture, removed packages, new commands
- Update `README.md` — installation, usage
- Update `docs/codebase-summary.md` — reflect new structure

### 8. Update Root Configuration

- `pnpm-workspace.yaml`: only `packages/core`, `packages/web`, `packages/electron`
- Root `package.json`: update scripts
- Remove server-related e2e tests if they test HTTP endpoints directly

## Architecture (Final)

```
dev-hub/
├── packages/
│   ├── core/        # @dev-hub/core — business logic (unchanged)
│   ├── web/         # @dev-hub/web — React renderer + xterm.js
│   └── electron/    # @dev-hub/electron — main process + PTY + IPC
├── dev-hub.toml
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Related Code Files

| File                                                 | Action                                     |
| ---------------------------------------------------- | ------------------------------------------ |
| `packages/cli/`                                      | Delete entirely                            |
| `packages/server/`                                   | Delete entirely                            |
| `packages/web/src/components/organisms/BuildLog.tsx` | Delete (replaced by TerminalPanel)         |
| `packages/web/src/api/client.ts`                     | Verify IPC-only (HTTP removed in Phase 02) |
| `CLAUDE.md`                                          | Update architecture, commands              |
| `package.json` (root)                                | Update scripts                             |
| `pnpm-workspace.yaml`                                | Update if needed                           |

## Implementation Steps

1. Delete `packages/cli/` directory
2. Delete `packages/server/` directory
3. Update root `package.json` scripts (remove server refs)
4. Remove dead imports/exports from `@dev-hub/core`
5. Remove `BuildLog.tsx` and SSE code from web
6. Remove unused HTTP client code from `client.ts`
7. Configure `electron-builder.yml`
8. Add packaging scripts to `packages/electron/package.json`
9. Add root packaging scripts
10. Test full build pipeline: `pnpm build && pnpm package`
11. Verify packaged app launches and works
12. Update CLAUDE.md, README.md, codebase-summary.md

## Todo

- [ ] Delete packages/cli
- [ ] Delete packages/server
- [ ] Update root package.json and workspace config
- [ ] Clean dead code from core
- [ ] Clean dead code from web (BuildLog, any remaining SSE/HTTP)
- [ ] Configure electron-builder (Linux + Windows targets only)
- [ ] Add packaging scripts
- [ ] Test full build + package pipeline
- [ ] Verify packaged app works
- [ ] Update documentation (CLAUDE.md, README, codebase-summary)

## Success Criteria

- Only 3 packages remain: core, web, electron
- `pnpm build` succeeds across all packages
- `pnpm package` produces installable artifacts (at least for current platform)
- Packaged app launches and all features work
- No dead imports, unused dependencies, or orphan files
- Documentation reflects new architecture

## Risk Assessment

- **Low-Medium**: Mostly deletion + config
- Ensure no other packages depend on CLI or server
- electron-builder native module bundling (node-pty) requires rebuild scripts
- Cross-platform testing needed (at minimum test on current platform)

## Security Considerations

- Packaged app should sign binaries (code signing — deferred to production readiness)
- Electron auto-update: not configured in this phase (future enhancement)
- Ensure no secrets or dev credentials in packaged artifacts
