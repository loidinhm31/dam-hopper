# Phase 09: Cleanup — Remove Node Packages

## Context
- Parent: [plan.md](./plan.md)
- Depends on: [Phase 08](./phase-08-integration-testing.md) passing

## Overview
- **Priority**: P2
- **Status**: Done ✓ (2026-04-06)
- **Effort**: 4h

Remove `@dev-hub/core`, `@dev-hub/electron`, `@dev-hub/server` once Rust server is validated.

## Implementation Steps

1. Remove `packages/core/` directory
2. Remove `packages/electron/` directory
3. Remove `packages/server/` directory
4. Update root `package.json`: remove workspace entries for deleted packages
5. Update `pnpm-workspace.yaml`: only `packages/web`
6. Update root scripts: remove `dev:electron`, `package:*` scripts
7. Add new scripts: `dev:server` (cargo run from `server/`), `build:server` (cargo build --release from `server/`)
8. Update `.gitignore`: add `target/` for Rust
9. Update CLAUDE.md with new architecture description
10. Update README if exists

## Todo

- [ ] Delete core, electron, server packages
- [ ] Update workspace config
- [ ] Update root scripts
- [ ] Update .gitignore
- [ ] Update CLAUDE.md
- [ ] Verify `pnpm install` still works for web
- [ ] Verify no broken imports

## Success Criteria

- Monorepo has: `packages/web/` + `server-rs/` (or wherever Rust lives)
- `pnpm install && pnpm build` works for web
- `cargo build --release` works for server
- No dead references to removed packages

## Next Steps

→ Phase 10: CI/CD + distribution
