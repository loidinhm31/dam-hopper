# Phase 03: Verification and Rollback Validation

> Historical document from the superseded systemd planning sequence. Current acceptance status is maintained by the [successor revalidation plan](../260820-0912-revalidation-build-run-service/plan.md).

## Context links

- [Parent plan](./plan.md)
- [Phase 01 gate](./phase-01-isolated-port-4801-feasibility-gate.md)
- [Phase 02 design](./phase-02-service-asset-and-administrator-handoff.md)
- [Historical architecture context](../../docs/system-architecture.md#systemd-service-guarded-linux-workflow-and-bounded-host-acceptance)

## Overview

- Date: 2026-08-17
- Last updated: 2026-08-19
- Description: validate the future asset without privilege, then provide administrator acceptance
- Priority: P2
- Implementation status: superseded by the successor revalidation plan, which records administrator evidence
- Review status: superseded; current review is tracked by the successor plan
- Effort: 1.5h

## Key Insights

- Repository validation can prove unit syntax/content but cannot prove installed ownership or
  system-manager runtime state.
- Administrator evidence must distinguish asset creation from successful host installation.
- Rollback must protect user-owned config, token, sessions DB, telemetry DB, and collector state.
- Independent release validation and final code review approved the repository changes. Current
  administrator evidence is recorded in the successor revalidation plan and report.

## Requirements

- Run only non-privileged static/unit checks in the development phase.
- Administrator checklist proves root-owned unit/assets, effective `User=loidinh`, loopback bind,
  auth protection, journald, restart behavior, and SIGTERM completion.
- Restart testing must use controlled failure and must not corrupt or concurrently reuse SQLite.
- Docs state exactly which checks are developer evidence versus administrator evidence.

## Architecture

Validation has two trust levels: repository checks inspect the future unit and docs without
installation; administrator checks inspect the installed system manager state and runtime cgroup.
Neither level changes server code. Acceptance requires both evidence sets or an explicit
not-installed status.

## Related code files

- Modify: `/home/loidinh/WS/dam-hopper-ws/systemd-system-service/docs/linux-systemd.md`
  - Dependency: Phase 02 handoff; add observed results without secrets.
- Modify: `/home/loidinh/WS/dam-hopper-ws/systemd-system-service/docs/system-architecture.md`
  - Dependency: final evidence; never claim host installation without administrator proof.
- Create: `/home/loidinh/WS/dam-hopper-ws/systemd-system-service/plans/260817-1216-systemd-system-service/reports/03-verification-results.md`
  - Dependency: completed non-privileged checks and returned administrator evidence.
- Delete: none.

## Implementation Steps

1. Run unit syntax/static validation and inspect resolved fields; verify `User=loidinh`, direct
   executable, explicit paths, loopback, auth enabled, journald, restart policy, and SIGTERM.
2. Check repository scope: only the approved service asset, UI same-origin handling, and
   graceful-shutdown/persistence hardening are included; no installer/package/privileged helper,
   `.env` change, or secret material.
3. Give the administrator the preflight/install checklist. Require old nohup stopped and port/DB
   ownership clear before start.
4. Administrator records installed file ownership/modes, active main PID/effective UID, loopback
   listener, health result, unauthenticated rejection, authenticated success, and journal output.
5. Administrator sends a normal stop and records graceful shutdown/no remaining descendants; then
   exercises controlled on-failure restart only with safe, isolated state.
6. Administrator rehearses rollback and confirms user-owned config/DB files are preserved.
7. Update docs/report with pass/fail/not-run labels. Keep architecture marked planned if install
   evidence is absent.

## Todo list

- [x] Non-privileged unit/static checks pass
- [x] Scope and secret scan pass
- [ ] Administrator install evidence returned
- [ ] UID/network/auth/journal/restart/SIGTERM checks pass
- [ ] Rollback preserves user state
- [x] Documentation status matches evidence

Tracking decision: This historical Phase 03 is **superseded**. Administrator installation,
runtime, restart/journald/effective-UID, and rollback checks are accepted in the successor
revalidation plan.

## Success Criteria

- Unit is syntactically valid and statically conforms to every planned invariant.
- Installed process, if accepted, is demonstrably loidinh and loopback-only with auth enabled.
- Journald captures lifecycle logs; SIGTERM is graceful; on-failure restart behaves as documented.
- Rollback leaves no unit process/listener and preserves all user-owned runtime state.

## Risk Assessment

- Static checks may be mistaken for deployment proof: label evidence source and status.
- Restart test may touch live DB: use controlled isolated state or skip until safe.
- Rollback may remove user data: removal list is restricted to administrator-installed assets.

## Security Considerations

- Never expose tokens in journal excerpts or reports.
- No sudo execution by repository automation; administrator uses an authenticated admin context.
- Fail acceptance if effective UID is root, bind is non-loopback, auth is bypassed, or DB ownership
  is shared concurrently.

## Next steps

- Use the successor revalidation plan for any further acceptance or release decision.

## Unresolved Questions

- Who is the accepting administrator and where should signed host evidence be retained?
