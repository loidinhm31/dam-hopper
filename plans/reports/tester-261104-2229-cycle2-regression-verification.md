# Regression Test Verification Report — Cycle 2

**Operation:** `run` (code validation)  
**Authority:** Execution & reporting only (no source, test, or CI mutations authorized)  
**Overall Status:** `PASS` (4/4 requested checks passed; no test failures observed)  
**Date:** 261104  
**Report Artifact:** `plans/reports/tester-261104-2229-cycle2-regression-verification.md`  

---

## 1. Summary of Executed Commands

| Target | Exact Command | Exit Code | Result | Pass/Fail Counts | Artifact / Evidence |
|---|---|---|---|---|---|
| 1 | `cargo test --manifest-path server/Cargo.toml pty::tests` | 0 | **PASS** | 112 passed; 0 failed; 0 ignored; 1,307 filtered out (lib), 1,926 filtered across all targets | `artifact://217` |
| 2 | `cargo test --manifest-path server/Cargo.toml api::tests` | 0 | **PASS** | 154 passed; 0 failed; 0 ignored; 1,265 filtered out (lib), 1,884 filtered across all targets | `artifact://219` |
| 3 | `pnpm --filter @dam-hopper/ui test` | 0 | **PASS** | Test Files: 333 passed (333); Tests: 3,182 passed (3,182); 0 failed | Terminal output (23.64s) |
| 4 | `pnpm lint` | 0 | **PASS** | 0 errors, 317 warnings | `artifact://221` |

Across the three test invocations, **3,448 tests passed, 0 failed**.

---

## 2. Command Details & Terminal Evidence

### Target 1: `cargo test --manifest-path server/Cargo.toml pty::tests`
- **Status:** PASS (exit code 0)
- **Duration:** 8.11s (lib test runner)
- **Library Test Summary:** `test result: ok. 112 passed; 0 failed; 0 ignored; 0 measured; 1307 filtered out; finished in 8.11s`
- **Command-wide Total:** 112 passed, 0 failed, 1,926 filtered out across 75 test suites.
- **Artifact:** `artifact://217` (summary line 281)

### Target 2: `cargo test --manifest-path server/Cargo.toml api::tests`
- **Status:** PASS (exit code 0)
- **Duration:** 4.27s (lib test runner)
- **Library Test Summary:** `test result: ok. 154 passed; 0 failed; 0 ignored; 0 measured; 1265 filtered out; finished in 4.27s`
- **Command-wide Total:** 154 passed, 0 failed, 1,884 filtered out across 75 test suites.
- **Artifact:** `artifact://219` (summary line 323)

### Target 3: `pnpm --filter @dam-hopper/ui test`
- **Status:** PASS (exit code 0)
- **Duration:** 23.64s (transform 41.96s, setup 0ms, import 114.86s, tests 64.38s, environment 74.28s)
- **Runner Summary:**
  ```text
   Test Files  333 passed (333)
        Tests  3182 passed (3182)
  ```
- **Diagnostic Notices:** Two non-failing jsdom navigation diagnostics were emitted (`Error: Not implemented: navigation (except hash changes)`), which did not impede any assertions.

### Target 4: `pnpm lint`
- **Status:** PASS (exit code 0)
- **Command:** `eslint apps/ packages/`
- **Summary:** `✖ 317 problems (0 errors, 317 warnings)`
- **Artifact:** `artifact://221`

---

## 3. Scope Boundaries & Remaining Risks

1. **Verification Scope:** These runs verify the requested automated checks. Passing targeted unit/integration tests does not establish full behavioral completeness or absence of regressions in untested areas.
2. **Qualification & Browser Tests:** No full-suite authenticated browser acceptance tests (`test:e2e` or live PTY browser qualification) were executed as part of this requested code validation run.
3. **Authority:** In compliance with the `run` contract, no source, test, or CI files were mutated.
4. **Linter Notices:** 317 linter warnings remain across apps and packages (0 errors).

---

## 4. Unresolved Questions
None.
