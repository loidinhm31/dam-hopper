# Release Verification Report: Idle-Suspend & Diagnostics

**Date:** 2026-09-14 01:39  
**Branch:** `feat/terminal-idle-suspend`  
**Target:** Preparation verification for merge to `main` for release  
**Reference Plans:**
1. `plans/260910-1604-agent-activity-idle-suspend/plan.md`
2. `plans/260912-0027-production-idle-suspend-diagnostics/plan.md`

---

## 1. Executive Summary

- **Plan Checklist Audit:** Both plans are 100% complete with 0 open checklist items across all phases (Plan 260910-1604: 8/8 phases; Plan 260912-0027: 7/7 phases).
- **Backend Test Verification:** 1,367/1,367 tests passed across 36 test suites in `server/`.
  - `idle_suspend` lib tests: 172/172 passed.
  - `idle_suspend` integration: 19/19 passed (2 real-hardware tests safely ignored).
  - `idle_suspend_diagnostics`: 8/8 passed (atomic 0600 output, roles, redaction, fault matrix, bounds).
  - `idle_suspend_phase07`: 2/2 passed (cross-layer automatic and manual UUID correlation chains).
  - `idle_suspend_diagnostics_linux_smoke`: 1/1 passed (read-only live Linux host smoke in 0.31s).
  - `pty` tests: 192/192 passed (1 benchmark ignored).
  - `linux_release` tests: 142/142 passed across 16 suites.
- **Frontend & Native Verification:**
  - `@dam-hopper/shared`: 15/15 passed.
  - `@dam-hopper/browser-bridge`: 19/19 passed.
  - `@dam-hopper/ui` unit tests: 1,606/1,606 passed (233 test files).
  - `@dam-hopper/ui` browser tests (`idle-suspend-settings-status.browser.tsx`): 16/16 passed in Chromium.
  - `@dam-hopper/native` tests: 46/46 passed.
  - Linter (`pnpm lint`): 0 errors across entire workspace.
  - Web production build (`pnpm build`): passed cleanly in 38.78s.
- **Release Packaging Gate:**
  - Archive generation (`deploy/release/build-release-archive.sh`): verified (21.88 MB, SHA256 `a9342b46...`).
  - Release manifest (`generate-release-manifest.mjs`): 158 entries generated, schemaVersion 2.
  - Asset verification (`check-release-assets.mjs`): passed all gates for v0.3.0.
- **Critical Merge Boundary / Action Item:**
  - `origin/main` has commit `a642931a` (PR #29) modifying `deploy/systemd/dam-hopper-api.service.in`, `server/src/linux_release/activate.rs`, and `server/src/linux_release/unit_policy.rs` to point config to `@API_HOME@/.config/dam-hopper/dam-hopper.toml`.
  - Current branch has commits `20d296a0` and `bc129a89` introducing `provision-api-runtime` and `server/src/linux_release/api_runtime.rs`.
  - Merging into `main` requires reconciling these 3 files to combine `provision-api-runtime` with the `@API_HOME@` config resolution.

---

## 2. Test Execution Matrix

| Test Target | Suite / Command | Executed | Passed | Failed | Ignored | Duration |
|:---|:---|---:|---:|---:|---:|---:|
| `idle_suspend` Library | `cargo test --lib idle_suspend` | 172 | 172 | 0 | 0 | 1.32s |
| `idle_suspend` Integration | `cargo test --test idle_suspend` | 21 | 19 | 0 | 2 | 2.85s |
| `idle_suspend_diagnostics` | `cargo test --test idle_suspend_diagnostics` | 8 | 8 | 0 | 0 | 0.30s |
| `idle_suspend_phase07` | `cargo test --test idle_suspend_phase07` | 2 | 2 | 0 | 0 | 0.50s |
| `idle_suspend_linux_smoke` | `cargo test --test idle_suspend_diagnostics_linux_smoke -- --ignored` | 1 | 1 | 0 | 0 | 0.31s |
| `pty` Subsystem | `cargo test --lib pty` | 193 | 192 | 0 | 1 | 8.38s |
| `idle_suspend` API Endpoints | `cargo test --lib api::tests::idle_suspend` | 11 | 11 | 0 | 0 | 0.42s |
| Linux Release Integration | `cargo test --test 'linux_release*'` (16 suites) | 142 | 142 | 0 | 0 | 0.16s |
| Full Backend Suite | `cargo test --tests -- --test-threads=4` (36 suites) | 1,372 | 1,367 | 0 | 5 | 40.14s |
| Shared UI / Types | `pnpm --filter @dam-hopper/shared test` | 15 | 15 | 0 | 0 | 0.16s |
| Browser Bridge | `pnpm --filter @dam-hopper/browser-bridge test` | 19 | 19 | 0 | 0 | 0.51s |
| UI Unit Tests | `pnpm --filter @dam-hopper/ui test` (233 files) | 1,606 | 1,606 | 0 | 0 | 10.80s |
| Idle Suspend Browser (Chromium) | `pnpm --filter @dam-hopper/ui test:browser idle-suspend-settings-status.browser.tsx` | 16 | 16 | 0 | 0 | 2.34s |
| Native Host Unit / Smoke | `pnpm --filter @dam-hopper/native test` | 46 | 46 | 0 | 0 | 1.58s |
| ESLint Workspace Gate | `pnpm lint` | - | Clean | 0 err | 18 warn | 24.48s |
| Release Asset Check | `node deploy/release/check-release-assets.mjs --tag v0.3.0 --dir artifacts/final` | 4 assets | Clean | 0 | 0 | 0.20s |

---

## 3. Plan Deliverables & Verification Details

### 3.1 Plan 260910-1604: Agent Activity Idle-Suspend
- **PTY Evidence & Input Admission (Phases 01-02):**
  - PTY raw output byte counter tracked per incarnation.
  - Accepted input anywhere unconditionally resets quiet period.
  - Zero-activity service PTYs ignored during evaluation.
- **Process Discovery & Lineage Attribution (Phase 03):**
  - Bounded `/proc` inspection discovers child process tree under configured agents (`codex`, `omp`, `claude`, `agy`).
  - Privacy-preserving attribution exposes PID and executable path without command-line arguments or environment variables.
- **Netlink Sock Diag TCP Observation (Phase 04):**
  - Direct unprivileged `NETLINK_INET_DIAG` socket reads for TCP4 and TCP6 byte deltas.
  - Cookie, family, and network namespace identification.
  - Bounded multipart response parsing; fail-closed on diagnostic errors.
- **Transactional Sampler & Admission Coordinator (Phase 05):**
  - Joinable background sampler thread.
  - Atomic evaluation window with spent-epoch and lock fencing.
  - Protected status serialization adheres to schema version 1.
- **Client & UI Surface (Phase 06):**
  - Authenticated status endpoints `/api/system/idle-suspend/v1/status`.
  - Manual force sleep confirmation dialog and quiet countdown.
  - 16/16 Chromium browser tests pass.
- **Operations & Runbooks (Phase 08):**
  - Documentation, canary rollout strategy, and rollback instructions completed in `docs/`.

### 3.2 Plan 260912-0027: Production Idle-Suspend Diagnostics
- **Frozen Architecture & Event Foundation (Phases 01-02):**
  - Canonical event writer with thread-safe monotonic sequence IDs and schema version 1.
  - Hardened file rotation and size capping (8 MiB / 10,000 records).
- **Coordinator & Helper Instrumentation (Phases 03-04):**
  - Attempt UUID generated on coordinator and forwarded as helper request ID.
  - Semantic milestones captured across coordinator states and helper executions without per-sample telemetry overhead.
- **Bundle Correlation & Redaction Engine (Phase 05):**
  - Pure bundle model correlates attempts across coordinator events, helper audit logs, systemd states, and host evidence.
  - 100% redaction corpus exclusion: tokens, credentials, terminal I/O, socket addresses, and arguments are redacted or excluded.
- **Linux CLI & Role-Aware Adapters (Phase 06):**
  - `dam-hopper diagnose --json` command with exit codes: `0` (complete), `2` (partial/non-root), `1` (fatal).
  - Secure `0700` bundle directory and atomic `0600` output file mode.
- **Cross-Layer Verification & Smoke (Phase 07):**
  - Fault matrix verified: malformed lines, sequence gaps, schema version mismatches, non-root EUID handling.
  - Live read-only Linux host smoke test verified with zero host mutations.

---

## 4. Release & Merge Risks

### Risk 1: Upstream Divergence in Systemd Unit & Config Path
- **Fact:** Commit `a642931a` on `origin/main` updated `ExecStart` to `@API_HOME@/.config/dam-hopper/dam-hopper.toml`.
- **Branch State:** `feat/terminal-idle-suspend` commit `20d296a0` introduced `provision-api-runtime` pre-start hook and `server/src/linux_release/api_runtime.rs`.
- **Breakage Risk:** Merging without conflict resolution will produce merge conflicts in:
  1. `deploy/systemd/dam-hopper-api.service.in`
  2. `server/src/linux_release/activate.rs`
  3. `server/src/linux_release/unit_policy.rs`
  4. `server/tests/linux_release_unit_policy.rs`
- **Mitigation:** When merging into `main`, retain both:
  - `ExecStartPre=+@RELEASE_ROOT@/bin/dam-hopper-manager provision-api-runtime`
  - `ExecStart=@RELEASE_ROOT@/bin/dam-hopper-server --config @API_HOME@/.config/dam-hopper/dam-hopper.toml --host 0.0.0.0 --port 4801`
  - Update `unit_policy.rs` and `unit_policy.rs` tests to match.

### Risk 2: Working Directory Uncommitted Files
- **Fact:** 19 files in `server/src/linux_release/` and 2 test fixture files have formatting and constant alignment changes (`MANAGER_STATE_SCHEMA_VERSION` in `state.rs`, `helper_unit_sha256: None` in fixtures).
- **Verification:** All 1,367 tests and 142 release tests pass with these changes.
- **Action:** Commit these formatted/aligned files alongside the ESLint and UI cleanups prior to merge.

---

## 5. Unresolved Questions

1. Does Operations intend to merge `feat/terminal-idle-suspend` directly into `develop` or directly into `main`?
2. Should the PR merge conflict resolution in `dam-hopper-api.service.in` retain the `server.pid` management lines (`ExecStartPost=/usr/bin/sh -c 'echo $MAINPID > /run/dam-hopper/server.pid'`) alongside the `@API_HOME@` config path?
