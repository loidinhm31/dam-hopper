# Phase 02 — Test harness and platform gating

## Context links

- Parent: [plan.md](./plan.md)
- Dependency: [Phase 01 — path and config normalization](./phase-01-path-and-config-normalization.md)
- Scout: [Windows codebase locations](../reports/scout-260919-2248-windows-codebase-locations.md)
- Existing verification: [Windows test report](../reports/tester-260919-2248-windows-test-report.md)
- Terminal contract: [API reference](../../docs/api-reference.md:1696-1721)
- Platform architecture: [system architecture](../../docs/system-architecture.md)

## Overview

**Priority:** P1  
**Status:** Pending  
**Goal:** Make unit and integration tests exercise the same observable contracts on Windows without pretending Windows has a Unix shell, Linux sysfs, procfs, block devices, or systemd.

The current PTY builder maps non-empty Windows commands to `cmd.exe /C` (`server/src/pty/manager.rs:4484-4549`), while many API tests send `printf`, `$VAR`, `cat`, and `sleep` (`server/src/api/tests.rs:831-893,896-984,3777-4023,4654-4854`). Git tests also use `/tmp` as a clone cwd and inherit user `core.autocrlf` (`server/src/git/tests.rs:62-128`). These are harness defects, not product behavior defects.

## Key Insights

- Windows command output uses CRLF and `%NAME%` expansion; Unix tests use LF and `$NAME`. Assertions must normalize output, not weaken the API contract.
- A test command that is only intended to stay alive must be selected per platform. Do not change production `build_command`; its cmd.exe behavior is already documented and covered by `server/src/pty/manager.rs` tests.
- Git line-ending behavior is user-configurable. Tests must set local `core.autocrlf=false`/`core.eol=lf` in every temporary repository, including clones, or file-content assertions become host-dependent.
- `server/src/system/platform.rs:338-362` already tests explicit non-Linux unsupported metrics. Keep it. Linux `/dev` block-device alert assertions in `server/src/system/tests.rs:319-399` (and equivalent alert fixtures around `server/src/system/alerts.rs:1436-1479`) must not run on Windows.
- Linux diagnostics files already have crate-level gates (`server/tests/idle_suspend_diagnostics.rs:1`, `idle_suspend_diagnostics_linux_smoke.rs:1`); preserve/verify those gates instead of replacing Linux assertions with fakes.
- Raw display-string path assertions can disagree after canonicalization or separator normalization. Compare `target_path_identity` or `PathBuf` values, depending on the contract.

## Requirements

### Functional

1. API terminal tests pass on Windows using cmd-compatible output, environment expansion, and hold-open commands.
2. Terminal output assertions accept the platform newline convention while still checking exact semantic values and redaction.
3. Git tests produce LF fixtures independent of global Git settings and run clone commands from an existing Windows directory.
4. Linux-only sysfs, systemd diagnostics, procfs/netlink, and `/dev` block-device alert tests are target-gated; cross-platform unsupported behavior remains asserted.
5. Integration tests use existing temp directories rather than `/tmp`, and target path assertions use the shared identity contract.
6. No production API, PTY, Git, or alert semantics are changed merely to satisfy tests.

### Non-functional

- Test helpers remain local to their harness (`server/src/api/tests.rs` versus `server/tests/common/mod.rs`) and do not add runtime dependencies.
- Gates use `cfg(target_os = "linux")` for Linux kernel contracts; use `cfg(windows)` only for cmd/path details.
- Tests remain real filesystem/Git/PTY tests; no mocks that hide Windows behavior.
- Full Windows test execution remains serial (`-j 1`) to avoid MSVC page-file/rlib pressure.

## Architecture

```text
API unit tests ---------------------> cfg shell command + newline/path normalizer
integration PTY tests --------------> common platform command + real temp cwd
Git tests --------------------------> temp repo + local LF config
Linux host tests -------------------> cfg(target_os = "linux")
non-Linux contract tests -----------> explicit unsupported/unavailable assertions
```

Suggested test-only helpers:

- In `server/src/api/tests.rs`, provide `hold_command()`, `read_stdin_command()`, `print_env_command(name)`, `print_cwd_command()`, and `normalize_terminal_output()`. Windows implementations use `echo %NAME%`, `%CD%`, `more`, and a bounded cmd-compatible delay (for example `ping 127.0.0.1 -n N >NUL`); Unix implementations retain `printf`, `$NAME`, `$PWD`, `cat`, and `sleep`.
- In `server/tests/common/mod.rs`, expose the same minimal command/cwd helpers for `browser_debug_artifacts`, `idle_suspend`, `idle_suspend_phase07`, and `workflow_api`; do not duplicate shell strings in each integration file.
- For paths, use `dam_hopper_server::workspace_target::target_path_identity` inside crate tests where available; integration tests can compare `dunce::canonicalize` results or normalized identity strings.

## Related code files

### Modify

- `server/src/api/tests.rs:831-893,896-984,3777-4048,4654-4868` — cmd-safe terminal commands, CRLF normalization, hold-open cleanup, canonical target assertions.
- `server/src/git/tests.rs:33-76,94-128` — local Git line-ending policy and platform-valid clone cwd; preserve exact operation assertions at `1368-1450,1516-1538,1806-1828`.
- `server/src/system/tests.rs:319-399` — gate `/dev` block-device classifier tests to Linux.
- `server/src/system/alerts.rs:1436-1479` — gate alert fixtures that assert Linux `/dev` source semantics; leave pure state-machine tests portable.
- `server/tests/common/mod.rs:1-18` — shared integration command/cwd/path helpers.
- `server/tests/browser_debug_artifacts.rs:122-140` — replace raw `cat` hold command.
- `server/tests/idle_suspend.rs:71-88,461,923,1088,1131,1187,1234,1275,1400-1505` — temp cwd and platform command helper; preserve ignored Linux live smoke gate.
- `server/tests/idle_suspend_phase07.rs:37-54,252,351` — temp cwd and platform command helper.
- `server/tests/workflow_api.rs:1052-1135` — replace raw `sleep` with the shared hold command.
- `server/tests/workspace_targets.rs:74-167` — normalized path comparisons and, where needed, local Git line-ending setup.

### Verify/retain

- `server/src/pty/manager.rs:4484-4549,4890-4916` — existing production cmd.exe/Unix command contract; no behavior rewrite.
- `server/src/system/platform.rs:338-362` — explicit non-Linux unsupported snapshot test.
- `server/tests/idle_suspend_diagnostics.rs:1` and `server/tests/idle_suspend_diagnostics_linux_smoke.rs:1` — Linux-only diagnostic gates.

### Create/delete

- No new production module; no test deletion. Add only small test helpers/gates in existing files.

## Preflight Contract

- Record current Windows failures separately from the prior targeted proof: targeted 127 passed/2 ignored is not full-suite evidence.
- Do not run Linux live tests on Windows and do not replace them with fake `/sys`, `/proc`, `/dev`, systemd, or netlink fixtures.
- Keep Git config local to each temp repo. Never set `git config --global` or depend on the developer's shell profile.
- Every spawned PTY is killed/removed in the test, including when an assertion fails where practical; no long-lived `ping`, `more`, or `cmd.exe` children.
- Keep tests auth-safe and filesystem-scoped; no test command may use a user-provided shell string.

## Implementation Steps

1. Add platform command helpers to the API unit test module. Replace POSIX-only commands in diagnostics export, OTel env, lifecycle, env-file, target-env, cwd, rename, and target metadata tests. Keep the test intent unchanged: output, env precedence, alive session, kill/remove, and target metadata.
2. Normalize PTY output only at assertion boundaries (`\r\n` → `\n`, optionally trim the command echo). Continue asserting secret redaction, exact variable values, session IDs, and lifecycle HTTP statuses.
3. Replace fixed `sleep 30`/`cat` in API and integration tests with the platform hold helper. Ensure each test removes/kills the session before returning. Keep the ignored Linux child-worker command behind its existing Linux block.
4. Add integration helpers and change `make_pty_opts` in `idle_suspend.rs` and `idle_suspend_phase07.rs` from `"/tmp"` to an existing `temp_dir`/fixture path. Update `browser_debug_artifacts` and `workflow_api` to use the helper.
5. Add a target-path assertion helper that compares `target_path_identity` (or `dunce`-canonical `PathBuf`s) for `worktreePath` and `cwd` at API test lines `4764-4768` and `4850-4854`, and for resolver expectations at `workspace_targets.rs:100-167`. Keep path ownership and relative-path assertions strict.
6. Add a `configure_test_repo` helper in `server/src/git/tests.rs`; call it after every `git init` and clone. Set local `core.autocrlf=false` and `core.eol=lf`. Replace clone helper cwd `/tmp` with the destination's existing parent/temp directory.
7. Add `#[cfg(target_os = "linux")]` around the `/dev` block-device alert tests. Confirm Linux diagnostics/sysfs files remain crate-gated and confirm non-Linux unsupported host-metrics tests still run.
8. Run focused unit/integration filters on Windows, inspect child-process cleanup and ignored counts, then pass the full validation to Phase 03.

## Todo list

- [ ] Add cmd-compatible API terminal command helpers.
- [ ] Normalize CRLF at output assertion boundaries.
- [ ] Replace `/tmp`, `cat`, `sleep`, `printf`, and `$VAR` in cross-platform tests.
- [ ] Scope Git `autocrlf`/`eol` settings to all temp repositories and clones.
- [ ] Gate Linux `/dev` and sysfs/systemd tests without weakening assertions.
- [ ] Normalize API and workspace-target path assertions.
- [ ] Verify every PTY test cleans up its child/session.

## Success Criteria

- All affected API terminal tests pass on Windows with real cmd.exe PTYs and retain their semantic assertions.
- Git operation tests pass with identical LF file contents regardless of user Git configuration.
- Windows test discovery contains no active Linux sysfs, procfs/netlink, systemd, or `/dev` assertions; Linux discovery still includes them.
- Integration PTY tests run from existing Windows temp directories; worktree metadata assertions accept only equivalent canonical identities.
- Linux-focused tests remain unchanged in behavior and still require an actual Linux host for live kernel coverage.

Validation: focused Windows commands for `api::tests` terminal filters, Git tests, `system` alerts, `workspace_targets`, `idle_suspend`, `idle_suspend_phase07`, and browser/workflow integration; Phase 03 runs the complete `cargo test` gate.

## Risk Assessment

- **Cmd quoting/expansion:** `%` and `&` have different semantics. Keep helper inputs fixed/test-owned and avoid interpolating arbitrary values into commands.
- **Hold command availability:** `timeout`, `ping`, or `more` could vary by image. Prefer commands shipped with supported Windows (`cmd.exe`, `more.com`, loopback `ping`) and use short bounded waits; fail with a clear diagnostic if unavailable.
- **CRLF masking:** Blindly replacing all `\r` could hide payload corruption. Normalize only the PTY line ending at comparison boundaries and retain exact semantic checks.
- **Over-gating:** A broad module gate could erase portable alert/state coverage. Gate only tests that assert Linux device/sysfs facts; retain pure parsers and unsupported snapshots.
- **Path assertion weakening:** Comparing only suffixes could accept a foreign root. Use the shared full identity and containment contract.

## Security Considerations

- Test commands must not execute config-provided commands or echo credentials outside the test-owned values already under assertion.
- Preserve terminal target authorization and traversal rejection; platform normalization must not replace canonical containment checks.
- Keep Linux diagnostics and suspend tests off Windows to prevent accidental host mutation or false capability claims.
- Keep Git fixtures isolated in `TempDir`; local config prevents user/global settings from influencing security-sensitive path/content assertions.

## Side-Effect Review Checklist

- [ ] Production PTY command construction is unchanged.
- [ ] Production Git behavior and user Git configuration are untouched.
- [ ] No Linux test was made weaker; only target-inapplicable tests are skipped.
- [ ] All cmd.exe/ping/more children and PTY sessions are stopped and removed.
- [ ] No test writes outside its `TempDir` or invokes systemctl/sysfs on Windows.
- [ ] CRLF normalization is not applied to persisted/config/API data.
- [ ] Path assertions still reject foreign/sibling targets.

## Next steps

Once Phase 02 focused checks pass, Phase 03 adds `default-run`, executes the full serial Windows unit/integration suite, performs a live no-auth health smoke, and updates the Windows runbook with the exact evidence boundary.
