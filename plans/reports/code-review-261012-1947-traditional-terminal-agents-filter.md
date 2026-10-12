## Code Review Summary

### Scope
- Files reviewed (9): `lib/traditional-terminal-agent-filter.ts` (+test), `molecules/traditional-terminal-agent-filter.tsx` (+test), `organisms/TraditionalTerminalProjectsNavigator.tsx` (+test), `browser-tests/terminal-traditional-projects.browser.tsx`, `docs/system-architecture.md`, `docs/CHANGELOG.md`
- Also read for context: `traditional-terminal-agent-groups.ts`, `ui/Select.tsx`, `traditional-terminal-agent-group-row.tsx`, `TraditionalTerminalProjectsDisplay.tsx` (wide + compact Dialog hosts), plan + phase-03.
- LOC: ~133 lib, ~189 molecule, +41/-4 navigator, ~2.4k test (lib 475, molecule 688, navigator +890), +78 browser, docs +8.
- Focus: new feature diff vs plan contract, a11y, persistence safety, presentation-only filtering, tests.
- Plan updated: `plans/261012-1947-traditional-terminal-agents-filter/plan.md` (review-status section appended; phase statuses untouched).

### Overall Assessment
Implementation matches frozen contract (enum, key, 8 counts, option order, props, data flow). Core + molecule + integration clean, small, safe. No critical/security issue. Real defects are docs (misplaced/unsupported claims, unrelated-sentence move) and browser-regression coverage shorter than the plan promised. Verified myself (this worktree):
- `vitest run` 3 new/changed unit files: 108/108 pass.
- `vitest.browser` `terminal-traditional-projects.browser.tsx`: 37/37 pass.
- `tsc -p packages/ui/tsconfig.json --noEmit`: clean. `eslint` on all 7 code/test files: 0 findings.
- Changelog numbers 108 / 37 confirmed. "218 tests / 8-file suite" NOT re-run, unverified by me.

### Critical Issues
None.

### High Priority Findings
1. **Docs claim un-evidenced shipped behavior.** `system-architecture.md:54` and CHANGELOG say selection is "restored on page refresh". Only evidence is jsdom/Chromium *remount* tests (`root.unmount(); createRoot(...)`), not a real navigation reload. Plan gate (plan.md "Delivery gates") explicitly says Main must verify actual refresh separately and "No remount test claimed as actual navigation reload". Either run + record a real reload check, or reword to "restored when the navigator remounts (including reload when storage is available)" without claiming tested reload.
2. **Architecture doc sentence moved to wrong context.** Original paragraph ended "Component, focused browser, and production application journey gates have been qualified; full-viewport visual review is accepted. See [implementation progress](...progress.md)." That qualification applied to the *prior* agents-sidebar feature. Diff split paragraph and re-attached that sentence + link to the end of the NEW filter paragraph (line 54), so it now reads as if the filter passed production journey + visual review. Not true (plan: no production/visual gate run). Move sentence back to previous paragraph (line 52) and keep filter paragraph claim-free of those gates.
3. **Browser regression coverage < plan.** Plan promised Chromium: desktop *and compact* dropdown, keyboard/Escape/focus, 320-390px touch geometry, live counts, exact cycling. Added: one desktop test only (Idle/Working/All + remount). Missing:
   - compact dialog: open filter, select option, assert dialog NOT dismissed and no terminal selected; Escape closes listbox first (existing worktree-select test at ~L1913 is the template).
   - touch geometry of the trigger + options at 320/375/390 (only incidental: compact test ~L1739 checks every `button` in dialog >=44px at 375, which includes the trigger but not options, not 320/390).
   - a case where filter actually *excludes* rows in Chromium (fixture both Idle; only the zero-match path exercised).
   - live status change updating counts / membership.

### Medium Priority Improvements
1. **Empty-state not announced.** Filtered-empty `<p>` ("No observed agents match X.") has no `role="status"`/`aria-live`. Trigger `aria-describedby` live text ("Working: 0 of 2 observed agents.") partly covers it, but SR users who select an option get no explicit list-empty announcement. Low-cost: `role="status"` on that `<p>`.
2. **DRY: icon/tone map duplicated** from `traditional-terminal-agent-group-row.tsx` (L20-26: same lucide icons + token classes, incl. copied no-op `border-dashed` on an icon). Plan froze group-row as read-only, so acceptable now; follow-up: export the map from group-row (or a lib) and consume in the filter. Same for the 8-key `VALID_FILTER_VALUES` (molecule) vs `VALID_FILTER_RECORD`/`STATUS_LABEL_RECORD` (lib) — three near-identical records; molecule duplication was by plan (no import of lib), lib could derive `STATUS_LABEL_RECORD` from a single array.
3. **Browser-test sync assertions.** `expect(filterTrigger.element().textContent).toContain("Idle")` and `localStorage.getItem(...)` read immediately after `userEvent.click`; use `await expect.element(...).toHaveTextContent(...)`/`vi.waitFor` to avoid flake under load. Passed in my run (12s), but pattern is race-prone.
4. **File-size rule (200 LOC, development-rules.md:8).** Navigator.tsx now 421 lines (was ~377, already over). Tests: navigator 1302, molecule 688, lib 475. Not blocking (no split mandated by plan; navigator already over), but molecule test and navigator test could split by concern (`*.keyboard.test.tsx`, `*.persistence.test.tsx`).
5. **Test churn in navigator test.** `makeAgentRow` reformatted wholesale (multi-line) alongside real option additions; fine functionally, but makes diff review noisy. Scoped existing combobox selectors correctly (`aria-label^="Worktree for"`), and added filter-presence assertions — matches plan step 6.

### Low Priority Suggestions
- `defaultStorage()`: `typeof globalThis !== "undefined"` redundant in ES2020+ targets; harmless.
- `countTraditionalTerminalAgentsByStatus`: `Object.hasOwn(STATUS_LABEL_RECORD, label)` guard drops an unknown label silently while `all` still counts it (invariant sum==all could break). Type system already excludes; consider removing or asserting.
- `SelectGroup` without `SelectLabel` adds an unlabeled `role=group`; harmless, can drop.
- `data-testid="agent-filter-count-badge"` shipped in prod markup twice (trigger + option) — consistent with existing `agent-count-badge` convention, OK.
- Molecule tests assert Tailwind class strings (`min-h-11`, `min-h-12`) for touch targets; jsdom can't measure. Acceptable given Chromium geometry (see High #3) but class-string tests are brittle.
- Empty message uses raw value: "No observed agents match Needs attention." reads OK; "all" branch unreachable.
- `agentRows = []` default creates new array each render → memo recompute when prop omitted (pre-existing pattern).

### Positive Observations
- Persistence is solid: lazy `useState(() => load())`, save only in event handler, both load/save try/catch incl. throwing `localStorage` getter, `Object.hasOwn` enum validation (no `__proto__`/`toString` bypass), invalid values never written, no remove/clear, raw string only, no identifiers/status snapshots persisted. Navigator never touches `localStorage` directly.
- Filtering is presentation-only and placed correctly before grouping. I verified `groupTraditionalTerminalAgentRows` keys on `[groupId, label, reasonLabel]`, so filter-by-label drops whole groups: group keys, member order, reason separation, Done hint, and `nextAgentSessionId` cycling are unchanged. `all` returns same array identity; subset keeps row references. Counts use unfiltered rows (all 8 keys always present, `all` = row count). Active session/group untouched, selection callbacks never invoked by filter change (tests cover aria-current restore).
- Filter lives outside the `disabled` fieldset, always enabled; original zero-observation explanation retained; distinct empty message for filtered-zero; chosen filter survives roster emptying/zero count (tests).
- Radix `Select` (existing primitive) owns combobox/listbox semantics, Enter/Space/ArrowDown/typeahead/Escape/focus-return; `textValue` supplied for typeahead; option `aria-label` carries count; trigger `aria-label` + `aria-describedby` live description; icons `aria-hidden`; icon + text (not color-only). Trigger/options `min-h-11` (44px), `min-h-12` when touch; popper width follows trigger; z-80 above compact Dialog z-50; same Select-in-Dialog pattern already proven by worktree select.
- Invalid `value` prop falls back to "all"; unknown `onValueChange` values ignored.
- Existing worktree combobox tests correctly scoped; storage + portal + pointer-capture/scrollIntoView polyfills restored via original descriptors in `afterEach`; only the exact filter key removed (plus fake unrelated key to prove untouched).
- Unit coverage thorough: enum validity, exact key, round-trip, missing/corrupt/throwing storage, setItem throw, invalid save rejected, immutability/frozen inputs, presentation-authority cases (wire working → Unavailable), attention reasons, per-agent vs per-group counts, zero-count selection, live props, keyboard, unmount cleanup, no storage access in molecule.
- Plan file ownership respected (only owned files modified; no dep/export/server changes).

### Recommended Actions
1. Fix `docs/system-architecture.md`: restore the "gates qualified ... progress" sentence to the previous paragraph; do not attach to filter paragraph; drop/qualify "page refresh" claim unless real reload verified.
2. Run + record a real app page-refresh check (saved non-all and `all`) per plan gate, or soften wording in docs + CHANGELOG ("on remount").
3. Add Chromium tests: compact dialog filter (stays open, no terminal selection, Escape order), 320/375/390 trigger+option >=44px, row-exclusion case, live count update. Convert sync reads to awaited `expect.element`.
4. Add `role="status"` to filtered-empty message.
5. (Follow-up, separate PR OK) de-duplicate status icon/tone map with group-row; consider test-file split for 200-LOC rule.
6. Update plan statuses to Done only after items 1-3 closed; CHANGELOG "218 tests" figure should cite the exact command/files so it is reproducible.

### Metrics
- Type check (`tsc --noEmit`, ui): 0 errors (run by me).
- Lint (`eslint`, 7 files): 0 errors/warnings (run by me).
- Unit: 108/108 (3 files). Browser: 37/37 (1 file). Coverage % not measured.

### Unresolved Questions
- Is a real production page-refresh/visual check planned (Main-owned per plan), or should docs be softened?
- Should the 200-LOC rule be enforced for the already-421-line navigator, or exempted until a dedicated split?
- OK to accept the molecule re-declaring the icon/tone map until group-row is unfrozen?
