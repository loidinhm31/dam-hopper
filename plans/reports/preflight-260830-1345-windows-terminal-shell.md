# Preflight Contract: Windows terminal creation 500

## Output

A server-only Windows compatibility fix on `feat/windows-terminal-shell`, with focused platform-gated tests and concise API documentation. Worktree: `G:/ws/sharing/dam-hopper-windows-terminal`.

## Acceptance Criteria

- `POST /api/terminal` with `command: "bash"` and omitted `cwd` succeeds on Windows when launched from a normal user process.
- Windows omitted `cwd` resolves to a valid user/current directory, never the Unix `/tmp` fallback.
- Windows `cmd.exe` does not receive Bash-only shell-integration arguments.
- Windows non-interactive command strings use `cmd.exe /C`; automatic respawn uses identical construction.
- Existing Unix command, cwd, shell-integration, target-validation, auth, and error behavior remains unchanged.
- Focused Windows and existing Unix tests cover the changed observable contracts; server build/tests pass on the available Windows host.

## Scope Boundary

**In scope:** `server/src/api/terminal.rs`, `server/src/pty/manager.rs`, `server/src/pty/shell_integration.rs`, their existing tests, and terminal API documentation if needed to describe the platform contract.

**Out of scope:** frontend transport/UI changes, Linux behavior changes, Git Bash/WSL executable discovery, PowerShell-specific behavior, auth/session redesign, persistence/schema changes, unrelated PTY lifecycle work, and release/deployment changes.

**Decision:** retain the existing product convention that a `bash` request is an interactive shell selector. On Windows it falls back to native `cmd.exe`; adding runtime Bash discovery is a separate product contract and would make availability/non-determinism worse.

## Risk / Public Contract Areas

- **API compatibility:** request and response schemas remain unchanged; only Windows spawn semantics/default cwd improve.
- **Security:** commands remain authenticated local PTY commands; no new permissions or environment values are accepted. Preserve existing target/cwd containment checks.
- **Environment:** Windows uses a valid home/current directory and native command interpreter. Do not broaden env inheritance or log values.
- **Concurrency:** initial create and respawn must share one command-construction path to prevent divergence.
- **Linux compatibility:** preserve Unix branches verbatim behind `cfg(not(windows))`; keep Unix tests and behavior intact.

## Affected Files / Systems

- `server/src/api/terminal.rs`: platform-gated fallback for untargeted omitted cwd.
- `server/src/pty/manager.rs`: shared create/respawn command builder; Windows `cmd.exe` interactive and `/C` execution.
- `server/src/pty/shell_integration.rs`: no Unix shell adapter on Windows; platform-gated tests.
- `server/src/api/tests.rs`, `server/src/pty/manager.rs` tests, `server/src/pty/shell_integration.rs` tests: focused regression coverage.
- `docs/api-reference.md` (optional/expected): document Windows shell/cwd behavior without changing Unix contract.

## Testing Strategy

1. Run focused Rust tests for terminal API, PTY command construction, and shell-integration platform gates on Windows.
2. Run the complete server test suite on Windows after focused tests; inspect failures rather than masking them.
3. Run `cargo fmt --check` and `cargo check`/build for the server.
4. Smoke the actual server route with a Windows `bash` selector request without cwd, observe 200/live PTY, and confirm a representative `echo` command executes under cmd.exe.
5. Review diff for Linux branch preservation, duplicated respawn semantics, secret-safe diagnostics, and docs consistency.

## Open Questions

- The supplied browser trace does not reveal whether `cwd` was omitted or `HOME` was unset; both are handled defensively.
- Real Bash/Git Bash/WSL support is intentionally not introduced; the existing Windows fallback contract is native `cmd.exe`.
