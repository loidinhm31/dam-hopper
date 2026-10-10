# Traditional terminal agents sidebar: group by project + status

Branch `feat/traditional-terminal-agents-sidebar` (worktree reused; PR #52 content already on `main`, branch merged with `origin/main` at `e618072f`, tree identical outside `plans/`).

## Contract
- Output: `agents` section lists one item per (project group, primary status), not per agent terminal. Each item shows an agent-count badge.
- Status identity = `presentation.label` + `presentation.reasonLabel` (what the chip shows). `outcomeHint` shown only if all members carry it.
- Order: project (builder order) then severity: Needs attention, Working, Idle, Unknown, Unavailable, Platform unqualified, Unsupported.
- Activation: multi-agent item selects next member after active (wrapping) or first; still routed through `handleSelectAgent` committed-key fence. Single-agent item keeps old aria-label prefix.
- Scope boundary: no change to roster builder, status store, server, notification semantics.

## Phases
1. Pure grouping lib `lib/traditional-terminal-agent-groups.ts` (+ unit tests). Done.
2. Molecule `traditional-terminal-agent-group-row.tsx` replaces `traditional-terminal-agent-row.tsx`; navigator groups rows via `useMemo`. Done.
3. Browser tests (`terminal-traditional-projects.browser.tsx`) adapted + one new grouped-count case.
4. Docs (CHANGELOG, codebase-summary) + review.

## Risks
- Item identity changes with status: keyboard focus not preserved across a status change of the focused item (preserved otherwise). Accepted; inherent to status grouping.
- Browser fencing tests relied on per-agent buttons; must keep proving stale/replaced PTY rejection.

## Testing
Vitest unit (lib, molecule, navigator), Chromium browser test file, `tsc --noEmit`.
