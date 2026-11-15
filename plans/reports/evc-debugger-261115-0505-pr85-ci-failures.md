# PR #85 CI failures — read-only investigation

## Summary

PR: https://github.com/loidinhm31/dam-hopper/pull/85. Latest head `e63c58961ac87aa55d024f25917daa40468090e4`; [run 43700528176](https://github.com/loidinhm31/dam-hopper/actions/runs/43700528176), attempt **1**.

**Current: 3 failed jobs, 9 passed. Two real failures share Chromium prerequisite timeout; third is aggregate gate. No current Rust compile/test or application assertion failure: those steps never ran.** Previous runs expose additional defects; latest prerequisite failure masks their validation.

Evidence: `gh pr checks 85`; complete branch run list (9 runs returned); `gh run view <id> --log-failed` for every failed run; latest E2E full log; canceled E2E full log; previous sanitized report artifact `14155349593`; local source and GitHub commit patches. No product edits, builds, tests, or smoke commands executed. Reproduction commands below are recommendations, not observed local results. Historical line numbers belong to indicated run revision; current equivalents explicitly identified.

## Current failing jobs

### 1. Application E2E journeys

- [Job 132770444301](https://github.com/loidinhm31/dam-hopper/actions/runs/43700528176/job/132770444301), step **7: Configure Playwright Chromium for backend host browser**.
- Exact fatal excerpt: `2026-11-15T09:43:28.9394255Z ##[error]Process completed with exit code 124.` Probe began 09:43:13; hit its explicit **15s** limit.
- Offending command: `.github/workflows/pr-quality-gate.yml:155`:
  ```bash
  timeout 15s "$CHROME_EXEC" --headless=new --no-first-run --no-default-browser-check --user-data-dir="$PROBE_DIR" --dump-dom about:blank >/dev/null
  ```
- Root cause established: selected Chromium does not finish the standalone headless probe before deadline; `bash -e -o pipefail` aborts **before** exporting `DAM_HOPPER_BROWSER_EXECUTABLE` (`:156`). Not a Playwright test timeout. Mongo prefetch, E2E typecheck/image build/test steps skipped.
- Classification: **CI/browser-environment incompatibility, now surfaced by new preflight in head commit**, not demonstrated application regression. Same browser startup symptom occurred before this probe existed. Exact browser-internal cause unresolved; logs do not establish deadlock or an AppArmor denial.
- Nonfatal-looking stderr, not proven causes: `Failed to connect to the bus: Could not parse server address: Unknown address type`, absent UPower service, `Registration response error message: DEPRECATED_ENDPOINT`. No sandbox fatal/error stack in this step.
- **P1 proposed fix:** repair browser provisioning/selection at workflow `:125–155`; prefer reproducible pinned Playwright browser over unversioned system Chrome, validate actual executable and sandbox/userns policy, capture selected/canonical executable, version, bounded probe stdout/stderr and AppArmor denial evidence. Verify CDP readiness with production-equivalent flags rather than equating `--dump-dom` process exit with host-browser readiness. Preserve bounded timeout and sandbox; do not suppress exit 124, add blind retries, or use `--no-sandbox`. Choosing bundled browser alone is a candidate fix, not proven sufficient.

### 2. Rust server - Linux

- [Job 132770444577](https://github.com/loidinhm31/dam-hopper/actions/runs/43700528176/job/132770444577), step **8: Configure Playwright Chromium for backend host browser**.
- Exact fatal excerpt: `2026-11-15T09:43:56.8060387Z ##[error]Process completed with exit code 124.` Probe began 09:43:41; same 15s deadline.
- Same code duplicated at `.github/workflows/pr-quality-gate.yml:209–240`; failing command **`:239`**, environment export `:240` never reached. Same root cause/classification/fix as E2E.
- Rust toolchain/cache, formatting, Clippy, and **Server tests all skipped**. Mongo container initialized successfully. Not a Rust source/compiler failure in latest run.

**Narrowest reproduction for both jobs** — same provisioned Ubuntu 24.04 image/browser/userns policy; set `CHROME_EXEC` to exact CI-selected executable:

```bash
PROBE_DIR="$(mktemp -d)"
trap 'rm -rf "$PROBE_DIR"' EXIT
timeout 15s "$CHROME_EXEC" --headless=new --no-first-run --no-default-browser-check \
  --user-data-dir="$PROBE_DIR" --dump-dom about:blank
```

CI installed **Chrome for Testing 149.0.7827.55, Playwright Chromium v1228**, but selection prefers `/usr/bin/google-chrome`; logs never print selected path/version. Therefore installed version is **not proof** of executed version. Runner image reports Ubuntu **24.04.5**. Both same-run jobs fail identically on separate workers: systematic prerequisite failure, not evidence of random suite flake.

### 3. Quality Gate

- [Job 132774131442](https://github.com/loidinhm31/dam-hopper/actions/runs/43700528176/job/132774131442), step **2: Require every quality job**.
- Exact: `A required quality job finished with: failure`; `Process completed with exit code 1.` Env: `APPLICATION_E2E: failure`, `SERVER_LINUX: failure`; other required results `success`.
- `.github/workflows/pr-quality-gate.yml:336–358`; expected fail-closed propagation, **not independent defect**. Fix upstream jobs, retain gate.
- Narrow reproduction: `APPLICATION_E2E=failure bash -c 'test "$APPLICATION_E2E" = success'` (exit 1).

## Run/retry history

All **seven failed runs inspected are attempt 1**: separate commits, not rerun attempts. No evidence that retrying identical head cured current issue. Last full green branch run: November 8.

| Run / UTC created / head | Failures |
| --- | --- |
| [43700528176](https://github.com/loidinhm31/dam-hopper/actions/runs/43700528176) / Nov 15 09:42 / `e63c589` | E2E + Linux browser setup timeout 124; gate. Windows now passes. |
| [43696497067](https://github.com/loidinhm31/dam-hopper/actions/runs/43696497067) / Nov 15 08:52 / `48d963b` | Linux Server tests; Windows Compile all server tests; E2E Run application E2E tests; gate. |
| [43693200744](https://github.com/loidinhm31/dam-hopper/actions/runs/43693200744) / Nov 15 08:09 / `ce4c725` | Linux Server tests; Windows Compile all server tests; E2E **canceled at job's 40m deadline**; gate. |
| [43678189682](https://github.com/loidinhm31/dam-hopper/actions/runs/43678189682) / Nov 15 04:46 / `589e8f6` | Linux Server tests; Windows Compile all server tests; E2E Run application E2E tests; gate. |
| [43648998774](https://github.com/loidinhm31/dam-hopper/actions/runs/43648998774) / Nov 14 22:36 / `953505a` | Lint workspace; Windows Compile all server tests; Linux Server tests; E2E Run application E2E tests; gate. |
| [42513930984](https://github.com/loidinhm31/dam-hopper/actions/runs/42513930984) / Nov 8 19:13 / `e7b71da` | Success. |
| [42509156716](https://github.com/loidinhm31/dam-hopper/actions/runs/42509156716) / Nov 8 18:16 / `7640442` | Chromium browser regressions: Run all UI browser tests; gate. |
| [42354016018](https://github.com/loidinhm31/dam-hopper/actions/runs/42354016018) / Nov 7 08:06 / `2300be7` | Success. |
| [42331116964](https://github.com/loidinhm31/dam-hopper/actions/runs/42331116964) / Nov 7 02:49 / `d39ee81` | E2E; Windows compile; Lint workspace; JS tests - ui: Run ui tests; gate. |

## Previous failing jobs: causes, offending source, repair/reproduction

### Rust server - Linux / Server tests

1. **`953505a`: 14 admission failures, environmental kernel prerequisite.** Exact: `supervisor watcher arming failed with errno 22 (Linux 6.9+ with pidfd process-group signalling is required)`. HTTP assertions receive 503 instead of 201/502; `browserSessionId` extraction also panics. `server/src/browser_host/process/death_watcher.rs:200` probes `PIDFD_SIGNAL_PROCESS_GROUP`; `process.rs:541–549` emits error. Not an admission race/deadlock. Use supported Linux kernel (6.9+), retain fail-closed containment. Later runs got past this prerequisite.
2. **`589e8f6`: audio receive timeout.** `tests/browser_host_media.rs:1569:14`: `first viewer attachment after initial navigation must receive PCM without a second navigation: Elapsed(())`. Current equivalent **`server/tests/browser_host_media.rs:1611–1653`**, receive at `:1646–1648`; zero-viewer navigation then viewer demand registration. `ce4c725` subsequently passed all 32 media tests (222.05s). **Intermittent/environment/timing candidate, not proven flaky or fixed**: different revisions, no identical-SHA retry. Investigate demand restart/audio document authority and real-engine scheduling in `server/src/browser_host/screencast.rs` (`register_viewer_demand`, `:1877`); only fix observed lifecycle/engine cause, not assertions or blind deadline increase.
3. **`ce4c725`: 2 platform assertions.** `tests/browser_host_platform.rs:102:9`: `Linux platform containment must be available when browser executable exists`; `:269:9`: `assertion failed: caps2.available`. Resolver accepted an existing executable without validating permissions; capabilities correctly reject unsafe file. `48d963b` patch adds permission validation, current `server/tests/browser_host_platform.rs:22–35`; assertions current `:105–109`, `:274–278`. `server/src/browser_host/config.rs:411–415,731–742` enforces permissions. **Test fixture/environment mismatch**, not failed reset cleanup. Repair present; browser setup now masks rerun.
4. **`48d963b`: 14 admission failures, Chromium startup timeout.** Exact `browser operation timed out: browser process failed to start within 15s` (`browserUnavailable`, 503), plus `browser launch: StartupTimeout(15s)`. Source boundaries: `server/src/browser_host/manager.rs:559–572`; `process.rs:594–609`, `discover_ws_endpoint` `:958` waits for stderr/DevToolsActivePort. Not enough evidence to attribute to CDP parser versus browser startup; standalone probe now fails without server at all, favoring environment/browser setup.

All 14 admission failure locations in `48d963b`, `server/tests/browser_host_admission.rs`:

| Test suffix (prefix `test_`) | Panic line |
| --- | --- |
| browser_crash_retires_all_sessions_and_new_incarnation_creates_fresh | 1199 |
| ambiguous_create_is_not_running_and_retry_reconciles_same_page | 1431 |
| concurrent_same_key_creates_publish_one_native_page_and_producer | 1366 |
| create_paused_before_publication_cannot_cross_reset | 1172 (`timed out waiting for native page of the paused create`) |
| create_paused_before_reservation_cannot_cross_reset | 1149 |
| failed_native_close_keeps_identity_and_delete_resumes | 1507 |
| idempotent_session_creation_retry_and_caps | 381 |
| lost_create_response_reconciles_without_duplicate_page | 1396 |
| native_pages_share_configured_cap_across_startup_rest_and_raw | 1216 |
| overflow_page_with_failed_close_stays_charged_until_proven_absent | 1309 |
| request_policy_blocks_forbidden_redirect_and_subresource_on_chromium | 946 |
| popup_admission_policy_and_overflow_share_capacity | 1875 |
| raw_page_destruction_retires_exact_session_and_ttl_reaps_history | 1199 |
| refused_create_is_not_running_and_same_key_retries_fresh | 1483 |

Narrow commands, after correct browser provisioning:

```bash
DAM_HOPPER_BROWSER_EXECUTABLE="$CHROME_EXEC" cargo test --manifest-path server/Cargo.toml \
  --test browser_host_admission test_idempotent_session_creation_retry_and_caps -- --exact --nocapture
DAM_HOPPER_BROWSER_EXECUTABLE="$CHROME_EXEC" cargo test --manifest-path server/Cargo.toml \
  --test browser_host_media test_real_chromium_media_stealth_and_pcm_audio_bridge -- --exact --nocapture
cargo test --manifest-path server/Cargo.toml --test browser_host_platform
```

`has been running for over 60 seconds` messages alone were **not deadlocks**: `ce4c725` media suite completed successfully; `48d963b` admission suite completed with 11 passed/14 failed after 291.47s. Repeated browser-start waits plus serialization explain long tests; no lock cycle established.

### Rust server - Windows / Compile all server tests

Deterministic **cross-platform compile regressions**, not flakes. Success at current head confirms current Windows gate recovered. Distinct historical errors:

| Revision | Exact error / historical file:line | Cause / current fix |
| --- | --- | --- |
| `953505a` | `E0425: cannot find function kill in crate libc`; `cannot find value SIGKILL in crate libc`; `tests/browser_host_admission.rs:1668:31,61` | Unix signal test compiled on Windows. Current test `server/tests/browser_host_admission.rs:1650` has `#[cfg(unix)]`; signal at `:1672`. |
| `589e8f6` | `E0599: no associated function or constant named from_mode found for struct Permissions`; `tests/browser_debug_artifacts.rs:899:57,907:57` | Unix permission helpers unguarded. Current helpers `server/tests/browser_debug_artifacts.rs:897–909` guarded Unix. |
| `ce4c725` | `E0433: cannot find unix in os`; `examples/browser_host_qualification/adaptive_media.rs:55:18`; `E0599: no method named mode found ... OpenOptions`, `:58:77` | Unix import/operation unguarded. Current writer `server/examples/browser_host_qualification/adaptive_media.rs:60–70` gates both. |
| `48d963b` | `E0432: unresolved import dam_hopper_server::browser_host::process::live_members`; `tests/browser_host_lifecycle.rs:708:9,822:9` | Function exists only Unix (`process.rs:796,838`); callers unguarded. Head patch adds `#[cfg(unix)]`, current tests `server/tests/browser_host_lifecycle.rs:706,821`. |
| `d39ee81` | `E0609: no field 0 on type ApiError`, `src/api/terminal.rs:862:78`; `E0063: missing fields ui and workspaces ... DamHopperConfig`, `src/config/tests.rs:635:18,697:18` | Stale test code after error/config API changes. Current `server/src/api/terminal.rs:878` formats error directly; config literals populate fields (`server/src/config/tests.rs:659–660,723–724`). Nov 7 subsequent run green. |

Narrow reproduction: **Windows** `cargo test --manifest-path server/Cargo.toml --test <browser_host_admission|browser_debug_artifacts|browser_host_lifecycle> --no-run`; example error: `cargo check --manifest-path server/Cargo.toml --example browser_host_qualification`; oldest lib errors: `cargo test --manifest-path server/Cargo.toml --lib --no-run`. Old errors require corresponding old revision; not expected on current head.

### Application E2E journeys / Run application E2E tests

- `953505a`: **12 failed / 27 did not run / 13 passed**. Two independent prerequisites: kernel `errno 22` above; exact `Config error: server.browser: unsafe browser executable permissions for '/usr/bin/google-chrome': file is world-writable (must be mode 0755 or more restrictive)`. Fixture boot `fixtures/host-browser-app.ts` and qualification `fixtures/browser-host-qualification.ts:527` propagate failures. Preserve security validation; provision a trusted non-world-writable binary, do not chmod arbitrary discovered binary or bypass sandbox.
- `589e8f6`: **13 failed / 29 did not run / 10 passed**. Browser-related tests repeatedly `StartupTimeout(15s)` or `Expected: 201 / Received: 503`; selection slot hidden; lifecycle canvas absent. `48d963b`: **13 failed / 28 did not run / 11 passed**, same startup failures, plus terminal issue below. Repeated infrastructure problem, not evidence each test is a separate product defect.
- `ce4c725`: E2E job **08:09:49–08:49:52 (40m03s)**, workflow `timeout-minutes: 40`. Test step began 08:30:51; canceled 08:49:49: `Process completed with exit code 1`, `The operation was canceled.` Prebuild/setup consumed ~21m; tests then ~19m. **Job deadline, not proven deadlock**. Fix startup/provisioning and account for legitimate image build time; do not call cancellation a passed/failed assertion run.

Repeated browser-related failing specs (paths below relative `packages/ui/e2e/`; line numbers `48d963b`):

- `os-host-browser/agent.spec.ts:78`, `compatibility.spec.ts:100` → qualification process `StartupTimeout(15s)`, fixture `browser-host-qualification.ts:527`.
- `os-host-browser/android.spec.ts:37`, `performance.spec.ts:35`, `same-target.spec.ts:30`, `os-lifecycle/host-browser.spec.ts:136` → expected 201, got 503.
- `os-host-browser/navigation.spec.ts:44,150`, `tabs-recovery.spec.ts:12`, `tabs-session.spec.ts:18`, `tabs-visual.spec.ts:36` → same 503 through `fixtures/host-browser-journey-driver.ts:116`.
- `os-host-browser/selection.spec.ts:522` → `[data-os-browser-slot]` first hidden, 15000ms. Earlier `589e8f6` lifecycle `os-lifecycle/host-browser.spec.ts:20` → canvas locator absent. **Likely downstream startup symptoms [INFERENCE]**, no independent UI cause proven.

Separate **terminal** failure, not browser startup:

- `589e8f6`: `os-session-management/os-session-management.spec.ts:129`: expected terminal text `41`, received `TerminalsTile_□✕ ...`, 10000ms.
- `48d963b`: same test `:132`: `Expected: true / Received: false`, `Timeout 15000ms exceeded while waiting on the predicate`; waits for `terminal-panel / buffer_replay_complete` diagnostic. Current file `packages/ui/e2e/os-session-management/os-session-management.spec.ts:120–143` waits replay before byte oracle.
- Head patch changes default workspace terminal requests in `packages/ui/src/os/OsShell.tsx`, `os/apps/TerminalsApp.tsx`, `os/agent-hub/use-hub-terminal-launch.ts`, shared `os/terminal-launch-lifecycle.ts:33–77`: generic launches omit explicit workspace target/cwd, permitting server default CWD when no workspace root. **Source-supported likely cause [INFERENCE]** of no usable terminal; logs/artifact do not include terminal create response, so not definitive. Fix already present; current E2E never reached test, **not validated by latest run**. Do not weaken replay/byte oracle assertions.

Narrow reproductions (Docker available; E2E runtime images built with `pnpm --filter @dam-hopper/ui test:e2e:build-images`):

```bash
DAM_HOPPER_BROWSER_EXECUTABLE="$CHROME_EXEC" pnpm --filter @dam-hopper/ui test:e2e \
  e2e/os-host-browser/android.spec.ts --project=chromium --workers=1
pnpm --filter @dam-hopper/ui test:e2e \
  e2e/os-session-management/os-session-management.spec.ts --project=chromium \
  --grep 'physical PTY byte oracle' --workers=1
```

Oldest E2E (`d39ee81`): `os-cutover/os-cutover.spec.ts:55` expected `[data-os-agent-hub]`, absent after Hub redesign. **Stale selector/test contract regression**, subsequent patch/current `packages/ui/e2e/os-cutover/os-cutover.spec.ts:55–56` uses `[data-testid="agent-hub-app"]`; Nov 7 full green. Narrow: `pnpm --filter @dam-hopper/ui test:e2e e2e/os-cutover/os-cutover.spec.ts --grep 'root cutover' --workers=1`.

### Lint, typecheck, and frontend builds / Lint workspace

- `953505a`: `packages/ui/browser-tests/host-browser-input.browser.tsx:51:8,52:56,110:50` → **`Error: Cannot access refs during render`**, `react-hooks/refs`; `410 problems (3 errors, 407 warnings)`, exit 1. Render initialized/read `controllerRef.current`, passed it into `TextInputProxy`. Deterministic fixture regression, not 407 warnings causing failure. Current `:52–76` constructs controller in layout effect and exposes state to render. Proposed repair already present; lint passes latest.
- `d39ee81`: `packages/ui/src/os/LockScreenOverlay.tsx:73:45,74:43,75:42` → **`Error: Cannot access variable before it is declared`**, `react-hooks/immutability`, referencing `onTrailingKeyDown`, `onTrailingKeyUp`, `onTrailingBlur` before declarations in mutually dependent callbacks. Current `:63,72–78` cleanup ref breaks forward dependency. Subsequent green; not current blocker.
- Narrow: `pnpm --filter @dam-hopper/ui exec eslint browser-tests/host-browser-input.browser.tsx src/os/LockScreenOverlay.tsx`.

### Chromium browser regressions / Run all UI browser tests (`7640442`, Nov 8)

**3 failures / 355 passed**, 2 files:

1. `packages/ui/browser-tests/explorer-image-preview.browser.tsx:134`: `expected { …(3) } to deeply equal { …(3) }`; expected target `{kind:"project",project:"demo"}`, received `{type:"project",project:"demo"}`. Stale wire DTO assertion. Fix/current `:135` uses `type`.
2. `packages/ui/browser-tests/terminal-traditional-projects.browser.tsx:1713:7`: `Cannot find element with locator: getByRole('tab', { name: /alpha.*Renamed server A/ })`. Profile name moved to section header; stale accessible-name selector. Subsequent patch/current `:1711–1720` scopes tabs under renamed profile section instead.
3. Same file historical `:2000`: `expected 326.8125 to be less than or equal to 324` at 320px. **Actual layout overflow**, not permission/network flake. Subsequent patch adds `min-w-0`, bounded/shrinking mobile layout in `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx`, `TraditionalTerminalProjectWorkspaceRow.tsx`, `TraditionalTerminalProjectsDisplay.tsx`; waits dialog animation before geometry assertion (current test `:2002–2015`). Both layout/measurement stability repaired; Nov 8 next run and latest browser job pass.

Narrow: `pnpm --filter @dam-hopper/ui test:browser browser-tests/explorer-image-preview.browser.tsx browser-tests/terminal-traditional-projects.browser.tsx`.

### JS tests - ui / Run ui tests (`d39ee81`, Nov 7)

One failure/3620 passed: `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx:1476`: `AssertionError: expected null not to be null`; queried `button[aria-label="Collapse demo files"]`. Test supplied active project, where files are already shown and no old disclosure button exists. **Stale fixture/UI contract**, subsequent patch tests disclosure of inactive project with actual treeitem contract; Nov 7 next run and latest JS UI pass. Narrow: `pnpm --filter @dam-hopper/ui test src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx`.

Every historical **Quality Gate / Require every quality job** failure is downstream aggregation (`failure`, or `cancelled` in `ce4c725`), not additional root cause. Other stderr in passing test bodies (e.g. intentional listener crash, jsdom navigation unsupported, missing-provider logging) not counted as failed tests without failure summary.

## Unresolved questions

1. Which executable/version actually ran latest, and why did its headless probe hang? Selected path, AppArmor audit denials, process stacks, stdout discarded; no definitive browser-internal root cause. AppArmor/userns attachment mismatch, browser build behavior, and runner services remain hypotheses—not established diagnoses.
2. Does head's workspace-default terminal fix restore actual replay and physical PTY oracle? Latest E2E prerequisite prevents observation; old artifacts lack terminal create response.
3. Is the isolated PCM attach timeout engine/scheduling flake or remaining demand-restart defect? One failure then later-revision success; no identical-revision retry proof.
