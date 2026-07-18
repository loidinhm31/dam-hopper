# Select and context-menu research

## Evidence

- `GitBranchControl.tsx` converts its empty string to `undefined` at the Radix Select `value` prop. Async branch data then changes it to a string.
- `GitBranchContextMenu.tsx` and `TerminalDiagnosticsContextMenu.tsx` start controlled `open` state as `true`, before their effects dispatch the coordinate-carrying synthetic `contextmenu` event.

## Recommended design

- Keep Git branch Select controlled: pass the already-string `branchValue` directly. Empty string is its no-selection state.
- Start both lifted menus closed. Retain their synthetic event and controlled `onOpenChange`; Radix then receives the event before the menu opens and can calculate placement.
- Do not change the shared ContextMenu wrapper.

## Test seams

- Make the existing Git branch hooks return loading values, then loaded data; assert no controlledness warning and correct placeholder/value transitions.
- Add terminal diagnostics opening coverage and assert Radix does not log the pre-interaction warning. Existing GitBranchControl interaction coverage protects the branch presenter.

## Unresolved questions

- JSDOM may not expose Radix placement geometry; browser coverage remains the authority for final coordinates.
