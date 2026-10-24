# Merge model — documentary research

Status: documentation reviewed; executable qualification **not run**. Parent synthesis supersedes unqualified agent recommendations. Direction: [brainstorm](../../reports/brainstorm-261019-1326-git-conflict-resolver.md).

## Sources and established boundaries

- [node-diff3 README/API](https://github.com/bhousel/node-diff3): arrays accepted; `diff3Merge` string input defaults to whitespace splitting; `diff3MergeRegions(a, o, b)` returns low-level stable/unstable regions. README advertises MIT licensing; exact package version, license files and transitive obligations require qualification before pinning.
- [Monaco merge-editor issue](https://github.com/microsoft/monaco-editor/issues/3268): do not assume a bundled public three-way editor or import private VS Code workbench code. It does not prove every possible extraction infeasible; extraction is outside agreed scope.
- [IntelliJ core workflow](https://www.jetbrains.com/help/idea/resolve-conflicts.html): product reference for three panes and merge decisions, **not** evidence of Monaco implementation details.
- Installed Monaco dependency declared `^0.55.1` in `packages/ui/package.json`; qualification must inspect its public installed typings. The previously cited `ITextModel.html` typedoc URL returned 404 during parent verification; do not cite it as API proof.

## Candidate design, not qualified implementation

- Three public standalone editors: immutable source left/right, editable result. Immutable base accessible on demand. Operation-aware stage labels; never unconditional human roles.
- Range decorations, view zones and guarded scroll synchronization are candidates for tracking/alignment; validate installed API locations and lifecycle. `createDecorationsCollection` must not be assumed to be an `ITextModel` method.
- Resolution metadata belongs to application history as well as text. Model version IDs alone do not identify logical history states; no-op/synthetic edits are not an assumed way to make metadata-only decisions undoable.
- Qualify one coherent public-API history authority for typing, accepts, ignore/review-only decisions, undo, redo, branch-after-undo and editor context-menu commands. Disable stale block controls synchronously after ambiguous edits; recompute mapping or require explicit review.
- Ignore a source change means retain the current result and record that decision; it must not silently restore base or delete imported text. Exact per-side labels/state transitions belong to the contract.
- Import worktree bytes as initial result; source regions derive from immutable stages. Markers can inform import warnings but never define authoritative regions/resolution. Preserve first, offer separately confirmed rebuild.
- Hide, file switch, shell switch and target switch retain draft/model history. Owner retirement disables mutation; never dispose dirty drafts merely because project changes. Explicit discard or acknowledged successful apply may release models.

## Pending executable gate

| Area | Required proof |
| --- | --- |
| Engine | Repeated lines; overlapping insertions; adjacent deletions; identical changes; multiple clean/conflicting regions; add/add absent base; empty files |
| Byte fidelity | LF, CRLF, mixed/lone-CR endings, BOM, Unicode, no final newline; raw bytes vs Monaco-normalized text explicitly modeled or unsupported |
| Imported result | Partially removed/edited markers, diff3/zdiff3 markers, marker-like literal text, marker-free manual work; opening and clean-block application preserve edits |
| History | Accept/ignore/ordered-both/whole-file/review mixed with typing and multi-block edits; undo/redo text AND metadata; metadata-only action; redo-branch invalidation |
| Geometry | Unequal hunk heights, wrapped lines/folding policy, zoom/font settings, pane switches and scroll feedback loops |
| Resources | Measure total source/base/result payload, lines, longest line, regions, drafts, CPU responsiveness and heap on required web/Linux Tauri targets; Windows-native client measurements remain separately Pending/nonblocking/unqualified |

Choose file/line/payload/draft budgets from recorded measurements and agreed responsiveness criteria in Phase 01. No evidence supports a fixed 2,000-line worker threshold, 150 MiB heap ceiling or universal 60 fps claim. Use a worker only if measured responsiveness requires it; preserve cancellation/owner fencing either way. Ordinary editor's 1/5 MiB tiers are reference, not three-editor acceptance.

## Unresolved technical gates

- Exact dependency/version/license approval, faithful tokenization and imported-result mapping.
- Public-API joint text/metadata undo authority; no fallback to marker-only resolution.
- EOL/BOM mixed-ending representation and measured resource limits on required web/Linux targets; [validated Windows-native client deferral](../plan.md#validation-summary) is nonblocking, not a qualified-support or universal performance claim.
