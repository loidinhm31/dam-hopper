# Phase 01 — Keep branch Select controlled

## Context links

- Parent: [plan](./plan.md)
- Source: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/GitBranchControl.tsx`

## Parallelization info

Independent. May run with Phases 02 and 03. Owns no files used by them.

## Overview

- Priority: P2
- Status: Pending
- Review: Pending
- Goal: prevent Radix Select changing from uncontrolled to controlled while Git data loads.

## Key insights

`branchValue` is always a string. Converting its empty initial value to `undefined` is the warning source.

## Requirements

- Keep the placeholder when no branch is available.
- Preserve checkout and view-mode behavior.
- Test the asynchronous empty-to-branch transition.

## Architecture

The component remains the single owner of branch selection. No query, API, or shared Select changes.

## Related code files

- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/GitBranchControl.tsx`
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/GitBranchControl.test.tsx`

## File ownership

Exclusive to this phase: both related code files above.

## Implementation steps

1. Pass `branchValue` directly as the Select value.
2. Make test hook mocks support first-render loading and a later loaded branch.
3. Assert placeholder/value transitions and no controlledness console warning.

## Todo list

- [ ] Keep empty string controlled.
- [ ] Add loading-to-loaded regression.

## Success criteria

- No React/Radix controlledness warning.
- Existing branch checkout/view flows pass.

## Conflict prevention

Do not edit lifted branch-menu files; Phase 03 owns them.

## Risk assessment

Low. Radix uses an empty root value as unselected state; SelectItem values remain non-empty.

## Security considerations

No security boundary changes.

## Next steps

Run Phase 04 after all parallel phases finish.
