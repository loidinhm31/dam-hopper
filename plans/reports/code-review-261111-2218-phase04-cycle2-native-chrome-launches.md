# Phase 04 Cycle 2 review — 7/10; changes required

Static post-fix review. Failure impacts below **[INFERENCE]**, traced from current code, not reproduced. No source/plan/task-state edits; no builds/tests rerun. Code-review skill and project rules read. Scope: all 19 changed/added Phase 04 files, focused changed sections/tests plus supporting lifecycle/identity/storage/host boundaries.

## Critical issues

None newly established. Cycle-1 initial owner-mismatched close and inventory-popup provenance defects corrected.

## Warnings

1. **High — control acquisition still races newer acquisitions.** `packages/ui/src/os/apps/BrowserApp.tsx:476–516`: active-tab/viewer/runtime/action fencing added, but no single-flight/control-attempt identity or captured-lease comparison. Control remains clickable while its request awaits. Two acquisitions for the same viewer may complete in reverse order; both satisfy every current guard, and the older response overwrites the newer lease. Server rotates token on each same-viewer acquire (`server/src/browser_host/input.rs:287–311`); root canvas acquisition also writes leases (`BrowserStreamKeepAliveHost.tsx:1940–1962`). Result: stale token published as Controlling; input/renew fails. Serialize/retire acquisitions across toolbar/root handoff, fence publication against current control action/lease; add reverse-resolution regression. **Confidence: high.** Cycle-1 control finding partially resolved; release/renew now compare captured token/runtime, but acquisition ordering remains open.

2. **High — parent-window retry still leaves blockers; settlement failure falsely completes.** `browser/browser-recovery-panel.tsx:45–55,64–86`: parent retry closes each retained tab with a newly generated child operation, rather than reusing the existing child marker. Original unknown child survives, so `childPending` prevents parent finalization, yet caller announces “Window closure reconciled.” Separately, parent settlement rejection is swallowed at line 52, followed unconditionally by risk acknowledgment/window removal (53–54). Thus failed durable settlement can close the shell and report success while its saved group stays blocked. Reconcile exact existing children; make finalization return a proven result; propagate settlement failures and never auto-acknowledge them. Child-specific retry now works on success, but parent-button and storage-failure paths remain broken. Existing regression exercises only child-specific success (`apps/BrowserApp.test.tsx:656–680`). **Confidence: high.** Cycle-1 parent recovery finding partially resolved.

3. **High — fresh Reload/deferred activation bypass navigation retirement.** `browser/browser-navigation.ts:68–96,173–187`: explicit submit now reserves its controller before awaiting recovery lock, correctly fixing that path. Unavailable/capacity/deferred Reload and deferred activation still call `stageTabCreateUnderLock` without a reserved controller. Switch tabs while lock waits: `retireTabNavigation` retires nothing, unchanged actionSequence passes, and old request publishes `creating` after retirement. Root create effect intentionally dispatches regardless of visibility (`BrowserStreamKeepAliveHost.tsx:1324–1394`), so an inactive retired attempt can consume a native target. Give all preparation paths the same per-tab reservation/retirement fencing; test delayed-lock Reload and deferred selection followed by switching. **Confidence: high.** Cycle-1 navigation finding partially resolved across callsites.

4. **Medium — diagnostic privacy fix incomplete.** `apps/BrowserApp.tsx:660–661,686–689` still publishes raw popup/clear errors. Clear status is rendered without masking in `browser/browser-tools.tsx:131–134` and `browser/browser-new-tab-page.tsx:103–110`. A corrupt OS JSON parse can include stored input in its error; toggling privacy or owner mismatch leaves that message visible. `browser/browser-navigation.ts:26–27` bounds messages and replaces lowercase HTTP(S) URLs only, not arbitrary sensitive error payloads; contract requires generic messages/kinds. Use allowlisted bounded diagnostics at every error boundary and mask clear status. New Tab navigation-error masking and generic console warnings are corrected. **Confidence: high.** Cycle-1 error finding partially resolved.

## Resolved Cycle-1 items / positive checks

- Owner-mismatched ×/Delete blocked; handler compares stored/captured owner scope before close staging (`BrowserApp.tsx:356–365`; tab-strip 77–83,108–111).
- Inventory attachment preserves popup kind, opener/admission metadata and deduplicates current-window session IDs (`BrowserApp.tsx:695–719`); projector excludes popup tabs.
- Explicit popup × uses staged close lifecycle; Return to Page remains separate (`BrowserApp.tsx:393–463,592–597`).
- Pending-close focus survives intermediate closing updates (`browser-tab-strip.tsx:41–52`).
- Narrow status no longer hidden (`os.css:388–393`); full responsive qualification remains Phase 05.
- Every new module/test <200 LOC: address 122, navigation 188, navigation tests 148, New Tab 133, recovery 193, strip 125, tools 156. Contract violation corrected.
- `browser:open` / `browser:preview` unified (`OsShell.tsx:467–508,781–782`).
- Canonical launch/portable recipe projection retained; no new recipe app execution, dependencies, global shortcuts, favicon/search requests or fabricated history bounds. Recovery group consume remains fresh-read/locked with local installation and no network inside callback. No new hot polling/animation introduced by chrome.

## Suggestions

- Split the five-concern regression (`BrowserApp.test.tsx:590–681`) into named cases; add delayed release/renew, parent-button retry, settlement failure, and raw-error privacy cases. Selection remains wholly mocked at lines 126–129; do not claim retained selection behavior proved here.
- Rename action-executor test at `action-executor.test.ts:417–475`: requests now overlap, but share one Zustand store; independent-document case is still sequential store reset. Useful unit exclusion test, not concurrent independent-document proof. Keep real two-document evidence in Phase 05.

## Reviewed files

Under `packages/ui/src/os/` (changed sections; tests inspected for affected assertions):
- `apps/BrowserApp.tsx`, `apps/BrowserApp.test.tsx`
- `browser/browser-address-bar.tsx`, `browser/browser-navigation.ts`, `browser/browser-navigation.test.ts`, `browser/browser-new-tab-page.tsx`, `browser/browser-recovery-panel.tsx`, `browser/browser-tab-strip.tsx`, `browser/browser-tools.tsx`
- `action-executor.ts`, `action-executor.test.ts`, `OsShell.tsx`, `os.css`, `deep-links.ts`, `deep-links.test.ts`
- `recipes/schema.ts`, `recipes/schema.test.ts`, `recipes/recipe-engine.ts`, `recipes/recipe-engine.test.ts`

Supporting: browser owner/state projection, recovery store, close/window lifecycle, admission/reference census, popup completion, inventory verification, session sync; relevant root-host/control/API/connection implementation; Phase 04/design/Phase 05, README/PDR/standards. No new TODO/FIXME matches in reviewed production paths. Plans intentionally unchanged: reviewer does not own task state; Phase 05 evidence/docs remain separate.

## Validation commands/results

Evidence: `agent://Phase04TesterCycle2Green` terminal report; **not rerun by reviewer**.

| Command | Reported result |
|---|---|
| `pnpm --filter @dam-hopper/ui build` | PASS; exit 0, 0 diagnostics |
| `pnpm --filter @dam-hopper/web build` | PASS; exit 0, 6119 modules; 2 nonfatal import warnings |
| `pnpm --filter @dam-hopper/ui test` | PASS; exit 0, 396 files, 3870 tests; no failures/skips |
| `pnpm --filter @dam-hopper/ui test --reporter=verbose src/os/apps/BrowserApp.test.tsx src/os/browser/browser-navigation.test.ts src/os/action-executor.test.ts src/os/deep-links.test.ts src/os/recipes/schema.test.ts src/os/recipes/recipe-engine.test.ts` | PASS; exit 0, 6 files, 76 tests |

Tester noted React act-environment warnings and two jsdom navigation diagnostics. Browser/E2E, lint, live CDP/audio, independent-document and human visual acceptance not exercised here. Type/test coverage percentages not measured. Green validation does not cover warning interleavings above.

## Unresolved questions

None requiring product clarification. Phase 05 qualification/human visual receipt remains outstanding, not a Phase 04 code-review substitute.
