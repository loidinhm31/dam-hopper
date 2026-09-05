use crate::pty::fleet_state::{HandoffClaimError, PtyFleetState};
use std::fs;
use std::path::PathBuf;
use tempfile::tempdir;

use crate::config::{
    read_config, write_config, IdleSuspendCapabilitySelection, IdleSuspendConfig,
    DEFAULT_IDLE_SUSPEND_QUIET_PERIOD_SECONDS, DEFAULT_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
    MAX_IDLE_SUSPEND_QUIET_PERIOD_SECONDS, MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
    MIN_IDLE_SUSPEND_QUIET_PERIOD_SECONDS, MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
};
use crate::idle_suspend::audit::{HelperAudit, HelperAuditRecord, HelperAuditRecordType};
use crate::idle_suspend::backend::{FakeActionBackend, SuspendActionBackend, SystemdLogindBackend};
use crate::idle_suspend::executor::{
    FakeExecutor, IdleSuspendExecutor, SystemdIdleSuspendExecutor, UnavailableExecutor,
};
use crate::idle_suspend::helper_server::HelperServer;
use crate::idle_suspend::peer_auth::{EnrolledPeerPolicy, PeerAuthError, PeerCredentials};
use crate::idle_suspend::policy::{
    validate_timing_pair, RuntimeIdleSuspendTiming, StartupIdleSuspendPolicy,
};
use crate::idle_suspend::preflight::{
    ActiveInhibitor, FakeInhibitorProvider, FakePreflightChecker, PreflightChecker, PreflightError,
    SysfsPreflightChecker,
};
use crate::idle_suspend::protocol::{
    decode_frame, encode_frame, read_frame_async, validate_request_id, write_frame_async,
    HelperRequestFrame, HelperRequestPayload, HelperResponseFrame, HelperResponsePayload,
    IdleSuspendErrorCode, IdleSuspendTimingPatchRequest, IdleSuspendTimingPatchResponse,
    ProtocolError, RequestDeduplicator, SuspendOutcome, SuspendWithRtcWakeRequest,
    HELPER_PROTOCOL_VERSION, MAX_HELPER_FRAME_BYTES,
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
    assert!(validate_timing_pair(
        MIN_IDLE_SUSPEND_QUIET_PERIOD_SECONDS,
        MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS
    )
    .is_ok());
    assert!(validate_timing_pair(
        MAX_IDLE_SUSPEND_QUIET_PERIOD_SECONDS,
        MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS
    )
    .is_ok());

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
    assert_eq!(
        policy.canonical_registry_path,
        config_path.canonicalize().unwrap()
    );
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

    let unknown_field_json =
        r#"{"quietPeriodSeconds": 900, "wakeAfterSeconds": 600, "extra": "forbidden"}"#;
    let parsed_err: Result<IdleSuspendTimingPatchRequest, _> =
        serde_json::from_str(unknown_field_json);
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
use crate::idle_suspend::coordinator::{
    CoordinatorTimingResult, IdleSuspendCoordinator, UpdateTimingCommand,
};
use crate::idle_suspend::status::CoordinatorState;
use crate::pty::event_sink::NoopEventSink;
use crate::pty::manager::PtySessionManager;
use std::sync::Arc;
use tokio::sync::RwLock;

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
    let timing = Arc::new(RwLock::new(
        RuntimeIdleSuspendTiming::new(300, 600).unwrap(),
    ));
    let executor = Arc::new(FakeExecutor::new(true));
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));

    let coordinator =
        IdleSuspendCoordinator::start(policy, timing, None, None, executor, pty_manager);

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
    let coordinator =
        IdleSuspendCoordinator::start(policy, timing, None, None, executor, pty_manager.clone());

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
    let timing = Arc::new(RwLock::new(
        RuntimeIdleSuspendTiming::new(300, 600).unwrap(),
    ));
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
    let timing = Arc::new(RwLock::new(
        RuntimeIdleSuspendTiming::new(300, 600).unwrap(),
    ));
    let executor = Arc::new(FakeExecutor::new(true));
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));

    // Force handoff active on manager
    let gen = pty_manager.fleet_snapshot().generation;
    pty_manager.try_claim_handoff(gen).unwrap();

    let coordinator =
        IdleSuspendCoordinator::start(policy, timing, None, None, executor, pty_manager.clone());

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
    let timing = Arc::new(RwLock::new(
        RuntimeIdleSuspendTiming::new(300, 600).unwrap(),
    ));
    let executor = Arc::new(FakeExecutor::new(true));
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));

    let coordinator =
        IdleSuspendCoordinator::start(policy, timing, None, None, executor, pty_manager);

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

#[test]
fn test_helper_protocol_probe_roundtrip() {
    let frame = HelperRequestFrame::new_probe();
    assert!(frame.validate().is_ok());
    let encoded = encode_frame(&frame).unwrap();
    assert!(encoded.len() > 4);
    let decoded: HelperRequestFrame = decode_frame(&encoded).unwrap();
    assert_eq!(decoded.version, HELPER_PROTOCOL_VERSION);
    assert_eq!(decoded.payload, HelperRequestPayload::ProbeCapability);
}

#[test]
fn test_helper_protocol_suspend_roundtrip() {
    let req = SuspendWithRtcWakeRequest {
        request_id: "tx-epoch-42".to_string(),
        wake_after_seconds: 600,
    };
    let frame = HelperRequestFrame::new_suspend(req).unwrap();
    assert!(frame.validate().is_ok());
    let encoded = encode_frame(&frame).unwrap();
    let decoded: HelperRequestFrame = decode_frame(&encoded).unwrap();
    assert_eq!(decoded.version, HELPER_PROTOCOL_VERSION);
    match decoded.payload {
        HelperRequestPayload::SuspendWithRtcWake(r) => {
            assert_eq!(r.request_id, "tx-epoch-42");
            assert_eq!(r.wake_after_seconds, 600);
        }
        other => panic!("Unexpected payload: {other:?}"),
    }
}

#[test]
fn test_helper_protocol_response_roundtrip() {
    // Capability response
    let cap_frame = HelperResponseFrame::new(HelperResponsePayload::Capability {
        supported: true,
        detail: "logind+sysfs rtc0".to_string(),
    });
    let enc = encode_frame(&cap_frame).unwrap();
    let dec: HelperResponseFrame = decode_frame(&enc).unwrap();
    assert_eq!(dec.payload, cap_frame.payload);

    // Outcome response with inhibitor metadata
    let outcome_frame = HelperResponseFrame::new(HelperResponsePayload::SuspendOutcome(
        SuspendOutcome::BlockedByInhibitor {
            request_id: "req-1".to_string(),
            inhibitor: "backup.service (in-flight backup)".to_string(),
            who: Some("backup.service".to_string()),
            why: Some("in-flight backup".to_string()),
        },
    ));
    let enc = encode_frame(&outcome_frame).unwrap();
    let dec: HelperResponseFrame = decode_frame(&enc).unwrap();
    assert_eq!(dec.payload, outcome_frame.payload);
}

#[test]
fn test_helper_protocol_request_id_validation() {
    // Valid request IDs
    assert!(validate_request_id("epoch-1").is_ok());
    assert!(validate_request_id("req_123-abc").is_ok());
    assert!(validate_request_id("a".repeat(64).as_str()).is_ok());

    // Invalid: empty
    assert!(validate_request_id("").is_err());
    // Invalid: too long (> 64)
    assert!(validate_request_id("a".repeat(65).as_str()).is_err());
    // Invalid: spaces, slashes, control chars
    assert!(validate_request_id("has space").is_err());
    assert!(validate_request_id("path/traversal").is_err());
    assert!(validate_request_id("semi;colon").is_err());
    assert!(validate_request_id("newline\n").is_err());
}

#[test]
fn test_helper_protocol_wake_seconds_bounds() {
    let req_low = SuspendWithRtcWakeRequest {
        request_id: "valid".to_string(),
        wake_after_seconds: 59, // min is 60
    };
    assert!(HelperRequestFrame::new_suspend(req_low).is_err());

    let req_high = SuspendWithRtcWakeRequest {
        request_id: "valid".to_string(),
        wake_after_seconds: 86401, // max is 86400
    };
    assert!(HelperRequestFrame::new_suspend(req_high).is_err());
}

#[test]
fn test_helper_protocol_framing_errors() {
    // 1. Truncated header (< 4 bytes)
    let truncated_hdr = [0u8, 0, 1];
    match decode_frame::<HelperRequestFrame>(&truncated_hdr) {
        Err(ProtocolError::UnexpectedEofHeader) => {}
        other => panic!("Expected UnexpectedEofHeader, got: {other:?}"),
    }

    // 2. Empty frame (0 bytes length)
    let empty_frame = [0u8, 0, 0, 0];
    match decode_frame::<HelperRequestFrame>(&empty_frame) {
        Err(ProtocolError::EmptyFrame) => {}
        other => panic!("Expected EmptyFrame, got: {other:?}"),
    }

    // 3. Oversized frame length (> 4096 bytes)
    let oversized_len = (MAX_HELPER_FRAME_BYTES + 1) as u32;
    let mut oversized_hdr = oversized_len.to_be_bytes().to_vec();
    oversized_hdr.extend_from_slice(b"{}");
    match decode_frame::<HelperRequestFrame>(&oversized_hdr) {
        Err(ProtocolError::FrameTooLarge(len, max)) => {
            assert_eq!(len, MAX_HELPER_FRAME_BYTES + 1);
            assert_eq!(max, MAX_HELPER_FRAME_BYTES);
        }
        other => panic!("Expected FrameTooLarge, got: {other:?}"),
    }

    // 4. Truncated payload (header claims 50 bytes, only 10 provided)
    let mut truncated_payload = 50u32.to_be_bytes().to_vec();
    truncated_payload.extend_from_slice(b"short payload");
    match decode_frame::<HelperRequestFrame>(&truncated_payload) {
        Err(ProtocolError::UnexpectedEofPayload) => {}
        other => panic!("Expected UnexpectedEofPayload, got: {other:?}"),
    }

    // 5. Trailing data detected after frame
    let mut trailing_data = 2u32.to_be_bytes().to_vec();
    trailing_data.extend_from_slice(b"{}");
    trailing_data.extend_from_slice(b"extra_garbage");
    match decode_frame::<serde_json::Value>(&trailing_data) {
        Err(ProtocolError::TrailingData(extra)) => {
            assert_eq!(extra, 13);
        }
        other => panic!("Expected TrailingData, got: {other:?}"),
    }

    // 6. Malformed JSON payload
    let bad_json = b"not json at all!";
    let mut malformed_frame = (bad_json.len() as u32).to_be_bytes().to_vec();
    malformed_frame.extend_from_slice(bad_json);
    match decode_frame::<HelperRequestFrame>(&malformed_frame) {
        Err(ProtocolError::JsonError(_)) => {}
        other => panic!("Expected JsonError, got: {other:?}"),
    }

    // 7. Unknown fields (deny_unknown_fields)
    let unknown_field_json = br#"{"version":1,"payload":{"type":"probeCapability"},"timestampMs":123,"injectedField":"exploit"}"#;
    let mut unknown_frame = (unknown_field_json.len() as u32).to_be_bytes().to_vec();
    unknown_frame.extend_from_slice(unknown_field_json);
    match decode_frame::<HelperRequestFrame>(&unknown_frame) {
        Err(ProtocolError::JsonError(e)) => {
            assert!(e.to_string().contains("unknown field `injectedField`"));
        }
        other => panic!("Expected JsonError for unknown field, got: {other:?}"),
    }
}

#[tokio::test]
async fn test_helper_protocol_async_stream_io() {
    let (mut client, mut server) = tokio::io::duplex(1024);

    let req = HelperRequestFrame::new_probe();
    let client_task = tokio::spawn(async move {
        write_frame_async(&mut client, &req).await.unwrap();
        let resp: HelperResponseFrame = read_frame_async(&mut client).await.unwrap();
        resp
    });

    let server_task = tokio::spawn(async move {
        let received: HelperRequestFrame = read_frame_async(&mut server).await.unwrap();
        assert_eq!(received.payload, HelperRequestPayload::ProbeCapability);
        let resp = HelperResponseFrame::new(HelperResponsePayload::Capability {
            supported: true,
            detail: "test".to_string(),
        });
        write_frame_async(&mut server, &resp).await.unwrap();
    });

    let (resp, _) = tokio::join!(client_task, server_task);
    let resp = resp.unwrap();
    match resp.payload {
        HelperResponsePayload::Capability { supported, detail } => {
            assert!(supported);
            assert_eq!(detail, "test");
        }
        other => panic!("Unexpected response payload: {other:?}"),
    }
}

#[test]
fn test_helper_request_deduplication() {
    let mut dedup = RequestDeduplicator::new(3);
    assert!(dedup.check_and_record("req-1").is_ok());
    assert!(dedup.check_and_record("req-2").is_ok());
    assert!(dedup.check_and_record("req-3").is_ok());

    // Replay of existing ID is rejected
    match dedup.check_and_record("req-2") {
        Err(ProtocolError::DuplicateRequestId(id)) => assert_eq!(id, "req-2"),
        other => panic!("Expected DuplicateRequestId, got: {other:?}"),
    }

    // Adding a 4th evicts the oldest (req-1)
    assert!(dedup.check_and_record("req-4").is_ok());
    // req-1 is evicted so it can be re-added
    assert!(dedup.check_and_record("req-1").is_ok());
    // req-3 is still in set
    assert!(dedup.check_and_record("req-3").is_err());
}

#[test]
fn test_peer_credentials_and_policy_verification() {
    let policy = EnrolledPeerPolicy::new_exact(1000, 4321);

    // Valid credentials matching both UID and PID
    let valid_cred = PeerCredentials::new(4321, 1000, 1000);
    assert!(policy.verify_credentials(&valid_cred).is_ok());

    // UID mismatch
    let bad_uid = PeerCredentials::new(4321, 1001, 1001);
    match policy.verify_credentials(&bad_uid) {
        Err(PeerAuthError::UidMismatch { expected, actual }) => {
            assert_eq!(expected, 1000);
            assert_eq!(actual, 1001);
        }
        other => panic!("Expected UidMismatch, got: {other:?}"),
    }

    // PID mismatch (e.g. descendant process with same UID)
    let bad_pid = PeerCredentials::new(4322, 1000, 1000);
    match policy.verify_credentials(&bad_pid) {
        Err(PeerAuthError::PidMismatch { expected, actual }) => {
            assert_eq!(expected, 4321);
            assert_eq!(actual, 4322);
        }
        other => panic!("Expected PidMismatch, got: {other:?}"),
    }
}

#[test]
fn test_peer_policy_with_dynamic_pid_file() {
    let tmp = tempdir().unwrap();
    let pid_file = tmp.path().join("server.pid");
    fs::write(&pid_file, "9876\n").unwrap();

    let policy = EnrolledPeerPolicy::new_with_pid_file(1000, &pid_file);

    let cred = PeerCredentials::new(9876, 1000, 1000);
    assert!(policy.verify_credentials(&cred).is_ok());

    // If PID file changes
    fs::write(&pid_file, "9877\n").unwrap();
    assert!(policy.verify_credentials(&cred).is_err());
    let new_cred = PeerCredentials::new(9877, 1000, 1000);
    assert!(policy.verify_credentials(&new_cred).is_ok());

    // Invalid PID file content
    fs::write(&pid_file, "not_a_number").unwrap();
    match policy.verify_credentials(&new_cred) {
        Err(PeerAuthError::InvalidPidFile(_)) => {}
        other => panic!("Expected InvalidPidFile, got: {other:?}"),
    }

    // Missing PID file
    let missing_file = tmp.path().join("missing.pid");
    let missing_policy = EnrolledPeerPolicy::new_with_pid_file(1000, &missing_file);
    match missing_policy.verify_credentials(&new_cred) {
        Err(PeerAuthError::PidFileReadError(..)) => {}
        other => panic!("Expected PidFileReadError, got: {other:?}"),
    }
}

#[test]
fn test_preflight_checks_fake_and_sysfs() {
    // 1. Fake preflight passing
    let mut fake = FakePreflightChecker::new_passing();
    assert!(fake.run_all().is_ok());

    // 2. Suspend mode missing
    fake.suspend_ok = false;
    match fake.run_all() {
        Err(PreflightError::UnsupportedSuspend(msg)) => {
            assert!(msg.contains("suspend"));
        }
        other => panic!("Expected UnsupportedSuspend, got: {other:?}"),
    }
    fake.suspend_ok = true;

    // 3. RTC missing
    fake.rtc_ok = false;
    match fake.run_all() {
        Err(PreflightError::UnsupportedRtc(msg)) => {
            assert!(msg.contains("RTC"));
        }
        other => panic!("Expected UnsupportedRtc, got: {other:?}"),
    }
    fake.rtc_ok = true;

    // 4. Inhibitor active
    fake.active_inhibitor = Some(ActiveInhibitor::new(
        "backup-agent",
        "nightly backup running",
        "block",
    ));
    match fake.run_all() {
        Err(PreflightError::Inhibited(desc, who, why)) => {
            assert!(desc.contains("backup-agent"));
            assert_eq!(who.as_deref(), Some("backup-agent"));
            assert_eq!(why.as_deref(), Some("nightly backup running"));
        }
        other => panic!("Expected Inhibited, got: {other:?}"),
    }

    // 5. SysfsPreflightChecker with temporary files
    let tmp = tempdir().unwrap();
    let power_state = tmp.path().join("power_state");
    let rtc_alarm = tmp.path().join("wakealarm");

    fs::write(&power_state, "freeze mem disk\n").unwrap();
    fs::write(&rtc_alarm, "0\n").unwrap();

    let fake_inhibitor = Box::new(FakeInhibitorProvider {
        inhibitor: None,
        error: None,
    });
    let sysfs = SysfsPreflightChecker::with_paths(&power_state, &rtc_alarm, "mem", fake_inhibitor);
    assert!(sysfs.run_all().is_ok());

    // Mode mismatch in power_state
    fs::write(&power_state, "freeze standby\n").unwrap();
    let fake_inhibitor2 = Box::new(FakeInhibitorProvider {
        inhibitor: None,
        error: None,
    });
    let sysfs2 =
        SysfsPreflightChecker::with_paths(&power_state, &rtc_alarm, "mem", fake_inhibitor2);
    match sysfs2.run_all() {
        Err(PreflightError::UnsupportedSuspend(msg)) => {
            assert!(msg.contains("not in available modes"));
        }
        other => panic!("Expected UnsupportedSuspend, got: {other:?}"),
    }
}

#[test]
fn test_helper_audit_record_and_fail_closed() {
    let tmp = tempdir().unwrap();
    let audit_file = tmp.path().join("audit.jsonl");

    let audit = HelperAudit::new(&audit_file, 10);

    let intent = HelperAuditRecord::new_intent("tx-100", 600, 1234, 1000);
    assert!(audit.record(&intent).is_ok());

    let completion = HelperAuditRecord::new_completed(
        "tx-100",
        600,
        1234,
        1000,
        SuspendOutcome::ResumedSuccessfully {
            request_id: "tx-100".to_string(),
            elapsed_seconds: 598,
        },
    );
    assert!(audit.record(&completion).is_ok());

    let records = audit.read_all_records().unwrap();
    assert_eq!(records.len(), 2);
    assert_eq!(
        records[0].record_type,
        HelperAuditRecordType::AcceptedIntent
    );
    assert_eq!(records[0].request_id, "tx-100");
    assert_eq!(records[0].wake_after_seconds, Some(600));
    assert_eq!(records[0].peer_pid, 1234);
    assert_eq!(
        records[1].record_type,
        HelperAuditRecordType::ExecutionCompleted
    );

    // On Unix, verify file mode is 0600
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let meta = fs::metadata(&audit_file).unwrap();
        assert_eq!(meta.mode() & 0o777, 0o600);
    }

    // Fail-closed test on invalid directory path
    let bad_audit = HelperAudit::new("/nonexistent_forbidden_dir/audit.log", 10);
    let rec = HelperAuditRecord::new_intent("tx-fail", 600, 1, 0);
    assert!(bad_audit.record(&rec).is_err());
}

#[test]
fn test_helper_audit_bounded_pruning() {
    let tmp = tempdir().unwrap();
    let audit_file = tmp.path().join("prune_audit.jsonl");

    let audit = HelperAudit::new(&audit_file, 10);
    for i in 0..15 {
        let rec = HelperAuditRecord::new_intent(format!("tx-{i}"), 600, 1000 + i, 1000);
        audit.record(&rec).unwrap();
    }

    let records = audit.read_all_records().unwrap();
    // Max was 10, when exceeded it pruned to keep half (5) plus subsequent entries
    assert!(records.len() <= 10);
    // Ensure newest record is present
    assert_eq!(records.last().unwrap().request_id, "tx-14");
}

#[test]
fn test_action_backend_fake_and_sysfs() {
    // 1. FakeActionBackend
    let fake_backend = FakeActionBackend::with_elapsed(300);
    assert!(fake_backend.program_rtc_wake(600).is_ok());
    assert_eq!(*fake_backend.programmed_wake.lock().unwrap(), Some(600));
    let elapsed = fake_backend.trigger_suspend().unwrap();
    assert_eq!(elapsed, 300);
    assert!(*fake_backend.suspend_called.lock().unwrap());

    // Test simulated failures
    fake_backend.set_fail_rtc(Some("RTC busy".to_string()));
    assert!(fake_backend.program_rtc_wake(600).is_err());
    fake_backend.set_fail_rtc(None);

    fake_backend.set_fail_suspend(Some("logind permission denied".to_string()));
    assert!(fake_backend.trigger_suspend().is_err());

    // 2. SystemdLogindBackend RTC alarm write test with tempfile
    let tmp = tempdir().unwrap();
    let fake_wakealarm = tmp.path().join("fake_wakealarm");
    let fake_systemctl = tmp.path().join("fake_systemctl");

    let backend = SystemdLogindBackend::with_paths(&fake_wakealarm, &fake_systemctl);
    assert!(backend.program_rtc_wake(300).is_ok());

    let written_content = fs::read_to_string(&fake_wakealarm).unwrap();
    let written_epoch: u64 = written_content.trim().parse().unwrap();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    // Target should be approximately now + 300
    assert!(written_epoch >= now + 290 && written_epoch <= now + 310);
}

#[tokio::test]
async fn test_helper_server_client_ipc_success_and_audit() {
    let tmp = tempdir().unwrap();
    let socket_path = tmp.path().join("helper.sock");
    let audit_path = tmp.path().join("audit.jsonl");

    let policy = EnrolledPeerPolicy::new_test_permissive();
    let preflight = Arc::new(FakePreflightChecker::new_passing());
    let backend = Arc::new(FakeActionBackend::with_elapsed(590));
    let audit = Arc::new(HelperAudit::new(&audit_path, 100));
    let server = Arc::new(HelperServer::new(
        policy,
        preflight,
        backend,
        Arc::clone(&audit),
        100,
    ));

    let listener = tokio::net::UnixListener::bind(&socket_path).unwrap();
    let server_handle = {
        let server = Arc::clone(&server);
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let srv = Arc::clone(&server);
                tokio::spawn(async move {
                    let cred = PeerCredentials::new(std::process::id(), 1000, 1000);
                    let _ = srv.handle_connection(&mut stream, cred).await;
                });
            }
        })
    };

    let executor = SystemdIdleSuspendExecutor::new(&socket_path);

    // 1. Probe capability
    assert!(executor.check_capability().await);

    // 2. Execute suspend
    let req = SuspendWithRtcWakeRequest {
        request_id: "test-epoch-1".to_string(),
        wake_after_seconds: 600,
    };
    let outcome = executor.execute_suspend(req).await;
    match outcome {
        SuspendOutcome::ResumedSuccessfully {
            request_id,
            elapsed_seconds,
        } => {
            assert_eq!(request_id, "test-epoch-1");
            assert_eq!(elapsed_seconds, 590);
        }
        other => panic!("Expected ResumedSuccessfully, got: {other:?}"),
    }

    // 3. Verify audit log
    let records = audit.read_all_records().unwrap();
    assert_eq!(records.len(), 2);
    assert_eq!(
        records[0].record_type,
        HelperAuditRecordType::AcceptedIntent
    );
    assert_eq!(records[0].request_id, "test-epoch-1");
    assert_eq!(records[0].wake_after_seconds, Some(600));
    assert_eq!(
        records[1].record_type,
        HelperAuditRecordType::ExecutionCompleted
    );
    assert_eq!(records[1].request_id, "test-epoch-1");

    server_handle.abort();
}

#[tokio::test]
async fn test_helper_server_client_inhibitor_and_deduplication() {
    let tmp = tempdir().unwrap();
    let socket_path = tmp.path().join("helper2.sock");
    let audit_path = tmp.path().join("audit2.jsonl");

    let policy = EnrolledPeerPolicy::new_test_permissive();
    let mut preflight_inner = FakePreflightChecker::new_passing();
    preflight_inner.active_inhibitor = Some(ActiveInhibitor::new(
        "backup-svc",
        "system backup in progress",
        "block",
    ));
    let preflight = Arc::new(preflight_inner);
    let backend = Arc::new(FakeActionBackend::with_elapsed(300));
    let audit = Arc::new(HelperAudit::new(&audit_path, 100));
    let server = Arc::new(HelperServer::new(policy, preflight, backend, audit, 100));

    let listener = tokio::net::UnixListener::bind(&socket_path).unwrap();
    let server_handle = {
        let server = Arc::clone(&server);
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let srv = Arc::clone(&server);
                tokio::spawn(async move {
                    let cred = PeerCredentials::new(std::process::id(), 1000, 1000);
                    let _ = srv.handle_connection(&mut stream, cred).await;
                });
            }
        })
    };

    let executor = SystemdIdleSuspendExecutor::new(&socket_path);

    // Blocked by inhibitor
    let req = SuspendWithRtcWakeRequest {
        request_id: "test-inhibited".to_string(),
        wake_after_seconds: 300,
    };
    let outcome = executor.execute_suspend(req).await;
    match outcome {
        SuspendOutcome::BlockedByInhibitor {
            request_id,
            inhibitor,
            who,
            why,
        } => {
            assert_eq!(request_id, "test-inhibited");
            assert!(inhibitor.contains("backup-svc"));
            assert_eq!(who.as_deref(), Some("backup-svc"));
            assert_eq!(why.as_deref(), Some("system backup in progress"));
        }
        other => panic!("Expected BlockedByInhibitor, got: {other:?}"),
    }

    // Replaying same request ID yields duplicate rejection
    let req_duplicate = SuspendWithRtcWakeRequest {
        request_id: "test-inhibited".to_string(),
        wake_after_seconds: 300,
    };
    let outcome2 = executor.execute_suspend(req_duplicate).await;
    match outcome2 {
        SuspendOutcome::ExecutionFailed { error, .. } => {
            assert!(error.contains("duplicateRequestId") || error.contains("Duplicate"));
        }
        other => panic!("Expected ExecutionFailed with duplicate, got: {other:?}"),
    }

    server_handle.abort();
}

#[tokio::test]
async fn test_helper_server_peer_auth_rejection() {
    let tmp = tempdir().unwrap();
    let socket_path = tmp.path().join("helper3.sock");
    let audit_path = tmp.path().join("audit3.jsonl");

    // Require UID 2000 and PID 9999
    let policy = EnrolledPeerPolicy::new_exact(2000, 9999);
    let preflight = Arc::new(FakePreflightChecker::new_passing());
    let backend = Arc::new(FakeActionBackend::new());
    let audit = Arc::new(HelperAudit::new(&audit_path, 100));
    let server = Arc::new(HelperServer::new(
        policy,
        preflight,
        backend,
        Arc::clone(&audit),
        100,
    ));

    let listener = tokio::net::UnixListener::bind(&socket_path).unwrap();
    let server_handle = {
        let server = Arc::clone(&server);
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let srv = Arc::clone(&server);
                tokio::spawn(async move {
                    // Caller presents unauthorized UID 1000
                    let cred = PeerCredentials::new(1234, 1000, 1000);
                    let _ = srv.handle_connection(&mut stream, cred).await;
                });
            }
        })
    };

    let executor = SystemdIdleSuspendExecutor::new(&socket_path);
    // Capability probe fails closed
    assert!(!executor.check_capability().await);

    // Rejected audit was logged
    let records = audit.read_all_records().unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(
        records[0].record_type,
        HelperAuditRecordType::ExecutionRejected
    );

    server_handle.abort();
}

#[test]
fn test_manager_stale_incarnation_callback_rejected() {
    let (mut fleet, _watcher) = PtyFleetState::new();
    assert!(fleet.is_quiescent());

    // Session "session-1" begins creating with incarnation 1
    assert!(fleet.begin_create("session-1", 1).is_ok());
    assert!(!fleet.is_quiescent());
    assert_eq!(fleet.snapshot().creating_count, 1);

    // Stale completion with wrong incarnation 99 is ignored
    fleet.publish_live("session-1", 99);
    assert_eq!(fleet.snapshot().creating_count, 1);
    assert_eq!(fleet.snapshot().live_count, 0);

    // Correct completion with incarnation 1 publishes live
    fleet.publish_live("session-1", 1);
    assert_eq!(fleet.snapshot().creating_count, 0);
    assert_eq!(fleet.snapshot().live_count, 1);

    // Stale remove with incarnation 99 is ignored
    fleet.remove_live("session-1", 99);
    assert_eq!(fleet.snapshot().live_count, 1);

    // Correct remove with incarnation 1 removes live
    fleet.remove_live("session-1", 1);
    assert_eq!(fleet.snapshot().live_count, 0);
    assert!(fleet.is_quiescent());
}

#[test]
fn test_manager_restart_queue_backoff_quiescence_invariant() {
    let (mut fleet, watcher) = PtyFleetState::new();
    assert!(fleet.is_quiescent());

    // 1. Session begins creating and publishes live
    fleet.begin_create("restartable-1", 1).unwrap();
    fleet.publish_live("restartable-1", 1);
    assert!(!fleet.is_quiescent());
    assert_eq!(fleet.snapshot().live_count, 1);

    // 2. Session exits with restart policy -> transitions directly live -> restart_pending
    // Invariant: at no point does fleet emit a quiescent state during this transition!
    fleet.transition_live_to_restart_pending("restartable-1", 1);
    let snap = watcher.snapshot();
    assert_eq!(snap.live_count, 0);
    assert_eq!(snap.restart_pending_count, 1);
    assert!(
        !snap.is_quiescent(),
        "Must NOT be quiescent during restart backoff"
    );

    // 3. Supervisor triggers spawn -> transitions restart_pending -> creating
    assert!(fleet
        .transition_restart_pending_to_creating("restartable-1", 1, 2)
        .is_ok());
    let snap2 = watcher.snapshot();
    assert_eq!(snap2.restart_pending_count, 0);
    assert_eq!(snap2.creating_count, 1);
    assert!(!snap2.is_quiescent());

    // 4. Session becomes live under new incarnation 2
    fleet.publish_live("restartable-1", 2);
    assert_eq!(fleet.snapshot().live_count, 1);

    // 5. Final exit without restart
    fleet.remove_live("restartable-1", 2);
    assert!(fleet.is_quiescent());
}

#[test]
fn test_manager_disposal_and_shutdown_gates() {
    let (mut fleet, _watcher) = PtyFleetState::new();
    let gen = fleet.generation();

    // Normal handoff claim succeeds when quiescent
    let claim = fleet.try_claim_handoff(gen).unwrap();
    assert_eq!(claim.generation, gen + 1);
    assert!(fleet.snapshot().handoff_active);

    // Second claim rejected because handoff already active
    assert_eq!(
        fleet.try_claim_handoff(fleet.generation()),
        Err(HandoffClaimError::HandoffAlreadyActive)
    );

    // Release handoff
    fleet.release_handoff();
    assert!(!fleet.snapshot().handoff_active);

    // Generation mismatch rejected
    assert!(matches!(
        fleet.try_claim_handoff(9999),
        Err(HandoffClaimError::GenerationMismatch { .. })
    ));
}

#[tokio::test]
async fn test_helper_server_malformed_and_oversized_frame_rejection() {
    let tmp = tempdir().unwrap();
    let socket_path = tmp.path().join("helper_malformed.sock");
    let audit_path = tmp.path().join("audit_malformed.jsonl");

    let policy = EnrolledPeerPolicy::new_test_permissive();
    let preflight = Arc::new(FakePreflightChecker::new_passing());
    let backend = Arc::new(FakeActionBackend::new());
    let audit = Arc::new(HelperAudit::new(&audit_path, 100));
    let server = Arc::new(HelperServer::new(policy, preflight, backend, audit, 100));

    let listener = tokio::net::UnixListener::bind(&socket_path).unwrap();
    let server_handle = {
        let server = Arc::clone(&server);
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let srv = Arc::clone(&server);
                tokio::spawn(async move {
                    let cred = PeerCredentials::new(std::process::id(), 1000, 1000);
                    let _ = srv.handle_connection(&mut stream, cred).await;
                });
            }
        })
    };

    let mut stream = tokio::net::UnixStream::connect(&socket_path).await.unwrap();
    use tokio::io::AsyncWriteExt;
    let invalid_len = (MAX_HELPER_FRAME_BYTES as u32 + 1).to_be_bytes();
    stream.write_all(&invalid_len).await.unwrap();

    use tokio::io::AsyncReadExt;
    let mut buf = [0u8; 10];
    let n = stream.read(&mut buf).await.unwrap();
    assert_eq!(n, 0, "Server must close stream on oversized frame");

    server_handle.abort();
}

#[tokio::test]
async fn test_helper_server_audit_failure_fails_closed() {
    let tmp = tempdir().unwrap();
    let socket_path = tmp.path().join("helper_audit_fail.sock");
    let audit_path = PathBuf::from("/nonexistent_forbidden_dir/sub/audit.jsonl");

    let policy = EnrolledPeerPolicy::new_test_permissive();
    let preflight = Arc::new(FakePreflightChecker::new_passing());
    let backend = Arc::new(FakeActionBackend::new());
    let audit = Arc::new(HelperAudit::new(&audit_path, 100));
    let server = Arc::new(HelperServer::new(
        policy,
        preflight,
        Arc::clone(&backend),
        audit,
        100,
    ));

    let listener = tokio::net::UnixListener::bind(&socket_path).unwrap();
    let server_handle = {
        let server = Arc::clone(&server);
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let srv = Arc::clone(&server);
                tokio::spawn(async move {
                    let cred = PeerCredentials::new(std::process::id(), 1000, 1000);
                    let _ = srv.handle_connection(&mut stream, cred).await;
                });
            }
        })
    };

    let executor = SystemdIdleSuspendExecutor::new(&socket_path);
    let req = SuspendWithRtcWakeRequest {
        request_id: "test-audit-fail".to_string(),
        wake_after_seconds: 600,
    };

    let outcome = executor.execute_suspend(req).await;
    match outcome {
        SuspendOutcome::ExecutionFailed { error, .. } => {
            assert!(error.contains("audit") || error.contains("Audit"));
        }
        other => panic!("Expected ExecutionFailed due to audit failure, got: {other:?}"),
    }

    assert!(!*backend.suspend_called.lock().unwrap());

    server_handle.abort();
}

#[test]
fn test_timing_store_preserves_unrelated_toml_structure() {
    let dir = tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");

    let full_toml = r#"[workspace]
name = "complex-workspace"
root = "/tmp/test"

[server]
host = "127.0.0.1"
port = 4801

[server.idle_suspend]
enabled = true
quiet_period_seconds = 300
wake_after_seconds = 600

[[projects]]
name = "api-service"
path = "./api"
type = "cargo"

[features]
experimental = true
"#;
    fs::write(&config_path, full_toml).unwrap();

    let store = IdleSuspendTimingStore::new(config_path.clone());
    store.persist_timing_pair(450, 900).unwrap();

    let updated = fs::read_to_string(&config_path).unwrap();
    assert!(updated.contains("quiet_period_seconds = 450"));
    assert!(updated.contains("wake_after_seconds = 900"));
    assert!(updated.contains("[workspace]"));
    assert!(updated.contains("complex-workspace"));
    assert!(updated.contains("[[projects]]"));
    assert!(updated.contains("api-service"));
    assert!(updated.contains("[features]"));
    assert!(updated.contains("experimental = true"));
}
