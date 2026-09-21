# CI Lockfile Fix Verification Report

- Date: 2026-09-20
- Scope: pnpm lockfile and Cargo lockfile resolution after CI failures
- Environment: Windows x64; pnpm 10.28.2; stable Rust MSVC toolchain

## Test Results Overview

| Check | Result | Evidence |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS | Lockfile up to date; resolution skipped; 11 packages reused/installed; no 404 |
| `cargo check --manifest-path server/Cargo.toml` | PASS | Dependency resolution and server library compile completed; only warnings |
| `cargo check --manifest-path apps/native/src-tauri/Cargo.toml` | BLOCKED by source compile errors | Lock resolution completed; no corrupted crate/version error. Current source has 21 `ssh_forward/manager.rs` errors after delimiter repair |
| `cargo tree --manifest-path apps/native/src-tauri/Cargo.toml --locked --depth 1` | PASS | Native lockfile resolves all direct dependencies, including Tauri, time, windows, windows-sys, russh |
| `cargo tree --manifest-path server/Cargo.toml --locked --depth 1` | PASS | Server lockfile resolves all direct dependencies, including axum-extra, dirs, sysinfo, windows-sys |
| `pnpm lint` | FAIL | 6 React Compiler errors, 96 warnings; errors in `use-aggregated-projects.ts` and `use-aggregated-terminal-sessions.ts` manual `useMemo` dependency preservation |
| `pnpm test` | FAIL (environment) | Rust test build reached linking/metadata, then Windows paging-file exhaustion: os error 1455, LNK1102, OOM |
| `pnpm --filter @dam-hopper/ui test` | PASS | 263 files; 1,843 tests passed; 0 failed; 23.06s |
| `pnpm build` | PASS | Confirmed by parent-agent validation |

## Lockfile Findings

- pnpm frozen install no longer requests `json-schema-traverse-0.4.2.tgz`; no `ERR_PNPM_FETCH_404`.
- Server `Cargo.lock` contains corrected versions: `headers 0.4.1`, `dirs-sys 0.4.1`, `rustc_version 0.4.1`, `windows-result 0.4.1`; `cargo check` and locked dependency tree both resolve.
- Native `Cargo.lock` contains corrected versions: `heck 0.4.1`, `jni-sys 0.4.1`, `jni-sys-macros 0.4.1`, `rustc_version 0.4.1`, `windows-result 0.4.1`; locked dependency tree resolves cleanly.
- No dependency-resolution error for the previously corrupted `headers = ^0.4.0` requirement.

## Failed Checks

### Native Cargo check

After the unrelated missing test/impl delimiters were repaired, native compilation exposed 21 source errors in `apps/native/src-tauri/src/ssh_forward/manager.rs`, including missing `ScopeHandle`/`ScopeContextInput`, missing `WireCounter::ONE`, missing `partition_auto_start_candidates`/`connect_internal`, duplicate `auto_start_scope`, and stale `ActivationIntent` fields. These occur after Cargo successfully resolves the corrected lockfile and are not lockfile failures.

### Workspace lint

`pnpm lint` reports six blocking React Compiler errors (three in each hook) for manual memoization dependencies that do not match inferred dependencies:

- `packages/ui/src/hooks/use-aggregated-projects.ts:92`
- `packages/ui/src/hooks/use-aggregated-terminal-sessions.ts:79`

The command also reports 96 warnings. These are unrelated to package-manager or Cargo lockfile resolution.

### Workspace test

`pnpm test` (`cd server && cargo test`) was unable to finish because concurrent Rust artifact generation exhausted the Windows paging file. Representative errors: `failed to mmap ... os error 1455`, `rustc-LLVM ERROR: out of memory`, and `LINK : fatal error LNK1102: out of memory`. The focused UI suite passes independently.

## Coverage Metrics

Coverage report not generated. No coverage script was required for this lockfile-resolution verification; UI Vitest run reported test counts only.

## Performance

- Frozen pnpm install: 1.1s command time.
- Server Cargo check: 52.23s command time.
- Native Cargo check (through source diagnostics): 8.67s after cached dependencies.
- Locked Cargo tree checks: under 1s each.
- UI Vitest suite: 23.06s reported duration, 24.28s wall time.
- Workspace Rust test attempt: 95.07s wall time before environment resource failure.

## Build Status

- pnpm frozen dependency installation: PASS.
- Server Cargo dependency resolution/build: PASS, warnings only.
- Native Cargo dependency resolution: PASS; full compile blocked by unrelated source errors.
- Web/workspace pnpm build: PASS (parent-agent validation).
- Lint: FAIL on existing React Compiler memoization diagnostics.
- Full server test command: BLOCKED by Windows paging-file/OOM resource exhaustion.

## Critical Issues

1. Lockfile corruption is fixed and both pnpm and Cargo dependency graphs resolve without the previous nonexistent `0.4.2` package/crate failures.
2. Native full `cargo check` remains non-green due unrelated `ssh_forward/manager.rs` source errors.
3. `pnpm lint` remains non-green due six React Compiler errors.
4. Full Rust test run requires lower build parallelism or additional Windows pagefile capacity; failure was environmental, not a test assertion failure.

## Recommendations / Next Steps

1. Fix the native `ssh_forward/manager.rs` compile errors, then rerun `cargo check --manifest-path apps/native/src-tauri/Cargo.toml`.
2. Align `useMemo` dependency arrays with inferred dependencies in the two UI hooks, then rerun `pnpm lint`.
3. Rerun `pnpm test` with serialized Cargo compilation (`CARGO_BUILD_JOBS=1`) or a larger Windows paging file.
4. Keep lockfile edits generated by pnpm/Cargo rather than global version replacement.

## Unresolved Questions

- Whether the native manager and UI lint failures are already assigned to separate source-change owners.
- Whether CI Windows runners have sufficient pagefile capacity for the full Rust test matrix.
