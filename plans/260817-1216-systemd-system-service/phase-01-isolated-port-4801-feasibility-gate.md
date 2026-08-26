# Phase 01: Isolated Port-4801 Feasibility Gate

## Context links

- [Parent plan](./plan.md)
- [Advisor brief](./reports/01-advisor-decision-brief.md)
- [Planned architecture](../../docs/system-architecture.md#proposedplanned-systemd-system-service-unimplemented)
- Evidence: `server/src/main.rs`, `server/src/state.rs`, `server/src/api/router.rs`

## Overview

- Date: 2026-08-17
- Description: prove service assumptions manually as loidinh before creating deployment assets
- Priority: P2
- Implementation status: done; mandatory gate passed
- Review status: approved
- Completion date: 2026-08-17
- Effort: 1h

## Key Insights

- Current backend already owns `0.0.0.0:4800`; touching 4800 risks collision.
- Live config secrets and SQLite files are loidinh-owned and mode `0600`.
- SIGTERM already drives graceful Axum and subsystem teardown.
- Public health and protected project routes provide a small acceptance surface.

## Requirements

- Run the existing built binary directly as loidinh on `127.0.0.1:4801`.
- Use a fresh temporary root with explicit config, XDG, token, session DB, telemetry DB, web,
  and working paths; do not copy or open live secrets/DBs.
- Keep auth enabled; never pass `--no-auth` or `DAM_HOPPER_NO_AUTH`.
- Record status/timestamps only; never print the generated token.
- Use a 20-second smoke stop bound; record failure if graceful shutdown exceeds it.

## Architecture

The smoke process is separate from nohup and future systemd lifecycle:
`isolated config + isolated SQLite -> loidinh process :4801 -> health/auth checks -> SIGTERM ->
graceful exit`. It has no privileged step and no access to live service databases.

## Related code files

- Create: `/home/loidinh/WS/dam-hopper-ws/systemd-system-service/plans/260817-1216-systemd-system-service/reports/02-manual-feasibility-results.md`
  - Dependency: gate execution; store commands with secret values redacted and observed outcomes.
- Delete: none.
- Modify: none.

## Implementation Steps

1. Confirm the binary candidate and create a fresh temporary root; record paths without secret data.
2. Create a minimal isolated registry/config whose session and telemetry DB paths stay under that
   root; create an isolated web directory and set explicit HOME/XDG/config/web/working paths.
3. Start on `127.0.0.1:4801` as loidinh with auth enabled; do not stop or query the live 4800 DB.
4. Verify `/api/health` succeeds, unauthenticated `/api/projects` is rejected, then authenticated
   access succeeds using the isolated token without echoing it.
5. Send SIGTERM to the smoke PID; wait for exit and capture `Server shutdown complete`, exit
   outcome, closed port, and absence of leftover child processes.
6. Remove only the fresh temporary root after evidence is recorded. Stop on any collision or leak.

## Todo list

- [x] Isolated paths recorded
- [x] Health and protected-route checks recorded
- [x] SIGTERM and closed-port evidence recorded
- [x] No live config/DB path opened
- [x] Gate reviewed before Phase 02

## Success Criteria

- Health returns success on loopback 4801.
- Protected route rejects missing auth and succeeds with isolated auth.
- SIGTERM reaches graceful completion within the planned stop bound.
- No listener/child remains; live 4800 process and private SQLite files remain untouched.

## Risk Assessment

- Wrong DB path could corrupt or lock live state: require absolute temporary DB paths and abort on
  equality with live paths.
- Token leakage through command/log capture: redact values and record only response status.
- Port collision: bind only 4801 and abort if occupied.

## Security Considerations

- Effective identity remains loidinh.
- No sudo, no root shell, no privileged helper, no no-auth mode.
- Temporary files use user-private permissions and are removed only after process exit.

## Next steps

- On pass, start Phase 02. Phase 01 completed 2026-08-17; Phase 02 remains pending.
- On fail, update architecture/plan assumptions; do not create the unit asset.

## Unresolved Questions

- None for this gate; UI hosting choice does not block API-only feasibility.
