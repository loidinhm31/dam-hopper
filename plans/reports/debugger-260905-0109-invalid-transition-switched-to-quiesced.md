# Debugger Investigation Report: Invalid Deployment Transition from Switched to Quiesced

## 1. Executive Summary
- **Issue**: Running `sudo dam-hopper start` fails with:
  ```text
  error: activation failed: configuration error: invalid deployment transition from Switched to Quiesced
  ```
- **Root Cause**: An unhandled state leak in `server/src/linux_release/rollback.rs:466-518` (`rollback_activation_failure`, Case 1).
  - When activation previously failed at phase `Switched` (due to the unit dependency error), `rollback_activation_failure` executed rollback Case 1 (`state.active.is_none()`).
  - Line 471 clears `state.transaction = None;` **only** if `tx.migration.is_some()`. In a standard first-install without format-2 migration, `state.transaction` is **never cleared**.
  - `state.json` remained on disk with `transaction.phase = Switched`.
  - Furthermore, re-running `dam-hopper install` (`stage_transaction.rs:264-280`) updates `state.pending`, but leaves `state.transaction` untouched.
  - When the user runs `sudo dam-hopper start` again, `activate.rs:108-118` sees `Some(ref existing) = state.transaction` (with `phase = Switched`), and attempts `tx.record_phase(..., DeploymentState::Quiesced)`.
  - `validate_transition(current=Switched, target=Quiesced)` in `journal.rs:50-75` rejects this backward transition, throwing `invalid deployment transition from Switched to Quiesced`.

---

## 2. Technical Analysis & Trace

### 2.1 The Rollback Case 1 Leak
In `server/src/linux_release/rollback.rs:463-518`:
```rust
pub async fn rollback_activation_failure(layout: &Layout, reason: &str) -> Result<(), ReleaseError> {
    let mut state = load_or_init_manager_state(&layout.manager_state_path())?;
    // Case 1: First-install baseline restoration
    if state.active.is_none() {
        if let Some(tx) = state.transaction.clone() {
            if let Some(ref mig) = tx.migration {
                stop_and_disable_units(ALL_SERVICE_UNITS, &layout.systemd_unit_dir)?;
                super::migration::rollback_migration_exchange(layout, mig)?;
                state.transaction = None; // <--- ONLY CLEARED FOR MIGRATIONS
                state.latest_failure = Some(FailureRecord { ... });
                save_manager_state(&layout.manager_state_path(), &mut state)?;
                return Ok(());
            }
        }
        ...
        state.latest_failure = Some(FailureRecord {
            failed_at: Utc::now().to_rfc3339(),
            tx_id: None,
            target_tag: state.pending.as_ref().map(|p| p.tag.clone()),
            phase: "ROLLBACK_FIRST_INSTALL_BASELINE".into(),
            sanitized_error: reason.to_string(),
        });
        // BUG: state.transaction = None is MISSING HERE!
        save_manager_state(&layout.manager_state_path(), &mut state)?;
        return Ok(());
    }
```
Contrast with Case 2 (lines 604-612 for rollback to existing active release):
```rust
    state.transaction = None; // Properly cleared!
    state.latest_failure = Some(FailureRecord { ... });
    save_manager_state(&layout.manager_state_path(), &mut state)?;
```
In Case 1 without migration, `state.transaction` was saved to disk unchanged with `phase: Switched`.

### 2.2 Staging Does Not Clear Aborted Transactions
In `server/src/linux_release/stage_transaction.rs:264-280`:
```rust
    mgr_state.pending = Some(pending_record.clone());
    if let Some(mig) = migration_opt.as_ref() {
        let tx_record = ...;
        mgr_state.transaction = Some(tx_record);
    }
    // BUG: If migration_opt is None, any existing mgr_state.transaction is left intact!
```
When the user re-ran `./dam-hopper-install.sh`, staging updated `mgr_state.pending`, but did not clear `mgr_state.transaction`.

### 2.3 Activation Crash on Re-attempt
In `server/src/linux_release/activate.rs:108-118`:
```rust
    let tx = if let Some(ref existing) = state.transaction {
        ActivationTransaction::from_id(layout, &existing.tx_id)?
    } else {
        ActivationTransaction::new(layout)?
    };
    tx.record_phase(layout, &mut state, DeploymentState::Quiesced, TransactionPhase::Quiesced)?;
```
In `server/src/linux_release/transaction.rs:117-118`:
```rust
    let current_state = state.current_deployment_state();
    validate_transition(current_state, to_state)?;
```
In `server/src/linux_release/state.rs:113-125`:
```rust
    pub fn current_deployment_state(&self) -> DeploymentState {
        if let Some(tx) = &self.transaction {
            match tx.phase {
                ...
                TransactionPhase::Switched => DeploymentState::Switched,
                ...
            }
        }
```
Because `tx.phase` was `Switched`:
`validate_transition(DeploymentState::Switched, DeploymentState::Quiesced)` failed closed:
```rust
    (Switched, Probing) => true,
    (Switched, RollingBack) => true,
    // (Switched, Quiesced) is NOT ALLOWED
```

---

## 3. Codebase Fixes (For Subsequent Release — Not Applied Automatically)

1. **`server/src/linux_release/rollback.rs:509`**:
   Always clear `state.transaction = None;` before saving in Case 1:
   ```rust
   state.transaction = None;
   state.latest_failure = Some(FailureRecord {
       failed_at: Utc::now().to_rfc3339(),
       tx_id: None,
       target_tag: state.pending.as_ref().map(|p| p.tag.clone()),
       phase: "ROLLBACK_FIRST_INSTALL_BASELINE".into(),
       sanitized_error: reason.to_string(),
   });
   save_manager_state(&layout.manager_state_path(), &mut state)?;
   ```

2. **`server/src/linux_release/stage_transaction.rs:264-280`**:
   When staging a clean release without migration, ensure `mgr_state.transaction = None;` so newly staged candidates always start with a clean slate:
   ```rust
   mgr_state.pending = Some(pending_record.clone());
   if let Some(mig) = migration_opt.as_ref() {
       let tx_record = ...;
       mgr_state.transaction = Some(tx_record);
   } else {
       mgr_state.transaction = None;
   }
   ```

3. **`server/src/linux_release/activate.rs:108-115`**:
   If an existing transaction is in a non-pending state and `state.active.is_none()`, discard the stale transaction and initialize a fresh one with `ActivationTransaction::new(layout)`.

---

## 4. Immediate Workaround on Target Host (Unblocking User Immediately)

Because `/var/lib/dam-hopper-manager/state.json` on the Ubuntu host still holds `"transaction": { "phase": "switched", ... }`, the host is stuck on that stale record.

To unblock the machine immediately without waiting for a new release build:

### Workaround Method: Remove stale state file and re-stage
Since there is no active release yet (`Active Release: (none)`), removing the state file and running install freshly creates a clean `Pending` state with no stale transaction:
```bash
sudo rm -f /var/lib/dam-hopper-manager/state.json
./dam-hopper-install.sh --version v0.2.0 --role server
sudo dam-hopper start
sudo dam-hopper status
```

---

## 5. Unresolved Questions
- None. Cause, mechanism, code callsites, and remediation are fully identified.
