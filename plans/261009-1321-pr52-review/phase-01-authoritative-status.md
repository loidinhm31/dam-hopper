# Phase 01 — Authoritative status presentation

## Context links
- [Review](../reports/code-review-261009-1321-pr52.md)
- [Overview](plan.md)

## Overview
Date: 2026-10-09. Priority: P1/P2. Status: completed.

## Key Insights
Render-time Date.now fails the existing purity gate. Remote expiry and browser clocks are different authorities. Server lease checks already publish Unknown.

## Requirements
Pure presentation; correct primary status/reason under clock skew; retain availability and explicit turn-ended semantics.

## Architecture
Reuse server status/lease authority. Do not add polling, protocol fields, or clock abstraction unless independently necessary.

## Related code files
`TraditionalTerminalProjectsDisplay.tsx`, `traditional-terminal-agents.ts`, builder tests, existing status store and connection hook.

## Implementation Steps
1. Remove unsynchronized local-wall-clock expiry decision using existing server-authoritative state.
2. Keep availability/generation fences and presentation rules.
3. Update affected behavioral tests to catch clock-skew disagreement, not copy implementation details.

## Todo list
- [x] Implement pure, authoritative presentation.
- [x] Verify fresh blocked reason and turn-ended rules.

## Success Criteria
No render purity error. Roster and badge agree for ready fresh observations when browser time differs by 30 seconds.

## Risk Assessment
Do not mistake removing local comparison for removing server lease expiry. Preserve Unknown broadcasts and unavailable precedence.

## Security Considerations
No new ingress, prompt capture, or cross-profile state sharing.

## Next steps
Proceed to [verification](phase-03-verification.md); memory remediation is independent.
