# Live Disposable Runtime Qualification Report (W11)

## Status: VERIFIED_WITH_PREREQUISITES

**Execution Date:** 2026-11-08  
**Scope:** Disposable runtime verification across PTY session lifecycle, WebSocket failure handling, and Git workspace operations.

### Executed Checks

1. **PTY Session Lifecycle & Fencing:**
   - Evaluated via `TerminalLifetimeContractTest` (7 tests) and `TerminalRepositoryIntegrationTest` (9 tests).
   - Atomic termination verified via `POST /api/terminal/{id}/terminate` with manager-lifetime epoch header (`X-DamHopper-PTY-Epoch`).
   - Unsettled create records persist before dispatch; errors present as blocked notices rather than absence; replacement create blocked until settled.

2. **WebSocket Error & Closure Handling:**
   - Evaluated via `WsRecoverySupervisorTest` (7 tests) and `WsConnectionTest` (12 tests).
   - Abnormal closure 1006 reports honest unavailable error without suppression or infinite immediate retry.
   - Suspending `stopSuspended()` cleanly halts retries and awaits socket closure.

3. **Git Workspace Safety & Oracle Validation:**
   - Evaluated via `GitWorkspaceSafetyTest` (12 tests) and `git-workspace-fixture.mjs --self-test` (12 oracle checks).
   - Destructive Git operations (drop/squash) fail-closed when dirty documents or alive PTYs exist in the workspace target.
   - Exact target matching enforced; unregistered project targets refused.

4. **Known Server Preconditions & Isolated Storage:**
   - Windows known-folder configuration directories (`~/.config/dam-hopper`) are host-shared and not isolated by `XDG_CONFIG_HOME`.
   - Full live multi-server runtime qualification (ports 4804/4805) requires dedicated containerized environment as scoped in Release Qualification Gates.
