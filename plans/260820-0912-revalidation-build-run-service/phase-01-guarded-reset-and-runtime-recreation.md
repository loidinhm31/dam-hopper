# Phase 01: Guarded reset and runtime recreation

## Context links

- [Parent plan](./plan.md)
- [Repository audit](./research/researcher-01-repository-and-plan-audit.md)
- [Reset/environment review](./research/researcher-02-reset-env-security-review.md)
- [System architecture](../../docs/system-architecture.md#systemd-service-guarded-linux-workflow-and-bounded-host-acceptance)
- Dependency: none; blocks Phase 02 install/start paths.

## Overview

- Date: 2026-08-20
- Description: implement exact preflight, privileged stop, marker verification,
  local-state purge, runtime recreation, and ordered environment-file setup.
- Priority: P2
- Implementation status: completed
- Review status: direct implementation review approved; core administrator acceptance recorded in Phase 03
- Effort: 2.5h

## Key Insights

- Stop/disable is a mutation; label preflight and post-stop revalidation separately.
- Root marker contents are unknown until the operator authenticates sudo.
- Copying dotenv before purge deletes the copy; resolve source first, copy after recreation.
- Wholesale systemd import can override production/auth/path values unless a
  second later-loaded safety file reasserts them.

## Requirements

- Run as `loidinh`; exact Linux/home/repository/canonical-path checks.
- `--env-file` source must be outside the purge tree, regular, non-symlink,
  user-owned, and not group/world-readable; never display contents.
- Typed/interactive purge confirmation plus authenticated interactive sudo.
- Purge only `/home/loidinh/.config/dam-hopper`; exclude repositories,
  workspace/project `.dam-hopper`, `/opt`, `/etc`, containers, and external MongoDB.
- Refuse ambiguous PID, listener, database owner, symlink, marker, or manifest state.

## Architecture

`reset-linux-production.sh` runs user-side checks, requests sudo only for exact
systemd/root-owned operations, verifies single ownership, then purges and
recreates the runtime tree as `loidinh:loidinh 0700`. It copies the selected
dotenv verbatim to `server.env` and creates `server-safety.env`, both `0600`.
Systemd loads the broad file first and safety file second. Safety assignments
force production, no-auth false, HOME/XDG, and web path; host/port remain CLI flags.

## Related code files

- Create `/home/loidinh/WS/dam-hopper-ws/systemd-system-service/deploy/reset-linux-production.sh` — guarded reset; tracked `100755`.
- Modify `/home/loidinh/WS/dam-hopper-ws/systemd-system-service/deploy/systemd/dam-hopper.service` — two ordered mandatory `EnvironmentFile=` entries.
- Create `/home/loidinh/WS/dam-hopper-ws/systemd-system-service/tests/deploy/linux-production-fixtures.sh` — fixture-only reset/env tests, or use an equivalent existing test location discovered during implementation.
- Modify `/home/loidinh/WS/dam-hopper-ws/systemd-system-service/docs/system-architecture.md` only if implementation differs from the approved contract.
- Delete: none.

## Implementation Steps

1. Implement argument parsing, dry metadata preflight, path/owner/mode/symlink checks,
   source eligibility, exact target display, and typed confirmation.
2. Authenticate sudo before any privileged mutation; on failure print the required
   operator action and exit without partial cleanup.
3. Identity-check any nohup PID using UID, executable, command, and start identity;
   stop/disable systemd, then recheck inactive/MainPID/process/4800/4801/DB holders.
4. Verify root marker nonce/hash/inventory against exact unit and `/opt` assets;
   mismatch or unreadability retains everything and aborts.
5. Purge only the canonical runtime tree, recreate `0700`, copy broad dotenv
   atomically to `server.env`, and generate later-loaded `server-safety.env`.
6. Validate modes, ordering, required safety assignments, and no value-bearing output.

## Todo list

- [x] Implement guarded reset and confirmation flow
- [x] Implement sudo stop and marker verification
- [x] Implement exact purge/recreate boundary
- [x] Implement wholesale copy plus safety-file ordering
- [x] Add fixture tests for every refusal and successful recreation path

## Current evidence

- PASS — the fixture harness covers refusal and successful reset/recreation
  paths, including restrictive modes, source isolation, and safety overrides.
- PASS — Bash syntax and whitespace checks pass.
- NOT RUN — live sudo reset, systemd masking/stop, or production runtime
  mutation.

## Success Criteria

- No operation proceeds with failed sudo, ambiguous ownership, or invalid marker.
- Fixture tests prove no target outside the canonical runtime tree is removed.
- Destination files are user-owned `0600`; runtime directory is `0700`.
- Broad-file safety overrides are effective under systemd parsing.

## Risk Assessment

- Irreversible local-state loss: exact printed targets and typed confirmation.
- PID reuse/races: identity plus immediate post-stop revalidation.
- Dotenv parser mismatch: verify with systemd tooling before install/start.
- Root marker drift: fail closed and retain marker/assets.

## Security Considerations

- Never source dotenv, echo values, enable shell tracing, or store secrets in `/opt`.
- Service process stays `loidinh`; scripts never embed a password/helper.
- Wholesale environment exposure is accepted for this quick check only.

## Next steps

- Phase 02 consumes the recreated runtime contract and must not repeat purge.

## Unresolved questions

- Is canonical runtime-tree purge sufficient, or is workspace agent-store purge
  separately required? Current plan excludes it to preserve project trees.
