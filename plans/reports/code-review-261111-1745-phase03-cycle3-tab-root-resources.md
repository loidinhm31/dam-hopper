# Phase 03 Cycle 3 — Tab-scoped root resources

## Assessment
**Score: 8/10 — corrections required before declaring all findings closed.** No critical/high implementation defect established in this review. H1 replay protection and H2 runtime retirement materially corrected; H3/H4 now have meaningful input/dialog regressions. W1 only partially resolved; claimed attached-credential dialog guard is absent.

Read-only source/test review; only this requested report written. Phase/task status intentionally unchanged. Findings below are static evidence, not runtime reproductions.

## Critical issues
- None established. No confirmed credential crossover, injection or destructive data-loss defect in scoped changes.

## Warnings

### W1 — Regression claims still exceed exercised behavior (Medium; high confidence)
- **Deferred popup test never starts its deferred GET.** `packages/ui/src/os/browser/browser-popup-tabs.test.ts:177–197` installs an orphan-popup/sibling-only state, then patches missing `tab-opener`. `reconcileOpenerPopupSnapshot` exits at `browser-popup-tabs.ts:146–148` before reaching GET. Its final `detached` assertion passes without exercising generation invalidation of pending admission. Restore a genuine live opener/link first; assert GET dispatch and unresolved completion before changing generation, then verify no insertion/selection change. Replace rather than merely extend this false-positive case.
- **Pruning/deferred selection coverage absent.** The three popup cases contain no retired-opener/window pruning oracle or selection/window-focus change while admission GET is pending. Unfocused immediate admission and parent/runtime rejection are covered; these are not equivalent. Add focused deferred-admission and retired-bookkeeping regressions (including retained live-opener tombstones).
- **H1 narrow settlement ordering absent.** `BrowserStreamKeepAliveHost.test.tsx:839–891` renders the generation change and removes the tab before resolving POST. It covers pending reconnect/no replay and orphan cleanup, but not settlement after connection invalidation **before** the generation-change passive effect, the exact Cycle 2 race. Add that ordering with immutable old/new connection owners, retained-tab `create-unknown`, durable uncertainty and one-POST assertions.
- **Placement and synchronous teardown claims overstated.** Host test `:631–643` makes one combined `mode: "float", maximized: true` change, keeping the identical slot; no separate float/max commits, slot replacement/reparent, minimize/restore or desktop transition. Replacement-runtime case `:967–999` asserts after `await push` and an explicit render, with no held-input/stale-dialog-action oracle. Add actual placement/slot transitions with stable canvas/proxy/controller and unchanged GET/ticket counts; assert runtime socket/authority retirement inside the callback turn before React commit, plus denied stale dialog/input dispatch.
- Impact: green aggregate tests can miss the concurrency/lifecycle failures their descriptions claim to prevent. Passing commands remain valid execution results, not proof of these missing scenarios.

### H2 follow-through — Dialog actions still permit credential-less predicate fallback (Medium; high confidence)
- Evidence: `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx:611–635,1783–1836`.
- Confirm/cancel pass `currentAttachedCredsRef.current ?? undefined` to `canStreamTab`; when credentials are absent, its fallback accepts a live/running tab. Neither handler explicitly requires attached credentials, contrary to the stated Cycle 3 fix.
- Current runtime-replacement branch now clears phase/lease/dialog, so the original H2 path is substantially fixed; no independent runtime bypass reproduced. Nevertheless response authority still relies on those side effects rather than the required positive attachment check.
- Correction: capture `const creds = currentAttachedCredsRef.current`; reject absent credentials before `canStreamTabRef.current(creds)`, retain captured dialog/runtime/lease checks, and use captured current authority for dispatch. Add confirm/cancel denial tests for retired attachment with otherwise-live metadata.

## Resolution / positive observations
- **H1 implementation addressed:** immutable `{ profileId, generation }` dispatch record at host `:1363–1367`; stale-owner disposition precedes guard deletion at `:1402–1423`; generation effect transitions matching intent to `create-unknown` at `:1332–1347`. Deferred POST/no replay/orphan cleanup regression is substantive, subject to W1 ordering gap.
- **H2 retirement addressed:** host `:1127–1149` immediately closes controller visibility, flushes audio, clears attached authority/gesture/proxy/held input/dialog, marks unavailable and releases held lease. Real controller `packages/ui/src/browser-host/stream-controller.ts:787–848` retires both sockets and credentials on hide. Positive dialog guard remains open above.
- **H3 addressed:** stable input controller calls live `canStreamTabRef.current` (`:1291–1294`); test `:893–916` asserts actual post-reconnect `insertText` dispatch.
- **H4 addressed:** sync `:107–114,122–142` preserves/clears server dialog summary; host hydrates after attachment (`:1656–1664`) and from control snapshots (`:1177–1178`). Tests cover snapshot retention/terminal clearing and modal return/response (`browser-session-sync.test.ts:156–161`; host test `:918–964`).
- Owner-qualified GETs, cross-profile native-key admission, independent bigint navigation/viewport comparisons, dirty-draft preservation and geometry reuse retained. No dependencies, background popup viewers or recurring popup polls introduced. Small sync/popup services retain focused boundaries; no controller rewrite needed (KISS/YAGNI).

## Suggestions
- Keep remediation surgical: positive authority guards and precise regressions; no new lifecycle abstraction.
- When canonical API DTO ownership permits, move dialog wire type from OS module augmentation (`browser-session-sync.ts:11–20`) into `api/browser-host-types.ts`.
- BrowserApp flat state/chooser integration remains explicitly Phase 04 (`phase-04-native-chrome-and-launches.md:5–22`); tuple API migration is not production tab-UX qualification. Do not advertise end-to-end tab completion yet.

## Reviewed files / scope
Approximately 5,100 scoped lines inspected, plus supporting sections:
- `packages/ui/src/os/browser-session-sync.ts`
- `packages/ui/src/os/browser-session-sync.test.ts`
- `packages/ui/src/os/browser/browser-popup-tabs.ts`
- `packages/ui/src/os/browser/browser-popup-tabs.test.ts`
- `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx`
- `packages/ui/src/os/BrowserStreamKeepAliveHost.test.tsx`
- `packages/ui/src/os/apps/BrowserApp.tsx` (changed tuple API callsites and surrounding state/action ownership)

Supporting: assigned Phase 03/design, Phase 04 boundary, Cycle 2 review, Cycle 3 tester report, README/PDR/code standards, create lifecycle/owner scope/admission guard, real stream-controller hide, server dialog DTO, connection immutability. Code-review skill/published workflows read. No scoped TODO/FIXME found; plan checkboxes remain pending, intentionally unedited under assignment.

## Validation commands / results
- Reviewer: `git diff --stat`; `git diff -- packages/ui/src/os/apps/BrowserApp.tsx` — exit 0; static code/test inspection completed.
- **Tester-reported, not rerun by reviewer:** `plans/reports/tester-261111-1738-phase-03-cycle3-verification.md:15–19`:
  - `pnpm --filter @dam-hopper/ui build` — exit 0, TypeScript clean.
  - `pnpm --filter @dam-hopper/ui test src/os/browser-session-sync.test.ts src/os/browser/browser-popup-tabs.test.ts src/os/BrowserStreamKeepAliveHost.test.tsx src/os/browser/ src/os/persistence.test.ts` — exit 0; 12 files, 103 passed, 0 failed/skipped (host 30, sync 6, popup 3).
- Reviewer ran no build/test/lint; execution belongs to main/tester. Type/test coverage percentages unavailable; lint not assessed. Live browser/CDP, visual and full-app acceptance not established by these unit/host-double results.

## Unresolved questions
- None requiring product decisions. Missing regression evidence and explicit attached-credential guard are actionable corrections above.
