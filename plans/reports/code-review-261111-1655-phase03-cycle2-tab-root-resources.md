# Phase 03 Cycle 2 — Tab-scoped root resources

## Assessment
**Score: 7/10 — changes requested.** H3/H4 implementation paths addressed; H1/H2 improved but incomplete; W1 remains open. Popup pruning matches requested lifetime policy. Static review, not runtime reproduction: behavioral consequences below marked `[INFERENCE]`.

## Critical issues
- None established. No confirmed credential crossover, injection or destructive data-loss defect in scoped changes.

## Warnings / required corrections

### H1 — Settlement can erase reconnect replay protection (High; high confidence)
- Evidence: `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx:1307–1350,1385–1400,1443–1454`; supporting `packages/ui/src/os/browser/browser-create-lifecycle.ts:80–93,166–195`.
- `dispatchedTabCreates` prevents replay only while its entry survives. The completion callback deletes it **before** checking captured owner currency. If the original request settles after generation invalidation but before the passive create effect processes that change, publication returns early: tab remains `creating`, original dispatch record is gone. The next effect finds no record and invokes a generation-qualified dispatcher that allocates fresh operation/creation keys. Recovery staging does not reject another marker for the same tab.
- `[INFERENCE]` An uncertain POST can still be replayed after reconnect, creating another native page. This interleaving is narrower than Cycle 1, not eliminated.
- Correction: retain the dispatched-intent disposition across stale settlement until the tab is explicitly moved to `create-unknown` or a new user action retires it. Do not clear the guard before stale-owner handling. Add deferred completion both before and after the generation-change passive effect; assert exactly one POST and retained uncertainty/late cleanup.

### H2 — Pushed runtime replacement closes sockets but leaves stale authority/UI (High; high confidence)
- Evidence: `BrowserStreamKeepAliveHost.tsx:611–635,1109–1161,1724–1734,1753–1805`; `browser-session-sync.ts:79–88`; real controller `packages/ui/src/browser-host/stream-controller.ts:787–848`.
- A same-session `sessionUpdated` carrying a different incarnation/profile epoch is rejected by `expectedRuntime`. The `result === "detached"` branch flushes audio and closes sockets, but does not clear pending credentials, gesture/IME state, lease/controller metadata or dialog; the later cleanup block explicitly excludes detached results. No store identity change or retry is published on this path, so the synchronous store invalidation path cannot finish retirement.
- `[INFERENCE]` Viewer stays stranded with old `live` metadata/dialog and no fresh attachment path until another visibility/connection transition. Dialog response handlers can still pass the credential-less `canStreamTab` fallback using the untouched old snapshot/lease, despite attachment retirement.
- Correction: distinguish genuine replacement-runtime invalidation from ignored stale callbacks; run complete synchronous retirement and publish an honest unavailable/reconciliation disposition for the exact tab. Require valid attached authority for response actions. Add replacement pushed through the actual callback, with held input/dialog/lease, and assert immediate full retirement and no automatic native creation.
- Ordinary terminal snapshots and store-applied runtime replacements now reach synchronous socket teardown; those parts of H2 are addressed.

### W1 — Claimed comprehensive regression coverage is absent (Medium; high confidence)
- `BrowserStreamKeepAliveHost.test.tsx:470–801,824–1099`: no explicit create/reconnect test, no actual text/key dispatch after generation advance, no dialog hydration/hide/return case. Terminal cases at `519–535` assert metadata/counts, not pre-commit socket retirement. Placement case at `571–651` changes tabs only; no slot reparent/remount, minimize/restore, desktop transition or proxy identity oracle.
- `browser-session-sync.test.ts:138–154` names runtime replacement but only exercises terminal `lost`; no dialog assertions anywhere in this suite.
- `browser/browser-popup-tabs.test.ts:133–158` now correctly isolates child parent/runtime mismatches with matching current opener links; pending-GET closing gate also covered at `121–130`. Selection/owner changes during a deferred admission, pending-ticket closing gate and pruning retirement remain unasserted.
- Correction: add behavioral regressions above; make test names and validation report describe exercised assertions only. `plans/reports/tester-261111-1647-phase-03-cycle2-verification.md:25–40,57–78` claims broader H1–H4 coverage than the inspected tests support. Passing commands do not establish those behaviors.

## Suggestions
- Keep the existing small current-authority predicates/ref bridges; no stream-controller rewrite or additional lifecycle abstraction needed.
- Optional ownership cleanup: declare the wire dialog summary in the canonical API DTO module when its allowlist permits, rather than augmenting it from OS synchronization (`browser-session-sync.ts:11–20`). Current augmentation is type-visible; not a compilation defect.
- BrowserApp still consumes/writes flat state (`apps/BrowserApp.tsx:164–207,298–318`); full cutover is explicitly Phase 04 (`phase-04-native-chrome-and-launches.md:5–22`), not a newly added Phase 03 finding. Do not qualify production tab UX before that integration.

## Resolution / positive observations
- **H3:** stable input controller calls `canStreamTabRef.current` (`BrowserStreamKeepAliveHost.tsx:639–640,1274–1277`); initial-generation callback capture removed. Runtime qualification still needs W1 regression.
- **H4:** server dialog summary included via DTO augmentation and preserved/cleared in sync (`browser-session-sync.ts:107–114,122–142`); activation GET and control snapshots hydrate modal (`BrowserStreamKeepAliveHost.tsx:654–681,1160–1161,1625–1633`). Confirm/cancel check tab/runtime/privacy authority; H2 retirement caveat remains.
- **Pruning:** `browser/browser-popup-tabs.ts:27–40,65–66,130–131` removes link/tombstone bookkeeping for retired opener/window tuples on subsequent reconciliation; tombstones for live openers retained, protecting stale rediscovery. No recurring timer introduced.
- Owner-qualified GETs, native-key admission across profiles, independent decimal navigation/viewport monotonicity, dirty-draft retention and geometry reuse remain intact. New sync/popup modules remain below 200 LOC (178/199). No unnecessary dependencies or background popup viewer/polling added.

## Reviewed files / scope
~5,000 scoped lines plus supporting evidence:
- `packages/ui/src/os/browser-session-sync.ts`
- `packages/ui/src/os/browser-session-sync.test.ts`
- `packages/ui/src/os/browser/browser-popup-tabs.ts`
- `packages/ui/src/os/browser/browser-popup-tabs.test.ts`
- `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx`
- `packages/ui/src/os/BrowserStreamKeepAliveHost.test.tsx`
- `packages/ui/src/os/apps/BrowserApp.tsx`

Supporting: assigned Phase 03/design; Phase 04 boundary; Cycle 1 review and Cycle 2 tester report; README; PDR `87–93`; code standards `18–50`; create lifecycle/recovery staging/owner capture; real stream-controller teardown and server/frontend dialog DTOs. Code-review skill and published workflow read. Source/tests/plans unchanged; only requested report written. Phase acceptance incomplete; task state intentionally untouched under read-only assignment.

## Validation commands / results
- Reviewer: scoped `git diff --stat` and `git diff -- packages/ui/src/os/browser-session-sync.ts packages/ui/src/os/browser/browser-popup-tabs.ts packages/ui/src/os/BrowserStreamKeepAliveHost.tsx packages/ui/src/os/apps/BrowserApp.tsx` — exit 0; static implementation/test inspection completed.
- **Tester-reported, not rerun by reviewer:** `plans/reports/tester-261111-1647-phase-03-cycle2-verification.md:15–19` records:
  - `pnpm --filter @dam-hopper/ui build` — exit 0, TypeScript clean.
  - `pnpm --filter @dam-hopper/ui test src/os/browser-session-sync.test.ts src/os/browser/browser-popup-tabs.test.ts src/os/BrowserStreamKeepAliveHost.test.tsx src/os/browser/ src/os/persistence.test.ts` — exit 0; 12 files, 99 passed, 0 failed/skipped.
- Reviewer ran no build/test/lint; execution delegated to main/tester. Type/test coverage percentages unavailable; lint not assessed. Real browser/socket/visual qualification not established by this review.

## Unresolved questions
- None blocking correction. H1/H2 interleavings remain static findings requiring targeted regression evidence; W1 blocks comprehensive-resolution claim.
