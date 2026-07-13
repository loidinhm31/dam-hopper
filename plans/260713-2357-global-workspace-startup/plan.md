# Global Workspace Startup Fix

## Preflight Contract

**Output:** Fix first access so an existing global registry at `~/.config/dam-hopper/dam-hopper.toml` prevents the workspace setup wizard.

**Acceptance Criteria:**
- Server startup prefers the global registry when no explicit workspace is provided.
- Web startup migrates legacy server profile config before creating `WsTransport`.
- Explorer FS remains available for valid projects even when another configured project root is missing.
- Regression tests cover resilient FS sandboxing and migrated profile URL selection.

**Scope Boundary:**
- In scope: startup config priority, web transport initialization order, resilient project FS sandboxing.
- Out of scope: auth redesign, MongoDB login, setup wizard redesign.

**Risk/Public Contracts:**
- `/api/workspace/status` response shape stays unchanged.
- Existing `--workspace` behavior stays higher priority than global registry.
- No database or token changes.

**Testing Strategy:**
- Full Rust test suite.
- Targeted UI server config test.
- UI package compile and web bundle compile.
- Lint checked; current failures are unrelated pre-existing React hook/compiler issues.

**Open Questions:** none.

## Phase 01 - Fix And Verify

Status: done

Steps:
1. Add global registry path helper and startup priority.
2. Keep workspace status read-only so explicit empty workspaces still show setup.
3. Move web profile migration before transport creation.
4. Skip unavailable project roots instead of disabling all Explorer FS access.
5. Add regression tests.
6. Run verification.

## Side-Effect Review

- Auth/session: no auth behavior change.
- API/client compatibility: response fields unchanged.
- Data integrity: no config writes.
- Security/secrets: no secret handling change.
- Performance: startup and workspace switch skip invalid project roots with one warning per skipped root.
