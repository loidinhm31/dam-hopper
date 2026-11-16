# Phase 04 Cycle 3 review — 8/10; changes required

Static verification of Cycle 2 fixes and root-host lease fence. No source/plan/task-state edits; no checks rerun. Code-review skill, published project workflows, README, PDR and standards inspected. Runtime failure scenarios below **[INFERENCE]**, traced from source, not reproduced.

## Critical issues

None established.

## Warnings

1. **High — Cycle 2 control-ordering warning only partially resolved; toolbar and canvas still independently acquire the same viewer lease.** `packages/ui/src/os/apps/BrowserApp.tsx:482–527`; `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx:1870–1877,1917–1920,1947–1969`. Toolbar single-flight is component-local; canvas neither observes nor reserves it. Example: click toolbar Control, then canvas while toolbar request awaits. Both capture view-only/undefined lease and submit the same viewer. Server processes toolbar A then canvas B, rotating token twice (`server/src/browser_host/input.rs:287–311`). If A's response arrives first, toolbar publishes A; B's response now fails the new captured-lease comparison and releases B. UI retains A although server accepts neither A nor the now-released B (`input.rs:374–384`). Reverse response order can work, but first-completion-wins is not server lease ordering. Tab-away/back can also permit another toolbar request while predecessor remains outstanding because the local flag resets (`BrowserApp.tsx:166–175`). **Impact:** false Controlling state, rejected input/renew, dropped focusing gesture/typeahead. **Confidence: high. Correction:** one shared owner/session/viewer-qualified acquisition coordinator used by toolbar and root canvas; do not issue a second acquire until the outstanding same-viewer request/retirement settles. Preserve current exact-token release and runtime fences. Add interleaved toolbar+canvas coverage with server-like token rotation and both response orders; manual store insertion of a “newer” token (`BrowserApp.test.tsx:608–618`) does not prove this contract.

2. **Medium — Cycle 2 diagnostic privacy warning still partial: typed API errors bypass generic-message policy.** `packages/ui/src/os/browser/browser-navigation.ts:27–33` returns arbitrary `BrowserHostClientError.message` after a blacklist. That message is directly sourced from JSON `error` (`packages/ui/src/api/browser-host-client.ts:131–147`), not a trusted static operational message. For example, typed error text `payload data:text/plain,private-token /opt/private/key` survives unchanged: `data:` requires no `//`, and `/opt` is not among six path prefixes. Arbitrary payload text without a URL/path also survives. Popup/navigation callers render this output (`BrowserApp.tsx:684–685`; `browser-navigation.ts:145`). The generic Error/SyntaxError fallback and privacy-mode clear-status masks are correct, but do not sanitize typed server payloads. **Impact:** confidential backend/CDP error content can be displayed outside protected mode, contrary to `design.md:109` bounded generic error/kind contract. **Confidence: high. Correction:** map recognized kinds/statuses to static safe diagnostics, unknown typed errors to supplied generic fallback; map known local operational errors to static text too, rather than preserving arbitrary suffixes. Add typed arbitrary-payload/data-URL/path cases.

## Cycle 2 disposition / positive observations

- **High #1:** partial; local repeated clicks, active tab/session attempt identity, stale release and lease replacement guards improved. Shared acquisition warning above remains.
- **High #2:** inspected paths corrected. Parent retry reuses exact existing child `operationId`s before remaining tabs (`browser-recovery-panel.tsx:72–89`). Finalization returns boolean, awaits parent settlement, acknowledges/closes only afterward; rejection reaches visible error handling (`52–63,101–102`). No swallowed parent-settlement failure or unconditional successful message remains.
- **High #3:** corrected. All fresh-create preparation paths reserve an AbortController before lock await; retirement checks before/after lock; selection/New Tab synchronously retire outgoing navigation (`browser-navigation.ts:85–115,183–188`; `BrowserApp.tsx:349–359`). New unavailable/deferred regression covers pending-lock retirement (`browser-navigation.test.ts:149–164`).
- **Medium #4:** partial; raw popup Error/corrupt JSON fallback and both clear-status masks corrected (`BrowserApp.tsx:684–713`; `browser-tools.tsx:132–135`; `browser-new-tab-page.tsx:103–109`). Typed-payload warning above remains.
- **Suggestion #1:** original cross-domain mega-test split into named control/popup/mismatch/recovery/privacy cases. Delayed release added. Delayed renew and actual parent-settlement rejection still not demonstrated; see suggestions.
- **Suggestion #2:** test renamed accurately to overlapping actions/store reset (`action-executor.test.ts:417`); not independent-document proof.
- **Root-host fence addition:** `acquiredLeaseToken` switches provenance from pre-acquire lease to newly stored token before pointer replay/typeahead drain (`BrowserStreamKeepAliveHost.tsx:1897,1917–1920,1966–1982`). Correctly avoids self-invalidating its own successful store write; retained deferred-click test provides happy-path evidence. Does not serialize independent acquisitions; warning #1 remains.
- Architecture/performance/KISS/DRY: canonical state/projection reused; popup authority excluded from portable recipes; no new dependencies, network favicon/search requests, background loops or recipe app execution. Recovery lock remains outside network requests; launch install/consume uses fresh locked state. New production helpers remain <200 LOC (navigation 189, recovery 197). No TODO/FIXME matches in inspected production paths. No additional performance issue established.

## Suggestions

1. Strengthen precise regression oracles: current “settlement rejects” test removes Web Locks before clicking (`BrowserApp.test.tsx:676–683`), so `closeBrowserTarget` fails at its initial `stageRecoveryOperation` (`browser-close-lifecycle.ts:79–88`), never reaching parent `settleRecoveryOperation`. Permit child staging/close/settlement, reject parent settlement only; assert parent marker retained, no acknowledgment/window close/success. Add delayed renew success/failure after lease replacement. Keep selection proof scoped: BrowserApp still mocks the entire selection hook (`BrowserApp.test.tsx:126–129`); Phase 05 retained/live selection evidence remains separate.
2. Update stale inline comment `action-executor.test.ts:463` (“Second independent document”) to “store reset/new local window map.” Renamed test is honest; comment still overstates its boundary. Actual two-document evidence belongs to Phase 05.

## Reviewed files

Changed sections / relevant assertions under `packages/ui/src/os/`:
- `apps/BrowserApp.tsx`, `apps/BrowserApp.test.tsx`
- `BrowserStreamKeepAliveHost.tsx`, `BrowserStreamKeepAliveHost.test.tsx`
- `browser/browser-navigation.ts`, `browser/browser-navigation.test.ts`, `browser/browser-recovery-panel.tsx`, `browser/browser-tools.tsx`, `browser/browser-new-tab-page.tsx`, `browser/browser-address-bar.tsx`, `browser/browser-tab-strip.tsx`
- `action-executor.ts`, `action-executor.test.ts`, `OsShell.tsx`, `deep-links.ts`, `deep-links.test.ts`, `os.css`
- `recipes/schema.ts`, `recipes/schema.test.ts`, `recipes/recipe-engine.ts`, `recipes/recipe-engine.test.ts`

Supporting: browser close/coordinator/recovery/owner/admission/reference-census implementations; `packages/ui/src/browser-host/input-controller.ts`; `packages/ui/src/api/browser-host-client.ts`; server control lease implementation; Phase 04/design/Phase 05 and Cycle 2 report. Plan intentionally unchanged: reviewer does not own task state.

## Validation commands/results

**Tester-reported evidence**, read from `agent://Phase04TesterCycle3Clean`; not executed/rerun by reviewer:

| Command | Reported result |
|---|---|
| `pnpm --filter @dam-hopper/ui build` | PASS; exit 0; 0 diagnostics |
| `pnpm --filter @dam-hopper/web build` | PASS; exit 0; 6119 modules |
| `pnpm --filter @dam-hopper/ui test` | PASS; exit 0; 396 files / 3875 tests; 0 failures/skips |
| `pnpm --filter @dam-hopper/ui exec vitest run --reporter=verbose src/os/apps/BrowserApp.test.tsx src/os/browser/browser-navigation.test.ts src/os/action-executor.test.ts src/os/deep-links.test.ts src/os/recipes/schema.test.ts src/os/recipes/recipe-engine.test.ts src/os/BrowserStreamKeepAliveHost.test.tsx` | PASS; exit 0; 7 files / 111 tests; root-host 30/30 |

Tester reports existing React act-environment warnings, 2 jsdom navigation warnings, Vite mixed static/dynamic import warnings for DiffViewer/ConfigEditor. Lint, browser/E2E, live CDP/audio, independent-document behavior and human visual acceptance unexercised; coverage percentages not measured. UI production tsc excludes test files. Green unit/build results do not exercise warning #1's shared acquisition interleaving. Phase 05 acceptance/docs remain separate, not claimed complete.

## Unresolved questions

None requiring product clarification. Remaining issues are implementation/test corrections; live/two-document/visual qualification remains Phase 05 scope.
