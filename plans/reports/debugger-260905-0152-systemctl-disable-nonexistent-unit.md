# Debugger Report: Activation Failure via Systemctl Disable on Non-Existent Unit

**Date:** 2026-09-05 01:52:43 Asia/Saigon  
**Target:** `server/src/linux_release/activate.rs` (lines 370–384)  
**Context:** `./dam-hopper-install.sh --version v0.2.0 --role server` followed by `sudo dam-hopper start`  
**Symptoms:**
- `error: activation failed: process inspection failed: activation failed (systemd command systemctl disable failed with exit code Some(1): Failed to disable unit: Unit file dam-hopper-web.service does not exist.); successfully rolled back`
- State: `Phase: ROLLBACK_FIRST_INSTALL_BASELINE`, `Active Release: (none)`

---

## 1. Root Cause Summary

When installing with `--role server`, release staging deliberately generates and stages only `dam-hopper-api.service` and `dam-hopper-recovery.service`. `dam-hopper-web.service` is neither rendered nor installed to `/etc/systemd/system/`.

During `execute_activation_pipeline()` in `server/src/linux_release/activate.rs` (lines 379–383):
```rust
if candidate.role.includes_web() {
    systemctl_enable("dam-hopper-web.service")?;
} else {
    systemctl_disable("dam-hopper-web.service")?;
}
```
For `role = TargetRole::Server`, `candidate.role.includes_web()` evaluates to `false`. The `else` block unconditionally executes `systemctl_disable("dam-hopper-web.service")?`.

Systemd exits with status 1:
```
Failed to disable unit: Unit file dam-hopper-web.service does not exist.
```
`systemctl_disable()` in `systemd.rs` expects exit code 0 via `execute_cmd()` and converts non-zero exit into `ReleaseError::SystemdCommandFailed`. This aborts the activation pipeline post-health check and triggers automatic rollback to baseline.

The same latent bug exists symmetrically for `--role web` at lines 371–375:
```rust
if candidate.role.includes_server() {
    systemctl_enable("dam-hopper-api.service")?;
} else {
    systemctl_disable("dam-hopper-api.service")?;
}
```
For `role = TargetRole::Web`, `dam-hopper-api.service` is not staged/installed, so `systemctl_disable("dam-hopper-api.service")?` will fail identically.

---

## 2. Backward Execution Trace

```
1. CLI entry: `sudo dam-hopper start`
   ↳ file: server/src/bin/dam-hopper.rs:104
   ↳ func: Commands::Start(_) -> execute_activation(&layout)

2. Activation lock & state machine setup:
   ↳ file: server/src/linux_release/activate.rs:27
   ↳ func: execute_activation() -> execute_activation_locked()
   ↳ reads: /var/lib/dam-hopper/state.json (pending candidate: tag="v0.2.0", role=Server)
   ↳ starts transaction: tx.record_phase(..., Staged, Staged)

3. Pipeline execution:
   ↳ file: server/src/linux_release/activate.rs:118
   ↳ func: execute_activation_pipeline(layout, &tx, &candidate, &mut state)
   ↳ Unit copying (activate.rs:276–308):
       Reads candidate.pending_units_path (/var/lib/dam-hopper/pending-units/).
       Directory contains:
         - dam-hopper-api.service (installed to /etc/systemd/system/)
         - dam-hopper-recovery.service (installed to /etc/systemd/system/)
       Directory DOES NOT contain dam-hopper-web.service (omitted by stage_candidate_units_inner).
   ↳ Host config copying (activate.rs:349–353):
       /etc/dam-hopper/host.json written.
   ↳ Daemon reload & service startup (activate.rs:355–363):
       systemctl_daemon_reload()? -> ok
       candidate.role.includes_server() == true -> systemctl_start("dam-hopper-api.service")? -> ok
       candidate.role.includes_web() == false -> skipped
   ↳ Probing health check (activate.rs:365–368):
       Health check passes on dam-hopper-api.
   ↳ Unit enablement & disablement (activate.rs:370–383):
       candidate.role.includes_server() == true -> systemctl_enable("dam-hopper-api.service")? -> ok
       systemctl_enable(RECOVERY_SERVICE_UNIT)? -> ok
       candidate.role.includes_web() == false -> enters `else` block:
         CALL: systemctl_disable("dam-hopper-web.service")?

4. Command execution failure:
   ↳ file: server/src/linux_release/systemd.rs:54
   ↳ func: systemctl_disable("dam-hopper-web.service")
   ↳ exec: `systemctl disable dam-hopper-web.service`
   ↳ stderr: "Failed to disable unit: Unit file dam-hopper-web.service does not exist."
   ↳ exit code: 1
   ↳ returns: Err(ReleaseError::SystemdCommandFailed { command: "systemctl disable", exit_code: Some(1), stderr: ... })

5. Error catch & Rollback trigger:
   ↳ file: server/src/linux_release/activate.rs:120
   ↳ catch: pipeline_res returned Err
   ↳ records failure: tx.record_failure(layout, &mut state, "ACTIVATION_FAILED", &err_msg)
   ↳ invokes: rollback_activation_failure(layout, &err_msg)

6. Rollback execution:
   ↳ file: server/src/linux_release/rollback.rs:463
   ↳ func: rollback_activation_failure()
   ↳ check: state.active.is_none() == true (fresh install baseline)
   ↳ actions:
       - removes current symlink (/opt/dam-hopper/current)
       - removes public config (/etc/dam-hopper/host.json)
       - state.transaction = None
       - state.latest_failure = Some(FailureRecord {
           phase: "ROLLBACK_FIRST_INSTALL_BASELINE",
           sanitized_error: "systemd command systemctl disable failed with exit code Some(1): Failed to disable unit: Unit file dam-hopper-web.service does not exist."
         })
       - save_manager_state()
   ↳ returns: Ok(())

7. CLI output:
   ↳ returns: Err(ReleaseError::ProcessInspectionFailed { reason: "activation failed (...); successfully rolled back" })
   ↳ binary prints: "error: activation failed: process inspection failed: activation failed (systemd command systemctl disable failed with exit code Some(1): Failed to disable unit: Unit file dam-hopper-web.service does not exist.); successfully rolled back"
```

---

## 3. Pattern Comparison with Other Modules

In other modules within `server/src/linux_release/`, unit disablement is protected:

1. `server/src/linux_release/recovery.rs:125-130`:
```rust
fn disable_if_enabled(unit: &str) -> Result<(), ReleaseError> {
    if systemctl_is_enabled(unit)? {
        systemctl_disable(unit)?;
    }
    Ok(())
}
```
Used in `repair_active_pointers` (recovery.rs:90–100):
```rust
if active.role.includes_server() {
    systemctl_enable(API_SERVICE_UNIT)?;
} else {
    disable_if_enabled(API_SERVICE_UNIT)?;
}

if active.role.includes_web() {
    systemctl_enable(WEB_SERVICE_UNIT)?;
} else {
    disable_if_enabled(WEB_SERVICE_UNIT)?;
}
```

2. `server/src/linux_release/rollback.rs:45–47`:
```rust
if systemctl_is_enabled(unit)? {
    systemctl_disable(unit)?;
}
```

`systemctl_is_enabled(unit)` (systemd.rs:95–105) runs `systemctl is-enabled <unit>`. When unit file does not exist, exit code is non-zero and stdout is not `"enabled"`, returning `Ok(false)` without raising an error.

In contrast, `activate.rs:374` and `activate.rs:382` invoke `systemctl_disable()` unconditionally.

---

## 4. Advisor Verification

External advisor (`evcrate-advisor`) consulted on checkpoint `review:activation-disable-failure`:
- Protocol: `evcrate-advisor-result` v1
- Receipt: backend `codex`, model `gpt-5.6-sol`, effort `high`, status `ADVICE_READY`
- Recommendation confirmed:
  > "Trace: `execute_activation_pipeline(role=server)` reaches service cleanup and runs `systemctl disable dam-hopper-web.service`; that role does not install/provide the web unit, so systemd returns exit code 1 and activation aborts. Make cleanup role-aware, or treat 'unit file does not exist' as an idempotent success while preserving failures for existing units."

---

## 5. Potential Remedies (Analysis Only - No Automatic Fix Applied)

1. **Option A (Consistent with `recovery.rs`):**
   Replace direct `systemctl_disable(unit)` in `activate.rs` with `disable_if_enabled(unit)` or check `systemctl_is_enabled(unit)?` before calling `systemctl_disable(unit)`.
2. **Option B (Idempotent `systemctl_disable`):**
   Update `systemctl_disable()` in `systemd.rs` to treat `"does not exist"` or `"not found"` from systemctl as idempotent `Ok(())`.
3. **Option C (File-existence guard):**
   Check `layout.systemd_unit_dir.join(unit).exists()` before attempting `systemctl_disable`.

---

## 6. Unresolved Questions

- None. Root cause, backward trace, and recovery state machine behavior fully verified.
