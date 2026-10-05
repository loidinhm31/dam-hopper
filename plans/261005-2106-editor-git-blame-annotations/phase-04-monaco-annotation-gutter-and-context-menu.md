# Phase 04 — Monaco annotation gutter and context menu

## Context links

- [Parent plan](./plan.md); [contracts §§5–6](./contracts.md); [Phase 03](./phase-03-owner-bound-client-and-buffer-lifecycle.md).
- [Current Monaco wrapper](../../packages/ui/src/components/organisms/MonacoHost.tsx); [context menu primitive](../../packages/ui/src/components/ui/ContextMenu.tsx).
- Dependencies: frozen Phase 03 controller/DTO interface. Phase 05 may proceed independently; no shared-file edits without an integration owner.

## Overview

- Date: 2026-10-05. Priority: P2.
- Implementation status: pending. Review status: pending.
- Deliver actual gutter context menu, responsive visible-row author/date or compact author-only column, full hover/focus metadata and committed-line reveal callback.

## Key Insights

- Monaco already renders normal line numbers, fold controls and Git glyph decorations. Do not replace them with annotation text.
- Current marker mouse-down handler can run on right-click; primary-button filtering is part of this feature's input correctness.
- Geometry must come from public Monaco APIs; folds invalidate arithmetic row positioning.
- Browser-only menu/scroll/focus proof required. jsdom mocked Monaco does not prove event ordering/alignment.

## Requirements

- Right-click **line number** offers Annotate/Hide and **Refresh Annotations** while enabled, including busy/error states; unavailable source/owner disables refresh with a reason. Ordinary code-area Monaco menu preserved.
- Measure whole editor-wrapper inner width before column allocation: `>=640 CSS px` → `220px` author/date column; `<640` → `min(120px, wrapperWidth / 3)` author-only column. Date and exact original timestamp/timezone/subject/full OID remain in hover and keyboard-focus metadata in both modes. Truncate long text; never disable annotations or force minimum-width overflow.
- `Uncommitted` lines have no invented author/date/hash and no commit reveal action.
- Scroll/fold/zoom/resize/model changes preserve alignment; no stale data while refreshing.
- Git markers keep existing colors and primary-click file diff; no inline popup.

## Architecture

```text
MonacoHost wrapper
  annotation column (visible React rows) | unchanged Monaco code editor
  public model/geometry events -> rAF geometry refresh
  useEditorGitBlame state -> current ranges + commit table
  menu/row action -> typed onRevealCommit callback (Phase 05 owner)
```

- Geometry state separate from network snapshot identity. Scrolling never triggers blame recomputation.
- Use range lookup by binary search/advancing index; only viewport rows in DOM.
- Source model/font/style ownership remains Monaco; renderer subscribes and disposes without private DOM access.

## Related code files

Modify:

- `packages/ui/src/components/organisms/MonacoHost.tsx`: annotation context props including refresh action, controller integration, responsive wrapper column, gutter event filtering, reuse of ResizeObserver lifecycle and deterministic disposal.
- `packages/ui/src/index.css`: narrow scoped annotation classes using existing color/typography tokens; no unrelated restyle.
- `packages/ui/src/components/ui/ContextMenu.tsx`: reuse existing coordinated primitive; modify only if a minimal supported positioning seam is necessary, with all callers reviewed.
- `packages/ui/src/lib/context-menu-coordinator.ts`, `context-menu-trigger-marker.ts`: reuse, not second menu registry.
- `packages/ui/src/components/organisms/MonacoHost.test.tsx`: preserve existing Android read-only and view-state regressions; add behavior only if useful headlessly.

Create proposed:

- `packages/ui/src/components/organisms/EditorGitBlameGutter.tsx`: focused renderer/annotation actions, no network ownership duplication.
- `packages/ui/browser-tests/editor-git-blame.browser.tsx`: real Monaco geometry, input, keyboard and snapshot-transition regression.

No new renderer/editor/menu dependency. Unsupported viewer wrappers are integrated in Phase 06.

## Implementation Steps

1. Verify public APIs available in installed Monaco 0.55.x before using current online documentation names. Follow LSP hover/type lookup where configured.
2. Add bounded context contract to MonacoHost: target, enabled/source-active state, toggle/refresh callbacks and committed-line reveal callback; model path remains existing qualified in-memory URI.
3. Build line-number menu using existing app-coordinated Radix primitive and public `getTargetAtClientPoint`/`onContextMenu` target data. Gate precisely to `GUTTER_LINE_NUMBERS`; fold/change-marker/code targets must not trigger annotations or replace unrelated menus. Route Refresh Annotations through Phase03's owner/model/epoch-gated action without saving/reloading dirty content or changing selection.
4. Prove menu event sequencing in a real browser before broad integration: exactly one app menu appears at pointer; code retains Monaco menu; right-click does not move/lose cursor or invoke a diff. Avoid relying on React state updates becoming synchronous before a delegated contextmenu event.
5. Add primary-button guard to existing Git marker handler. Preserve original lookup and `onGitIndicatorClick` behavior for left click; no marker color/baseline logic changes.
6. Render sibling annotation column only when enabled; loading/unavailable/error states have no old rows. Apply contracts §6 sizing from the stable outer wrapper using the existing ResizeObserver lifecycle, not viewport/post-column Monaco width. Update only on mode/width changes; no second observer loop or network work on resize. Committed rows map to deduplicated metadata; uncommitted/terminal empty rows remain explicit.
7. Subscribe to scroll/layout/hidden-area/configuration/model events; one rAF updates visible rows and Monaco-derived top/height positions, relayout after column-width changes. Apply Monaco font info/current options. Hidden lines not rendered; folded summary must not display an unrelated author's row. Verify normal→compact→normal transitions preserve cursor/scroll/dirty bytes and do not oscillate at640.
8. Keep code horizontal scrolling independent of annotation column. Wheel scrolling over the column follows the same editor vertical scroll through public APIs without trapping page/keyboard events; dispose listener with owner surface.
9. Format date/full author timestamp using stored epoch + original offset. Normal-width rows show author/date; compact rows show author only. Author/date/timezone/subject/full hash remain plain-text hover and focus metadata in both. Use truncation/tooltip and context menu Show Commit in Git only for a current committed snapshot.
10. Add keyboard access: focusable annotation row, ContextMenu/Shift+F10 support, Escape close/focus restoration; enable action discoverable from current line even while column is off. No configurable global shortcut or private editor contribution.
11. Expose typed reveal callback using original target/server root/hash; Phase 05 consumes. Recheck current snapshot at action time so an open menu cannot reveal outdated line attribution after an edit/root change.
12. Pair every Monaco disposable/rAF/wheel/menu listener with cleanup on model change/unmount; preserve existing view-state, read-only/Android and ResizeObserver behavior.
13. Add real browser fixture with different authors/foldable code. Assert geometry through scroll/folds/font zoom/resize/first-last lines/model switches; marker left/right input and keyboard focus. Cover wrapper widths639/640 and normal→compact→normal, narrow split within wide viewport, exact bounded width, full date/metadata on compact hover/focus, no sizing loop/network requests and intact editor cursor/scroll/dirty bytes.
14. After shared edits settle, run targeted Vitest browser test once, then launch actual browser harness/app with real Monaco and visually inspect annotated/hidden/loading/uncommitted/menu states. This surface smoke is mandatory even with green assertions; final full-app gate is Phase 07.

## Todo list

- [ ] Precise line-number menu and right-click diff isolation implemented.
- [ ] Responsive container-sized full/compact column, Refresh Annotations and explicit non-ready states implemented.
- [ ] Public-API geometry updates/folding/zoom/scroll cleanup implemented.
- [ ] Original timestamp metadata and safe committed actions implemented.
- [ ] Keyboard/focus/Privacy/read-only behaviors preserved.
- [ ] Real Monaco browser regression and visual smoke pass.

## Success Criteria

- Line-number right-click toggles mode; code menu/fold controls/markers remain independently usable.
- Normal-width committed rows identify author/date; narrow rows show author only with date/full metadata accessible on hover/focus. Boundary and wide-viewport/narrow-split behavior follows contracts §6. Uncommitted rows never navigate; Refresh obtains current attribution without editor writes.
- Alignment differs from Monaco's actual row top by at most1 CSS pixel under tested scroll/fold/zoom states.
- DOM rows scale with viewport, not total file lines; scroll makes no blame network requests.
- No abandoned listeners/models/rAF after tab switch or mode toggle; existing view-state/read-only behavior still passes.

## Risk Assessment

- Coordinated Radix vs Monaco contextmenu ordering: early actual-browser gate; no whole-editor disable of Monaco menus.
- Fold and font geometry: public events/positions, no row arithmetic.
- Menus opened before edit: action-time epoch check and menu closure on invalidation.
- Container resize feedback: observe stable pre-column wrapper width, reuse ResizeObserver/rAF cleanup, and verify640 boundary plus narrow splits without loop/overflow/feature disable. Numeric tuning requires synchronized contract/phase/verification update and fresh visual proof.

## Security Considerations

- Author/subject/message data is untrusted repository content; use text nodes, no HTML injection.
- No commit link for zero-OID or malformed range data.
- Respect Cognito capture/inert boundary and existing portal coordination; no unguarded window input hook.

## Next steps

- Phase 06 passes target/toggle/reveal context through all source hosts; Phase 05 supplies workspace action handler.
- Unresolved questions: none; browser event/geometry behavior is an implementation proof gate, not assumed proven.
