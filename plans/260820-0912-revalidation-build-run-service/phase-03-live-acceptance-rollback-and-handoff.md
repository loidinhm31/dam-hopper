# Phase 03: Live acceptance, rollback, and handoff

## Context links

- [Parent plan](./plan.md)
- [Phase 02](./phase-02-build-stage-install-and-start-runner.md)
- [Prior live-host evidence](../260820-0315-revalidation-build-run-service/research/researcher-02-live-host-revalidation.md)
- Dependency: Phases 01–02 pass and operator authenticates sudo.

## Overview

- Date: 2026-08-21
- Description: prove installed runtime behavior, rehearse rollback, and align docs/evidence.
- Priority: P2
- Implementation status: completed on 2026-08-21; optional Mongo smoke remains NOT RUN
- Review status: approved (9.5/10) on 2026-08-21
- Effort: 2h

## Key Insights

- Installed-but-inactive evidence does not prove active identity or graceful behavior.
- Repository tests cannot prove root ownership, system-manager state, or rollback.
- MongoDB was not observed locally; live Mongo verification is operator-opt-in/external.
- Evidence must never include dotenv, token, database, or journal credential values.

## Requirements

- Record redacted installed ownership/modes, effective unit, enabled/active state,
  nonzero MainPID, effective UID/GID, exact executable, and listener.
- Verify authenticated same-origin health/UI and unauthenticated rejection.
- Verify no legacy 4800 owner or concurrent SQLite holder.
- Exercise controlled restart and SIGTERM with an active PTY; prove no descendants remain.
- Rehearse marker-guarded rollback without removing user runtime or unrelated state.

## Architecture

Acceptance has two evidence classes: repository gate results and administrator host
results. The production runner records redacted metadata only. Acceptance fails if
the process is root, bind is non-loopback, auth bypasses, secrets enter journal/report,
or any second owner holds runtime databases. Rollback consumes the same install manifest.

## Related code files

- Modify `/home/loidinh/WS/dam-hopper-ws/systemd-system-service/docs/linux-systemd.md` — final pass/fail/not-run matrix.
- Modify `/home/loidinh/WS/dam-hopper-ws/systemd-system-service/docs/system-architecture.md` only for actual implementation/runtime drift.
- Maintain `/home/loidinh/WS/dam-hopper-ws/systemd-system-service/plans/reports/qa-260821-0142-linux-production-runner.md` — redacted validation report.
- Modify Phase 01/02 fixture tests only if live rehearsal exposes a repository defect.
- Delete: none.

## Implementation Steps

1. Review exact privileged commands and authenticate sudo; rerun pre-start identity,
   marker, manifest, env, port, process, and DB-holder gates.
2. Start and record `systemctl show`, MainPID, executable, UID/GID, listener, health,
   authenticated/unauthenticated behavior, web same-origin, and private modes.
3. Inspect bounded journal metadata for startup and secret absence; never export values.
4. Create a controlled active PTY, test on-failure restart and new PID, then normal
   SIGTERM; verify PTY/process-group/cgroup/database cleanup and graceful logs.
5. If requested and a safe external URI exists, run a bounded Mongo smoke without
   deleting external collections; otherwise mark NOT RUN.
6. Rehearse rollback dry-run and approved actual rollback; verify no unit process,
   listener, holder, or changed installed asset remains while runtime state is preserved.
7. Update docs/report with current commands, results, limitations, and marker decision.

## Todo list

- [x] Administrator installed-state evidence passes
- [x] UID/network/auth-boundary/SPA checks pass
- [x] Restart and marker-backed stop/rollback checks pass
- [x] Optional Mongo smoke explicitly NOT RUN
- [x] Authenticated protected-route success, active-PTY SIGTERM cleanup, and journal content review
- [x] Documentation and architecture match delivered behavior

## Current evidence

- PASS — the 2026-08-21 operator run installed the staged assets without
  starting, started the unit as `loidinh` on `127.0.0.1:4801`, returned public
  health `200` JSON, protected unauthenticated health `401`, and SPA root
  `200` HTML.
- PASS — restart produced a new PID while preserving the loopback listener;
  final rollback removed installed assets and left the service inactive with
  no unit/listener and preserved `700`/`600` runtime metadata.
- PASS — authenticated `GET /api/projects` returned `200`; the unauthenticated
  request returned `401`. A disposable active PTY was created successfully,
  and after the operator SIGTERM stop there was no `4801` listener, server
  process, or `sleep 300` descendant.
- PASS — bounded journald checks read 200 entries and found `Disposing all PTY
  sessions` and `Server shutdown complete`; the private secret scan passed.
  No token, response body, dotenv value, or journal body was exported.
- PASS — confirmed rollback removed the installed assets and enablement while
  preserving user runtime state and clearing the private automatic-stage
  record; any retained stage directory requires an explicit path override.
- NOT RUN — optional external MongoDB smoke.

## Success Criteria

- Active service is `loidinh`, loopback-only 4801, production-auth, and same-origin.
- Restart and shutdown preserve single DB ownership and leave no process residue.
- Rollback touches only manifest-backed installed assets and preserves runtime state.
- Report distinguishes PASS, FAIL, and NOT RUN with no secret values.

## Risk Assessment

- Live restart/PTY test affects local state: run only after explicit operator approval.
- Mongo external side effects: use bounded non-destructive probe or leave NOT RUN.
- Rollback drift: abort on any hash/owner/symlink/marker mismatch.

## Security Considerations

- Fail acceptance for root process, non-loopback bind, auth bypass, shared DB holder,
  broad secret output, or unrelated target mutation.
- Keep user runtime `0700`/`0600`; preserve external projects and containers.

## Next steps

- The requested core handoff is recorded in
  `plans/reports/qa-260821-0142-linux-production-runner.md`; only the optional
  external MongoDB smoke remains outside this run.
- Later release work replaces wholesale dotenv import with a hardened secret contract.

## Unresolved questions

- Whether MongoDB is mandatory for this quick check; no external probe was run.
- Retained stage directories are temporary artifacts; automatic install cannot
  consume them after rollback because the private stage record is cleared.
