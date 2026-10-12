# Phase 03 — Navigator integration and persistence

## Overview
- Priority P2; status completed; estimated effort 3.5h.
- Sequential: begins only after both [Phase 01](./phase-01-filter-core.md) and [Phase 02](./phase-02-filter-ui.md) deliver complete terminal results and Main confirms contract compatibility.
- [Master plan](./plan.md); [architecture baseline](../../docs/system-architecture.md#traditional-projects--agents-navigator); [delivery standards](../../docs/code-standards.md#testing-and-delivery).

## Ownership and research context
Modify only:
1. `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx`
2. `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx`

No files created/deleted in this phase. Core/molecule files are read-only; send any contract defect back to that owner through Main.

Relevant existing behavior:
- Navigator currently `useMemo`s `groupTraditionalTerminalAgentRows(agentRows)`; renders Projects first, then Agents header and optional Settings link, followed by disabled activation fieldset.
- Group-row activation calls `nextAgentSessionId` with the unchanged active session; exact session callback is fenced by the display.
- `TraditionalTerminalProjectsDisplay.tsx` uses the same navigator in mutually exclusive wide/compact branches; compact dialog mounts/unmounts it on opening/closing.
- Existing navigator tests use jsdom/`act`/`createRoot`/MemoryRouter and already cover roving Projects tabs, exact agent selection, status regrouping, disabled activation and Settings targets.
- Existing tests assert total combobox counts or take first `[role="combobox"]` for worktree tests. Those assumptions must be scoped, not removed, when introducing another valid combobox.

## Requirements and intended architecture
```text
lazy load persisted preference --> navigator selectedFilter state
                                         |
agentRows --> count all rows --------------+--> controlled molecule
    |
    +--> filter by presentation label --> existing grouping --> existing group-row
                                                                |
                                                 unchanged exact-session activation
```

- New local state is one display preference, not another server/status store. No navigator public props/caller migration needed.
- Initialize with lazy `useState<TraditionalAgentStatusFilter>(() => loadTraditionalTerminalAgentFilter())` so first render honors valid saved choice.
- On controlled filter change: update local state and call `saveTraditionalTerminalAgentFilter(next)` in the event handler; no write during render, mount effect or state updater. Saves remain synchronous/best-effort, including `all`.
- `useMemo` counts from original `agentRows`; `useMemo` filtered rows from `[agentRows, selectedFilter]`; group filtered rows through existing helper. No filter state in memo-only data, no sorting/copying of individual models.
- Mount `TraditionalTerminalAgentFilter` directly below Agents header, before/outside disabled activation fieldset; use full-width padded shrink-0 container. Pass value/counts/onValueChange/touchOptimized.
- Filter always present and enabled, even with no observed agents or no onSelectAgent. It must remain available to return to all; activation remains disabled through existing fieldset.
- If raw `agentRows.length === 0`, preserve existing explanation: “No observed agents in open terminals. OMP, Codex and Claude appear after supported integrations report status.”
- If raw rows exist but filtered groups are empty: show “No observed agents match <selected status>.” Do not show integration-setup advice or reset to all. Existing filter supplies recovery; no extra reset action needed.
- When groups match, retain original `<ul aria-label="Observed agents in open terminals">`, `group.key`, group-row props and original terminal models.
- Live status changes update counts and membership. Chosen status survives dropping to zero, roster temporarily empty, disconnection or arrival of new observations; no auto-switching.
- Hiding active agent leaves activeSessionId/activeGroupId unchanged. Filter change never calls onSelectAgent/onSelectGroup, changes routes, worktree target, split selection or terminal host.
- Needs attention matches all reasons, yet grouping still separates Approval/Question/Error. Idle includes historical Done hint; diagnostic labels are independently filterable.

## Persistence and lifecycle decisions
- Key/value encoding and fallback from Phase 01 are fixed; avoid direct localStorage access in navigator implementation.
- Browser-origin global preference deliberately applies to any profile/project and to wide/compact mounts. No profile/generation suffix because persisted data is just a display filter, not resource identity.
- Refresh/new navigator mount reads previous choice when storage succeeds. Dialog reopen and responsive branch remount also reload it.
- If storage denied, UI stays usable for current mount; subsequent remount may reset to all. This is intentional best-effort persistence, not promised memory continuity across unmounts.
- No cross-tab storage listener, custom event, shared in-memory store or new effects. Concurrent separate browser windows need not synchronize.

## Implementation steps
1. Import core functions/type and molecule with `.js` specifiers; add `useState` to existing React imports. Keep unrelated Git/project/worktree code unchanged.
2. Add lazy preference state and event-handler persistence; derive original-row counts and filtered groups with memoized pure helpers.
3. Insert filter container after Agents header; retain Settings link layout and activation fieldset boundary.
4. Branch empties using original observation presence versus filtered group presence; do not remount matching rows unnecessarily or change group keys.
5. Update test setup to remove only the exact filter key before/after tests; preserve unrelated profile/project/layout state. Restore storage spies/global/property descriptors and portal-related polyfills.
6. Scope existing worktree queries to Projects section or `aria-label` prefix `Worktree for ...`; replace whole-navigator combobox count assertions with worktree-only counts. Add separate filter-presence assertions, preserving every prior worktree behavior assertion.
7. Add integration scenarios below with real molecule/core. Do not mock filter or persistence functions; existing unrelated Git network mocks remain appropriate.
8. Return changed paths, API compatibility, test scenarios and checks-not-run. No tests/build/lint/formatters until Main's consolidated gate.

## Comprehensive Vitest integration acceptance
| Scenario | Assertions |
|---|---|
| Initial defaults/placement | Missing preference renders All statuses; filter below Agents heading/outside fieldset; Projects unchanged; touch prop reflected |
| Stored selections | Seed each of seven exact labels and all before mounting; trigger reflects it and initial rows already filtered, including diagnostic states |
| Filter interaction | Selecting every status gives only matching original rows/groups; callback selection/project count unchanged; Settings route and worktree selection unchanged |
| Counts | Two same-status agents in one group count as two; cross-profile/project/harness rows all contribute; total remains original roster size while selected subset is smaller |
| Attention/Idle semantics | Multiple attention reasons all visible but remain separate groups; Done hint stays on Idle and not a new option; presentation overrides contradictory raw state |
| Empty states | No observations preserves exact integration advice even with saved specific filter; observed-but-unmatched displays selected-status no-match message; choose all recovers |
| Dynamic observations | Immutable input rerender changes status/count/subset; selected value remains when count goes zero or raw roster empties; new matching rows appear automatically |
| Selection identity | Hidden active agent does not trigger selection or alter props; returning to all restores aria-current on that exact terminal; equal bare terminal IDs across profiles remain distinct |
| Cycling | Controlled active-session harness with ≥2 same-status same-project members: click moves first→next→wrap, preserving member order; unrelated active starts at first; filtered-out different statuses never enter cycle |
| Group stability | Existing unchanged-key row stays same DOM element when unrelated status changes/filter leaves it visible; reason/coverage/source/outcome metadata unmodified |
| Activation disabled | Omitted onSelectAgent keeps group buttons disabled while filter remains enabled; filter selection neither activates project nor agent |
| Persistence | Real selection writes exact key/raw enum immediately; unmount/create new root retaining storage restores non-all value and roster; switching to all persists/restores all; mount alone does not overwrite stored value |
| Invalid/denied storage | Invalid saved string defaults all; getter/get/set failures do not crash; selection continues in memory when save fails; no unrelated keys modified |
| Regressions | Existing Projects roving navigation, panel IDs, Git summaries, worktree capability/counts, Settings link and additive default props stay valid with scoped queries |

Use document-level portal queries for options, named filter trigger for interactions, and scoped list queries for group buttons. Remount tests prove initialization/persistence contract, not real browser document reload.

## Main-only delivery work — outside phase ownership
These files are assigned exclusively to Main in the master matrix, never to Phase 03:
- `packages/ui/browser-tests/terminal-traditional-projects.browser.tsx`: extend existing suite, reuse `mountAgents`, `userEvent`, `compactState`, fixture refs/status updater and selection-count probes; fixture source remains read-only.
- `docs/system-architecture.md`: add implemented UI-only preference and data flow to Traditional Projects + Agents section, keeping owner fences/sole terminal host unchanged.
- `docs/CHANGELOG.md`: describe sidebar filter, full status range, reload preference and best-effort storage behavior; no version bump.

### Browser regression gate
1. Reset only filter preference in suite setup/cleanup; scope any worktree-only combobox assumptions. Keep existing registered terminal/transport lifecycle patterns and `TerminalKeepAliveHost` mocking pattern; no second terminal host.
2. Wide surface: choose non-all and all; verify unfiltered agent counts, live status changes/no-match state, exact same-group cycling and unchanged current project/active terminal during filter-only changes.
3. Compact 320/375/390px sheet: real Radix dropdown opens through portal; trigger and items meet 48px touch target, long diagnostic labels remain usable without horizontal overflow.
4. Keyboard: open/navigate/commit a filter; first Escape with dropdown open closes only listbox and restores filter trigger, dialog remains; second Escape closes dialog/restores opener. Selecting filter must not dismiss sheet, fire terminal selection or reach workspace/terminal shortcuts.
5. Close/reopen compact sheet and switch wide/compact branch: saved value/count/roster restored. Capture current host count/terminal identity before/after to detect accidental mount/selection effects.
6. Tests above use component fixtures, not real CLI observation evidence. Separately exercise actual application page refresh with non-all then all; record browser/platform and actual reload results. Apply repository full-viewport visual review policy for UI evidence; do not call fixture remount a page refresh.

### Consolidated commands — Main's post-integration validation stage
Run from repository root, sequentially after all edits; fix failures and rerun affected checks. Phase agents do not run these:

```bash
pnpm --filter @dam-hopper/ui test src/lib/traditional-terminal-agent-filter.test.ts src/components/molecules/traditional-terminal-agent-filter.test.tsx src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx src/lib/traditional-terminal-agents.test.ts src/lib/traditional-terminal-agent-groups.test.ts src/components/molecules/traditional-terminal-agent-group-row.test.tsx src/components/organisms/TraditionalTerminalWorktreeSelect.test.tsx src/components/organisms/TraditionalTerminalWorktreeSelect.regression.test.tsx
pnpm --filter @dam-hopper/ui build
pnpm exec eslint packages/ui/src/lib/traditional-terminal-agent-filter.ts packages/ui/src/lib/traditional-terminal-agent-filter.test.ts packages/ui/src/components/molecules/traditional-terminal-agent-filter.tsx packages/ui/src/components/molecules/traditional-terminal-agent-filter.test.tsx packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx packages/ui/browser-tests/terminal-traditional-projects.browser.tsx
pnpm --filter @dam-hopper/ui test:browser browser-tests/terminal-traditional-projects.browser.tsx
```

Use existing browser runner/config; do not run root `pnpm test` expecting frontend tests. No broad formatter or config/dependency modifications. Report only actually exercised checks and evidence, retaining any environment limitations.

## Success criteria
- Phase-owned code/tests implement all specified integration behaviors with no changes outside its two files.
- Counts and filtering use canonical core contract; UI accessible/touch-aware and independent of agent activation availability.
- Exact session cycling/group semantics, project navigation and status authority unchanged.
- Storage-backed fresh mount restores selection; no-observed/no-match messages distinct and chosen zero-count status stable.
- Main completes consolidated Vitest/typecheck/lint/browser gates, actual reload evidence, side-effect review and documentation before declaring feature delivery complete.

## Risks, security and unresolved questions
- Extra combobox breaks generic selectors: scope assertions, do not weaken worktree tests.
- Persisting in effects/state updater can overwrite saved choice or duplicate writes: lazy load + event-handler save only.
- Filtering before grouping must preserve identity/order: no new synthetic groups or row keys.
- Nested Radix Select/Dialog must be qualified in Chromium; no broad keyboard suppression as a workaround.
- Persist only enum string; no API/PTY/notification/idle-suspend writes, sensitive identifiers or status snapshots.
- Unresolved questions: none.
