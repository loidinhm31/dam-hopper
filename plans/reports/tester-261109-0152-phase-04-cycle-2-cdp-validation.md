# Phase 04 (Cycle 2) Test Execution Report: Raw CDP Gateway & E2E Qualification

## 1. Request & Authority
- **Operation:** `run` (code validation & E2E qualification)
- **Scope:** Phase 04 Cycle 2 remediation verification across server integration targets, qualification example check, UI E2E typecheck, and Playwright agent qualification suite.
- **Authority:** Read-only test execution and reporting. No product, test, or CI edits authorized.
- **Loaded Policies:** `test-principles.md`, `code-validation.md`.
- **Environment:** Linux 7.2.15-200.fc44.x86_64, Node.js v24.2.0, pnpm 10.4.1, Cargo/Rustc 1.91.0.

---

## 2. Risk Map & Selection
- **Targeted Behavior:** Raw CDP gateway WebSocket upgrade & routing, instance-scoped credentials, capability/origin enforcement, agent connection isolation, Playwright client interactions, and regression surfaces across browser host admission, auth, input, lifecycle, and shutdown.
- **Gates:**
  1. Unit/integration gateway tests (`browser_host_gateway`)
  2. Integration regressions (`lifecycle`, `shutdown`, `admission`, `auth`, `input`)
  3. Example compilation (`browser_host_qualification`)
  4. TypeScript E2E typecheck (`tsconfig.e2e.json`)
  5. Playwright E2E integration against production gateway (`agent.spec.ts`)

---

## 3. Execution Summary

| # | Check / Command | Exit | Duration | Passed | Failed | Skipped | Status |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | `cargo test --manifest-path server/Cargo.toml --test browser_host_gateway -- --nocapture` | 0 | 0.80s | 13 | 0 | 0 | **PASS** |
| 2 | `cargo test --manifest-path server/Cargo.toml --test browser_host_lifecycle --test browser_host_shutdown --test browser_host_admission --test browser_host_auth --test browser_host_input` | 0 | 0.49s | 33 | 0 | 0 | **PASS** |
| 3 | `cargo check --manifest-path server/Cargo.toml --example browser_host_qualification` | 0 | 0.17s | 1 (build) | 0 | 0 | **PASS** |
| 4 | `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | 0 | 1.26s | 1 (typecheck) | 0 | 0 | **PASS** |
| 5 | `pnpm --filter @dam-hopper/ui exec playwright test e2e/os-host-browser/agent.spec.ts` | 0 | 7.30s | 8 | 0 | 0 | **PASS** |
| **Total** | **All Verification Targets** | **0** | **10.02s** | **56** | **0** | **0** | **PASS** |

**Pass Rate:** 100% (54 test assertions + 2 build/typecheck gates passed, 0 failures, 0 skips).

---

## 4. Per-Target Results

### Target 1: `browser_host_gateway` (13 passed, 0 failed)
- `test_global_agent_capacity_limit_rejects_busy_429` — pass
- `test_capacity_limit_dynamic_budget` — pass
- `test_write_with_cancel_aborts_immediately` — pass
- `test_agent_target_registration_in_manager` — pass
- `test_native_geometry_mutation_fences_managed_input` — pass
- `test_origin_less_capability_only_denied_401` — pass
- `test_origin_less_without_bearer_denied_401` — pass
- `test_unauthenticated_discovery_denied_401` — pass
- `test_ws_upgrade_unauthenticated_denied_401` — pass
- `test_ws_upgrade_wrong_origin_denied_403` — pass
- `test_non_admin_discovery_denied_403` — pass
- `test_discovery_wrong_origin_denied_403` — pass
- `test_live_revocation_detection` — pass

### Target 2: Regression Suites (33 passed, 0 failed across 5 targets)
- `browser_host_admission` (7 passed): dev mode loopback/origin gates, unauthenticated rejection, ordinary user rejection, idempotent session creation, URL policy enforcement, admin admission, disabled user rejection.
- `browser_host_auth` (6 passed): paired media control connection/cancellation, purpose/origin swap rejection, ticket expiry clipping, targeted revocation, ticket issuance/consumption, live auth verification demotion.
- `browser_host_input` (7 passed): fraction-to-css mapping, lease renewal clipping, queue coalescing/gaps, saturation queue overflow key release, viewport update/epochs, selected text/find commands, rest control lease lifecycle.
- `browser_host_lifecycle` (10 passed): managed profile layout/lock, metadata persistence/epoch, reset tombstone lifecycle, reset profile simulated delete failure, stale epoch rejection, simulated kill failure, manager capabilities DTO, successful reset sequence, reconnect/stop, reset while running.
- `browser_host_shutdown` (3 passed): startup without browser launches no engine, shutdown timeout leaves tombstone/preserves credentials, shutdown reaps browser descendants.

### Target 3: `browser_host_qualification` (Passed)
- `cargo check --manifest-path server/Cargo.toml --example browser_host_qualification`
- Finished `dev` profile in 0.17s without errors.

### Target 4: UI E2E Typecheck (Passed)
- `pnpm --filter @dam-hopper/ui test:e2e:typecheck`
- `tsc -p tsconfig.e2e.json` completed in 1.26s with zero diagnostic errors.

### Target 5: Playwright Agent Qualification (`agent.spec.ts`, 8 passed)
1. `rejects unauthenticated discovery request with HTTP 401 and no-store` — pass
2. `rejects discovery with unapproved Origin even with valid bearer` — pass
3. `rejects WebSocket upgrade with unapproved Origin even with valid bearer` — pass
4. `rejects Origin-less capability-only upgrade even with a valid ticket` — pass
5. `accepts discovery with valid bearer and rewrites webSocketDebuggerUrl to gateway` — pass
6. `proves Playwright connectOverCDP connects to production gateway using Bearer on both paths and mutates target` — pass
7. `proves agent Page.disable or stopScreencast cannot stop the independent native session` — pass
8. `proves revocation of one agent login closes its connection while sibling session persists` — pass

---

## 5. Artifacts & Changes
- **Source/Test Edits:** None (strictly read-only test execution).
- **Retries / Flakiness:** 0 retries. All suites succeeded on first attempt.
- **Runner Logs:** Preserved in ephemeral test runner output artifacts (artifacts 65, 67, 69).

---

## 6. Disposition & Unresolved Questions
- **Disposition:** 100% PASS across all 5 verification targets. Phase 04 Cycle 2 remediation verified clean.
- **Unresolved Questions:** None.
