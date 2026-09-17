# Phase 09 Integration and Qualification Report

**Report:** `tester-260917-2156-phase09-integration-qualification`
**Environment:** Linux x86_64 (Fedora 44, kernel `7.1.10-200.fc44.x86_64`), Chromium headless/browser fallback
**Scope:** Phase 09 qualification commands, dual-server live harness, web/native package checks, builds, lint, coverage attempt, and gate audit.

## Executive status

- **Real dual-server live qualification:** PASS. Server A/B healthy on ports `14801`/`14802`; S01–S12 completed; harness reported `24/24` assertions; cleanup succeeded.
- **G1-Web:** NOT QUALIFIED pending caller/transport audit. Current runtime source still exposes and uses ambient `api`/transport fallbacks and legacy singleton exports described as removed by the Phase 01 G1 contract.
- **G2-Web:** NOT QUALIFIED. Required parallel Rust command aborts with an IO-safety `SIGABRT` (exit `101`), although web/browser/shared/bridge checks and live S01–S12 pass.
- **Native Linux status:** PASS for Linux-only checks run here. Native Vitest `48/48`, Tauri Cargo `47/47`, and native build pass. This does not qualify Windows S13.
- **G2-Native / S13:** BLOCKED. Windows-only SSH/WebView2/DPAPI evidence was not executable on this Linux runner; Linux evidence cannot substitute for the Windows gate.

## Test results

| Command | Result | Observed result | Wall time |
|---|---|---:|---:|
| `node scripts/qualify-phase09-workbench.mjs` | PASS | Dual servers; S01–S12 `24/24`; embedded live browser tests: 2 files, 4 tests passed | 10.60s |
| `pnpm --filter @dam-hopper/ui test` | PASS | 251 files; 1,769 tests passed | 11.69s |
| `pnpm --filter @dam-hopper/ui test:browser` | PASS | 40 files passed, 2 skipped; 209 tests passed, 4 skipped | 40.80s |
| `cargo test --manifest-path server/Cargo.toml` | **FAIL** | 1,129 lib tests discovered; 1,120 `ok`, 1 ignored, 8 not reported; no assertion failures reported before process abort; fatal `IO Safety violation: owned file descriptor already closed`, `SIGABRT`, exit 101 | 24.37s |
| `pnpm --filter @dam-hopper/shared test` | PASS | 2 files; 15 tests passed | 0.72s |
| `pnpm --filter @dam-hopper/browser-bridge test` | PASS | 5 files; 19 tests passed | 1.09s |
| `pnpm --filter @dam-hopper/native test` | PASS | 4 files; 48 tests passed | 2.38s |

The Rust failure reproduced on a second run with the same command. The command aborts during the lib target after the PTY tests begin; it does not emit the normal Cargo summary. No assertion-level `FAILED` rows were reported, but process-level abort makes the required command a failure.

### Diagnostic serialized Rust run

`cargo test --manifest-path server/Cargo.toml -- --test-threads=1` passed as a diagnostic only: 39 targets, 1,416 passed, 0 failed, 5 ignored, 102.16s wall time. This does **not** convert the required default/parallel command to PASS; it indicates the IO-safety abort is coupled to the default test execution mode or a concurrency-sensitive resource lifecycle.

### Native Linux Cargo

Additional Linux-native check:

`cargo test --manifest-path apps/native/src-tauri/Cargo.toml` — PASS; 47 tests passed, 0 failed, 0 ignored (4 targets), 4.27s wall time.

Compiler warnings were emitted for unused parameters/arguments and a dead-code error variant; no test failures. Native Vitest also printed the expected informational line `native-ssh-forward smoke: evidence validation is Windows-only` repeatedly.

## Build and lint verification

| Command | Result | Notes | Wall time |
|---|---|---|---:|
| `pnpm build` | PASS | Web Vite production build; extension staging/prebuild completed | 31.97s |
| `pnpm build:extension` | PASS | Extension Vite build completed | 0.68s |
| `pnpm --filter @dam-hopper/native build` | PASS | Browser bridge build, native TypeScript, and native Vite build completed | 39.25s |
| `pnpm --filter @dam-hopper/ui build` | PASS | UI TypeScript build completed | 6.47s |
| `pnpm lint` | PASS with warnings | Exit 0; **0 errors, 66 warnings** | 15.57s |

Native Vite emitted an informational xterm request-mode patch message, not an error. Lint warnings include unused values/imports, React hook dependency warnings, and React set-state-in-effect warnings.

## Coverage

Numeric coverage unavailable. Attempted:

`pnpm --filter @dam-hopper/ui exec vitest run --coverage`

The run stopped before tests with `MISSING DEPENDENCY Cannot find dependency '@vitest/coverage-v8'` (exit 1, 0.56s). No coverage report or line/branch/function percentages were generated. No package-level coverage script/provider was available in the inspected manifests.

## Gate assessment

### G1-Web — NOT QUALIFIED / conditional

The Phase 01 G1 contract requires all shipped web callers to use explicit profile ownership and removal of singleton `initTransport`, `getTransport`/ambient delegation, `reconfigureTransport`, `reinitializeTransport`, global generation, and `profileScopedQueryKeyHash` compatibility paths. Static audit of current runtime source found remaining examples, including:

- `packages/ui/src/api/client.ts`: default `createApiClient` transport and exported ambient `api` delegate through `getTransport()`.
- `packages/ui/src/api/transport.ts`: exported singleton `initTransport`, `getTransport`, and `reconfigureTransport`.
- `packages/ui/src/api/transport-utils.ts`: legacy `reinitializeTransport` export.
- Runtime callers in `TopNav`, `DashboardPage`, `WorkspacePage`, `use-command-search`, `use-terminal-manager`, `settings`, workflow/query modules, ticket modules, and transport-using hooks/components.
- `packages/ui/src/api/query-client.ts`: exported `profileScopedQueryKeyHash` compatibility path.

Some uses may be test/bootstrap-only, but the audit found runtime imports/fallbacks and therefore cannot independently certify G1 from passing tests/builds. Resolve intent and complete the clean caller migration or document a revised contract before marking G1 qualified.

### G2-Web — NOT QUALIFIED

Positive evidence: real dual-server S01–S12 harness `24/24`, direct UI unit/browser suites pass, shared/browser-bridge/native package tests pass, and web/extension/native/UI builds pass. Blocking evidence: the required `cargo test --manifest-path server/Cargo.toml` command exits `101` with a fatal IO-safety abort. G2-Web therefore remains unqualified until the exact required backend command passes and G1 ownership audit is resolved.

### Native Linux — PASS (Linux scope only)

- Native package Vitest: `48/48`.
- Native Tauri Cargo: `47/47`.
- Native package build: PASS.
- No Linux assertion failures observed.

This is Linux qualification evidence only; it does not provide Windows S13 evidence.

### Real dual-server live qualification — PASS

The harness created isolated Server A/B instances, confirmed both healthy/listening (`14801`, `14802`), ran S01–S12 against the live setup, ran embedded Chromium browser checks against Server A, reported `24/24`, and cleaned up both servers.

### G2-Native / S13 — BLOCKED

S13 requires Windows-specific SSH-forward scope isolation, equal-ID/different-port behavior, teardown, WebView2/native bridge behavior, and DPAPI persistence. No Windows runner or disposable Windows SSH endpoints were available. Linux native results cannot replace this gate.

## Failed checks and diagnostics

1. **Required Rust suite:** process abort, not an assertion failure:
   `fatal runtime error: IO Safety violation: owned file descriptor already closed, aborting`;
   exit 101 / signal 6. Reproduced twice.
2. **Coverage invocation:** missing `@vitest/coverage-v8`; no tests started.
3. **Nonfatal UI test diagnostics:** two jsdom `Error: Not implemented: navigation (except hash changes)` messages; suite still passed.
4. **Lint:** 66 warnings, 0 errors; command exit 0.

## Performance observations

- Live harness: 10.60s.
- Direct UI browser suite: 40.80s (Vitest-reported 39.86s).
- UI unit suite: 11.69s (Vitest-reported 11.07s).
- Default Rust suite abort: 24.37s; serialized diagnostic pass: 102.16s.
- Native Cargo: 4.27s; native Vitest: 2.38s.

No dedicated memory/leak benchmark was requested or present in the executed qualification commands.

## Recommendations

1. Fix the Rust owned-file-descriptor lifecycle/concurrency abort, then rerun the exact default `cargo test --manifest-path server/Cargo.toml` command; retain serialized execution only as diagnosis, not as gate evidence.
2. Complete a G1 caller audit: migrate runtime consumers to explicit profile-owned clients/transports and remove obsolete ambient/singleton exports and compatibility fallbacks required by the Phase 01 contract; rerun focused and full checks.
3. Add/install the repository-approved `@vitest/coverage-v8` provider (or document that coverage is out of gate scope), then generate numeric line/branch/function coverage.
4. Run S13 on a Windows runner with disposable SSH endpoints and capture the required scope, teardown, WebView2, and DPAPI evidence.
5. Triage the 66 lint warnings and the jsdom navigation diagnostics; neither currently fails the command, but both reduce signal quality.

## Unresolved questions

1. Is default parallel Rust test execution a supported release-gate mode, and which owner will fix the double-close/owned-FD lifecycle?
2. Are the remaining runtime ambient `api`/transport paths intentionally retained, or must they be removed to satisfy the stated G1 contract?
3. Which Windows runner and disposable SSH endpoints will provide S13 evidence?
4. Is numeric coverage required for the Phase 09 release gate, and which coverage provider/version is approved?
