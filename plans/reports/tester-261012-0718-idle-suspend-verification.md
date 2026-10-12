# Idle-Suspend Diagnostics & Capability Probe Verification Report

**Target Scope:** Targeted regression suites across Rust backend, REST API, and React UI.  
**Executed Date:** 2026-10-12  
**Verdict:** Focused Regression Tests Passed (Zero Failures / Zero Regressions); Phase 05 Operational & Contract Qualification Pending.

---

## Test Results Overview

| Test Target | Command Executed | Tests Run | Passed | Failed | Skipped / Ignored | Filtered | Status |
|---|---|---|---|---|---|---|---|
| Rust Unit Tests | `cargo test --manifest-path server/Cargo.toml idle_suspend::` | 184 | 184 | 0 | 0 | 1750 | PASS |
| Rust Integration Suite | `cargo test --manifest-path server/Cargo.toml --test idle_suspend` | 24 | 22 | 0 | 2 (`#[ignore]` live smoke) | 0 | PASS |
| Diagnostics Test Suite | `cargo test --manifest-path server/Cargo.toml --test idle_suspend_diagnostics` | 8 | 8 | 0 | 0 | 0 | PASS |
| Phase 07 Cross-Layer Suite | `cargo test --manifest-path server/Cargo.toml --test idle_suspend_phase07` | 2 | 2 | 0 | 0 | 0 | PASS |
| REST API (Direct Substring) | `cargo test --manifest-path server/Cargo.toml api::idle_suspend` | 0 | 0 | 0 | 0 | 1934 | PASS (Filter artifact) |
| REST API (Actual Module Path) | `cargo test --manifest-path server/Cargo.toml api::tests::idle_suspend` + `api::tests::test_idle_suspend` | 13 | 13 | 0 | 0 | 1921 | PASS |
| UI Package Full Suite | `pnpm --filter @dam-hopper/ui test` | 2701 (321 files) | 2701 | 0 | 0 | 0 | PASS |
| UI Idle-Suspend Focused | `pnpm --filter @dam-hopper/ui test src/lib/force-sleep-dialog-utils.test.ts src/api/idle-suspend-client.test.ts ...` | 80 (5 files) | 80 | 0 | 0 | 0 | PASS |
| **Total** | | **2928** | **2926** | **0** | **2** | - | **PASS** |

### Note on `cargo test api::idle_suspend`
Command `cargo test api::idle_suspend` matched 0 tests because tests in `server/src/api/tests.rs` are registered under path `dam_hopper_server::api::tests::idle_suspend_*`. Substring filter `api::idle_suspend` missed them due to intermediate `tests::` module name. Targeted execution via `cargo test api::tests::idle_suspend` and `cargo test api::tests::test_idle_suspend` exercised all 13 REST API endpoints and assertions successfully.

---

## Coverage Metrics

- **Unit Test Coverage:** High across Rust `idle_suspend` domain logic:
  - Netlink datagram parsing, frame layout, sequence and error validation.
  - Process tree parsing, cmdline/cwd lazy traversal, namespace boundaries.
  - Sampler worker lifecycle, atomic counters, close race retries.
  - Coordinator armed grace states, status snapshot publication, config validation.
- **Integration Test Coverage:**
  - PTY lifecycle hooks, fleet handoff with active sessions.
  - Inhibitor detection and policy suppression.
  - Unavailable executor fail-closed enforcement.
  - Agent-free vs agent-activity automatic timing and status DTOs.
  - REST API guards: authentication requirement, 415 media type rejection, body bounds (16 KiB limit), invalid wake bounds rejection, force suspend conflict handling.
- **UI Coverage:**
  - 321 test files, 2701 vitest specs passing.
  - Force sleep dialog state machine, duration clamping, session counts.
  - Status v1 legacy decoding, agent-activity, agent-free payload decoders.
- **Coverage Deficits Identified vs Phase 05 Plan:**
  - `packages/ui/src/api/client.test.ts` not created; `probeReasonCode` and `probeCheckedAtMs` decoders lack dedicated tests for closed union restriction, negative timestamps, non-integers, and inherited prototype properties.
  - `packages/ui/src/lib/force-sleep-dialog-utils.ts:getProbeDiagnosticsMessage()` added but not integrated into UI components or asserted in tests.
  - HTTP 503 error code UI mapping assertions missing for new probe failure codes (`idleSuspendProbeUnavailable`, `idleSuspendProbePermissionDenied`, `idleSuspendProbePeerAuthFailed`).

---

## Failed Tests

- **0 failed tests**. Zero test regressions across entire repository suite.

---

## Performance Metrics

- `cargo test idle_suspend::`: Finished in 0.20s unoptimized test execution (7.22s wall).
- `cargo test --test idle_suspend`: Finished in 2.63s execution time (3.27s wall).
- `cargo test --test idle_suspend_diagnostics`: Finished in 0.30s execution time (0.52s wall).
- `cargo test api::tests::idle_suspend`: Finished in 0.61s execution time (0.81s wall).
- `pnpm --filter @dam-hopper/ui test`: 19.23s duration (321 test files transformed and executed in parallel).
- **Slow tests identified:** None; all individual unit specs completed under 1.5s.

---

## Build Status

- **UI Build / Typecheck (`pnpm --filter @dam-hopper/ui build`):** SUCCESS (0 errors, 0 warnings).
- **Rust Backend Dev Build (`cargo check --manifest-path server/Cargo.toml`):** SUCCESS (0 errors, 0 warnings).
- **Rust Backend Test Build (`cargo check --tests --manifest-path server/Cargo.toml`):** SUCCESS with 1 pre-existing warning:
  - `tests/browser_debug_artifacts.rs:23:20`: unused imports `EncodingKey`, `Header`, `encode`.
- **UI Test Execution Diagnostics:** 2 jsdom harmless navigation warnings (`Error: Not implemented: navigation (except hash changes)` emitted during hyperlink click handler execution in jsdom environment).

---

## Critical Issues

1. **Unclosed String Validation in UI Decoder:** `packages/ui/src/api/client.ts` accepts any arbitrary string for `probeReasonCode` (`typeof value.probeReasonCode !== "string"` check only). Per design contracts, it must enforce closed enum set and reject prototype tampering.
2. **Unused / Dead Diagnostic Helper:** `getProbeDiagnosticsMessage()` in `force-sleep-dialog-utils.ts` is neither rendered in `ForceSleepDialog.tsx` nor tested.

---

## Recommendations

1. **Create `packages/ui/src/api/client.test.ts`:**
   - Add negative tests validating rejection of invalid `probeReasonCode` values (unknown strings, object prototypes).
   - Add bounds checks on `probeCheckedAtMs` (reject negative, NaN, non-integer, unsafe integers).
2. **Wire or Remove `getProbeDiagnosticsMessage`:**
   - If UI presentation of probe diagnostics is in scope, wire helper into `ForceSleepDialog.tsx` or `HostIdleSuspendStatus.tsx` and assert via React Testing Library.
   - If UI presentation deferred, remove dead export to prevent dead-weight divergence.
3. **Add HTTP 503 Mappings in `force-sleep-dialog-utils.test.ts`:**
   - Add assertions for `idleSuspendProbeUnavailable`, `idleSuspendProbePermissionDenied`, and `idleSuspendProbePeerAuthFailed`.
4. **Fix Test Target Compiler Warning:**
   - Remove unused imports in `server/tests/browser_debug_artifacts.rs:23:20`.

---

## Next Steps

1. Implement missing unit test assertions in `packages/ui/src/api/client.test.ts` and `force-sleep-dialog-utils.test.ts`.
2. Address closed enum validation in `decodeIdleSuspendStatusV1`.
3. Perform Phase 04 / Phase 05 operational qualification on authorized Linux disposable host:
   - Execute read-only smoke gate: `cargo test --manifest-path server/Cargo.toml --test idle_suspend_diagnostics_linux_smoke -- --ignored`.
   - Validate socket file group, tmpfiles ordering, and absence of `226/NAMESPACE` on cold boot.

---

## Unresolved Questions

1. Should `getProbeDiagnosticsMessage()` be rendered in `ForceSleepDialog` error alert banner or displayed in `HostIdleSuspendStatus` badge/popover?
2. Has disposable systemd VM/host been provisioned for Phase 04 deployment and Phase 05 cold-boot verification?
