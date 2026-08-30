# Code Review Report — Windows Terminal Shell Compatibility

## Code Review Summary

- **Score:** 8/10 for implementation quality; release approval remains blocked by evidence gaps.
- **Recommendation:** **Do not approve/merge yet.** Source changes are consistent with the locked contract, but hard cross-platform and live-route gates are not satisfied.
- **Review basis:** Current working tree against `feat/windows-terminal-shell` HEAD; read-only review.
- **Files reviewed:**
  - `server/src/api/terminal.rs`
  - `server/src/pty/manager.rs`
  - `server/src/pty/shell_integration.rs`
  - `server/src/api/tests.rs`
  - `docs/api-reference.md`
  - `docs/system-architecture.md`
  - `plans/260830-1345-windows-terminal-shell/plan.md` and all three phase files
  - scout, preflight, researcher reports; PDR and code standards
- **Change size:** 213 changed lines across six tracked files (plus expected plan/evidence files).
- **Plan status:** Parent and all phase TODO/status fields remain Pending. Correct for the unmet hard gates; not changed in this read-only review.

## Overall Assessment

Implementation follows the intended minimal platform boundary: Windows omitted untargeted cwd resolves to an existing home/current directory; Windows empty/exact `bash` selects bare `cmd.exe`; other commands use one `/C` argument; create and respawn call the same builder; Windows shell integration returns `None`. Unix branches are isolated under `cfg(not(windows))` and appear unchanged. No frontend, auth, target sandbox, schema, persistence, or environment-policy changes found.

## Critical Issues

- **None identified in the reviewed source diff.** No new auth bypass, target containment bypass, secret logging, command interpolation, schema change, or persistence change observed.

## High Priority Findings / Approval Blockers

1. **Linux/Unix preservation is unproven (High, release blocker).** The plan explicitly requires Unix focused and full-suite evidence. Linux/Unix validation was unavailable on this Windows host. Windows results cannot establish that Unix shell selection, `/bin/sh -c`, cwd fallback, and adapters remain compatible.
2. **Required actual-server smoke is absent (High, release blocker).** No authenticated live-server create → PTY input/output → remove run was performed. The focused API tests exercise an in-process router, not the deployed listener/auth/session transport path required by Phase 02.
3. **Windows full suite is not green (High, evidence qualification).** Reported result is 667 run, 641 passed, 26 failed. Debugger classified failures as pre-existing or platform-fixture incompatibilities outside changed files, but this remains different from the plan's “full server suite pass” success criterion. Keep failures explicitly tracked; do not claim the suite passed.

## Medium Priority Findings

- **Test cleanup is not panic-safe (Medium).** New API tests call `state.pty_manager.remove(id)` only after assertions (`server/src/api/tests.rs:3548`, `3579`). A failed status/metadata/output assertion exits before removal and may leave a PTY/tombstone alive. Phase 02 requires every created session to be removed for full-suite safety. Use the repository's existing guard/defer-style cleanup if available, or otherwise ensure cleanup executes on all paths. The observed passing run did perform the final cleanup path.

## Low Priority Suggestions

- No source-level low-priority issue requiring change. API prose at `docs/api-reference.md:1183` accurately states the selected Windows/Unix contract and avoids promising Bash discovery, PowerShell, WSL, or quoting policy.

## Positive Observations

- `default_untargeted_terminal_cwd()` checks `dirs::home_dir()` and then existing `current_dir()` on Windows, with a generic `PtyError` and no `/tmp` fallback.
- Explicit untargeted cwd and all target/worktree validation branches remain intact.
- `build_command(command, cwd, env)` is consumed by both initial creation and respawn; the prior respawn decision tree is removed.
- Windows argv is exact: bare `cmd.exe` for `""`/`"bash"`, and `cmd.exe`, `/C`, original command for other inputs. No `/D`, `/K`, shell discovery, or quote rewriting added.
- `ShellIntegration::prepare` reaches the Windows `None` boundary before temp assets/nonces; lifecycle remains unverified.
- Unix construction is visibly cfg-isolated and unit assertions pin Bash, configured interactive shell, and `/bin/sh -c` argv.
- Existing child-env baseline/application and diagnostic key-only logging are untouched by the diff.
- New API regressions use the existing authenticated `post_json` helper and stable output token; no auth bypass or locale/prompt assertions.

## Security / Performance / Architecture Review

- `/C` preserves the existing authenticated command trust boundary; no newly introduced concatenation or raw command logging.
- Target cwd containment and canonical target handling are unchanged.
- No new locks, awaits, unbounded allocations, process probes, dependencies, or listener behavior introduced. Builder allocation is limited to the required argv.
- Shared builder removes create/respawn drift and preserves env-then-integration application ordering.
- Four cargo-check warnings were reported as pre-existing (`fs::OpenOptions`, `Read`, `path`, `pid`); warning-related lines are outside the changed behavior/import edits. No warning is attributable to this implementation based on the supplied evidence and diff inspection.

## Validation Commands / Results (supplied evidence)

- `cargo test windows_default_terminal_cwd` — passed on Windows 11 Pro x64.
- `cargo test windows_build_command` — passed on Windows.
- `cargo test windows_shell_integration_is_disabled` — passed on Windows.
- `cargo test terminal_create_bash_without_cwd_uses_native_windows_shell` — passed on Windows.
- `cargo test terminal_create_executes_windows_command_through_cmd_c` — passed on Windows.
- `cargo fmt --check` — passed.
- `cargo check --jobs 1` — passed with exactly four pre-existing warnings listed above.
- `cargo test` — 667 run, 641 passed, 26 failed; failures classified as pre-existing/platform fixture incompatibilities outside this diff. **Not a passing full-suite result.**
- Authenticated live-server smoke — not run.
- Linux/Unix focused/full validation — unavailable; no Linux success claimed.
- No broad validation was rerun during this review.

## Recommended Actions

1. Obtain Unix/CI focused and full server evidence, including the new Unix-preservation assertions.
2. Run the required authenticated live-server Windows smoke and capture create/input-output/remove evidence without secrets.
3. Make the two new API tests cleanup-safe on assertion/panic paths.
4. Reconcile the 26 Windows full-suite failures in the release record; retain the pending plan status until hard gates are either green or formally dispositioned by the release owner.

## Metrics

- Type coverage: N/A (Rust; no coverage report supplied).
- Test coverage: Not measured.
- Linting: No separate lint run; `cargo fmt --check` passed and `cargo check --jobs 1` passed with four pre-existing warnings.

## Unresolved Questions

- What Unix runner/CI result will verify unchanged shell/cwd/integration behavior?
- When will the authenticated live-server smoke be performed?
- Are all 26 Windows failures formally accepted baseline/platform fixtures in the merge gate, or must they be separately remediated?
- Original browser trace still does not establish whether cwd was omitted or HOME was absent; this remains an evidence gap, not a source blocker.
