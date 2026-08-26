# Positioning options research

## Scope

Inspected `packages/ui` manifests, the lockfile, and existing portal/overlay patterns.

## Findings

- `@radix-ui/react-context-menu` is not a direct dependency.
- Floating UI appears only transitively under Radix Popper in `pnpm-lock.yaml:552-564,2927-2942`; importing it directly would violate package ownership under pnpm.
- Existing direct Radix primitives are around dialog/label/select entries in the workspace manifests and lockfile (`pnpm-lock.yaml:136-142`).
- `GitBranchContextMenu.tsx:69-118` already proves the local pattern: `createPortal(document.body)` plus `position: fixed` and viewport client coordinates.

## Recommendation

Build a shared body-portaled `ContextMenuSurface` and pure geometry helper. Keep `clientX/clientY` as viewport CSS pixels, measure actual menu size after render, prefer a 2–4px pointer offset, flip on right/bottom collision, then clamp to an 8px visual-viewport margin. Do not import a transitive Floating UI package or add Radix Context Menu for this simple migration.

Add a new dependency only if later requirements expand to submenus, typeahead, or a deliberate shared overlay engine.

## Trade-off

The custom surface has less built-in behavior than Radix, but it is smaller, matches existing code, avoids wrapping every trigger in Radix providers, and keeps the current scope focused on placement plus baseline accessibility.

## Unresolved

Whether future overlay work justifies a first-class positioning dependency remains open and is outside this plan.

## Decision update

This report captured the pre-validation recommendation for a custom surface. During validation, the user selected Radix Context Menu as the primary path because its official API covers portal, collision, focus, keyboard, and layering requirements. The phase files now use Radix first and retain this custom design only as fallback if trigger compatibility fails.
