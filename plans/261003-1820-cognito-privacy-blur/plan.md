---
title: "Fix Cognito Heavy Blur frosted-glass appearance"
description: "Restore a distinct frosted-glass privacy mask with exact browser style regressions and opaque accessibility fallbacks."
status: completed
priority: P2
effort: 2h
branch: fix/cognito-privacy-blur
tags: [bugfix, frontend, ui, privacy, accessibility]
created: 2026-10-03
---

# Cognito Privacy Mode Heavy Blur

## Overview and evidence

Heavy Blur currently resembles Black Screen: `packages/ui/src/index.css:516-527` combines `blur(40px)` with `rgba(13, 17, 23, 0.82)`. The [debugger report](../reports/debugger-261003-1820-cognito-privacy-blur.md) attributes the flat appearance to excessive diffusion plus only 18% backdrop transmission; its reported screenshot mean is approximately `[12, 17, 24]`. Treat numerical/privacy claims in that report as diagnostic evidence, not guarantees for the new appearance.

Current [browser regression](../../packages/ui/browser-tests/cognito-mode.browser.tsx) at lines 417-437 only checks modifier classes. Keep the existing overlay, shortcut harness, CSS import, and input-isolation coverage; assert actual rendered CSS rather than class names alone.

## Execution

| Phase | Status | Effort | Scope |
|---|---|---|---|
| [01 — Fix, regressions, qualification](#phase-01--fix-regressions-qualification) | Completed | 2h | CSS, existing browser suite, focused docs, requested validation |

One phase, one implementation owner. No separate setup/testing phases, component refactor, new dependencies, backend changes, theme redesign, pixel-analysis tooling, or screenshot-baseline infrastructure. Planner creates this plan only; main agent owns implementation and verification. No Advisor controller run is initialized by this plan.

## Phase 01 — Fix, regressions, qualification

### Requirements and affected files

| Action | Repository path | Change |
|---|---|---|
| Modify | `packages/ui/src/index.css` | Replace the heavy-blur block; preserve its fail-opaque baseline. |
| Modify | `packages/ui/browser-tests/cognito-mode.browser.tsx` | Extend existing style-switch test with computed-style checks; add focused reduced-transparency cascade coverage. |
| Modify | `docs/frontend-components.md:696-701` | Replace stale 40px description with new treatment and both opaque fallbacks. |
| Modify | `docs/CHANGELOG.md` | Add a concise Heavy Blur fix entry under the current date; include only observed validation evidence. |

No source files created/deleted. Intentionally unchanged: `CognitoModeOverlay.tsx`, stores, settings/schema/API, input guard, browser runner config, `docs/system-architecture.md`, and prior sealed Cognito plans. This is a CSS-only rendering change with no component structure or state-flow change; architecture-first guidance explicitly exempts this case. Preserve architecture limits: visual mask, not authentication/redaction; activation remains ephemeral; input/focus isolation, viewport sizing, z-index, notifications, and frozen dismissal chord stay intact.

### 1. Implement exact CSS treatment

Replace the block starting at the fail-opaque comment, leaving `.cognito-mode-overlay` and `.cognito-mode-overlay--black-screen` untouched:

```css
/* Fail-opaque fallback when backdrop-filter is unsupported */
.cognito-mode-overlay--heavy-blur {
  background-color: #000000;
}

@supports ((backdrop-filter: blur(20px) saturate(140%)) or (-webkit-backdrop-filter: blur(20px) saturate(140%))) {
  .cognito-mode-overlay--heavy-blur {
    background-color: rgba(13, 17, 23, 0.52);
    -webkit-backdrop-filter: blur(20px) saturate(140%);
    backdrop-filter: blur(20px) saturate(140%);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
  }
}

@media (prefers-reduced-transparency: reduce) {
  .cognito-mode-overlay--heavy-blur {
    background-color: #000000;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    box-shadow: none;
  }
}
```

Keep the accessibility override **after** `@supports`, outside that block: equal specificity plus later cascade must restore opaque black and clear both filters/highlight. Keep transparency exclusively inside the feature query; unsupported engines must never receive a translucent unblurred mask. Both filter declarations are required for standard and older WebKit engines. No animations or runtime preference listeners.

### 2. Strengthen real-browser regressions

Extend `applies correct CSS classes for heavy-blur and black-screen styles` at lines 417-437, retaining the existing `act`, activation/dismissal sequence, settings updates, and class assertions. Assert overlay presence before `getComputedStyle`; read computed styles again after each activation/style change.

- Current runner is headless Playwright **Chromium via Vitest Browser Mode**, not full-stack E2E. Assert its standard `CSS.supports("backdrop-filter", "blur(20px) saturate(140%)")` support; do not silently skip the regression or let a broken frosted style pass through the opaque fallback.
- Under default/no-reduction preference, assert background exactly `rgba(13, 17, 23, 0.52)`, filter exactly the ordered `blur(20px)` plus `saturate(140%)` treatment, and inset highlight color/alpha, 1px spread, zero offsets/blur. CSSOM may serialize saturation as `1.4`; accept only `blur(20px) saturate(1.4)` or `blur(20px) saturate(140%)`, not merely a string containing `blur`.
- Compare the computed shadow to the equivalent serialized inset shadow (Chromium ordinarily returns `rgba(255, 255, 255, 0.05) 0px 0px 0px 1px inset`); normalize serialization if necessary without weakening numeric checks.
- On Black Screen activation, assert background `rgb(0, 0, 0)`, `backdrop-filter: none`, and `box-shadow: none`. Verify the heavy-blur modifier is absent. This prevents the frosted styling leaking into the opaque style.
- Add one focused reduced-transparency test in this same file. Find the imported stylesheet's actual `CSSMediaRule` for `(prefers-reduced-transparency: reduce)` (walk nested grouping rules if bundling requires it), assert that exact feature/value exists, then save its `media.mediaText`, set it to `all`, activate Heavy Blur, and assert computed opaque black, standard filter `none`, shadow `none`, plus the rule's prefixed filter declaration `none`. Restore `media.mediaText` in `finally`; suite teardown already unmounts/resets runtime state. Assert the rule is found—never fall back to injecting substitute declarations. This exercises the real production override and cascade without runner changes, but is **not** a claim of actual OS-preference emulation.
- Inspect the baseline/feature-query CSS to confirm unsupported-browser fallback remains black and both filter declarations/query alternatives exist; Chromium computed styles do not prove older WebKit/unsupported-engine execution. Do not mock `matchMedia` to claim CSS media coverage: mocking JS does not change CSS evaluation.

Retain all existing input/focus/terminal/toast/audio tests unchanged; no unit-test replacement for browser CSS assertions. No luminance thresholds from the debugger report: content-, viewport-, and engine-dependent; exact style regressions plus visual inspection are sufficient here.

### 3. Reconcile focused documentation

Update the existing frontend-components paragraph to describe 20px blur, 140% saturation, 0.52 tint, subtle inset highlight, and opaque black for unsupported filtering or reduced transparency where that media feature is supported. Preserve the visual-only privacy disclaimer in architecture/configuration documentation. Add the dated changelog entry after implementation; do not announce tests/builds passed until their results exist. No broad document rewrite.

### 4. Qualification — main agent, after all edits

Use installed dependencies and pnpm 10; reuse `packages/ui/vitest.browser.config.ts` Chromium discovery (`BROWSER_EXECUTABLE_PATH` or `BROWSER_CHANNEL` if needed, never both). Run from repository root, sequentially, once after integration:

```bash
pnpm --filter @dam-hopper/ui test
pnpm --filter @dam-hopper/ui test:browser cognito-mode.browser.tsx
pnpm build
```

Record command, exit status, test counts/build result, and any unrelated failure in the main agent's handoff. Root `pnpm build` builds the web app, not the Rust server/native host. Do not add backend/native/full-repo checks to this CSS fix. Existing user-reported failures are ground truth; do not rerun merely to confirm them.

Visual acceptance: inspect a content-rich workspace or the existing browser harness in Chromium with default transparency. Capture Heavy Blur and Black Screen for comparison: Heavy Blur retains soft colored silhouettes rather than a uniformly black field; fine text is obscured; Black Screen stays opaque. Verify activation/dismissal still work. If actual reduced-transparency emulation is available, inspect its opaque fallback too; report whether only the CSSOM cascade test or genuine preference emulation was exercised. Never claim screenshot/security guarantees from computed CSS alone.


### 5. Qualification evidence and status

- **Phase Status:** Completed
- **Automated Validation:**
  - `pnpm --filter @dam-hopper/ui test`: Passed (297/297 files passed, 2,245 tests passed).
  - `pnpm --filter @dam-hopper/ui test:browser cognito-mode.browser.tsx`: Passed (10/10 tests passed).
  - `pnpm build`: Passed (production Vite web build succeeded in 37.59s).
  - `pnpm --filter @dam-hopper/ui build`: Passed (`tsc -p tsconfig.json` 0 errors).
  - `pnpm eslint packages/ui/browser-tests/cognito-mode.browser.tsx`: Passed (0 errors, 0 warnings).
- **Visual Verification:**
  - Real Chromium visual inspection confirmed Heavy Blur renders authentic frosted-glass effect with visible soft silhouettes and obscured fine text; Black Screen remains opaque black.
- **Next Steps:**
  - Phase 01 complete and qualified. Ready for final commit and merge.
### Success criteria, risks, rollback

- Exact CSS values/query and both filter declarations installed; unsupported and reduced-transparency paths remain fail-opaque.
- Browser regression fails for the former 40px/0.82 treatment, missing saturation/highlight, or styling leakage into Black Screen; reduced-transparency override clears tint/filter/highlight.
- Existing input isolation remains intact; all three requested validation commands pass, and visual comparison shows distinct treatments. Failures are resolved or explicitly classified with evidence by main agent before completion.
- Frontend documentation no longer describes 40px; changelog accurately reflects implementation and observed checks.
- Risk: lower tint/blur exposes more macro-level content. Preserve visual-only/non-redaction warning; require visual review, make no universal unreadability claim. Risk: CSSOM mutation leaks between tests; mandatory `finally` restoration. Risk: engine-specific serialization; normalize only equivalent values, not relaxed matches. Reduced blur is not a measured performance improvement until observed.
- Rollback, if needed: revert only this fix's CSS/tests/docs edits together; leave unrelated workspace changes untouched. No migration or persistent-state rollback.

## Unresolved questions

None blocking. `docs/development-rules.md` and project-local `.omp/skills/` are absent; use repository `AGENTS.md`, relevant `docs/code-standards.md`, and directly loaded published planning/UI-styling skills. Exact output paths follow the assignment, not the unrelated suggested plan/current hook timestamp. Tests/build/visual review remain intentionally unexecuted by the planner.
