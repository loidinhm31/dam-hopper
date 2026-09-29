# Code Review Report: Phase 03 — End-to-end qualification, contract regressions and documentation

**Date:** 2026-09-30  
**Reviewer:** Phase03Reviewer  
**Score:** 9.8 / 10  
**Plan:** `plans/260929-2204-object-plumbing-commit-message/phase-03-qualification-and-docs.md`  

---

## Code Review Summary

### Scope
- **Files reviewed:**
  - `server/src/git/commit_message_rewrite.rs` (shallow boundary check)
  - `server/src/git/tests.rs` (shallow boundary, missing parent object, same-OID different-branch, side-parent merge rewrite, remote rejection hook)
  - `server/tests/git_commit_message_api.rs` (paired GET/POST CAS, dirty tree preservation, 404 project)
  - `server/tests/git_leased_publish_api.rs` (leased push prepare/publish lifecycle, already-current, stale-remote, stale-local, legacy force:true rejection)
  - `packages/ui/src/hooks/use-leased-git-push.test.tsx` (stale-local, stale-config, rejected, unknown, already-current transitions)
  - `docs/api-reference.md` (Git push, prepare, publish, commit message GET/POST)
  - `docs/system-architecture.md` (raw ODB DAG rewrite and leased publication architecture)
  - `docs/CHANGELOG.md` (Phase 03 completion entry)
- **Lines of code analyzed:** ~1,100 lines (code, tests, and documentation)
- **Review focus:** Phase 03 end-to-end qualification, contract regressions, security, performance, and documentation cutover
- **Updated plans:**
  - `plans/260929-2204-object-plumbing-commit-message/phase-03-qualification-and-docs.md` (marked completed 100%)
  - `plans/260929-2204-object-plumbing-commit-message/plan.md` (marked completed 100%)

---

### Overall Assessment
Exceptional code quality and architectural discipline. Phase 03 satisfies all acceptance criteria:
1. **Safety and CAS fencing:** Both local commit message rewrite and remote leased publication implement strict compare-and-swap fences. The local engine locks HEAD and the symbolic branch ref via libgit2 transactions, verifying the tip before ref update. The publication protocol enforces single-ref negotiation where remote old OID must match `expectedRemoteOid` and local new OID must match `sourceOid`.
2. **Security:** No shell interpolation; all Git operations use libgit2 APIs or fixed argument vectors via `Command`. Remote URLs are safely hashed via SHA-256 (`remote_identity`), preventing credential leakage. Shallow repositories, detached HEAD, missing parent objects, and active Git operations fail closed with typed block reasons.
3. **Dirty worktree preservation:** Tests independently verify that staged, unstaged, and untracked changes are completely untouched during commit message rewrites.
4. **Documentation cutover:** Documentation in `api-reference.md`, `system-architecture.md`, and `CHANGELOG.md` accurately describes the implemented contracts and outcome models.

---

### Critical Issues
None. No security vulnerabilities, data-loss vectors, or breaking regressions identified.

---

### High Priority Findings
None.

---

### Medium Priority Improvements
1. **Test harness code reuse across integration tests:**
   - In `server/tests/git_commit_message_api.rs` and `server/tests/git_leased_publish_api.rs`, helper functions (`setup_test_app`, `git`, `git_output`) are largely duplicated.
   - *Recommendation:* Extract shared Git integration test fixtures into `server/tests/common/git.rs` or `server/tests/common/app.rs` to uphold DRY across future Git integration tests.
2. **Integration test file size:**
   - `server/tests/git_commit_message_api.rs` (296 LOC) and `server/tests/git_leased_publish_api.rs` (382 LOC) exceed the general 200 LOC per-file guideline. For Rust integration test binaries this is common and acceptable, but modularizing helpers can bring them below threshold.

---

### Low Priority Suggestions
1. **Cleaned compiler warnings in test file (fixed):**
   - Removed unused import `RestartPolicy` and unused variable `head_oid` from `server/tests/git_commit_message_api.rs`. The test suite now compiles with 0 warnings.
2. **Markdown formatting (fixed):**
   - Added missing blank line between the Phase 03 section and Phase 04 section in `docs/system-architecture.md:4305`.

---

### Positive Observations
- **Exact-OID leased publication:** Single-ref negotiation callback in `server/src/git/leased_push.rs` validates `updates.len() == 1`, `dst_refname == expected_dest_ref`, `src_oid == expected_remote_oid`, and `dst_oid == expected_source_oid` before any transfer, aborting with typed statuses (`stale-remote`, `stale-local`, `stale-config`).
- **Cryptographic signature protection:** Commit rewrites preserve signatures when unaffected; if invalidated, explicit consent (`allowSignatureRemoval: true`) is strictly required. Mergetags with unchanged parents are preserved verbatim.
- **Fail-closed shallow boundary check:** `repo.is_shallow()` blocks rewriting on shallow repositories before reading ODB or acquiring locks.
- **Thorough automated tests:** All 121 targeted tests passed (21 rewrite unit, 6 leased push unit, 3 commit message API, 5 leased publish API, 86 UI Vitest).

---

### Recommended Actions
1. Keep the extracted Git test harness in mind for future test suites to minimize duplication in `server/tests/`.
2. Proceed with parent project-wide integration and final checks.

---

### Metrics
- **Test Pass Rate:** 100% (121/121 tests passed)
  - `git::tests::edit_commit_message`: 21 passed
  - `git::tests::leased_push`: 6 passed
  - `git_commit_message_api`: 3 passed
  - `git_leased_publish_api`: 5 passed
  - UI Vitest suites (9 files): 86 passed
- **Typecheck Status:** Clean (TypeScript `tsc -p tsconfig.json` exit 0, Rust `cargo check --lib` clean)
- **Compiler Warnings in Scoped Code:** 0 warnings

---

### Unresolved Questions
None.
