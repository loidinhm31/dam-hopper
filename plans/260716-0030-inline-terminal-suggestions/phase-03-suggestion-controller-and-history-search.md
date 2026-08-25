# Phase 03 — Suggestion Controller and History/Search Separation

## Context links

- [Parent plan](./plan.md)
- [Phase 02](./phase-02-shell-lifecycle-integration.md)
- [xterm research](./research/researcher-02-xterm-interaction-geometry.md)
- [Architecture contract](../../docs/system-architecture.md#inline-terminal-suggestions-planned)

## Overview

- Date: 2026-07-16
- Description: deterministic session controller, stale-result gates, exact history model
- Priority: P1
- Implementation status: completed 2026-07-16 05:07 +07
- Review status: approved
- Effort: 12h

## Key Insights

- Reconstructing a full shell editor from outgoing bytes is not maintainable.
- Append-only, verified, normal-buffer EOL input is sufficient for safe prefix suggestions.
- Raw command identity and normalized search representation must be separate.

## Requirements

- One per-session controller outside React render state; React consumes immutable snapshots.
- Track session, prompt epoch, input revision, lifecycle, buffer, EOL cleanliness, and query.
- Every input/lifecycle change clears ghost synchronously before debounce.
- Commit/search accept only exact matching epoch/revision/raw input and true prefix.
- Unmodelled edit, completion, paste, IME, cursor move, output ambiguity, or buffer switch suppresses.
- Record exact validated `E` command; derive separate Unicode-aware search tokens.
- Preserve per-project usage without overwriting global command identity.

## Architecture

Create a pure reducer/state engine with `disabled`, `unverified`, `ready-clean`, `querying`,
`ghost`, `opaque`, and `explicit-list` snapshots. A thin terminal adapter converts lifecycle,
input, composition, paste, cursor, and host events into reducer actions. Search requests
carry `{sessionId, promptEpoch, revision, rawInput}`; stale responses are discarded twice:
on result and atomically on accept.

## Related code files

- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/hooks/use-terminal-suggestions.ts` — thin React binding
- Replace/retire: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/prompt-detector.ts` — no lifecycle authority
- Replace/retire: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-input-buffer.ts` — append-only tracker
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/command-history.ts` — exact v2 model/search fields
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/hooks/use-command-search.ts` — reuse shared ranking/query API
- Create: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-suggestion-controller.ts` — reducer/controller
- Create: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-suggestion-input.ts` — safe input classification
- Create: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-suggestion-controller.test.ts` — transition/race tests
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/command-history.test.ts` — v2 fidelity/search/migration
- Delete: none until usages and compatibility tests prove safe removal

## Implementation Steps

1. Specify reducer actions, invariants, prompt epoch, monotonic revision, and snapshot shape.
2. Write transition/property tests, including stale `gi -> git -> Enter` sequence.
3. Implement append-only classifier; mark every ambiguous sequence opaque without emulation.
4. Add versioned debounce/search with synchronous invalidation and atomic acceptance gate.
5. Define history v2: exact raw command, stable id, timestamps/counts, per-project usage, search doc.
6. Implement Unicode-aware prefix-first ranking, then token/BM25 signals; validate storage fields.
7. Route validated lifecycle events and exact `E` commands into the controller/history.
8. Adapt shared command search without duplicating ranking logic.

## Todo list

- [x] Lock controller state/event contract
- [x] Add transition, race, paste, IME, Unicode, grapheme tests
- [x] Implement append-only fail-closed tracker
- [x] Add query revision and atomic accept gates
- [x] Implement exact history v2 and migration
- [x] Make ranking prefix-first and Unicode-aware
- [x] Integrate lifecycle/transport and shared search
- [x] Remove obsolete authority only after coverage

## Success Criteria

- Stale query results cannot render or accept after any revision/lifecycle change.
- Full/partial candidate always starts with byte-exact current input.
- Exact commands preserve whitespace, quotes, multiline, Unicode, and project usage.
- Completion, cursor edit, paste, composition, alternate buffer, and opaque input suppress automatically.
- Controller tests run without React/xterm and cover all legal/illegal transitions.

## Risk Assessment

- JS string prefix is not display-cell width; controller must not solve geometry.
- Existing command-search consumers may depend on current normalized identity; migrate deliberately.
- High-frequency events can rerender excessively; publish only changed immutable snapshots.

## Security Considerations

Never accept lifecycle from output silence or history from outgoing Enter. Keep raw commands
out of logger/diagnostics. Treat malformed localStorage as untrusted input and discard safely.

## Next steps

Phase 04 consumes only immutable `ghost` and `explicit-list` snapshots plus controller actions.

## Unresolved questions

- Exact token boundary for partial acceptance?
- Per-project usage map shape and retention cap?
- Legacy history purge vs one-time confirmation outcome from Phase 01?
