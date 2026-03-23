---
parent: plan.md
phase: "03"
status: done
completed: 2026-03-24
priority: P2
effort: 30m
depends_on: []
---

# Phase 03: CollapsibleSection Component

## Context

- Parent: [plan.md](./plan.md)
- Depends on: none
- Required by: Phase 04 (ProjectDetailPage Redesign)

## Overview

Create a reusable `CollapsibleSection` atom with smooth expand/collapse animation, optional icon, title, badge, and chevron indicator.

**Status:** done | **Priority:** P2

## Key Insights

- Codebase already uses ChevronDown/ChevronRight for expand/collapse in UnifiedCommandPanel
- Tailwind v4 supports CSS grid-rows trick for smooth height animation
- Existing atoms follow simple pattern: single-file, props interface, cn() utility

## Requirements

### Props Interface

```typescript
interface CollapsibleSectionProps {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  badge?: number | string;
  defaultOpen?: boolean;
  open?: boolean;           // controlled mode
  onToggle?: (open: boolean) => void;
  className?: string;
  headerClassName?: string;
  children: React.ReactNode;
}
```

### Behavior

1. Click header to toggle, chevron rotates 90deg
2. Content animates via CSS grid-rows
3. Supports controlled (`open` + `onToggle`) and uncontrolled (`defaultOpen`) modes
4. Optional icon left of title, optional badge right of title

## Architecture

Single-file atom. Uses `useState` for uncontrolled, defers to `open` prop for controlled. CSS animation via `grid-template-rows: 0fr` → `1fr` transition.

## Related Code Files

| File | Role |
| ---- | ---- |
| `packages/web/src/components/atoms/Button.tsx` | Pattern reference |
| `packages/web/src/components/atoms/Badge.tsx` | Pattern reference |
| `packages/web/src/lib/utils.ts` | cn() utility |

## Implementation Steps

1. Create `packages/web/src/components/atoms/CollapsibleSection.tsx`
2. Implement controlled + uncontrolled mode with chevron rotation
3. Implement CSS grid-rows animation for smooth expand/collapse
4. Run `pnpm build` to verify

## Todo List

- [ ] Create CollapsibleSection.tsx
- [ ] Implement controlled + uncontrolled mode
- [ ] CSS grid-rows animation
- [ ] Run pnpm build

## Success Criteria

1. Smooth height animation (no layout jumps)
2. Supports both controlled and uncontrolled modes
3. Chevron rotates on toggle
4. Matches existing design tokens

## Risk Assessment

**Very low**: Pure additive component.

## Security Considerations

None. Presentational component.

## Next Steps

Phase 04 uses this in ProjectDetailPage redesign.
