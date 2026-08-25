# Phase 01: Port Session Control Data Flow

## Context links

- Parent plan: [plan.md](./plan.md)
- Analysis report: [reports/codebase-analysis.md](./reports/codebase-analysis.md)
- Ports hook: `packages/web/src/hooks/usePorts.ts`
- Transport mapping: `packages/web/src/api/ws-transport.ts`
- Port type mirror: `packages/web/src/api/client.ts`

## Overview

- Date: 2026-05-15
- Priority: P1
- Implementation status: Done
- Description: Preserve the detected port owner session in frontend state and expose a kill-session mutation from `usePorts`.

## Key Insights

- The backend already returns `session_id`; the frontend currently discards it.
- `terminal:kill` already exists and maps to the protected terminal delete route.
- Cache updates should be conservative: do not fake success for port removal if the backend still reports the port.

## Requirements

- Add `sessionId: string | null` to `PortEntry`.
- Map `DetectedPort.session_id` to `PortEntry.sessionId` for detected rows.
- Set `sessionId: null` for tunnel-only rows.
- Add `killPortSession: (sessionId: string) => Promise<void>` to `usePorts`.
- On successful kill, invalidate `["ports"]`, `["tunnels"]`, and terminal session query keys used by the workspace.
- On failure, restore any optimistic cache changes or avoid optimistic changes entirely.

## Architecture

- Keep all transport calls inside `usePorts` so `PortsPanel` remains a view component.
- Use existing `transport.invoke("terminal:kill", sessionId)`; no backend route changes.
- Prefer invalidation over manual removal because port loss is confirmed by backend poller and `port:lost` events.

## Related code files

- Modify: `packages/web/src/hooks/usePorts.ts`
- Modify only if needed: `packages/web/src/api/client.ts`

## Implementation Steps

1. Extend `PortEntry` with `sessionId: string | null`.
2. Update detected-port mapping to assign `sessionId: p.session_id`.
3. Update tunnel-only mapping to assign `sessionId: null`.
4. Add `killPortSession` using `useCallback`.
5. After successful kill, invalidate `["ports"]`, `["tunnels"]`, `["terminal:list"]`, and `["terminal:listDetailed"]` if those keys are present in the app.
6. Return `killPortSession` from `usePorts`.
7. Run TypeScript build to catch contract breakage.

## Todo list

- [x] Preserve detected port `session_id` in `PortEntry`.
- [x] Add `killPortSession` mutation.
- [x] Wire cache invalidation after kill.
- [x] Confirm no backend API changes are needed.

## Success Criteria

- Every detected port row has a non-null `sessionId`.
- Tunnel-only rows have `sessionId: null`.
- Calling `killPortSession` terminates the owning terminal session through existing transport.
- Existing tunnel start/stop behavior remains unchanged.

## Risk Assessment

- Risk: terminal query keys differ from the assumed names.
- Mitigation: inspect terminal hooks during implementation and invalidate exact keys only.
- Risk: backend poller removes the port with delay.
- Mitigation: show killing state in the row and rely on `port:lost` plus invalidation for consistency.

## Security Considerations

- Reuses protected terminal kill endpoint and existing auth middleware.
- Does not introduce arbitrary process termination by port number.

## Next steps

- Phase 02 adds the row-level confirmed kill action in `PortsPanel`.
