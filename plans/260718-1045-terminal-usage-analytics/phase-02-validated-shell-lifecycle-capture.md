# Phase 02: Validated Shell Lifecycle Capture

## Context links

- [Parent plan](./plan.md)
- [Repository scout](./scout/scout-01-repository-touchpoints.md)
- [Shell/SQLite research](./research/researcher-01-shell-sqlite-report.md)
- [Existing lifecycle architecture](../../docs/system-architecture.md#inline-terminal-suggestions)
- [OSC 633 reference](https://code.visualstudio.com/docs/terminal/shell-integration)

## Overview

- Date: 2026-07-18
- Description: Emit idempotent privacy-normalized command lifecycle facts from trusted shell markers without changing terminal behavior.
- Priority: P1
- Implementation status: Complete (2026-07-26)
- Review status: Approved (2026-07-26)
- Effort: 32h

## Key Insights

- `ShellLifecycle` already validates nonce/order and strips valid markers.
- Current Bash adapter fails closed on ambiguous syntax; preserve that behavior.
- Current internal `Finished` state is flattened to `unverified` for clients and lacks status.
- Persistence must observe validated events before WS broadcast; client input is never authoritative.

## Requirements

- Extend OSC `D` to carry optional child exit status in Bash/Zsh/Fish.
- Preserve `D` without status as compatible `unknown`, never success.
- Generate new run ID for each PTY incarnation and command sequence per run.
- Measure submission/completion using server UTC plus monotonic duration.
- Normalize command in memory to category, allowlisted executable, argument count, and HMAC fingerprint only.
- Emit coverage/quality for unsupported/ambiguous/incomplete lifecycle.
- Preserve visible output, scrollback, suggestions, replay, IME, and notification behavior.

## Architecture

`ShellLifecycle` returns typed internal events. `PtySessionManager` owns run correlation and calls a cheap non-blocking `TelemetrySink::try_record()`. Existing `EventSink` continues client broadcast with current semantics. A missing telemetry sink is a no-op.

Lifecycle:

```text
Prompt(A/B) -> Submitted(E) -> Executing(C) -> Finished(D;status)
                               | session loss/invalid -> Unknown completion
```

Raw command is consumed by `CommandClassifier::normalize()` and dropped before queueing.

## Related code files

- Modify `/mnt/data/ws/sharing/dam-hopper/server/assets/shell-integration/bash.sh` — preserve `$?`, emit status safely.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/assets/shell-integration/zsh.zsh` — emit completion status without replacing user hooks.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/assets/shell-integration/fish.fish` — emit post-exec status.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/pty/shell_lifecycle.rs` — parse optional status and expose internal finished event.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/pty/shell_integration.rs` — adapter capability/version metadata.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/pty/manager.rs` — run ID, sequence, timing, non-blocking telemetry sink.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/pty/tests.rs` — real PTY/regression coverage.
- Create `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/command_classifier.rs` — bounded conservative normalizer.
- Create `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/sink.rs` — no-op and channel-backed sink trait.

## Implementation Steps

1. Add `Finished { exit_code: Option<i32> }` parser result; accept signed bounded integer only.
2. Update shell scripts so DamHopper completion hook reads status before user hooks can overwrite it; preserve existing hook order and return behavior.
3. Add adapter capability/version to lifecycle state. Do not send nonce or raw command beyond existing client lifecycle behavior.
4. Generate UUID run ID on each spawn/respawn; reset command sequence and lifecycle timing.
5. At validated `E/C`, create pending command in manager memory. At `D`, finalize outcome/duration. On invalidation/exit, finalize as unknown/interrupted only when a validated command was pending.
6. Implement conservative classifier for already-supported simple commands. No shell execution, expansion, environment lookup, or full AST required.
7. HMAC exact bounded normalized bytes with domain `cmd:v1`; zero/drop raw buffer after result creation.
8. Call `try_record` before fan-out. Queue full/unavailable increments safe numeric health counter only.
9. Keep current WS lifecycle mapping unless a separate UI requirement proves a wire change necessary.
10. Add split-byte, BEL/ST, bad nonce, duplicate/reordered/missing markers, alternate buffer, reconnect/replay, respawn, and shell hook tests.

## Todo list

- [x] Cross-shell exit status fixtures pass.
- [x] Run IDs differ on respawn while session ID stays stable.
- [x] Command sequence/dedupe deterministic.
- [x] Classifier stores no raw input.
- [x] Unsupported cases expose partial/unavailable.
- [x] Existing terminal/suggestion/notification tests unchanged.

## Success Criteria

- Supported simple commands yield one internal event with correct status/duration.
- Compound/multiline/nested/unsupported cases never yield fabricated rich events.
- Invalid/spoofed markers remain visible/reset trust as before.
- Queue saturation cannot delay reader thread measurably.
- Secret fixture strings absent from normalized event debug/serde output.

## Risk Assessment

- Hook ordering breaks shell config: fixture scalar/array/plugin hooks and preserve fail-closed fallback.
- Exit status overwritten: capture as first completion action.
- Duplicate on replay: only reader live markers produce events; stable IDs enforce DB no-op later.
- Classifier overreach: allowlist and `other`, never guess complex syntax.

## Security Considerations

- Nonce validation remains mandatory.
- HMAC limits DB disclosure but not same-user/key compromise; document boundary.
- Never trace command, classifier input, fingerprint key, or marker nonce.
- Bounded command/parser size remains enforced.

## Next steps

- Phase 03 wires channel sink to durable worker and schema.

## Unresolved questions

- None blocking; exact shell-hook mechanics are test-driven implementation details.
