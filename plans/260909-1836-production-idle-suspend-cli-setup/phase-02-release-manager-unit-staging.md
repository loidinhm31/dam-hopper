# Phase 02: Release Manager Unit Staging (`stage_units.rs`)

## 1. Context Links
- Parent Plan: [plan.md](./plan.md)
- Architecture Overview: [cmd-plan.md](./cmd-plan.md)
- Previous Phase: [Phase 01: Systemd Service Unit Templates & PID Management](./phase-01-systemd-service-templates-and-pid-management.md)
- Next Phase: [Phase 03: Release Manager Service Lifecycle](./phase-03-release-manager-service-lifecycle.md)
- Relevant Docs: `docs/linux-release-manager.md`, `docs/terminal-idle-suspend-security.md`

## 2. Overview
- **Date**: 2026-09-10
- **Description**: Update `server/src/linux_release/stage_units.rs` to load, render, and stage `dam-hopper-idle-suspend-helper.service` whenever the release role includes `server`.
- **Priority**: P2
- **Implementation Status**: DONE (2026-09-10)
- **Review Status**: Complete (2026-09-10, 9.5/10 review)
- **Progress**: 100% (4/4 implementation steps; 4/4 todo items)

## 3. Key Insights
- In `server/src/linux_release/stage_units.rs`, `stage_candidate_units_inner` dynamically renders systemd templates using placeholders (`@RELEASE_ROOT@`, `@API_USER@`, `@API_GROUP@`, etc.).
- While `dam-hopper-api.service`, `dam-hopper-web.service`, and `dam-hopper-recovery.service` are staged, `dam-hopper-idle-suspend-helper.service` was omitted during Phase 04 of the release manager.
- Staging `dam-hopper-idle-suspend-helper.service` ensures `sudo dam-hopper install` places the rendered unit in `/etc/systemd/system/` (or pending staging directory), validated with `systemd-analyze verify`.

## 4. Requirements
- When `role.includes_server()`, `stage_units.rs` MUST render `systemd/dam-hopper-idle-suspend-helper.service.in`.
- Rendered helper unit MUST substitute `@RELEASE_ROOT@` with the active/candidate release path.
- The unit MUST be written to `pending_units_dir.join("dam-hopper-idle-suspend-helper.service")` with mode `0644`.
- `staged_unit_paths` MUST include the helper unit path so `systemd-analyze verify` validates it before commit.

## 5. Architecture
```text
Candidate Release Directory (/opt/dam-hopper/releases/vX.Y.Z/server)
  │
  ├─ bin/dam-hopper-server
  ├─ bin/dam-hopper-idle-suspend-helper
  ├─ systemd/dam-hopper-api.service.in
  └─ systemd/dam-hopper-idle-suspend-helper.service.in
        │
        ▼ (stage_units.rs renders templates with release context)
/etc/systemd/system/ (or pending staging dir)
  ├─ dam-hopper-api.service
  └─ dam-hopper-idle-suspend-helper.service
```

## 6. Related Code Files
- `server/src/linux_release/stage_units.rs`
- `server/src/linux_release/constants.rs`
- `server/src/linux_release/inventory_validation.rs`
- `server/src/linux_release/tests.rs`

## 7. Implementation Steps
1. In `server/src/linux_release/constants.rs`:
   - Add `pub const HELPER_SERVICE_UNIT: &str = "dam-hopper-idle-suspend-helper.service";`.
2. In `server/src/linux_release/stage_units.rs`:
   - Inside `if role.includes_server()`:
     - Load helper template using `load_release_template(target_dir, "systemd/dam-hopper-idle-suspend-helper.service.in", "systemd/dam-hopper-idle-suspend-helper.service", allow_checked_in_fallback)`.
     - Render helper template substituting `@RELEASE_ROOT@` with `ctx.release_root.display()`.
     - Write rendered content to `pending_units_dir.join(HELPER_SERVICE_UNIT)` with permissions `0644`.
     - Push unit path to `staged_unit_paths`.
3. In `server/src/linux_release/inventory_validation.rs`:
   - Ensure inventory validation permits and accounts for `dam-hopper-idle-suspend-helper.service`.
4. Add unit test in `server/src/linux_release/tests.rs` asserting helper unit is rendered and staged for `server` role.

## 8. Todo List
- [x] Define `HELPER_SERVICE_UNIT` constant
- [x] Add helper unit template loading and rendering to `stage_units.rs`
- [x] Register staged unit path in validation vector
- [x] Add unit test verifying helper unit rendering and staging

## 9. Success Criteria
- Running `dam-hopper install` on a server bundle places `/etc/systemd/system/dam-hopper-idle-suspend-helper.service`.
- Rendered `ExecStart` points to `/opt/dam-hopper/releases/vX.Y.Z/server/bin/dam-hopper-idle-suspend-helper` (or current symlink).
- `systemd-analyze verify` passes without errors on the staged helper unit.

## 10. Risk Assessment
- **Risk**: Missing helper template in older bundle versions.
- **Mitigation**: `allow_checked_in_fallback` provides safe fallback to checked-in template in `deploy/systemd/` during transition.

## 11. Security Considerations
- The helper unit requires root execution; verify it retains `ProtectSystem=strict`, `ProtectHome=yes`, `NoNewPrivileges=yes`, and `CapabilityBoundingSet=CAP_WAKE_ALARM`.

## 12. Next Steps
- Proceed to [Phase 03: Release Manager Service Lifecycle](./phase-03-release-manager-service-lifecycle.md).
