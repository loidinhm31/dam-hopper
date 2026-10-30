use std::collections::BTreeSet;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};
use uuid::Uuid;

use crate::session_changes::inventory::capture_inventory;
use crate::session_changes::root::{validate_project_root_preflight, PreflightBudget};
use crate::session_changes::store::{SessionChangesKey, SessionChangesRecord, SessionChangesService};
use crate::session_changes::types::*;

#[derive(Debug)]
pub enum PrepareOutcome {
    Prepared(PreparedReceipt),
    Existing(ExistingReceipt),
}

pub async fn prepare_session_capture(
    service: &Arc<SessionChangesService>,
    terminal_id: String,
    terminal_incarnation: String,
    project_root: &Path,
    req: PrepareRequest,
) -> Result<PrepareOutcome, ErrorCode> {
    if req.version != 1 {
        return Err(ErrorCode::InvalidRequest);
    }
    if !is_valid_canonical_decimal_string(&terminal_incarnation) {
        return Err(ErrorCode::IncarnationMismatch);
    }
    if req.lifecycle == PrepareLifecycle::Resume {
        return Err(ErrorCode::OriginalUnavailable);
    }

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    if req.expires_at_ms < now_ms {
        return Err(ErrorCode::RegistrationExpired);
    }
    // Direct root preflight check
    let mut preflight_budget = PreflightBudget::default();
    let validated_root = validate_project_root_preflight(
        project_root,
        &req.root_id,
        req.cwd_hint.as_deref(),
        &mut preflight_budget,
    )
    .map_err(|e| match e {
        crate::session_changes::root::RootPreflightError::InvalidRootId(_) => ErrorCode::InvalidRequest,
        crate::session_changes::root::RootPreflightError::RootEscapesProject => ErrorCode::RootMismatch,
        crate::session_changes::root::RootPreflightError::GitMarkerMissing => ErrorCode::TargetUnavailable,
        crate::session_changes::root::RootPreflightError::BudgetExhausted(_) => ErrorCode::Deadline,
        crate::session_changes::root::RootPreflightError::TargetUnavailable => ErrorCode::TargetUnavailable,
        crate::session_changes::root::RootPreflightError::Io(_) => ErrorCode::TargetUnavailable,
    })?;

    let key = SessionChangesKey {
        terminal_id,
        terminal_incarnation: terminal_incarnation.clone(),
        omp_session_id: req.omp_session_id.clone(),
        root_id: req.root_id.clone(),
    };

    // 1. Acquire global blocking permit first so Busy does not strand an Initializing reservation
    let _permit = service
        .blocking_permits
        .clone()
        .try_acquire_owned()
        .map_err(|_| ErrorCode::Busy)?;

    // 2. Check existing record and atomically insert initializing placeholder
    {
        let mut records = service.records.lock();

        // Prune older sessions for the same terminal and release their storage
        let stale_keys: Vec<_> = records
            .keys()
            .filter(|k| {
                k.terminal_id == key.terminal_id
                    && k.terminal_incarnation == key.terminal_incarnation
                    && k.omp_session_id != key.omp_session_id
            })
            .cloned()
            .collect();
        for stale in stale_keys {
            if let Some(stale_rec) = records.remove(&stale) {
                if let Some(cov) = stale_rec.baseline_coverage {
                    service.release_storage(cov.raw_bytes);
                }
            }
        }

        // Prune expired or failed reservations
        let expired_keys: Vec<_> = records
            .iter()
            .filter_map(|(k, r)| {
                if r.state == StatusState::Initializing {
                    if let Some(prep_time) = r.prepared_at {
                        if prep_time.elapsed().as_millis() as u64 > r.prepared_ttl_ms {
                            return Some(k.clone());
                        }
                    }
                } else if r.state == StatusState::Unavailable
                    && r.reason == Some(ErrorCode::RegistrationExpired)
                    && k.omp_session_id != key.omp_session_id
                {
                    return Some(k.clone());
                }
                None
            })
            .collect();
        for exp in expired_keys {
            if let Some(exp_rec) = records.remove(&exp) {
                if let Some(cov) = exp_rec.baseline_coverage {
                    service.release_storage(cov.raw_bytes);
                }
            }
        }

        if let Some(rec) = records.get(&key) {
            if rec.state == StatusState::Ready || rec.state == StatusState::Incomplete {
                drop(records);
                let status = service.build_status(&key);
                return Ok(PrepareOutcome::Existing(ExistingReceipt {
                    version: 1,
                    kind: "existing".into(),
                    status,
                }));
            }
            if rec.state == StatusState::Initializing {
                if let Some(prep_time) = rec.prepared_at {
                    if prep_time.elapsed().as_millis() as u64 <= rec.prepared_ttl_ms {
                        return Err(ErrorCode::Busy);
                    }
                    // Expired initializing reservation, allow fresh prepare to overwrite
                } else {
                    return Err(ErrorCode::Busy);
                }
            }
            if rec.original_failed {
                return Err(ErrorCode::OriginalUnavailable);
            }
        }
        if records.len() >= MAX_RETAINED_IDENTITIES && !records.contains_key(&key) {
            return Err(ErrorCode::Capacity);
        }

        // Atomically insert Initializing reservation
        let placeholder = SessionChangesRecord {
            registration_id: req.registration_id.clone(),
            baseline_id: None,
            activation_nonce: None,
            activation_receipt_id: None,
            captured_at_ms: Some(now_ms),
            prepared_at: Some(Instant::now()),
            prepared_ttl_ms: PREPARATION_TTL_SECS * 1000,
            origin: Some(Origin::SessionStart),
            state: StatusState::Initializing,
            acknowledgment: Acknowledgment::Pending,
            baseline_inventory: None,
            baseline_coverage: None,
            comparison: None,
            current_revision_manifest: None,
            comparison_revision: 0,
            reason: None,
            original_failed: false,
            active_from_now: None,
            recent_turn_ids: BTreeSet::new(),
            last_settled_turn_id: None,
            dirty_settled_hint: false,
            canonical_root: validated_root.canonical_root.clone(),
        };
        records.insert(key.clone(), placeholder);
    }
    let canonical_root = validated_root.canonical_root.clone();

    // Run inventory scan under monotonic deadline (<= 10s)
    let inventory = match tokio::task::spawn_blocking(move || {
        capture_inventory(&canonical_root, Duration::from_secs(MAX_PREPARE_CAPTURE_DURATION_SECS))
    })
    .await
    {
        Ok(Ok(inv)) => inv,
        _ => {
            let mut records = service.records.lock();
            let tombstone = SessionChangesRecord {
                registration_id: req.registration_id.clone(),
                baseline_id: None,
                activation_nonce: None,
                activation_receipt_id: None,
                captured_at_ms: Some(now_ms),
                prepared_at: Some(Instant::now()),
                prepared_ttl_ms: PREPARATION_TTL_SECS * 1000,
                origin: Some(Origin::SessionStart),
                state: StatusState::Unavailable,
                acknowledgment: Acknowledgment::Pending,
                baseline_inventory: None,
                baseline_coverage: None,
                comparison: None,
                current_revision_manifest: None,
                comparison_revision: 0,
                reason: Some(ErrorCode::OriginalUnavailable),
                original_failed: true,
                active_from_now: None,
                recent_turn_ids: BTreeSet::new(),
                last_settled_turn_id: None,
                dirty_settled_hint: false,
                canonical_root: validated_root.canonical_root.clone(),
            };
            records.insert(key, tombstone);
            return Err(ErrorCode::TargetUnavailable);
        }
    };

    // Try to reserve accounted storage
    if let Err(e) = service.try_reserve_storage(inventory.coverage.raw_bytes) {
        let mut records = service.records.lock();
        let tombstone = SessionChangesRecord {
            registration_id: req.registration_id.clone(),
            baseline_id: None,
            activation_nonce: None,
            activation_receipt_id: None,
            captured_at_ms: Some(now_ms),
            prepared_at: Some(Instant::now()),
            prepared_ttl_ms: PREPARATION_TTL_SECS * 1000,
            origin: Some(Origin::SessionStart),
            state: StatusState::Unavailable,
            acknowledgment: Acknowledgment::Pending,
            baseline_inventory: None,
            baseline_coverage: None,
            comparison: None,
            current_revision_manifest: None,
            comparison_revision: 0,
            reason: Some(ErrorCode::Capacity),
            original_failed: true,
            active_from_now: None,
            recent_turn_ids: BTreeSet::new(),
            last_settled_turn_id: None,
            dirty_settled_hint: false,
            canonical_root: validated_root.canonical_root.clone(),
        };
        records.insert(key, tombstone);
        return Err(e);
    }

    let baseline_id = Uuid::new_v4().to_string();
    let activation_nonce = Uuid::new_v4().to_string();

    let baseline_coverage = inventory.coverage.clone();

    let record = SessionChangesRecord {
        registration_id: req.registration_id.clone(),
        baseline_id: Some(baseline_id.clone()),
        activation_nonce: Some(activation_nonce.clone()),
        activation_receipt_id: None,
        captured_at_ms: Some(now_ms),
        prepared_at: Some(Instant::now()),
        prepared_ttl_ms: PREPARATION_TTL_SECS * 1000,
        origin: Some(Origin::SessionStart),
        state: StatusState::Initializing,
        acknowledgment: Acknowledgment::Pending,
        baseline_inventory: Some(inventory),
        baseline_coverage: Some(baseline_coverage.clone()),
        comparison: None,
        current_revision_manifest: None,
        comparison_revision: 0,
        reason: None,
        original_failed: false,
        active_from_now: None,
        recent_turn_ids: BTreeSet::new(),
        last_settled_turn_id: None,
        dirty_settled_hint: false,
        canonical_root: validated_root.canonical_root,
    };

    {
        let mut records = service.records.lock();
        if let Some(rec) = records.get(&key) {
            // CAS check: if no longer Initializing or registration mismatch, discard without overwriting
            if rec.registration_id != req.registration_id || rec.state != StatusState::Initializing {
                service.release_storage(baseline_coverage.raw_bytes);
                drop(records);
                let status = service.build_status(&key);
                return Ok(PrepareOutcome::Existing(ExistingReceipt {
                    version: 1,
                    kind: "existing".into(),
                    status,
                }));
            }
        }
        if let Some(old) = records.insert(key, record) {
            if let Some(cov) = old.baseline_coverage {
                service.release_storage(cov.raw_bytes);
            }
        }
    }
    Ok(PrepareOutcome::Prepared(PreparedReceipt {
        version: 1,
        kind: "prepared".into(),
        server_epoch: service.server_epoch.clone(),
        terminal_incarnation,
        registration_id: req.registration_id,
        omp_session_id: req.omp_session_id,
        root_id: req.root_id,
        baseline_id,
        activation_nonce,
        captured_at_ms: now_ms,
        prepared_ttl_ms: PREPARATION_TTL_SECS * 1000,
        baseline_coverage,
    }))
}

pub fn activate_session_baseline(
    service: &Arc<SessionChangesService>,
    key: &SessionChangesKey,
    req: &ActivationRequest,
) -> Result<ActivationReceipt, ErrorCode> {
    if req.version != 1 {
        return Err(ErrorCode::InvalidRequest);
    }
    if req.server_epoch != service.server_epoch {
        return Err(ErrorCode::ServerRestarted);
    }

    let mut records = service.records.lock();
    let rec = records.get_mut(key).ok_or(ErrorCode::BaselineMissing)?;

    if rec.original_failed {
        return Err(ErrorCode::OriginalUnavailable);
    }
    if let Some(prep_at) = rec.prepared_at {
        if prep_at.elapsed().as_millis() as u64 > rec.prepared_ttl_ms {
            rec.state = StatusState::Unavailable;
            rec.reason = Some(ErrorCode::RegistrationExpired);
            return Err(ErrorCode::RegistrationExpired);
        }
    }

    if rec.baseline_id.as_deref() != Some(&req.baseline_id) {
        return Err(ErrorCode::BaselineMissing);
    }
    if rec.activation_nonce.as_deref() != Some(&req.activation_nonce) {
        return Err(ErrorCode::InvalidRequest);
    }

    if let Some(existing_receipt_id) = &rec.activation_receipt_id {
        return Ok(ActivationReceipt {
            version: 1,
            server_epoch: service.server_epoch.clone(),
            registration_id: req.registration_id.clone(),
            omp_session_id: req.omp_session_id.clone(),
            root_id: req.root_id.clone(),
            baseline_id: req.baseline_id.clone(),
            activation_nonce: req.activation_nonce.clone(),
            activated: true,
            activation_receipt_id: existing_receipt_id.clone(),
        });
    }

    let activation_receipt_id = Uuid::new_v4().to_string();
    rec.activation_receipt_id = Some(activation_receipt_id.clone());
    Ok(ActivationReceipt {
        version: 1,
        server_epoch: service.server_epoch.clone(),
        registration_id: req.registration_id.clone(),
        omp_session_id: req.omp_session_id.clone(),
        root_id: req.root_id.clone(),
        baseline_id: req.baseline_id.clone(),
        activation_nonce: req.activation_nonce.clone(),
        activated: true,
        activation_receipt_id,
    })
}

pub fn receive_session_receipt(
    service: &Arc<SessionChangesService>,
    key: &SessionChangesKey,
    req: &ReceiptRequest,
) -> Result<ReceiptResponse, ErrorCode> {
    if req.version != 1 {
        return Err(ErrorCode::InvalidRequest);
    }
    if req.server_epoch != service.server_epoch {
        return Err(ErrorCode::ServerRestarted);
    }

    let mut records = service.records.lock();
    let rec = records.get_mut(key).ok_or(ErrorCode::BaselineMissing)?;

    if rec.original_failed {
        return Err(ErrorCode::OriginalUnavailable);
    }
    if rec.baseline_id.as_deref() != Some(&req.baseline_id)
        || rec.activation_nonce.as_deref() != Some(&req.activation_nonce)
        || rec.registration_id != req.registration_id
        || rec.activation_receipt_id.as_deref() != Some(&req.activation_receipt_id)
    {
        return Err(ErrorCode::InvalidRequest);
    }
    if let Some(prep_at) = rec.prepared_at {
        if prep_at.elapsed().as_millis() as u64 > rec.prepared_ttl_ms {
            rec.state = StatusState::Unavailable;
            rec.reason = Some(ErrorCode::RegistrationExpired);
            return Err(ErrorCode::RegistrationExpired);
        }
    }

    rec.acknowledgment = Acknowledgment::Received;
    rec.state = if let Some(cov) = &rec.baseline_coverage {
        if cov.state == CoverageState::Complete {
            StatusState::Ready
        } else {
            StatusState::Incomplete
        }
    } else {
        StatusState::Incomplete
    };

    Ok(ReceiptResponse {
        version: 1,
        accepted: true,
    })
}

pub fn fail_session_capture(
    service: &Arc<SessionChangesService>,
    key: &SessionChangesKey,
    req: &FailureRequest,
) -> Result<FailureResponse, ErrorCode> {
    if req.server_epoch.as_deref() != Some(&service.server_epoch) {
        return Err(ErrorCode::ServerRestarted);
    }
    let mut records = service.records.lock();
    if let Some(rec) = records.get_mut(key) {
        if rec.active_from_now.is_none() && rec.registration_id == req.registration_id {
            rec.original_failed = true;
            rec.state = StatusState::Unavailable;
            rec.reason = Some(ErrorCode::RegistrationFailed);
        }
    }

    Ok(FailureResponse {
        version: 1,
        accepted: true,
    })
}
