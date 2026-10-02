# Code Review Summary: Native Advisor Migration Phase 03

**Date:** 2026-10-02  
**Reviewer:** Phase03CodeReview  
**Scope:** Phase 03 — Port current policy and evaluation discovery/read/compare  
**Score:** 9.7/10  

---

### Scope
- **Files reviewed:**
  - `server/src/advisor/policy.rs` (490 LOC)
  - `server/src/advisor/evaluations.rs` (645 LOC)
  - `server/src/advisor/evaluation_comparison.rs` (397 LOC)
  - `server/src/advisor/history.rs` (551 LOC)
  - `server/src/advisor/mod.rs` (17 LOC)
  - `server/src/api/advisor.rs` (179 LOC)
  - `server/src/api/router.rs` (1,038 LOC)
  - `server/tests/advisor_policy_evaluations.rs` (455 LOC)
- **Lines of code analyzed:** ~3,770 LOC
- **Review focus:** Policy parser (16 KiB limit, credential rejection, V1 migration, schema validation, unsupported backend check), evaluation discovery (HOME paths, registered project fixture discovery, deduplication, first-wins, skipping invalid/mismatch), evaluation read (revision check, ready/changed/missing), evaluation compare (rubric/input groups, human/automated score summaries, pagination with 1 MiB byte shortening), REST endpoint authorization & disabled checks (admin auth, 403 ADVISOR_DISABLED).
- **Updated plans:**
  - `plans/261002-0246-native-advisor-migration/phase-03-policy-and-evaluation-domain.md` (all 9 tasks checked [x], progress 100%)
  - `plans/261002-0246-native-advisor-migration/plan.md` (Phase 03 marked complete, 3/9 phases settled)

---

### Overall Assessment
Implementation delivers high-quality, native Rust domain logic and REST API endpoints for policy inspection and evaluation discovery/read/compare, strictly replacing Evcrate plugin backend equivalents.
- **Strict Policy Safety:** Enforces max 16 KiB file length, rejects credential fields recursively, detects legacy V1 policy with `migration_required`, checks schema ranges, and validates candidate/enabled backends (`claude`, `codex`, `pi`, `omp`).
- **Ordered & Deduplicated Discovery:** Searches `HOME/.evcrate/advisor-evaluations`, `HOME/.evcrate/evaluations`, and registered project `tests/fixtures/advisor-evaluations` in exact order. Canonical directory deduplication and first-wins descriptor references prevent duplicate entries. Files with "mismatch" or "invalid" in the name or invalid JSON are skipped cleanly.
- **Document Revision Verification:** Evaluation read verifies expected revision against computed SHA-256 digest, returning `ready`, `changed`, or `missing`.
- **Accurate Comparison Aggregation:** Groups evaluations by rubric/input digests, calculates candidate response counts and separate human/automated score summaries (`average_score`, `pass_rate`, `dimension_averages`, `issues`), and enforces pagination with 1 MiB page byte shortening.
- **Security & Authorization:** All four endpoints (`/policy/current`, `/evaluations/list`, `/read`, `/compare`) are protected by `require_auth` and `require_admin` (denying unauthenticated, non-admin, and `--no-auth`), check `server.advisor.enabled` (returning 403 `ADVISOR_DISABLED` when off), and enforce 64 KiB request body limits.
- **Resolved Lock Contention During Review:** In `server/src/api/advisor.rs`, converted `resolve_target_project_root` from synchronous `try_read().ok()?` to `async fn` using `state.config.read().await`. Added integration test `test_evaluations_project_discovery_and_deduplication` proving registered project resolution, project custom fixture discovery, first-wins deduplication against HOME, and safe fallback on unregistered targets.

---

### Critical Issues
None.

---

### High Priority Findings (Warnings)
1. **Serial Evaluation Parsing on Async Worker Thread:** `discover_evaluations` and `compare_evaluations` perform synchronous filesystem reads (`std::fs::read`) and JSON parsing for documents up to 8 MiB on the Tokio worker thread. While bounded (candidate directories are limited and compare items are capped at 32), if multiple large evaluation files exist under high concurrency, this could briefly stall Tokio executor threads. Consider wrapping evaluation reading in `tokio::task::spawn_blocking` (as done for history scan and detail in `history.rs`) during future performance hardening.

---

### Medium Priority Improvements
1. **Strict Closed Schema Enforcement:** Evcrate source `asObj` checked `k.length !== exp.length || k.some(x => !exp.includes(x))` to reject unexpected object keys (`ROUTE_SCHEMA_INVALID`). Currently, `policy.rs` strictly validates required fields and recursively searches for credentials, but does not explicitly reject unrecognized non-credential keys. Adding closed-key checks would ensure 100% schema parity with legacy Evcrate strictness.
2. **Dimension Averages Serialization Determinism:** `CandidateScoreSummaryDto.dimension_averages` uses `HashMap<String, Option<f64>>`. In JSON output, key ordering in HashMaps is non-deterministic. Using `BTreeMap<String, Option<f64>>` would guarantee consistent alphabetical dimension ordering, improving byte length predictability and snapshot test reproducibility.
3. **File Length in Test Suite & Router:** `server/src/api/router.rs` (1,038 LOC), `server/src/advisor/evaluations.rs` (645 LOC), and `server/tests/advisor_policy_evaluations.rs` (455 LOC) exceed the 200 LOC threshold. Modularization will improve long-term maintainability.

---

### Low Priority Suggestions
1. **Bounded Take for Policy File:** In `server/src/advisor/policy.rs`, using `File::open` with `.take(MAX_POLICY_BYTES + 1)` prevents reading an unbounded stream if a concurrent file replacement occurs between metadata check and read.

---

### Positive Observations
- **KISS & DRY Implementation:** Reused existing `AppState`, Axum extractors, and Serde attributes cleanly without introducing complex plugin shims.
- **Exact Provenance and Rounding:** Faithfully ported Evcrate's aggregation algorithm with `round2` and `round4` precision, candidate response status breakdown, and human vs automated score separation.
- **Deterministic Ordering:** Sorted candidate IDs and directory file entries alphabetically, ensuring identical outputs regardless of filesystem traversal order.
- **Safe Containment:** Server-resolved registered projects prevent arbitrary directory traversal; unregistered target paths safely fall back to HOME candidates without leaking server directory existence.

---

### Recommended Actions
1. Hand off validated Phase 03 native backend to Phase 04 (Workspace UI Integration) to consume native policy and evaluation endpoints.
2. In Phase 05/09 performance refinement, consider wrapping evaluation document reads in `tokio::task::spawn_blocking` and switching `dimension_averages` to `BTreeMap`.

---

### Metrics & Validation
- **Integration Tests:** 4/4 passed (`tests/advisor_policy_evaluations.rs`)
- **History API Tests:** 8/8 passed (`tests/advisor_history_api.rs`)
- **Unit Tests:** 23/23 passed (`server/src/advisor/*`)
- **Security Audit:** Pass (Admin-only enforced, `--no-auth` denied, 403 `ADVISOR_DISABLED` verified, arbitrary paths rejected, symlinks rejected)
- **Compilation / Clippy:** 0 errors, 0 advisor warnings

---

### Unresolved Questions
None.
