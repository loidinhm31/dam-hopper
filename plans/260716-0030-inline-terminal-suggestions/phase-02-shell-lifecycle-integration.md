# Phase 02 — Verified Shell Lifecycle Integration

## Context links

- [Parent plan](./plan.md)
- [Phase 01](./phase-01-security-containment-and-history-privacy.md)
- [Shell lifecycle research](./research/researcher-01-shell-lifecycle-security.md)
- [VS Code shell integration](https://code.visualstudio.com/docs/terminal/shell-integration)

## Overview

- Date: 2026-07-16
- Description: establish authoritative editable/submitted/opaque shell lifecycle
- Priority: P1
- Implementation status: pending
- Review status: pending
- Effort: 16h

## Key Insights

- Ideal OSC 633 order is `A, B, E, C, D`; `E` carries exact command, `C` closes editing.
- Bare markers are semantic metadata, not a security boundary; per-session nonce reduces spoofing.
- Replay, restart, invalid order, alternate buffer, SSH, and unsupported shells must fail closed.

## Requirements

- Generate a cryptographic nonce for each PTY incarnation; never persist or log it.
- Emit bounded OSC 633-compatible markers from composable shell adapters.
- Validate nonce, order, size, termination, generation, and session server-side.
- Broadcast typed capability/lifecycle events without exposing nonce.
- Capture exact command only from validated `E`; enter opaque state no later than `C`.
- Fresh handshake required after attach/replay, respawn, restore, or integration loss.
- Spike bash, zsh, fish, and PowerShell; merge only validated first-release adapters.

## Architecture

Server owns lifecycle authority because PTY output and sessions are shared by multiple
clients. Shell adapters emit markers; an incremental parser in the PTY reader validates
against internal nonce/generation, keeps raw terminal output intact, and broadcasts a
typed state event. Frontend consumes only `unverified | editing | submitted | opaque`
plus exact submitted command at the validated boundary. Invalid transitions reset state.

## Related code files

- Modify: `/mnt/data/ws/sharing/dam-hopper/server/src/pty/manager.rs` — nonce, shell detection/injection, parser feed
- Modify: `/mnt/data/ws/sharing/dam-hopper/server/src/pty/session.rs` — ephemeral capability/generation state
- Modify: `/mnt/data/ws/sharing/dam-hopper/server/src/pty/mod.rs` — focused module exports
- Modify: `/mnt/data/ws/sharing/dam-hopper/server/src/api/ws_protocol.rs` — typed lifecycle event schema
- Modify: `/mnt/data/ws/sharing/dam-hopper/server/src/api/ws.rs` — event delivery/attach reset
- Modify: `/mnt/data/ws/sharing/dam-hopper/server/src/api/terminal.rs` — server-selected capability
- Modify: `/mnt/data/ws/sharing/dam-hopper/server/src/persistence/restore.rs` — new generation on restore
- Create: `/mnt/data/ws/sharing/dam-hopper/server/src/pty/shell_integration.rs` — capability and adapter selection
- Create: `/mnt/data/ws/sharing/dam-hopper/server/src/pty/shell_lifecycle.rs` — bounded incremental parser/state machine
- Create: `/mnt/data/ws/sharing/dam-hopper/server/assets/shell-integration/` — reviewed shell-specific scripts
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/client.ts` — mirrored lifecycle types
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/ws-transport.ts` — session lifecycle subscription
- Delete: none

## Implementation Steps

1. Validate threat model, first-release shells/minimum versions, and injection permission.
2. Specify event schema, legal transitions, caps, escaping, generation, and reset conditions.
3. Build/fuzz the incremental parser independently from PTY manager.
4. Build adapter spike fixtures against pristine and framework-heavy shell configs.
5. Integrate nonce creation and adapter launch without mutating server process environment.
6. Feed PTY output through validator; preserve raw output; emit safe typed events.
7. Reset on attach/replay, restore, respawn, alternate buffer, malformed marker, or disconnect.
8. Add Rust integration tests for password, silent command, compound/multiline commands, and spoof attempts.

## Todo list

- [ ] Lock protocol and trust model
- [ ] Choose v1 shell matrix
- [ ] Add parser/state tests and fuzz corpus
- [ ] Validate shell adapter composition
- [ ] Integrate nonce per PTY incarnation
- [ ] Add typed WS lifecycle events
- [ ] Verify replay/respawn/restore invalidation
- [ ] Security review marker parsing and logging

## Success Criteria

- Legal shell sequence reaches editing; every illegal/stale sequence reaches unverified.
- `C` makes all subsequent password/REPL/TUI input opaque until a new verified prompt.
- Exact commands round-trip through validated `E`, including whitespace and multiline forms.
- Nonce never appears in SessionMeta, persistence, diagnostics, or logs.
- Unsupported/remote/nested shells do not regain automatic suggestions through timeout.

## Risk Assessment

- Prompt frameworks may overwrite hooks; adapter tests must cover common frameworks.
- Bash DEBUG traps and PowerShell PSReadLine composition are high-risk; fail closed if unproven.
- Parser on PTY hot path must be bounded and allocation-conscious.

## Security Considerations

Nonce is defense-in-depth, not protection from hostile same-user code. Bound every OSC
payload, accept BEL/ST termination incrementally, redact command content from diagnostics,
and never let a marker skip the legal state transition.

## Next steps

Expose stable lifecycle snapshots to the Phase 03 controller; keep Phase 01 containment until then.

## Unresolved questions

- Which shells/minimum versions ship in v1?
- Is hostile same-user marker spoofing in scope, requiring an out-of-band channel?
- Can launch injection add shell args/env by default, or must profiles opt in?

