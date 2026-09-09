# Phase 01: Systemd Service Unit Templates & PID Management

## 1. Context Links
- Parent Plan: [plan.md](./plan.md)
- Architecture Overview: [cmd-plan.md](./cmd-plan.md)
- Reference Brainstorm Report: [brainstorm-260909-1836-production-idle-suspend-cli-setup.md](../reports/brainstorm-260909-1836-production-idle-suspend-cli-setup.md)
- Relevant Docs: `docs/terminal-idle-suspend-security.md`, `docs/linux-systemd.md`

## 2. Overview
- **Date**: 2026-09-09
- **Description**: Update `dam-hopper-api.service.in` and `dam-hopper-idle-suspend-helper.service.in` templates to manage `/run/dam-hopper/server.pid` and socket group ownership.
- **Priority**: P2
- **Implementation Status**: DONE — 2026-09-09
- **Review Status**: Complete — 2026-09-09 (10/10 cycle-2 review)
- **Progress**: 100% (4/4 implementation steps; 4/4 todo items)

## 3. Key Insights
- The helper daemon uses `EnrolledPeerPolicy` which validates peer credentials (`SO_PEERCRED`) against the API server's PID via `/run/dam-hopper/server.pid`.
- In `systemd`, `dam-hopper-api.service` has `Type=exec` and `RuntimeDirectory=dam-hopper`.
- Adding `PIDFile=/run/dam-hopper/server.pid`, `ExecStartPost=/usr/bin/sh -c 'echo $MAINPID > /run/dam-hopper/server.pid'`, and `ExecStopPost=/usr/bin/rm -f /run/dam-hopper/server.pid` reliably establishes the PID file at boot and removes it upon service stop.
- In `dam-hopper-idle-suspend-helper.service.in`, ensuring the helper socket permissions allow the API service group ensures non-root service accounts (`--service-user`) can access `/run/dam-hopper/idle-suspend.sock`.

## 4. Requirements
- `dam-hopper-api.service.in` MUST write its `$MAINPID` to `/run/dam-hopper/server.pid` when started.
- `dam-hopper-api.service.in` MUST remove `/run/dam-hopper/server.pid` when stopped.
- `dam-hopper-idle-suspend-helper.service.in` MUST use `RuntimeDirectory=dam-hopper` and point `--enrolled-pid-file` to `/run/dam-hopper/server.pid`.
- Socket directory `/run/dam-hopper/` must be shared between units with group-write permissions (`0775` directory, `0660` socket).

## 5. Architecture
```text
systemd (PID 1)
  │
  ├─ dam-hopper-api.service
  │    ├─ RuntimeDirectory=dam-hopper (/run/dam-hopper)
  │    ├─ ExecStart=dam-hopper-server (PID X)
  │    └─ ExecStartPost: echo $MAINPID > /run/dam-hopper/server.pid
  │
  └─ dam-hopper-idle-suspend-helper.service
       ├─ RuntimeDirectory=dam-hopper
       └─ ExecStart=dam-hopper-idle-suspend-helper --enrolled-pid-file /run/dam-hopper/server.pid
```

## 6. Related Code Files
- `deploy/systemd/dam-hopper-api.service.in`
- `deploy/systemd/dam-hopper-api.service`
- `deploy/systemd/dam-hopper-idle-suspend-helper.service.in`
- `deploy/systemd/dam-hopper-idle-suspend-helper.service`
- `deploy/systemd/dam-hopper-idle-suspend-helper.socket.in`
- `deploy/systemd/dam-hopper-idle-suspend-helper.socket`

## 7. Implementation Steps
1. In `deploy/systemd/dam-hopper-api.service.in`:
   - Add `PIDFile=/run/dam-hopper/server.pid`.
   - Add `ExecStartPost=/usr/bin/sh -c 'echo $MAINPID > /run/dam-hopper/server.pid'`.
   - Add `ExecStopPost=/usr/bin/rm -f /run/dam-hopper/server.pid`.
2. Sync changes to checked-in template `deploy/systemd/dam-hopper-api.service`.
3. In `deploy/systemd/dam-hopper-idle-suspend-helper.service.in` and `deploy/systemd/dam-hopper-idle-suspend-helper.socket.in`:
   - Confirm `--enrolled-pid-file /run/dam-hopper/server.pid` matches the path.
   - Ensure `RuntimeDirectoryMode=0775`, `DirectoryMode=0775`, `UMask=0007`, and socket mode/group directives match API group access.
4. Verify systemd template validation with `systemd-analyze verify`.

## 8. Todo List
- [x] Add PIDFile and ExecStartPost/ExecStopPost to `dam-hopper-api.service.in`
- [x] Sync checked-in `deploy/systemd/dam-hopper-api.service`
- [x] Audit helper service/socket paths, runtime permissions, and group placeholders
- [x] Run `systemd-analyze verify` against templates

## 9. Success Criteria
- Starting `dam-hopper-api.service` creates `/run/dam-hopper/server.pid` containing the active `dam-hopper-server` PID.
- Stopping `dam-hopper-api.service` unlinks `/run/dam-hopper/server.pid`.
- Helper starts and successfully resolves the enrolled PID from `/run/dam-hopper/server.pid`.

## 10. Risk Assessment
- **Risk**: Systemd executes `ExecStartPost` concurrently or shortly after `ExecStart`.
- **Mitigation**: `dam-hopper-api.service` uses `Type=exec` (supported on systemd >= 240, Fedora 44 has systemd 259+), where `ExecStartPost` executes immediately once binary execution begins.

## 11. Security Considerations
- The PID file is placed in `/run/dam-hopper/` which is protected against symlink attacks and arbitrary local writes.
- Mode of `/run/dam-hopper/server.pid` is restricted by `UMask=0077` (or service user owner).

## 12. Next Steps
- Proceed to [Phase 02: Release Manager Unit Staging](./phase-02-release-manager-unit-staging.md).
