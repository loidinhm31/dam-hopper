# Phase 02 — Controlled filter molecule

## Overview
- Priority P2; status pending; estimated effort 2h.
- Runs concurrently with Phase 01; independently implementable and testable against existing modules only.
- [Master contract](./plan.md#frozen-parallel-work-contract); [core contract](./phase-01-filter-core.md); [integration](./phase-03-navigator-integration.md).

## Ownership and research context
Create only:
1. `packages/ui/src/components/molecules/traditional-terminal-agent-filter.tsx`
2. `packages/ui/src/components/molecules/traditional-terminal-agent-filter.test.tsx`

Read-only references:
- `packages/ui/src/components/ui/Select.tsx`: existing Radix Root/Trigger/Content/Item/Value exports; Content already portals; Item wraps children in ItemText and provides selection check.
- `packages/ui/src/components/molecules/traditional-terminal-agent-group-row.tsx`: status icons/colors, focus classes, 44px minimum targets and 48px touch targets.
- `packages/ui/src/components/organisms/TraditionalTerminalWorktreeSelect.test.tsx`: `// @vitest-environment jsdom`, React `act`/`createRoot`, missing pointer-capture/scroll APIs.
- `packages/ui/src/lib/traditional-terminal-agents.ts`: existing status union.
- [React/Radix standards](../../docs/code-standards.md#react-and-typescript).

## Fixed component contract
```ts
import type { JSX } from "react";
import type { TraditionalAgentStatusLabel } from "@/lib/traditional-terminal-agents.js";

export interface TraditionalTerminalAgentFilterProps {
  readonly value: "all" | TraditionalAgentStatusLabel;
  readonly onValueChange: (value: "all" | TraditionalAgentStatusLabel) => void;
  readonly counts: Readonly<Record<"all" | TraditionalAgentStatusLabel, number>>;
  readonly touchOptimized?: boolean;
}

export function TraditionalTerminalAgentFilter(
  props: TraditionalTerminalAgentFilterProps,
): JSX.Element;
```
- No import from the new Phase 01 helper: existing type plus structural signature gives true parallel independence. Core is canonical persistence/filter authority; UI owns only option presentation.
- Named export, kebab-case file, `.js` imports; repository's Radix pattern wins over generic frontend-skill framework conventions.
- Import Select primitives from `@/components/ui/Select.js`; no native select, direct alternate Radix wrapper, new dependency or primitive modification.
- Controlled `value`/`onValueChange`; no own selected state, localStorage, store subscription, data filtering or network work.
- Readonly full counts passed by navigator. Selected value must remain representable when its count becomes zero.

## Options and visual presentation
Fixed order; primary labels exactly preserve case:

| Value | Display label | Indicator/color consistent with existing group row |
|---|---|---|
| `all` | All statuses | Neutral, no implied agent state |
| `Needs attention` | Needs attention | CircleAlert; warning |
| `Working` | Working | Activity; info |
| `Idle` | Idle | Circle; normal text |
| `Unknown` | Unknown | CircleHelp; muted/dashed treatment |
| `Unavailable` | Unavailable | Unplug; muted |
| `Platform unqualified` | Platform unqualified | TriangleAlert; warning |
| `Unsupported` | Unsupported | Ban; muted |

- Always eight enabled options, including zero counts. Show each raw agent count in a compact tabular-number badge; `all` uses total rows, not grouped items.
- Selected trigger presents label/indicator and selected count. Set explicit `SelectValue` content if needed so Radix ItemText copying cannot duplicate badges/icons or show stale counts.
- Option metadata is one small local presentation list typed against the existing union; do not duplicate state/availability derivation or export/change the existing group-row style map.
- Use existing theme tokens, lucide icons and `cn`; icons `aria-hidden="true"`; status text conveys meaning independently of color.
- Narrow sidebar: full-width trigger, `min-w-0`, label `<span className="min-w-0 truncate">`, count/icon `shrink-0`; do not force a wider navigator or clip menu behind section overflow.

## Accessibility and touch requirements
- Trigger stable accessible name: `aria-label="Filter agents by status"`. Selected value visibly readable; use generated description ID for selected/total count explanation, e.g. “Working: 2 of 6 observed agents.”
- Use `useId` for descriptions; no hard-coded instance IDs. Preserve Radix combobox/listbox/option roles, expanded/selected state and focus handling; never manually rewrite Radix's aria-controls.
- Each option has visible status and count; accessible option name conveys count (e.g. “Working, 2 agents”). Set `textValue` to plain display label for reliable typeahead independent of decorative badge text.
- Trigger and options minimum 44px (`min-h-11`); `touchOptimized` gives 48px (`min-h-12`). Both variants preserve focus-visible ring, full-width pointer target and keyboard operation.
- Keyboard: open via Enter/Space/ArrowDown; navigate/select with arrows and Enter; Escape closes menu/restores trigger; Tab follows Radix. Do not preventDefault/stop propagation in a way that breaks native Radix behavior.
- No project/terminal activation callback from this molecule. It is mounted outside project tabs and disabled agent fieldset by Phase 03. Compact nested-dialog behavior gets real Chromium coverage from Main.

## Implementation steps
1. Define props and exhaustive local option metadata using existing status type; keep module small and focused, no new global abstraction.
2. Render existing controlled Select with mapped SelectItems, textValue, visible count badges and selected display; adapt the Radix string callback only to the known option union (no unsafe arbitrary external values).
3. Add stable naming/descriptions, decorative-icon ARIA and touch/narrow styling. Respect existing portal implementation; no bespoke overlay or document listener.
4. Implement jsdom tests using real Select primitives and document-level portal queries. Avoid mocking Select into a native select or testing only static HTML.
5. Use a controlled harness to prove callback and parent-value updates. Minimal missing platform API stubs scoped to test file, saved/restored descriptors, no geometry fakes that purport to verify touch sizes.
6. Report owned files/API/test scenarios. Skip builds/tests/lint/formatters during phase work; Main validates after all phases land.

## Comprehensive Vitest acceptance cases
| Area | Expected behavior |
|---|---|
| Initial render | Named combobox; all and each status render selected label/count; aria-describedby resolves; icons hidden from accessibility |
| Portal/options | Real menu opens; exactly eight options in frozen order with label/count; no nested button or accidental tab semantics |
| Controlled selection | Choose each status/all; callback once with exact value; parent rerender updates selected text/count; no independent selection state |
| Zero-count states | All options enabled on empty roster; choose zero status; later count drops to zero without changing value or firing callback |
| Live props | Counts update while closed/open without stale selected badge or duplicated ItemText; selected status stays fixed |
| Keyboard | Enter/Space/Arrow opening, arrow navigation and Enter selection; Escape closes without change and restores focus; textValue supports status typeahead |
| Touch/narrow | Default and touch classes on trigger/items, truncate/shrink classes on long labels/counts; class assertions only, actual geometry tested in browser |
| Lifecycle | Multiple instances have unique descriptions; unmount removes portal; storage is never accessed; callbacks not fired during mount or counts-only rerender |

## Success criteria and validation handoff
- Component and tests complete without waiting for Phase 01 or importing an absent new module.
- Exact eight status options and full count shape align with core; real Radix interactions covered, no storage side effects.
- Main planned command: `pnpm --filter @dam-hopper/ui test src/components/molecules/traditional-terminal-agent-filter.test.tsx` within consolidated run.
- jsdom results are not browser focus/touch qualification. Main owns additional tests in existing `packages/ui/browser-tests/terminal-traditional-projects.browser.tsx`; neither phase agent edits it.

## Risk and security review
- Radix's ItemText can copy decorated children: explicitly test selected display and count updates.
- JSDOM lacks some browser APIs: reuse minimal existing pointer/scroll patterns and restore them; do not replace actual component behavior.
- React 19 composed-ref patch is required; no lockfile/patch changes.
- No sensitive data enters molecule, persistence or logs; use only labels/counts supplied by caller.

## Dependencies and unresolved questions
- Phase 03 mounts component after both parallel results; Main owns compact Dialog/portal/browser gate.
- Unresolved questions: none.
