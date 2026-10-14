# Phase 02 — Adaptive system typography and virtual-tree geometry

## Overview
Priority P2. Status pending. Estimate 7h. Dependency: Phase 01 integrated; both phases edit `index.css` and navigator/explorer/Git consumers. Adapt workbench chrome to the existing System font size setting without scaling global layout.

## Context links
[Overview](./plan.md), [selection contract](./phase-01-selection-contrast-tokens.md), [QA matrix](./phase-03-verification-and-review.md), [architecture](../../docs/system-architecture.md), [Tailwind typography](https://tailwindcss.com/docs/font-size), [Arborist documentation](https://github.com/brimdata/react-arborist).

## Key insights and current data flow
`SettingsAppearanceSection.tsx` already offers independent System/Editor/Terminal font settings, each 10–32px. `settings.ts` clamps and persists preferences to the selected preferences owner. `dam-hopper-app.tsx` already sets the root variable on mount/store updates and hydrates settings. Preserve this path:

`System font size control → saveDebounced({ systemFontSize }) → existing settings store → existing root CSS synchronizer → --app-font-size → @theme --text-* → shared UI text`.

The body consumes the variable but Tailwind's stock typography uses rem; explicit `text-xs`/`text-sm` children therefore ignore system font changes. Changing `html` font size is rejected: it would scale rem padding, gaps, icons and hit targets. A body-only fix misses explicit sizes; per-component inline font styles duplicate policy. Override the existing theme typography namespace once.

## Requirements and architecture
### Exact theme values
Add all seven requested expressions to the existing `@theme`; keep its font families/colors intact. Companion line heights are unitless, so line boxes scale with text rather than retain fixed rem height.

| Token | Required expression | Default approximate px | Companion `--text-*--line-height` |
|---|---|---|---|
| `--text-2xs` | `calc(var(--app-font-size, 14px) * 0.714)` | 10 | `1.4` |
| `--text-xs` | `calc(var(--app-font-size, 14px) * 0.857)` | 12 | `calc(4 / 3)` |
| `--text-sm` | `var(--app-font-size, 14px)` | 14 | `calc(10 / 7)` |
| `--text-base` | `calc(var(--app-font-size, 14px) * 1.143)` | 16 | `1.5` |
| `--text-lg` | `calc(var(--app-font-size, 14px) * 1.286)` | 18 | `calc(14 / 9)` |
| `--text-xl` | `calc(var(--app-font-size, 14px) * 1.429)` | 20 | `1.4` |
| `--text-2xl` | `calc(var(--app-font-size, 14px) * 1.714)` | 24 | `calc(4 / 3)` |

Use exact specified rounded multipliers, not silently substituted fractions. Default computed sizes are approximately 9.996/11.998/14/16.002/18.004/20.006/23.996px; browser assertions use the expression with a small rounding tolerance, not equality to rounded labels. Existing `--app-font-size: 14px` root default/body rule and CSS fallback stay. No `html { font-size: ... }`, new setting, new theme file, or second CSS-variable subscription. Tokens propagate through both thin hosts and body-mounted Radix portals because they resolve at root.

Stock `text-3xl` and larger remain outside the requested seven-token change. Audit any such classes reached by workspace chrome; map actual headings to requested semantic sizes where needed rather than inventing an unsolicited extended scale.

### Typography migration rules
- `text-[10px]` → `text-2xs` for compact metadata, captions and counts.
- `text-[11px]`/`text-[12px]` → `text-xs` for file names, readable metadata and compact controls. The deliberate 11→approximately12px baseline increase must appear in visual review.
- Ordinary 9px textual badges/directory labels reached by workspace → `text-2xs`; expand their text-containing boxes if needed. Do not preserve unreadable fixed-pixel chrome by calling it an icon.
- Other arbitrary text sizes/inline `fontSize` in workspace chrome: classify by role and migrate to the existing nearest semantic token; record any justified independent renderer exception.
- Audit fixed `leading-4`, slash line-height modifiers and explicit pixel line heights on migrated labels. Remove conflicting fixed leading or use a suitable unitless `leading-*` ratio. `leading-none` is acceptable for a padded badge, not clipped prose.
- Keep existing responsive `text-*` utilities; all corresponding sizes now adapt automatically. Existing calculations already based on `--app-font-size` (TopNav, ConnectionDot, project/workspace switchers) already adapt; do not multiply them again or standardize them unnecessarily.
- Preserve `min-w-0`/truncate wrappers and accessible full names/titles. Long single-line navigator/file labels may truncate horizontally; explanatory text may wrap. Vertical text clipping, overlapping siblings, inaccessible controls and new page-level horizontal overflow are not acceptable.
- Grow text-containing controls with `min-height`/padding or natural height where their line box no longer fits. Keep rem padding, widths, icons, panel geometry, icon-only buttons and compact minimum 44px targets unchanged. This is local content accommodation, not global layout scaling.

## Related code files and audit inventory
Modify `packages/ui/src/index.css` and `packages/ui/src/components/organisms/FileTree.tsx`. Add one small testable metrics module, `packages/ui/src/lib/workbench-typography.ts`, plus `workbench-typography.test.ts`: only explorer row metrics, not a new font service or settings abstraction. No deletions.

Modify fixed typography in the reached workspace chrome; starting inventory verified from current source:
| Source path under `packages/ui/src/components/` | Audit/change |
|---|---|
| `organisms/TraditionalTerminalProjectsNavigator.tsx` | Git summary 11px/count 10px, fixed leading, wrapping |
| `molecules/traditional-terminal-agent-group-row.tsx` | Count/source/outcome 11px; preserve grouped semantics and bright selected text |
| `organisms/TerminalRuntimeNavigatorItem.tsx` | Port chips 10px; runtime label inheritance and nested action targets |
| `organisms/FileTree.tsx` | Explorer headers, controls, metadata, notices, 9px status text, live row height |
| `organisms/ChangedFilesList.tsx` | Filenames 11px, directory/status 9px, headers/notices/actions 10px |
| `organisms/CommitDetailsPanel.tsx` | Subject 12px, paths/message 11px, metadata/counts 10px, status badges 9px |
| `atoms/FilePathLabel.tsx` | Default directory 10px; keep overrides compatible and avoid double size scaling |
| `organisms/SearchPanel.tsx` | Search mode/control labels 11px, counts/warnings 10px; follow `SearchPanelResults` imports |
| `organisms/WorkspaceGitPanel.tsx` | VCS/branch labels 10px, root selector 11px and fixed height |
| `organisms/TraditionalTerminalWorktreeSelect.tsx` | Status/help 10px, body portal option labels and wrapping |
| `organisms/EditorStatusBar.tsx` | 11px text within hard 22px bar; replace fixed text-box height with minimum/natural height |
| `organisms/EditorTabs.tsx`, `organisms/DiffViewer.tsx` | Chrome-only notices/file captions; leave editor font and line metrics untouched |
| `organisms/TerminalTabBar.tsx`, `organisms/ActiveTerminalRuntimeDisplay.tsx` | Prompt errors/runtime headings 10px |
| `templates/MobileWorkspaceShell.tsx` | Panels button 10px and 9px metadata; preserve compact touch/drag controls |
| `organisms/BrowserDebug*` reached by `WorkspacePage` | Console/preview/control chrome 11px; framed inspected application fonts remain untouched |

`WorkspacePage.tsx` itself mostly consumes semantic text classes and delegates rendering. Trace current imports through `IdeShell`, `TerminalWorkspaceShell`, `MobileWorkspaceShell`, floating file/tool panels, runtime navigator, editor/search/Git controls, workflow surfaces, reusable badges, context menus and preview components. Search both fixed arbitrary font utilities and inline/CSS `font-size`; process remaining reached matches before calling the audit complete. Do not limit the audit to this starting inventory or migrate unrelated Agent Store/distribution screens opportunistically. Maintain a concise final audit record in the implementation review, with each retained fixed-size text exception and its independent owner.

### Independent text/rendering boundaries
- `MonacoHost.tsx`: editor options/subscription continue to consume `editorFontSize`, not system typography.
- `DiffViewer.tsx`: currently has its own fixed Monaco option `fontSize: 13`; changing that policy is not required here. Migrate its chrome only; certify system preference does not change the editor's configured font.
- `TerminalPanel.tsx`: retain `terminalFontSize` and its existing app-zoom compensation; terminal identity/options cannot be driven by `--app-font-size`.
- Editor-aligned blame annotations and Monaco gutter positioning follow editor line metrics, not system typography. Distinguish aligned annotations from ordinary loading/error chrome.
- Mobile custom keyboard owns a separate font-size preference; keep key labels independent, while ordinary workbench controls adapt.
- Embedded browser/debug target documents and iframe content are not workbench chrome.

## Virtualized FileTree contract
Keep react-arborist's numeric, uniform `rowHeight`, not per-node measured/variable virtualization. Existing `ResizeObserver` continues to supply viewport width/height.
1. Use the existing settings source (add a narrow `systemFontSize` selector where appropriate; do not change preference ownership). A CSS-only preference edit is not the runtime input contract; tests must change the actual store and root variable coherently.
2. Implement a tiny pure helper with documented correspondence to `text-xs` and `py-0.5`: `rowHeight = max(24, ceil(systemFontSize * 0.857 * (4 / 3) + 4))`. The 24px floor contains the fixed 16px icon and current compact spacing. The 4px is total existing vertical padding at normal root rem size; do not increase horizontal indent or scale icons.
3. Set node labels to semantic `text-xs` with its default unitless line height; preserve `style={style}`. Formula and actual label/padding must agree. If padding/line-height is later adjusted, update helper and CSS together; browser tests are the consistency guard, not a second independently chosen ratio.
4. Expected current rows: system 10→24px, 14→24px, 20→27px, 32→41px. React updates numeric `rowHeight` immediately; do not put font size in `treeKey`, recreate tree data, or clear expansion/selection/reveal state.
5. Verify installed Arborist updates its item offsets and scroll/reveal operations on `rowHeight` changes. If scrolled selected content would leave view, use the existing tree API to reveal the selected/focused node after the size update; do not reset all scroll to top or remount. Add only the minimal effect if browser evidence requires it.
6. Loading sentinels, language-projection rows and live filesystem nodes use the same geometry. Keep overscan, drag/drop, lazy children, owner-qualified scope keys and pending reveal behavior unchanged.

## Implementation steps
1. Add exact theme/line-height definitions; confirm standard semantic classes and custom `text-2xs` compile through existing Tailwind v4 config in later browser gates.
2. Complete the reached-component fixed-font/leading/height audit; migrate ordinary chrome with the rules above, preserving Phase 01 selected child styles. Check `cn`/tailwind-merge does not discard custom `text-2xs` or confuse font-size/color classes.
3. Add row metrics helper/tests; replace Arborist's literal 24 with derived value, without adding font size to tree keys.
4. Accommodate fixed-height text boxes only where needed; validate portal menus and compact panels as part of the same audit.
5. Add settings/root synchronization and independent editor/terminal regression cases using existing fixtures; no production rewrite of the working synchronizer.
6. Hand off integrated changes to Phase 03; update design/architecture documentation only after behavior exists.

## Success criteria, risks and security
- Exact seven sizes and line-height companions respond live to 10/14/20/32px settings, default fallback and persisted hydration; body portals follow.
- `html` computed font size, rem padding/margins/icon bounds, app zoom and compact breakpoints are unchanged by system preference. Local text boxes may grow; no vertical glyph clipping/overlap.
- Virtual rows accommodate actual content; non-top scrolling, selected node identity, expansion and reveal survive increases/decreases.
- Editor, diff renderer, terminal and custom-keyboard font settings are unchanged by system-size edits; changes to those settings do not update system CSS.
- Main risks: drift between CSS/helper, explicit leading, tiny status boxes, tailwind-merge, stale virtual offsets and maximum-size overflow. Unit + computed-CSS + full-app gates cover different risks, not interchangeable evidence.
- No new dependencies, backend/schema operations, owner fallback, listeners without cleanup, or network behavior. Do not log settings payloads/private workspace paths for debugging.

## Next steps and unresolved questions
Phase 03 runs all integrated gates and obtains fresh visual/code-review acceptance. No blocking design questions; installed-library row-update behavior remains an explicit verification obligation.
