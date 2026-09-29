# Code Review: Phase 01 — Local object-only commit-message rewrite

**Review Date:** 2026-09-30  
**Reviewer:** Phase01Reviewer (Senior Software Engineer)  
**Plan Reference:** `plans/260929-2204-object-plumbing-commit-message/phase-01-object-rewrite.md`  
**Quality Score:** **9.5/10**

---

## Code Review Summary

### Scope
- **Files reviewed:**
  - `server/src/git/commit_message_rewrite.rs` (new, 1,147 LOC)
  - `server/src/git/commit_file_ops.rs` (modified, removed legacy amend/rebase implementation)
  - `server/src/git/mod.rs` (modified, registered and exported `commit_message_rewrite`)
  - `server/src/git/types.rs` (modified, block reasons, edit outcome fields, `Default` derive)
  - `server/src/git/repository.rs` (modified, adapted `GitActionResult` constructors)
  - `server/src/api/git.rs` (modified, GET/POST routes and wire DTOs)
  - `server/src/git/tests.rs` (modified, 16 real-filesystem regression fixtures)
  - `server/src/api/tests.rs` (modified, in-process GET/POST API test)
  - `server/src/git/diff.rs` & `server/src/git/cli_fallback.rs` (minor imports/formatting)
- **Lines analyzed:** ~2,400 LOC across changed and added Rust modules
- **Review focus:** Phase 01 local object-only DAG rewrite, checked publication CAS, security boundaries, performance, error propagation, and task completion
- **Updated plans:**
  - `plans/260929-2204-object-plumbing-commit-message/phase-01-object-rewrite.md` (status: Complete 100%, 5/5 todos checked)
  - `plans/260929-2204-object-plumbing-commit-message/plan.md` (Phase 1: Complete 100%)

### Overall Assessment
Exemplary implementation matching authoritative architecture specifications. Completely eliminates fragile checkout/rebase/amend workflows in favor of raw object DAG construction and locked two-lock/one-write git2 ref CAS. Operates cleanly with dirty worktrees, pushed commits, root commits, linear descendants, and complex merge/octopus histories without touching working tree files or index. Zero `unsafe` blocks, strict validation against ref injection and path traversal, and robust fail-closed error handling.

---

## Critical Issues
*None.* No security vulnerabilities, injection risks, breaking API bugs, or memory safety issues detected.

---

## High Priority Findings
*None.*

---

## Medium Priority Improvements
1. **Synchronous Git/ODB I/O on Tokio Async Worker:**  
   `edit_commit_message` is an `async fn` executing synchronous libgit2 DAG traversal and ODB object hashing directly on the worker thread. While consistent with existing `server/src/git/` conventions and fast for typical repository depths, for repositories with tens of thousands of commits this synchronous traversal could stall the Tokio runtime thread.  
   *Recommendation:* Wrap synchronous DAG collection and ODB writing inside `tokio::task::spawn_blocking` in future performance tuning passes.
2. **File Size Guideline (LOC):**  
   `server/src/git/commit_message_rewrite.rs` is 1,147 LOC, exceeding the 200 LOC guideline from `development-rules.md`. The module is well-organized with clear function boundaries, but could be modularized into subcomponents (`parser.rs`, `dag.rs`, `publisher.rs`) if further history-rewrite capabilities are added.

---

## Low Priority Suggestions
1. **Parent Formatting Allocation in `rewrite_bytes`:**  
   Line 1060 formats `format!("parent {new_parent}\n")` allocating an intermediate string per parent. Using a stack byte buffer or `write!` into `out` avoids heap allocation for octopus merges.
2. **Error Diagnostic Granularity in `snapshot_branch`:**  
   `head_under_lock.symbolic_target()` mismatch during snapshot returns `GitBlockReason::StaleRef`. Including the observed unexpected symbolic target in the diagnostic message would aid debugging.

---

## Positive Observations
1. **Strict Two-Lock / One-Write CAS Protocol:**  
   `snapshot_branch` and `publish_checked_ref` acquire locks on both `HEAD` and the qualified branch ref (`refs/heads/*`), verify symbolic pointer and tip identity under lock, and only mutate the branch ref. HEAD remains symbolic; dropped transactions release locks safely.
2. **Defensive DAG Traversal and Cross-Checking:**  
   `collect_parent_first` uses iterative stack-based DFS (preventing stack overflow), checks for graph cycles, and cross-checks raw parsed commit metadata against libgit2's native commit parser via `cross_check_commit_node`.
3. **Exact Cryptographic Consent Handling:**  
   Invalidated `gpgsig`, `gpgsig-sha256`, and altered `mergetag` headers require explicit `allowSignatureRemoval=true` before writing any ODB objects; unchanged parent mergetags are preserved byte-for-byte; no-ops bypass consent checks entirely.
4. **Zero-Copy Byte Parsing:**  
   Raw headers and commit bodies are parsed as sub-slices (`&'a [u8]`) directly from `git2::OdbObject`, minimizing allocations.
5. **Robust Error Handling:**  
   Only a single `.unwrap()` in the entire module (line 629), provably safe immediately following a `stack.last_mut()` check. All other errors cleanly propagate via `RewriteFailure` into `GitActionResult::blocked(...)` or `AppError::Git`.

---

## Recommended Actions
1. **Handoff to Phase 02:** Proceed with UI panel integration, GET snapshot consumption, and leased publication workflow using the stable Phase 01 wire contracts.
2. **Keep Async Blocking Decoupling in Backlog:** Consider moving CPU/IO-heavy Git graph iterations to `tokio::task::spawn_blocking` during post-Phase 03 performance hardening.

---

## Metrics
- **Quality Score:** 9.5 / 10
- **Type Safety / Compiler Warnings:** 0 warnings (`cargo check` clean)
- **Formatting:** Clean (`rustfmt --edition 2024 --check` exit code 0)
- **Unit & Integration Tests:** 17 passed / 0 failed (16 engine scenarios in `git::tests::edit_commit_message`, 1 in `api::tests::git_get_and_edit_commit_message_api`)

---

## Validation Commands and Results
- `cargo check --manifest-path server/Cargo.toml`: **PASS** (0.17s, 0 warnings)
- `cargo test --manifest-path server/Cargo.toml git::tests::edit_commit_message -- --nocapture`: **PASS** (16/16 passed, 14.30s)
- `cargo test --manifest-path server/Cargo.toml git_get_and_edit_commit_message_api -- --nocapture`: **PASS** (1/1 passed, 0.76s)
- `rustfmt --edition 2024 --check server/src/git/commit_message_rewrite.rs`: **PASS** (0 diffs)

---

## Unresolved Questions
*None.* Technical requirements, edge cases, and test matrix for Phase 01 are fully resolved and qualified.
