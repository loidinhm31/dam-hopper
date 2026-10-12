# Phase 04 — Deployment Service Retirement & Runtime tmpfiles Provisioning

Status: Pending · Priority: P1 · Effort: 6h · Dependencies: implementation independent of 01–03; qualify together in 05

## Objective & scope
Stop obsolete runner restart jobs before removing its rules; establish one canonical runtime producer. Install early-boot discoverable tmpfiles link and provision runtime **before** helper sandbox startup. Preserve retirement-script dry-run, lock, narrow allowlists, shared IPC and user data. Apply same provisioning order to activation/rollback/recovery starts.

Context: [overview](./plan.md), [verified runtime/startup evidence](../reports/debugger-261012-0613-idle-suspend-capability.md), [research §4](../reports/researcher-261012-0613-idle-suspend-diagnostics.md), [runtime provisioning docs](../../docs/linux-release-runtime-provisioning.md).

## Exact files to modify
| File | Change |
|---|---|
| `deploy/remove-plugin-platform.sh` | Unconditional scoped stop/disable/reset-failed, stopped-state checks, strict reload, obsolete rule removal, canonical reapply; rooted fixture-safe paths |
| `server/src/linux_release/activate.rs` | Retire obsolete producer before cleanup; snapshot/install boot tmpfiles; pre-provision before helper starts, including restoration branch |
| `server/src/linux_release/runtime_cleanup.rs` | Reusable narrowly allowlisted runner retirement and runtime preparation helpers; retain no-follow live-socket cleanup checks |
| `server/src/linux_release/systemd.rs` | Typed absent-unit handling and strict retirement control; never ignore access denied or active restart state |
| `server/src/linux_release/layout.rs` | Rooted `/etc/tmpfiles.d` directory and canonical runtime-link accessors |
| `server/src/linux_release/transaction.rs` | Durable fixed tmpfiles/link snapshot paths under existing transaction backup root; no new manager-state schema |
| `server/src/linux_release/rollback.rs` | Restore canonical rule/link with native units and pre-provision before every restored helper start; never restore obsolete runner |
| `server/src/linux_release/recovery.rs` | Ensure recovery paths reuse retirement/provisioning order; fail closed on incomplete new snapshot |
| `deploy/systemd/dam-hopper-idle-suspend-helper.service.in`, `deploy/systemd/dam-hopper-idle-suspend-helper.service` | Explicit ordering/dependency on boot tmpfiles setup; preserve shared owner and sandbox/peer policy |
| `server/src/linux_release/unit_policy.rs` | Enforce tmpfiles boot ordering without RuntimeDirectory ownership or socket activation |
| `tests/deploy/linux-release-remove-plugin-platform.sh` | Restart-state command harness, canonical repair, rooted global rule directory, refusal/dry-run/idempotence |
| `server/tests/linux_release_native_phase07.rs`, `server/tests/linux_release_state_machine.rs`, `server/tests/linux_release_staging.rs`, `server/tests/linux_release_unit_policy.rs` | Service ordering, snapshot/rollback, rendered template/policy expectations |

`stage_units.rs` already stages/render-copies canonical runtime config; intentionally unchanged unless shared rendering changes require adjustment. `deploy/tmpfiles.d/dam-hopper-runtime.conf.in` remains the sole owner rule (root:rendered API group, 3770). Do not introduce a second rule or helper RuntimeDirectory. Manifest/archive packaging already includes service/runtime template; no new archive inventory item needed.

## Implementation details & code snippets
### 1. Retire producer, not only files
- Run under existing deployment lock. Script keeps default read-only dry-run; neither dry-run nor user scope creates directories, acquires mutating lock, resets units or invokes tmpfiles.
- For production system scope with systemd, attempt stop regardless of `is-active` (activating/auto-restart/failed also matter). Missing unit is idempotent success **only after typed LoadState confirms not-found**. Real authorization/control errors abort before deletion/repair.
- Stop, disable, reset-failed; verify `ActiveState` inactive/failed, `MainPID=0`, no pending start/restart Job. If residual job persists, cancel that fixed unit's job and recheck; no broad job cancellation. Missing unit cannot remain restart-scheduled.
- Remove only runner unit, enablement link, `/etc/dam-hopper/tmpfiles.d/dam-hopper-plugin-runner.conf` and global `/etc/tmpfiles.d/dam-hopper-plugin-runner.conf`. Use allowlisted no-follow removal; unknown vendor/drop-in producer detected => refuse with operator guidance, never wildcard delete systemd/tmpfiles.
- Strict `daemon-reload`, reset-failed if still needed, verify obsolete unit unloaded/disabled with no job. No generic `|| true` around real failures. Leave current native units, helper socket/PID, config/audit and history untouched in manual script.

```bash
# Algorithm sketch: wrappers distinguish not-found from denied/control failure.
retire_obsolete_runner() {
    stop_known_unit_allow_absent "$RUNNER_UNIT"   # not gated by is-active
    disable_known_unit_allow_absent "$RUNNER_UNIT"
    reset_failed_known_unit_allow_absent "$RUNNER_UNIT"
    assert_unit_stopped_and_no_restart_job "$RUNNER_UNIT"
    remove_fixed_runner_unit_and_rules           # existing scoped allowlist
    systemctl daemon-reload                      # failure propagates
    assert_runner_retired
    reapply_validated_canonical_runtime_tmpfiles
}
```

Do not call shell removal script from Rust activation (would reacquire deployment lock). Rust helper owns same fixed allowlist/ordering via existing direct command adapter. Keep existing runtime cleanup refusal for live bound sockets, unexpected file types, symlinks or changing inodes; retiring runner occurs **before** `cleanup_stopped_plugin_runtime` verifies producer states. Cleanup must not be weakened to accept activating state.

### 2. Canonical config and global boot link
- Copy rendered config durably to `layout.runtime_tmpfiles_conf_path()`, after validating finalized API User/Group and root-owned config. Never hardcode incident UID/group.
- Add `layout.global_tmpfiles_dir()` = trusted_root/etc/tmpfiles.d and `layout.runtime_tmpfiles_link_path()` = directory/dam-hopper-runtime.conf. Use existing `atomic_symlink` publication, only after checking root-owned real directory ancestors and fixed target. Reject unrelated existing regular file/directory or unexpected symlink instead of overwriting host custom configuration.
- Production symlink target `/etc/dam-hopper/tmpfiles.d/dam-hopper-runtime.conf`; rooted fixture uses a relative `../dam-hopper/tmpfiles.d/dam-hopper-runtime.conf` target so no fixture link escapes into host `/etc`. Relative target is also valid in production. Link owner root; canonical target 0644/root and matching rendered group rule.
- Global obsolete-rule removal must be rooted/injected in tests. Add script `DAM_HOPPER_GLOBAL_TMPFILES_DIR` override (default `/etc/tmpfiles.d`) with same protection checks, and refuse non-root fixture mode targeting real global dir. Current fixture overrides systemd/config but script hardcodes `/etc/tmpfiles.d`; close that safety gap while extending harness.
- Reuse `systemd_tmpfiles_create` and its root argument; no mkdir/chown 0777 alternative. Only canonical config gets applied after obsolete producers stop; inspect known global/vendor rules for fixed shared path conflicts, fail on unknown competing writer.

### 3. Provision before namespace setup

```ini
[Unit]
After=network.target systemd-tmpfiles-setup.service
Requires=systemd-tmpfiles-setup.service

[Service]
# Existing directives retained:
ReadWritePaths=/run/dam-hopper
ExecStartPre=+/usr/bin/systemd-tmpfiles --create /etc/dam-hopper/tmpfiles.d/dam-hopper-runtime.conf
```

`ExecStartPre` is supplemental repair, not the directory's first creator: mount namespace setup precedes it. Boot tmpfiles reads global directories, not the private config directory. Do not prefix ReadWritePaths with `-` to hide failure; do not enable legacy `.socket` or replace tmpfiles with competing `RuntimeDirectory=` ownership.

```rust
// Ordering sketch inside existing locked activation pipeline:
retire_obsolete_runner(layout)?;
cleanup_stopped_plugin_runtime(layout)?;
snapshot_canonical_tmpfiles_and_link(layout, tx)?;
// Install rendered units + canonical config + global link durably.
systemctl_daemon_reload()?;
if candidate.role.includes_server() {
    prepare_shared_runtime_before_helper(layout)?; // tmpfiles, identity/mode check
    // Preserve existing policy: helper start failure warns; API can still serve.
    start_helper_with_existing_warning_policy();
    provision_and_start_api(layout, &api_unit_path, || systemctl_start(API_SERVICE_UNIT))?;
}
```

Provisioning/identity/retirement failures abort activation (unsafe IPC ownership); helper capability/service failure retains existing optional-helper/API availability policy. Do not make unrelated hardware absence block API health. Activation/recovery should not report helper readiness solely from active unit or HTTP health; live safe probe qualifies helper separately.

### 4. Transaction, rollback and recovery
- Snapshot old canonical file and global link/absence **before mutation** under private existing transaction backup root. Use fixed filenames and durable manifest recording presence/validated target; derive paths from validated existing transaction/units-backup location. No new persisted manager-state fields/version needed. Don't place tmpfiles metadata inside unit backup directory where `restore_unit_files` would install it as a service.
- Rollback restores native units + canonical rule + owned global link/absence together, validates rule matches restored API numeric identity, re-applies tmpfiles before restored helper start. First-install rollback removes only newly owned link/config when snapshot says absent; leave shared runtime dir/user data intact.
- Retirement is irreversible security cleanup of an obsolete conflicting producer; never snapshot/restore or re-enable runner unit/rule. A failed activation must not resurrect restart clobbering. Rollback previous native binaries/helpers as a matched pair, including IPC protocol version.
- Use same fixed preparation helper for activation's early restoration branch and rollback helper-start paths. Recovery must finish persisted transaction ordering rather than starting services with stale/missing boot link. New interrupted transactions missing/corrupt required snapshot => explicit recovery-required, no guessed restoration.
- Before upgrade, complete any pre-existing pending transaction with its existing release manager. Do not invent a v1/new-snapshot compatibility branch for partially migrated transactions.

### 5. Existing socket group and non-root behavior
- Canonical parent group repair does not prove current socket's group. Release activation stops native producers, safely removes stopped artifacts, repairs canonical runtime, then helper rebinds socket 0660 inheriting intended setgid group. Verify root-owned socket with API group and current PID enrollment.
- Manual removal script must not delete/restart live helper or rewrite PID enrollment. Inspect socket type/group/mode where privileged; if old inherited group remains, return explicit incomplete-remediation/operator action instead of claiming success. Use authorized release activation or planned helper restart after preserving evidence. No recursive chown or automatic group broadening.
- `DAM_HOPPER_ALLOW_NON_ROOT=1` is isolated-fixture allowance only, not production success without system permissions. Real system-scope retirement/global link creation with insufficient authority fails; no user-dir link fallback that boot tmpfiles cannot discover. Existing adapter's ignored AccessDenied handling must not be reused for strict retirement verification.

## Acceptance & verification commands
All commands below for implementation owner, not executed in planning:

```bash
bash -n deploy/remove-plugin-platform.sh
bash tests/deploy/linux-release-remove-plugin-platform.sh
cargo test --manifest-path server/Cargo.toml --test linux_release_native_phase07
cargo test --manifest-path server/Cargo.toml --test linux_release_unit_policy
cargo test --manifest-path server/Cargo.toml --test linux_release_state_machine
cargo test --manifest-path server/Cargo.toml --test linux_release_staging
```

Fixtures: auto-restart unit with `is-active` false still stopped; order stop -> remove -> reload -> canonical apply -> helper start; authorization failure prevents mutation; missing unit/idempotence; dry-run zero mutation; no real `/etc` writes in rooted tests; symlink/unexpected-file refusal; safe shared directory/socket/PID/history preservation; injected failure before/after config/link publication and during helper/API start; complete rollback/restored owner and protocol pair.

Authorized disposable Linux host only: boot tmpfiles link discovery, no pre-existing `/run/dam-hopper`, reboot/start with helper namespace and canonical 3770 directory already provisioned; no `226/NAMESPACE`, no obsolete jobs/NRestarts growth, correct live socket 0660/API group and peer enrollment. Test cold boot separately from same-boot manual restart. Phase 05 records read-only evidence commands and qualification boundaries.

## Risks & invariants
- **Requirement 48:** paths/systemd stderr are controlled operator logs, never HTTP error/status. Release/idle-suspend API error projection remains safe even for provisioning failure; no credentials/config contents in logs.
- Root/systemd mutation requires approved environment. Planning and ordinary unit tests must not stop production units, chmod shared paths, program RTC or reboot.
- Stop/remove-only fix is insufficient if restart Job remains; permission-only fix is insufficient if obsolete producer remains. Do both in defined order.
- Live helper socket inherits setgid parent; socket group must be measured/recreated, not inferred from service Group. Never bypass enrolled PID to probe from arbitrary shell.
- Transaction protects canonical ownership, not obsolete resurrection. Preserve user home/history/config/audit/release data and both web/server role behavior.

## Unresolved questions
No design questions. Actual cold-boot evidence needs an authorized disposable systemd environment and maintenance window.
