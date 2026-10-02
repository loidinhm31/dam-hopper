# Documentation Report — Phase 06 Plugin Runtime, SDK, and Bridge Retirement

**Date:** 2026-10-02  
**Scope:** Record the Phase 06 removal of Dam-Hopper's generic plugin runtime, SDK, routes, and UI bridge; verify onboarding impact.  
**Status:** Runtime/API/SDK/UI removal is documented below. Release/deployment retirement and related documentation cleanup remain separate work; this report does not claim full platform retirement.

## Current state assessment

- **REST/API:** The current Axum router registers no `/api/plugins` or `/api/plugins/admin*` routes. Plugin API modules/exports, runner services, state, and runner/test-server binary targets are absent. The WebSocket plugin epoch messages and associated auth/logout/agent-status coupling were removed; ordinary auth, session handling, and non-plugin WebSocket behavior remain.
- **SDK and UI bridge:** `packages/plugin-sdk/`, `server/src/plugins/`, `packages/ui/src/plugins/`, plugin API types, plugin host/frame/unavailable components, plugin Settings management components, and plugin-specific browser/unit tests are absent. The client no longer exposes the generic plugin namespace; plugin iframe styles were removed.
- **Release build:** `server/Cargo.toml` defines no plugin runner/test-server binaries. The Linux release workflow builds and packages the remaining server/web/helper binaries, not a plugin runner.
- **Distinct functionality retained:** Native Advisor remains a first-party API/UI integration (`/api/advisor/*` routes and client mappings); it is not the retired generic plugin runtime. `@dam-hopper/browser-bridge` also remains for the native host and is distinct from the removed plugin UI bridge.
- **Retirement boundary:** Plugin-specific Linux release-manager flags and deployment tests still exist (`--plugin-owner-user`, plugin deployment test scripts, and corresponding `tests/deploy` files). The current `package.json` still exposes `test:deploy:plugin-*` and includes plugin owner/rollback checks in `test:deploy`. The review report identifies Linux release/systemd retirement as a later phase. An unused `MAX_PLUGIN_UI_BYTES` declaration also remains in `packages/ui/src/api/ws-transport.ts`; it has no other source reference. Do not describe deployment retirement as complete based on this Phase 06 scope.

## Onboarding and configuration

**Verified: Phase 06 adds no environment variables, credentials, or secrets to onboarding.** The changed source/build files add no configuration requirement. `deploy/server.env.example` remains the existing API template: `MONGODB_URI` and `MONGODB_DATABASE` for production authenticated mode, `DAM_HOPPER_MFA_KEY_FILE` for production MFA encryption, and `DAM_HOPPER_CORS_ORIGINS` for the existing browser-origin allowlist. The MFA key remains an existing production requirement; it is not new to this phase. The release workflow continues to use GitHub's standard `GITHUB_TOKEN`; no new repository secret was introduced.

Plugin-specific account/admin setup remains in untouched release-manager code and older deployment guides. These are residual legacy deployment controls, not new onboarding requirements introduced by the runtime removal. They should be retired or reclassified with the separate deployment phase rather than silently presented as current plugin-runtime setup.

## Documentation synchronization gaps

The requested destination was the only file changed. A targeted scan found current-state plugin instructions that now need reconciliation:

- `docs/api-reference.md`, `docs/system-architecture.md`, `docs/codebase-summary.md`, and `docs/code-standards.md` still describe `/api/plugins*`, `packages/plugin-sdk`, or `server/src/plugins` as active implementation.
- `docs/frontend-components.md`, `docs/user-guide-multi-server-profiles.md`, and `docs/architecture/native-advisor.md` still describe the old Plugin Platform Settings/host boundary or refer to Advisor as a plugin. Preserve the Native Advisor feature while correcting that distinction.
- `docs/README.md`, `docs/project-overview-pdr.md`, and `docs/project-roadmap.md` still index or present the platform as current. `docs/CHANGELOG.md` records earlier plugin milestones but not this retirement; retain historical entries and add a dated retirement entry when that destination is authorized.
- `docs/plugin-platform-linux.md`, `docs/linux-release-manager.md`, `docs/linux-release-manifest.md`, `docs/linux-systemd.md`, and `docs/configuration/server-configuration.md` document runner accounts, units, routes, or administrator setup. Coordinate their retirement with the still-present release-manager/deployment code.
- `docs/plugin-platform-d00.md` and `docs/architecture/plugin-platform-d01.md`, `plugin-platform-d02.md`, `plugin-platform-d03.md`, and `plugin-platform-d05.md` are useful historical records, but should be marked superseded/retired rather than treated as live contracts.

No product guide, overview, changelog, sealed plan, roadmap, or progress file was edited; the authorized scope here was this report only. A repository compaction was generated outside the worktree for analysis; `docs/codebase-summary.md` was not refreshed because it is outside the authorized destination.

## Verification evidence

Evidence below is quoted from `plans/reports/tester-261002-1351-phase-06-plugin-runtime-validation.md`; tests were not rerun as part of this documentation-only assignment.

| Check | Recorded result |
|---|---|
| Rust server tests | 1,719 passed, 0 failed, 6 ignored |
| UI tests | 2,206 passed, 0 failed across 293 files |
| Live route smoke | `GET /api/plugins` returned 404; subsequent `GET /api/health` returned 200 |
| Source/config review | No plugin route/module/runner binary remains in the inspected API/runtime/build surfaces; existing API environment template retained |
| Docs validator | 42 files scanned; 945 internal links verified. It emitted 1,473 code-reference and 363 config-key heuristic warnings; no broad warning cleanup was attempted. |

Source review also confirmed the remaining deployment hooks and Advisor/browser-bridge distinctions described above. `plans/reports/code-review-261002-1358-phase-06-delete-plugin-runtime.md` records approval; its statement that plugin runner test scripts were removed conflicts with the current `package.json`, so this report follows the checked-in file state for that detail.

## Metrics and maintenance

- Authorized report updated: **1**; product docs updated: **0**.
- The review was focused on Phase 06 and plugin-related docs; a full-document audit/coverage percentage and documentation update cadence were not measured.
- Plugin retirement references remain across architecture, API, frontend, deployment, and overview documentation. Keep the deployment docs synchronized when the retained release-manager controls are actually retired.

## Unresolved questions

- Are plugin-owner/admin CLI options, runner systemd/manifest packaging, and the remaining `test:deploy:plugin-*` hooks scheduled for the separate deployment-retirement phase? Current source still contains them, so this report treats them as out of Phase 06 scope.
