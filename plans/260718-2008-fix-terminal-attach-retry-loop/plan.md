# Terminal attach recovery loop

Date: 2026-07-18 · Completed: 2026-07-18 22:52 +07 · Status: completed

## Preflight contract

- **Output:** a tested client-side terminal attach/recovery lifecycle.
- **Acceptance:** one attach/recovery flight per session; missing/delayed buffer cannot recurse immediately; retries use a bounded exponential delay with a capped maximum interval and continue at that low rate; pending work cancels on buffer, disconnect, and unmount; a confirmed-dead session is created at most once; restoration still mounts every live terminal; timeout diagnostics are bounded and accurately named.
- **Scope:** `TerminalPanel`, a pure attach-recovery helper and unit tests, plus existing restoration tests. No server, protocol, auth, database, or visual redesign.
- **Risks/contracts:** async timers, stale promise results, status reconnects, React cleanup, and concurrent recovery signals. Public APIs and persisted data are unchanged.
- **Expected touch points:** `packages/ui/src/components/organisms/TerminalPanel.tsx`; new `packages/ui/src/lib/terminal-attach-recovery-controller.ts` and test; `terminal-auto-attach` and `TerminalKeepAliveHost` tests as regression coverage.
- **Testing:** Vitest fake timers for controller paths; restoration regression test; UI typecheck and relevant UI test suite.
- **Open questions:** none. Use a small capped retry budget/delay defined in the helper; keep values private until implementation validates UX.

## Phases

| Phase | Status | Outcome |
| --- | --- | --- |
| [01 — Recovery controller](phase-01-recovery-controller.md) | completed | One cancellable, bounded per-panel recovery state machine. |
| [02 — Terminal integration](phase-02-terminal-panel-integration.md) | completed | Replaced recursive attaches without changing restoration behavior. |
| [03 — Verification](phase-03-tests-and-validation.md) | completed | Focused controller/restoration tests: 20 passed; UI TypeScript build passed; full UI Vitest: 113 files / 610 tests passed; reviewed and approved. |

## Side-effect review

- [x] Auth/permissions: not involved.
- [x] API/client compatibility: reuse existing `terminal:attach`, status, and `terminal:listDetailed` contracts.
- [x] Data/migrations: none.
- [x] Security/privacy: diagnostics retain only session/retry metadata; do not add terminal data or secrets.
- [x] Performance/concurrency: only one timer and one liveness check per mounted session; stale callbacks become no-ops.
- [x] Docs/config/deploy: no user-facing contract change expected.

## `/code` handoff

Implement phases in order. Run the focused Vitest tests, then `pnpm --filter @dam-hopper/ui test` and the UI typecheck (or the repository-equivalent command). Request code review for race, cleanup, and retry-cap correctness; fix any critical finding and rerun affected tests. No server changes.

## Completion record

- Completed 2026-07-18 22:52 +07.
- Verification: focused controller/restoration tests 20 passed; UI TypeScript build passed; full UI Vitest 113 files / 610 tests passed.
- Review: approved; no outstanding findings recorded.
