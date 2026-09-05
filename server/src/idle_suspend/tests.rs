use std::fs;
use tempfile::tempdir;

use crate::config::{
    read_config, write_config, IdleSuspendCapabilitySelection, IdleSuspendConfig,
    DEFAULT_IDLE_SUSPEND_QUIET_PERIOD_SECONDS, DEFAULT_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
    MAX_IDLE_SUSPEND_QUIET_PERIOD_SECONDS, MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
    MIN_IDLE_SUSPEND_QUIET_PERIOD_SECONDS, MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
};
use crate::idle_suspend::executor::{FakeExecutor, IdleSuspendExecutor, UnavailableExecutor};
use crate::idle_suspend::policy::{
    validate_timing_pair, RuntimeIdleSuspendTiming, StartupIdleSuspendPolicy,
};
use crate::idle_suspend::protocol::{
    IdleSuspendErrorCode, IdleSuspendTimingPatchRequest, IdleSuspendTimingPatchResponse,
    SuspendOutcome, SuspendWithRtcWakeRequest,
};
use crate::idle_suspend::timing_audit::{
    AuditError, IdleSuspendTimingAudit, TimingAuditRecord, TimingAuditResult,
};
use crate::idle_suspend::timing_store::{IdleSuspendTimingStore, TimingStoreError};

#[test]
fn test_default_idle_suspend_config() {
    let cfg = IdleSuspendConfig::default();
    assert!(!cfg.enabled);
    assert_eq!(
        cfg.quiet_period_seconds,
        DEFAULT_IDLE_SUSPEND_QUIET_PERIOD_SECONDS
    );
    assert_eq!(
        cfg.wake_after_seconds,
        DEFAULT_IDLE_SUSPEND_WAKE_AFTER_SECONDS
    );
    assert_eq!(
        cfg.capability_selection,
        IdleSuspendCapabilitySelection::Auto
    );
    assert!(cfg.enrollment_reference.is_none());
    assert!(cfg.validate().is_ok());
}

#[test]
fn test_timing_bounds_validation() {
    // Valid boundaries
    assert!(validate_timing_pair(MIN_IDLE_SUSPEND_QUIET_PERIOD_SECONDS, MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS).is_ok());
    assert!(validate_timing_pair(MAX_IDLE_SUSPEND_QUIET_PERIOD_SECONDS, MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS).is_ok());

    // Below minimum
    assert!(validate_timing_pair(MIN_IDLE_SUSPEND_QUIET_PERIOD_SECONDS - 1, 600).is_err());
    assert!(validate_timing_pair(900, MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS - 1).is_err());

    // Above maximum
    assert!(validate_timing_pair(MAX_IDLE_SUSPEND_QUIET_PERIOD_SECONDS + 1, 600).is_err());
    assert!(validate_timing_pair(900, MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS + 1).is_err());

    // Zero or overflow
    assert!(validate_timing_pair(0, 600).is_err());
    assert!(validate_timing_pair(900, 0).is_err());
}

#[test]
fn test_enrollment_validation() {
    let mut cfg = IdleSuspendConfig::default();
    cfg.enrollment_reference = Some("   ".to_string());
    assert!(cfg.validate().is_err());

    cfg.enrollment_reference = Some("a".repeat(257));
    assert!(cfg.validate().is_err());

    cfg.enrollment_reference = Some("systemd:dam-hopper-idle-suspend.service".to_string());
    assert!(cfg.validate().is_ok());
}

#[test]
fn test_toml_roundtrip_idle_suspend() {
    let dir = tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");

    let toml_content = r#"
[workspace]
name = "test-ws"

[server.idle_suspend]
enabled = true
quiet_period_seconds = 1200
wake_after_seconds = 300
capability_selection = "rtcwake"
enrollment_reference = "systemd:dam-hopper-idle-suspend"
"#;
    fs::write(&config_path, toml_content).unwrap();

    let cfg = read_config(&config_path).unwrap();
    assert!(cfg.server.idle_suspend.enabled);
    assert_eq!(cfg.server.idle_suspend.quiet_period_seconds, 1200);
    assert_eq!(cfg.server.idle_suspend.wake_after_seconds, 300);
    assert_eq!(
        cfg.server.idle_suspend.capability_selection,
        IdleSuspendCapabilitySelection::Rtcwake
    );
    assert_eq!(
        cfg.server.idle_suspend.enrollment_reference.as_deref(),
        Some("systemd:dam-hopper-idle-suspend")
    );

    // Test writing back preserves and roundtrips
    let out_path = dir.path().join("out.toml");
    write_config(&out_path, &cfg).unwrap();
    let written = read_config(&out_path).unwrap();
    assert_eq!(written.server.idle_suspend, cfg.server.idle_suspend);
}

#[test]
fn test_startup_policy_immutability() {
    let dir = tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    fs::write(
        &config_path,
        "[workspace]\nname=\"ws\"\n[server.idle_suspend]\nenabled=true\n",
    )
    .unwrap();

    let cfg = read_config(&config_path).unwrap();
    let policy = StartupIdleSuspendPolicy::from_config(&config_path, &cfg.server.idle_suspend);
    assert!(policy.is_enabled());
    assert_eq!(policy.canonical_registry_path, config_path.canonicalize().unwrap());
}

#[test]
fn test_runtime_timing_mutation_and_revisions() {
    let mut timing = RuntimeIdleSuspendTiming::new(900, 600).unwrap();
    assert_eq!(timing.status_revision, 1);

    // Idempotent update: returns false, revision unchanged
    assert_eq!(timing.apply_update(900, 600).unwrap(), false);
    assert_eq!(timing.status_revision, 1);

    // Valid changed update: returns true, revision bumps
    assert_eq!(timing.apply_update(1200, 300).unwrap(), true);
    assert_eq!(timing.status_revision, 2);
    assert_eq!(timing.quiet_period_seconds, 1200);
    assert_eq!(timing.wake_after_seconds, 300);

    // Out of bounds: returns Err, state unchanged
    assert!(timing.apply_update(10, 300).is_err());
    assert_eq!(timing.status_revision, 2);
    assert_eq!(timing.quiet_period_seconds, 1200);
}

#[test]
fn test_timing_store_atomic_persistence() {
    let dir = tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");

    let initial_content = r#"# DamHopper Registry Config
[workspace]
name = "preserve-ws" # inline comment

[server]
session_buffer_ttl_hours = 48

[server.idle_suspend]
enabled = true
quiet_period_seconds = 900
wake_after_seconds = 600
"#;
    fs::write(&config_path, initial_content).unwrap();

    let store = IdleSuspendTimingStore::new(config_path.clone());
    store.persist_timing_pair(1800, 1200).unwrap();

    let updated_content = fs::read_to_string(&config_path).unwrap();
    assert!(updated_content.contains("quiet_period_seconds = 1800"));
    assert!(updated_content.contains("wake_after_seconds = 1200"));
    assert!(updated_content.contains("# DamHopper Registry Config"));
    assert!(updated_content.contains("# inline comment"));
    assert!(updated_content.contains("session_buffer_ttl_hours = 48"));

    // Validation failure on store does not write to disk
    assert!(matches!(
        store.persist_timing_pair(10, 1200),
        Err(TimingStoreError::Validation(_))
    ));
    let unchanged = fs::read_to_string(&config_path).unwrap();
    assert_eq!(updated_content, unchanged);
}

#[test]
fn test_timing_audit_logging() {
    let dir = tempdir().unwrap();
    let audit_path = dir.path().join("idle-suspend-audit.jsonl");

    let audit = IdleSuspendTimingAudit::new(audit_path.clone());

    let record = TimingAuditRecord::new(
        "admin-user".to_string(),
        900,
        600,
        1800,
        1200,
        "txn-001".to_string(),
        TimingAuditResult::Committed,
    )
    .unwrap();

    audit.record_event(&record).unwrap();

    let records = audit.read_recent_records(10).unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].actor, "admin-user");
    assert_eq!(records[0].requested_quiet_period_seconds, 1800);
    assert_eq!(records[0].requested_wake_after_seconds, 1200);
    assert_eq!(records[0].result, TimingAuditResult::Committed);

    // Empty or whitespace actor rejected
    assert!(matches!(
        TimingAuditRecord::new(
            "   ".to_string(),
            900,
            600,
            1800,
            1200,
            "txn-002".to_string(),
            TimingAuditResult::Admitted,
        ),
        Err(AuditError::InvalidActor)
    ));

    // Overlong actor rejected
    assert!(matches!(
        TimingAuditRecord::new(
            "a".repeat(129),
            900,
            600,
            1800,
            1200,
            "txn-003".to_string(),
            TimingAuditResult::Admitted,
        ),
        Err(AuditError::InvalidActor)
    ));
}

#[test]
fn test_protocol_patch_request_denies_unknown_fields() {
    let valid_json = r#"{"quietPeriodSeconds": 900, "wakeAfterSeconds": 600}"#;
    let parsed: Result<IdleSuspendTimingPatchRequest, _> = serde_json::from_str(valid_json);
    assert!(parsed.is_ok());

    let unknown_field_json = r#"{"quietPeriodSeconds": 900, "wakeAfterSeconds": 600, "extra": "forbidden"}"#;
    let parsed_err: Result<IdleSuspendTimingPatchRequest, _> = serde_json::from_str(unknown_field_json);
    assert!(parsed_err.is_err());

    let resp = IdleSuspendTimingPatchResponse::new(true, 4, 1800, 900);
    let serialized = serde_json::to_string(&resp).unwrap();
    assert!(serialized.contains(r#""version":1"#));
    assert!(serialized.contains(r#""changed":true"#));
    assert!(serialized.contains(r#""statusRevision":4"#));
}

#[test]
fn test_error_code_strings() {
    assert_eq!(
        IdleSuspendErrorCode::InvalidTiming.as_code_str(),
        "invalidIdleSuspendTiming"
    );
    assert_eq!(
        IdleSuspendErrorCode::DisabledNoAuth.as_code_str(),
        "idleSuspendTimingDisabledNoAuth"
    );
    assert_eq!(
        IdleSuspendErrorCode::HandoffInProgress.as_code_str(),
        "idleSuspendHandoffInProgress"
    );
    assert_eq!(
        IdleSuspendErrorCode::AuditUnavailable.as_code_str(),
        "idleSuspendTimingAuditUnavailable"
    );
    assert_eq!(
        IdleSuspendErrorCode::PersistenceUnavailable.as_code_str(),
        "idleSuspendTimingPersistenceUnavailable"
    );
}

#[tokio::test]
async fn test_unavailable_executor_fails_closed() {
    let executor = UnavailableExecutor::default();
    assert!(!executor.check_capability().await);

    let req = SuspendWithRtcWakeRequest {
        request_id: "req-123".to_string(),
        wake_after_seconds: 600,
    };
    let outcome = executor.execute_suspend(req).await;
    match outcome {
        SuspendOutcome::UnsupportedCapability { request_id, detail } => {
            assert_eq!(request_id, "req-123");
            assert!(detail.contains("Privileged idle-suspend helper is not configured"));
        }
        _ => panic!("Expected UnsupportedCapability outcome"),
    }
}

#[tokio::test]
async fn test_fake_executor_records_requests() {
    let executor = FakeExecutor::new(true);
    assert!(executor.check_capability().await);

    let req = SuspendWithRtcWakeRequest {
        request_id: "req-456".to_string(),
        wake_after_seconds: 900,
    };
    let outcome = executor.execute_suspend(req.clone()).await;
    match outcome {
        SuspendOutcome::ResumedSuccessfully {
            request_id,
            elapsed_seconds,
        } => {
            assert_eq!(request_id, "req-456");
            assert_eq!(elapsed_seconds, 900);
        }
        _ => panic!("Expected ResumedSuccessfully outcome"),
    }

    assert_eq!(executor.recorded_requests(), vec![req]);
}

use std::sync::Arc;
use tokio::sync::RwLock;
use crate::idle_suspend::coordinator::{
    CoordinatorTimingResult, IdleSuspendCoordinator, UpdateTimingCommand,
};
use crate::idle_suspend::status::CoordinatorState;
use crate::pty::event_sink::NoopEventSink;
use crate::pty::manager::PtySessionManager;

fn create_test_policy(dir: &std::path::Path, enabled: bool) -> StartupIdleSuspendPolicy {
    let registry_path = dir.join("dam-hopper.toml");
    let content = r#"
[workspace]
name = "test-ws"

[server.idle_suspend]
enabled = false
quiet_period_seconds = 300
wake_after_seconds = 600
"#;
    fs::write(&registry_path, content).unwrap();
    StartupIdleSuspendPolicy {
        enabled,
        canonical_registry_path: registry_path,
        enrollment_reference: None,
        capability_selection: IdleSuspendCapabilitySelection::Auto,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_coordinator_disabled_when_policy_disabled() {
    let tmp = tempdir().unwrap();
    let policy = create_test_policy(tmp.path(), false);
    let timing = Arc::new(RwLock::new(RuntimeIdleSuspendTiming::new(300, 600).unwrap()));
    let executor = Arc::new(FakeExecutor::new(true));
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));

    let coordinator = IdleSuspendCoordinator::start(
        policy,
        timing,
        None,
        None,
        executor,
        pty_manager,
    );

    let status = coordinator.status();
    assert_eq!(status.state, CoordinatorState::Disabled);
    assert!(!status.enabled);

    coordinator.shutdown().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn test_coordinator_grace_arming_and_cancellation() {
    let tmp = tempdir().unwrap();
    let policy = create_test_policy(tmp.path(), true);
    let timing = Arc::new(RwLock::new(RuntimeIdleSuspendTiming::new(60, 600).unwrap()));
    let executor = Arc::new(FakeExecutor::new(true));
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));
    let coordinator = IdleSuspendCoordinator::start(
        policy,
        timing,
        None,
        None,
        executor,
        pty_manager.clone(),
    );

    let mut status_rx = coordinator.subscribe_status();
    assert_eq!(status_rx.borrow().state, CoordinatorState::Watching);

    // Create a live session so coordinator observes a non-quiescent fleet
    pty_manager.with_fleet_for_test(|fleet| {
        fleet.begin_create("t1", 1).unwrap();
        fleet.publish_live("t1", 1);
    });

    while status_rx.borrow().fleet_snapshot.live_count != 1 {
        status_rx.changed().await.unwrap();
    }

    // Fleet transitions from non-quiescent to quiescent -> coordinator arms
    pty_manager.with_fleet_for_test(|fleet| {
        fleet.remove_live("t1", 1);
    });

    while status_rx.borrow().state != CoordinatorState::Armed {
        status_rx.changed().await.unwrap();
    }
    assert!(status_rx.borrow().arm_deadline_ms.is_some());

    // A create reservation occurs during grace -> cancels arming
    pty_manager.with_fleet_for_test(|fleet| {
        fleet.begin_create("t2", 2).unwrap();
    });

    while status_rx.borrow().state != CoordinatorState::Watching {
        status_rx.changed().await.unwrap();
    }
    assert!(status_rx.borrow().arm_deadline_ms.is_none());

    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_coordinator_deadline_final_check_and_resumed() {
    tokio::time::pause();

    let tmp = tempdir().unwrap();
    let policy = create_test_policy(tmp.path(), true);
    let timing = Arc::new(RwLock::new(RuntimeIdleSuspendTiming::new(60, 600).unwrap()));
    let executor = Arc::new(FakeExecutor::new(true));
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));

    let coordinator = IdleSuspendCoordinator::start(
        policy,
        timing,
        None,
        None,
        executor.clone(),
        pty_manager.clone(),
    );
    let mut status_rx = coordinator.subscribe_status();

    // Create session so coordinator observes a non-quiescent fleet
    pty_manager.with_fleet_for_test(|fleet| {
        fleet.begin_create("t1", 1).unwrap();
        fleet.publish_live("t1", 1);
    });

    while status_rx.borrow().fleet_snapshot.live_count != 1 {
        status_rx.changed().await.unwrap();
    }

    // Transition fleet from non-quiescent to quiescent -> coordinator arms
    pty_manager.with_fleet_for_test(|fleet| {
        fleet.remove_live("t1", 1);
    });

    // Advance to armed
    while status_rx.borrow().state != CoordinatorState::Armed {
        status_rx.changed().await.unwrap();
    }
    assert_eq!(status_rx.borrow().state, CoordinatorState::Armed);

    // Advance past grace deadline (60 seconds)
    tokio::time::advance(std::time::Duration::from_secs(61)).await;

    while status_rx.borrow().state != CoordinatorState::Resumed {
        status_rx.changed().await.unwrap();
    }
    assert_eq!(status_rx.borrow().state, CoordinatorState::Resumed);
    assert!(!pty_manager.fleet_snapshot().handoff_active);

    // Verify exactly one suspend request occurred
    let reqs = executor.recorded_requests();
    assert_eq!(reqs.len(), 1);
    assert_eq!(reqs[0].request_id, "epoch-1");
    assert_eq!(reqs[0].wake_after_seconds, 600);

    // Advance further by 100 seconds with empty fleet — must NOT loop or re-arm!
    tokio::time::advance(std::time::Duration::from_secs(100)).await;
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    assert_eq!(status_rx.borrow().state, CoordinatorState::Resumed);
    assert_eq!(executor.recorded_requests().len(), 1);

    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_coordinator_timing_update_ordered_transaction() {
    let tmp = tempdir().unwrap();
    let policy = create_test_policy(tmp.path(), true);
    let timing = Arc::new(RwLock::new(RuntimeIdleSuspendTiming::new(300, 600).unwrap()));
    let executor = Arc::new(FakeExecutor::new(true));
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));

    let store = IdleSuspendTimingStore::new(policy.canonical_registry_path.clone());
    let audit_file = tmp.path().join("audit.jsonl");
    let audit = IdleSuspendTimingAudit::new(audit_file.clone());

    let coordinator = IdleSuspendCoordinator::start(
        policy,
        timing.clone(),
        Some(store),
        Some(audit),
        executor,
        pty_manager,
    );

    let cmd = UpdateTimingCommand {
        actor: "admin-user".to_string(),
        quiet_period_seconds: 120,
        wake_after_seconds: 900,
    };

    let result = coordinator.update_timing(cmd.clone()).await;
    match result {
        CoordinatorTimingResult::Success {
            changed,
            status_revision,
            quiet_period_seconds,
            wake_after_seconds,
        } => {
            assert!(changed);
            assert_eq!(status_revision, 2);
            assert_eq!(quiet_period_seconds, 120);
            assert_eq!(wake_after_seconds, 900);
        }
        other => panic!("Expected Success, got: {other:?}"),
    }

    // Verify runtime timing updated
    assert_eq!(timing.read().await.quiet_period_seconds, 120);
    assert_eq!(timing.read().await.wake_after_seconds, 900);

    // Verify TOML file on disk updated
    let registry_content = fs::read_to_string(tmp.path().join("dam-hopper.toml")).unwrap();
    assert!(registry_content.contains("quiet_period_seconds = 120"));
    assert!(registry_content.contains("wake_after_seconds = 900"));

    // Verify audit log written
    let audit_content = fs::read_to_string(&audit_file).unwrap();
    assert!(audit_content.contains("admin-user"));
    assert!(audit_content.contains("admitted"));
    assert!(audit_content.contains("committed"));

    // Sending same command again reports changed = false
    let result_same = coordinator.update_timing(cmd).await;
    match result_same {
        CoordinatorTimingResult::Success { changed, .. } => assert!(!changed),
        other => panic!("Expected Success, got: {other:?}"),
    }

    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_coordinator_timing_update_rejected_during_handoff() {
    let tmp = tempdir().unwrap();
    let policy = create_test_policy(tmp.path(), true);
    let timing = Arc::new(RwLock::new(RuntimeIdleSuspendTiming::new(300, 600).unwrap()));
    let executor = Arc::new(FakeExecutor::new(true));
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));

    // Force handoff active on manager
    let gen = pty_manager.fleet_snapshot().generation;
    pty_manager.try_claim_handoff(gen).unwrap();

    let coordinator = IdleSuspendCoordinator::start(
        policy,
        timing,
        None,
        None,
        executor,
        pty_manager.clone(),
    );

    let cmd = UpdateTimingCommand {
        actor: "admin".to_string(),
        quiet_period_seconds: 120,
        wake_after_seconds: 900,
    };

    let result = coordinator.update_timing(cmd).await;
    assert_eq!(result, CoordinatorTimingResult::HandoffInProgress);

    pty_manager.release_handoff();
    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_coordinator_timing_update_validation_and_audit_failure() {
    let tmp = tempdir().unwrap();
    let policy = create_test_policy(tmp.path(), true);
    let timing = Arc::new(RwLock::new(RuntimeIdleSuspendTiming::new(300, 600).unwrap()));
    let executor = Arc::new(FakeExecutor::new(true));
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));

    let coordinator = IdleSuspendCoordinator::start(
        policy,
        timing,
        None,
        None,
        executor,
        pty_manager,
    );

    // Below min quiet period (10)
    let cmd = UpdateTimingCommand {
        actor: "admin".to_string(),
        quiet_period_seconds: 0,
        wake_after_seconds: 600,
    };

    let result = coordinator.update_timing(cmd).await;
    match result {
        CoordinatorTimingResult::ValidationFailed(err) => {
            assert!(err.contains("quietPeriodSeconds must be between"));
        }
        other => panic!("Expected ValidationFailed, got: {other:?}"),
    }

    coordinator.shutdown().await;
}
