## Code Review Summary

### Scope
- Files reviewed: MonacoHost.tsx, EditorGitBlameGutter.tsx, EditorGitBlameContextMenu.tsx, EditorGitBlameRow.tsx, lib/editor-git-blame-gutter-layout.ts, hooks/use-blame-gutter-wheel-sync.ts, EditorTabs.tsx, MarkdownHost.tsx, HtmlHost.tsx, WorkspacePage.tsx, WorkspaceGitPanel.tsx, CommitDetailsPanel.tsx, lib/git-commit-reveal.ts, lib/terminal-workspace-panel.ts, TerminalWorkspaceShell.tsx, IdeShell.tsx
- Lines of code analyzed: ~1,500 lines across 16 files
- Review focus: Virtualized gutter geometry scroll/fold/wrap/layout, keyboard/wheel/context menu behavior; exact root/target/OID reveal owner fences, inspect mutation isolation, history filters, already-open panels and compact navigation preserving dirty buffers
- Updated plans: none (read-only review; parent owns plan and verification)

### Overall Assessment
PR #48 delivers robust native Git blame annotations and Workspace Git commit reveal. Geometry alignment respects Monaco visible ranges, folding, and responsive container resizing without feedback loops. Reveal strictly fences profile/generation/target boundaries and isolates inspection from history mutations while preserving dirty editor buffers. Two P2 (Medium) issues identified: (1) `EditorGitBlameRow` displays `cursor-pointer` and PR documentation claims committed-row gutter clicks are wired, but `div` lacks an `onClick` handler; (2) `computeVisibleBlameRows` falls back to option 66 (`glyphMargin`), returning boolean `true` as `lineHeight` and emitting invalid CSS `truepx` (rendering rows at natural font 16.5px instead of Monaco's 19px).

### Critical Issues
None.

### High Priority Findings
None.

### Medium Priority Improvements
1. **Missing Gutter Row Click Handler Despite Pointer Cursor & PR Claim**
   - **Location**: `packages/ui/src/components/molecules/EditorGitBlameRow.tsx:66-108`, `plans/261005-2106-editor-git-blame-annotations/reports/phase-06-completion-receipt.md:37`.
   - **Trigger**: User left-clicks an annotated committed row in the blame gutter.
   - **Observable harm**: Row renders `cursor-pointer`, and PR receipt claims "Wired committed-row gutter and context menu clicks to WorkspacePage.handleRevealGitCommit", but row div has no `onClick` handler. Left-click only focuses the row DOM node (`tabIndex={0}`) without revealing the commit. Only pressing Enter or context menu triggers reveal.
   - **Minimal fix**: Add `onClick={() => { if (!row.isUncommitted && row.commit && rootId) onRevealCommit?.(row.commit.hash, rootId); }}` on `EditorGitBlameRow` div, or remove `cursor-pointer` and clarify PR docs if click is not intended.
   - **Repro**: Open tracked file in Explorer, toggle blame, left-click committed row 3. Result: row gains focus but commit panel does not open. Press Enter on same row -> commit details panel opens immediately.

2. **Option ID 66 (`glyphMargin`) Fallback Produces Boolean `lineHeight: 'truepx'`**
   - **Location**: `packages/ui/src/lib/editor-git-blame-gutter-layout.ts:66-74`.
   - **Trigger**: Visible row layout calculation in `computeVisibleBlameRows`.
   - **Observable harm**: `editor.constructor?.EditorOption?.lineHeight` evaluates to `undefined` (enum is on `monaco.editor`, not `CodeEditorWidget`). Fallback `?? 66` queries Monaco option ID 66 (`glyphMargin`), returning boolean `true`. Validation `if (!lineHeight || lineHeight < 1)` fails because `!true === false` and `true < 1 === false`. React drops `height: true` and generates invalid CSS `lineHeight: "truepx"`. Rendered blame rows default to natural font height (16.5px) rather than Monaco's 19px line height. Rows align vertically only because `top` uses `getTopForLineNumber()`, but row bounds/centering are slightly miscalculated.
   - **Minimal fix**: Use typed public API `editor.getOption(monaco.editor.EditorOption.lineHeight)` (passing `monaco` or typed enum from host), or validate `typeof lineHeight === "number" && lineHeight > 0` with safe 19px fallback.
   - **Repro**: Inspect rendered DOM styles on `.editor-blame-row`: inline `height` is blank, `line-height` is blank, computed height is 16.5px vs 19px for `.line-numbers`.

### Low Priority Suggestions
1. **Wheel Sync Ignores `WheelEvent.deltaMode` (Line Scroll Crawl)**
   - **Location**: `packages/ui/src/hooks/use-blame-gutter-wheel-sync.ts:16-29`.
   - **Trigger**: Mouse wheel scroll over blame gutter in Firefox or with line-delta hardware (`e.deltaMode === 1`).
   - **Observable harm**: `targetScroll = currentScrollTop + e.deltaY` treats delta as raw pixels. When `deltaMode === 1` (`DOM_DELTA_LINE`), `e.deltaY` is 3, scrolling only 3px instead of 3 lines (~57px), causing gutter scrolling to crawl at ~1/20th speed compared to editor text area.
   - **Minimal fix**: Scale `deltaY` by line height when `e.deltaMode === 1`, or viewport height when `e.deltaMode === 2`.
   - **Repro**: In Firefox on Linux, scroll over blame gutter; observe ~3px scroll tick vs smooth scroll in Monaco text area.

2. **Coupling `toggleBlameAction` Disposal to ResizeObserver Lifecycle**
   - **Location**: `packages/ui/src/components/organisms/MonacoHost.tsx:310-315`.
   - **Trigger**: MonacoHost unmount where ResizeObserver was absent or container null.
   - **Observable harm**: `toggleBlameAction?.dispose()` is nested inside `_roCleanup`. If ResizeObserver is undefined, command action leak occurs.
   - **Minimal fix**: Separate command action disposal into its own cleanup handler.
   - **Repro**: Mount in test environment without ResizeObserver, unmount; action disposal skipped.

### Positive Observations
- **Owner & Target Fences**: `isGitCommitRevealRequestMatchingTarget` enforces strict profile ID, generation, project, and worktree equality. Nonce consumption in `WorkspaceGitPanel` prevents stale request loops.
- **Mutation Isolation**: `CommitDetailsPanel` strictly separates `mode: "inspect"` and `mode: "history"`. Inspect mode suppresses cherry-pick/revert/drop context menus and mutation callbacks. Selecting a history tree commit restores mutation eligibility.
- **Filter Preservation**: Inspecting commits outside loaded logs displays an `outside-history-view-notice` banner without clearing active history filters, branch selection, or pagination.
- **Panel Reveal Safety**: `resolveTerminalWorkspacePanelActivation` (`intent: "reveal"`) ensures already-open panels stay open rather than toggling closed.
- **Buffer Safety**: Double-clicking files in commit details opens new diff tabs via `openDiff`, leaving dirty editor tabs intact.
- **Primary-Button Guard**: `MonacoHost.tsx:225-228` guards Git change marker clicks with `isPrimary`, stopping right-clicks from triggering unwanted file diffs.
- **Host Lifecycle**: Markdown/HTML Edit/Split modes correctly activate blame while Preview pauses background blame work. Session tab toggles survive remounts.

### Recommended Actions
1. Fix `lineHeight` lookup: Use `editor.getOption(monaco.editor.EditorOption.lineHeight)` in `computeVisibleBlameRows` to avoid option 66 (`glyphMargin`) boolean coercion and ensure 19px rows.
2. Clarify row click behavior: Add `onClick` to `EditorGitBlameRow` if single-click reveal is intended, or remove `cursor-pointer` and align PR receipt.
3. Update `useBlameGutterWheelSync` to multiply `deltaY` by line height when `deltaMode === 1`.
4. Separate `toggleBlameAction` cleanup from `_roCleanup`.

### Metrics
- Type Coverage: 100% TypeScript strict
- Test Coverage: Unit, integration, and E2E browser tests provided
- Linting Issues: 0 critical; 1 `@ts-expect-error` in layout utility

### Unresolved Questions
1. Was single left-click commit reveal intentionally deferred in favor of keyboard Enter + context menu, or was `onClick` accidentally omitted on `EditorGitBlameRow`?
