# Phase 05 — Qualification, rollout, and MongoDB recovery

## Context links

[Plan](./plan.md) · [Acceptance matrix](./acceptance-matrix.md) · [Recovery contract](./security-contract.md#mongodb-recovery-runbook-design) · Phases [01](./phase-01-auth-state-and-policy.md), [02](./phase-02-authentication-api.md), [03](./phase-03-transport-enforcement.md), [04](./phase-04-profile-mfa-flow.md)

## Overview

Date: 2026-09-26. Status: **DONE (2026-09-27; 100%)**. Priority: P1. Cycle 2 review approved (2026-09-27; 9.9/10). All 120/120 scoped tests verified (39 backend, 81 frontend), including end-to-end TCP/WebSocket deadline and MongoDB recovery smoke. Production deployment still requires protected key provisioning and a matched client/server rollout with old instances restarted.

## Key Insights

Many current backend fixtures sign legacy JWTs without a MongoDB session. `pnpm dev:server` explicitly runs --no-auth and cannot prove MFA. Existing deployment media/session behavior requires real HTTP/WS/browser verification, not unit tests alone.

## Requirements

Real isolated MongoDB, real server in authenticated mode, valid secret-file provisioning, controlled clock seam, actual browser enrollment. Preserve unaffected tests and deployment modes. Never touch live user data to test expiry or reset.

## Architecture

Permanent tests focus on consumer-visible authorization invariants/races and profile ownership. A disposable smoke harness controls time without adding production clock-override routes. Seed test accounts/sessions in isolated database and run actual REST, sockets, and streams; retain evidence without QR/secrets/tokens.

## Related code files

Modify relevant fixtures: `server/src/api/tests.rs`, `server/tests/auth_no_auth.rs`, `server/tests/common/mod.rs`, `server/tests/plugin_admin_api.rs`, `plugin_api_integration.rs`, `browser_debug_artifacts.rs`, `fs_mutate.rs`, `fs_upload.rs`, `fs_write_streaming.rs`, `ws_fs_subscribe.rs`, `settings_import_export.rs`; `server/src/bin/dam-hopper-plugin-test-server.rs` when affected.

Create focused behavior tests: `server/tests/auth_mfa.rs` and `server/tests/common/auth_fixtures.rs`; unit tests next to auth policy/TOTP modules. Do not introduce in-memory authorization mocks to evade real DB behavior.

Update existing UI tests: `packages/ui/src/api/connections.test.ts`, `ws-transport.test.ts`, `server-config.test.ts`, `components/organisms/ServerSettingsDialog.test.tsx`, `ServerProfilesDialog.test.tsx`; add browser regression in the existing browser test layout after discovery for actual MFA interaction/races.

Update docs after passing smoke: `docs/api-reference.md`, `configuration-guide.md`, `system-architecture.md`, `project-overview-pdr.md`, `codebase-summary.md`, `CHANGELOG.md`; existing deployment documentation and `deploy/` secret-file plumbing where required. Keep documentation focused, no new unrelated guides.

## Implementation Steps

1. Inventory affected JWT/actor fixtures from server research. Migrate auth consumers to isolated seeded real users/sessions; keep explicit development tests no-auth. No legacy acceptance shim or production test-only auth bypass.
2. Implement deterministic clock-boundary, concurrent CAS, reset/re-enrollment, logout, backend failure, and profile-race tests from matrix. Use unique DB names and cleanup; suite execution may not silently skip security coverage when DB unavailable.
3. Run integrated formatting/build/lint/tests once after implementation slices settle, using repository commands below. Correct actual failures; do not re-pin wording/source-text tests.
4. Launch real authenticated Rust server and shared web app against temporary MongoDB/key. Use disposable HTTP/WS smoke driver and actual browser: enroll once by QR and once by manual setup key; independently generate TOTP with a second implementation/app.
5. Exercise legacy token rejection, day-10 cutoff on open socket and slow media body, unchanged day-30 expiry after step-up, day-30 full login, independent profiles/devices, and MongoDB reset while connected. Time advancement only through test harness/isolated state, never production route.
6. Verify desktop, native shared flow, and Android Chrome auth input. Capture sanitized browser evidence; never retain real QR/key/code/password/token in screenshots or reports. Close browser/processes and remove throwaway scripts/database afterward.
7. Document MFA encryption-key provisioning, ownership/ACL, backup/restore, clock sync, exact 10/30-day semantics, network privacy, database availability, and the atomic MongoDB reset procedure. Promote proposed architecture to implemented only after evidence.
8. Stage matched client/server, create required key/indexes and safe user-version migration before traffic. Maintenance/restart all old server instances so no old JWT-only code accepts traffic; force existing sessions through new login/enrollment. No grace-period legacy JWT acceptance.
9. Confirm account approval still required; no rollout operation enables users or resets passwords. Confirm old tokens, sockets, and tickets fail while new confirmed-MFA session succeeds.
10. Rollback cannot reopen password-only access. Retain MFA-capable compatible build and auth data/key; if unavailable, stay fail closed in maintenance and repair forward. Never rotate/delete encryption key or restore stale auth snapshots casually.

## Verification commands (future implementation, not run during planning)

- `cargo test --manifest-path server/Cargo.toml --test auth_mfa`
- `cargo test --manifest-path server/Cargo.toml --test auth_no_auth`
- `pnpm --filter @dam-hopper/ui test` and `pnpm --filter @dam-hopper/ui test:browser`
- `cargo fmt --manifest-path server/Cargo.toml --check`; targeted Prettier using repo configuration.
- `pnpm check` after targeted verification; platform-dependent native build prerequisites must be available or explicitly reported, never represented as passed.
- Real authenticated server command uses `cargo run --manifest-path server/Cargo.toml --bin dam-hopper-server -- --host 127.0.0.1 --port <isolated-port>` with isolated MONGODB_URI/MONGODB_DATABASE, key file and workspace config. Do not use the existing no-auth dev script as MFA evidence.

## Todo list

- [x] Migrate auth-dependent fixtures and add focused boundary/race coverage.
- [x] Execute real enrollment, deadline, transport, and recovery scenarios.
- [x] Update operator/API/architecture docs and changelog after smoke.
- [x] Qualify cutover, compatible rollback, and secret provisioning.

## Success Criteria

Phase 05 is complete based on acceptance-matrix evidence, 120/120 scoped tests, end-to-end TCP/WebSocket deadline and MongoDB recovery smoke, and the approved Cycle 2 review. Production deployment remains gated on protected key provisioning, compatible client/server rollout and restart, and closure/review of the carried-forward security concerns recorded below.

## Risk Assessment

Two carried-forward security concerns remain outside Phase 05's changed-file and final-review scope and should block production deployment until addressed or formally dispositioned: the Phase 02 account-enumeration finding (missing and disabled accounts receive distinct/early login responses before bcrypt; see the [Phase 02 review](../reports/code-review-260927-0031-phase-02-auth-api.md)) and the Phase 01 MFA key-loader TOCTOU finding (see the [Phase 01 review](../reports/code-review-260926-2258-phase01-auth-state-and-policy.md)). Preserve secure MFA-key backups; do not roll back to password-only access.

## Security Considerations

Operator MongoDB edits are privileged account recovery, not user self-service. Test reset with immutable account identity + expected version and verify exactly one modification. Do not disable MFA to recover access or roll back to password-only service.

## Next steps

Phase 05 status: **DONE (2026-09-27; 100%)**. Implementation, qualification, 120/120 scoped tests, documentation, and Cycle 2 review (9.9/10) are complete. The feature branch is ready for merge; production rollout must wait for protected key provisioning, coordinated server restart, and independent closure/review of the carried-forward security concerns.
