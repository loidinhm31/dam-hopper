# Editor Lifecycle, Monaco Geometry & Reveal Isolation Research (PR #48)

Date: 2026-10-06 | Target: `packages/ui/src/hooks/use-editor-git-blame.ts`, `packages/ui/src/components/organisms/EditorGitBlameGutter.tsx`, `packages/ui/src/components/organisms/MonacoHost.tsx`, `packages/ui/src/components/organisms/WorkspaceGitPanel.tsx`

## Primary Sources
1. **Monaco Editor API & TypeScript Definitions (v0.55.1 / VS Code Core)**: `https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor.ICodeEditor.html` & `https://github.com/microsoft/vscode/blob/main/src/vs/editor/common/viewModel/viewModelImpl.ts` (`ICodeEditor.getVisibleRanges`, `getTopForLineNumber`, `onDidChangeHiddenAreas`, `EditorOption.lineHeight`).
2. **W3C WAI-ARIA Authoring Practices Guide (APG 1.2)**: `https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/` & `https://www.w3.org/WAI/ARIA/apg/patterns/menu/` (Composite widgets, roving tabindex pattern, context menu keyboard parity).
3. **WHATWG DOM Specification & Web API Standards**: `https://dom.spec.whatwg.org/#interface-mouseevent` & `https://developer.mozilla.org/en-US/docs/Web/API/AbortController` (Synthetic `MouseEvent` cancelable dispatch, `AbortController` cancellation lifecycle).

## Key Findings & Validations

### 1. Monaco Public Geometry & Folding
- **Visible Ranges Exclude Hidden/Folded Lines [OBSERVED]**: In `viewModelImpl.js:_toModelVisibleRanges`, Monaco computes visible view ranges and explicitly subtracts `this._lines.getHiddenAreas()` created by code folding or `setHiddenAreas`. Therefore, `editor.getVisibleRanges()` emits only non-folded model lines.
- **Vertical Coordinate Calculation [OBSERVED]**: `editor.getTopForLineNumber(line) - editor.getScrollTop()` exactly mirrors VS Code's internal diff editor gutter implementation (`diffEditor/utils/editorGutter.js`). It yields true pixel offset from viewport top for visible view lines.
- **Folding Listener Event [OBSERVED]**: `ICodeEditor.onDidChangeHiddenAreas` is a documented, public event (`monaco.d.ts:6118`) firing when folded regions expand or collapse. `EditorGitBlameGutter.tsx:99` safely binds this event alongside scroll, model content, layout, and configuration changes.
- **CRITICAL BUG: Line Height Enum & CSS Coercion [OBSERVED]**: In `editor-git-blame-gutter-layout.ts:68`, `editor.constructor?.EditorOption?.lineHeight ?? 66` is evaluated. `EditorOption` is not attached to `editor.constructor`, so it falls back to `66` (`EditorOption.glyphMargin`). In Monaco 0.55, `EditorOption.lineHeight` is `75`. `editor.getOption(66)` returns boolean `true`. Because `!true` is false and `true < 1` is false, `lineHeight` resolves to `true`, causing inline row height styles to evaluate to `height: "truepx"` (invalid CSS), collapsing row layout or defaulting to container sizing.

### 2. Wheel Handling & Scroll Synchronization
- **Boundary Bubbling & Trap Avoidance [OBSERVED]**: `useBlameGutterWheelSync.ts:20` calculates `maxScroll = Math.max(0, editor.getScrollHeight() - layoutInfo.height)` and clamps target scroll. `e.preventDefault()` is only invoked when `targetScroll !== currentScrollTop`. When the editor is already at top or bottom limit, wheel events bubble naturally to the browser page without trapping scroll.
- **Layout & Scroll Events [OBSERVED]**: Programmatic `editor.setScrollTop(targetScroll)` triggers Monaco's native `onDidScrollChange`, which schedules batch row updates via `requestAnimationFrame` without requiring manual DOM sync.

### 3. Async Cancellation & Generation Scoping
- **Generation & Connection Fences [OBSERVED]**: `use-editor-git-blame.ts:278` validates `isCurrentConnection(owner)` and matches `profileId`/`generation` across tab binding, IPC notifications, and TanStack query caches. Disconnected owners or profile switches suppress completion.
- **Race Condition Immunity [OBSERVED]**: Requests carry `modelVersion`, `snapshotId`, `localEpochRef`, and `repositoryRefreshEpochRef`. Post-await gates discard responses if the model version changed or if another edit bumped the local epoch.
- **Abort Requeuing [OBSERVED]**: In-flight requests abort the active `AbortController` and mark `pendingIntentRef.current = true`. The `finally` block detects `pendingIntentRef` and debounces a fresh `runBlame()` call by 250ms (`GIT_BLAME_DEBOUNCE_MS`), preventing parallel executions.
- **Gap in Catch & Refresh Handlers [OBSERVED]**:
  1. In `use-editor-git-blame.ts:316` (`catch`), `isCurrentConnection(owner)` is not checked before updating status. If a connection disconnects while a request fails, the catch block can erroneously overwrite the status to `"error"`.
  2. In `triggerRepositoryRefresh`, `await queryClient.fetchQuery(...)` does not re-verify `isCurrentConnection(owner)` or `tabRef.current?.key` before calling `runBlame()`.

### 4. Exact Commit Inspection Isolation
- **Separate State Machine [OBSERVED]**: `WorkspaceGitPanel.tsx:105` stores `inspectionState: InspectionState | null` separately from `useGitHistoryView.selectedCommit`. Inspecting an arbitrary OID does not coerce pagination or mutate branch filter states.
- **Root-Switch Synchronization [OBSERVED]**: In `WorkspaceGitPanel.tsx:158`, if `historyView.rootId !== revealRequest.rootId`, the panel executes `historyView.setRootId(...)` and defers nonce consumption until the subsequent render pass, preventing the hook's root-switch state reset from clearing the revealed selection.
- **Read-Only Inspection Guarantees [OBSERVED]**: `CommitDetailsPanel.tsx:55` accepts discriminated `mode: "inspect"`. In inspect mode, mutation actions (`cherry-pick`, `revert`, `drop`, `edit commit message`) are omitted from file menus and headers. When outside current log view, a dedicated warning banner renders. Selecting any row in `GitLogTree` explicitly resets `setInspectionState(null)`.

### 5. Accessible Gutter & Context Menu
- **Menu Exclusivity [OBSERVED]**: Line number right-click in `MonacoHost.tsx:248` calls `event.event.preventDefault?.()` and `stopPropagation?.()`, preventing Monaco's internal text context menu and the native browser menu from appearing simultaneously.
- **Synthetic MouseEvent Discrepancy [OBSERVED]**: `EditorGitBlameContextMenu.tsx:55` dispatches `new MouseEvent("contextmenu", { bubbles: true, clientX: x, clientY: y })` on a hidden trigger button. Standard DOM requires `{ bubbles: true, cancelable: true }`; non-cancelable events prevent Radix internals from executing standard cancellation.
- **A11y Tab Trapping [OBSERVED]**: Every rendered row has `tabIndex={0}` (`EditorGitBlameRow.tsx:69`). In large viewports with 50+ lines, pressing Tab forces sequential traversal through all rendered rows before reaching editor contents.
- **Arrow Navigation Viewport Boundary [OBSERVED]**: Keyboard `ArrowDown`/`ArrowUp` relies on `currentTarget.nextElementSibling`. At the bottom edge of the viewport, the next row is unrendered (virtualized), so focus halts and fails to scroll the editor.

## Key Risks & Safe Minimal Remedies

| Area | Observed Risk | Safe Minimal Remedy |
|---|---|---|
| **Layout / CSS** | `editor.getOption(66)` returns boolean `true`, injecting invalid `height: "truepx"` into rendered rows. | Import `EditorOption` from `monaco-editor` (or use numeric constant `75`), and validate: `const opt = editor.getOption(75); const lineHeight = typeof opt === "number" && opt > 0 ? opt : 19;`. |
| **Lifecycle** | In-flight failure on disconnected profile sets `status = "error"`. | Add `if (!isCurrentConnection(owner)) return;` at top of `use-editor-git-blame.ts:316` catch handler. |
| **Refresh Race** | Stale tab/owner switch during `fetchQuery("git-roots")` triggers invalid blame. | Add post-await validation in `triggerRepositoryRefresh`: `if (!isCurrentConnection(owner) \|\| tabRef.current?.key !== currentTab.key) return;`. |
| **Accessibility** | Tab key traverses all 50+ viewport rows; ArrowDown stalls at viewport edge. | Use roving `tabIndex` (`-1` on non-active rows), and on boundary arrow navigation, invoke `editor.setScrollTop(editor.getScrollTop() + lineHeight)` or scroll line into view. |
| **DOM Events** | Synthetic `contextmenu` event lacks `cancelable: true`. | Pass `new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y })`. |

## Best Practices
- **Monaco Option Access**: Always import `monaco.editor.EditorOption` or enforce type guards (`typeof x === "number"`) on return values of `editor.getOption()`.
- **Roving Focus on Viewports**: Virtualized/windowed gutter rows must use roving tab index to avoid degrading natural keyboard tab sequences.
- **Post-Await Verification**: Every asynchronous resumption must verify owner generation, active tab key, and abort signal.

## Unresolved Questions
1. Should `EditorGitBlameRow` delegate ArrowUp/ArrowDown handling to Monaco's editor cursor positioning so that navigating annotations scrolls editor lines synchronously?
2. Should `EditorOption.lineHeight` fallback be exposed as a shared constant in `editor-git-blame.ts` to keep layout and gutter models synchronized across Monaco version bumps?
