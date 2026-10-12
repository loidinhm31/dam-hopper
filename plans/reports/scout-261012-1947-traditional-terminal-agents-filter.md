# Scout Report: Traditional Terminal Agents Status Filter

## 1. Output & Target Architecture
- Add status filtering (`all`, `Working`, `Idle`, `Needs attention`, `Unknown`, `Unavailable`, `Platform unqualified`, `Unsupported`) to the "agents" section in Traditional terminal left sidebar (`TraditionalTerminalProjectsNavigator`).
- Filter persists across browser reloads via `localStorage` key `dam-hopper:traditional-terminal-agents-status-filter`.
- Modular separation:
  - `packages/ui/src/lib/traditional-terminal-agent-filter.ts`: Pure types, validation, counts, filtering logic, and `localStorage` serializer/deserializer.
  - `packages/ui/src/components/molecules/traditional-terminal-agent-filter.tsx`: Radix UI `Select`-based accessible status dropdown with status badges and agent count annotations.
  - `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx`: Integrated filter controls, state management, filtered group derivation, and empty-state messaging.

## 2. Acceptance Criteria
1. Filter UI rendered in agents section of Traditional terminal navigator.
2. Supports filtering by "All statuses" and each concrete `TraditionalAgentStatusLabel`.
3. Filter state persists to `localStorage` under `dam-hopper:traditional-terminal-agents-status-filter` and restores on mount/reload.
4. When filter active:
   - Only matching agent groups/rows display.
   - If no agents match the active filter, displays distinct empty state: `No agents matching "${filter}" status` with a quick clear action.
   - If total observed agents is 0, displays existing empty state.
5. Cycling selection (`onSelectAgent`) and active session indicators work seamlessly on filtered results.
6. Touch-optimized sizing supported when `touchOptimized=true`.

## 3. Scope Boundaries & Non-Goals
- In scope: Traditional terminal left sidebar navigator agents list and persistence.
- Out of scope:
  - Runtime terminal navigation (different layout and view model).
  - Server-side agent filtering (agent status remains local client observation view).
  - Modifying PTY or agent observation engine.

## 4. Side-Effect Risks & Mitigation
| Risk | Severity | Mitigation |
|---|---|---|
| Corrupted or legacy `localStorage` value | Low | Strict validator (`isTraditionalAgentStatusFilter`) falls back to `"all"`. |
| Zero agents matching filter hides controls | Medium | Keep filter control rendered and active even when filtered list is empty. |
| DOM test flakiness with Radix Select in jsdom | Medium | Test component with explicit trigger interactions; provide clean ARIA attributes. |
| Layout overflow in narrow sidebar (160px min) | Low | Place filter as full-width row under agents header, using `truncate` and `min-w-0`. |

## 5. Testing Strategy
- Unit tests for pure filter library: `traditional-terminal-agent-filter.test.ts`.
- Component tests for UI molecule: `traditional-terminal-agent-filter.test.tsx`.
- Integration unit tests: update `TraditionalTerminalProjectsNavigator.test.tsx`.
- Typecheck: `pnpm --filter @dam-hopper/ui check` (or workspace check).
