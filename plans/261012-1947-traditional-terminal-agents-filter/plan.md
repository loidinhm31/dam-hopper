---
title: "Traditional terminal agents status filter"
description: "Add an accessible status filter to the Traditional agents sidebar and persist its selection across refreshes."
status: pending
priority: P2
effort: 7h
branch: feat/traditional-terminal-agent-status-filter
tags: [feature, frontend, terminal, accessibility, persistence]
created: 2026-10-12
---
# Traditional terminal agents status filter

## Goal and researched baseline
- Planned changes only; no implementation or test results claimed.
- Navigator currently groups observed rows by project, primary status and attention reason; row activation cycles exact qualified sessions. Both desktop and compact dialog use this navigator.
- Add one browser-origin preference, not server/profile settings. No roster, notification, transport, terminal-host or status-authority changes.
- References: [architecture](../../docs/system-architecture.md#traditional-projects--agents-navigator), [standards](../../docs/code-standards.md), [Phase 1](./phase-01-filter-core.md), [Phase 2](./phase-02-filter-ui.md), [Phase 3](./phase-03-navigator-integration.md).

## Dependency graph and phases
```text
                  +-- Phase 1: filter core + tests --+
Frozen contract --+                                  +--> Phase 3: navigator + tests --> Main delivery gates
                  +-- Phase 2: filter UI + tests -----+
```
| Phase | Status | Effort | Dependency | Success criterion |
|---|---|---|---|---|
| [1: Core](./phase-01-filter-core.md) | Pending | 1.5h | Existing row/status types only | Exact enum/key; safe load/save; immutable label filtering; full agent counts; edge-case tests |
| [2: UI](./phase-02-filter-ui.md) | Pending | 2h | Existing status type + Radix only | Controlled accessible eight-option Select; counts/indicators; zero-count selection; keyboard/touch tests |
| [3: Integration](./phase-03-navigator-integration.md) | Pending | 3.5h | Both 1 and 2 terminal deliverables | Header placement; unfiltered counts; filtered groups; distinct empties; unchanged selection/cycling; persistence tests |

## Frozen parallel-work contract
- `TraditionalAgentStatusFilter = "all" | "Working" | "Idle" | "Needs attention" | "Unknown" | "Unavailable" | "Platform unqualified" | "Unsupported"`; reuse existing `TraditionalAgentStatusLabel`.
- Storage key: `dam-hopper:traditional-terminal-agents-status-filter`; raw exact enum string; default `"all"`.
- Counts: `Readonly<Record<TraditionalAgentStatusFilter, number>>`; all eight keys always present; `all` is observed row count, not group count.
- UI props: `value`, `onValueChange: (value: "all" | TraditionalAgentStatusLabel) => void`, `counts`, optional `touchOptimized?: boolean`; controlled component, no storage/store access.
- Option order: All statuses (`all`), Needs attention, Working, Idle, Unknown, Unavailable, Platform unqualified, Unsupported. Zero-count options remain selectable.
- Phase 2 imports the existing status type only; its structural props/count types match Phase 1 without importing the new helper. No temporary module, stub, barrel or shared-file edit needed.
- Data flow: observed rows → count all rows + filter primary presentation label → existing grouping → existing group-row activation. Done remains an Idle hint; all attention reasons match Needs attention.

## Execution strategy
1. Freeze interfaces above; spawn 2 implementation agents for Phases 1 and 2, wait for both terminal results, then synthesize. Each prompt includes owned paths, requirements, output and validation signal.
2. Agents implement code and colocated tests only in their files; no builds/tests/lint/formatters mid-flight. Reports state changed paths, exported interfaces and checks not run.
3. Main checks both interface deliverables; only then starts Phase 3 with those contracts. Missing/incomplete result blocks integration, not silently bypassed.
4. After Phase 3 lands, Main owns browser-regression/docs edits below, runs one consolidated validation stage, reviews side effects and records actual evidence; rerun affected checks after fixes. Phase agents never broaden ownership to fix another phase's file.
5. Use pnpm/Vitest scripts in existing manifests. No dependency, patch, export-map or package changes; no feature flag, cross-tab synchronization or new global store.

## Strict file ownership matrix
Paths are repository-root-relative; each file has exactly one writer.
| Owner | Action | Files |
|---|---|---|
| Phase 1 | Create | `packages/ui/src/lib/traditional-terminal-agent-filter.ts`; `packages/ui/src/lib/traditional-terminal-agent-filter.test.ts` |
| Phase 2 | Create | `packages/ui/src/components/molecules/traditional-terminal-agent-filter.tsx`; `packages/ui/src/components/molecules/traditional-terminal-agent-filter.test.tsx` |
| Phase 3 | Modify | `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx`; `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx` |
| Main, after Phase 3 | Modify | `packages/ui/browser-tests/terminal-traditional-projects.browser.tsx`; `docs/system-architecture.md`; `docs/CHANGELOG.md` |
- All other files read-only, notably display, roster builder, grouping helper, group-row molecule, Select primitive, settings/status stores and browser fixture. Plans themselves owned by planner; phase agents report results, do not edit plans.

## Side-effect review checklist
- [ ] Filter never changes Projects count/order, roving tabs, active group/session, splits, PTY identity/lifetime, worktree target or Agent Settings route.
- [ ] Group keys, row identities/member order, reason separation, coverage/Done hints and qualified-session cycling preserved.
- [ ] Only preference string persisted; no private identifiers/status snapshots. Storage denied/missing/corrupt safely defaults; unrelated keys untouched.
- [ ] Counts represent all observed agents, including unavailable/diagnostic states. Live status updates recompute; zero matches never reset chosen filter.
- [ ] Filter outside disabled activation fieldset; remains usable without selection callback or observations; original no-observation explanation retained.
- [ ] Radix owns combobox/listbox semantics, keyboard and focus. Compact selection does not dismiss dialog or select terminal; Escape dismisses dropdown first.
- [ ] Existing broad combobox selectors scoped to worktrees; storage/portal/polyfill cleanup isolated in tests; React 19 Radix patch untouched.

## Delivery gates and evidence
- Main: focused Vitest suite including new tests, navigator, roster/group/group-row and worktree regressions; UI TypeScript build; scoped ESLint. Commands and scenarios in Phase 3.
- Main extends existing Chromium suite: desktop/compact dropdown, keyboard/Escape/focus, 320–390px touch geometry, live counts, exact cycling and remount persistence. Run focused suite after integration; fix failures and rerun affected checks before delivery.
- Main verifies real application page refresh with saved non-all and all selections; records browser/platform and evidence separately from jsdom/remount tests. No remount test claimed as actual navigation reload.
- After implementation, Main documents UI-only architecture/data flow and changelog; do not describe planned behavior as already shipped. Storage-denied continuity is current-mount only; remount can reset to all.

## Unresolved questions
None. Global browser-origin preference, raw string encoding and current-mount-only storage-failure fallback are explicit design decisions.

## Review status (code-review 261012)
- Implementation present for Phases 1-3 + browser/docs; focused unit 108/108, browser 37/37, tsc and eslint clean (reviewer-run).
- Open before marking Done: fix architecture-doc sentence placement + unsupported "page refresh" claim; add compact/touch/keyboard/exclusion Chromium tests; verify real page reload; `role="status"` on filtered-empty message.
- Report: [code-review-261012-1947-traditional-terminal-agents-filter.md](../reports/code-review-261012-1947-traditional-terminal-agents-filter.md)
