# Phase 06: Delete Dam-Hopper plugin runtime, SDK and bridge

## Context links

- [Parent plan](./plan.md); [architecture proposal](../../docs/architecture/native-advisor.md).
- [Native contracts and acceptance](./reports/native-design-contract.md).
- [Validated decisions](./reports/validated-decisions.md); decisions and cleanup callsites already incorporated below.
- [Advisor source inventory](./research/evcrate-advisor-source.md); [retirement inventory](./research/plugin-retirement.md).
- Dependencies: Phase 05 G1 passed.

## Overview

- Date: 2026-10-02. Priority: P2.
- Implementation: pending. Review: pending. Progress: 0%.
- Owner: Platform removal worker; integration owner owns shared files. Estimated implementation effort: 6h.
- Planning only; instructions below are for the later implementation run.

## Key Insights

User explicitly chose entire platform retirement. Plugin context epochs are wired into otherwise general authenticated WebSocket startup/cleanup. Runtime/SDK/iframe/test-server can be removed, but normal auth/MFA watchers, PTY/filesystem streams and connection generation fencing must remain.

## Requirements

No plugin HTTP routes, generic invoke, binaries, SDK, package dependencies, registration UI, plugin bridge messages/epochs or obsolete fixtures/tests. Delete computeSha256Hex with registration/access UI; do not rehome a path-hash utility. No aliases or deprecated API shims. Preserve unrelated Vite plugins, browser extension, packages/browser-bridge, agent integrations and source formatting libraries.

## Architecture

Native Advisor is independent and replacement complete. Delete dead platform tree and consumers; surgically remove plugin WS epoch generation/query/revocation while retaining authenticated actor/session deadline. Migrate pure Advisor contracts to native ownership before deleting SDK types.

## Related code files

DELETE /home/loidinh/WS/dam-hopper/server/src/plugins/ and server/src/api/{plugins.rs,plugin_admin.rs,plugin_assets.rs}.
DELETE /home/loidinh/WS/dam-hopper/server/src/bin/{dam-hopper-plugin-runner.rs,dam-hopper-plugin-test-server.rs}.
DELETE /home/loidinh/WS/dam-hopper/packages/plugin-sdk/ and packages/ui/src/plugins/.
DELETE /home/loidinh/WS/dam-hopper/packages/ui/src/components/{PluginHost.tsx,PluginFrame.tsx,PluginUnavailableState.tsx} plus plugin-exclusive tests; settings-page/{PluginManagementSection.tsx,PluginManagementSection.test.tsx,PluginAccessModal.tsx}.
DELETE /home/loidinh/WS/dam-hopper/packages/ui/src/api/plugin-types.ts and packages/ui/scripts/plugin-test-client.mjs plus plugin-only browser tests after useful native scenarios migrated.
MODIFY /home/loidinh/WS/dam-hopper/server/src/{lib.rs,state.rs,api/mod.rs,api/router.rs,api/auth.rs,api/agent_status.rs,api/ws.rs,api/ws_protocol.rs}, server/Cargo.toml, packages/ui/src/api/{client.ts,ws-transport.ts}, package.json, pnpm-workspace.yaml, pnpm-lock.yaml, CI workflows through integration owner.
DELETE plugin-exclusive /home/loidinh/WS/dam-hopper/server/tests/plugin_*.rs and shared helpers used solely by them; retain tests with unrelated coverage.

## Implementation Steps

1. Recheck native Advisor no longer imports plugin types/code; source-dependent pure DTOs already have native ownership. Confirm G1 evidence before first destructive deletion.
2. Remove AppState.plugin_service constructor/builder, lib/api module exports, plugin routes/auth-only helper callers, max package settings and plugin-only binary entries. Remove `state.plugin_service.revoke_actor(...)` from api/auth.rs logout; preserve ordinary auth-session/media-ticket revocation and generalized require_admin. Coordinate api/agent_status.rs removal of host TOML plugin_owner_user fallback with Phase07; preserve service_user/home lookup and native agent-status ownership.
3. In server/src/api/ws.rs remove tuple epoch_id, EpochRegistry issuance, PluginGetEpoch match and final revoke_epoch; retain current actor construction, session/MFA expiry watcher and all pumps/cleanup. In server/src/api/ws_protocol.rs remove PluginGetEpoch/PluginEpoch/PluginRevoked wire variants and tests tied only to them.
4. Delete native client `plugins` namespace, PluginTransportSeam, fetchPluginUi/upload staging/getPluginEpoch/pending epoch maps and handlers; keep generic HTTP invoke/abort/credentials and WebSocket request bookkeeping.
5. Delete bridge/UI host/plugin metadata/document tree, iframe-only tests, plugin-sdk package/packed artifacts and fixture runtime. Delete computeSha256Hex with PluginAccessModal/PluginManagementSection; do not rehome it. Native Workspace placement remains because it implements native panel behavior. Keep packages/browser-bridge, which is used by native build and is not plugin-platform debris.
6. Remove plugin package scripts, workspace membership, CI jobs and dedicated dependencies; only remove a dependency after confirming no unrelated imports. One pnpm install updates lockfile after sibling manifest edits are integrated.
7. Inventory text references by specific identifiers, not generic word plugin. Classify surviving references as historical plan/docs or unrelated ecosystem plugins; runtime/build/release registration identifiers must be zero.
8. After all mutation waves settle, compile and run retained suites once. Real smoke authenticated WebSocket terminal creation/output, filesystem listing/watch, login/MFA expiry and native Advisor reads without runner or plugin epoch requests.
9. Record removal evidence and map formerly plugin-only auth tests onto native role/permission tests before deleting old coverage.

## Todo list

- [ ] Recheck native Advisor no longer imports plugin types/code; source-dependent pure DTOs already have native ownership. Confirm G1 evidence before first destructive deletion.
- [ ] Remove AppState.plugin_service constructor/builder, lib/api module exports, plugin routes/auth-only helper callers, max package settings and plugin-only binary entries. Remove `state.plugin_service.revoke_actor(...)` from api/auth.rs logout; preserve ordinary auth-session/media-ticket revocation and generalized require_admin. Coordinate api/agent_status.rs removal of host TOML plugin_owner_user fallback with Phase07; preserve service_user/home lookup and native agent-status ownership.
- [ ] In server/src/api/ws.rs remove tuple epoch_id, EpochRegistry issuance, PluginGetEpoch match and final revoke_epoch; retain current actor construction, session/MFA expiry watcher and all pumps/cleanup. In server/src/api/ws_protocol.rs remove PluginGetEpoch/PluginEpoch/PluginRevoked wire variants and tests tied only to them.
- [ ] Delete native client `plugins` namespace, PluginTransportSeam, fetchPluginUi/upload staging/getPluginEpoch/pending epoch maps and handlers; keep generic HTTP invoke/abort/credentials and WebSocket request bookkeeping.
- [ ] Delete bridge/UI host/plugin metadata/document tree, iframe-only tests, plugin-sdk package/packed artifacts and fixture runtime. Delete computeSha256Hex with PluginAccessModal/PluginManagementSection; do not rehome it. Native Workspace placement remains because it implements native panel behavior. Keep packages/browser-bridge, which is used by native build and is not plugin-platform debris.
- [ ] Remove plugin package scripts, workspace membership, CI jobs and dedicated dependencies; only remove a dependency after confirming no unrelated imports. One pnpm install updates lockfile after sibling manifest edits are integrated.
- [ ] Inventory text references by specific identifiers, not generic word plugin. Classify surviving references as historical plan/docs or unrelated ecosystem plugins; runtime/build/release registration identifiers must be zero.
- [ ] After all mutation waves settle, compile and run retained suites once. Real smoke authenticated WebSocket terminal creation/output, filesystem listing/watch, login/MFA expiry and native Advisor reads without runner or plugin epoch requests.
- [ ] Record removal evidence and map formerly plugin-only auth tests onto native role/permission tests before deleting old coverage.

## Success Criteria

Native-only build and WebSocket login work without plugin service. /api/plugins* returns native API 404, not SPA HTML or compatibility shim. No plugin SDK/runtime/iframe worker dependency in code/package graph. Terminal/FS/auth/native Advisor remain exercised. Historical plan references may remain clearly historical.

## Risk Assessment

Blind delete of ws epoch setup can damage auth state; remove only plugin association. Broad grep for plugin catches unrelated Vite/agent/plugin systems, which are out of scope. Dependency pruning must not remove libraries used in releases/native Advisor.

## Security Considerations

Keep current authentication/session watcher and disconnect semantics. General admin guard remains independent of obsolete plugin module. Preserve route API 404 behavior and CORS policy.

## Next steps

Integrate with Phase 07 deployment removal and Phase 08 source retirement; final verification Phase 09.

Unresolved questions: see parent plan; do not silently reduce acceptance or invent missing source behavior.
