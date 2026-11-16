# Phase 03 — Tab-scoped root resources: code review

## Assessment
**Score: 5/10. Changes requested.** Tuple identity, owner-qualified GETs, native-key admission, decimal revision comparisons, suppression retention and explicit viewer retry are sound directions. Four lifecycle gaps prevent phase acceptance. Findings below are static code-path evidence; runtime consequences marked `[INFERENCE]`, not reproduced by this reviewer.

## Critical issues
- None established: no confirmed credential crossover, injection or data loss in reviewed changes.

## Warnings / required corrections

### H1 — Reconnect can replay an unresolved create (High; high confidence)
- Evidence: `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx:1214–1263,1316–1326`; supporting `browser/browser-create-lifecycle.ts:80–93,111–118,188–195`.
- Root create effect depends on `owner`, but a pending tab remains `creating`. Reconnect changes generation and invokes dispatch again for the same tab/action. Dispatcher single-flight key includes generation and allocates another operation/creation key. An already-dispatched first POST need not have settled.
- `[INFERENCE]` One explicit intent can create two native pages; uncertain creation gets replayed rather than retained as unknown. Late cleanup does not make duplicate dispatch safe.
- Correction: root lifecycle must retain the original operation/promise across reconnect, retire publication by generation, and expose unknown disposition without replay. Preserve immutable intent/key; generation change is not a fresh user intent. Add deferred POST → disconnect/reconnect → exactly one POST regression, including original completion after tab removal.

### H2 — Terminal/runtime invalidation does not retire attachments (High; high confidence)
- Evidence: `BrowserStreamKeepAliveHost.tsx:579–607,659–714,815–825,1035–1083,1574–1583`; real controller `packages/ui/src/browser-host/stream-controller.ts:275–284,787–824`.
- `canStreamTab()` without credentials rejects only closing phases, not non-running snapshots/unavailable state or attached-runtime mismatch. Synchronous invalidation resets audio/gesture on identity changes but closes sockets only when this predicate becomes false. React effective visibility also accepts unavailable tabs; attach effect does not depend on snapshot runtime/status.
- `[INFERENCE]` A pushed lost/closed/closing snapshot, or same-session runtime replacement, can leave the old attachment/controller authority locally alive until server teardown; runtime replacement has no local reconnect/retirement path. This violates immediate attachment invalidation, even if server cancellation eventually closes sockets.
- Correction: separate eligibility to GET a known ID from validity of an attached live viewer. On terminal/runtime mismatch, synchronously retire current subscription, paired sockets, held input, lease, dialog and pending credentials; do not auto-create or loop retry. Extend existing terminal tests (`BrowserStreamKeepAliveHost.test.tsx:519–535`) to assert socket retirement, not just tab metadata/counts.

### H3 — Stable input controller keeps initial connection generation (High; high confidence)
- Evidence: `BrowserStreamKeepAliveHost.tsx:522–528,543–551,984–985,1170–1198`; `packages/ui/src/browser-host/input-controller.ts:120–121,184–187`.
- Controller is constructed once, retaining `isInputAllowed: () => canStreamTab()` from its first render. `canStreamTab` closes over that render's owner; later effects deliberately preserve the controller, not its callbacks.
- `[INFERENCE]` After successful reconnect/ticket reattachment, keyboard/IME still checks the obsolete generation and rejects input. Mounting before verification can capture generation zero with the same outcome.
- Correction: stable controller callbacks must dereference current authority through a live ref, while still checking exact attached subscription/session/runtime. Preserve controller identity. Test generation advance followed by actual text/key dispatch, not only new ticket counts.

### H4 — Returning to a tab does not restore current dialog state (High; high confidence)
- Evidence: `BrowserStreamKeepAliveHost.tsx:850–864,1110–1120,1391–1423`; `browser-session-sync.ts:129–136`; supporting `packages/ui/src/api/browser-host-types.ts:95–110`, `server/src/browser_host/session.rs:160–173,242–261`.
- Hide clears `activeDialog`; reactivation GET consumes URL/status but never hydrates the server's current `dialog` summary. Frontend session DTO omits it and sync reconstructs a snapshot without it. Only a future `dialogOpened` event can repopulate the modal.
- `[INFERENCE]` Switching away from an unanswered prompt and returning can strand a native modal with no corresponding response UI. Phase 03 explicitly requires fresh dialog/control state rather than stale replay.
- Correction: consume the existing server dialog summary during owner/runtime/subscription-fenced activation and subsequent snapshots; validate response handlers against the captured dialog authority and current visibility/privacy. No backend redesign needed. Add open dialog → hide → return, and dialog closed while hidden cases.

### W1 — Acceptance coverage narrower than names imply (Medium)
- `BrowserStreamKeepAliveHost.test.tsx:571–651` checks tab switches, not placement remount/reparent/minimize/desktop moves; no proxy identity assertion. No host test exercises explicit create/reconnect ownership above.
- `browser/browser-popup-tabs.test.ts:154–159` changes requested popup ID without changing the current opener snapshot link; rejection can occur before validating the intentionally wrong parent. This does not isolate parent verification.
- Add targeted deferred/authority tests for H1–H4, actual placement transitions/proxy identity, late popup admission after selection/owner/runtime change, and final-close gate activated while GET/tickets are already pending. Use matching current links when testing child-parent/runtime rejection.

## Suggestions
- Bound popup bookkeeping to live window/opener lifetimes: `browser/browser-popup-tabs.ts:21–24` retains admission/dismissal/link entries indefinitely. Keep tombstones for live openers; release them when those immutable IDs are retired.
- Preserve existing module boundaries; prefer small current-authority predicates/ref bridges over a stream-controller rewrite or new lifecycle abstraction.
- BrowserApp still uses flat state (`apps/BrowserApp.tsx:197–207,298–318`). Full chrome/producer migration is explicitly Phase 04 (`phase-04-native-chrome-and-launches.md:5–22`), not an extra Phase 03 defect. Do not describe current production Browser UX as qualified before that cutover.

## Reviewed files / coverage
All seven requested files inspected (~4,000 scoped lines, including complete sync/popup/host implementations and tests; BrowserApp tuple-related diff and surrounding authority code):
- `packages/ui/src/os/browser-session-sync.ts`
- `packages/ui/src/os/browser-session-sync.test.ts`
- `packages/ui/src/os/browser/browser-popup-tabs.ts`
- `packages/ui/src/os/browser/browser-popup-tabs.test.ts`
- `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx`
- `packages/ui/src/os/BrowserStreamKeepAliveHost.test.tsx`
- `packages/ui/src/os/apps/BrowserApp.tsx`

Supporting evidence: both assigned plan/design documents; Phase 04 boundaries; README; `docs/code-standards.md:18–50`; `docs/project-overview-pdr.md:87–93`; browser admission/create/owner helpers, tab types, real stream/input controllers, API DTOs and server dialog/terminal-socket contracts. Code-review skill and published development workflow read. No source/test/plan edits; only this requested report written. Phase TODOs remain unchecked; acceptance incomplete for findings above.

## Validation commands / results
- Reviewer executed scoped `git diff --stat`, `git diff --numstat`, and `git diff -- packages/ui/src/os/apps/BrowserApp.tsx`: exit 0; inspected changes. Static source/test inspection completed.
- **Tester-reported, not rerun here:** `plans/reports/tester-261111-1607-phase-03-tab-root-resources.md:14–18,24–30` records:
  - `pnpm --filter @dam-hopper/ui build`: exit 0, TypeScript compilation clean.
  - `pnpm --filter @dam-hopper/ui test src/os/browser-session-sync.test.ts src/os/browser/browser-popup-tabs.test.ts src/os/BrowserStreamKeepAliveHost.test.tsx src/os/browser/ src/os/persistence.test.ts`: exit 0; 12 files, 99 passed, 0 failed/skipped.
- No reviewer builds/tests/lint executed; validation belongs to main/tester. Passing existing tests does not cover findings above. Type/test coverage percentages unavailable; lint not assessed. Live browser/real-socket/visual qualification remains Phase 05.

## Unresolved questions
- None needed to act on these corrections. Reproductions/new regression evidence remain outstanding; this is not full-app acceptance.
