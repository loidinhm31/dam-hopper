# Phase 01 — Compact Selector and Header

## Context links

- [Parent plan](./plan.md)
- [MobileWorkspaceShell](../../packages/ui/src/components/templates/MobileWorkspaceShell.tsx)
- [WorkspacePage compact composition](../../packages/ui/src/components/pages/WorkspacePage.tsx)
- [Shared Select primitive](../../packages/ui/src/components/ui/Select.tsx)
- [UI tokens and safe areas](../../packages/ui/src/index.css)
- [Current compact contract](../../docs/frontend-components.md)

## Overview

- **Date:** 2026-08-06
- **Description:** Replace compact bottom tabs with one floating, accessible surface selector; remove/reduce the companion row.
- **Priority:** P2
- **Implementation status:** Complete
- **Review status:** Complete

## Key Insights

- Keep `surfaces`, `activeSurfaceId`, and `onSurfaceChange` as the controlled contract. Keep every surface mounted and inactive sections `hidden`/`inert` to preserve terminal/editor/Browser state.
- **KISS/YAGNI selection:** fixed, safe-area-aware `SelectTrigger` + portaled `SelectContent`, opening upward. Existing Radix behavior covers focus, arrows, typeahead, Escape, outside click, and trigger focus return.
- Alternative 2: custom button/popover. Reject: duplicates focus/dismiss/position logic and adds document listeners.
- Alternative 3: adapt `TerminalFloatingToolPanel`. Reject: draggable/resizable, terminal-specific, oversized for navigation.
- Header policy: no separate row when `toolbarActions` absent. When present, render active label + actions as one compact row; remove `IDE companion`/`Terminal companion` subtitle.

## Requirements

- Floating trigger: visible **Panels** label plus current surface context/icon; minimum 44×44 target; safe-area right/bottom offsets; high enough above surface content, below select portal/dialog layers.
- Content: all supplied surfaces, icon + untruncated visible label, current selection indicator/semantic state; select calls `onSurfaceChange` once and closes.
- Accessibility: Radix-generated expanded/controls/listbox semantics verified; meaningful trigger label; keyboard/typeahead; Escape/outside dismissal; focus returns to trigger; no icon-only options.
- Motion: color/opacity only; apply local `motion-reduce` utilities to suppress nonessential trigger/menu animation.
- Layout: remove full-width bottom nav; main remains full-height. Check terminal accessory bar, Browser controls, notifications, and dialogs for overlap; use existing safe-area variables and a static tested offset, not runtime measurement.
- Empty surfaces: keep current fallback and render neither trigger nor toolbar-only shell chrome unless useful.
- Desktop: do not alter breakpoint, `WorkspacePage` branch, `IdeShell`, `TerminalWorkspaceShell`, or `TerminalFloatingToolPanel`.

## Architecture

`WorkspacePage mode surface array → MobileWorkspaceShell controlled active id → Radix Select value → onValueChange(id) → existing requestedCompactSurface state`. Surface sections and Browser keep-alive visibility remain unchanged. The trigger overlays compact content; menu content portals at existing `z-[80]`.

## Related code files

- **Modify:** `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/templates/MobileWorkspaceShell.tsx` — replace bottom nav, conditionally slim header, preserve controlled surface rendering.
- **Reference only:** `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/pages/WorkspacePage.tsx` — surface definitions/desktop branch; change only if a discovered contract mismatch makes it unavoidable.
- **Reference only:** `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/ui/Select.tsx`, `packages/ui/src/index.css` — reuse primitive/tokens; avoid shared changes for local styling.
- **Create/delete:** none expected.

## Implementation Steps

1. `/code` handoff first calls `ui-ux-designer` to settle trigger size, corner, upward menu alignment, overlap clearance, and slim toolbar row using nearby tokens/patterns.
2. If `docs/design-guidelines.md` exists then, follow it; currently absent, so inspect `Select`, safe-area CSS, `ActiveTerminalRuntimeDisplay`, notification layering, and compact TopNav patterns. Do not create design/roadmap docs.
3. Import existing Select parts and a suitable Panels icon. Bind `value={activeSurface.id}` and `onValueChange={onSurfaceChange}`; render icon/label items from `surfaces`.
4. Replace bottom `<nav>` grid with fixed safe-area trigger and upward content. Choose explicit local z-index and viewport width/max-height; keep the portaled content inside viewport at 320 px.
5. Remove companion subtitle. Omit header without `toolbarActions`; with actions, render a small single row preserving active label and action node.
6. Keep empty-state early return and active/inactive section behavior unchanged. Verify no `WorkspacePage` or desktop shell edit is needed.

## Todo list

- [x] UI designer decision recorded in implementation notes
- [x] Floating selector replaces bottom grid
- [x] All surface labels/icons/current state represented
- [x] Safe area, z-index, reduced motion, and overlap addressed
- [x] Companion subtitle removed; toolbarActions preserved compactly
- [x] Empty state and mounted/inert surfaces preserved

## Success Criteria

- Compact normal path has no 52 px companion row and no bottom tab strip.
- Every passed surface selectable by pointer and keyboard; menu dismiss/focus behavior matches Radix contract.
- Active surface content and Browser/terminal lifecycle remain stable across switches.

## Risk Assessment

- **Control overlap:** test terminal accessory/browser controls; tune static safe-area offset or reserved corner without shrinking entire content.
- **Layer collision:** keep trigger below portaled select/dialog layers and verify notifications remain usable.
- **Mode switch stale value:** retain existing fallback resolution; Select always receives an available active id.
- **Accidental desktop drift:** confine production edit to compact shell.

## Security Considerations

- UI-local IDs only; no untrusted HTML, artifact parsing, API calls, storage, logging, auth, or permissions changes.
- Treat browser-debug artifact metadata as untrusted text. Do not load/inject absent or unknown artifact contents into UI/tests.

## Next steps

- Implement Phase 02 interaction and viewport coverage after shell behavior is stable.

## Completion Evidence

- `MobileWorkspaceShell` now uses the existing Radix Select with all supplied surface labels/icons, safe-area positioning, reduced-motion utilities, and preserved mounted/inert surface sections.
- Optional toolbar actions use a slim single-line row; normal companion subtitle and bottom grid are removed.
- Terminal short-height positioning was corrected with a viewport-aware `dvh` bottom offset.

## Unresolved Questions

- “Panel” scope assumption remains: all compact workspace surfaces. Stop before code if repository evidence contradicts it.
