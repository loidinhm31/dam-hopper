# Phase 2: Multi-select Dropdown Molecule

## Target Files
- `packages/ui/src/components/molecules/traditional-terminal-agent-filter.tsx`
- `packages/ui/src/components/molecules/traditional-terminal-agent-filter.test.tsx`

## Requirements
1. Multi-select Combobox / Listbox Component:
   - `TraditionalTerminalAgentFilterProps`:
     - `value: TraditionalAgentStatusFilter` (or `TraditionalAgentStatusSelection`)
     - `onValueChange: (value: TraditionalAgentStatusSelection) => void`
     - `counts: TraditionalTerminalAgentStatusCounts`
     - `touchOptimized?: boolean`
     - `className?: string`
2. Accessible Semantics:
   - Trigger:
     - `role="combobox"`
     - `aria-haspopup="listbox"`
     - `aria-expanded={isOpen}`
     - `aria-controls={listboxId}`
     - `aria-label="Filter agents by status"`
     - `aria-describedby={descriptionId}`
     - Label: "All statuses" when all; status label when 1; comma-separated or "N statuses" when multiple.
     - Badge: sum of matching agents (`data-testid="agent-filter-count-badge"`).
   - Listbox:
     - `role="listbox"`
     - `aria-multiselectable="true"`
     - `id={listboxId}`
   - 8 Options in canonical order:
     - "All statuses" (`value="all"`): indicates checked when filter is "all". Clicking resets filter to "all".
     - 7 Status options: `role="option"`, `aria-selected={isSelected}`, decorative check indicator (`aria-hidden="true"`), status icon, status label, count badge (`data-testid="agent-filter-count-badge"`), `aria-label={`${label}, ${count} ${plural}`}`.
3. Multi-selection Interaction:
   - Clicking a status option when "all" is active: isolates filter to that status alone.
   - Clicking a status option when some statuses are active: toggles that status.
   - If toggling unchecks the last status: automatically reverts to "all".
   - If toggling causes all 7 statuses to be checked: reverts to "all".
   - Dropdown remains open during option toggling.
4. Keyboard & Focus Management:
   - Enter, Space, ArrowDown on trigger opens dropdown.
   - ArrowDown / ArrowUp moves active descendant/focus through options with wrap-around.
   - Home / End jumps to first / last option.
   - Space or Enter toggles the focused option.
   - Escape closes dropdown, calls `event.stopPropagation()` (to prevent closing parent dialogs), and restores focus to trigger.
   - Tab closes dropdown and allows natural focus traversal.
   - Click-outside closes dropdown without stealing focus unexpectedly.
5. Touch & Narrow Viewports:
   - `min-h-11` (or `min-h-12` when `touchOptimized` is true).
   - `w-full min-w-0 truncate` for narrow 240px sidebar layout.
6. Comprehensive unit tests covering:
   - Multi-status toggling, unchecking, resetting via "All statuses".
   - Trigger text and count badge summation.
   - Accessible roles, attributes, and live descriptions.
   - Keyboard interaction (arrows, space, enter, escape, home, end).
   - Touch optimization styling.
