# Phase 02 — Verify Windows Terminal Regression

## Context links

- Parent: [plan.md](./plan.md)
- Dependency: [Phase 01](./phase-01-implement-windows-pty-contract.md)
- Locked acceptance: [preflight report](../reports/preflight-260830-1345-windows-terminal-shell.md#acceptance-criteria)
- Existing terminal tests: [`server/src/api/tests.rs`](../../server/src/api/tests.rs), [`server/src/pty/manager.rs`](../../server/src/pty/manager.rs), [`server/src/pty/shell_integration.rs`](../../server/src/pty/shell_integration.rs)
- Public route: [`docs/api-reference.md`](../../docs/api-reference.md#terminals)

## Overview

- Date: 2026-08-30
- Description: Add route-level regressions, then prove Windows runtime behavior and Linux preservation with focused-to-broad validation.
- Priority: P1
- Implementation status: Complete — conditional release approval
- Review status: Complete — Linux, MongoDB, and full-suite gates remain open
- Owner: Server test owner; owns focused API tests, command execution proof, smoke evidence, and validation handoff.

## Key Insights

- A pure argv test catches `/C` and Bash-flag regressions, but only the authenticated Axum route reproduces the reported HTTP 500.
- The regression request must omit `cwd`; supplying the temp directory would bypass the root cause.
- The API response exposes session metadata, including cwd/alive state, so the test need not infer cwd from locale-sensitive `cd` output.
- One real PTY command-output assertion is still needed to prove `cmd.exe /C` execution, not only construction.
- Automatic respawn should not get a second timing-heavy Windows test: shared helper ownership plus existing restart tests provide stronger, less flaky coverage.

## Requirements

1. Add Windows-only API coverage for the exact reported shape: authenticated POST, `command: "bash"`, no `cwd`, 200, live session, valid non-`/tmp` cwd.
2. Add Windows-only API coverage for a noninteractive command whose output proves `/C` execution.
3. Always remove created sessions so tests are full-suite-safe.
4. Run Phase 01 unit filters before API filters; then server checks/full suite.
5. Smoke the actual server route, PTY input/output, and cleanup on Windows. Unit tests alone are insufficient.
6. Obtain Unix runner/CI evidence. Windows success cannot waive Linux preservation.
7. Do not alter auth helpers, weaken assertions, add sleeps when `wait_for` exists, or mask unrelated failures.

## Architecture

Validation layers:

1. **Pure/unit** — platform cwd/argv/adapter decisions.
2. **Authenticated API** — route → handler → cwd resolver → real PTY manager.
3. **Actual server smoke** — listener/auth/session transport/PTY process as deployed.
4. **Cross-platform regression** — Unix tests and full server suite.
5. **Static side-effect review** — shared create/respawn helper and untouched boundaries.

The API tests use existing `make_state`, `post_json`, `wait_for`, manager buffer, and removal patterns. No mock shell or frontend harness.

## Related code files

- Modify `server/src/api/tests.rs:3519-3747` — place Windows terminal regressions beside existing create/default-cwd cases.
- Validate tests added in `server/src/api/terminal.rs:344+`, `server/src/pty/manager.rs:3778+`, and `server/src/pty/shell_integration.rs:179-455` during Phase 01.
- Exercise `server/src/api/terminal.rs:51-121,147-208` and `server/src/pty/manager.rs:963-1078` through the route.
- Exercise `server/src/pty/manager.rs:3180-3317` indirectly through existing restart-suite coverage plus shared-helper review.
- No production file ownership in this phase except a correction required by a failing focused regression; any correction must stay inside Phase 01 contract.

## Implementation Steps

1. **Add exact Windows route regression.**
   - Add `#[cfg(windows)] #[tokio::test] terminal_create_bash_without_cwd_uses_native_windows_shell` near `terminal_create_returns_meta_and_appears_in_list`.
   - Create temp state with existing `make_state`; POST `{ "id": "windows-bash-default-cwd", "command": "bash", "cols": 80, "rows": 24 }` through `post_json` (thus existing auth).
   - Assert HTTP 200. Parse `SessionMeta`; assert correct id, `alive == true`, metadata cwd resolves to `Path::is_dir()`, and cwd is not literal `/tmp`.
   - Remove session through `state.pty_manager.remove(...)`, even after successful assertions; use the file's existing cleanup style.
2. **Add Windows one-shot execution regression.**
   - Add `terminal_create_executes_windows_command_through_cmd_c` with explicit temp cwd for isolation and command `echo WINDOWS_CMD_C_OK`.
   - Assert 200, then use existing bounded `wait_for` until manager buffer contains the stable ASCII token. Do not assert prompt text, line endings, shell banner, or locale-sensitive output.
   - Remove the session/tombstone. The Phase 01 pure test owns exact argv; this API test owns observable execution.
3. **Run focused Windows proof from `server/` after implementation.**
   - `cargo test windows_default_terminal_cwd`
   - `cargo test windows_build_command`
   - `cargo test windows_shell_integration_is_disabled`
   - `cargo test terminal_create_bash_without_cwd_uses_native_windows_shell`
   - `cargo test terminal_create_executes_windows_command_through_cmd_c`
   - Record command, exit status, and relevant test names; do not claim unrun filters.
4. **Run server validation on Windows.**
   - `cargo fmt --check`
   - `cargo check`
   - `cargo test`
   - Treat failures as real until diagnosed. If an existing Unix-only API test is revealed on Windows, gate only that proven platform-specific contract or make its command fixture platform-correct; do not broaden this ticket into general test portability.
5. **Smoke the actual server, not the test router.**
   - Launch `dam-hopper-server` with the repository's normal local configuration/auth on loopback.
   - Send authenticated POST `/api/terminal` with a unique id, `command: "bash"`, cols/rows, and no cwd. Capture status and response metadata; require 200, alive session, valid Windows cwd.
   - Through the existing terminal input transport, send `echo WINDOWS_TERMINAL_SMOKE` followed by CRLF. Read the existing terminal buffer/output path until the token is observed.
   - Create a second unique session with command `echo WINDOWS_ONE_SHOT_SMOKE`; observe token output and normal exit/tombstone behavior.
   - Remove both sessions. Confirm no `terminal.spawn_failed` diagnostic for them and no new command/env-value logging.
6. **Prove Linux preservation on a Unix runner/CI.**
   - Run the new non-Windows command-construction tripwires and existing shell-integration resolver/runtime tests.
   - From `server/`, run `cargo fmt --check`, `cargo check`, and `cargo test` on Linux.
   - Require existing Unix terminal API/PTY tests unchanged and green. If no Unix runner is available, keep this release gate open; do not infer Linux evidence from Windows results.
7. Capture only observed evidence in the implementation report/PR. Never backfill expected results as passed.

## Todo list

- [x] Add Windows POST-without-cwd API regression.
- [x] Add Windows `/C` output API regression.
- [x] Ensure every created session is removed.
- [x] Run focused Windows unit filters.
- [x] Run focused Windows API filters.
- [x] Run Windows format/check; full suite recorded 641/667 passed with 26 unrelated path/CRLF/POSIX fixture failures.
- [x] Smoke live Windows dev-mode create/input/output/remove and one-shot output.
- [ ] Obtain Linux focused and full-suite evidence.
- [ ] Obtain authenticated MongoDB smoke with required environment variables.
- [x] Record failures and exact remediation; no unrelated failures masked.

## Conditional Evidence and Release Gates

- Focused Windows proof complete: five correctly filtered tests passed, each 1 passed — child `PATH` casing, native cmd argv, omitted-cwd bash API create, cmd `/C` API command, and Windows shell integration disabled.
- Windows `cargo fmt --check` and `cargo check --jobs 1` passed; four existing warnings remain.
- Live Windows dev-mode smoke passed for interactive `bash` and one-shot echo with HTTP 200, expected buffer output, and cleanup 204.
- Linux/Unix evidence is unavailable and remains a hard release gate; no Windows result is treated as Linux proof.
- Authenticated MongoDB smoke is unavailable because `MONGODB_URI` and `MONGODB_DATABASE` were unset. Raw signing secret behavior correctly returned 401; this does not satisfy the authenticated smoke gate.
- Earlier Windows full suite recorded 641/667 passed with 26 unrelated path/CRLF/POSIX fixture failures. These remain explicit baseline release gates and are not masked or expanded into this fix.

## Success Criteria

- Exact reported request returns HTTP 200 and live metadata in Windows API test and actual-server smoke.
- Resolved omitted cwd exists and is not `/tmp`.
- Stable token proves a Windows noninteractive command executes through the PTY.
- Unit tests prove cmd argv has no Bash flags and one-shot argv includes `/C` exactly once.
- Existing restart tests remain green, and source review shows both spawn paths call one builder.
- Windows format/check passed; the full-suite baseline remains open with 26 unrelated failures.
- Linux focused tests and full server suite remain an explicit open release gate; no inference from Windows-only output.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Interactive session exits before assertion | False regression failure | Exact `bash` selector must produce bare interactive `cmd.exe`; assert alive immediately and clean up |
| PTY output timing flakes | Unreliable suite | Existing bounded `wait_for`; stable ASCII token; no fixed sleeps/prompt assertions |
| Child sessions leak after assertion | Later test/process pollution | Explicit remove and unique ids; preserve cleanup even on normal path |
| Full Windows suite exposes unrelated Unix fixtures | Scope creep or hidden failure | Diagnose; narrowly gate only proven fixture issues; report blockers, never mask |
| Linux branch compiles but differs | Production regression | Unix argv/adapters tests plus real Linux full suite |
| Smoke bypasses auth | False end-to-end proof | Use authenticated route exactly as browser does; no auth changes/bypass |

## Security Considerations

- Tests use existing authenticated helpers and loopback server setup; never add a test-only production bypass.
- Use inert `echo` tokens only. No filesystem mutation outside temp roots.
- Do not record auth cookies/tokens, environment values, or raw diagnostic payloads in evidence.
- Kill/remove smoke sessions and stop the local server normally.
- Verify changed logs remain key/name-only and do not expose the accepted command string.

## Next steps

After all Windows and Unix gates pass, proceed to [Phase 03](./phase-03-document-and-review-platform-contract.md). Unresolved operational dependency: Linux evidence requires an available Unix CI/runner; this is a hard merge gate, not optional follow-up.
