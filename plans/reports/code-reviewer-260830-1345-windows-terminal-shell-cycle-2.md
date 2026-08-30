# Code Review Report — Windows Terminal Shell Compatibility (Cycle 2)

## Code Review Summary

### Scope
- Worktree: `feat/windows-terminal-shell` (read-only review).
- Reviewed implementation, tests, docs, plan, all phase files, and prior scout/preflight/research/review reports.
- Source/docs focus: `server/src/api/terminal.rs`, `server/src/pty/manager.rs`, `server/src/pty/shell_integration.rs`, `server/src/api/tests.rs`, `docs/api-reference.md`, `docs/system-architecture.md`.
- Approximate change surface: 233 changed lines across the six implementation/documentation files; surrounding lifecycle, env, auth, target, and persistence paths inspected.
- Updated plan/report: this cycle-2 report only. Plan and phase statuses remain `Pending` because hard gates are not complete; no plan edit made under read-only constraint.

### Overall Assessment
Implementation remains aligned with the locked contract. The prior cleanup finding is fixed: both Windows API regressions create a `PtyCleanupGuard` before the request, and its `Drop` calls `PtySessionManager::remove` even when an assertion or body parse panics. No new actionable source defect found in this cycle. Release approval remains blocked by missing/non-green evidence, not by a newly observed code error.

## Critical Issues

- None identified. No new auth bypass, target-containment change, schema/persistence change, secret/raw-command logging, command interpolation, or unsafe lifecycle change observed.

## High Priority Findings / Approval Blockers

1. **Unix/Linux preservation is unproven — High, hard evidence blocker.** No Unix runner/CI evidence is available. Windows-only results cannot prove unchanged Unix cwd fallback, Bash/SHELL selection, `/bin/sh -c`, adapters, or lifecycle behavior. The pending plan correctly treats this as blocking.
2. **Authenticated live-server smoke is absent — High, hard evidence blocker.** Focused API tests exercise the in-process router, not the deployed listener/auth/session transport. Required create → input/output → remove smoke for interactive and one-shot sessions has not been run.
3. **Windows full server suite is not green — High, evidence qualification.** Supplied result: 667 run, 641 passed, 26 failed. Debugger classified failures as pre-existing/platform-fixture issues outside this diff, but this is not the plan's required full-suite pass. Keep the failures explicitly dispositioned; do not claim full-suite success.

## Medium Priority Improvements

- None requiring source change. The cycle-1 medium finding (panic-unsafe API-test cleanup) is resolved by the Windows-only RAII guard in `server/src/api/tests.rs:3518-3539`.

## Low Priority Suggestions

- None actionable in the reviewed diff. Missing fallback-specific unit coverage (invalid home then current directory, and neither directory) is useful additional proof but is not a demonstrated implementation defect and should not replace the required Unix/live-smoke gates.

## Positive Observations

- `default_untargeted_terminal_cwd` checks an existing Windows `dirs::home_dir()` then existing process cwd; no Windows `/tmp` fallback; failure is generic `PtyError`.
- Explicit untargeted cwd and target/worktree validation branches remain unchanged.
- `build_command(command, cwd, env)` is used by initial creation and respawn; the duplicate respawn decision tree is removed.
- Windows argv is exact: `cmd.exe` for empty/exact `bash`; `cmd.exe`, `/C`, and one unchanged command argument otherwise.
- Windows `ShellIntegration::prepare` returns `None` before temp assets/nonces; lifecycle stays unverified.
- Unix builder branches are cfg-isolated and preservation tripwires cover explicit Bash, configured interactive shell, and `/bin/sh -c`.
- Child-env baseline/application, auth, target containment, persistence metadata, diagnostics key-only logging, and restart state paths are untouched.
- API regressions use existing authenticated helpers, bounded `wait_for`, inert ASCII output, and unique session IDs.

## Security / Performance / Concurrency Review

- `/C` preserves the already-authorized command-string trust boundary; no new parsing, quoting rewrite, interpolation, or raw command logging.
- No new locks across awaits, process probing, unbounded work, dependency, listener, or frontend/auth behavior.
- Shared builder removes create/respawn drift; env application then integration application ordering is preserved.
- RAII cleanup retains a manager clone, so cleanup remains available if the test body panics or the local `state` is dropped.

## Observed Validation (supplied, not rerun)

- Windows focused filters passed: `windows_default_terminal_cwd`, `windows_build_command`, `windows_shell_integration_is_disabled`, `terminal_create_bash_without_cwd_uses_native_windows_shell`, and `terminal_create_executes_windows_command_through_cmd_c`.
- `cargo fmt --manifest-path server/Cargo.toml -- --check` passed.
- `cargo check --jobs 1` passed with exactly four reported pre-existing warnings (OpenOptions, Read, path, pid).
- `cargo test`: 667 run / 641 passed / 26 failed; not a passing full-suite result. Failures were debugger-classified as unrelated/pre-existing Windows path/TOML, CRLF, Linux-device, and POSIX-shell fixtures.
- Authenticated live-server smoke: not run.
- Linux/Unix focused and full validation: unavailable; no Linux success claimed.
- No broad suite, formatter, or linter rerun in this review.

## Recommended Actions / Approval

1. Obtain Unix/CI focused and full server evidence, including Unix-preservation tests.
2. Run authenticated Windows live-server create/input-output/remove smoke for interactive and one-shot sessions.
3. Record formal disposition of all 26 Windows full-suite failures; retain plan pending until release ownership accepts a documented baseline or fixes them.
4. **Recommendation: Do not approve/merge yet.** Conditional source approval is reasonable after the hard evidence gates above; current implementation quality score: **9/10**.

## Metrics

- Type coverage: N/A (Rust; no coverage report supplied).
- Test coverage: Not measured.
- Linting: No separate lint run; formatter check and cargo check passed as stated above.

## Unresolved Questions

- Which Unix runner/CI result will establish Linux preservation?
- When will authenticated live-server smoke be run?
- Are all 26 Windows failures formally accepted baseline/platform fixtures, or must any be remediated before merge?
- Original browser trace still does not establish whether cwd was omitted or `HOME` was absent; this remains an evidence gap, not a source blocker.
