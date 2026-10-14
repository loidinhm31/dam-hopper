# Phase 1: Filter Core & Models

## Target Files
- `packages/ui/src/lib/traditional-terminal-agent-filter.ts`
- `packages/ui/src/lib/traditional-terminal-agent-filter.test.ts`

## Requirements
1. Separate count key type from selection type:
   - `export type TraditionalAgentStatusCountKey = "all" | TraditionalAgentStatusLabel;`
   - `export type TraditionalTerminalAgentStatusCounts = Readonly<Record<TraditionalAgentStatusCountKey, number>>;`
   - `export type TraditionalAgentStatusSelection = "all" | readonly TraditionalAgentStatusLabel[];`
   - Keep `TraditionalAgentStatusFilter = "all" | TraditionalAgentStatusLabel | readonly TraditionalAgentStatusLabel[];` for backward compatibility.
2. Canonical normalization:
   - Allowlist: `["Needs attention", "Working", "Idle", "Unknown", "Unavailable", "Platform unqualified", "Unsupported"]`.
   - `normalizeTraditionalAgentStatusFilter(input)`:
     - Returns `"all"` if input is `"all"` or invalid.
     - If input is string matching allowlist, returns `[input]` (or scalar when normalized to selection).
     - If input is array, filter valid labels, deduplicate, sort in canonical order. If empty or length === 7, returns `"all"`.
3. Persistence:
   - `loadTraditionalTerminalAgentFilter(storage)`:
     - Reads `dam-hopper:traditional-terminal-agents-status-filter`.
     - Handles legacy string ("all", "Working", etc.) returning normalized selection.
     - Handles JSON array string (e.g. `["Working","Idle"]`).
     - Safely returns `"all"` on error/corrupt data. No writes on load.
   - `saveTraditionalTerminalAgentFilter(filter, storage)`:
     - If normalized is `"all"`, stores `"all"`.
     - If normalized is single status, stores scalar string (e.g. `"Working"`).
     - If normalized is multiple statuses, stores JSON array (e.g. `'["Needs attention","Working"]'`).
4. Row filtering:
   - `filterTraditionalTerminalAgentRows(rows, filter)`:
     - If `"all"`, returns `rows` (retains array identity).
     - If array/set, returns rows whose `presentation.label` is in the allowed set.
5. Formatting helpers:
   - `formatTraditionalAgentStatusFilter(filter)`:
     - Returns `"All statuses"` if all.
     - Returns comma-separated labels if array (e.g. `"Working, Idle"`).
6. Comprehensive unit tests covering:
   - Normalization with invalid values, duplicates, singleton, all-7.
   - Multi-status row filtering (union logic).
   - Storage serialization/deserialization for legacy strings, JSON arrays, corrupt values.
