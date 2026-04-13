---
title: "Rename project from dev-hub to DamHopper"
status: pending
priority: P1
effort: 8h
branch: main
tags: [rename, refactor, global]
created: 2026-04-13
---

# Renaming Project from "dev-hub" to "DamHopper"

This plan outlines the global rename of the "dev-hub" project to "DamHopper".

## 1. Overview

The rename covers all casing conventions:
- kebab-case: `dev-hub` -> `dam-hopper`
- snake_case: `dev_hub` -> `dam_hopper`
- PascalCase: `DevHub` -> `DamHopper`
- SCREAMING_SNAKE_CASE: `DEV_HUB` -> `DAM_HOPPER`
- No separator (lowercase): `devhub` -> `damhopper`

## 2. Implementation Phases

### Phase 1: Renaming Core Metadata
Renaming root identifiers in project configuration files.
- [ ] Update `package.json` (root): name, scripts (@dev-hub/web -> @dam-hopper/web).
- [ ] Update `packages/web/package.json`: name (@dev-hub/web -> @dam-hopper/web).
- [ ] Update `server/Cargo.toml`: name (dev-hub-server -> dam-hopper-server).
- [ ] Update `server/Cargo.lock` (automatic via cargo build).
- [ ] Update `README.md` and `CLAUDE.md`: replace all instances.

### Phase 2: Renaming Configuration & Environment Variables
Renaming files and environment variables used for configuration.
- [ ] Rename `__fixtures__/workspace/dev-hub.toml` to `__fixtures__/workspace/dam-hopper.toml`.
- [ ] Replace `dev-hub.toml` with `dam-hopper.toml` in code (e.g., `CONFIG_FILENAME`).
- [ ] Update `~/.config/dev-hub` references to `~/.config/dam-hopper`.
- [ ] Rename environment variables:
    - `DEV_HUB_WORKSPACE` -> `DAM_HOPPER_WORKSPACE`
    - `DEV_HUB_PORT` -> `DAM_HOPPER_PORT`
    - `DEV_HUB_HOST` -> `DAM_HOPPER_HOST`
    - `DEV_HUB_CORS_ORIGINS` -> `DAM_HOPPER_CORS_ORIGINS`
    - `VITE_DEV_HUB_SERVER_URL` -> `VITE_DAM_HOPPER_SERVER_URL`
- [ ] Update documentation (`docs/`) to reflect these changes.
- [ ] Update GitHub Action workflows in `.github/workflows/` (artifact names, binary names).
- [ ] Update scripts in `scripts/` (bench.sh, compare-servers.sh).

### Phase 3: Renaming Structs, Types, and Variables in Code
Global find-and-replace for internal code identifiers.
- [ ] Rename Rust structs/types:
    - `DevHubConfig` -> `DamHopperConfig`
    - `DevHubConfigRaw` -> `DamHopperConfigRaw`
- [ ] Rename TypeScript types/interfaces:
    - `DevHubConfig` -> `DamHopperConfig`
- [ ] Rename internal variables/functions using `dev_hub`, `DevHub`, etc.
- [ ] Update crate imports in tests: `use dev_hub_server::...` -> `use dam_hopper_server::...`.

### Phase 4: Renaming Files and Directories
Renaming physical files and directories.
- [ ] Rename `deploy/dev-hub.service` to `deploy/dam-hopper.service`.
- [ ] Update internal references to `.dev-hub/` directory to `.dam-hopper/` (e.g., in `main.rs`, `schema.rs`).
- [ ] Rename any other files with "dev-hub" in their name.

### Phase 5: Renaming Cookies, Storage Keys, and UI strings
Renaming client-side state and UI elements.
- [ ] Update auth cookie: `devhub-auth` -> `damhopper-auth`.
- [ ] Update `localStorage` keys: `devhub:*` -> `damhopper:*`.
- [ ] Update UI labels and titles in React components.

### Phase 6: Verification
Ensuring the project still works after the rename.
- [ ] Build Rust server: `cd server && cargo build`.
- [ ] Build Web frontend: `pnpm build`.
- [ ] Run all tests: `cargo test`.
- [ ] Verify `dev-hub.toml` discovery works with the new filename.
- [ ] Verify environment variable overrides work.

## 3. Detailed Task Breakdown

### Phase 1: Core Metadata
- [ ] Replace `"dev-hub"` with `"dam-hopper"` in root `package.json`.
- [ ] Replace `"@dev-hub/web"` with `"@dam-hopper/web"` in root `package.json` and `packages/web/package.json`.
- [ ] Replace `"dev-hub-server"` with `"dam-hopper-server"` in `server/Cargo.toml`.
- [ ] Replace "Dev-Hub" with "DamHopper" in `README.md`.

### Phase 2: Configuration
- [ ] Search for `dev-hub.toml` and replace with `dam-hopper.toml` in:
    - `server/src/config/finder.rs`
    - `server/src/main.rs`
    - `server/src/api/tests.rs`
    - `server/src/config/tests.rs`
    - `server/tests/*.rs`
- [ ] Search for `DEV_HUB_` and replace with `DAM_HOPPER_` in:
    - `server/src/main.rs`
    - `docs/system-architecture.md`
    - `docs/configuration-guide.md`
    - `.github/workflows/ci.yml` (if any env vars)
- [ ] Search for `VITE_DEV_HUB_` and replace with `VITE_DAM_HOPPER_` in:
    - `packages/web/vite.config.ts`
    - `packages/web/src/api/server-config.ts`
- [ ] Update `scripts/bench.sh` and `scripts/compare-servers.sh`.

### Phase 3: Code Identifiers
- [ ] PascalCase: `DevHub` -> `DamHopper`
- [ ] snake_case: `dev_hub` -> `dam_hopper`
- [ ] SCREAMING_SNAKE_CASE: `DEV_HUB` -> `DAM_HOPPER`
- [ ] lowercase (no separator): `devhub` -> `damhopper`

### Phase 4: Files and Directories
- [ ] `mv deploy/dev-hub.service deploy/dam-hopper.service`
- [ ] `mv __fixtures__/workspace/dev-hub.toml __fixtures__/workspace/dam-hopper.toml`
- [ ] Update `server/src/utils/fs.rs` for `.dev-hopper-tmp-` temporary file prefix.
- [ ] Update `server/src/main.rs` and `server/src/config/schema.rs` for `.dam-hopper/` path.
- [ ] Update `.github/workflows/ci.yml` and `release.yml` for artifact and binary paths.

### Phase 5: UI & Storage
- [ ] Update `server/src/api/auth.rs` for `AUTH_COOKIE`.
- [ ] Update `packages/web/src/hooks/` and `packages/web/src/components/` for storage keys.

## 4. Risks & Dependencies
- **Data Persistence:** Users with existing `.dev-hub` directories or `dev-hub.toml` files will need to rename them. A migration note should be added to the README.
- **CI/CD:** GitHub Action workflows (`.github/workflows/`) need to be updated to use the new names (e.g., artifact names, service names).
- **External Scripts:** Any scripts outside the repository that call `dev-hub-server` will break.

## 5. Unresolved Questions
- Should we provide a migration script for existing users?
- Are there any hardcoded paths in production environments that need manual intervention?
