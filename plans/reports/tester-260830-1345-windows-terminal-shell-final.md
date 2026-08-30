# Final Windows validation report

Date: 2026-08-30
Worktree: `G:/ws/sharing/dam-hopper-windows-terminal`
Branch: `feat/windows-terminal-shell`
Host: Windows 11 Pro x64

## Focused tests

Executed serially with substring filters so nested unit tests were selected:

- `cargo test child_env_builder_preserves_case_insensitive_windows_path -- --nocapture` — PASS; 1 passed, 740 filtered.
- `cargo test windows_build_command_uses_native_cmd -- --nocapture` — PASS; 1 passed, 740 filtered.
- `cargo test terminal_create_bash_without_cwd_uses_native_windows_shell -- --nocapture` — PASS; 1 passed, 740 filtered.
- `cargo test terminal_create_executes_windows_command_through_cmd_c -- --nocapture` — PASS; 1 passed, 740 filtered.
- `cargo test windows_shell_integration_is_disabled -- --nocapture` — PASS; 1 passed, 740 filtered.

`cargo fmt --manifest-path server/Cargo.toml -- --check` — PASS.

`cargo check --manifest-path server/Cargo.toml --jobs 1` — PASS. Four existing warnings remain in telemetry/tunnel code (`OpenOptions`, `Read`, `path`, `pid`); no new check failure.

## Live smoke

A hub-managed server on port 4813 was exercised in explicitly requested dev mode (`--no-auth`) because this host has no `MONGODB_URI` or `MONGODB_DATABASE` configured. A bearer request using the raw `server-token` signing secret correctly returned HTTP 401; it is not a bearer credential.

The dev-mode live path then passed:

- `POST /api/terminal`, command `bash`, omitted `cwd`: HTTP 200, response id matched, `alive=true`, cwd existed, cwd was not `/tmp`, buffer GET HTTP 200, cleanup DELETE `/api/terminal/{id}/remove` HTTP 204.
- WebSocket `terminal:write` input (`echo WINDOWS_INPUT_SMOKE` plus carriage return) was observed as terminal output; WebSocket opened, three output messages arrived, and cleanup completed with HTTP 204.
- One-shot `echo WINDOWS_SMOKE_OK`: HTTP 200, buffer contained expected output, cleanup HTTP 204.

The server was stopped after the smoke.

## Limitations

The full Windows suite remains the previously observed baseline of 641/667 passing with 26 unrelated Windows fixture/platform failures (POSIX paths, CRLF expectations, and POSIX shell commands). Linux/Unix validation was not available on this Windows host and remains a required CI/runner gate.