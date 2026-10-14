---
title: "Traditional terminal agents multi-select status filter"
description: "Enhance traditional terminal left sidebar agent status filter with accessible multi-selection and backward-compatible persistence."
status: completed
priority: P2
effort: 6h
branch: feat/traditional-terminal-agents-multi-select-filter
tags: [feature, frontend, terminal, accessibility, persistence]
created: 2026-10-14
---
# Traditional terminal agents multi-select status filter

## Goal and researched baseline
- Traditional terminal navigator left sidebar (`TraditionalTerminalProjectsNavigator.tsx`) currently filters observed agent rows by a single status or "all".
- Users need to select multiple statuses simultaneously (e.g., both "Working" and "Idle" or "Needs attention") to view combined groups in the sidebar roster.
- Maintain DamHopper's architecture: browser-origin UI preference in `localStorage`, presentation label filtering before existing grouping, zero impact on PTY lifetimes, terminal selection, or backend agent status engines.
- Comply with Advisor guidance:
  1. Separate scalar count keys (`"all" | TraditionalAgentStatusLabel`) from multi-status selection (`"all" | readonly TraditionalAgentStatusLabel[]`).
  2. Implement a strict normalization contract: validate against status allowlist, canonical deduplication and ordering, retain singletons as singleton selections (with scalar serialization), normalize empty and all-7 selections to "all", safe JSON/scalar serialization.
  3. Explicit "All statuses" semantics: clear reset choice, distinct checked state.
  4. Fully accessible combobox/listbox pattern: `role="combobox"`, `role="listbox"`, `role="option"`, `aria-multiselectable="true"`, `aria-activedescendant` or keyboard roving focus, Escape/Tab dismissal, compact dialog isolation.

## Dependency graph and execution strategy
```text
                  +-- Phase 1: Filter core & tests (lib) ----------+
Frozen contract --+                                                +--> Phase 3: Navigator & browser tests --> Testing & Docs
                  +-- Phase 2: Multi-select UI & tests (molecule) -+
```

| Phase | Status | Dependency | Owner | Success criterion |
|---|---|---|---|---|
| [1: Filter core](./phase-01-filter-core.md) | Completed | None | `evc-fullstack-developer` | Scalar count keys separated from selection type; normalize/load/save contract with JSON array and legacy string support; multi-label row filtering; unit tests pass. |
| [2: Multi-select UI](./phase-02-filter-ui.md) | Completed | Frozen contract | `evc-fullstack-developer` | Multi-select combobox/listbox with checkmarks; sum matching counts badge; keyboard nav (Arrow/Enter/Space/Escape/Home/End); compact dialog isolation; unit tests pass. |
| [3: Integration](./phase-03-navigator-integration.md) | Completed | Phases 1 & 2 complete | `evc-fullstack-developer` | Navigator integration with multi-status empty message; browser tests updated and verified in Chromium; E2E typecheck passes. |

## Strict file ownership matrix
| Owner | Files |
|---|---|
| Phase 1 | `packages/ui/src/lib/traditional-terminal-agent-filter.ts`<br>`packages/ui/src/lib/traditional-terminal-agent-filter.test.ts` |
| Phase 2 | `packages/ui/src/components/molecules/traditional-terminal-agent-filter.tsx`<br>`packages/ui/src/components/molecules/traditional-terminal-agent-filter.test.tsx` |
| Phase 3 | `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx`<br>`packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx`<br>`packages/ui/browser-tests/terminal-traditional-projects.browser.tsx`<br>`docs/system-architecture.md` |

## Side-effect review checklist
- [x] Projects section order, worktree selection, terminal tabs, and roving focus unaffected.
- [x] Agent session cycling and grouping logic unchanged; filters rows prior to group creation.
- [x] Stored preference format: legacy scalar strings continue to load seamlessly; multi-status arrays serialize as valid JSON arrays; storage failures fallback cleanly to "all".
- [x] No writes to storage on mount; only explicit user changes invoke storage writes.
- [x] Zero-count statuses remain visible and selectable.
- [x] Escape dismisses dropdown without closing compact dialog or changing session.

## Code review (2026-10-14)
- Report: `plans/reports/code-review-261014-0125-multi-select-agent-status-filter.md`
- Status: completed. Resolved review findings:
  - [x] H1: compact sheet listbox dynamically flips upward (`bottom-full mb-1`) when opening near viewport bottom with clamped height (`Math.min(240, Math.max(0, spaceAbove - 8))`). Verified across 320x568, 375x700, and 390x844 viewports in Chromium browser test asserting vertical containment (`rect.top >= 0 && rect.bottom <= viewportHeight`), scroll reachability, and real pointer selection (`userEvent.click(unsupportedOption)`). (Note: virtual-keyboard shifts and deep ancestor scroll dynamics remain open runtime boundaries).
  - [x] M1: CHANGELOG updated with Check icons and verified 130 unit test / 45 browser test counts.
  - [x] M2: dropped ambient `aria-live="polite"` on description span to prevent ambient status updates from triggering screen reader announcements.
  - [x] M3/M4: documented raw helper semantics vs normalized UI state in JSDoc; signature narrowing and dead export removal intentionally deferred for backward compatibility with existing tests.
