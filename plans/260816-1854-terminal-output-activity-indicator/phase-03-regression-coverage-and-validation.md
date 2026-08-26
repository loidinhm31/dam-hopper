# Phase 03: Regression coverage and validation

## Context links

- [Parent plan](./plan.md)
- [Phase 01](./phase-01-activity-store-and-lifecycle.md)
- [Phase 02](./phase-02-runtime-row-presentation.md)
- [Architecture gate](../../docs/system-architecture.md#browser-local-terminal-output-activity)
- [Accepted brainstorm](../reports/brainstorm-260816-1854-terminal-output-activity-indicator.md)

## Overview

- Date: 2026-08-16
- Description: Prove replay/lifecycle correctness, hidden kept-alive behavior, accessibility, and bounded render activity; reconcile docs.
- Priority: P2
- Implementation status: DONE 2026-08-17 01:20:11 +07:00
- Review status: APPROVED; tracking finalized 2026-08-17 01:20:11 +07:00
- Effort: 3h

## Key Insights

- Store tests own deterministic clock behavior; browser tests own actual replay and kept-alive integration.
- Existing replay notification browser coverage is the nearest regression seam and should be extended, not broadly duplicated.
- Full server tests are unnecessary because backend/protocol stay untouched.
- Architecture must be checked after implementation for intended or accidental drift.

## Requirements

- Cover per-ID isolation, fake-timer burst coalescing/expiry, replay gating, disconnect/attach/exit/cleanup, hidden kept-alive sessions, accessibility, and no per-chunk renders/notifications.
- Verify queued live chunks activate after replay; retained buffer alone never activates.
- Verify reconnect allows fresh activation after gray reset.
- Run focused tests first, then proportional UI type/build/browser/doc gates.
- Keep backend/transport/SSE changes absent from the final diff.

## Architecture

Validation uses three layers: pure store fake-timer tests; Runtime component/a11y tests; Chromium replay/keep-alive integration. Final review compares implementation against `docs/system-architecture.md#browser-local-terminal-output-activity` and patches documentation only for intentional design evolution.

## Related code files

- `/home/loidinh/WS/dam-hopper-ws/feat-terminal-output-activity-indicator/packages/ui/src/lib/terminal-output-activity.test.ts` — Create/modify; store clock, isolation, cleanup, notification-count tests.
- `/home/loidinh/WS/dam-hopper-ws/feat-terminal-output-activity-indicator/packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.test.tsx` — Modify; precedence, labels, exact-ID, rerender checks.
- `/home/loidinh/WS/dam-hopper-ws/feat-terminal-output-activity-indicator/packages/ui/browser-tests/terminal-panel-replay-notifications.browser.tsx` — Modify; retained replay, queued live drain, reconnect/attach integration.
- `/home/loidinh/WS/dam-hopper-ws/feat-terminal-output-activity-indicator/packages/ui/src/components/organisms/TerminalKeepAliveHost.test.tsx` — Modify if unit harness can prove hidden mounted panels continue activity and disposal clears it.
- `/home/loidinh/WS/dam-hopper-ws/feat-terminal-output-activity-indicator/docs/system-architecture.md` — Review/modify only for intentional post-implementation drift.
- `/home/loidinh/WS/dam-hopper-ws/feat-terminal-output-activity-indicator/packages/ui/package.json` — Reference only; use existing test scripts, no dependency addition expected.

## Implementation Steps

1. Complete fake-timer store matrix: A/B isolation, empty chunk, first activation, burst refresh without repeated notify, exact expiry, delayed callback, clear/dispose, timer cancellation.
2. Complete Runtime item matrix: receiving, quiet, unavailable variants, stopped precedence, exact-ID subscription, accessible names/tooltips, no chunk-rate rerenders.
3. Extend Chromium replay test: buffer-only stays non-green; queued live output activates only after replay callback/drain; expiry follows latest accepted chunk.
4. Add hidden kept-alive scenario with two mounted sessions: background output updates only its Runtime row; unmount/cleanup removes stale state.
5. Exercise disconnect, new attach/replay, terminal exit, transport replacement, and fresh post-reconnect output.
6. Run focused tests, UI suite, browser suite, type-check, build, lint if affected, and docs validation.
7. Inspect final diff for backend/transport/SSE absence, content retention, per-chunk render paths, and architecture drift.

## Todo list

- [x] Pass store fake-timer and isolation tests — focused UI 26/26.
- [x] Pass Runtime state/a11y/render-count tests — focused UI 26/26.
- [x] Pass replay and hidden kept-alive browser regressions — focused browser 6/6.
- [x] Pass lifecycle cleanup/reconnect matrix — focused browser 6/6.
- [x] Pass type-check, UI tests, browser tests, build, and docs checks — full UI 1,096/1,096; full browser 127/127; UI/root build and lint pass; docs validation warn-only.
- [x] Reconcile implementation with architecture and scope boundary — diff-check pass; no backend/transport/SSE changes.

## Success Criteria

- Required test matrix passes deterministically.
- No subscriber notification or Runtime rerender occurs for every chunk while state remains recent.
- Hidden and visible mounted terminals update independently; disposed sessions leave no stale timer/state.
- Color-independent labels correctly describe receiving, quiet, unavailable, and stopped.
- Final diff contains no backend, WebSocket protocol, SSE, persistence, output-content storage, or new dependency change.

## Risk Assessment

- Browser timing flakes: fake timers own exact 3-second assertions; browser test checks ordered state transitions with bounded waits.
- Hidden-host test may couple to layout internals: assert mount/activity behavior through public rendered state.
- Full browser suite cost: run focused file during iteration, full required suite at completion.

## Security Considerations

- Tests should use synthetic harmless chunks and assert content is absent from store snapshots/diagnostics.
- No server endpoint, auth path, cross-origin policy, or event payload changes require a security migration.
- Review cleanup to prevent memory retention of session identifiers after disposal.

## Validation record

- Full UI suite: 1,096/1,096.
- Full browser suite: 127/127.
- Focused UI: 26/26; focused browser: 6/6.
- UI/root build, lint, and diff-check passed.
- Docs validation warn-only, accepted as non-blocking.

## Next steps

- Implementation plan complete; owning workflow may commit separately.

## Unresolved questions

- None.
