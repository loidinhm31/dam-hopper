# Phase 01 — High-contrast selection tokens and consumers

## Overview
Priority P2. Status pending. Estimate 5h. Dependency: current shared UI only; integrate before Phase 02 touches overlapping files. Deliver obvious, consistent row selection without changing selection meaning, row geometry, or input behavior.

## Context links
- [Overview](./plan.md), [font integration](./phase-02-font-system-adaptation.md), [qualification](./phase-03-verification-and-review.md).
- [Semantic stylesheet](../../packages/ui/src/index.css), [shared design contract](../../docs/frontend-components/platform-integrations.md), [standards](../../docs/code-standards.md).

## Key insights
Current selected project rows use primary/10, agents primary/12, runtime leaves primary/15, explorer primary/15 with blue labels, changed files primary/15 with forced blue paths, commit files primary/10 with blue hover paths. This makes selected rows too close to ordinary hover. Existing selection predicates already express the intended behavior: reuse them. Grouped agent selection means any member matches `activeSessionId`; do not change cycling or grouping.

## Requirements and architecture
Add these exact values to the existing `@theme` in `packages/ui/src/index.css`; leave primary/action/status colors unchanged:

```css
--color-selection: hsl(217, 91%, 60%, 0.28);
--color-selection-border: hsl(217, 91%, 65%);
--color-selection-text: hsl(210, 40%, 100%);
--color-selection-hover: hsl(217, 91%, 60%, 0.35);
```

Use one plain shared `.workbench-selection` CSS class in the existing stylesheet, attached conditionally by the current selected/active boolean. No React abstraction, extra store, new theme, or JavaScript color computation.
- Background: `var(--color-selection)`; color: `var(--color-selection-text)`.
- Left marker: `box-shadow: inset 3px 0 0 var(--color-selection-border)`; no real border/padding change.
- Selected `:hover`: `var(--color-selection-hover)`; text and marker persist.
- Place shared rules alongside current reusable CSS. Specify deliberate cascade precedence: unlayered selected rules override layered utilities; remove obsolete competing selected/hover utilities instead of relying on order in `className` or `!important`.
- Focus uses a separate outline, not another box shadow that could replace the left marker. Prefer `focus-visible` on interactive controls, with an inset 2px high-contrast outline where overflow would clip an outside outline; wrappers with nested controls retain an appropriate `focus-within` cue. Keep individual child control focus indicators.
- Selection class colors only ordinary labels. Explicitly condition selected filename/title/metadata classes where children impose their own colors or opacity. No wildcard whitening of all descendants; preserve distinct status icons, harness/profile/project badges, additions/deletions, file decorations, checkbox accents, and warnings. Brighten selected semantic badges only if composited contrast checks reveal unreadability, without changing their meaning.

### State contract
| State | Background | Left marker | Text | Keyboard cue |
|---|---|---|---|---|
| Idle | Existing transparent/surface | None | Existing ordinary text | None |
| Idle hover | Existing surface-2 tint | None | Existing brighter hover text | Independent |
| Selected | Selection 0.28 | 3px inset selection-border | Selection-text for ordinary labels | Independent |
| Selected hover | Selection-hover 0.35 | Same | Same bright text | Independent |
| Keyboard focused, idle | Idle/hover unchanged | None | Idle/hover unchanged | Distinct visible outline |
| Keyboard focused, selected | Selected/selected-hover unchanged | Same | Same | Outline plus marker |

CSS `:active` means pointer press, not persisted selection. Preserve any existing press feedback; do not use it as the selection source. Disabled/unavailable behavior stays unchanged.

### Global text selection
Add `::selection` in the base layer: background `var(--color-selection-hover)`, color `var(--color-selection-text)`. This intentionally applies to native DOM text selection throughout the document, including shared UI consumers and editor/terminal DOM text where the browser supports it. It does not configure Monaco's custom selected-range layers or xterm's rendered selection; do not change their APIs/themes in this task. Preserve their typography/settings and test the interaction. Global selection needs its own contrast assertions on dark slate and selected-row ancestors; do not infer contrast from the raw translucent token.

## Related code files
Modify:
| File | Existing state and exact migration |
|---|---|
| `packages/ui/src/index.css` | Four tokens, shared class/hover, global `::selection` |
| `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx` | `TraditionalProjectRow.isActive`: selected presentation wrapper, inherited bright tab label; retain tab roles, roving focus, separate worktree selector |
| `packages/ui/src/components/molecules/traditional-terminal-agent-group-row.tsx` | Existing `rows.some(...)` active button: class and bright ordinary metadata; retain `aria-current`, grouped cycle, status badge semantics |
| `packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.tsx` | `RuntimeSessionLeaf.active`: row class/hover; retain `aria-current` on leaf button and pin/close/tunnel event isolation; replace ring-only selection cue |
| `packages/ui/src/components/organisms/FileTree.tsx` | `NodeRenderer.node.isSelected`: row class; keep Arborist-provided inline style/ref; focus outline applies to selected nodes too, not just unselected |
| `packages/ui/src/components/organisms/ChangedFilesList.tsx` | `GitFileRow.isSelected`: row class, bright path; remove `!text-[var(--color-primary)]`; conditional `FilePathLabel` filename/directory colors; checked/staged remains independent |
| `packages/ui/src/components/organisms/CommitDetailsPanel.tsx` | `selectedPaths.has(file.path)`: class; selected filenames never switch to primary on hover; preserve multi-selection and inspect/history distinction |

Tests to update/add: exact inventory in Phase 03. No production files created/deleted in this phase. `FilePathLabel.tsx` is a Phase 02 typography consumer; its existing override props suffice for selected colors, so no new selection prop is needed.

## Implementation steps
1. Re-read current target sections; ensure any concurrent recent changes to grouped agents/status filters remain intact.
2. Add exact theme tokens and shared selected-row/hover rules. Add global text-selection rule and document its DOM/custom-renderer boundary in a brief source comment.
3. Migrate all six existing selection branches; delete old selected backgrounds/blue filename overrides and competing selected hover rules at the same callsites. Make idle hover conditional where necessary.
4. Adjust ordinary child labels explicitly, including selected project Git summary text, agent source/outcome metadata, explorer large-file metadata, changed-file directories, and commit paths. Preserve semantic signals and accessible explanatory text.
5. Preserve focus rings on controls or convert conflicting row shadows to outlines; ensure selected focus remains detectable. Changed-file rows currently rely on nested focusable controls: provide focus-within visibility without redesigning staging/row activation or introducing nested buttons. Commit file rows remain focusable as before; do not conflate focus with selection.
6. Add regression assertions for state transitions, computed styles, contrast and fixed bounding boxes through the existing testing layers; scope/commands in Phase 03.

## Success criteria
- All six consumers use the four requested semantic tokens; no active/selected branch retains obsolete primary/10–15 backgrounds or forced blue filename text.
- Selected-hover is stronger, never replaced by idle-hover; keyboard focus visibly coexists with selected background/left marker.
- Ordinary selected text meets at least 4.5:1 against actual composited row backgrounds; marker/focus meets at least 3:1 against adjacent backgrounds. Validate semantic badges separately, including alpha/opacity.
- Selection indicator produces zero padding/border/bounding-box change; selection routing, project keyboard navigation, agent cycling, explorer behavior, Git staging, commit multi-select/context menus and compact touch targets remain intact.

## Risk assessment and security
- Cascade and child opacity: inspect computed child styles, not only parent classes; remove conflicts instead of specificity escalation.
- Contrast: CSS palette comments are not actual colors; composite real computed background layers over the dark page before luminance calculation. Fixed requested values cannot be silently changed to meet a failing gate; resolve actual foreground/background conflicts or document a genuine acceptance blocker.
- Focus collision: outline must not erase inset shadow or be clipped by overflow wrappers.
- No authentication, ownership, transport, filesystem, or Git mutation logic changes. Never make unavailable owners appear available via styling.

## Next steps
Integrate Phase 02 over the same CSS/rows, then run Phase 03's consolidated verification and code review. No release claim at this phase boundary.

## Unresolved questions
None. Global rule intentionally targets native DOM selection; custom editor/terminal selection implementations remain outside this styling migration.
