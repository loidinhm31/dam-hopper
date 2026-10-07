# Docs Manager — Phase 04 Auth Parity Qualification Status & Onboarding

- Date: 2026-10-07
- Phase: Phase 04 — Authentication Parity and Runtime Qualification
- Branch: feat/sqlite-auth
- Status: Complete (Non-Durable Advisory Report)
- Scope: Documentation status audit and developer/operator onboarding requirements. No source documentation updated (operator docs and release notes belong to Phase 05).

---

## 1. Documentation Status & Current-State Assessment

### Authorized Paths
- Phase 04 authorization: zero doc files under `docs/` require modification in this phase.
- Operator runbooks, environment configuration guides, and release notes are explicitly scoped to Phase 05 (`phase-05-operator-docs-and-release`).
- Prior sealed paths (`plans/261007-1047-sqlite-auth-lite-mode/*`) and `docs/project-roadmap.md` remain strictly untouched.

### Current State of Core Documentation
- `docs/architecture/authentication-state-and-cryptography.md` (143 LOC):
  - Architecture matches landed SQLite implementation (`server/src/auth/store/sqlite.rs`, `001-auth.sql`).
  - Correctly details STRICT tables (`auth_users`, `auth_sessions`, `auth_challenges`), immutable ID trigger (`auth_users_id_immutable`), WAL mode, 0600/0700 file security, and CAS mutations.
- `docs/api/authentication.md` (260 LOC):
  - Accurately details challenge-response protocol, TOTP enrollment/verification, session policy, and dev mode (`--no-auth`).
- `docs/configuration/server-environment-auth.md` (110 LOC):
  - Accurately details `DAM_HOPPER_MFA_KEY_FILE` formatting (32-byte raw / 64-hex / 44-b64), 0600 permissions, and emergency reset flow.
- `docs/configuration-guide.md` (731 LOC):
  - General server runtime configuration remains valid.
- `docs/system-architecture.md` (208 LOC):
  - Subsystem mapping is structurally sound and up-to-date.

---

## 2. Documentation Gap Analysis (Phase 05 Scope)

Items landed in Phase 04 that require formal operator documentation in Phase 05:

1. **Error Discrimination in HTTP API Docs (`docs/api/authentication.md`):**
   - Document that backend storage failure during credential verification returns HTTP 503 `storageUnavailable` (not HTTP 401 `InvalidCredentials`).
   - Document that storage failures do not increment lockout/throttling penalties on re-authentication.
2. **Production Startup Invariant (`docs/configuration/server-environment-auth.md`):**
   - Document fail-closed startup behavior: in production lite mode, invalid or missing `DAM_HOPPER_MFA_KEY_FILE` bails out before creating or touching `auth.db`.
3. **Database File Collision Guard (`docs/configuration/server-environment-auth.md`):**
   - Document path separation requirement: `DAM_HOPPER_AUTH_SQLITE_PATH` cannot collide with session database (`sessions.db`) or telemetry database.
4. **SQLite Operator Recovery Runbook (`docs/configuration/server-environment-auth.md`):**
   - Provide direct SQLite runbook commands (`sqlite3 auth.db`) to complement existing MongoDB shell examples for manual account approval, role promotion, and MFA factor reset.
5. **Release Notes & Changelog (`docs/CHANGELOG.md`):**
   - Record SQLite auth backend parity qualification, zero-skip test qualification, and production runtime hardening.

---

## 3. Onboarding Requirements

### For Developers

1. **Zero-Dependency Test Execution:**
   - Full authentication and transport integration tests run against SQLite with zero MongoDB dependencies via `AuthTestFixture::new_sqlite()`.
   - Run focused qualification suites:
     ```bash
     cargo test --test auth_sqlite_store --test auth_lite_mode --test auth_mfa --test auth_mfa_api
     ```
2. **Full Crate Test Execution with Mongo Parity:**
   - When qualifying Mongo backend parity, ensure local Mongo instance is accessible:
     ```bash
     TEST_MONGODB_URI="mongodb://127.0.0.1:27018" cargo test
     ```
3. **Sensitive Memory Hygiene Rules:**
   - All password buffers must implement `zeroize::Zeroize` and wipe immediately across all exit branches (`Ok` and `Err`).

### For Operators

1. **Enabling Lite Mode:**
   - Set environment variable: `DAM_HOPPER_LITE_MODE=1` (or `true`).
   - SQLite authentication database defaults to `auth.db` in server config directory (`~/.config/dam-hopper/auth.db`).
   - Optional override: `DAM_HOPPER_AUTH_SQLITE_PATH=/path/to/custom/auth.db`.
2. **Mandatory Production Key Provisioning:**
   - In production (`RUST_ENV=production` or `ENVIRONMENT=production`), `DAM_HOPPER_MFA_KEY_FILE` is mandatory.
   - Key file format: exactly 32 raw bytes, 64 hex characters, or 44 base64 characters.
   - Permissions: strictly owner-only (Unix mode `0600`), regular file, non-symlink.
   - Parent directory permissions: Unix mode `0700`, non-world/group writable.
   - Startup failure: if key file is absent or invalid, server aborts immediately and does not initialize or touch `auth.db`.
3. **Database Segregation Invariant:**
   - `DAM_HOPPER_AUTH_SQLITE_PATH` must point to an isolated file path distinct from `sessions.db` and telemetry databases.
4. **Initial User Bootstrapping:**
   - Normal registration endpoint (`POST /api/auth/register`) creates users in `pending` (disabled) state.
   - Initial admin activation requires out-of-band operator approval (via SQLite update setting `is_enabled = 1, role = 'admin'`).

---

## 4. Maintenance & Validation Metrics

- **Documentation Link Hygiene:** Checked via `node .omp/evcrate/scripts/validate-docs.cjs docs/`. 70/70 markdown files verified; 0 broken internal links.
- **LOC Limits Compliance:** All core auth documentation files remain under the 800 LOC ceiling:
  - `docs/architecture/authentication-state-and-cryptography.md`: 143 LOC
  - `docs/api/authentication.md`: 260 LOC
  - `docs/configuration/server-environment-auth.md`: 110 LOC
  - `docs/configuration-guide.md`: 731 LOC
  - `docs/system-architecture.md`: 208 LOC
- **Test Qualification Evidence:**
  - 1,942 / 1,942 crate tests passed (100% pass rate, 0 runtime skips, 6 compile-time ignores).
  - 76 / 76 targeted auth/transport tests passed (100% pass rate).
  - 13 / 13 live server smoke journeys verified.
- **Code Review Score:** 9.5/10 with zero security vulnerabilities or credential leaks.

---

## 5. Unresolved Questions

None.
