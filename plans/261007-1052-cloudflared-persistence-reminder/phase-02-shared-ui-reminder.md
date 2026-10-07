# Phase 2 — Shared UI reminder and retained port

## Context links
[Parent plan](plan.md); [architecture](../../docs/system-architecture.md#tunnel-isolation-and-port-forwarding). Parallel with phase 1 under frozen wire contract.

## Overview
2026-10-07. P2. Implementation: complete. Review: source approved; parent browser validation passed. Actor: `ui-ux-designer`, configured role/model retained.

## Key insights
Tunnel-only rows now origin untracked, not falsely listening. Shared global reminder queries enabled current connections, uses captured generation for Stop, cancels superseded REST snapshots, and occupies bounded space inside a shared viewport.

## Requirements
Parent acceptance 5–7, UI part of 1–2; global reminder outside route-specific Ports panel; equal IDs on different profiles independent; Stop captured to exact live owner.

## Architecture
TunnelInfo removes PTY owner fields and requires `reminderDue: boolean`. Bridge carries `tunnel:reminder {id}` into generation-qualified tunnel cache, with REST catch-up. Tunnel-only port state becomes `unknown`/origin untracked; no false listener-health assertion. Global reminder displays profile/port/URL and Dismiss/Stop; browser session dismissal survives reconnect/reload. Reuse Zustand/session storage conventions conservatively, bounded state and graceful storage unavailability. No browser-only three-hour timer, new dependencies, or terminal-agent mock notification. Reminder is inert/hidden under Cognito privacy mode.

## Related code files
`packages/ui/src/api/client.ts`; `hooks/{use-ports,use-sse}.ts`; `embed/dam-hopper-app.tsx`; PortsPanel/runtime-port consumers; new small reminder component/store only where existing modules cannot express it; focused behavior tests/browser tests.

## Implementation steps
1. Update wire model/event bridge and owner-qualified snapshot/query/action handling; migrate TunnelInfo fixtures.
2. Keep tunnel-only rows visible with accurate unknown origin wording; preserve explicit Stop/URL actions and explain retained exposure.
3. Mount accessible global reminder, Dismiss persistence and captured Stop/error behavior; avoid privacy overlay leakage and stacking overlap.
4. Add behavior regressions for due catch-up, dismissal, independent profiles, stale owner and stop errors. Skip build/lint/tests/formatters during actor work.

## Todo list
- [x] Scoped due event and reconnect data.
- [x] Retained untracked-origin row and exposure messaging.
- [x] Global reminder with safe Dismiss/Stop.
- [x] Consumer-visible regression coverage.

## Success criteria
User sees reminder anywhere in shared app after server marks due, including reconnect; Dismiss never stops; Stop targets only rendered connection. Origin/PTY disappearance leaves tunnel accessible in Ports UI.

## Risk assessment
Global hook must subscribe to secondary profile connection-generation changes, not only ambient transport. Due cache updates need rejection of stale events. Tests must exercise user behavior, not copies/default fields.

## Security considerations
Hide/inert reminder under Cognito; no URL disclosure above mask. No ambient transport fallback for new reminder operations; retained public-port warning explicit.

## Next steps
Complete: UI TypeScript/web build, focused57 tests and full2560-test suite passed. Actual browser verified retained URL/Stop actions, session Dismiss/reload/fresh-page catch-up, Cognito, and desktop/narrow stacked geometry. See [runtime report/captures](reports/runtime-and-review.md). Native desktop runtime and human visual approval not implied.
