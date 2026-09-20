# Phase 03 — Server build, verification, and documentation

## Context links

- Parent: [plan.md](./plan.md)
- Dependencies: [Phase 01](./phase-01-path-and-config-normalization.md), [Phase 02](./phase-02-test-harness-and-platform-gating.md)
- Build diagnosis: [Windows compiler report](../reports/debugger-260919-2248-windows-build-errors.md)
- Existing targeted proof: [Windows test report](../reports/tester-260919-2248-windows-test-report.md)
- Review findings: [Windows code review](../reports/code-reviewer-260919-2248-windows-fix-review.md)
- Architecture: [system architecture](../../docs/system-architecture.md)
- Existing user guidance: [README development commands](../../README.md:124-164), [configuration guide](../../docs/configuration-guide.md:18-24,1100-1124), [API terminal contract](../../docs/api-reference.md:1696-1721)

## Overview

**Priority:** P1  
**Status:** DONE (2026-09-20 18:40:00 +07:00; 100%)  
**Goal:** Make `cargo run` select the server binary, prove the full Windows Rust unit/integration surface, smoke-test a live server over loopback, and publish an honest Windows runbook.

The manifest declares `dam-hopper-server` at `server/Cargo.toml:18-20` but has no `default-run`. Add `default-run = "dam-hopper-server"` under `[package]`. The prior targeted report proves `cargo check --all-targets`, `cargo build --bins`, both non-Linux stubs, startup, and 127 passed/2 ignored targeted tests; this phase upgrades that evidence to a full serial Windows test/build/startup record.

## Key Insights

- `cargo check --manifest-path server/Cargo.toml --all-targets` and `cargo build --manifest-path server/Cargo.toml --bins` are the first compile gates. The original failure was 180 errors in Linux-only modules; current target gates reduced that to zero compile errors.
- `cargo test` on Windows should run with one job (`-j 1`) to avoid MSVC rlib/page-file exhaustion. Linux-only tests must be filtered by cfg, not counted as Windows failures or replaced with fake host probes.
- `dam-hopper` and `dam-hopper-idle-suspend-helper` remain declared binaries and intentionally exit non-zero with clear Linux-only messages on Windows. `dam-hopper-server` remains the default binary.
- The no-auth smoke is development-only. Bind it to `127.0.0.1`, use an isolated temporary config, probe `/api/health`, then terminate and clean up the process/token/config.
- `package.json:16-17` currently uses a direct Cargo command without the previously reported `tee logs.txt` pipeline. Keep it free of Bash-only logging syntax; do not create scratch logs.
- Documentation must distinguish Windows evidence from Linux production diagnostics and from unsupported future Windows host-suspend/activity implementations.

## Requirements

### Functional

1. Add `default-run = "dam-hopper-server"` to `server/Cargo.toml` without removing or renaming any declared binary.
2. Confirm direct `cargo run --manifest-path server/Cargo.toml -- --help` resolves `dam-hopper-server`; explicit `--bin` scripts remain valid.
3. Build/check all server targets and binaries on Windows MSVC.
4. Execute the full available Windows unit and integration suite serially after Phase 02 gates. Record passed, failed, ignored, and filtered counts.
5. Verify non-Linux release/helper stubs exit 1 with stable explanatory stderr and never bind Linux transports.
6. Start a real server on loopback with `--no-auth`, receive HTTP 200 from `/api/health`, validate JSON, and shut it down cleanly.
7. Document Windows prerequisites, command forms, path/TOML behavior, PTY cmd.exe semantics, unsupported Linux-only features, and evidence boundaries.

### Non-functional

- No API/serde/protocol/schema changes.
- No new dependency, CI service, Windows systemd substitute, or native idle-suspend implementation.
- Verification commands work from PowerShell and ordinary `cmd.exe`/pnpm launchers; avoid Bash-only syntax.
- No secrets, persistent config, generated logs, or target artifacts committed.

## Architecture

```text
Cargo.toml default-run
        |
        v
cargo run -> dam-hopper-server (src/main.rs)
        |
        +--> isolated Windows config + no-auth loopback
        |       |
        |       +--> GET /api/health -> 200 JSON
        |       +--> UnavailableExecutor / unsupported activity
        |
        +--> cargo check/build/test gates
                |
                +--> Windows unit + integration evidence
                +--> Linux-only tests filtered by cfg
```

The build gate validates compile-time target boundaries. The smoke gate validates runtime startup and health only; it must not claim suspend capability, Linux diagnostics, or production authentication. Documentation links each claim to the command/evidence that supports it.

## Related code files

### Modify

- `server/Cargo.toml:1-32` — add `[package].default-run = "dam-hopper-server"` near package metadata.
- `README.md:124-164` — add Windows PowerShell/cmd server build, test, run, and smoke commands; clarify serial `-j 1`.
- `docs/configuration-guide.md:18-24,83-94,1100-1124` — document Windows drive/mixed/extended UNC path normalization, TOML escaping, and a reproducible server smoke checklist.
- `docs/api-reference.md:1696-1721` — retain/clarify cmd.exe command mapping, `%VAR%`/CRLF test implications, and unsupported Unix shell lifecycle behavior.
- `package.json:16-19` — audit/retain cross-platform scripts; remove any reintroduced `tee`/Bash-only pipeline if present during implementation (do not add scratch logging).

### Verify only

- `server/src/main.rs` — target-specific idle-suspend executor selection and `/api/health` startup path.
- `server/src/bin/dam-hopper.rs` — Windows exit-1 release-manager stub.
- `server/src/bin/dam-hopper-idle-suspend-helper.rs` — Windows exit-1 helper stub.
- `server/src/idle_suspend/executor.rs` — `UnavailableExecutor` fail-closed behavior.
- `server/src/idle_suspend/activity/sampler.rs` — non-Linux unavailable observation/no ticket.
- `server/tests/idle_suspend_diagnostics*.rs` — Linux-only exclusion.

### Create/delete

- No new source file. No deletion. Add only documentation text and one manifest field.

## Preflight Contract

- Work from repository root with the Windows MSVC toolchain; record `rustc -Vv`, `cargo -V`, `pnpm -v`, and target triple.
- Confirm Phase 01 focused path checks and Phase 02 harness/gate checks are complete before the full suite.
- Use a clean, isolated temporary config and loopback port. Do not reuse `~/.config/dam-hopper`, user tokens, or production ports/files.
- Run the complete Rust suite with `cargo test --manifest-path server/Cargo.toml --all-targets -j 1` (or the repository-equivalent if Cargo rejects the target combination); report actual counts.
- Treat a successful build as insufficient: stubs, startup health, cleanup, and documented unsupported behavior are separate gates.

## Implementation Steps

1. Insert `default-run = "dam-hopper-server"` in the `[package]` table. Keep all four `[[bin]]` entries and existing package scripts; do not hide the release/helper stubs.
2. Run a manifest/default-run check: `cargo run --manifest-path server/Cargo.toml -- --help`. Confirm help belongs to the server CLI, then run explicit `--bin dam-hopper` and `--bin dam-hopper-idle-suspend-helper` to verify their Windows stubs.
3. Run compile gates on Windows:
   - `cargo check --manifest-path server/Cargo.toml --all-targets`
   - `cargo build --manifest-path server/Cargo.toml --bins`
   - `cargo build --manifest-path server/Cargo.toml --release --bin dam-hopper-server` (or `pnpm build:server` after script audit)
   Record warnings separately; no warning may conceal a target-boundary error.
4. Run the full serial test gate after Phase 02:
   - `cargo test --manifest-path server/Cargo.toml --all-targets -j 1`
   - If `--all-targets` is unsupported for `cargo test` in the installed toolchain, run `cargo test --manifest-path server/Cargo.toml -j 1` after the all-targets check and record the exact fallback.
   Confirm every non-Linux test expected by the contract executes; list Linux-only tests as filtered/ignored, not passed.
5. Run stub behavior checks and capture exit status/stderr. Expected messages remain `dam-hopper release management is only supported on Linux with systemd.` and `dam-hopper-idle-suspend-helper is only supported on Linux with systemd.`; verify no Unix listener/systemd invocation.
6. Execute the live smoke from PowerShell (equivalent cmd form documented): create a temp `dam-hopper.toml`, launch `cargo run --manifest-path server/Cargo.toml -- --config <temp> --host 127.0.0.1 --port <dedicated> --no-auth`, wait for readiness, request `http://127.0.0.1:<port>/api/health`, assert HTTP 200 and `schemaVersion=1`, `status="ok"`, then terminate/wait and remove temp files. Use no `tee`.
7. If `pnpm run dev:server:no-auth` is used as a second smoke path, run it from Windows `cmd.exe`/PowerShell, confirm the script has no Unix pipe, and stop the child intentionally after health verification. Do not claim package-script smoke if only direct Cargo was exercised.
8. Update docs with copyable Windows commands, path examples (drive/mixed/extended UNC), cmd.exe terminal semantics, serial test guidance, expected unsupported Linux features, and a results table template. State that Linux live sysfs/procfs/systemd tests require Linux and that Windows build success is not Linux deployment proof.
9. Review generated files and working tree. Remove temp config/token/logs and ensure docs do not contain local paths, credentials, machine names, or unverified pass claims.

## Todo list

- [x] Add `default-run` and preserve all binary targets.
- [x] Pass Windows all-target check, debug bins, and release server build.
- [x] Pass full serial Windows unit/integration test gate with counts recorded.
- [x] Verify both non-Linux stubs and exit statuses/messages.
- [x] Complete loopback live server health smoke and cleanup.
- [x] Update README, configuration guide, and API terminal docs.
- [x] Review evidence wording and remove generated artifacts/secrets.

## Success Criteria

- `cargo run` without `--bin` selects `dam-hopper-server`; all declared binaries still build.
- Windows MSVC all-target check, binary build, release server build, and full serial test suite pass with no unexpected failures.
- Linux-only tests are explicitly filtered/ignored by target gate; no fake Linux host evidence is reported as Windows proof.
- Both Linux-only stubs exit 1 with stable explanatory messages.
- A real server starts on loopback, `/api/health` returns valid HTTP 200 JSON, and the process/config/temp artifacts are cleaned up.
- Windows documentation is copyable, path-safe, and clearly separates supported behavior, unavailable features, and evidence scope.

## Risk Assessment

- **Port/process leak:** A failed smoke can leave a server running. Use a recorded child PID, readiness timeout, `try/finally`-style PowerShell cleanup, and a post-check that the port is closed.
- **No-auth exposure:** Binding `0.0.0.0` during a smoke could expose an unauthenticated server. Use `127.0.0.1`; retain the warning in docs.
- **Resource pressure:** Parallel Cargo tests can exhaust Windows page file/rlib mappings. Use `-j 1`, disable unnecessary debug info only if documented, and do not interpret a resource retry as a code pass.
- **False completeness:** Targeted 127/2 evidence does not equal full-suite evidence. Record fresh full-suite output and actual ignored/filtered counts.
- **Documentation drift:** Commands may differ between PowerShell and cmd.exe. Include both forms or explicitly label the shell for every command.

## Security Considerations

- `--no-auth` is only for local loopback smoke with a temporary config; never document it as a deployment mode or bind it publicly.
- Do not read or print user auth tokens, MongoDB credentials, `.env` values, or production config. Use `--config` against a temp file and clean it.
- Verify Windows still selects `UnavailableExecutor` and unavailable activity; it must not claim RTC/systemd capability.
- Keep binary stubs fail-closed and non-zero; never turn unsupported Linux release/suspend operations into success.
- Do not weaken path traversal, symlink/reparse, or workspace-target authorization to satisfy smoke tests.

## Side-Effect Review Checklist

- [x] Only the manifest field and scoped docs/scripts changed in this phase.
- [x] Existing `package.json` commands contain no `tee`, Bash redirection, or untracked log output.
- [x] Smoke config, token, process, port, and logs are cleaned on success and failure.
- [x] No unauthenticated listener remains after smoke; bind was loopback only.
- [x] No Linux systemd/sysfs/procfs/block-device behavior or test assertion was altered.
- [x] Full-suite report separates passed, ignored, filtered, and unavailable tests.
- [x] Documentation makes no claims beyond observed Windows and existing Linux evidence.

## Next steps

- Run the repository's normal Linux CI/regression gate to prove the Windows test changes did not alter Linux semantics.
- Add a Windows CI job with the exact check/build/stub/full-test/smoke commands if CI capacity permits; keep it separate from Linux deployment qualification.
- Track native Windows activity metrics or host suspend as a separate product decision, not a follow-up hidden inside this build plan.

## Unresolved questions

None blocking. CI runner availability and a future native Windows activity implementation are operational/product follow-ups, not prerequisites for this plan.
