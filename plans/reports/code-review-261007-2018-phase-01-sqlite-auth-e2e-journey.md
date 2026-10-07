# Code Review Report: Phase 01 SQLite Auth Lite Mode E2E Fixture, Journey, and Capture

**Score**: 9.5 / 10
**Phase**: Phase 01 — SQLite Auth Lite Mode E2E Fixture, Journey, and Capture
**Plan**: `plans/261007-1933-sqlite-auth-e2e/phase-01-sqlite-auth-e2e-journey.md`
**Timestamp**: 2026-10-07 20:18 (Asia/Saigon)
**Status**: APPROVED

---

## Code Review Summary

### Scope
- **Files reviewed**: 6 files
  - `server/examples/application_e2e_seed.rs`
  - `packages/ui/e2e/fixtures/application-services.ts`
  - `packages/ui/e2e/sqlite-auth-lite-mode/sqlite-auth-lite-mode.spec.ts`
  - `packages/ui/e2e/sqlite-auth-lite-mode/evidence.json`
  - `packages/ui/e2e/sqlite-auth-lite-mode/review.md`
  - `packages/ui/e2e/sqlite-auth-lite-mode/screenshot.png`
- **Lines of code analyzed**: ~704 lines across reviewed files (+250 / -68 diff)
- **Review focus**: Security, performance, architecture, YAGNI/KISS/DRY, visual evidence integrity, and task completeness.
- **Updated plans**:
  - `plans/261007-1933-sqlite-auth-e2e/phase-01-sqlite-auth-e2e-journey.md` (all 4 todo items checked, status marked complete)
  - `plans/261007-1933-sqlite-auth-e2e/progress.md` (Phase 01 marked DONE with evidence links)

---

### Overall Assessment
Score: **9.5 / 10**

Phase 01 cleanly extends the containerized application E2E harness and seed tool to support SQLite authentication lite mode (`DAM_HOPPER_LITE_MODE=true`) without launching a MongoDB container, while preserving 100% backward compatibility for existing MongoDB-backed E2E journeys.

Key strengths:
1. **Security & Permission Hardening**: `startApplicationServices()` explicitly enforces `0700` on `/e2e/home`, `/e2e/home/.config`, and `/e2e/home/.config/dam-hopper` and `0600` on `/e2e/home/mfa.key` and `server-token` prior to running `application_e2e_seed`. This satisfies `SqliteAuthStore::open`'s strict parent-directory (`mode & 0o022 == 0`) and file (`0600`, `O_NOFOLLOW`) permission checks inside the container regardless of host staging umask.
2. **Real Authenticated Runtime Coverage (No `--no-auth`)**: The E2E spec verifies that unauthenticated `GET /api/projects` is rejected (`401`), authenticated `GET /api/auth/status` returns `{ authenticated: true, user: "admin", role: "admin" }` with `devMode: undefined`, newly registered accounts default to disabled (`401 ACCOUNT_DISABLED` on login), and admin-gated Native Advisor settings mutations succeed against the SQLite auth backend.
3. **Performance & Resource Isolation**: When `authBackend === "sqlite"`, `startApplicationServices()` skips pulling/starting `mongo:8.2` and skips the 1,500ms MongoDB readiness delay, reducing per-test container overhead while tracking only started containers in `ownedContainers` for clean teardown.
4. **Architecture & YAGNI/KISS/DRY**: `application_e2e_seed.rs` constructs `UserRecord`, `AuthSession`, and V2 JWT `AuthClaims` once and branches solely on storage persistence (`AuthStore::open_sqlite` vs `AuthStore::from_mongo`), avoiding duplicate token-signing or model logic.
5. **Visual Capture & Source Fingerprint Integrity**: `screenshot.png` (1440x900, SHA-256 `98dafa4a4ed6ba51ae41a67901c474af8eaad4aa80b93375475ceabde02fdf01`), `evidence.json`, and `review.md` are properly colocated and bound to `source_fingerprint: ea3c398020340d2ad7acbbf2f9063c41b56f542a803531ca6aac7f04be72f58c`.

---

### Critical Issues
*None*. Zero security vulnerabilities, credential leaks, or breaking regressions identified.

---

### Warnings (Medium Priority)
*None*.

---

### Suggestions (Low Priority)
1. **Idempotency when re-seeding an existing SQLite `auth.db` (`server/examples/application_e2e_seed.rs:135-139`)**:
   - **Observation**: The MongoDB branch deletes any pre-existing user/session with the same `username` / `session_id` before inserting (`delete_many`), whereas the SQLite branch calls `auth_store.create_user(user)` directly, which performs a strict `INSERT` and returns `StoreError::DuplicateUsername` if the file already contains `username`.
   - **Impact**: None in `startApplicationServices()` because every test container starts with a fresh `/e2e` directory. However, if a developer invokes `application_e2e_seed --sqlite-path` twice against the same local SQLite file, the second run will fail.
   - **Suggestion**: In a future touch, consider handling `Err(StoreError::DuplicateUsername(_))` or removing the existing file/record when re-seeding in standalone CLI usage.
2. **Custom `sqlitePath` parent directory permissions (`packages/ui/e2e/fixtures/application-services.ts:65-66,157-163`)**:
   - **Observation**: `chmod 0700` is hardcoded for `/e2e/home`, `/e2e/home/.config`, and `/e2e/home/.config/dam-hopper` (matching the default `sqlitePath`). If a future test passes a custom `config.sqlitePath` inside another pre-existing staging directory whose permissions are group/world-writable, `SqliteAuthStore::open` would reject the parent directory.
   - **Suggestion**: If custom `sqlitePath` values are used in future tests, include `path.posix.dirname(sqlitePath)` in the `mkdir -p` + `chmod 0700` preparation step.
3. **Missing doc comment on `Args::server_token` (`server/examples/application_e2e_seed.rs:36-37`)**:
   - **Observation**: Adding `sqlite_path` replaced the `/// Server token / JWT secret` doc comment above `server_token`, leaving `server_token` without a `--help` description.
   - **Suggestion**: Restore `/// Server token / JWT secret` above `#[arg(long, env = "SERVER_TOKEN")]` next time `application_e2e_seed.rs` is edited.

---

### Positive Observations
- **Zero-MongoDB Verification**: `sqlite-auth-lite-mode.spec.ts` explicitly asserts `expect(appServices.mongoContainerId).toBe("")` and checks `statContainerFile("/e2e/home/.config/dam-hopper/auth.db")` (`size > 0`), proving that authentication is genuinely backed by SQLite in lite mode.
- **Stdin + CLI Parity in Seeder**: `StdinConfig` fields `mongodb_uri`, `database`, and `sqlite_path` are all `Option<String>` with `.or(...)` fallback to CLI/env arguments, keeping stdin and flag-based invocation symmetric.
- **Visual Checkpoint Quality**: `screenshot.png` renders the complete 1440x900 connected workbench (`ONLINE E2E FIXTURE PROFILE`), file explorer tree, bottom terminal pane, and right-hand Native Advisor configuration view with zero layout clipping or missing fonts.

---

### Validation Commands & Results
1. **Playwright E2E TypeScript Typecheck**:
   - Command: `pnpm --filter @dam-hopper/ui test:e2e:typecheck`
   - Result: `PASSED` (0 errors, 1.2s)
2. **Production Test Container Image Build (includes `cargo build --release --example application_e2e_seed`)**:
   - Command: `pnpm --filter @dam-hopper/ui test:e2e:build-images`
   - Result: `PASSED` (`dam-hopper:server-builder`, `dam-hopper:production`, `dam-hopper:production-test` built cleanly; 511.23s; `source_fingerprint: ea3c398020340d2ad7acbbf2f9063c41b56f542a803531ca6aac7f04be72f58c`)
3. **Containerized SQLite Auth Lite Mode E2E Journey & Visual Evidence Capture**:
   - Command: `E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e e2e/sqlite-auth-lite-mode/sqlite-auth-lite-mode.spec.ts`
   - Result: `PASSED` (1 passed, 0 failed, 0 skipped; 8.1s; `functional_outcome: "passed"`, `cleanup_outcome: "passed"`)

---

### Metrics
- **Review Score**: 9.5 / 10
- **Critical Issues**: 0
- **Warnings**: 0
- **Suggestions**: 3
- **Type Coverage**: 100% (strict TypeScript + Rust compile checks)
- **Task Completeness**: 4/4 tasks in Phase 01 plan completed

---

### Unresolved Questions
None. All Phase 01 requirements and completion gates are satisfied.
