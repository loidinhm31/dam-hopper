# Phase 01 - Fix Touch Actions

## Context Links

- `packages/ui/src/components/organisms/TerminalTreeView.tsx`
- `packages/ui/src/hooks/use-coarse-pointer.ts`

## Overview

Priority: High
Status: Complete

Fleet Terminal row actions are hover-revealed. Mobile/touch browsers cannot reliably hover, so launch controls can stay invisible and impractical to tap.

## Requirements

- Keep desktop hover behavior.
- On coarse pointer/touch devices, show Fleet action buttons without hover.
- Increase mobile tap target size without changing terminal spawn behavior.
- Add focused regression coverage.

## Implementation Steps

1. Use the existing coarse pointer hook in Fleet tree.
2. Centralize row action class names for desktop vs touch.
3. Apply the class to command, profile, instance, and free terminal action buttons.
4. Add/adjust tests for touch visibility and launch callback.
5. Run focused tests and build/type verification.

## Success Criteria

- Mobile Fleet launch button is visible and tappable.
- Existing desktop layout remains compact.
- Verification commands complete or any remaining failures are reported with evidence.
