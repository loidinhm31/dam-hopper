# Overview access point

Canonical plan: [plan.md](./plan.md).
Branch: `feat/ui-selection-contrast-and-font-system` (assigned base: main).
Status: pending implementation; planning deliverable only.
Estimate: 20h (5h selection + 7h typography + 8h qualification).

## Phase inventory
| Phase | Deliverables | Detail |
|---|---|---|
| 01 | Four selection tokens; six selected-row migrations; global DOM text-selection colors; separate focus | [Selection](./phase-01-selection-contrast-tokens.md) |
| 02 | Seven adaptive typography tokens and line heights; workspace fixed-pixel audit; live Arborist row metrics; editor/terminal isolation | [Font system](./phase-02-font-system-adaptation.md) |
| 03 | Unit/CSSOM/browser/app coverage; full checks; fresh visual evidence; human and code review | [Verification](./phase-03-verification-and-review.md) |

## Execution order
1. Read repository guidance and the complete phase contracts.
2. Implement selection using existing selected state; no new store.
3. Integrate typography in the same shared stylesheet; migrate workspace chrome and tree metrics.
4. Add/update regression tests while implementing; run consolidated qualification after integration.
5. Document actual invariants in existing docs/changelog; require review acceptance before release.

## Required future commands
```bash
pnpm --filter @dam-hopper/ui test
pnpm --filter @dam-hopper/ui build
pnpm --filter @dam-hopper/web build
pnpm --filter @dam-hopper/ui test:browser
pnpm --filter @dam-hopper/ui test:e2e:typecheck
E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e ui-contrast-font-system/ui-contrast-font-system.spec.ts
```
Commands above are planned, not run. E2E requires existing authenticated container fixtures and the new spec described in Phase 03. Preserve capture-disabled CI assertions and mandatory local visual inspection.

## Hard boundaries
- Do not scale `html` font size or root rem layout.
- No new font preference, root synchronizer, backend field, or dependency.
- Preserve `editorFontSize`, `terminalFontSize`, app zoom, profile ownership, terminal keep-alive, worktree/Git target routing.
- Selection marker cannot alter padding/width; keyboard focus must survive selection.
- Arborist row-height changes cannot remount the tree or discard selection/expansion.
- Do not report old screenshots or jsdom as computed-CSS qualification.

## Plan metadata note
Use this explicitly assigned directory, not the session-generated 1227 path. Published activation script was available, but missing `EVCRATE_SESSION_ID` prevented persisted session registration.

## Unresolved questions
None blocking; native smoke coverage must be reported by actual platform.
