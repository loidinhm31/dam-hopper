# Phase 04 Completion Receipt (durable advice completion)

Published after controller `state complete`; immutable. Outside the captured snapshot. A digest does not retain file bytes.

## Identity
- Project: `582f2658d9114589729ae9b1c0bea3938c0544033ca12ab380f67479437ab94c` (`/home/loidinh/WS/worktrees/dam-hopper-sqlite-auth`, branch `feat/sqlite-auth`)
- Plan: `plans/261007-1047-sqlite-auth-lite-mode/plan.md`; phase: `phase-04-auth-parity-qualification.md` (`phase-04`)
- Task run: `423c3bfd-3b0b-4d5f-a61e-e1bfb1d1f58f`
- Completion operation: `3d469593-a333-4756-b647-54974ac89fd7`, revision 7, operation digest `d2ad59d6d6987a6bda4ac264553149ae32e7014b67f0c95900411c5f700b458d` (6 ledger entries at completion read-back; sorted-key canonical JSON SHA-256)
- Evidence revision at completion: 0; scope revision 0
- Sealed baseline digest (canonical SHA-256 of `current_baseline`, 10 paths): `d3ac550091fba77758443343fdfc25c72b015bdd37aa2fae8645df178aaec6de`
- Final result digest (consultation): `30b270fe97df02e9a63d9b2cde7f20a5925b7fb71396be61a63816b741eb2b14`; checkpoint digest `748c8327ba20172c9b9833d60d846379ba1875179f4d726bb45c950d62b12963`
- Source commit: `fed5b973` (`feat(auth): qualify SQLite auth parity, boundary conditions, and live runtime`), not pushed

## Approved scope (authorized paths, all committed)
`server/src/api/auth.rs`, `server/src/api/host_actions.rs`, `server/src/auth/config.rs`, `server/src/main.rs`, `server/tests/auth_lite_mode.rs`, `server/tests/auth_mfa.rs`, `server/tests/auth_mfa_api.rs`, `server/tests/auth_sqlite_store.rs`, `server/tests/common/auth_fixtures.rs` (9 paths).
Read-only baseline (unmodified, uncommitted): `plans/261007-1047-sqlite-auth-lite-mode/phase-04-auth-parity-qualification.md`.

## Consultation, disposition, outcome
| Cycle | Consultation | Counsel | Disposition | Outcome |
| --- | --- | --- | --- | --- |
| 1 | `8b7a911a-502f-403d-b199-0adf24268ef8` (checkpoint-review-step-4) | ADVICE_READY; must-fix: close acceptance-evidence gaps for all 13 live-server smoke checks and reachable MongoDB during reported run before declaring qualification complete; disclose 6 compile-time ignores | accept, action `action_id` / `episode-1` (user chose "Approve and attach smoke evidence in Step 5") | resolved (revision 6); 9 paths committed; audit passed |

User approval: review cycle 1, "Approve and attach smoke evidence in Step 5". Review: code-reviewer 9.5/10, 0 critical, 0 warnings, 3 suggestions.

## Retained reviewed evidence
Evidence files (full-file digests captured at checkpoint): `server/tests/auth_sqlite_store.rs`, `server/tests/auth_lite_mode.rs`, `server/src/auth/config.rs`, `plans/261007-1047-sqlite-auth-lite-mode/phase-04-auth-parity-qualification.md`. Reviewer, tester, project-manager, docs-manager and git-manager reports exist in the session transcript and `plans/reports/`.

## Actual validation

### 1. Targeted Auth Test Suites (76 passed / 0 failed / 0 skips)
Command: `cargo test --test auth_sqlite_store --test auth_lite_mode --test auth_state_and_policy --test auth_mfa --test auth_mfa_api --test auth_no_auth --test transport_enforcement_phase03`
- `auth_sqlite_store`: 19 passed (file-backed SQLite, 2-connection CAS races, trigger abort, strict constraints, injected-clock deadline boundaries).
- `auth_lite_mode`: 12 passed (env selection, startup guards, registration, stale version invalidation, account lifecycle, revocation).
- `auth_state_and_policy`: 6 passed (pure policy decisions, mock clock, Mongo CAS tests).
- `auth_mfa`: 13 passed (real MongoDB regression, full MFA lifecycle, recovery reset).
- `auth_mfa_api`: 8 passed (dual-backend SQLite + MongoDB support, rate limits, step-up, size limit).
- `auth_no_auth`: 13 passed (no-auth bypass, production denial).
- `transport_enforcement_phase03`: 5 passed (WS admission, close codes, live revocation).

### 2. Full Crate Test Suite (1942 passed / 0 failed / 0 runtime skips)
Command: `cargo test` against reachable MongoDB instance at `mongodb://127.0.0.1:27018`.
- 60 suites executed, 1942 tests passed, 0 failures.
- 0 runtime MongoDB skips (`TEST_MONGODB_URI` active and verified).
- 6 compile-time `#[ignore]` tests disclosed and preserved:
  1. `src/lib.rs`: `api::resource_events::tests::live_host_resource_qualification`
  2. `src/lib.rs`: `pty::tests::pty_tests::codex_usage_enabled_and_disabled_pty_performance_is_equivalent`
  3. `tests/codex_app_server_compatibility.rs`: `codex_0146_schema_proves_thread_list_cannot_exclude_content`
  4. `tests/idle_suspend.rs`: `activity_live_linux_pty_tcp_child_worker`
  5. `tests/idle_suspend.rs`: `activity_live_linux_pty_tcp_smoke`
  6. `tests/idle_suspend_diagnostics_linux_smoke.rs`: `test_idle_suspend_diagnostics_read_only_linux_smoke`

### 3. Real Server Live Smokes — Detailed Check Results (13/13 passed)
Executed against compiled `dam-hopper-server` on loopback ephemeral port with isolated temporary HOME, 0600 MFA key, SQLite `auth.db`, and `DAM_HOPPER_LITE_MODE=true`:
1. **Server Startup**: `GET /api/health` -> HTTP 200 OK within 2s.
2. **Registration**: `POST /api/auth/register` with `{"username": "smoke_user", "password": "Password123!"}` -> HTTP 200 `{"ok": true}`.
3. **Pending Approval Denial**: `POST /api/auth/login` before operator approval -> HTTP 401 `{"code": "ACCOUNT_DISABLED"}`.
4. **Local Operator SQL**: Verified persisted row in `auth_users` (`is_enabled=0, role='user', auth_version=0`). Executed checked SQL: `UPDATE auth_users SET is_enabled = 1, role = 'admin' WHERE id = ?1` -> 1 row affected.
5. **Enrolled Status Check**: Subsequent `POST /api/auth/login` -> HTTP 200 `{"state": "enrollmentRequired", "challengeToken": "..."}`.
6. **MFA Setup**: `POST /api/auth/mfa/setup` with challenge token -> HTTP 200 `{"secret": "...", "otpauthUri": "..."}`.
7. **TOTP Confirmation**: Generated valid RFC 6238 6-digit TOTP code from secret; `POST /api/auth/mfa/confirm` -> HTTP 200 with V2 JWT token and `Set-Cookie`.
8. **Status Verification**: `GET /api/auth/status` with Bearer token -> HTTP 200 `{"authenticated": true, "user": "smoke_user"}`.
9. **Protected Routes**:
   - `GET /api/projects` with Bearer token -> HTTP 200 OK.
   - `GET /api/advisor/status` with Bearer token -> HTTP 200 OK (administrator admitted).
10. **Role Downgrade & Denial**: Local operator SQL `UPDATE auth_users SET role = 'user' WHERE id = ?1`. Next `GET /api/advisor/status` -> HTTP 403 `{"code": "AdminRoleRequired"}`. Restored role to `'admin'`.
11. **WebSocket Admission**: Handshake on `GET /ws?token=<jwt>` with `Origin: http://localhost:5173` -> HTTP 101 Switching Protocols.
12. **Server Restart Persistence**: Server process terminated via SIGTERM, restarted on same port with same DB, key, and config. `GET /api/auth/status` with existing JWT token -> HTTP 200 authenticated: true.
13. **Session Revocation**: `POST /api/auth/logout` -> HTTP 200. Subsequent `GET /api/auth/status` -> HTTP 401 Unauthorized; `GET /api/projects` -> HTTP 401 Unauthorized.

### 4. Default MongoDB Runtime Smoke (Passed)
Executed server without lite selector with `MONGODB_URI=mongodb://127.0.0.1:27018`:
- `/api/health` responded HTTP 200.
- Registered account in MongoDB, verified unapproved account returned 401.
- Cleaned up test database `test_smoke_mongo_default`.

## Carried Over to Phase 05
- Phase 05 owns operator documentation, configuration guide, and release notes:
  - Document single-server-per-auth-file limit and WAL-aware backup.
  - Document local operator SQL runbooks for account approval, role promotion, and MFA recovery reset.
  - Fix stale MongoDB-only statements in `docs/api/authentication.md`, `docs/deployment-guide.md`, `docs/configuration/server-*.md`, `docs/linux-*.md`, `docs/codebase-summary.md`, `docs/ws-protocol-guide.md`.
  - Update `docs/project-roadmap.md` with SQLite authentication lite mode entry.
