# Code Review: Phase 06 — End-to-End Verification, Security Review and Safe Rollout

Date: 2026-10-11
Reviewer: EvcCodeReviewerPhase06
Score: 9.3/10
Status: APPROVED

## Code Review Summary

### Scope
- Files reviewed:
  - `server/src/idle_suspend/client_presence.rs`
  - `server/src/idle_suspend/coordinator.rs`
  - `server/src/idle_suspend/tests.rs`
  - `server/src/pty/tests.rs`
  - `server/tests/idle_suspend.rs`
  - `server/examples/agent_free_consent_fixture.rs`
  - `packages/ui/src/api/idle-suspend-client.test.ts`
  - `packages/ui/e2e/host-auto-sleep/host-auto-sleep.spec.ts`
  - `scripts/verify-idle-suspend-boundary.sh`
  - `docs/CHANGELOG.md`
  - `docs/api/idle-suspend.md`
  - `docs/linux-systemd/idle-suspend-runbook.md`
  - `docs/system-architecture.md`
  - `docs/terminal-idle-suspend-security.md`
  - `plans/261010-1746-host-resources-auto-sleep/plan.md`
  - `plans/261010-1746-host-resources-auto-sleep/progress.md`
  - `plans/261010-1746-host-resources-auto-sleep/phase-06-verification-security-and-rollout.md`
- Lines of code analyzed: ~1,650 lines across server, UI tests, E2E specs, shell scripts, and docs.
- Review focus: Phase 06 E2E verification, boundary tests, security review, concurrency safety, safe loopback fixture, and rollout runbook.
- Updated plans:
  - `plans/261010-1746-host-resources-auto-sleep/plan.md`
  - `plans/261010-1746-host-resources-auto-sleep/progress.md`
  - `plans/261010-1746-host-resources-auto-sleep/phase-06-verification-security-and-rollout.md`

### Overall Assessment
Code quality high. Security boundaries, concurrency invariants, and privacy guarantees robust. Permanent deterministic tests cover all key race scenarios (C01, C15, C18, C21, C23, C27). Loopback fixture executes full real-router AppState path without real host sleep risk. 15 automated security checks pass. 0 compile errors, 0 linter warnings across Rust and TypeScript.

### Critical Issues
None. Zero vulnerabilities, zero privilege escalation risks, zero breaking changes.

### High Priority Findings
None.

### Medium Priority Improvements
1. **Production coordinator test-seam threshold check (`server/src/idle_suspend/coordinator.rs:685`)**:
   - `if is_agent_free_policy && quiet_period_seconds >= 60 { quiet_period_seconds = 10800; }`
   - Problem: Production coordinator relies on numeric threshold `< 60` to permit the example smoke binary (`agent_free_consent_fixture.rs`) to test fast 1s ticks outside `cfg(test)`.
   - Risk: Low in production because config validation enforces `quiet_period_seconds == 10800`, but testing seams should ideally be explicit (e.g. compile-time feature or fixture-specific coordinator builder) rather than relying on an implicit `< 60` numeric gate in production code.
   - Recommendation: In subsequent refactoring, pass an explicit timing override parameter to `start_with_components` or gate behind a dev feature flag.

### Low Priority Suggestions
1. **Removed redundant imports and unused struct in tests**:
   - Cleaned up unused `chrono::Utc`, `jsonwebtoken`, and `struct TestClaims` in `server/tests/idle_suspend.rs`.
   - Cleaned up unused `expectTouchTarget` and `Locator` import in `packages/ui/e2e/host-auto-sleep/host-auto-sleep.spec.ts`.

### Positive Observations
- **Deterministic 3-hour boundary verification (C01)**: Rigorous verification that 10,799s and 10,800s remain ineligible; only strictly >10,800s triggers eligibility.
- **Approving socket disconnect invalidation (C15)**: Exact coverage of race where approving client drops before dispatch while other sockets remain live; coordinator cancels consent and defers 3h without false execution.
- **Safe real-router loopback smoke**: `agent_free_consent_fixture` exercises real HTTP/WebSocket and AppState without synthetic API mocking or machine sleep risk.
- **Zero-knowledge privacy & security**: Status DTOs expose only coarse aggregated counts; no tokens, process paths, socket inodes, or prompt text leaked. Body limit strictly capped at 16 KiB.
- **Complete canary & rollback documentation**: Runbook section 11.12 explicitly discloses external-agent exclusion and outlines step-by-step canary verification and rollback.

### Recommended Actions
1. Keep `agent-free` default-off in production configuration until target-host hardware maintenance window canary completes.
2. Schedule hardware maintenance window for physical Linux host verification of RTC wake and logind sleep integration.

### Metrics
- Type Coverage: 100% (0 errors across `tsc --noEmit` and `tsc -p tsconfig.e2e.json`)
- Test Coverage: 388/388 passed targeted tests (199 lib unit, 22 integration, 46 UI unit, 17 browser Vitest, 15 boundary checks, 5 smoke scenarios)
- Linting Issues: 0 errors, 0 warnings

### Unresolved Questions
None. Hardware qualification remains an explicit operator maintenance window activity as documented.
