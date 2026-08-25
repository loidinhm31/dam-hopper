# Phase 03 — Tests and validation

## Context links

- [Plan](plan.md)
- [Phase 01](phase-01-recovery-controller.md)
- [Phase 02](phase-02-terminal-panel-integration.md)
- `packages/ui/src/lib/terminal-auto-attach.test.ts`
- `packages/ui/src/components/organisms/TerminalKeepAliveHost.test.tsx`

## Overview

Date: 2026-07-18 · Priority: high · Completed: 2026-07-18 22:52 +07 · Status: completed

## Key insights

The defect is time- and concurrency-sensitive; controller tests with fake timers provide deterministic proof. Existing auto-attach and keep-alive tests protect the requirement that all server-live sessions remain mounted.

## Requirements

- Cover delayed buffer, missing buffer, alive/dead liveness results, liveness failure, reconnect, duplicate reconnect, and unmount/late promise paths.
- Assert exact bounded counts for attach, probe, create, retries, and diagnostics—not only final states.
- Preserve/rest strengthen the existing live-session restoration assertions.
- Run focused tests plus the package typecheck/test commands available in this checkout.

## Architecture

Unit-test the pure controller with injected clock/scheduler and deferred promises. Avoid a real websocket or xterm. Keep restoration tests at their current pure/static-render layer unless an existing panel test harness already supports lifecycle testing.

## Related code files

- New: `packages/ui/src/lib/terminal-attach-recovery-controller.test.ts`
- `packages/ui/src/lib/terminal-auto-attach.test.ts`
- `packages/ui/src/components/organisms/TerminalKeepAliveHost.test.tsx`
- `packages/ui/package.json` and root `package.json` (commands only)

## Implementation steps

1. Use fake timers to prove one timeout/probe is scheduled despite repeated `start`/connected events.
2. Resolve alive checks and advance timers to assert exponential delayed retries reach and stay at the capped maximum interval.
3. Resolve dead checks twice/late to assert one create; deliver buffer or dispose to assert cancellation and no late effects.
4. Verify an empty or normal buffer cancels recovery immediately.
5. Run focused Vitest tests, UI tests/typecheck, then code review the controller’s race and cleanup semantics.

## Todo list

- [x] Add deterministic controller cases.
- [x] Verify auto-restoration remains covered for every live session.
- [x] Run required checks and record exact command results in the implementation report.
- [x] Resolve critical code-review findings and rerun affected tests.

## Success criteria

Tests demonstrate no recursive immediate retry, no duplicate liveness/create flight, and no work after cancellation, while live-session auto-restoration tests stay green.

## Risk assessment

Fake-timer tests can miss unresolved promise ordering; include deferred-promise and late-resolution cases. Do not rely solely on log-count assertions.

## Security considerations

Test fixtures must use synthetic session IDs and exclude real command output, credentials, or terminal buffers.

## Next steps

Handoff to `/code plans/260718-2008-fix-terminal-attach-retry-loop`.

## Completion record

Completed 2026-07-18 22:52 +07.

- Focused controller/restoration tests: 20 passed.
- UI TypeScript build: passed.
- Full UI Vitest: 113 files / 610 tests passed.
- Code review: approved.
