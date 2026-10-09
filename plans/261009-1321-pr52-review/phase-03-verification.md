# Phase 03 — Verification

## Context links
- [Review and exercised evidence](../reports/code-review-261009-1321-pr52.md)
- [Overview](plan.md)
- [React research](../reports/researcher-261009-1321-pr52-react-lifetime.md)
- [Dialog research](../reports/researcher-261009-1321-pr52-dialog-focus.md)

## Overview
Date: 2026-10-09. Priority: P1. Status: completed; all checks executed and passing.

## Key Insights
Current unit mocks miss MemoryEditor hydration. Existing compact activation tests do not combine actual xterm focus scheduling with observed-agent selection.

## Requirements
Prove corrected behavior in browser; report only exercised checks. Existing PR suite counts are historical evidence, not post-fix qualification.

## Architecture
Reuse repository Vitest/Playwright and existing component/browser patterns; no second test framework.

## Related code files
Agent Store tests, traditional roster tests, focused Chromium browser tests, PR Quality Gate workflow.

## Implementation Steps
1. Exercise clock-skew fresh approval with actual roster and badge.
2. Exercise cold B/replacement generation using actual MemoryEditor and delayed projects; assert correct read/save target.
3. Smoke compact Escape/focus restoration and exact-agent activation, including real xterm and reduced motion when available.
4. After fixes, run focused UI/browser suites and quality gate; record actual results.

## Todo list
- [x] Prove corrected status and Memory Files paths.
- [x] Run affected suites and lint/typecheck/build gates after implementation.

## Success Criteria
No verified findings remain; quality gate succeeds; existing identity, denial, and continuity contracts preserved.

## Risk Assessment
Synthetic transport proves UI targeting, not backend persistence or live harness admission. Record that boundary explicitly.

## Security Considerations
Isolated profiles and fixtures; no production tokens or destructive commands.

## Next steps
Request code review of fixes before merging. Commit/push only on user request.
