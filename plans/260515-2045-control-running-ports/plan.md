---
title: "Control Running Ports"
description: "Add a kill control to PortsPanel for terminating terminal sessions that own detected ports."
status: in-progress
priority: P1
effort: 4h
branch: main
tags: [frontend, ports, terminal, workspace]
created: 2026-05-15
---

# Control Running Ports

## Summary

Add a kill action to the existing `PortsPanel` so users can stop a detected port created from a free terminal. V1 kills the owning PTY terminal session, not arbitrary OS processes, because detected ports already include `session_id` and the existing terminal API supports `terminal:kill`.

## Key Decisions

- Use the current `DELETE /api/terminal/:id` flow via `transport.invoke("terminal:kill", sessionId)`.
- Preserve `session_id` in the web `PortEntry` model as `sessionId`.
- Require user confirmation before killing the session.
- Show kill only for detected ports with a session id; tunnel-only/custom rows keep existing tunnel controls only.
- Do not add Linux-specific PID discovery or direct process killing in this feature.

## Phases

| Phase | Status | Effort | Description |
| --- | --- | ---: | --- |
| [Phase 01](./phase-01-port-session-control-data-flow.md) | Done | 1.5h | Add session kill capability to the ports hook and cache behavior. |
| [Phase 02](./phase-02-ports-panel-kill-action.md) | Planned | 2.5h | Add confirmed kill UI in `PortsPanel` and verify behavior. |

## Validation

- `pnpm --filter @dam-hopper/web build`
- `pnpm --filter @dam-hopper/web test`
- Manual: start a free terminal, run a dev server, confirm port appears, kill from PortsPanel, verify terminal and port stop.

## References

- Codebase analysis: [reports/codebase-analysis.md](./reports/codebase-analysis.md)
- Frontend component docs: ../../docs/frontend-components.md
- System architecture docs: ../../docs/system-architecture.md
