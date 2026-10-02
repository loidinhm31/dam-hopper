# Code Review Summary: Native Advisor Migration Phase 01

**Date:** 2026-10-02  
**Reviewer:** Phase01Reviewer  
**Scope:** Phase 01 — Freeze native contract and source parity baseline  
**Score:** 9.5/10  

---

### Scope
- **Files reviewed:**
  - `plans/261002-0246-native-advisor-migration/reports/native-contract-and-parity.md` (475 LOC)
  - `scripts/test-native-advisor-parity.mjs` (356 LOC)
  - `__fixtures__/native-advisor/advisor-routing.json` (24 LOC)
  - `__fixtures__/native-advisor/advisor-routing-v1.json` (9 LOC)
  - `__fixtures__/native-advisor/advisor-routing-invalid.json` (9 LOC)
  - `__fixtures__/native-advisor/advisor-evaluations/eval-group-a.json` (307 LOC)
  - `__fixtures__/native-advisor/advisor-evaluations/eval-group-b.json` (1254 LOC)
  - `__fixtures__/native-advisor/advisor-evaluations/eval-invalid.json` (1 LOC)
  - `__fixtures__/native-advisor/advisor-history/project-metadata.json` (13 LOC)
  - `__fixtures__/native-advisor/advisor-history/fd402c49f00afafeaaff0ee1e4fa3240d2ade14f74a454f8d709b85cc1d70998/project-metadata.json` (9 LOC)
  - `.../00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000011/execution.json` (121 LOC)
  - `.../00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000011/outcome.json` (25 LOC)
  - `.../00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000012/execution.json` (83 LOC)
  - `.../00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-000000000013/execution.json` (1 LOC)
  - `__fixtures__/native-advisor/advisor-history/13aea919e60e23089352d6284e556087ee1441c73b9ac30c076010741051bd0c/project-metadata.json` (9 LOC)
  - `.../00000000-0000-4000-8000-000000000003/00000000-0000-4000-8000-000000000014/execution.json` (121 LOC)
  - `.../00000000-0000-4000-8000-000000000003/00000000-0000-4000-8000-000000000014/outcome.json` (1 LOC)
  - `plans/261002-0246-native-advisor-migration/phase-01-contract-and-parity-baseline.md` (79 LOC)
- **Lines of code analyzed:** ~2,870 LOC
- **Review focus:** Native contract freeze, synthetic fixtures integrity, parity test harness, security/architecture invariants.
- **Updated plans:**
  - `plans/261002-0246-native-advisor-migration/phase-01-contract-and-parity-baseline.md` (marked 100% complete, all tasks checked)
  - `plans/261002-0246-native-advisor-migration/plan.md` (marked Phase 01 100% complete)

---

### Overall Assessment
Contract definitions and baseline parity verification for Phase 01 meet all architectural and functional requirements.
- Full DTO schema frozen with camelCase wire formats and snake_case on-disk document preservation.
- Complete fixture set covering all required error states (`EXECUTION_INVALID_JSON`, `OUTCOME_INVALID_JSON`, `outcomeState: missing`, `outcomeState: invalid`, `migration_required`, `not_configured`).
- Parity test suite validates Evcrate provider behavior against synthetic fixtures with 100% pass rate.
- Security boundaries rigidly enforced: admin authentication requirement, `--no-auth` denial, symlink root rejection via `symlink_metadata`, path traversal prevention, HMAC cursor verification.
- Addressed minor portability and temporary directory cleanliness during review.

---

### Critical Issues
None.

---

### Warnings
1. **Source Provider Deprecation in Phase 08:** `scripts/test-native-advisor-parity.mjs` directly imports JS modules from `evcrate/plugin/backend`. When Phase 08 removes the Evcrate plugin backend, this legacy test script will no longer function in that environment. Native Rust test suites developed in Phases 02 and 03 will become the permanent verification baseline.
2. **File Size Guideline:** `scripts/test-native-advisor-parity.mjs` is 356 lines, exceeding the 200 LOC project guideline. Keeping it as a single script is acceptable for test runner cohesion, but splitting into modular group helpers can be considered if additional tests are added.

---

### Suggestions & Improvements Made
1. **Portable Path Resolution:** Replaced hardcoded `/home/loidinh/WS/evcrate/plugin/backend` with `process.env.EVCRATE_DIR ? path.join(process.env.EVCRATE_DIR, 'plugin/backend') : path.resolve(ROOT_DIR, '../evcrate/plugin/backend')`.
2. **Safe Temporary Directory:** Replaced workspace root temporary directory in symlink test with `os.tmpdir()` (`fs.mkdtempSync(path.join(os.tmpdir(), 'dam-hopper-symlink-test-'))`) to ensure workspace remains clean under unexpected termination.
3. **Phase 02 Rust Guard Enforcement:** Ensure Phase 02 Rust implementation directly mirrors the `symlink_metadata` check: verify `!metadata.file_type().is_symlink()` and `metadata.is_dir()` before querying directory contents.

---

### Security Audit
- **Authentication & Authorization:** Invariants require active session with `admin` role. `--no-auth` server requests explicitly forbidden with HTTP 403.
- **Data Protection:** No personal or production paths in fixtures. Synthetic UUIDs and dummy test digests used exclusively.
- **Filesystem Traversal:** Directory traversal blocked by strict validation of project IDs, task IDs, and record refs.
- **Symlink Attacks:** Root directory symlinks explicitly rejected using `symlink_metadata`, preventing redirect attacks outside `$HOME/.evcrate/advisor-history`.
- **Replay & Tampering:** HMAC-signed base64url cursors prevent offset or snapshot tampering.

---

### Performance Analysis
- Scanned volume capped at 256 MiB, 50,000 accepted records, 500 projects, 256 tasks/project.
- Per-file read limits: execution <= 128 KiB, outcome <= 64 KiB, metadata <= 64 KiB, routing <= 16 KiB, evaluation <= 8 MiB.
- HTTP page responses strictly capped at 1 MiB.
- In-memory snapshot cache bounded with 5-minute idle TTL, LRU eviction, and 128 MiB aggregate memory cap.

---

### Positive Observations
- Complete traceability matrix mapping acceptance criteria A01 through A20 to specific contract defenses.
- Clean distinction between wire API (camelCase) and on-disk Evcrate files (snake_case).
- Robust edge case coverage in fixtures including corrupt JSON, missing outcomes, v1 policy schemas, and multi-candidate evaluation comparisons.
- Zero flaky assertions; test suite runs in under 100ms.

---

### Recommended Actions
1. Proceed with Phase 02 (History Domain & API), Phase 03 (Policy & Evaluation), Phase 04 (UI Reuse), and Phase 07 (Linux Deployment) per defined wave boundaries.
2. Maintain single Integration Owner gate for shared router, state, and UI entry points.

---

### Metrics
- **Test Results:** 16 / 16 passed (100%)
- **Execution Time:** ~0.09s
- **Security Score:** Pass
- **Lint / Syntax Errors:** 0

---

### Unresolved Questions
None.
