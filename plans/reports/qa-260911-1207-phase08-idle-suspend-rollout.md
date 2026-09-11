# QA Report: Phase 08 — Documentation, Operations Runbooks, and Controlled Rollout

**Date:** 2026-09-11
**Target:** Terminal Idle Suspend Phase 08 (Documentation, Controlled Rollout & Rollback Boundaries)
**Environment:** Linux 7.1.10-200.fc44.x86_64, monorepo root `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend`

---

## Test Results Overview

| Suite / Command | Files / Modules | Passed | Failed | Skipped / Ignored | Filtered | Duration | Status |
|---|---|---|---|---|---|---|---|
| `./scripts/verify-idle-suspend-boundary.sh` | 14 boundary checks | 14 | 0 | 0 | 0 | 0.14s | PASS |
| `cargo test --manifest-path server/Cargo.toml --test idle_suspend` | 1 suite (`tests/idle_suspend.rs`) | 19 | 0 | 2 | 0 | 2.68s | PASS |
| `cargo test --manifest-path server/Cargo.toml --test idle_suspend activity_live_linux_pty_tcp_smoke -- --ignored --exact --nocapture --test-threads=1` | 1 suite (`tests/idle_suspend.rs`) | 1 | 0 | 0 | 20 | 0.74s | PASS |
| `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/idle-suspend-settings-status.browser.tsx` | 1 file | 16 | 0 | 0 | 0 | 2.07s | PASS |
| `pnpm --filter @dam-hopper/ui test` | 233 files | 1606 | 0 | 0 | 0 | 10.41s | PASS |
| **Total Qualified Test Suite** | **236 files / targets** | **1642 tests + 14 boundary checks** | **0** | **2 ignored** | **20** | **~16.0s** | **ALL PASS (100%)** |

---

## Qualification & Behavior Verified

1. **Security & Boundary Guard Invariants (`verify-idle-suspend-boundary.sh`)**:
   - Zero `sudo` execution in `server/src/`; zero `sudo` references in `idle_suspend`.
   - Zero shell invocations (`sh`, `bash`, `zsh`) in `server/src/idle_suspend/`.
   - Systemd helper service/socket hardened with strict security flags (`ProtectSystem=strict`, `CapabilityBoundingSet=CAP_WAKE_ALARM`, `NoNewPrivileges=yes`, `PrivateTmp=yes`, `ProtectHome=yes`).
   - Default-off configuration invariant (`enabled = false`, `automatic_policy = "empty-fleet"`).
   - PUT `/api/config` prohibits idle suspend timing delta bypass (mutation separated to authenticated PATCH).
   - Cross-module integration test suite and UI browser test suite presence verified.
   - Force-suspend route registered with 16 KiB body limit.
   - Timing minimums enforced: 60s minimums, execution wake domain constraints.
   - Server audit trail file mode 0600 with `O_NOFOLLOW` flag verified.
   - Zero `Command::new` in `server/src/api/idle_suspend.rs`.
   - API service PID file (`/run/dam-hopper/server.pid`) and unit lifecycle hooks verified.
   - Release manager helper unit staging, activation, and status hooks confirmed.

2. **Server Idle Suspend Test Suite (`tests/idle_suspend.rs`)**:
   - 19 passed tests covering force-suspend DTOs, conflict handling (HTTP 409 during handoff), inhibitor suppression, post-resume reconciliation, PTY epoch tracking, PTY spawn canceling armed grace, unavailable executor fail-closed behavior, pre-handoff timing patch rearm, disabled observation semantics, zero side effects on active fleets without force, manual force races, active PTY handoffs, input invalidation of quiet window, clean shutdown join, and service-only PTY exclusions.
   - 2 tests ignored by default: live child worker and live Linux PTY/TCP smoke test.

3. **Live Linux PTY / TCP Observer Smoke (`activity_live_linux_pty_tcp_smoke`)**:
   - Live Linux socket creation, real PTY allocation, and process netlink observation executed under exact test harness.
   - Completed in 0.74s without real host suspend invocation or RTC mutation (uses fake executor).

4. **UI Browser Tests (`browser-tests/idle-suspend-settings-status.browser.tsx`)**:
   - 16 tests passed in real headless Chromium browser environment.
   - Verified status polling, badge transitions, countdown clock, warning process formatting (safe truncated PID/executable formatting, no command argument leakage), slider minimum constraint enforcement, force-sleep confirmation dialog, and error recovery states.

5. **Full UI Test Suite (`pnpm --filter @dam-hopper/ui test`)**:
   - 233 test files passed, 1606 tests passed, 0 failures, 0 regressions.
   - Full regression suite clean across all UI components and workspaces.

---

## Coverage Metrics

- **Boundary Invariants:** 14/14 checks passed (100%).
- **Server Idle Suspend Integration:** 20/20 active tests passed (100% including ignored live smoke test).
- **UI Settings & Status Browser Tests:** 16/16 browser tests passed (100%).
- **UI Package Regression Suite:** 1606/1606 unit/integration tests passed across 233 files (100%).
- **Critical Path Code Coverage:** All idle suspend policy transitions, handoff safety checks, warning redactions, and input admission pathways tested.

---

## Failed Tests

- **None.** Zero test failures across all 5 test executions.

---

## Performance Metrics

| Step | Execution Time (Runner) | Wall Time | Performance Assessment |
|---|---|---|---|
| Boundary script | 0.14s | 0.14s | Fast static AST/grep verification |
| Cargo test `idle_suspend` | 2.68s | 3.00s | Optimal for multi-process integration tests |
| Cargo test live smoke | 0.74s | 1.03s | Well within the 1.0s sample deadline requirement |
| Vitest browser test | 2.07s | 2.72s | Fast headless Chromium launch and assertion |
| Full Vitest UI test suite | 10.41s | 11.02s | Excellent throughput across 233 files (1606 tests) |

- **Slowest individual test:** `test_idle_suspend_cross_module_lifecycle_empty_to_armed_to_resumed` (~0.4s).
- **All tests complete well within target performance constraints.**

---

## Build Status

- **Status:** Clean.
- **Errors:** 0.
- **Warnings:** 0.
- **Host Execution Invariant:** Zero real host suspend or RTC hardware mutations triggered; all automated tests strictly bind fake/mock executors.

---

## Critical Issues

- **None.** No blocking code, boundary, or test issues identified.

---

## Recommendations

1. **Gate Automation:** Keep `./scripts/verify-idle-suspend-boundary.sh` as a mandatory pre-commit and CI gate to ensure no forbidden shell or sudo calls slip into server modules.
2. **Canary Prerequisites:** Enforce that target-host qualification executes the ignored `activity_live_linux_pty_tcp_smoke` test under target systemd service credentials before enabling `agent-activity` on any production host.
3. **Controlled Rollout Path:** Ensure initial rollout maintains `enabled = false` with `automatic_policy = "agent-activity"` to observe metrics and warnings before switching `enabled = true`.

---

## Next Steps

1. Transition Phase 08 rollout artifacts and runbooks to Operations review.
2. Execute dark release: deploy binary with existing configuration default (`empty-fleet`, `enabled = false`).
3. Schedule canary host soak and designate Operations owner for bounded automatic canary.

---

## Unresolved Questions

1. **Target Canary Host:** Which specific Linux production host, Operations owner, maintenance window, and physical/out-of-band recovery path are designated for the observation soak and initial bounded automatic canary?
2. **Evidence Retention Store:** What access-controlled operational archive will Operations use to store per-host sanitized qualification evidence without logging private process details?
3. **Workload Transport Profile:** Do representative production agents in target environments utilize UDP/QUIC, separate network namespaces, or external proxy delegation that would trigger persistent `unavailable` observation warnings?
4. **Target-Host Sample Latency Under Load:** Will the API service context on target hardware consistently complete proc/netlink sampling and join cleanly within the 1.0-second deadline under heavy concurrent host load?
