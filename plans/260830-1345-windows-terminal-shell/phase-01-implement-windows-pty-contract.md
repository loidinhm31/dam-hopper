# Phase 01 — Implement Windows PTY Contract

## Context links

- Parent: [plan.md](./plan.md)
- Inputs: [scout](../reports/scout-260830-1345-windows-terminal-shell.md), [preflight](../reports/preflight-260830-1345-windows-terminal-shell.md), [research](../reports/researcher-260830-1345-windows-terminal-shell.md)
- Architecture: [`docs/system-architecture.md` PTY and inline-suggestion contracts](../../docs/system-architecture.md#pty-phase-04-restart-engine--phase-07-idempotency-)
- Standards: [`docs/code-standards.md` Rust/PTy patterns](../../docs/code-standards.md#pty-session-manager-patterns-phase-04)
- Dependency API: portable-pty 0.8 `CommandBuilder::{get_argv,get_cwd}` documented in the research report

## Overview

- Date: 2026-08-30
- Description: Correct Windows cwd, command argv, and shell-integration selection at the server PTY boundary.
- Priority: P1
- Implementation status: Complete
- Review status: Complete
- Owner: Server/PTy owner; owns `terminal.rs`, `manager.rs`, and `shell_integration.rs` changes plus adjacent unit tests.

## Key Insights

- Direct 500 path: `resolve_terminal_cwd` can emit literal `/tmp`; portable-pty forwards cwd to Windows process creation.
- Secondary defect: Windows chooses `cmd.exe`, but `ShellIntegration::prepare("bash", ...)` creates a Bash adapter and appends `--rcfile -i`.
- `create_with_buffer` already calls `build_command`; `respawn_internal` reimplements executable/argv selection. Duplication is the drift source.
- Request `command: "bash"` is a locked interactive-shell selector. On Windows it means native `cmd.exe`, not executable discovery.
- Environment broadening is unproven and explicitly outside preflight. Keep `apply_child_env`, baseline keys, overrides, and value-safe logging untouched.

## Requirements

### Preflight contract

1. Windows free-terminal omitted cwd resolves to the first existing `dirs::home_dir()` or `std::env::current_dir()` result; never `/tmp`.
2. If neither directory exists, fail before portable-pty with a generic `AppError::PtyError`; keep the established HTTP 500 class and do not expose paths.
3. Explicit requested cwd and all project/worktree validation behavior remain unchanged.
4. Windows empty and exact `bash` commands launch `cmd.exe` interactively with no args.
5. Every other nonempty Windows command launches argv exactly `cmd.exe`, `/C`, original command string. Do not trim, split, quote-rewrite, add `/D`, or use `/K`.
6. Initial create and automatic respawn call the same command builder.
7. `ShellIntegration::prepare` returns `None` on Windows before temp files/nonces are created.
8. Non-Windows `HOME` → `/tmp`, Bash/SHELL/`/bin/sh -c`, cwd normalization, env, and adapters retain current semantics.

### Non-functional

- KISS: one small cwd helper and one shared command builder; no trait/factory/spec type.
- DRY: delete respawn's inline `CommandBuilder` decision tree.
- No new dependency; `dirs = "5"` already exists.
- No source-wide formatting or unrelated cleanup during implementation.

## Architecture

### Request path

`create_session` → `resolve_terminal_cwd` → `PtySessionManager::create` → `create_with_buffer` → shared `build_command` → platform-gated `ShellIntegration::prepare` → portable-pty spawn.

Automatic exit path: reader → supervisor → `respawn_internal` → the same `build_command` → portable-pty spawn. `RespawnOpts.command` stays the original selector/string, so persisted metadata and restart semantics remain stable.

### Platform decision table

| Platform/input | Executable and argv | Integration | Cwd fallback |
|---|---|---|---|
| Windows `""` | `cmd.exe` | None | existing home, then current dir |
| Windows `"bash"` | `cmd.exe` | None | existing home, then current dir |
| Windows other | `cmd.exe /C <unchanged string>` | None | existing home, then current dir |
| Non-Windows `"bash"` | existing resolved Bash | existing adapter | existing `HOME`, then `/tmp` |
| Non-Windows `""` | existing absolute `SHELL`/Bash fallback | existing adapter selection | existing `HOME`, then `/tmp` |
| Non-Windows other | existing `/bin/sh -c <string>` | None | existing `HOME`, then `/tmp` |

No lifecycle diagram change: Windows sessions intentionally stay `Unverified`; Unix adapter state machine is unchanged.

## Related code files

- Modify `server/src/api/terminal.rs:147-208` — `resolve_terminal_cwd`; add private cfg-gated untargeted default helper. Extend Windows test module at `:344-361`.
- Modify `server/src/pty/manager.rs:1050-1055` — initial builder call only.
- Modify `server/src/pty/manager.rs:3180-3317` — `respawn_internal`; remove duplicated executable/argv/cwd construction and call shared builder.
- Modify `server/src/pty/manager.rs:3545-3604` — `normalized_command_cwd` and `build_command`; accept `command`, `cwd`, `env` fields usable by both option types.
- Extend `server/src/pty/manager.rs:3778+` — platform-gated pure `CommandBuilder` assertions using `get_argv()` and `get_cwd()`.
- Modify `server/src/pty/shell_integration.rs:58-82` — `interactive_shell_executable` platform gate; non-Windows body retained.
- Modify `server/src/pty/shell_integration.rs:92-146,416-455` — Windows no-adapter behavior and positive-test gates.
- Intentionally unchanged: `server/src/pty/manager.rs:47-68,3606-3640` env baseline/application; API schema/router/error mapping; session/persistence types.

## Implementation Steps

1. **Lock a platform-specific free-terminal cwd helper.**
   - In `terminal.rs`, add `default_untargeted_terminal_cwd() -> Result<String, ApiError>` near `resolve_terminal_cwd`.
   - `#[cfg(not(windows))]`: return the current expression exactly: process `HOME`, otherwise literal `/tmp`.
   - `#[cfg(windows)]`: call `dirs::home_dir()`, retain only `is_dir()`, then `std::env::current_dir()` retained only when `is_dir()`; convert the winner lossily to owned string. If absent, return generic `AppError::PtyError("Unable to resolve a valid Windows terminal cwd")` through `ApiError::from_app`.
   - For `target == None`, return an explicit requested cwd unchanged; call helper only when omitted. Do not touch target/project branch lines 157-207.
2. **Make command construction callable by both option types.**
   - Change `build_command` to take `command: &str`, `cwd: &str`, and `env: &HashMap<String, String>` (or the minimal equivalent fields), not a create-only struct.
   - Use compile-time `#[cfg(windows)]` and `#[cfg(not(windows))]` blocks so Unix decision code remains visibly isolated.
   - Windows args: none for `command.is_empty() || command == "bash"`; otherwise `vec!["/C", command]`.
   - Non-Windows: copy existing exact Bash, absolute `SHELL`/Bash fallback, and `/bin/sh -c` decisions.
   - Keep `normalized_command_cwd` and one `cmd.cwd(...)` call inside the helper.
3. **Cut both spawn paths over atomically.**
   - Update `create_with_buffer` at current line 1051 to call the new helper.
   - In `respawn_internal` lines 3271-3298, retain integration preparation, delete the inline `CommandBuilder` tree plus direct cwd assignment, and call the same helper.
   - Keep `apply_child_env` and `integration.apply` ordering identical in both paths.
4. **Disable Unix shell integration at the resolver edge on Windows.**
   - Provide a `#[cfg(windows)]` `interactive_shell_executable` branch returning `None` without inspecting paths or creating temp artifacts.
   - Retain current resolver body under `#[cfg(not(windows))]`; `ShellIntegration::prepare` then naturally returns `None` before asset/temp-file work.
   - Gate existing positive adapter tests to non-Windows. Add a Windows negative test for empty, `bash`, and ordinary commands.
5. **Add pure unit regression tests adjacent to helpers.**
   - `terminal.rs` Windows test: omitted-default helper yields an existing directory and is not `/tmp`; do not mutate process env/current dir.
   - `manager.rs` Windows tests: `get_argv()` is `["cmd.exe"]` for empty and `bash`; `["cmd.exe", "/C", "echo windows"]` for one-shot; `get_cwd()` is the normalized supplied cwd.
   - `manager.rs` non-Windows tests: pin existing argv for explicit Bash, configured interactive shell, and `/bin/sh -c`; these are Linux-preservation tripwires.
   - `shell_integration.rs` Windows test: all selection calls return `None`; existing Unix positive tests remain intact.
6. Review the source diff before Phase 02: no second executable/argv decision tree, no env constant edits, and no changes outside named files.

## Todo list

- [x] Add cfg-gated free-terminal cwd helper.
- [x] Preserve explicit and target-scoped cwd branches.
- [x] Generalize `build_command` to minimal shared inputs.
- [x] Replace create and respawn construction with shared helper.
- [x] Disable shell adapter resolution on Windows.
- [x] Gate existing positive adapter tests correctly.
- [x] Add Windows and non-Windows pure unit contract tests.
- [x] Confirm env, auth, session metadata, and persistence code untouched.

## Success Criteria

- Pure Windows tests prove valid non-`/tmp` cwd, interactive `cmd.exe`, `/C` one-shot argv, normalized cwd, and no shell adapter.
- Pure non-Windows tests define tripwires for the current executable/argv and adapter contracts; execution remains covered by the open Linux gate in Phase 02.
- `respawn_internal` contains no independent `CommandBuilder::new` or platform decision tree.
- `create_with_buffer` and `respawn_internal` keep env then integration application ordering.
- No schema, auth, target sandbox, persistence, diagnostics, or frontend change.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Treating literal `bash` as one-shot on Windows | Immediate shell exits/failure | Exact selector case is interactive in decision table and tests |
| Create/respawn drift remains | Restart-only regression | One helper; remove inline respawn tree; source review |
| Unix behavior changes during refactor | Linux regression | Separate cfg branch; pin argv tests; Linux gate in Phase 02 |
| Global env mutation makes tests flaky | Suite instability | Test real resolved directory; never set/unset `HOME` or current dir |
| Quoting behavior changes | Command injection/compatibility change | Pass original string as one `/C` argument; no re-parsing or concatenation |
| No valid Windows directory | Spawn still fails opaquely | Detect before portable-pty; generic established PTY error class |

## Security Considerations

- This endpoint stays behind existing auth. No new permission or command source.
- `/C` preserves the already accepted command-string trust boundary; do not add interpolation, quoting, or logging of command contents.
- Keep target/cwd containment checks exactly as-is for project/worktree sessions.
- Do not broaden inherited environment, expose env values, or add `SystemRoot`/`PATHEXT` policy in this fix.
- Windows no-adapter path avoids temp script creation and nonce injection for an unsupported shell.

## Next steps

Proceed to [Phase 02](./phase-02-verify-windows-terminal-regression.md) only after the shared helper and platform unit contracts are complete. No blocking design questions remain; original request cwd/HOME details are an evidence gap, not an implementation dependency.
