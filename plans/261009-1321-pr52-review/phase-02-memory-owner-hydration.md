# Phase 02 — Memory owner hydration

## Context links
- [Review](../reports/code-review-261009-1321-pr52.md)
- [Overview](plan.md)

## Overview
Date: 2026-10-09. Priority: P2. Status: completed.

## Key Insights
Owner-keyed retirement is correct. Mounting the editor with loading projects initializes an empty target that never follows hydration.

## Requirements
Select/read/save a valid owner-local project after hydration. Preserve profile/generation remounts and draft/dialog retirement.

## Architecture
Prefer a projects-resolution gate before editor mount. Alternatively reconcile project selection within the existing editor; do not add a parallel target store.

## Related code files
`AgentStorePage.tsx`, `MemoryEditor.tsx`, their tests, owner-qualified projects/memory hooks.

## Implementation Steps
1. Retain connected registered owner gating and connection-keyed remount.
2. Distinguish loading projects from resolved empty workspace before mounting MemoryEditor.
3. Verify cold B and replacement-generation responses initialize a nonempty target.
4. Keep resolved empty workspaces non-editable.

## Todo list
- [x] Repair hydration/mount sequencing.
- [x] Cover cold-owner one-project reads and save target.

## Success Criteria
A→B and reconnect while on Memory Files request the selected project's content and save that exact project; no tab-toggle workaround.

## Risk Assessment
Lazy-module/cache timing can mask the race. Delay projects deterministically in reproduction. Never preserve A's draft into B.

## Security Considerations
Keep all API calls owner/generation-qualified; no ambient fallback or automatic connection.

## Next steps
Proceed to [verification](phase-03-verification.md).
