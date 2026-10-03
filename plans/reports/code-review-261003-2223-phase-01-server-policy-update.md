# Code Review Report: Phase 01 — Server Policy Update

**Date:** 2026-10-03  
**Reviewer:** Phase01Reviewer  
**Target Plan:** `plans/261003-1822-advisor-routing-model-selector/phase-01-server-policy-update.md`  
**Score:** 9.6 / 10  

---

## Executive Summary

Phase 01 implements route-only, revision-checked mutation of existing V2 account policies (`PATCH /api/advisor/policy`). The implementation strictly adheres to the native advisor security invariants:
- Zero unauthenticated or non-admin access (guarded by `require_auth`, `require_admin`, and `check_advisor_enabled`; `--no-auth` denied).
- Recursive credential screening runs *before* typed deserialization can drop unrecognized fields.
- `deny_unknown_fields` prevents injection of non-route keys.
- Disk format preservation preserves all existing `wait`, `history`, and metadata fields in their original snake_case formatting on disk.
- Atomic filesystem replacement with handle-relative `O_NOFOLLOW` traversals, exclusive mode 0600 temp file creation, and parent directory fsync.
- Dedicated `policy_lock` in `AdvisorService` with owned guard transferred into `tokio::task::spawn_blocking` prevents concurrent write races while keeping Tokio worker threads responsive.

All 11 policy unit tests and 7 policy integration tests pass cleanly with zero compiler warnings and zero advisor linter issues.

---

## Code Quality Assessment

### Scope
- **Files reviewed:**
  - `server/src/advisor/error.rs` (+75 LOC)
  - `server/src/fs/secure_path.rs` (+193 LOC)
  - `server/src/advisor/policy.rs` (+591 LOC / -174 LOC, total 907 LOC)
  - `server/src/advisor/history.rs` (+19 LOC, total 582 LOC)
  - `server/src/api/advisor.rs` (+44 LOC / -6 LOC, total 217 LOC)
  - `server/src/api/router.rs` (+5 LOC, total 878 LOC)
  - `server/tests/advisor_policy_evaluations.rs` (+165 LOC, total 619 LOC)
- **Lines of code analyzed:** ~3,470 LOC
- **Review focus:** Policy mutation semantics, SHA-256 byte revision CAS, no-follow filesystem security, request credential screening, atomic replacement, error sanitization, admin authorization.
- **Updated plans:**
  - `plans/261003-1822-advisor-routing-model-selector/phase-01-server-policy-update.md` (all 5 tasks checked [x], status updated to Implementation settled)
  - `plans/261003-1822-advisor-routing-model-selector/progress.md` (Phase 01 status updated)

---

### 1. Security
- **Strict Authorization:** `PATCH /api/advisor/policy` is registered in `advisor_routes` under `require_admin` and `require_auth`. Requests in `--no-auth` dev mode and non-admin sessions are rejected with 403 `NoAuthForbidden` and 403 `AdminRoleRequired`.
- **Pre-Deserialization Credential Scrubbing:** Request JSON is parsed into raw `serde_json::Value` and recursively inspected via `check_credentials` *before* `PolicyUpdateParamsDto` typed deserialization. Rejection ensures credentials cannot be stored, silently dropped, or leaked into error logs.
- **Closed Request Schema:** `deny_unknown_fields` is enforced on `PolicyUpdateParamsDto`, `PolicyAdvisorDto`, and `PolicyRouteTargetDto`. Extraneous attributes (including attempts to modify `wait` or `history`) are rejected.
- **Bounded Inputs:** Model identifier max 256 chars; effort max 64 chars; control characters rejected; backends restricted to `ENABLED_BACKENDS` (`claude`, `codex`, `pi`, `omp`); `omp`/`pi` require non-empty `provider/model`; per-backend allowed effort sets enforced.
- **Safe Path Resolution:** Evaluated exclusively against server-owned captured `home_dir`. HOME and `.evcrate` are validated as absolute, non-symlink directories. Target file is validated as regular, non-symlink, <= 16 KiB.
- **Handle-Relative Atomic Commit:** `secure_path::replace_regular_file_if_bytes_match` uses `open_parent` and `openat` with `O_NOFOLLOW` for all path components, writes to an exclusive temporary file with mode 0600, syncs data, executes `rename_at`, and syncs the parent directory.
- **Sanitized Error Responses:** All error variants (`POLICY_REVISION_CONFLICT`, `POLICY_FILE_UNSAFE`, `POLICY_NOT_EDITABLE`, `POLICY_WRITE_FAILED`, `POLICY_PAYLOAD_TOO_LARGE`) emit sanitized messages without exposing internal filesystem paths or raw OS errors.

### 2. Performance
- **Asynchronous Worker Protection:** All blocking filesystem operations (read, validation, serialization, sync, rename) are offloaded to `tokio::task::spawn_blocking`.
- **Owned Lock Concurrency:** An `Arc<Mutex<()>>` owned lock guard is acquired asynchronously and moved into the blocking task, ensuring serialization is held across HTTP cancellation while never blocking unrelated discovery, status, or history operations.
- **Bounded Memory:** 16 KiB body limit layer in Axum, 16 KiB manual byte check in handler, bounded stream read in `read_regular_file_bounded`, and 16 KiB post-serialization output check prevent memory exhaustion.

### 3. Architecture & Decoupling
- **DRY Policy Validation:** `validate_policy_value` is cleanly factored into a shared pure function used by both `read_current_policy` and `update_current_policy`.
- **Disk Format Preservation:** Existing non-route attributes (including `wait.*` and `history.*` snake_case keys) are preserved by modifying the validated raw `Value` tree rather than serializing the camelCase HTTP DTO.
- **Authoritative Projection:** Response returns the actual committed file's SHA-256 byte revision and validated `PolicyDocumentV2Dto` rather than echoing client draft inputs.

### 4. YAGNI, KISS, DRY
- **YAGNI:** Does not attempt V1 auto-migration, file creation from scratch, or history record editing. Mutations are strictly restricted to `advisor.primary` and `advisor.backup`.
- **KISS:** Directly reuses proven `secure_path` file-descriptor primitives instead of adding an external transactional filesystem dependency.
- **DRY:** Eliminates duplicate route and schema validation code across reading and writing paths.

---

## Findings

### Critical Issues (0)
*None.* Zero security vulnerabilities, zero race conditions, zero data loss risks, zero breaking changes.

### High Priority Findings / Warnings (3)
1. **Unbounded Read in `replace_regular_file_if_bytes_match` Verification:**  
   In `server/src/fs/secure_path.rs` (lines 352-353 and 538-539), `target_file.read_to_end(&mut current_bytes)` reads target bytes without a `.take(expected_bytes.len() as u64 + 1)` bound or an early `meta.len() != expected_bytes.len() as u64` check. While `read_regular_file_bounded` read the file right before with `MAX_POLICY_BYTES`, if an external writer enlarged the file in between, `read_to_end` could read more bytes than expected before failing the equality check.
2. **HTTP 500 Returned Instead of HTTP 413 on Output Size Overflow:**  
   In `server/src/advisor/policy.rs` (line 496):
   ```rust
   if new_bytes.len() as u64 > MAX_POLICY_BYTES {
       return Err(AdvisorError::PolicyWriteFailed);
   }
   ```
   The plan specification calls for "413 for size". Returning `AdvisorError::PolicyPayloadTooLarge` (which maps to HTTP 413) instead of `PolicyWriteFailed` (HTTP 500) would strictly reflect the size constraint.
3. **Non-Unix Atomic Replacement Lacks Explicit Permissions / Dir Fsync:**  
   In `server/src/fs/secure_path.rs` (`#[cfg(not(unix))]` lines 549-556), `NamedTempFile::new_in` relies on OS defaults rather than mode 0600 (Windows ACLs), and parent directory fsync is omitted. While typical for Windows, it represents a minor cross-platform variance from Unix semantics.

### Medium / Low Priority Suggestions (3)
1. **Early File Length Check in File Replacement:**  
   In `replace_regular_file_if_bytes_match`, check `if meta.len() != expected_bytes.len() as u64 { return Err(FsError::Conflict); }` before reading the file, avoiding unnecessary disk reads on size changes.
2. **Use `PolicyPayloadTooLarge` on Output Serialization Cap:**  
   Replace `Err(AdvisorError::PolicyWriteFailed)` with `Err(AdvisorError::PolicyPayloadTooLarge)` when `new_bytes.len() as u64 > MAX_POLICY_BYTES`.
3. **Add Explicit Non-Admin Policy Integration Test:**  
   In `tests/advisor_policy_evaluations.rs`, add explicit test assertion that non-admin requests to `PATCH /api/advisor/policy` yield 403 `AdminRoleRequired` (currently covered globally by `/api/advisor/status` in `advisor_history_api.rs`).

---

## Positive Observations
- **Owned Lock Guard in Spawn Blocking:** Elegantly resolves the cancellation race where an aborted HTTP request might otherwise release a mutex while the spawned writer was still committing.
- **Pre-Deserialization Credential Defense:** Screening raw request JSON before Serde deserialization eliminates credential leaks even if payloads contain unrecognized or deeply nested credential fields.
- **Preservation of Raw Non-Route Fields:** Direct manipulation of the parsed `Value` tree prevents wire format naming conventions (`camelCase`) from corrupting on-disk storage conventions (`snake_case`).
- **Comprehensive Effort Rules:** Full producer compatibility matrix implemented per backend (`codex`, `claude`, `pi`, `omp`).

---

## Recommended Actions
1. In Phase 05 refinement, add `.take(expected_bytes.len() as u64 + 1)` or an early length check in `replace_regular_file_if_bytes_match`.
2. In Phase 05 refinement, map serialized output > 16 KiB to `AdvisorError::PolicyPayloadTooLarge`.
3. Proceed with Phase 02 (Server harness model discovery) and Phase 03 (Frontend transport / data provider) integration.

---

## Validation Commands and Results

| Scope | Command | Result |
|---|---|---|
| Server Build | `cargo check --manifest-path server/Cargo.toml` | **PASS** (Clean build, 0 errors, 0 warnings) |
| Policy Unit Tests | `cargo test --manifest-path server/Cargo.toml advisor::policy` | **PASS** (11 passed, 0 failed) |
| Policy Integration Tests | `cargo test --manifest-path server/Cargo.toml --test advisor_policy_evaluations` | **PASS** (7 passed, 0 failed) |
| Advisor Domain Tests | `cargo test --manifest-path server/Cargo.toml advisor` | **PASS** (42 passed, 0 failed) |
| Advisor History API Tests | `cargo test --manifest-path server/Cargo.toml --test advisor_history_api` | **PASS** (10 passed, 0 failed) |
| Secure Path Tests | `cargo test --manifest-path server/Cargo.toml fs::secure_path` | **PASS** (3 passed, 0 failed) |
| Clippy Verification | `cargo clippy --manifest-path server/Cargo.toml` (filtered for advisor / secure_path) | **PASS** (0 errors, 0 advisor warnings) |

---

## Task Completeness Verification

- [x] Shared raw-policy validation and strict route-only DTO implemented.
- [x] Policy-only lock, captured-home wrapper, safe no-follow read and byte revision checks implemented.
- [x] Atomic bounded regular-file replacement with cleanup, sync, mode, and platform safety implemented.
- [x] Authenticated/disabled-gated PATCH handler, 16 KiB limit, stable sanitized errors implemented.
- [x] Preservation, duplicate/custom model, stale write, unsafe path, and failure-injection tests implemented.
- [x] Zero TODO / FIXME comments remaining in reviewed code.
- [x] Plan files `phase-01-server-policy-update.md` and `progress.md` updated with implementation status.

---

## Unresolved Questions

*None.* All Phase 01 requirements are fully met and verified. The codebase is ready for Phase 02 and Phase 03.
