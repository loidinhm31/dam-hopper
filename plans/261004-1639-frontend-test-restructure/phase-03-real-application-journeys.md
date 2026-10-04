# Phase 03 — Convert three cases into real application journeys

## Context links
- [Plan](./plan.md), [isolated services](./phase-02-isolated-application-services.md), [fixture research](./research/application-fixture-feasibility.md), [inventory](./research/browser-coverage-inventory.md).
- [Acceptance matrix](./acceptance-checks.md), [local evidence](./phase-04-local-evidence-and-human-review.md).

## Overview
- Date: 2026-10-05. Priority: P2. Implementation: delivered; final phase closeout pending parent review. Review: 9.2/10; no critical or must-fix findings.
- Replace three component harnesses with actual web navigation/control/persistence journeys. Preserve unique low-level browser checks in component layer, not a synthetic shell.

## Key Insights
- Privacy case constructs a fake header/sidebar/content and toggles Zustand directly; advisor case mounts RouteFieldset; evaluations case injects AppState into EvaluationsView.
- Existing cognito component coverage already exercises input/focus/portals/notifications/audio/shortcut ownership; retain useful distinct browser regressions.
- Existing advisor-routing component suite exercises real backend read/validation/cancel/save/readback but not real application gating/navigation/host layout.
- Application Advisor is native to Workspace, local tab navigation; no legacy standalone plugin route or iframe.

## Requirements
- Standard `<case-name>.spec.ts` in same existing case directories; tests import extended Playwright `test`/`expect` fixture.
- Start from real application URL with isolated profile/session data; select project and navigate through user-visible controls. No `createRoot`, `page.setContent`, AppState/provider/store injection or intercepted application APIs.
- Stable role/label selectors first. Use CSS/data hooks only for geometry/readonly observation where no accessible contract exists. No arbitrary sleeps or force-clicks to conceal noninteractive controls.
- Assert real outcomes before/after screenshots. Local screenshots cover actual shell + affected state; CI executes exact same actions/assertions without images.
- No production fix hidden in testing restructure. If real journey exposes a consumer bug, reproduce and fix narrowly with regression proof, not assertion weakening; document scope impact.

## Architecture
### Privacy Heavy Blur
1. Load connected fixture project in actual Workspace; open deterministic file or a real editable application surface. Confirm original content and surrounding shell before masking.
2. Navigate `/settings` → Appearance; use `button[aria-label="Cognito Mode style"]` to select Heavy Blur. Verify applied setting via normal readback/reload where relevant; return to `/workspace` and focus real editable surface.
3. Activate configured `Mod+Alt+KeyB` chord using Playwright keyboard. Assert overlay bounds cover viewport and underlying routed content stays mounted/inert; focus trapped at mask sink.
4. Attempt coordinate pointer input on underlying real action, printable typing and app navigation shortcut. Assert underlying value/route/observable backend state unchanged. Locator.click on inert content only times out; use actual coordinate events to exercise guard without forceful DOM click/dispatch.
5. Wrong chord/Escape must not dismiss. Capture full masked application at primary checkpoint. If blur makes context ambiguous, add named unmasked-before checkpoint of same app/run; never fabricate visible shell beneath it.
6. Original chord dismisses; real input/click action works again. Reload starts inactive. No claim that blur redacts secrets or covers browser/OS chrome.

### Advisor Model Dropdown Theme
1. Start connected fixture project; choose matching Settings profile and expand Native Advisor; enable via `aria-label="Toggle native advisor"` (initial seed disabled).
2. Navigate `/workspace`, click ActivityBar “Advisor”, then in-panel Configuration tab → Edit Routing (`aria-label="Edit Routing Policy"`). No standalone/plugin route.
3. Wait for real model API/catalog readiness; fallback catalog intentionally deterministic and labeled fallback. Use Backend, Model, Effort controls for a distinct valid primary/backup draft; verify current form selection and Save availability.
4. Capture editor inside application shell at meaningful ready checkpoint; extra saved-summary checkpoint if required to prove saved state.
5. Save Routing; verify displayed committed revision/values. Independent authenticated API read plus policy-file read must match intended routes and changed revision; non-route wait/history fields unchanged. Browser reload/reopen retains saved values.
6. Keep duplicate/cancel/cancellation/component focus checks in existing browser suite rather than duplicating every edge in this one application case. Human review evaluates actual theme and menu/control visibility; no exact-class/border-radius constants as primary acceptance.

### Counsel Evaluations Responsive
1. Enable/open actual Workspace Advisor and choose Evaluations. Seed a real non-symlink `.evcrate/advisor-history` directory for capability availability; place valid documents under `.evcrate/advisor-evaluations`, not history. Use live list/read/compare revisions and configured project binding.
2. Observe two known descriptor identities/counts from real files, not a title-only/copy assertion. Use Inspect Descriptor and Compare Available Descriptors; assert actual detail/comparison provenance and expected seeded groups/result.
3. Fixed wide application viewport 1440×900, DPR 1, UTC, stable locale; shell/project/editor visible. Drag actual right resize handle to 320px dock width and assert achieved width within 1 CSS px. `IdeShell` permits 180px minimum / 260px default; additionally exercise 200px near-minimum width if relevant actions/rendering change, recording a named checkpoint. Measure `workspace-advisor-host`/`.native-advisor`; never force production DOM styles or replace container.
4. Assert header/actions/cards/details remain inside panel horizontal bounds; no document horizontal overflow or clipped/off-panel actions. Vertical scrolling is allowed and exercised to reach content/actions. Check wide and narrow layout states; floating native select popups aren't reliable screenshots of page-painted content.
5. Capture complete application viewport at narrow checkpoint as `screenshot.png`; add `wide-panel.png`/`inspection.png` only if necessary. Screenshot includes navigation and surrounding panels, not a 320px component on a blank viewport.
6. Preserve narrow-container browser component regression only if it tests a distinct browser boundary not now covered by E2E/unit tests; improve behavior/bounding-box assertions, not duplicate descriptor-count/text checks.

## Related code files
- Replace `packages/ui/e2e/privacy-heavy-blur/privacy-heavy-blur.e2e.tsx` with `privacy-heavy-blur.spec.ts`.
- Replace `packages/ui/e2e/advisor-model-dropdown-theme/advisor-model-dropdown-theme.e2e.tsx` with `advisor-model-dropdown-theme.spec.ts`.
- Replace `packages/ui/e2e/counsel-evaluations-responsive/counsel-evaluations-responsive.e2e.tsx` with `counsel-evaluations-responsive.spec.ts`.
- Reuse `packages/ui/e2e/fixtures/{application-fixture,application-data,capture-evidence}.ts`.
- Retain useful `packages/ui/browser-tests/cognito-mode.browser.tsx`, `advisor-routing.browser.tsx`, `workspace-advisor.browser.tsx`; only touch genuinely redundant/incidental checks and misleading capture writes.
- Optional new `browser-tests/counsel-evaluations-responsive.browser.tsx` only after inventory identifies a unique real-browser regression lost by conversion; do not create it automatically.
- Exact current UI control labels/layout hooks identified by fixture research; minimally add accessible label/testId only if no stable existing selector exists, not a separate production testing API.

## Implementation Steps
1. Use existing fixture setup to reach actual app shell/connected project through normal bootstrap; common navigation helpers remain small functions, not page-object class hierarchy.
2. Implement privacy flow and prove blocker/restoration with observable real app state. Capture readiness/checkpoints regardless of whether image policy is enabled.
3. Implement Advisor enablement/navigation/editor flow and independent persistence readback, then browser reload verification.
4. Seed two compatible real evaluation documents with long identifiers for narrow wrapping; navigate/inspect/compare and resize actual application panel; assert geometry/scrollability.
5. Remove all three old `.e2e.tsx` files, fake shells and browser-side screenshot guards. Retain component suite behaviors or port a unique check only with rationale; never keep dead harnesses as aliases.
6. Remove component-to-E2E screenshot write from advisor-routing.browser.tsx. Local component images, if useful, belong under clearly labeled component output, never application case evidence.
7. Execute each real case independently, then all cases on fresh data. Prove measured panel width, actual persistence and input isolation; adjust selectors/fixture defects, not target behavior.

## Todo list
- [x] Actual application privacy journey + input isolation/restoration.
- [x] Actual Advisor routing journey + independent persisted readback.
- [x] Actual Evaluations journey + narrow docked-panel bounds/inspection/comparison.
- [x] Remove obsolete harnesses; preserve only unique useful component checks.

## Implementation and validation (2026-10-05)
- **Review:** 9.2/10; zero critical findings and zero Advisor must-fix items. See [Phase 03 review](../reports/code-review-261005-0005-phase-03-application-journeys.md).
- **Journey outcomes:** A04 privacy 1/1 passed (masked viewport, inert underlying content, blocked coordinate/keyboard/navigation input, restored interaction, inactive reload); A05 routing 1/1 passed (distinct primary/backup values, changed revision, independent API and disk readback, preserved wait/history fields, reload); A06 evaluations 1/1 passed (two seeded descriptors, inspect/compare, narrow dock width and horizontal-bound checks).
- **Validation runs:**

  | Command | Result |
  |---|---|
  | `pnpm --filter @dam-hopper/ui test:e2e` | Pass: 3/3 application journeys, 0 failed (27.3 s). |
  | `pnpm --filter @dam-hopper/ui test:e2e:probes` | Pass: 7/7 fixture probes, 0 failed (32.0 s). |
  | `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | Pass: 0 TypeScript errors (1.11 s). |
  | `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.advisor-routing.browser.config.ts` | Pass: 5/5 specialized Advisor browser tests, 0 failed (2.05 s). |
  | `pnpm --filter @dam-hopper/ui test` | Pass: 2,287/2,287 tests across 300 files, 0 failed (17.40 s). |

- **Aggregate:** 2,302 tests passed, 0 failed; typecheck is not included in the test count. Discovery found exactly 3 application specs and 0 legacy `.e2e.tsx` harnesses; the 7 fixture probes remain a separate run.
- **Layout metric:** A06 asserts the rendered Advisor host is within 1.5 CSS px of the 320px dock target; wide and narrow document overflow, card, header, inspected detail, and compare action bounds are fully asserted. Fresh evidence provenance and human visual approval remain Phase 04 work; passing functional tests do not satisfy that review gate.
- **Non-failing diagnostics:** The unit run emitted two jsdom unsupported-navigation diagnostics; Playwright emitted a `NO_COLOR`/`FORCE_COLOR` warning. No test failures resulted.

Unresolved questions: none. A06's detailed-boundary coverage and Phase 04 evidence/review remain follow-up gates; final phase-closeout status remains with the parent.

## Success Criteria
- A04–A06 pass against normal web/server services; no mounted-component fallback.
- Three canonical cases execute genuine user controls with asynchronous outcome assertions, including independent backend/disk persistence where exercised.
- Main screenshots show affected application states with surrounding layout; fresh images and human acceptance supplied in Phase 04, not inferred from test success.
- Component cases cannot overwrite application evidence; no hard-coded workstation capture path remains in affected frontend test code.

## Risk Assessment
- Existing integrated defects may surface: do not mask by mounting a smaller component or weakening assertions.
- Narrow panel minimum/viewport may differ from old 320px fake harness: measure supported width, record it, and inspect affected responsive threshold. If required width is unreachable through real controls, resolve actual layout requirement rather than style injection.
- Model CLI availability is machine-dependent: sandbox discovery and fallback source assertions prevent accidental personal harness use.

## Security Considerations
Use only seeded non-sensitive content. Preauthenticated session bootstrap belongs in fixture setup, not screenshots/committed auth files. Input-isolation checks observe actual app state; no test-generated security guarantee beyond app-document boundary.

## Next steps
Phase 04 generates final-source local evidence and requires human inspection; Phase 05 qualifies CI/docs. Unresolved questions: none blocking design; actual legal dock width verified during fixture implementation and recorded in evidence.
