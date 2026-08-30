# Scout Report: Windows terminal creation 500

## Scope

Read-only reconnaissance of `server/` in worktree `G:/ws/sharing/dam-hopper-windows-terminal` on branch `feat/windows-terminal-shell`. Linux behavior is protected; no files were edited and no validation suite was run.

## Request path

- `server/src/api/router.rs:216-221` maps protected `POST /api/terminal` to `api::terminal::create_session`.
- `server/src/api/terminal.rs:23-120` deserializes `id`, `command`, optional `cwd`/`env`, resolves target/cwd/environment, then calls `PtySessionManager::create`.
- `server/src/pty/manager.rs:963-1078` opens `NativePtySystem`, constructs the child command, and maps `spawn_command` failures to `AppError::PtyError`.
- `server/src/api/error.rs:31-49` maps unclassified `PtyError` to HTTP 500.
- Respawn repeats command construction at `server/src/pty/manager.rs:3245-3317`.

## Evidence and likely causes

1. **Invalid Windows default cwd (medium-high confidence; direct 500 trigger).** For sessions without a project target, `resolve_terminal_cwd` uses requested `cwd`, then process `HOME`, then literal `/tmp` (`server/src/api/terminal.rs:147-155`). A Windows server with no `HOME` receives `/tmp`; `CreateProcess`/portable-pty cannot use that nonexistent directory, so spawn fails and the endpoint returns 500. Linux keeps the current `/tmp` fallback.
2. **Unix shell integration applied to Windows cmd (high-confidence defect; secondary trigger/behavior bug).** `ShellIntegration::prepare("bash", ...)` uses a Unix `/bin/bash` fallback (`server/src/pty/shell_integration.rs:58-81`) and returns a Bash adapter on Windows. `build_command` selects `cmd.exe` for every Windows request (`server/src/pty/manager.rs:3570-3603`), then integration adds Bash-only `--rcfile` and `-i` args (`shell_integration.rs:148-167`). This is a platform mismatch even if a valid cwd lets `cmd.exe` spawn.
3. **Windows command requests are ignored (existing behavior gap).** The Windows command branch always starts bare `cmd.exe`, regardless of `opts.command`; non-interactive commands should use the Windows shell command form if this task includes that contract.
4. **Child env is not Windows-aware.** `build_child_env_from_parent_snapshot` only allowlists `PATH` plus mostly Unix names (`manager.rs:3620-3640`); Windows process launch relies on inherited `PATH`/system variables, so explicit environment construction should preserve required Windows launch variables or use the inherited map safely. This is a related risk, not proven as the reported trigger.

## Existing patterns

- Windows path handling uses explicit `#[cfg(windows)]` tests and strips `\\?\\`/`\\?\\UNC\\` prefixes in `manager.rs:3549-3563`.
- `ssh.rs:360-368` uses `dirs::home_dir()` with `USERPROFILE` fallback for Windows home resolution.
- PTY tests in `server/src/pty/tests.rs` are `cfg(unix)`; API tests currently cover explicit cwd and project-root default but not omitted cwd for a free terminal (`server/src/api/tests.rs:3519-3747`).
- Shell integration runtime tests are Unix-only, but resolver-selection tests at `shell_integration.rs:416-455` currently assume Unix adapters on every platform.
- Docs claim Windows path support and show Bash script commands, but do not define Windows interactive PTY semantics (`docs/configuration-guide.md:20-57`, `docs/api-reference.md:1172-1201`).

## Candidate fix

Recommended minimal Windows-only cutover:

- Keep the Unix fallback exactly unchanged under `#[cfg(not(windows))]`.
- Resolve a free terminal's omitted cwd to `dirs::home_dir()`, then `current_dir()`, then `.` under `#[cfg(windows)]`; never use `/tmp` on Windows.
- Make command construction shared by initial create and respawn. On Windows, use bare `cmd.exe` for empty command or the existing `bash` shell-selector request; use `cmd.exe /C <command>` for other command strings. Keep existing Unix `/bin/sh -c`/Bash/SHELL behavior unchanged.
- Disable unsupported Unix shell integration on Windows, so cmd.exe never receives Bash flags or lifecycle nonce hooks. Gate the integration-selection tests accordingly and add Windows tests for the no-adapter contract.
- Add Windows-focused API/PTY unit coverage for omitted cwd and command construction, plus retain existing Unix assertions. Avoid changing auth, target validation, persistence, or frontend.

Tradeoff: Windows `bash` remains a compatibility shell selector that launches `cmd.exe`; supporting Git Bash/WSL would require an explicit executable-discovery/product contract and is not justified for this failure.

## Acceptance evidence

- The reported Windows POST with `command: "bash"` and omitted cwd creates a live PTY instead of returning 500.
- A Windows non-interactive command reaches `cmd.exe /C` and respawn uses the same construction.
- No Bash integration flags are attached to Windows cmd sessions.
- Existing Unix behavior/tests remain unchanged.
- Error/target/auth contracts remain unchanged.

## Unresolved questions

- Whether the affected client omitted `cwd` and whether the server process lacked `HOME` is not observable from the supplied browser stack.
- Product intent for Windows `bash`: launch real Bash when installed versus use cmd.exe compatibility fallback. Recommended plan chooses the existing cmd.exe fallback and does not add executable discovery.
