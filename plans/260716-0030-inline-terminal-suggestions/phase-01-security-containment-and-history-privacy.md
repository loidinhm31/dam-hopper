# Phase 01 — Security Containment and History Privacy

## Context links

- [Parent plan](./plan.md)
- [Brainstorm findings](../reports/brainstorm-260716-0030-inline-terminal-suggestions.md)
- [Shell lifecycle research](./research/researcher-01-shell-lifecycle-security.md)
- [Architecture contract](../../docs/system-architecture.md#inline-terminal-suggestions-planned)

## Overview

- Date: 2026-07-16
- Description: remove unsafe automatic activation/recording before replacement work
- Priority: P1
- Implementation status: pending
- Review status: pending
- Effort: 8h

## Key Insights

- 100 ms PTY silence can classify password/REPL/TUI input as shell command input.
- Existing localStorage may already contain sensitive text and whitespace-mutated commands.
- Safe temporary regression is no automatic suggestion; unsafe continuity is unacceptable.

## Requirements

- Remove silence as an authorization signal for suggestions/history.
- Automatic UI and recording stay off until verified lifecycle capability exists.
- Close/toggle/session-dispose synchronously cancel timers and visible state.
- Add clear-history and history-enabled controls with explicit local-storage copy.
- Decide legacy-history disposition before mutation; recommended default is purge with notice.
- Preserve native PTY bytes; containment must not add key interception.

## Architecture

Introduce one fail-closed capability gate consumed by the existing hook. Until Phase 02
provides `Editing`, the gate returns unavailable and skips query/record paths. Keep the
explicit history data API independent so clearing and later migration can ship safely.

## Related code files

- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/hooks/use-terminal-suggestions.ts` — containment gate, cancellation
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/prompt-detector.ts` — remove suggestion authorization role
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/command-history.ts` — clear/disable and migration boundary
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalPanel.tsx` — real dismiss/dispose wiring
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/SettingsAppearanceSection.tsx` — privacy controls/copy
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/stores/settings.ts` — persisted history preference
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/client.ts` — mirrored UI setting if server-backed
- Modify: `/mnt/data/ws/sharing/dam-hopper/server/src/config/schema.rs` — history preference schema if server-backed
- Create: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/command-history.test.ts` — privacy/migration/fidelity tests
- Delete: none

## Implementation Steps

1. Preflight disk space and snapshot overlapping user diffs; rebase plan paths to current code.
2. Add failing tests for password-prompt silence, toggle-off, close, dispose, and no recording.
3. Replace `PromptDetector` authorization with an unavailable lifecycle capability stub.
4. Remove outgoing-Enter recording and ensure pending search cannot render after disable.
5. Add settings actions for clear/disable; make storage failure degrade to empty history.
6. Implement the validated legacy-history policy without attempting to reconstruct lost whitespace.
7. Confirm ordinary terminal input remains byte-for-byte unchanged.

## Todo list

- [ ] Free disk space and reconcile dirty overlaps
- [ ] Lock legacy-history policy
- [ ] Add containment regression tests
- [ ] Disable silence-based activation/recording
- [ ] Fix synchronous dismiss/toggle/dispose cleanup
- [ ] Add clear/disable controls and documentation copy
- [ ] Review privacy and backward compatibility

## Success Criteria

- No input is recorded from sudo/SSH/password, silent command, REPL, or TUI scenarios.
- Setting off, close, session hide, and dispose leave no timer or overlay.
- Tab, Enter, Escape, Ctrl+R, arrows, paste, and arbitrary data reach PTY unchanged.
- User can clear local command history and disable future local persistence.
- Containment tests and existing terminal buffer/detector tests pass.

## Risk Assessment

- Temporary feature loss: communicate automatic suggestions are unavailable pending verified integration.
- Dirty-file conflict: integrate surgically; never reset user changes.
- Legacy purge surprises users: one-time notice and validation decision required.

## Security Considerations

Treat existing history as potentially sensitive. Do not log history values, prompt bytes,
or migration contents. Clearing must remove the actual localStorage key, not only UI state.

## Next steps

Proceed to Phase 02 only after containment tests prove automatic recording is impossible.

## Unresolved questions

- Automatic purge or explicit one-time confirmation for legacy history?
- Keep history-enabled server-backed or browser-local only?
