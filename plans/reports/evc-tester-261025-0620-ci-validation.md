# CI Validation Report: PR #74 Repair Verification

## 1. Request / Authority & Scope
- Operation: `run` (code validation only; no edits to source, tests, or workflows authorized or made).
- Scope: Validate pre-existing CI repairs across 4 areas:
  1. `packages/ui/browser-tests/project-worktree-target.browser.tsx` (mock update)
  2. `server/src/semantic/uri.rs` (`#[cfg(unix)]` attribute)
  3. `server/tests/common/semantic_fixtures.rs` (authoritative `DAM_HOPPER_TEST_SEMANTIC_ENGINE_DIR` override)
  4. `.github/workflows/pr-quality-gate.yml` (staging step and test env wiring)
- Environment: Linux x86_64, Node v24.16.0, pnpm 10.4.1, cargo / rustc 1.84.1.

## 2. Risk Mapping & Check Selection
- Browser mock missing export: Chromium browser test on worktree target routing.
- Windows compilation failure on Unix symlink API: Linux unit test execution of `test_reject_dangling_and_outside_symlinks` and `cargo check --tests`. Windows compilation not exercisable on Linux host.
- Missing CI semantic toolchain fixtures: Scratch staging with `--retrieve-pinned` and `--verify-only`.
- Authoritative fixture override fallback risk: Negative check with invalid path (`/tmp/evc-invalid-dir`) to verify immediate panic without fallback; positive checks with staged dir for `semantic_resource_qualification` and `semantic_tsls_e2e`.
- Application E2E typecheck drift: `test:e2e:typecheck`.

## 3. Execution & Observed Evidence

### Check 1: Chromium Worktree Target Browser Test
- Command: `pnpm --filter @dam-hopper/ui test:browser browser-tests/project-worktree-target.browser.tsx`
- Exit: 0 | Duration: 27.87s
- Result: **PASS** (1 test file passed, 3 tests passed, 0 failed, 0 skipped, 0 unhandled errors).
- Evidence: Worktrees button, target routing, and persist/reconcile lifecycle passed without `useSemanticSettings` export error.

### Check 2: Semantic Engine Scratch Staging & Verification
- Commands:
  - `node deploy/release/semantic-engine/stage-semantic-engine.mjs --output-dir /tmp/evc-test-isolated-stage --retrieve-pinned`
  - `node deploy/release/semantic-engine/stage-semantic-engine.mjs --verify-only /tmp/evc-test-isolated-stage`
- Exit: 0 | Result: **PASS**
- Evidence: `✓ Staged and verified node-24.16.0-ts-5.9.3-tsls-6.0.2-linux-x64 at /tmp/evc-test-isolated-stage` and `✓ Verified staged semantic engine at /tmp/evc-test-isolated-stage`.

### Check 3: Authoritative Override Rejection (Negative Control)
- Command: `DAM_HOPPER_TEST_SEMANTIC_ENGINE_DIR=/tmp/evc-invalid-dir cargo test --manifest-path server/Cargo.toml --test semantic_resource_qualification`
- Exit: 101 | Duration: 0.04s
- Result: **PASS (Expected Rejection / No Fallback)** (1 passed, 3 failed, 1 ignored).
- Evidence: 3 packaged-toolchain tests panicked at `tests/common/semantic_fixtures.rs:286:25` with:
  `PackagedToolchain requires verified offline Node 24.16.0 + TS 5.9.3 + TSLS 6.0.2 tuple: "DAM_HOPPER_TEST_SEMANTIC_ENGINE_DIR set to \"/tmp/evc-invalid-dir\" but node binary invalid: Candidate node path \"/tmp/evc-invalid-dir/node\" is not a file"`. Confirmed no fallback to repo or system paths. 1 non-toolchain test passed (`test_hard_cgroup_detection_and_honest_capability_reporting`); 1 ignored (`live_semantic_navigation_qualification`).

### Check 4: Authoritative Override Acceptance (Positive Qualification)
- Command: `DAM_HOPPER_TEST_SEMANTIC_ENGINE_DIR=/tmp/evc-test-isolated-stage cargo test --manifest-path server/Cargo.toml --test semantic_resource_qualification`
- Exit: 0 | Duration: 61.64s
- Result: **PASS** (4 passed, 0 failed, 1 ignored: `live_semantic_navigation_qualification`).
- Evidence: Memory limits, cgroup detection, orphan reap, and responsiveness tests passed against staged fixture.

### Check 5: Linux Symlink Unit Test
- Command: `cargo test --manifest-path server/Cargo.toml --lib test_reject_dangling_and_outside_symlinks`
- Exit: 0 | Duration: 0.00s (compilation 1m39s)
- Result: **PASS** (1 passed, 0 failed, 1513 filtered out).
- Evidence: `test semantic::uri::tests::test_reject_dangling_and_outside_symlinks ... ok`.

### Check 6: Semantic TSLS E2E Integration Suite
- Command: `DAM_HOPPER_TEST_SEMANTIC_ENGINE_DIR=/tmp/evc-test-isolated-stage cargo test --manifest-path server/Cargo.toml --test semantic_tsls_e2e`
- Exit: 0 | Duration: 75.77s
- Result: **PASS** (4 passed, 0 failed).
- Evidence: All 4 integration tests (`test_packaged_tsls_four_extensions_nested_refs_multiple_and_empty_results`, `test_adversarial_code_loading_vectors_with_tuple_specific_positive_controls`, `test_packaged_tsls_unsaved_overlays_unicode_and_bidirectional_threshold_crossing`, `test_packaged_tuple_transitive_integrity_and_tamper_rejection`) passed.

### Check 7: Application E2E Typecheck
- Command: `pnpm --filter @dam-hopper/ui test:e2e:typecheck`
- Exit: 0 | Duration: 1.74s
- Result: **PASS** (`tsc -p tsconfig.e2e.json` succeeded without diagnostics).

### Supplementary Check: Server Test Compilation
- Command: `cargo check --manifest-path server/Cargo.toml --tests`
- Exit: 0 | Duration: 10.14s
- Result: **PASS** (clean compilation on Linux target, 0 warnings/errors).

## 4. Changes & Artifacts Under Test
- `packages/ui/browser-tests/project-worktree-target.browser.tsx`: Added `useSemanticSettings` mock returning `{ data: undefined, isLoading: false, isError: false }`.
- `server/src/semantic/uri.rs`: Gated `test_reject_dangling_and_outside_symlinks` with `#[cfg(unix)]`.
- `server/tests/common/semantic_fixtures.rs`: Added authoritative check for `DAM_HOPPER_TEST_SEMANTIC_ENGINE_DIR`. If set, resolves `node` and `node_modules` exclusively from target directory, failing without fallback.
- `.github/workflows/pr-quality-gate.yml`:
  - `application_e2e`: Added step `Stage semantic engine tuple for E2E qualification` (`--retrieve-pinned` + `--verify-only`).
  - `server_linux`: Added setup-node/pnpm, step `Stage semantic engine tuple for Linux qualification`, and passed `DAM_HOPPER_TEST_SEMANTIC_ENGINE_DIR` to `Server tests`.
- Cleanup: Scratch directory `/tmp/evc-test-isolated-stage` removed and confirmed absent (`test -e` confirmed cleaned).

## 5. Disposition & Remaining Risks
- Overall local status: **PASS** for all 7 executed scopes.
- Workflow inspection confirms proper placement of staging steps before test consumption and environment variable forwarding.
- Residual implementation concern: `std::env::var` returns `Err(VarError::NotUnicode)` if the override environment variable contains non-Unicode bytes, which causes the resolver to fall back rather than reject. Recommended low-priority hardening: inspect `var_os` or check `VarError::NotUnicode`.
- Unexercised remote surfaces:
  - Windows test compilation on an actual Windows runner (`cargo test --no-run` on Windows host).
  - Full containerized application E2E Playwright test run (`test:e2e` execution with Docker MongoDB and backend containers).
  - End-to-end GitHub Actions Quality Gate workflow run.

## 6. Unresolved Questions
- None for the verified local scope. Remote GitHub Actions workflow execution remains to be qualified in PR #74 run.
