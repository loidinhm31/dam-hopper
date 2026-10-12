# Phase 01 — Filter core and persistence

## Overview
- Priority P2; status completed; estimated effort 1.5h.
- Runs concurrently with Phase 02. No dependency on molecule or navigator changes.
- Deliver one leaf helper and colocated Vitest tests; no React, hooks, stores, events, subscriptions or API calls.
- [Master contract](./plan.md#frozen-parallel-work-contract); [Phase 02](./phase-02-filter-ui.md); [Phase 03 consumer](./phase-03-navigator-integration.md).

## Ownership and research context
Create only:
1. `packages/ui/src/lib/traditional-terminal-agent-filter.ts`
2. `packages/ui/src/lib/traditional-terminal-agent-filter.test.ts`

Read-only references:
- `packages/ui/src/lib/traditional-terminal-agents.ts`: canonical `TraditionalAgentStatusLabel`, readonly row and precomputed `presentation.label`; availability overrides raw agent state.
- `packages/ui/src/lib/traditional-terminal-agent-groups.ts`: groups by project + label + reason, retains original member order/identity. Filtering must not replace it.
- `packages/ui/src/lib/html-view-mode-persistence.ts`: exact-string preference, guarded default storage accessor, injectable storage.
- `packages/ui/src/lib/app-zoom.ts` and `.test.ts`: runtime guard and storage-failure tests.
- [React/status standards](../../docs/code-standards.md#react-and-typescript).

## Requirements and fixed API
Use `.js` import specifiers and `import type` for existing row/status types. Export this public contract:

```ts
export type TraditionalAgentStatusFilter = "all" | TraditionalAgentStatusLabel;
// Exact expanded union: "all" | "Working" | "Idle" | "Needs attention" |
// "Unknown" | "Unavailable" | "Platform unqualified" | "Unsupported".
export const TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY =
  "dam-hopper:traditional-terminal-agents-status-filter";
export type TraditionalTerminalAgentStatusCounts =
  Readonly<Record<TraditionalAgentStatusFilter, number>>;

export function isTraditionalAgentStatusFilter(
  value: unknown,
): value is TraditionalAgentStatusFilter;
export function loadTraditionalTerminalAgentFilter(
  storage?: Pick<Storage, "getItem">,
): TraditionalAgentStatusFilter;
export function saveTraditionalTerminalAgentFilter(
  filter: TraditionalAgentStatusFilter,
  storage?: Pick<Storage, "setItem">,
): void;
export function filterTraditionalTerminalAgentRows(
  rows: readonly TraditionalTerminalAgentRow[],
  filter: TraditionalAgentStatusFilter,
): readonly TraditionalTerminalAgentRow[];
export function countTraditionalTerminalAgentsByStatus(
  rows: readonly TraditionalTerminalAgentRow[],
): TraditionalTerminalAgentStatusCounts;
```

- Guard accepts exactly the eight case-sensitive strings; no trimming, aliases, lowercase wire states or JSON-envelope migration.
- Persist raw string, including `"all"`; load missing/invalid/unavailable value as `"all"`. Do not delete corrupt data or write during load.
- Load/save are bounded storage adapters, not mathematically pure functions: injected I/O is their only side effect. Guard/filter/count remain pure. No module-level browser access.
- Resolve default `globalThis.localStorage` inside a safe accessor whose getter access is itself within `try/catch`; default-argument evaluation must never throw before adapter catch.
- Catch access/getItem/setItem failures; storage is optional UI preference. No console noise, retry, notification or fallback store. Runtime guard in save rejects invalid values even if a caller bypasses TypeScript.
- Filter exclusively `row.presentation.label`, not `status.state`, availability directly, reason, harness or project. Needs attention includes Approval/Question/Error/null reasons; Done (turn ended) remains Idle.
- `all` returns the input array unchanged; selected status returns a stable-order subset containing the original objects. Never mutate/sort/deduplicate/rebuild rows.
- Count all observed rows once; initialize all eight keys to zero, set `all = rows.length`, increment primary label. Counts are terminal agents, not number of groups. Builder already provides exact eligible deduplicated rows.

## Architecture and implementation steps
1. Declare filter type, storage key and count type using existing label authority; keep runtime valid-value list private and exhaustive over all labels.
2. Add safe optional default-storage accessor, exact membership guard and raw-string load/save. Use separate read/write `Pick<Storage,...>` inputs to keep fixtures minimal.
3. Implement all fast path and stable subset filtering, followed by one-pass counting. Complexity O(n), no deep copies or grouping allocation in core.
4. Write node-environment tests with injected Map-backed get/set implementations. Stub global storage only for default-accessor cases; restore property descriptors/globals after each test.
5. Report exported signatures, owned files and test cases; no tests/build/lint/formatter run by phase agent. Main executes consolidated gates after integration.

## Comprehensive Vitest acceptance cases
| Area | Cases and assertions |
|---|---|
| Guard | All eight values true; undefined/null, booleans, numbers, arrays/objects, empty, whitespace, wrong case, `working`, `blocked`, `Done (turn ended)`, quoted JSON string and unknown strings false |
| Load | Each valid value round-trips unchanged; exact key passed to getItem; missing/empty/corrupt values return all; no writes/deletes |
| Storage failures | Missing global storage; throwing localStorage getter; throwing getItem; throwing setItem; explicit injected storage works without browser globals; adapters do not throw |
| Save | Every valid value writes exact key/raw string once, including all; invalid runtime value never written; unrelated entries unchanged |
| Filter | Empty input; all input identity; every primary label; no matches; multiple projects/profiles/harnesses retain input order and object identity; frozen array/objects remain untouched |
| Presentation authority | Raw working state presented Unavailable matches Unavailable, not Working; platform-unqualified/unsupported labels count/filter separately; Idle + ended outcome remains Idle |
| Attention | Approval, Question, Error and null reasons all match Needs attention; reason metadata unchanged |
| Counts | Every key present on empty input; mixed seven-status roster with duplicates by status; all equals length and sum of seven status counts; no group-level dedup; input unchanged |

Use complete minimal row fixtures following navigator/group tests, with qualified terminal keys and explicit presentation metadata. Do not import a test fixture from another phase's file or create shared scaffolding.

## Success criteria and validation handoff
- Both owned files complete; canonical enum/key and all five named exports conform to frozen contract.
- Pure row helpers retain semantics and identities; persistence tolerant of absent/denied browser storage.
- Tests cover table above, especially availability overriding wire state and exact raw-string format.
- Main planned command: `pnpm --filter @dam-hopper/ui test src/lib/traditional-terminal-agent-filter.test.ts` as part of consolidated run, not during parallel edits.

## Risk and security review
- Wrong raw-state filtering would misclassify stale/disconnected rows: require presentation-only tests.
- Accidental enum drift: reuse existing status union; exhaustive Record/valid-values declarations, explicit every-label tests.
- Getter errors occur before usual adapter catches: safe default accessor is required.
- Persist one non-sensitive enum only; no terminal/profile/agent IDs, snapshots or contents. No storage clear/remove.

## Dependencies and unresolved questions
- Phase 03 consumes all exports. Phase 02 can finish without this module by using existing label type and agreed structural count shape.
- Unresolved questions: none.
