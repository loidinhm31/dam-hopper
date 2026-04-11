# Research: Monaco Diff Editor Capabilities

## Monaco DiffEditor API

Monaco has a built-in `createDiffEditor()` that shows original vs modified side-by-side or inline.

### Key Options
- `renderSideBySide: boolean` — side-by-side (default true) or unified inline view
- `originalEditable: boolean` — allow editing the original (left) side
- `renderMarginRevertIcon: boolean` — shows revert arrows in gutter to revert individual hunks
- `hideUnchangedRegions.enabled` — collapse unchanged code (like IntelliJ)
- `enableSplitViewResizing` — drag to resize split
- `diffAlgorithm: "advanced" | "legacy"` — advanced = better hunk detection
- `experimental.showMoves` — detect moved code blocks

### Usage Pattern
```ts
const diffEditor = monaco.editor.createDiffEditor(container, options);
diffEditor.setModel({
  original: monaco.editor.createModel(originalText, lang),
  modified: monaco.editor.createModel(modifiedText, lang),
});
```

### Hunk-Level Revert
Monaco's `renderMarginRevertIcon: true` renders clickable revert icons per-hunk in the gutter. Clicking reverts that hunk in the modified editor. This is built-in — no custom code needed for basic per-hunk rollback.

### For Merge Conflicts
Monaco does NOT have a built-in 3-way merge editor. VSCode's merge editor is a separate component not in the standalone Monaco package. Options:
1. **Build custom 3-way view** — 3 Monaco editors (theirs | result | ours) with synchronized scrolling and accept/reject buttons per conflict region
2. **Use conflict markers** — Parse `<<<<<<<` markers, show in single editor with decorations and inline actions
3. **Simplified approach** — Show 2-way diff (current vs incoming) with per-hunk accept buttons

### Recommendation
Use Monaco DiffEditor for file diff viewing + hunk rollback (built-in). For merge conflicts, build a custom UI with 3 panels: left=theirs, center=result (editable), right=ours, with decoration-based accept/reject per conflict block.

## Integration with Existing Codebase
Project already uses Monaco in `MonacoHost` organism (Phase 04). Can reuse `monacoSetup` and language detection. DiffEditor is a separate component from the regular editor.
