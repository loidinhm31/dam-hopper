# Code Review: UI selection contrast + adaptive system typography

Branch `feat/ui-selection-contrast-and-font-system` | Plan `plans/261014-1218-ui-contrast-font-system/` | Score **6/10** | Critical: **1**

## Critical (1)
1. **Selected rows lose keyboard focus ring.** `.workbench-selection` (index.css:135, unlayered) sets `box-shadow`; Tailwind `ring-*` utilities live in `@layer utilities` → unlayered wins → ring dead on selected rows. Verified in Chromium (temp browser test, deleted): `workbench-selection focus:outline-none focus:ring-1` focused => computed `box-shadow = rgb(85,147,247) 3px 0 0 0 inset`, `outline-style none`, element active. No focus indicator.
   Affected (selected + focused → invisible focus):
   - `CommitDetailsPanel.tsx` file row (`focus:outline-none focus:ring-1`)
   - `traditional-terminal-agent-group-row.tsx` active button (`focus-visible:outline-none focus-visible:ring-1 ring-inset`)
   - `TerminalRuntimeNavigatorItem.tsx` `RuntimeSessionLeaf` wrapper (`focus-within:ring-1`; inner button ring still OK)
   Fix: drive indicator via a CSS var that ring composes with, or put focus style in CSS beside the class, e.g. `.workbench-selection:focus-visible { outline: 2px solid var(--color-ring); outline-offset: -2px; }` and drop `outline-none` on those rows; or draw the 3px marker with `::before`/`border-left` instead of `box-shadow`. Add browser test: selected+focus has visible outline/ring. Same cascade trap: any `text-*`/`bg-*` utility put on the same element as `workbench-selection` silently loses (unlayered) — consider `@layer components`/`@utility workbench-selection`.

## Warnings
1. **Typography migration incomplete.** 425 `text-[Npx]` remain under `src/components` (e.g. `FileTree.tsx:254`, `GitBranchControl`, `GitLocalChanges`, `EditorTabs`, `FileStatusBadge`, `DiffViewer`, Browser debug*, Workflow*). Workspace shells/IDE panels partially scaling, rest fixed → inconsistent at 20–32px. Plan's "transitive chrome audit" not met. Either finish the sweep or document the in-scope boundary.
2. **Contrast not validated.** Muted children inside selected rows keep `text-[var(--color-text-muted)]` (SearchPanelResults line number, TraditionalTerminalProjectsNavigator git summary/profile badge, RuntimeSessionLeaf children). Muted on 28%/35% blue overlay may fall <4.5:1; no ratio test. Browser test only asserts white `color` + shadow string; nothing on selected-hover, focus coexistence, 6 surfaces (only agent row rendered), or row geometry.
3. **Weak assertions.** `toBeCloseTo(14, 0.5)` (digits arg 0.5 → tolerance ~0.16, intent unclear); use explicit range like the other cases.
4. **Row-height helper duplicates CSS constants** (`0.857`, `4/3`, `py-0.5`=4px, clamp 10..32, fallback 14) in `workbench-typography.ts`; drift risk if tokens/`clampFont` (settings.ts FONT_MIN/MAX) change. Import `FONT_MIN/FONT_MAX`/default from settings/ui-config; comment pointing to index.css tokens. Real row content (16px icons, gaps) not measured; no component-level test that Arborist rows don't clip at 32px.
5. **Docs/plan not updated.** No change in `docs/` (code-standards/design-guidelines/frontend-components) for new tokens, `workbench-selection`, `text-2xs`, or "UI text scales; Monaco/xterm independent" invariant. Plan phases still `pending`.
6. **Stray untracked files** unrelated to feature: `.omp/evcrate/scripts/worktree.cjs`, `plans/reports/debugger-261012-2239-second-server-mongodb-auth.md`. Keep out of commit.

## Suggestions
- `::selection` uses `--color-selection-hover` (token intended for row hover); add a dedicated `--color-selection-text-bg` or comment the reuse.
- `text-2xs` (≈10px at 14) is below common legibility floor and 9px→10px bump is the only gain; ok, but at 10px setting it is 7.1px. Consider `max(10px, …)` floor for 2xs.
- `ChangedFilesList` repeated `/75`, `/80`, `/85` selected-opacity text values: unify into a token/class (`workbench-selection-muted`).
- `FileTree` `useSettingsStore()` whole-store subscribe pre-existing; selector `useSettingsStore(s => s.systemFontSize)` would avoid re-render on unrelated settings (perf nit; `rowHeight` itself memoised).
- Tests: add focus-ring, selected-hover, ≥4.5:1 computed contrast (alpha-composite), settings-store live-update, FileTree row height change without remount.

## Passed invariants
- Tokens in `@theme` (4 selection + 7 text + line-height companions). No `html { font-size }`; `--app-font-size` only on `:root` (14px default) and synced by existing `syncFontSizeCssVar` — no second synchronizer.
- Monaco/xterm independence: no `systemFontSize`/`--app-font-size` use in editor/terminal font code.
- At default 14px text tokens equal Tailwind defaults (12/14/16/18) → no regression for untouched components. `text-2xs` recognised by tailwind-merge as t-shirt size (verified `twMerge`: `text-2xs text-[var(..)]` kept both; `text-xs text-green-400 text-[var(--color-selection-text)]` correctly keeps latter).
- No `dangerouslySetInnerHTML`/new inputs/network surface; security impact none. `aria-current` preserved on agent row/runtime button; `min-h-11` hit targets kept; FileTree focus outline strengthened (`/40→/70`, now shown when selected too); `EditorStatusBar` fixed `h-[22px]`→`min-h` + `py-0.5` avoids clip.
- No name collision: `workbench-selection` only added in CSS (stores `workbench-selections` unrelated).
- No perf concerns: static CSS, memoised row height, no new subscriptions.

## Reviewed files
index.css, workbench-typography.ts(+test), selection-contrast-and-typography.browser.tsx, FilePathLabel, traditional-terminal-agent-group-row, EditorTab, TraditionalTerminalProjectsNavigator, TerminalRuntimeNavigatorItem, FileTree, ChangedFilesList, CommitDetailsPanel, SearchPanel, SearchPanelResults, WorkspaceGitPanel, TraditionalTerminalWorktreeSelect, EditorStatusBar, TerminalTabBar, ActiveTerminalRuntimeDisplay, MobileWorkspaceShell, WorkspacePage.

## Validation
| Command | Result |
|---|---|
| `pnpm exec tsc -p tsconfig.json --noEmit` (packages/ui) | no errors |
| `vitest run src/lib/workbench-typography.test.ts` | 4/4 pass |
| Temp browser test (focus ring vs `.workbench-selection`) | reproduced Critical #1; file removed |
| Tester report `plans/reports/test-261014-1249-...md` (not re-run): ui test 2920/2920, browser selection 5/5, terminal 45/45, ui build + web build OK | pass (cited) |
| Not run: app E2E, native Tauri/WebView visual, lint (no lint script in packages/ui) | gap |

## Unresolved questions
1. Is full `text-[Npx]` migration across all 425 sites in scope, or only the named surfaces?
2. Preferred focus-indicator style for selected rows (outline vs ring vs `::before` marker)?
3. Is a WCAG alpha-composited contrast test required as a gate (plan phase 3)?
