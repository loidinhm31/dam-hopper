# Test Report: Phase 03 P0b — Usage Retirement & Release Validation

**Date:** 2026-11-02  
**Target:** Phase 03: P0b — Usage retirement and independent early release  
**Report Path:** `plans/reports/tester-261102-0925-phase-03-usage-retirement.md`  
**Overall Disposition:** PASS — The five requested checks passed on the current working tree; broader release qualification is not established.

---

## 1. Request, Scope & Authority

- **Operation:** `run` (code validation re-run on current working tree).
- **Loaded Policies:** `.omp/agent/skills/test/references/test-principles.md`, `.omp/agent/skills/test/references/code-validation.md`.
- **Target Invocations:**
  1. `cargo test --manifest-path server/Cargo.toml --test usage_retirement`
  2. `cargo test --manifest-path server/Cargo.toml --test auth_no_auth --test auth_lite_mode --test settings_import_export`
  3. `pnpm --filter @dam-hopper/ui exec vitest run src/api/queries.test.ts src/api/ws-transport.test.ts src/components/pages/SettingsPage.test.tsx src/lib/navigation.test.ts`
  4. `pnpm android:test`
  5. `node deploy/release/check-version-alignment.mjs`

---

## 2. Seven-Question Risk Gate

1. **Behaviors changed / targeted:** Deletion of server telemetry/usage modules and config schema; excision of web Usage page, client queries, and navigation; deletion of Android usage models/controllers/screens; pre-existing working-tree change in `HostResourceSseClient.kt` removing line length bound on `readUTF8Line()`.
2. **Failure modes & risks:** 404 leakage/500 panics on excised routes; legacy `[server.telemetry]` config rejection; Android SSE crash on oversized frames or unbounded memory consumption on large lines; regression in SQLite auth/session paths; manifest version mismatch.
3. **Existing coverage:** `server/tests/usage_retirement.rs`, `server/tests/auth_*.rs`, `server/tests/settings_import_export.rs`, `packages/ui` vitest suites, `native/android-app` shared JVM tests (`HostResourceModelsTest`).
4. **Lowest reliable layer:** Rust integration test harness for HTTP/REST routing; vitest for UI state and routing; Gradle JVM unit tests for Android multiplatform shared core; Node script for manifest parsing.
5. **Additional tests needed:** None authorized under `run`; existing suites cover selected scenarios, though resource-bounded line parsing remains unverified.
6. **Justification of expected oracle:** HTTP 404 for retired endpoints; HTTP 200/204 for legacy config tolerance; SemVer parity across checked manifests; frame overflow rejection without connection crash.
7. **Candidate defects rejected:** Resurgence of telemetry listeners, Ktor `TooLongLineException` breaking SSE connection flow on oversized lines.

---

## 3. Execution Results

### Check 1: Server Usage Retirement Suite
- **Command:** `cargo test --manifest-path server/Cargo.toml --test usage_retirement`
- **Duration:** 0.42s (compile 0.17s, test 0.25s)
- **Exit Code:** 0
- **Status:** PASS
- **Counts:** 5 passed; 0 failed; 0 ignored
- **Details:**
  - `neutral_db_paths_prevent_aliasing ... ok`
  - `startup_never_creates_telemetry_files_or_codex_exporter ... ok`
  - `non_usage_routes_and_system_metrics_retained ... ok`
  - `usage_routes_all_return_404 ... ok`
  - `legacy_server_telemetry_toml_and_put_config_tolerated ... ok`

### Check 2: Server Regressions Suite
- **Command:** `cargo test --manifest-path server/Cargo.toml --test auth_no_auth --test auth_lite_mode --test settings_import_export`
- **Duration:** 4.25s (compile 0.17s, tests 4.01s)
- **Exit Code:** 0
- **Status:** PASS
- **Counts:** 28 passed; 0 failed; 0 ignored (across 3 integration targets)
- **Target Breakdown:**
  - `tests/auth_lite_mode.rs`: 9 passed; 0 failed (2.03s)
  - `tests/auth_no_auth.rs`: 14 passed; 0 failed (1.66s)
  - `tests/settings_import_export.rs`: 5 passed; 0 failed (0.32s)

### Check 3: UI Unit Tests
- **Command:** `pnpm --filter @dam-hopper/ui exec vitest run src/api/queries.test.ts src/api/ws-transport.test.ts src/components/pages/SettingsPage.test.tsx src/lib/navigation.test.ts`
- **Duration:** 1.71s (test run 1.22s)
- **Exit Code:** 0
- **Status:** PASS
- **Counts:** 4 test files passed; 78 tests passed; 0 failed
- **File Breakdown:**
  - `src/lib/navigation.test.ts`: 1 passed
  - `src/api/queries.test.ts`: 10 passed
  - `src/api/ws-transport.test.ts`: 50 passed
  - `src/components/pages/SettingsPage.test.tsx`: 17 passed
- **Diagnostics:** Observed non-failing jsdom navigation warnings (`Not implemented: navigation`) during window navigation stubs.

### Check 4: Android Unit Tests
- **Historical Failure (Prior Attempt B):**
  - **Command:** `node scripts/run-gradle.mjs :shared:jvmTest --rerun-tasks --info`
  - **Exit Code:** 1; 926 tests completed, 925 passed, 1 failed
  - **Failed Check:** `HostResourceModelsTest[jvm] > testSseDataEventOverflowRejection[jvm]`
  - **Diagnostic:** `io.ktor.utils.io.charsets.TooLongLineException: Line exceeds limit of 262144 characters` at `HostResourceSseClient.kt:106`.
- **Pre-existing Working-Tree Change:**
  - Removed explicit `MAX_DATA_EVENT_BYTES` line parameter from `channel.readUTF8Line()` in `HostResourceSseClient.kt:106`, delegating oversize rejection to downstream `line.length > MAX_DATA_EVENT_BYTES`.
- **Standard Invocation:**
  - **Command:** `pnpm android:test` (`node scripts/run-gradle.mjs :shared:jvmTest`)
  - **Duration:** 0.65s
  - **Exit Code:** 0
  - **Status:** PASS (Cached: 8 tasks up-to-date)
- **Fresh Uncached Execution:**
  - **Command:** `node scripts/run-gradle.mjs :shared:jvmTest --rerun-tasks`
  - **Duration:** 40.98s
  - **Exit Code:** 0
  - **Status:** PASS
  - **Tasks:** 8 executed; 0 failed
  - **Key Observation:** `HostResourceModelsTest[jvm] > testSseDataEventOverflowRejection[jvm] PASSED`

### Check 5: Version Alignment
- **Command:** `node deploy/release/check-version-alignment.mjs`
- **Duration:** 0.12s
- **Exit Code:** 0
- **Status:** PASS
- **Observed Result:** `✓ Release version alignment verified: v0.15.6 (0.15.6)`.
- **Scope Limit:** Verifies parity between `server/Cargo.toml` and `apps/web/package.json` against resolved canonical SemVer `0.15.6`. Does not inspect remaining synchronized version manifests or compiled release bundles.

---

## 4. Surfaces Not Executed / Gates Unmet

The following gates are unverified by this targeted 5-command validation:
1. **Source-pinned P0 freeze artifact:** Tests ran on the active working tree, not an isolated frozen P0 artifact directory.
2. **Full Cargo suite:** Evaluated 4 targeted integration targets; full backend suite not executed.
3. **Web browser E2E:** Vitest jsdom unit suite executed; Playwright real-browser suite not run.
4. **Android application target:** Evaluated `:shared:jvmTest`; `:androidApp:testDebugUnitTest` and assemble tasks not run.
5. **Isolated server live probe:** Dedicated daemon probe for authenticated 404 responses and absence of collector listener on port 4811 not run.
6. **Documentation scrub audit & operator cleanup receipt:** Not verified.

---

## 5. Unresolved Questions & Risks

1. **SSE Resource-Bound Risk:** Removing `MAX_DATA_EVENT_BYTES` from `readUTF8Line()` causes lines to be read into memory before event-level length checking. While passing the 300,000-character test, unbounded line buffering poses a heap exhaustion risk against malicious or runaway streams. Should `HostResourceSseClient` catch `TooLongLineException` or stream chunked lines?
2. **Release Gating Scope:** Does Phase 03 P0 early release qualification require full 13-manifest alignment and `:androidApp:testDebugUnitTest` verification before release tagging?
