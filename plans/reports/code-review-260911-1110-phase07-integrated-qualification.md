# Code Review Report: Phase 07 — Integrated Qualification

**Date:** 2026-09-11  
**Target:** Terminal Idle Suspend Phase 07 (Integrated Qualification)  
**Reviewer:** Phase07Reviewer  
**Score:** 9.4/10  

---

## Code Review Summary

### Scope
- **Files reviewed:**
  - `server/tests/idle_suspend.rs`
  - `server/src/api/tests.rs`
  - `packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx`
  - `server/src/idle_suspend/activity/process.rs`
  - `server/src/idle_suspend/backend.rs`
  - `server/src/idle_suspend/preflight.rs`
  - `server/src/main.rs`, `server/src/api/auth.rs`, `server/src/api/host_actions.rs`, `server/src/api/router.rs`
  - `plans/reports/qa-260911-1107-phase07-integrated-qualification.md`
  - `plans/260910-1604-agent-activity-idle-suspend/phase-07-verification.md`
- **Lines of code analyzed:** ~2,300 lines (tests + core patches)
- **Review focus:** Integrated qualification, security boundaries, privacy compliance, live Linux smoke test safety, YAGNI/KISS/DRY adherence.
- **Updated plans:**
  - `plans/260910-1604-agent-activity-idle-suspend/phase-07-verification.md` (marked complete, updated todo checklist)
  - `plans/260910-1604-agent-activity-idle-suspend/plan.md` (updated Phase 07 delivery status to 88% overall, ready for Phase 08)

---

## Overall Assessment
High quality implementation. Fail-safe design contracts strictly upheld:
- `PanicExecutor` prevents any accidental host suspend / RTC writes during live Linux smoke tests.
- Live Linux smoke uses test binary child mode (`current_exe()`) and loopback socket exchange (1024 bytes) without third-party network dependencies.
- Privacy boundary preserved: serialization tests explicitly assert absence of start ticks, arguments, command lines, socket details, and terminal IDs in status JSON.
- Browser test additions in Chromium Vitest verify reconciling/initializing warning states, disabled observer status, and legacy old-server payload fallbacks.
- Boundary check script (`verify-idle-suspend-boundary.sh`) passes 14/14 checks with zero sudo / shell invocations in `idle_suspend`.

---

## Critical Issues (MUST FIX)
None. Zero breaking changes, zero security regressions, zero host suspend side-effects in automation.

---

## Warnings (SHOULD FIX)

1. **Contradictory Test Name vs Assertion in `server/src/api/tests.rs:6537`**:
   - Test `idle_suspend_status_agent_activity_available_measurement_warning_is_null` names its objective as verifying `measurement_warning_is_null`.
   - However, the assertion tests the unstarted fallback state: `assert!(json["activity"]["measurementWarning"].is_object());`.
   - This duplicates the check in `idle_suspend_status_agent_activity_fallback_and_privacy` without actually testing the case where `measurement_state == Available` and `measurementWarning == null`.
   - *Remediation*: Update test setup to verify an available observation serializing `measurementWarning` as `serde_json::Value::Null`.

2. **Inconsistent Comment in `server/tests/idle_suspend.rs:1189`**:
   - `test_integrated_agent_activity_accepted_input_invalidates_quiet` comment states `// Wait for coordinator to reach Armed state (quiet = 2s)`, but fixture is configured with `quiet = 3s` (`setup_agent_activity_fixture(true, 3, 600, ...)`).
   - *Remediation*: Align comment with actual configured timing.

---

## Suggestions (NICE TO HAVE)

1. **Assert `coordinator.status().activity` in Live Smoke Test**:
   - In `activity_live_linux_pty_tcp_smoke` (`server/tests/idle_suspend.rs:1435`), the test asserts that PTY output sequence advanced and loopback byte exchange completed, but does not read `coordinator.status().activity` to verify recognized agent/socket presence. Adding a status check would verify the coordinator loop in the live smoke.

2. **Coordinator-Level Truncation Test**:
   - `idle_suspend_status_warning_serialization_privacy_and_bounds` manually assigns 35 processes to test serde serialization. A coordinator-level test asserting that an observation with >32 processes is truncated to 32 with `processes_truncated: true` would exercise `coordinator.rs:1062-1064`.

---

## Positive Observations
- **Fail-Safe Live Smoke**: Uses `PanicExecutor` guaranteeing zero calls to `execute_suspend` during real PTY/netlink smoke.
- **Zero Shell Boundary Compliance**: Adjusted Linux process test fixture from `sh -c 'sleep 5'` to direct `sleep 5` spawn, eliminating shell invocations in `server/src/idle_suspend/`.
- **Clean Cross-Origin Security**: Enhanced `require_action_request` using `from_fn_with_state` and strict `origin_is_allowed` host checks, avoiding CORS regressions.
- **Clean Timing**: Test suites complete quickly (<3s for 19 integration tests; 0.72s for live Linux smoke; 2.06s for browser suite).

---

## Validation Commands & Results

| Suite / Command | Target | Passed | Failed | Status |
|---|---|---|---|---|
| `cargo test --manifest-path server/Cargo.toml --test idle_suspend` | Integration suite | 19 | 0 (2 ignored) | PASS (2.70s) |
| `cargo test --manifest-path server/Cargo.toml --test idle_suspend activity_live_linux_pty_tcp_smoke -- --ignored --exact --nocapture --test-threads=1` | Live Linux smoke | 1 | 0 | PASS (0.72s) |
| `cargo test --manifest-path server/Cargo.toml --lib api::tests::idle_suspend` | API route tests | 11 | 0 | PASS (0.35s) |
| `cargo test --manifest-path server/Cargo.toml --lib idle_suspend::activity` | Activity lib tests | 66 | 0 | PASS (0.23s) |
| `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/idle-suspend-settings-status.browser.tsx` | Chromium UI tests | 16 | 0 | PASS (2.06s) |
| `pnpm --filter @dam-hopper/ui test -- HostIdleSuspendStatus.test.tsx SettingsIdleSuspendTimingSection.test.tsx ForceSleepDialog.test.tsx` | Targeted UI unit tests | 1606 (233 files) | 0 | PASS (9.92s) |
| `./scripts/verify-idle-suspend-boundary.sh` | Hardened boundary audit | 14 checks | 0 | PASS (0.14s) |

---

## Unresolved Questions
None.
