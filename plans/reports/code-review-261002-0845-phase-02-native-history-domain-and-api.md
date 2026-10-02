# Code Review Summary: Native Advisor Migration Phase 02

**Date:** 2026-10-02  
**Reviewer:** Phase02Reviewer  
**Scope:** Phase 02 — Port history domain, status, admin guard and native API  
**Score:** 9.6/10  

---

### Scope
- **Files reviewed:**
  - `server/src/advisor/mod.rs` (11 LOC)
  - `server/src/advisor/types.rs` (316 LOC)
  - `server/src/advisor/error.rs` (138 LOC)
  - `server/src/advisor/status.rs` (176 LOC)
  - `server/src/advisor/history_scan.rs` (611 LOC)
  - `server/src/advisor/metrics.rs` (391 LOC)
  - `server/src/advisor/snapshots.rs` (430 LOC)
  - `server/src/advisor/history.rs` (524 LOC)
  - `server/src/api/advisor.rs` (115 LOC)
  - `server/src/api/auth.rs` (907 LOC)
  - `server/src/api/router.rs` (1,019 LOC)
  - `server/src/api/mod.rs` (124 LOC)
  - `server/src/config/schema.rs` (1,363 LOC)
  - `server/src/config/parser.rs` (467 LOC)
  - `server/src/config/mod.rs` (54 LOC)
  - `server/src/config/replacement.rs` (42 LOC)
  - `server/src/config/tests.rs` (2,343 LOC)
  - `server/src/persistence/restore.rs` (412 LOC)
  - `server/src/state.rs` (485 LOC)
  - `server/src/lib.rs` (89 LOC)
  - `server/tests/advisor_history_api.rs` (545 LOC)
- **Lines of code analyzed:** ~9,500 LOC
- **Review focus:** Phase 02 native history domain implementation, `require_admin` middleware generalization, `AdvisorConfig` default and atomic persistence, symlink root rejection, scan bounds compliance, cursor HMAC/1 MiB shortening, detail fingerprint verification, and API route security.
- **Updated plans:**
  - `plans/261002-0246-native-advisor-migration/phase-02-native-history-domain-and-api.md` (all 9 tasks checked [x], progress 100%)
  - `plans/261002-0246-native-advisor-migration/plan.md` (Phase 02 marked complete 100%)

---

### Overall Assessment
Implementation delivers high-quality native Rust architecture fully replacing Evcrate plugin backend history domain.
- Clean domain separation: `history_scan`, `snapshots`, `metrics`, `status`, and `history` modules.
- Strict security adherence: `require_admin` rejects `--no-auth` and non-admin, queries enabled user status directly per request.
- Fixed layer bug during review: removed extraneous `require_bearer_auth` on `/api/advisor/*` so standard session cookie authentication works seamlessly alongside bearer tokens as required by architecture contract.
- Verified all bounded constraints (256 MiB scan, 50k records, 500 projects, 256 tasks/project, 256 consultations/task, 4096 diagnostics, 128 KiB execution, 64 KiB outcome, 1 MiB page response).
- Atomic read-modify-write configuration persistence with serialized Mutex guard prevents setting clobbering.
- Detail endpoint verifies dev/inode/size/SHA256 before emitting `ready`, handling `changed` and `missing` deterministically.

---

### Critical Issues
None remaining.
*(Resolved during review)*: `require_bearer_auth` was initially copied onto `advisor_routes` in `server/src/api/router.rs`. This rejected legitimate browser sessions authenticating via `damhopper-auth` cookie with `BearerRequired`. Removed `require_bearer_auth` from `advisor_routes` and added regression test `test_advisor_cookie_session_allowed`.

---

### High Priority Findings
None.

---

### Medium Priority Improvements
1. **File Length in Test Suite & Router:** `server/src/api/router.rs` (1,019 LOC) and `server/tests/advisor_history_api.rs` (545 LOC) exceed the 200 LOC threshold. Modularizing test suites by domain concern (auth tests, lifecycle tests, status tests) will aid long-term maintainability.
2. **Outcome Unreadable Accounting:** In `history_scan.rs`, when `outcome.json` exists on disk but exceeds `MAX_OUTCOME_HISTORY_BYTES` or is an unreadable symlink, `read_bounded_file` returns `None` and the record falls through to `outcome_state: "missing"` without emitting a specific diagnostic code. Matches frozen Phase 01 baseline behavior, but consider an explicit `OUTCOME_UNREADABLE` diagnostic in future parity refinement.

---

### Low Priority Suggestions
1. **Redundant Closure Cleanup:** Fixed redundant closure `map_err(|e| AdvisorError::InvalidInput(e))` in `server/src/api/advisor.rs:54` to `map_err(AdvisorError::InvalidInput)`.
2. **Unused Test Imports Warning:** Fix unused imports in non-advisor tests (`tests/browser_debug_artifacts.rs` and `tests/idle_suspend.rs`) when updating test dependencies.

---

### Positive Observations
- **KISS & DRY Architecture:** Avoided over-engineering or duplicated validator frameworks; reused `symlink_metadata`, Axum extractors, and Tokio `spawn_blocking` cleanly.
- **Constant-Time Comparison:** HMAC signature verification in `snapshots.rs` uses `subtle::ConstantTimeEq` preventing timing attacks on cursor tokens.
- **Bounded Allocations:** Bounded reads with `file.take(max_bytes + 1).read_to_end()` prevent memory exhaustion from oversized or infinite streams.
- **Clean Serde Conventions:** Wire formats strictly camelCase via `#[serde(rename_all = "camelCase")]`, internal captured structures preserve raw typed paths and inodes.

---

### Recommended Actions
1. Maintain single Integration Owner for shared router when Phase 03 wires policy and evaluation routes.
2. Ensure Phase 04 UI integration leverages both session cookie and bearer token authorization transparently.
3. Hand validated native history API contract to Phase 04 UI workstream.

---

### Metrics
- **Test Pass Rate:** 8/8 integration tests, 23/23 advisor unit tests, 16/16 parity tests (100% pass)
- **Security Audit:** Pass (Admin-only enforced, `--no-auth` denied, symlinks rejected, path-hash removed, HMAC query-bound cursors)
- **Compilation / Clippy:** 0 errors, 0 advisor warnings

---

### Unresolved Questions
None.
