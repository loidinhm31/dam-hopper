# Windows Test Report — dam-hopper-server

Date: 2026-09-19
Target: Windows 11 Pro x64 (`win32 10.0.26200`)
Toolchain: `cargo 1.96.0 (30a34c682 2026-05-25)`, `pnpm 10.28.2`

## Test Results Overview

| Area | Command / scenario | Result |
|---|---|---|
| Compile check | `cargo check --manifest-path server/Cargo.toml --all-targets` | PASS; zero errors |
| Binary build | `cargo build --manifest-path server/Cargo.toml --bins` | PASS; zero errors |
| Release CLI stub | `cargo run --manifest-path server/Cargo.toml --bin dam-hopper` | PASS; exits 1 with informative Linux-only message |
| Idle-suspend helper stub | `cargo run --manifest-path server/Cargo.toml --bin dam-hopper-idle-suspend-helper` | PASS; exits 1 with informative Linux-only message |
| Server startup | `pnpm run dev:server:no-auth` | PASS; bound to `0.0.0.0:4803` |
| Server health smoke | `GET http://127.0.0.1:4803/api/health` | PASS; HTTP 200 and valid JSON |
| Targeted tests | 5 requested commands | PASS; 127 passed, 2 ignored, 0 failed |

No test failures. No compile errors. Warnings are non-blocking unused/dead-code warnings caused by Linux-only implementations not being used on Windows and existing platform branches.

## Compile and Build Verification

### All targets check

Command:

```text
cargo check --manifest-path server/Cargo.toml --all-targets
```

Result: PASS (exit 0). Cargo completed library, binary, example, and test-target checking with zero errors. Warnings included unused Linux activity constants/types and existing platform-specific unused imports/variables; no warning was promoted to an error.

### Binary build

Command:

```text
cargo build --manifest-path server/Cargo.toml --bins
```

Result: PASS (exit 0). All declared binaries compiled, including:

- `dam-hopper-server`
- `dam-hopper`
- `dam-hopper-web`
- `dam-hopper-idle-suspend-helper`

## Non-Linux Binary Stub Behavior

### `dam-hopper`

Command:

```text
cargo run --quiet --manifest-path server/Cargo.toml --bin dam-hopper
```

Observed final message:

```text
dam-hopper release management is only supported on Linux with systemd.
```

Observed exit status: `1` (non-zero, expected).

### `dam-hopper-idle-suspend-helper`

Command:

```text
cargo run --quiet --manifest-path server/Cargo.toml --bin dam-hopper-idle-suspend-helper
```

Observed final message:

```text
dam-hopper-idle-suspend-helper is only supported on Linux with systemd.
```

Observed exit status: `1` (non-zero, expected).

Neither stub attempted to parse Linux CLI commands, bind a Unix listener, access systemd, or claim suspend capability.

## Server Startup Smoke Test

Command executed through Windows `cmd.exe` (required because `pnpm` resolves to a `.cmd` launcher):

```text
pnpm run dev:server:no-auth
```

The script ran its configured command:

```text
(cd server && cargo run --bin dam-hopper-server -- --host 0.0.0.0 --port 4803 --no-auth) 2>&1 | tee logs.txt
```

Observed startup output:

```text
Server started
Open: http://0.0.0.0:4803
Listening addr=0.0.0.0:4803
```

Observed health probe:

```text
GET /api/health
HTTP/1.1 200 OK
{"schemaVersion":1,"status":"ok","version":"0.4.0","role":"api"}
```

The server process was then stopped intentionally after readiness and health verification; the supervisor reported exit status 1 for the intentional stop, not a startup/runtime failure.

## Targeted Test Execution

All commands used `RUSTFLAGS="-C debuginfo=0"` as requested.

### `linux_release` library facade

```text
RUSTFLAGS="-C debuginfo=0" cargo test --manifest-path server/Cargo.toml --lib linux_release
```

Result: **7 passed, 0 failed, 849 filtered out**, 0.00s.

Validated version validators and Windows facade contracts:

- release/tag/commit/SHA validators
- `TargetRole` serde behavior
- `HostPublicConfig::new` validation

### `idle_suspend` library subsystem

```text
RUSTFLAGS="-C debuginfo=0" cargo test --manifest-path server/Cargo.toml --lib idle_suspend
```

Result: **93 passed, 0 failed, 763 filtered out**, 0.47s.

Covered timing persistence, policy transitions, unavailable executor behavior, protocol validation, force-suspend guards, audit behavior, status/API behavior, and Windows pre-provisioned audit behavior.

### `linux_release_web_host` integration suite

```text
RUSTFLAGS="-C debuginfo=0" cargo test --manifest-path server/Cargo.toml --test linux_release_web_host
```

Result: **8 passed, 0 failed**, 0.17s.

Covered health GET/HEAD, runtime config presence/absence, reserved namespace handling, static file/cache headers, SPA fallback, method rejection, traversal/symlink protection, and web-host lifecycle.

### `idle_suspend` integration suite

```text
RUSTFLAGS="-C debuginfo=0" cargo test --manifest-path server/Cargo.toml --test idle_suspend
```

Result: **17 passed, 0 failed, 2 ignored**, 0.57s.

The two ignored tests are explicitly Linux live PTY/TCP smoke tests. They remain ignored on Windows rather than being weakened or rewritten.

### `idle_suspend_phase07` integration suite

```text
RUSTFLAGS="-C debuginfo=0" cargo test --manifest-path server/Cargo.toml --test idle_suspend_phase07
```

Result: **2 passed, 0 failed**, 0.40s.

Validated cross-layer automatic/manual idle-suspend chains, audit correlation, and rejection paths.

### Aggregate targeted totals

- Passed: **127**
- Failed: **0**
- Ignored: **2**
- Filtered out: **1,612** (library command filters)
- Test execution time: approximately **1.61s** across reported suites (excluding compilation)

## Linux Preservation and Target Gates

Static source verification performed in the Windows checkout:

1. `server/src/lib.rs` selects the complete `linux_release` implementation only under `#[cfg(target_os = "linux")]`; non-Linux selects `linux_release_non_linux.rs` through a path override.
2. `server/src/idle_suspend/activity/mod.rs` gates `process`, `netlink`, and `tcp` module declarations with `#[cfg(target_os = "linux")]`; portable sampler contracts remain available.
3. `server/src/idle_suspend/activity/sampler.rs` gates Linux worker/source imports, worker state, production sampler, and Linux `Drop`; the non-Linux sampler is a separate fallback implementation.
4. `server/src/main.rs` selects the Linux helper executor only under `#[cfg(target_os = "linux")]` and `UnavailableExecutor` under `#[cfg(not(target_os = "linux"))]`.
5. `server/src/bin/dam-hopper.rs` gates Linux imports, async main, and persistence helper; its non-Linux main is an explicit exit-1 stub.
6. `server/src/bin/dam-hopper-idle-suspend-helper.rs` gates Linux imports/CLI/async main; its non-Linux main is an explicit exit-1 stub.
7. Linux-only event identity (`/proc/sys/kernel/random/boot_id`), peer credential, process, netlink, socket, and live-kernel test paths have target gates. Windows uses the documented unavailable/fail-closed paths.
8. Linux-specific integration tests remain target-gated or explicitly skipped on non-Linux. The two ignored live Linux tests in `tests/idle_suspend.rs` were not enabled on Windows.
9. `git diff --name-only -- server/src/linux_release server/src/idle_suspend/activity/process.rs server/src/idle_suspend/activity/netlink.rs server/src/idle_suspend/activity/tcp.rs` produced no output. The Linux release module and Linux process/netlink/socket implementations therefore have no working-tree modifications in this verification checkout.

## Coverage Metrics

No coverage tool was configured or invoked for this Windows compile/qualification run. The requested targeted suites executed successfully; coverage percentages are therefore not reported rather than estimated.

## Performance Metrics

- `cargo check --all-targets`: completed successfully (incremental check; tool output elapsed approximately 0.64s).
- `cargo build --bins`: completed successfully; full dependency build output elapsed approximately 130s.
- Targeted test execution: approximately 1.54s after compilation.
- No timeout, hang, or resource exhaustion observed.

## Build Status and Warnings

Build status: **PASS**.

Non-blocking warnings observed:

- unused imports/variables in existing cross-platform telemetry/tunnel code;
- dead-code warnings for Linux-only idle-suspend activity symbols on Windows;
- unused test hooks and Linux-only test helpers under target filtering.

No warning indicated a failed platform boundary, and no warning stopped compilation or test execution.

## Critical Issues

None blocking acceptance criteria.

## Recommendations

1. Keep Linux live-kernel tests target-gated as currently implemented; do not make them run on Windows with fake process/socket data.
2. Optionally reduce Windows warning noise by adding narrowly scoped `#[allow(dead_code)]`/conditional imports only where the project policy permits; not required for this fix.
3. Add a Windows CI job running the exact check/build/stub/targeted-test commands to prevent regressions in target gates.

## Unresolved Questions

None.
