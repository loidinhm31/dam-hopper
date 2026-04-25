# Phase 00 — Git Cleanup

## Context Links

- Parent plan: `plans/20260425-port-detection-tunnel-combined/plan.md`
- Scout: `plans/20260425-port-detection-tunnel-combined/reports/00-scout-existing-code.md`

## Overview

| Field | Value |
|---|---|
| Date | 2026-04-25 |
| Description | Extract UI patches for reference, rebase to drop proxy commits, verify build |
| Priority | P1 (blocks all subsequent phases) |
| Implementation status | done |
| Review status | done — 2026-04-25 |
| Effort | ~1h |

## Key Insights

- `ef591e0` (drag-split) sits on top of the two commits to drop. Cannot cherry-pick; must rebase.
- `cde6245` = proxy backend commit; `1deec79` = ports UI commit. Both must go.
- `1256f11` = port detection backend — the desired new base.
- Save UI patches to `/tmp/` before rebase for reference in Phase 03.
- A backup branch prevents any data loss.

## Requirements

**Functional:**
- After rebase: `git log --oneline -5` shows `ef591e0` on top of `1256f11` (drag-split directly on port detection).
- No `proxy.rs`, `proxy_token.rs`, or proxy wiring in working tree.
- `PortsPanel.tsx` and `usePorts.ts` from `1deec79` are gone from working tree (they came from that commit).
- `cargo check` succeeds (router.rs still references proxy — addressed in Phase 01).

**Non-Functional:**
- Backup branch exists before any destructive operation.
- Patch files saved to `/tmp/` for implementer reference.

## Architecture

No file changes — git history surgery only. Phase 01 handles remaining file deletions.

## Related Code Files

| File | Role |
|---|---|
| `server/src/api/proxy.rs` | Will exist in working tree after rebase (from cde6245 drop); Phase 01 removes |
| `server/src/api/proxy_token.rs` | Same |
| `packages/web/src/hooks/usePorts.ts` | Will exist (from 1deec79 drop); Phase 01 or 03 rebuilds |
| `packages/web/src/components/organisms/PortsPanel.tsx` | Same |

> Note: After `git rebase --onto 1256f11 cde6245~1 ef591e0`, the files added by `cde6245` and `1deec79` will be **gone from the working tree** because those commits are no longer in history. Any files they introduced that are NOT also in `ef591e0` will vanish. The working tree reflects `1256f11` + `ef591e0` delta only.

## Implementation Steps

1. **Safety branch**
   ```bash
   git branch backup/pre-port-cleanup
   ```

2. **Save UI patches for Phase 03 reference**
   ```bash
   git show 1deec79 -- packages/web/src/components/organisms/PortsPanel.tsx \
     > /tmp/old-ports-panel.tsx.patch
   git show 1deec79 -- packages/web/src/hooks/usePorts.ts \
     > /tmp/old-use-ports.ts.patch
   ```

3. **Drop the two commits, preserve drag-split**
   ```bash
   git rebase --onto 1256f11 cde6245~1 ef591e0
   ```
   If conflicts arise, they will be in files touched by both `ef591e0` and the dropped commits. Most likely candidates: `Sidebar.tsx`, `ws-transport.ts`. Resolve by keeping the drag-split changes from `ef591e0` without the proxy additions from the dropped commits.

4. **Verify history**
   ```bash
   git log --oneline -6
   # Expected: ef591e0 at top, then 1256f11
   ```

5. **Spot-check working tree**
   ```bash
   ls server/src/api/proxy.rs 2>/dev/null && echo "EXISTS — remove in Phase 01" || echo "GONE"
   ls packages/web/src/hooks/usePorts.ts 2>/dev/null && echo "EXISTS" || echo "GONE"
   ```

6. **Quick compile check (proxy imports may still be in router.rs)**
   ```bash
   cargo check --manifest-path server/Cargo.toml 2>&1 | head -30
   # Errors expected around proxy/proxy_token — OK, Phase 01 fixes them
   ```

7. **Web build smoke check**
   ```bash
   pnpm build 2>&1 | tail -20
   ```

## Todo List

- [x] Create `backup/pre-port-cleanup` branch
- [x] Save `old-ports-panel.tsx.patch` to `/tmp/`
- [x] Save `old-use-ports.ts.patch` to `/tmp/`
- [x] Run `git rebase --onto 1256f11 cde6245~1 ef591e0`
- [x] Verify `git log` shows correct order
- [x] Verify proxy files absent OR note they need Phase 01 removal
- [x] `cargo check` passes or only fails on proxy references
- [x] `pnpm build` passes (web has no proxy imports yet)

## Success Criteria

- `git log --oneline -3` shows `ef591e0` → `1256f11` as the two most recent commits.
- `server/src/api/proxy.rs` either absent or noted for Phase 01 deletion.
- `cargo check` errors are only proxy-related (0 errors if proxy files already gone).
- `pnpm build` succeeds.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Rebase conflict in Sidebar.tsx | Medium | Medium | `ef591e0` adds drag-split layout; `1deec79` adds PortsPanel import — resolve by keeping drag-split, removing PortsPanel import |
| Rebase conflict in ws-transport.ts | Low | Low | `1deec79` adds `proxy-token:get` mapping; keep all non-proxy additions |
| `ef591e0` depends on code from dropped commits | Low | High | Check via `git show ef591e0 --stat` before rebase to confirm no dependency |

## Security Considerations

None — git history operation only.

## Next Steps

Phase 01: delete remaining proxy files and clean up router.rs.

## Unresolved Questions

- If `ef591e0` imported from the dropped `PortsPanel.tsx`, the rebase will have a compilation error. Check `git show ef591e0 -- packages/web/src/components/organisms/Sidebar.tsx` to confirm.
