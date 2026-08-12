# Phase 01 — Preserve the shared trigger contract

## Context links
- Parent: [plan.md](./plan.md)
- Preflight: `plans/reports/preflight-260812-0151-touch-long-press-right-click.md`
- Scouts: `plans/reports/scout-260812-0151-touch-long-press-right-click.md`, `plans/reports/scout-external-260812-0206-touch-long-press-contracts.md`
- Research: `plans/reports/researcher-260812-0210-radix-context-menu-touch-long-press.md`, `plans/reports/researcher-260812-0210-touch-long-press-pointer-events-retry.md`
- Architecture: `docs/system-architecture.md` §Context-menu placement invariant

## Overview
- **Date:** 2026-08-12
- **Description:** Confirm current composition already supplies touch long-press and preserves the app menu contract.
- **Priority:** P2
- **Implementation status:** Completed 2026-08-12
- **Review status:** Approved — overall review 8.5/10; no blockers

## Key Insights
- Radix owns non-mouse long-press at 700 ms and cancels on movement, pointer cancellation, and pointer-up; its native `contextmenu` path clears the timer.
- `FileTree` keeps the Arborist row as the direct `ContextMenu.Trigger` child and combines drag/forwarded refs. `EditorTabs` wraps each ref-forwarding `EditorTab` directly.
- The app marker must land on that real DOM child because document capture suppresses unmarked `contextmenu` events.
- The architecture gate matches this plan: no second timer/dependency, Explorer/editor-tabs scope, and Monaco text/preview non-goal.

## Requirements
- Preserve `ContextMenu.Root`/`Trigger`/`Portal`/`Content` composition and existing action callbacks.
- Preserve Explorer drag refs, scrolling, click activation, selection, and row-target closure.
- Preserve editor-tab close controls, tab selection, keyboard access, and tab-targeted Close/Close Other/Close All actions.
- Do not broaden language-filter rows, MonacoHost, Markdown/image/video preview, terminal, branch, or other consumers.

## Architecture
`touch/pen pointerdown → Radix's 700 ms trigger policy → existing menu Root/Portal → existing action`; native `contextmenu`, mouse right-click, and keyboard synthesis remain the same paths. The document suppression hook skips only the marked trigger. No app store, global pointer listener, API, or backend flow is involved.

## Related code files
- **Inspect; do not edit by default:** `packages/ui/src/components/ui/ContextMenu.tsx`, `packages/ui/src/hooks/use-browser-context-menu-suppression.ts`, `packages/ui/src/lib/context-menu-trigger-marker.ts`, `packages/ui/src/lib/context-menu-coordinator.ts`.
- **Consumer verification:** `packages/ui/src/components/organisms/FileTree.tsx`, `TreeContextMenu.tsx`, `EditorTabs.tsx`, `packages/ui/src/components/molecules/EditorTab.tsx`, `EditorTabContextMenu.tsx`.
- **Conditional edit only after defect proof:** `ContextMenu.tsx` or the specific consumer; never add a parallel timer.

## Implementation Steps
1. Compare the live trigger/ref/prop flow with the architecture contract and preflight report.
2. Verify enabled triggers carry `data-dam-hopper-context-menu-trigger`; disabled/unconfigured surfaces remain suppressed.
3. Add or run a focused regression that demonstrates the suspected defect before changing runtime code.
4. If no defect is reproduced, leave all application runtime files unchanged. If a defect is reproduced, make the smallest shared-boundary fix, retain Radix as owner, and add a regression for it.
5. Review the diff for accidental `touch-action`, `preventDefault`, propagation, selection, or drag changes.

## Todo list
- [x] Confirm Radix package/lock versions need no upgrade; the locked 2.3.3 implementation retains the 700 ms non-mouse path.
- [x] Confirm direct `asChild` DOM targets forward refs and props; Explorer rows and editor tabs retain marker/ref/prop flow.
- [x] Confirm architecture wording and planned tests agree; Monaco text/previews remain out of scope.
- [x] Reject duplicate timer/global gesture/dependency designs; Radix remains the only long-press owner.

## Completion evidence — 2026-08-12
- Review verified the trigger contract, marker/suppression boundary, Arborist drag ref, editor-tab target identity, one-open coordination, and existing mouse/keyboard/focus/portal/dismissal behavior.
- Focused and serial browser evidence passed; nested touch/pen control guards and active/inactive tab focus semantics were reviewed as local, scoped fixes. No shared timer or global gesture policy was introduced.
- Residual: physical Android Chrome/iOS Safari ordering and native callout behavior remain unverified; Explorer selection semantics for an unselected long-pressed row remain a product follow-up.

## Success Criteria
- Existing Explorer and editor-tab triggers are proven to reach Radix's built-in hold path and marker policy.
- No source runtime change unless a focused test proves a real contract defect.
- No menu action or target semantics change.

## Risk Assessment
- **High:** duplicate timer races Radix/native `contextmenu`; mitigation: one owner.
- **Medium:** broken `asChild` ref/props could lose anchor, keyboard, or suppression exemption; mitigation: direct-target regression.
- **Medium:** Arborist movement/scroll competes with hold; mitigation: verify cancellation without changing touch policy.

## Security Considerations
No auth, authorization, API, storage, or filesystem boundary changes. Do not bypass document suppression globally or expose unmarked native menus. Keep all actions behind existing menu callbacks.

## Next steps
Audit complete. Phase 02 regression coverage and Phase 03 documentation/release validation are complete; retain physical-device validation as a release follow-up.

## Unresolved questions
- Which physical Android Chrome/iOS Safari versions are release blockers, and what native event/callout traces are required?
- Should long-press on an unselected Explorer row preserve current selection or select before opening?
