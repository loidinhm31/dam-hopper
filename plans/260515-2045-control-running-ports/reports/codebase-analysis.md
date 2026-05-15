# Codebase Analysis: Control Running Ports

## Summary

The existing implementation already has the primitives needed for v1. The backend detects ports from PTY output and stores the owning `session_id`. The frontend merges detected ports with tunnel state in `usePorts`, and `PortsPanel` renders per-port actions. The terminal transport already exposes `terminal:kill`.

## Relevant Findings

- `server/src/port_forward/session.rs` defines `DetectedPort` with `port`, `session_id`, `project`, `detected_via`, and `state`.
- `server/src/api/port_forward.rs` returns `{ ports: DetectedPort[] }` from `GET /api/ports`.
- `packages/web/src/hooks/usePorts.ts` currently drops `session_id` when converting `DetectedPort` to `PortEntry`.
- `packages/web/src/api/ws-transport.ts` maps `terminal:kill` to `DELETE /api/terminal/:id`.
- `packages/web/src/components/organisms/PortsPanel.tsx` already has row-level action patterns, inline errors, and tunnel start/stop controls.
- `packages/web/src/components/pages/WorkspacePage.tsx` already renders `<PortsPanel />`; no page-level integration change is required.

## Chosen Approach

Kill the PTY session that owns the detected port. This is safer and simpler than adding OS-level PID discovery because it follows existing auth, terminal lifecycle, restart-prevention, and event paths.

## Out Of Scope

- Directly killing arbitrary host processes by listening port.
- Cross-platform PID lookup.
- Backend API additions for `POST /api/ports/:port/kill`.
- Bulk kill or "kill all ports" actions.

## Unresolved Questions

None. User selected confirmation before kill; kill scope defaults to owning terminal session.
