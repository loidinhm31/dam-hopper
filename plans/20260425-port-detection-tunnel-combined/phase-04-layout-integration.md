# Phase 04 — Layout Integration

## Context Links

- Parent plan: `plans/20260425-port-detection-tunnel-combined/plan.md`
- Depends on: Phase 03 (PortsPanel component exists and builds)
- Scout: `plans/20260425-port-detection-tunnel-combined/reports/00-scout-existing-code.md` §5

## Overview

| Field | Value |
|---|---|
| Date | 2026-04-25 |
| Description | Replace TunnelPanel + PortsPanel in Sidebar with single combined PortsPanel; delete TunnelPanel.tsx |
| Priority | P1 |
| Implementation status | pending |
| Review status | pending |
| Effort | ~2h |

## Key Insights

- `Sidebar.tsx` lines 157-161 currently mount both `<TunnelPanel />` and `<PortsPanel />`.
- After this phase: single `{!collapsed && <PortsPanel />}` replaces both.
- `TunnelPanel.tsx` is deleted (its sub-components are now inlined in `PortsPanel.tsx`).
- `useTunnels.ts` is NOT deleted — `PortsPanel` may not need it (usePorts already merges), but leaving it avoids any lingering import errors. Re-evaluate in Phase 05.
- Check all other imports of `TunnelPanel` — none expected outside Sidebar (confirmed by scout grep).
- Check all other imports of `PortsPanel` — none expected outside Sidebar.

## Requirements

**Functional:**
- Sidebar renders the combined `PortsPanel` where `TunnelPanel` and old `PortsPanel` were.
- `TunnelPanel.tsx` file deleted.
- `pnpm build` passes.

**Non-Functional:**
- Sidebar.tsx diff is minimal — two lines replaced by one.
- No layout shift; sidebar scroll behavior unchanged.

## Architecture — File Changes

| File | Action | Detail |
|---|---|---|
| `packages/web/src/components/organisms/Sidebar.tsx` | EDIT | Remove TunnelPanel import; replace two panel renders with one |
| `packages/web/src/components/organisms/TunnelPanel.tsx` | DELETE | Sub-components now in PortsPanel.tsx |
| `packages/web/src/hooks/useTunnels.ts` | EVALUATE | If usePorts.ts inlined all tunnel logic, this becomes unused — delete. If still imported elsewhere, keep. |

## Related Code Files

| File | Lines | Content |
|---|---|---|
| `packages/web/src/components/organisms/Sidebar.tsx` | 157-161 | TunnelPanel + PortsPanel mount point |
| `packages/web/src/components/organisms/Sidebar.tsx` | top imports | `import { TunnelPanel }` and `import { PortsPanel }` — update to single PortsPanel |

## Exact Sidebar Diff

**Before** (Sidebar.tsx lines ~155-162):
```tsx
      {/* Tunnel panel */}
      {!collapsed && <TunnelPanel />}

      {/* Ports panel */}
      {!collapsed && <PortsPanel />}
```

**After:**
```tsx
      {/* Ports panel */}
      {!collapsed && <PortsPanel />}
```

**Import change:**
Remove: `import { TunnelPanel } from "@/components/organisms/TunnelPanel.js";`
Keep/update: `import { PortsPanel } from "@/components/organisms/PortsPanel.js";` (already imported)

## Implementation Steps

1. **Delete `TunnelPanel.tsx`**
   ```bash
   rm packages/web/src/components/organisms/TunnelPanel.tsx
   ```

2. **Edit `Sidebar.tsx`**
   - Remove `import { TunnelPanel }` line.
   - Remove `{/* Tunnel panel */}` comment and `{!collapsed && <TunnelPanel />}` line.
   - Keep `{/* Ports panel */}` and `{!collapsed && <PortsPanel />}`.

3. **Check `useTunnels.ts` usage**
   ```bash
   grep -rn "useTunnels" packages/web/src --include="*.tsx" --include="*.ts"
   ```
   If only imported by `TunnelPanel.tsx` (now deleted), delete `useTunnels.ts` too.
   If imported elsewhere, keep.

4. **`pnpm build`** — must pass.

5. **`pnpm lint`** — must pass.

## Todo List

- [ ] Delete `TunnelPanel.tsx`
- [ ] Remove TunnelPanel import from `Sidebar.tsx`
- [ ] Remove `<TunnelPanel />` render line from `Sidebar.tsx`
- [ ] Check `useTunnels.ts` remaining usages
- [ ] Delete `useTunnels.ts` if unused
- [ ] `pnpm build` passes
- [ ] `pnpm lint` passes

## Success Criteria

- `pnpm build` with zero TS errors.
- `grep -rn "TunnelPanel" packages/web/src` returns zero results.
- Sidebar visually shows the combined ports panel in place of two separate sections.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| TunnelPanel is imported somewhere other than Sidebar | Low | Low | Scout grep confirmed only Sidebar — double-check after delete |
| useTunnels still imported by some page/component | Low | Low | Grep before deleting |

## Security Considerations

None specific to this phase.

## Next Steps

Phase 05: smoke tests and documentation update.
