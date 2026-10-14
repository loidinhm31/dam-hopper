# Phase 03 — Verification, visual qualification and code review

## Overview
Priority P2. Status pending. Estimate 8h. Dependency: Phases 01–02 integrated, regression tests implemented. This phase describes future implementation checks; none were executed for the planning-only assignment. Green typechecking or component fixtures cannot certify full-app styling or native platform behavior.

## Context links
[Overview](./plan.md), [selection contract](./phase-01-selection-contrast-tokens.md), [font/row metrics](./phase-02-font-system-adaptation.md), [repository guidance](../../AGENTS.md), [test boundaries](../../docs/testing.md), [code standards](../../docs/code-standards.md).
Existing reference suites: [traditional navigator browser](../../packages/ui/browser-tests/terminal-traditional-projects.browser.tsx), [explorer browser](../../packages/ui/browser-tests/file-tree-language-navigation.browser.tsx), [app zoom browser](../../packages/ui/browser-tests/app-zoom.browser.tsx), [authenticated application journey](../../packages/ui/e2e/traditional-terminal-agents/traditional-terminal-agents.spec.ts).

## Requirements and test architecture
Use existing Vitest unit, Vitest Browser/Playwright, and authenticated application E2E runners. No new test framework, snapshot pipeline, external contrast dependency or fake production success path. Small pure contrast/compositing helpers may live under browser test fixtures if existing helpers cannot be reused; they are not production theme engines.

### Unit tests — contract/state, not CSS layout
Update:
- `packages/ui/src/embed/dam-hopper-app.test.tsx`: real settings store change updates root `--app-font-size`; initial value/hydration update; editor/terminal-only setting edits do not change system variable. Reuse current mocked transport/provider boundary; assert CSS property, not jsdom computed `calc()` sizes. Unmount/restore root property/store values deterministically.
- `packages/ui/src/components/organisms/SettingsAppearanceSection.test.tsx`: System stepper submits only `systemFontSize`; Editor/Terminal steppers remain independent. Preserve source/target tests.
- `packages/ui/src/stores/settings.test.ts`: retain clamping 10–32 and owner-scoped persistence; add isolation assertion if not already covered. No broad settings refactor.
- `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx`, `TerminalRuntimeNavigatorItem.test.tsx`, `ChangedFilesListRender.test.tsx`, `CommitDetailsPanel.test.tsx`: selected/unselected state predicates, class/ARIA mapping where appropriate, no staging/agent cycling/commit multi-select regression. Verify grouped agent row through navigator tests rather than inventing a separate terminal selection model.
- `packages/ui/src/components/organisms/MonacoHost.test.tsx` and `TerminalPanel.test.tsx`: system font changes do not update their configured rendering font size or dispose/recreate their instances; own setting changes still work. Do not assert against a fake CSS-rendered replacement editor/terminal.

Create `packages/ui/src/lib/workbench-typography.test.ts` for Phase 02 helper: 10/14/20/32→24/24/27/41, monotonic height, floor at 24, rounding accommodates calculated line box. This tests the numeric helper only; real row content fitting remains a browser gate.

### Browser component regressions — generated CSS and real interactions
Create `packages/ui/browser-tests/ui-contrast-font-system.browser.tsx` using existing createRoot/act cleanup conventions and importing real `@/index.css`. Use real target components, real DOM selection/focus and real Arborist, not surrogate divs standing in for the six consumers. Isolate external API/observation fixtures with existing project-qualified identities. Add companion small fixtures only to keep code readable; no unrelated framework/config changes.

Extend `file-tree-language-navigation.browser.tsx` for mutable settings fixtures and font-dependent row sizing/reveal coverage. Existing mocks returning partial settings must include `systemFontSize`/selector behavior when required by the production change; update all affected FileTree fixtures. Extend `terminal-traditional-projects.browser.tsx` for grouped selected agents/wide and compact keyboard navigation if coverage cannot be cleanly reused in the new focused suite. Existing browser config already compiles Tailwind, scans `.tsx` source, serializes files and runs Chromium; preserve it.

| Coverage | Actions | Observable assertions |
|---|---|---|
| Seven typography sizes | Set root/store system size to 10,14,20,32; render classes including `text-2xs` | `getComputedStyle(...).fontSize` matches exact Phase 02 expression within 0.05px; numeric line-height matches ratio within 0.1px; default 14px works |
| Real workspace labels | Change system setting with selected project/agent/runtime/tree/Git items rendered | Actual child text grows/shrinks, including prior 10/11px labels; no fixed-pixel regression hidden by parent style |
| Portals/class merging | Open worktree select/context menu/compact sheet after font changes | Body-mounted content consumes root tokens; `cn` preserves size plus color; no leaked root inline property or portal after cleanup |
| Root geometry isolation | Record html font, fixed rem padding/gap and fixed icons before/after | All unchanged with app zoom fixed at 100%; content-only heights may grow; no whole-layout scaling |
| Six selected consumers | Click/select each real row; hover idle then selected; keyboard focus each state | Selected background token, inset left marker and bright ordinary child text; selected-hover differs from idle-hover; focus outline coexists with marker |
| Focus semantics | Project roving arrows/Home/End; Tab/Shift+Tab through row controls; tree keyboard movement | Focus visible and separate from selection; existing roles/ARIA and actions remain coherent; no selected-state color substitution for focus |
| Selection layout | Compare same row bounds/content start before selection, hover and focus at a fixed font size | No width/height/padding/border/content-position changes from marker; allow intentional typography row-height changes only |
| Global DOM text selection | Select text in slate panels, nested selected rows and an input/textarea | Nonempty `window.getSelection()` for ordinary DOM text; `selectionStart`/`selectionEnd` for supported text controls; pseudo-element foreground/background and composited contrast plus actual visual inspection of painted selection; native/custom Monaco/xterm selection remains usable |
| Explorer virtualization | Populate more nodes than viewport, expand nested folders, select/scroll near end; change 14→32→10 | Row height/adjacent offsets update; text and badge bounds fit; no overlaps/gaps; selected identity/open state retained; reveal/keyboard/drag behavior works |
| Language and live trees | Repeat font update/reveal on real filesystem projection and language projection, including loading sentinel | Same metrics; synthetic/live IDs and owner scoping unchanged; no remount caused solely by font size |
| Editor/terminal isolation | Mount real existing Monaco/xterm harnesses; change system setting then own settings | Editor/xterm configured font sizes unchanged by system; own fonts still update; terminal instance/PTY identities retained |
| Maximum font layout | Set 32px on desktop and 390px/320px compact surfaces; exercise long names, status badges and controls | No vertical glyph clipping/overlap/page horizontal overflow; truncation has accessible full name; wrapped notices and scroll areas usable; compact targets ≥44px |

Use role/name selectors or existing stable IDs; computed CSS assertions may locate the visual wrapper/label. Auto-wait for fonts, styles, state and layout readiness; no arbitrary sleep or retry masking. Restore `--app-font-size`, zoom, localStorage and full touched store slices between tests.

Computed `::selection` colors verify CSS configuration, not that a browser painted those colors for every kind of control. Fresh visual review must inspect actual selected text; do not require inputs/textareas to expose their selection via `window.getSelection()`.

### Quantitative contrast gate
1. Read actual computed foreground, background, opacity, inset shadow/outline and ancestor background layers. Do not use color comments/hex guesses or infer that alpha 0.28 means 28% contrast.
2. Resolve CSS colors through the browser; alpha-composite row/selection and translucent ancestors over the opaque page background. Convert final RGB to WCAG relative luminance before ratio calculation.
3. Ordinary selected text and global text-selection foreground: ≥4.5:1 in selected and selected-hover states on background/surface/surface-2; test actual ancestors from all six consumers. Contrast for global selection inside a selected row must composite both overlays.
4. Left indicator and keyboard focus: ≥3:1 against adjacent selected/idle colors. Status labels and informational badges: check their actual selected colors/opacity separately; icons alone must not be the only conveyed status. CSS color contrast is not an automated claim of complete WCAG compliance.
5. Fixed token values are contract inputs. A failure requires correcting conflicting foreground/opacity/background layering, not silently changing tokens, skipping the element, weakening the threshold or declaring success from a screenshot.

## Application integration and visual evidence
Create `packages/ui/e2e/ui-contrast-font-system/ui-contrast-font-system.spec.ts`, using existing `application-fixture`, readiness, authenticated storageState and `captureApplicationCheckpoint` helpers. Prefer existing SQLite authenticated fixture option; no `--no-auth` journey or direct store mutation standing in for a settings interaction.
1. Open Settings; expand Appearance; use the actual System font size control to select 14,20,32,10 and return to Workspace. Wait for root CSS and persisted configuration rather than a debounce sleep. Reload at a nondefault size and confirm persistence.
2. Exercise IDE, runtime terminal and traditional Projects + Agents surfaces, Explorer and Git local changes/commit inspect/history. Seed actual files/Git changes through existing container fixtures; reuse existing controlled agent-ingress journey setup if observed-agent selection is part of the capture. Never present plain shell terminals or fabricated observations as real harness-status qualification.
3. Assert actual child computed font sizes, root geometry isolation, visible selected wrappers and focus. Change selection and viewport while retaining terminal DOM/backend session identity; confirm editor/terminal font values remain unchanged. Check a body portal while open.
4. Capture complete application viewport at desktop 1440×900 and compact 390×844, plus narrow 320px layout assertions. Include default/max-size selected/selected-hover/keyboard-focus examples and distinct Explorer/Git checkpoints; screenshots of isolated component grids are not full-app evidence.
5. Colocate fresh screenshots, `evidence.json` and human `review.md` in the case directory through existing capture helpers/policy. Record run identity/source fingerprint and actual inspected checkpoints. A human must issue fresh `ACCEPTED`/`REJECTED`; do not prepopulate acceptance or reuse previously accepted navigator captures. CI keeps DOM/CSSOM assertions with `CI=true`/`E2E_CAPTURE=0` and does not bypass local visual review.

Native qualification: use a real available Tauri desktop host to repeat System font update, selected/hover/focus, portal, tree scrolling and independent editor/terminal checks; record OS/WebView/version. Chromium tests establish shared logic, not native renderer equivalence. If native host/toolchain is unavailable, explicitly leave that platform unqualified in the release report and obtain platform evidence before claiming complete web/desktop certification. No server/native backend rebuild is required solely to implement shared CSS; existing runnable host is sufficient for smoke evidence.

## Consolidated execution gates
After all changes/tests land, main integration owner runs once in sequence; no concurrent sibling builds or mid-flight verification storms:

```bash
pnpm --filter @dam-hopper/ui test
pnpm --filter @dam-hopper/ui build
pnpm --filter @dam-hopper/web build
pnpm --filter @dam-hopper/ui test:browser
pnpm --filter @dam-hopper/ui test:e2e:typecheck
E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e ui-contrast-font-system/ui-contrast-font-system.spec.ts
```

The first three are mandatory user gates: full unit suite, UI TypeScript check (`build` is `tsc -p tsconfig.json`), web production Vite build (including its existing extension staging prebuild). Do not substitute targeted tests for the full unit suite or use UI typechecking as evidence Tailwind compiled correctly. Browser/E2E require installed Chromium and existing container service prerequisites; use the repository's supported browser executable/channel options if needed. Run `pnpm lint` before any eventual commit as AGENTS requires; do not run broad native/server suites as a substitute for the requested UI gates.

On failure, record command, output and cause; fix genuine regressions, then run the affected gate and required final checks against final code. User-reported existing failures are ground truth; do not rerun solely to confirm them or attribute them to this feature without evidence. Unavailable prerequisites are blocked gates, not passes.

## Documentation, review and delivery
During implementation, update existing `docs/frontend-components/platform-integrations.md` with semantic selection/system typography usage, `docs/system-architecture.md` with existing preference→root→theme data flow and independent renderer invariants, and `docs/CHANGELOG.md` with actual delivered behavior. Update `docs/code-standards.md` only for a concise enforced rule (semantic chrome text, no root rem scaling); do not rewrite unrelated architecture or announce pending work as implemented. No version bump is requested.

Code-review gate: request the repository-designated reviewer when available, or main agent's explicit equivalent review if subagents remain unavailable. Review all six callsites, child/cascade precedence, selected keyboard focus, formula/CSS consistency, reached typography audit exceptions, row-state preservation, editor/terminal isolation, portal cleanup, ownership boundaries, test evidence and documentation truthfulness. Resolve blocking findings before release; record reviewer/outcome. Human visual review is a separate required gate, not implied by code review.

Deliver exact command results, changed surfaces, contrast/layout assertions, audit exceptions, browser/app artifact paths, native platform qualification and review outcomes. No tests/builds were run as part of this plan delivery; the implementer must supply these results.

## Success criteria and security
Every Phase 01/02 acceptance passes plus the three mandatory commands, real-browser tests, authenticated application journey, fresh accepted visuals and code review. Shared CSS changes introduce no new credentials, network requests, authorization paths or telemetry. Use synthetic test workspace content; never capture real credentials/private terminal prompts in evidence. Keep capture policy and profile/generation fences intact.

## Unresolved questions
None blocking implementation. Availability of Chromium/container/native qualification prerequisites must be established at execution; any missing platform evidence is named explicitly, never inferred from another runner.
