---
title: "High-contrast selection and adaptive system typography"
description: "Make workbench selection unmistakable and scale shared UI text with System font size without scaling layout or editor/terminal fonts."
status: completed
priority: P2
effort: 20h
branch: feat/ui-selection-contrast-and-font-system
tags: [frontend, bugfix, accessibility, typography]
created: 2026-10-14
---

# UI selection contrast and font system adaptation

## Goal and delivery boundary
Improve the shared web/Tauri workbench: clear selected rows, readable text selection, responsive UI typography driven by the existing **System font size** preference. Implementation and automated regression testing completed; documentation and tests updated.

## Phases
| # | Phase | Status | Effort | Implementation dependency |
|---|---|---|---|---|
| 1 | [Selection contrast tokens](./phase-01-selection-contrast-tokens.md) | completed | 5h | Existing selected/active state only |
| 2 | [Font system adaptation](./phase-02-font-system-adaptation.md) | completed | 7h | Phase 1 CSS/component edits integrated |
| 3 | [Verification and review](./phase-03-verification-and-review.md) | completed | 8h | Phases 1–2 and regression tests complete |

Effort estimates include implementation/testing preparation, not observed execution time. [Command-plan access point](./evc-cmd-plan.md).

## Grounded findings
- `packages/ui/src/index.css:9–59` owns Tailwind v4 semantic colors; `:root` defaults `--app-font-size` to `14px`; only inherited body font size consumes it today.
- `packages/ui/src/embed/dam-hopper-app.tsx:80–85,278–289` already synchronizes `systemFontSize` to the root CSS variable during hydration/store updates. Do not add another synchronizer or setting.
- Six required surfaces use weak primary-tinted selection. Changed-files paths force primary text; commit paths also turn primary on hover. Child utilities must be migrated, not hidden beneath a parent color.
- `FileTree.tsx:1111` uses `rowHeight={24}`; changing CSS alone would desynchronize react-arborist geometry.
- `WorkspacePage` delegates to IDE, terminal, and compact shells; auditing its JSX alone misses most fixed-pixel chrome. Selected agents are grouped rows, not one row per terminal.
- Monaco uses `editorFontSize`; xterm uses `terminalFontSize` plus existing app zoom. Neither may derive from system typography.

## Design and invariants
1. Four exact requested selection tokens in the existing `@theme`; one narrowly shared selected-row CSS class. Three-pixel inset left indicator, bright labels, selected-hover background, independent visible keyboard outline. Remove conflicting row/child utilities.
2. Seven exact `--text-*` expressions plus unitless line-height companions in the same `@theme`. Preserve browser/root font size, spacing, icons, existing app zoom, ownership and preference-source semantics.
3. Migrate fixed workspace chrome typography to semantic sizes; grow only text-containing controls/virtual row heights where required. Preserve icon-only geometry and compact targets of at least 44px.
4. Keep Arborist's uniform virtual rows; update its numeric height from the same typography contract without a font-dependent tree key, terminal disposal, or workspace remount.
5. Global `::selection` intentionally styles native DOM text selection. Monaco/xterm custom rendering and font options remain separate; browser review must check DOM selection interactions too.

## Scope and non-goals
In scope: all six named selection surfaces; shared CSS; workspace/transitive chrome audit; virtual-tree metrics; regression coverage; implementation-time documentation and review. Out of scope: backend/schema changes, new preference controls, light-theme design, app-zoom redesign, library upgrades, mass unrelated component refactors, Monaco/xterm font policy changes. Existing files remain canonical; no compatibility styling shims.

## Acceptance and release gates
- Required tokens and all six row states delivered; selected hover never becomes idle hover; focus remains visible with or without selection; no selection-induced layout shift.
- Semantic text sizes update live at 10/14/20/32px settings; portal content follows; root rem spacing/icons remain stable; usable workspace at maximum size.
- Tree rows fit, offsets update, selection/expansion/reveal remain functional; editor/terminal settings and rendering font sizes remain independent.
- Future implementation runs `pnpm --filter @dam-hopper/ui test`, `pnpm --filter @dam-hopper/ui build`, `pnpm --filter @dam-hopper/web build`, browser regression suite, application E2E, and code-review gate. Commands/results and fresh human visual acceptance are recorded; no qualification claimed now.

## Standards and evidence
[AGENTS.md](../../AGENTS.md), [code standards](../../docs/code-standards.md), [system architecture](../../docs/system-architecture.md), [testing](../../docs/testing.md), [shared design contract](../../docs/frontend-components/platform-integrations.md). Planning, UI-styling, web-testing, and docs-seeker skills were read explicitly from the published HOME catalog because local migrated skills/workflows are absent. Primary sources: [Tailwind typography](https://tailwindcss.com/docs/font-size), [Arborist API](https://github.com/brimdata/react-arborist). Source files remain authoritative for installed versions.

## Risks and state
Main risks: cascade/child opacity, translucent contrast, fixed-height clipping at 32px, virtualization offsets, portal/test-state leakage, native WebView differences. Mitigations and concrete gates live in the phase documents. Architecture changes are presentation-only; document the new invariants during implementation, not as already-live behavior now.

Active-plan registration attempted with the published `set-active-plan.cjs`; it reported `EVCRATE_SESSION_ID not set - session state will not persist`. Files remain the delivery source of truth; the main session must register this path if its session ID is available.

## Unresolved questions
None blocking implementation. Native platform qualification remains an execution gate, not a Chromium-equivalence assumption.

## Code review status (2026-10-14)
Reviewer critical issue resolved: `.workbench-selection:focus-visible` outline added to `packages/ui/src/index.css` (2px solid selection border with -2px inset offset) allowing the focus indicator to clearly coexist with the 3px inset marker without conflict. Explicit ranges applied in browser test assertions, and narrow selector `useSettingsStore(s => s.systemFontSize)` adopted in `FileTree`. All 327 test files (2,920 tests) pass, all 6 browser tests in Chromium pass, and builds pass cleanly.
