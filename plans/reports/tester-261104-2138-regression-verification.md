# Regression Test Verification Report

**Operation:** `run` (code validation)  
**Authority:** Execution & reporting only (no source, test, or CI mutations authorized)  
**Overall Status:** `PASS` (4/4 requested checks passed)  
**Date:** 261104  
**Report Artifact:** `plans/reports/tester-261104-2138-regression-verification.md`  

---

## 1. Summary of Executed Commands

| Target | Exact Command | Exit Code | Result | Pass/Fail Counts | Artifact / Evidence |
|---|---|---|---|---|---|
| 1 | `cargo test --manifest-path server/Cargo.toml pty::tests` | 0 | **PASS** | 112 passed; 0 failed; 0 ignored; 1307 filtered out | `artifact://167` |
| 2 | `cargo test --manifest-path server/Cargo.toml api::tests` | 0 | **PASS** | 154 passed; 0 failed; 0 ignored; 1265 filtered out | `artifact://169` |
| 3 | `pnpm --filter @dam-hopper/ui test` | 0 | **PASS** | Test Files: 332 passed (332); Tests: 3,173 passed (3,173); 0 failed | Terminal output (23.64s) |
| 4 | `pnpm lint` | 0 | **PASS** | 0 errors, 315 warnings | `artifact://171` |

Across the three test invocations, **3,439 tests passed, 0 failed**.

---

## 2. Command Details & Terminal Evidence

### Target 1: `cargo test --manifest-path server/Cargo.toml pty::tests`
- **Status:** PASS (exit code 0)
- **Duration:** 8.13s (lib test)
- **Library Test Summary:** `test result: ok. 112 passed; 0 failed; 0 ignored; 0 measured; 1307 filtered out; finished in 8.13s`
- **Key Targeted Test:** `pty::tests::pty_tests::terminal_respawn_failures_are_recorded_in_diagnostics ... ok` (line 271 of `artifact://167`)
- **Note:** Both previously failing tests passed in this run.
- **Artifact:** `artifact://167` (summary line 281)

### Target 2: `cargo test --manifest-path server/Cargo.toml api::tests`
- **Status:** PASS (exit code 0)
- **Duration:** 4.39s (lib test)
- **Library Test Summary:** `test result: ok. 154 passed; 0 failed; 0 ignored; 0 measured; 1265 filtered out; finished in 4.39s`
- **Key Targeted Test:** `api::tests::test_terminal_terminate_success_outcomes_and_domain_refusals ... ok` (line 299 of `artifact://169`)
- **Note:** Both previously failing tests passed in this run.
- **Artifact:** `artifact://169` (summary line 323)

### Target 3: `pnpm --filter @dam-hopper/ui test`
- **Status:** PASS (exit code 0)
- **Duration:** 23.64s (transform 39.39s, setup 0ms, import 111.68s, tests 64.46s, environment 73.83s)
- **Runner Summary:**
  ```text
   Test Files  332 passed (332)
        Tests  3173 passed (3173)
  ```
- **Diagnostic Notices:** Two non-failing jsdom navigation diagnostics were emitted (`Error: Not implemented: navigation (except hash changes)`), which did not impede any assertions.

### Target 4: `pnpm lint`
- **Status:** PASS (exit code 0)
- **Command:** `eslint apps/ packages/`
- **Summary:** `✖ 315 problems (0 errors, 315 warnings)`
- **Artifact:** `artifact://171`

---

## 3. Scope Boundaries & Remaining Risks

1. **Test Boundaries:** Focused on `pty::tests`, `api::tests`, `@dam-hopper/ui` unit/component tests, and `eslint`. No full-suite end-to-end browser qualification against live server processes (`test:e2e`) was executed as part of this focused regression run.
2. **Authority:** In compliance with the `run` contract, no production, test, or CI files were mutated.
3. **Linter Notices:** 315 linter warnings remain in TypeScript UI code (0 errors).

---

## 4. Unresolved Questions
None.
