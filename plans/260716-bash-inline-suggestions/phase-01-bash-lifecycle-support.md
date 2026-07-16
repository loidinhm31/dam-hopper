# Phase 01: Bash Lifecycle Support

## Context links

- Parent plan: [plan.md](./plan.md)
- Selector: [server/src/pty/shell_integration.rs](../../server/src/pty/shell_integration.rs)
- Bash asset: [server/assets/shell-integration/bash.sh](../../server/assets/shell-integration/bash.sh)
- Lifecycle parser: [server/src/pty/shell_lifecycle.rs](../../server/src/pty/shell_lifecycle.rs)
- PTY manager: [server/src/pty/manager.rs](../../server/src/pty/manager.rs)
- Frontend controller: [packages/ui/src/lib/terminal-suggestion-controller.ts](../../packages/ui/src/lib/terminal-suggestion-controller.ts)
- Docs to update: [system-architecture.md](../../docs/system-architecture.md), [configuration-guide.md](../../docs/configuration-guide.md), [ws-protocol-guide.md](../../docs/ws-protocol-guide.md), [project-roadmap.md](../../docs/project-roadmap.md)

## Overview

- Date: 2026-07-16
- Priority: P2
- Implementation status: DONE
- Review status: approved
- Completed: 2026-07-16 18:29:09 +0700
- Description: Implement full Bash lifecycle hook support through the existing nonce-validated server parser.

## Key Insights

- Current client is ready only after matching session/generation lifecycle editing.
- `ShellIntegration::prepare` selects zsh/fish only; Bash returns `None`.
- Existing `bash.sh` emits only `A/B` through `PROMPT_COMMAND`; no `E/C/D`.
- Existing parser and PTY manager already validate, strip, order, and broadcast lifecycle events.
- Bash hook risk is command capture and preserving user `PROMPT_COMMAND`/trap behavior.

## Requirements

### Preflight Contract

- Output: server Bash adapter plus tests and docs.
- Acceptance: Bash emits nonce-valid `A/B/E/C/D`, exact command captured once, no marker leakage, zsh/fish unchanged.
- Boundary: no client shortcut/default-shell/protocol changes; no SSH, subshell, PowerShell, or terminal-byte inference.
- Public contract: existing `terminal:lifecycle` event only: `editing`, `submitted`, `opaque`, `unverified`, `generation`, optional `command`.
- Risk areas: `PROMPT_COMMAND` string vs array, user hooks, command substitution, multiline/compound commands, no-echo/password, vi/readline, TUI alternate buffer.
- Affected files: `server/assets/shell-integration/bash.sh`, `server/src/pty/shell_integration.rs`, Rust tests, four docs listed above.
- Test strategy: Rust unit, real Bash PTY where portable, zsh/fish regressions, frontend tests only if contract changes.

## Architecture

- Add `Shell::Bash` and select it only for empty command sessions with `$SHELL` basename `bash`.
- Use same `ShellLifecycle` parser; do not add a Bash-specific parser.
- Create a Bash rc wrapper that sources user `.bashrc` first, then the DamHopper asset.
- Bash asset responsibilities:
  - capture nonce then unset env var;
  - emit `D/A/B` at prompt boundaries;
  - emit `E;base64url(exact command);nonce` then `C;nonce` before command output;
  - preserve scalar and array `PROMPT_COMMAND`;
  - avoid or strictly guard `DEBUG` trap; fail closed if unsafe.

## Related code files

- Modify: `/mnt/data/ws/sharing/dam-hopper/server/src/pty/shell_integration.rs`
- Modify: `/mnt/data/ws/sharing/dam-hopper/server/assets/shell-integration/bash.sh`
- Modify: `/mnt/data/ws/sharing/dam-hopper/server/src/pty/tests.rs`
- Modify: `/mnt/data/ws/sharing/dam-hopper/docs/system-architecture.md`
- Modify: `/mnt/data/ws/sharing/dam-hopper/docs/configuration-guide.md`
- Modify: `/mnt/data/ws/sharing/dam-hopper/docs/ws-protocol-guide.md`
- Modify: `/mnt/data/ws/sharing/dam-hopper/docs/project-roadmap.md`

## Implementation Steps

1. Extend shell selector with Bash and include Bash asset.
2. Add Bash apply path: interactive shell, rc wrapper, lifecycle nonce env.
3. Replace partial Bash asset with full lifecycle adapter.
4. Preserve user `.bashrc` and `PROMPT_COMMAND`; do not silently overwrite user hooks.
5. Keep malformed/ambiguous lifecycle fail-closed through existing parser reset.
6. Update docs from zsh/fish-only to zsh/fish/bash with caveats.

## Todo list

- [x] Add Bash selection and rc wrapper.
- [x] Implement Bash `A/B/E/C/D` hooks.
- [x] Add selector unit tests.
- [x] Add real Bash PTY lifecycle tests where available.
- [x] Add zsh/fish regression tests.
- [x] Update docs and roadmap.
- [x] Run focused Rust tests, full Rust tests, and web package verification if contract changes.

## Success Criteria

- Bash prompt reaches `editing` after visible prompt output.
- `echo hi` emits `submitted("echo hi")`, then `opaque`, output, and next prompt cycle.
- Compound/command-substitution cases preserve exact command or fail closed.
- TUI/alternate buffer and no-echo cases do not show suggestions.
- zsh/fish tests still pass.

## Risk Assessment

- Auth/session/permissions: none.
- API compatibility: no schema change.
- DB/migrations: none.
- Business logic: command history remains browser-local and lifecycle-driven.
- Security/privacy/logging: nonce never logged/sent; exact commands already part of current submitted event.
- Performance/concurrency: tiny shell hook cost; parser remains bounded.
- Docs/config/deployment: docs must state Bash support limits and manual real-shell gaps.

## Security Considerations

- No command boundary inference from Enter, silence, or replay.
- No marker nonce in output, logs, storage, or client payloads.
- If Bash capture is not exact, do not emit `submitted`.
- User hook conflicts must not change command execution.

## Next steps

- Manual release validation remains: interactive PTY behavior across Bash versions, readline modes,
  password/no-echo commands, TUIs, IME, and screen readers.
