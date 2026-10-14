# Code Review: Traditional terminal agents multi-select status filter

Reviewer: CodeReview | Date: 2026-10-14 | Plan: `plans/261014-0125-multi-select-agent-status-filter/plan.md`

## Scope
- Files: `lib/traditional-terminal-agent-filter.ts` (+test), `molecules/traditional-terminal-agent-filter.tsx` (+test), `organisms/TraditionalTerminalProjectsNavigator.tsx` (+test), `browser-tests/terminal-traditional-projects.browser.tsx`, `docs/system-architecture.md`, `docs/CHANGELOG.md`
- ~1900 added / 345 removed lines (diff); prod code ≈ 800 LOC (lib ~275, molecule ~500, navigator 9-line delta)
- Focus: recent changes (uncommitted diff vs `06eb0aee`)
- Checks run by me: `eslint` on all 7 changed TS/TSX files → 0 problems. Scratch Chromium measurement (copy of browser test file; deleted afterwards, `git status` clean of it). Did not rerun tests/build (TesterValidation report: 211/211 pass, build + e2e typecheck OK).
- Plans updated: `plan.md` (review section appended)

## Overall assessment
Architecture sound; core lib/persistence solid and backward compatible. UI molecule well-built for a11y/keyboard. **One real High defect: in the compact sheet the listbox overflows the viewport; most options unreachable by pointer/touch — masked by a test change (`userEvent.click` → programmatic `.click()`).** Plus several Medium/Low items (dead exports, docs inaccuracy, live-region noise, filter/normalize inconsistency). No security issues.

## Checklist vs requested criteria

### 1. Architectural invariants — PASS
- Counts vs selection separated: `TraditionalAgentStatusCountKey` (counts keys) vs `TraditionalAgentStatusSelection = "all" | readonly Label[]`; `counts` stays `Record<CountKey, number>`; selection never indexes counts type-unsafely (`counts[label]`, `counts.all`). ✔
- Backward-compat persistence: scalar `"all"`/`"Working"` load as before; singleton saves scalar; ≥2 saves JSON array. Old build reading new JSON array: old `isTraditionalAgentStatusFilter` rejects non-label string → `"all"` (safe downgrade). ✔
- Load never writes; save only in `handleFilterChange` (user action). No mount writes. ✔
- No backend / PTY / session impact: filtering applied to `agentRows` before `groupTraditionalTerminalAgentRows`; no changes to selection/activation/terminal mounting. ✔
- Counts computed from unfiltered `agentRows` (independent of selection). ✔

### 2. Accessibility (WAI-ARIA 1.2) — MOSTLY PASS, 1 layout blocker
- Pattern: `button[role=combobox][aria-haspopup=listbox][aria-expanded][aria-controls][aria-activedescendant]` + `div[role=listbox][aria-multiselectable=true]` + `div[role=option][aria-selected]`. Matches APG select-only combobox + multiselectable. ✔
- Focus stays on trigger (option `onMouseDown` preventDefault); `aria-activedescendant` only while open; Arrow wrap, Home/End, Enter/Space toggle, typeahead, Escape restores focus, Tab closes without preventDefault. ✔
- Escape isolation in compact Radix dialog: window-capture listener + `stopImmediatePropagation` runs before Radix's document-level Escape handler. Sheet also has `onKeyDown stopPropagation`. ✔ (browser test covers).
- Touch targets `min-h-11`/`min-h-12`. ✔
- Issues: see H1, M2, M3, L2, L3, L6.

### 3. Type safety / ESLint — PASS
- ESLint clean (0 findings). Types exported precisely; no `any`; only 2 `@ts-expect-error` (jsdom polyfill in test, acceptable). Non-null `!` use is guarded by length/index logic.
- Nits: L4, L5.

### 4. Edge cases — PASS in lib, FAIL in compact layout
- Storage: `getItem`/`setItem` throwing, `localStorage` getter throwing (SecurityError), `undefined` storage, corrupt JSON, JSON non-array, `[]`, invalid labels, duplicates, whitespace-padded JSON → all normalized to `"all"` or valid subset. Quota error swallowed in save. ✔
- Compact sheet dialog isolation (Escape/selection don't dismiss sheet or select terminal) ✔ — but geometry ✘ (H1).

## Critical issues
None.

## High priority

### H1. Compact sheet: listbox overflows viewport; options unreachable by pointer/touch
Evidence (Chromium, scratch copy of the compact test, viewport 375×700, sheet open, filter opened):
```
vh=700  listbox top/bottom = 591 / 831   sheet top/bottom = 163 / 700
option          top  bottom  hit-test inside option?
All statuses    596   644    true
Needs attention 644   692    true
Working         692   740    null (off-screen)
Idle            740   788    null
Unknown…Unsupported 788-980  null
```
Cause: listbox is `absolute top-full max-h-60` (240px) rendered inline inside a `fixed bottom-0` sheet (`max-h 75vh`), no overflow container, no collision/flip logic. Filter sits in the lower (agents) half of the sheet, so the dropdown extends past the viewport bottom; page can't scroll to it. Keyboard users get active option scrolled inside listbox but visually off-screen too. Regression vs previous Radix Select (portaled, collision-aware).

Why tests missed it: the compact test (`browser-tests/...:1878`) was changed from `await userEvent.click(workingOption)` to `act(() => workingOption.element().click())` (programmatic, bypasses hit-testing) with no explanatory comment; the 320/375/390 geometry test (`:1939`) uses 844px height and asserts only width/right edges, never bottom ≤ viewport nor `elementFromPoint`.

Fix options (pick one, KISS):
1. Make listbox flip upward / size to available space: measure `trigger.getBoundingClientRect()` on open; if `viewportHeight - rect.bottom < needed`, use `bottom-full mb-1` and `max-h` = min(15rem, available). Use `window.visualViewport?.height ?? innerHeight`.
2. In compact (`touchOptimized`) render options inline (non-absolute, in flow, expanding the filter block; sheet already scrolls) instead of floating popover.
3. Portal to body with `position: fixed` + computed coords (but must keep Radix dialog outside-pointer/focus-trap compat: portal outside `DialogContent` is "outside" → clicks would dismiss sheet unless `onPointerDownOutside` guarded). Option 1/2 avoid this.
Then restore `await userEvent.click(...)` in the compact test and add an assertion: every option `elementFromPoint(center)` is inside option (or listbox scrolled so active option is visible) at heights 568/700/844.

## Medium priority

### M1. Docs claim `data-checked` that does not exist
`docs/CHANGELOG.md` (2026-10-14 entry): "checkmark indicators (`data-checked`)". No `data-checked` anywhere in `packages/ui` (state exposed via `aria-selected` + `Check` icon). Also "129 unit tests" vs tester total 130 (80 lib + 50 molecule). Fix wording/count. `docs/system-architecture.md` line 51 updated correctly otherwise; add a one-line note once H1 chosen layout is settled.

### M2. Live region announces every count change, including while closed
`<span id=descriptionId class="sr-only" aria-live="polite">` text = `"<label>: N of M observed agents."` and is also `aria-describedby`. Agent statuses update continuously → repeated polite announcements unrelated to user action; plus duplicate announcement with option `aria-selected` change while open. Recommend: drop `aria-live` from that span (keep as describedby), and add a separate live region updated only on user toggles (e.g. "Working selected. 2 statuses, 3 of 5 agents."), or gate on `isOpen`.

### M3. `filterTraditionalTerminalAgentRows` / `formatTraditionalAgentStatusFilter` do not normalize
Public signature accepts `TraditionalAgentStatusFilter` (incl. scalar, `[]`, unsorted/duplicate/invalid arrays) but behaves differently from `normalizeTraditionalAgentStatusFilter`/`save`: `filter(rows, [])` → `[]` (tests lock this at `lib test:669`) while normalize(`[]`) → `"all"`; `format([])` → `""`. Navigator is safe (state always normalized by load + `onValueChange`), but the API invites divergence. Either narrow both params to `TraditionalAgentStatusSelection` (preferred, state is always a Selection) or normalize first. Also drop unreachable trailing `return rows` / `return "All statuses"` branches.

### M4. Dead / duplicated exports (YAGNI, DRY)
- `isTraditionalAgentStatusFilter`: no production caller after rewrite (only its own tests). `CANONICAL_STATUS_ORDER`: alias of `CANONICAL_TRADITIONAL_AGENT_STATUS_LABELS`, test-only. Remove both (and their tests), or justify.
- `isTraditionalAgentStatusLabel` exists but `normalize`, `load`, `count…` re-inline `Object.hasOwn(STATUS_LABEL_RECORD, x)` + `as` casts (4×). Use the guard → removes casts.
- Molecule re-exports lib types (`export type {…}`), only consumed by its own test; import from lib instead.

## Low priority
- L1. `activeIndex` stale on mouse open (only ArrowDown/ArrowUp/Enter reset it); click-open resumes at previous index. APG: initial active = first selected option. Typeahead/arrow while closed mutates `activeIndex` invisibly (arrow-down opens, but typeahead char doesn't).
- L2. Option `onKeyDown` and `tabIndex={-1}` are dead: focus never leaves trigger (mousedown prevented). Remove handler or keep only if options become focusable.
- L3. Safari (macOS/iOS): buttons don't take focus on click → `document.activeElement` is `body`, trigger never gets keydown; Escape then falls into the "not owned" branch (closes listbox but also lets Radix close sheet). [INFERENCE, not verified in Safari]. Could focus trigger explicitly in `onClick`.
- L4. `React.KeyboardEvent` used while file imports only named `type JSX` from react; import `type KeyboardEvent as ReactKeyboardEvent` for consistency (compiles today).
- L5. `counts.all ?? 0`, `counts[x] ?? 0` on non-optional types are redundant (rule not enabled, harmless, hides missing-key bugs).
- L6. `FILTER_OPTIONS` hand-duplicates canonical label order from lib; derive from `CANONICAL_TRADITIONAL_AGENT_STATUS_LABELS` or add an order-equality test to prevent drift.
- L7. "All statuses" option is mutually exclusive with others inside a `aria-multiselectable` listbox; acceptable and documented, but SR users hear it as a normal checkbox-like option — consider `aria-label` "All statuses, clears filter".
- L8. Test hygiene: browser test at `:1240-1246` toggles Working onto Idle but never asserts trigger text `Idle, Working` / storage JSON (`["Working","Idle"]`) — only roster length. Add storage assertion for the multi-value case (unit tests cover it).
- L9. Large test files (browser 2466 LOC, navigator test 1394, molecule test 1209): modularize when next touched (also tester's recommendation).

## Positive observations
- Single normalization funnel (`normalize…`) used by component, load, save → consistent canonical order, dedup, all-7→`"all"`.
- Defensive `defaultStorage()` evaluated safely even as default argument; explicit test for no storage calls on mount/rerender.
- Escape handling designed for Radix layering; stale-timer-free; listeners attached only while open.
- Scroll-into-view without scrolling ancestors (`offsetTop` math on positioned listbox).
- Sensible UX: dropdown stays open for multi-toggle; last-uncheck reverts to "all"; zero-count options remain selectable.
- Navigator diff minimal (9 lines); `useMemo` chain unchanged; empty-state message uses shared formatter.
- Comprehensive tests (130 unit + 39 navigator + 42 browser all passing per tester).

## Recommended actions (priority order)
1. **H1**: fix listbox placement/size in compact sheet (flip/size-to-viewport or inline expansion); restore real pointer click in compact test; add hit-test/bounds assertions at multiple viewport heights.
2. **M1**: fix CHANGELOG (`data-checked`, test count).
3. **M2**: remove always-on `aria-live` from description; add interaction-scoped announcement.
4. **M3/M4**: narrow `filter`/`format` params to `TraditionalAgentStatusSelection`; remove dead exports/aliases; use `isTraditionalAgentStatusLabel` in lib.
5. Low items as time permits (L1, L2, L6, L8 cheapest).

## Metrics
- Type coverage: strict TS; no `any`; 2 justified `@ts-expect-error` (tests)
- Test coverage: no coverage tool installed (`@vitest/coverage-v8` absent per tester); 211 targeted tests green
- Lint: 0 errors / 0 warnings on 7 changed files

## Plan status
Phases 1–3 implemented and tested; plan remains `in_progress` pending H1 (+M1). Side-effect checklist item "Escape dismisses dropdown without closing compact dialog" verified; "compact sheet usable via touch" NOT verified (fails, H1).

## Unresolved questions
1. Is a portaled/anchored popover (collision-aware) preferred over inline expansion for compact? Affects H1 fix choice.
2. Should `isTraditionalAgentStatusFilter` stay as public API for other packages? Grep shows no consumer in `packages/`.
3. Safari behavior (L3) unverified — no Safari/WebKit browser project configured.
