# Phase 04 Test Suite Execution Report: Raw CDP Gateway & Qualification

## 1. Request & Scope
- **Operation:** `run` (code and contract validation)
- **Target Suite:** Phase 04 (Expose authenticated instance-scoped raw CDP)
- **Scope / Verification Targets:**
  1. `cargo test --manifest-path server/Cargo.toml --test browser_host_gateway -- --nocapture`
  2. `pnpm --filter @dam-hopper/ui exec playwright test e2e/os-host-browser/agent.spec.ts`
  3. `cargo test --manifest-path server/Cargo.toml --test browser_host_admission --test browser_host_auth --test browser_host_input --test browser_host_lifecycle --test browser_host_shutdown -- --nocapture`
- **Working Directory:** `/home/loidinh/WS/dam-hopper`
- **Environment:** Linux 7.2.15-200.fc44.x86_64, Node.js v24.2.0, pnpm 10.4.1, Cargo 1.91.0, Rustc 1.91.0

---

## 2. Execution Summary & Exact Counts

| # | Test Target | Exit Code | Duration | Passed | Failed | Skipped | Status |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | `browser_host_gateway` (Rust integration) | 0 | 0.86s | 8 | 0 | 0 | **PASS** |
| 2 | `agent.spec.ts` (Playwright E2E qualification) | 0 | 7.0s | 7 | 0 | 0 | **PASS** |
| 3 | Regression suites (5 Rust integration targets) | 0 | 0.51s | 33 | 0 | 0 | **PASS** |
| **Total** | **All Targets** | **0** | **8.37s** | **48** | **0** | **0** | **PASS** |

**Pass Rate:** 100% (48/48 tests passed).

---

## 3. Failure Details
- **Failures Observed:** None.
- **Instability / Retries:** 0 retries required. All checks passed on initial attempt.

---

## 4. Per-Target Detailed Breakdown

### Target 1: `browser_host_gateway` (8/8 passed)
- **Command:** `cargo test --manifest-path server/Cargo.toml --test browser_host_gateway -- --nocapture`
- **Result:** `test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.86s`
- **Tests Executed:**
  1. `test_global_agent_capacity_limit_rejects_busy_429` — `ok`
  2. `test_ws_upgrade_unauthenticated_denied_401` — `ok`
  3. `test_origin_less_without_bearer_denied_401` — `ok`
  4. `test_unauthenticated_discovery_denied_401` — `ok`
  5. `test_ws_upgrade_wrong_origin_denied_403` — `ok`
  6. `test_discovery_wrong_origin_denied_403` — `ok`
  7. `test_non_admin_discovery_denied_403` — `ok`
  8. `test_live_revocation_detection` — `ok`

### Target 2: `e2e/os-host-browser/agent.spec.ts` (7/7 passed)
- **Command:** `pnpm --filter @dam-hopper/ui exec playwright test e2e/os-host-browser/agent.spec.ts`
- **Result:** `7 passed (7.0s)`
- **Tests Executed:**
  1. `rejects unauthenticated discovery request with HTTP 401 and no-store` — `passed`
  2. `rejects discovery with unapproved Origin even with valid bearer` — `passed`
  3. `rejects WebSocket upgrade with unapproved Origin even with valid bearer` — `passed`
  4. `accepts discovery with valid bearer and rewrites webSocketDebuggerUrl to gateway` — `passed`
  5. `proves Playwright connectOverCDP connects to production gateway using Bearer on both paths and mutates target` — `passed`
  6. `proves agent Page.disable or stopScreencast cannot stop the independent native session` — `passed`
  7. `proves revocation of one agent login closes its connection while sibling session persists` — `passed`

### Target 3: Regression Check (33/33 passed across 5 suites)
- **Command:** `cargo test --manifest-path server/Cargo.toml --test browser_host_admission --test browser_host_auth --test browser_host_input --test browser_host_lifecycle --test browser_host_shutdown -- --nocapture`
- **Result:** `33 passed across 5 test binaries; finished in 0.51s`
- **Suites Executed:**
  - `browser_host_admission`: 7 passed (0.73s)
  - `browser_host_auth`: 6 passed (0.25s)
  - `browser_host_input`: 7 passed (0.36s)
  - `browser_host_lifecycle`: 10 passed (0.19s)
  - `browser_host_shutdown`: 3 passed (0.51s)

---

## 5. Unresolved Questions
None.
