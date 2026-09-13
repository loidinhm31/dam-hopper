use crate::pty::fleet_state::{HandoffClaimError, PtyFleetState};
use std::fs::{self, OpenOptions};
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use tempfile::tempdir;

fn preprovisioned_server_audit(path: PathBuf) -> IdleSuspendServerAudit {
    OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(&path)
        .unwrap();
    IdleSuspendServerAudit::new(path)
}

use crate::config::{
    read_config, write_config, IdleSuspendCapabilitySelection, IdleSuspendConfig,
    DEFAULT_IDLE_SUSPEND_QUIET_PERIOD_SECONDS, DEFAULT_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
    MAX_IDLE_SUSPEND_QUIET_PERIOD_SECONDS, MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
    MIN_IDLE_SUSPEND_QUIET_PERIOD_SECONDS, MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
};
use crate::idle_suspend::audit::{HelperAudit, HelperAuditRecord, HelperAuditRecordType};
use crate::idle_suspend::backend::{FakeActionBackend, SuspendActionBackend, SystemdLogindBackend};
use crate::idle_suspend::executor::{
    BoxFuture, FakeExecutor, IdleSuspendExecutor, SystemdIdleSuspendExecutor, UnavailableExecutor,
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
    decode_frame, encode_frame, read_frame_async, validate_request_id,
    validate_suspend_wake_seconds, write_frame_async, HelperRequestFrame,
    HelperRequestPayload, HelperResponseFrame, HelperResponsePayload, IdleSuspendErrorCode,
    IdleSuspendTimingPatchRequest, IdleSuspendTimingPatchResponse, ProtocolError,
    RequestDeduplicator, SuspendOutcome, SuspendWithRtcWakeRequest, HELPER_PROTOCOL_VERSION,
    MAX_HELPER_FRAME_BYTES,
};
use crate::idle_suspend::server_audit::{
    AuditError, IdleSuspendServerAudit, ManualAuditResult, TimingAuditRecord, TimingAuditResult,
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
    assert_eq!(
        cfg.automatic_policy,
        crate::config::IdleSuspendAutomaticPolicy::EmptyFleet
    );
    assert_eq!(
        cfg.agent_executables,
        crate::config::default_idle_suspend_agent_executables()
    );
    assert!(cfg.enrollment_reference.is_none());
    assert!(cfg.validate().is_ok());
}

#[test]
fn test_idle_suspend_automatic_policy_serialization_and_defaults() {
    use crate::config::IdleSuspendAutomaticPolicy;

    // Direct JSON serialization/deserialization
    let empty_fleet_json = serde_json::to_string(&IdleSuspendAutomaticPolicy::EmptyFleet).unwrap();
    assert_eq!(empty_fleet_json, "\"empty-fleet\"");
    let parsed_empty: IdleSuspendAutomaticPolicy = serde_json::from_str("\"empty-fleet\"").unwrap();
    assert_eq!(parsed_empty, IdleSuspendAutomaticPolicy::EmptyFleet);

    let agent_activity_json = serde_json::to_string(&IdleSuspendAutomaticPolicy::AgentActivity).unwrap();
    assert_eq!(agent_activity_json, "\"agent-activity\"");
    let parsed_activity: IdleSuspendAutomaticPolicy = serde_json::from_str("\"agent-activity\"").unwrap();
    assert_eq!(parsed_activity, IdleSuspendAutomaticPolicy::AgentActivity);

    // Default as_str representation
    assert_eq!(IdleSuspendAutomaticPolicy::EmptyFleet.as_str(), "empty-fleet");
    assert_eq!(IdleSuspendAutomaticPolicy::AgentActivity.as_str(), "agent-activity");

    // Deserializing IdleSuspendConfig with camelCase JSON
    let json = r#"{
        "automaticPolicy": "agent-activity",
        "agentExecutables": ["codex", "omp", "claude"]
    }"#;
    let cfg: IdleSuspendConfig = serde_json::from_str(json).unwrap();
    assert_eq!(cfg.automatic_policy, IdleSuspendAutomaticPolicy::AgentActivity);
    assert_eq!(cfg.agent_executables, vec!["codex", "omp", "claude"]);

    // Deserializing with snake_case aliases (as from TOML or legacy)
    let json_snake = r#"{
        "automatic_policy": "agent-activity",
        "agent_executables": ["codex", "agy"]
    }"#;
    let cfg_snake: IdleSuspendConfig = serde_json::from_str(json_snake).unwrap();
    assert_eq!(cfg_snake.automatic_policy, IdleSuspendAutomaticPolicy::AgentActivity);
    assert_eq!(cfg_snake.agent_executables, vec!["codex", "agy"]);

    // Omitted fields resolve to defaults
    let json_empty = "{}";
    let cfg_default: IdleSuspendConfig = serde_json::from_str(json_empty).unwrap();
    assert_eq!(cfg_default.automatic_policy, IdleSuspendAutomaticPolicy::EmptyFleet);
    assert_eq!(cfg_default.agent_executables, crate::config::default_idle_suspend_agent_executables());
}

#[test]
fn test_agent_executables_validation() {
    use crate::config::{validate_agent_executables, validate_agent_executable_entry};

    // Valid basenames
    assert!(validate_agent_executable_entry("codex").is_ok());
    assert!(validate_agent_executable_entry("omp").is_ok());
    assert!(validate_agent_executable_entry("claude").is_ok());
    assert!(validate_agent_executable_entry("agy").is_ok());
    assert!(validate_agent_executable_entry("my-agent_v1.0+beta@dev").is_ok());

    // Valid absolute paths
    assert!(validate_agent_executable_entry("/usr/local/bin/codex").is_ok());
    assert!(validate_agent_executable_entry("/opt/agents/bin/claude").is_ok());

    // Generic interpreter basenames rejected (both basename and in absolute path)
    let generic_interpreters = [
        "node", "nodejs", "bun", "python", "python3", "python3.11", "python3.12",
        "python2", "python2.7", "sh", "bash", "dash", "zsh", "ksh", "fish",
    ];
    for interp in generic_interpreters {
        assert!(validate_agent_executable_entry(interp).is_err(), "should reject generic interpreter basename '{interp}'");
        let abs_path = format!("/usr/bin/{interp}");
        assert!(validate_agent_executable_entry(&abs_path).is_err(), "should reject generic interpreter in absolute path '{abs_path}'");
    }

    // Relative slash-containing paths rejected
    assert!(validate_agent_executable_entry("bin/codex").is_err());
    assert!(validate_agent_executable_entry("./codex").is_err());
    assert!(validate_agent_executable_entry("../codex").is_err());

    // Invalid path formatting: trailing slash, repeated slashes, root alone
    assert!(validate_agent_executable_entry("/").is_err());
    assert!(validate_agent_executable_entry("/usr/bin/").is_err());
    assert!(validate_agent_executable_entry("/usr//bin/codex").is_err());

    // Invalid components: '.' or '..'
    assert!(validate_agent_executable_entry(".").is_err());
    assert!(validate_agent_executable_entry("..").is_err());
    assert!(validate_agent_executable_entry("/usr/./bin/codex").is_err());
    assert!(validate_agent_executable_entry("/usr/../bin/codex").is_err());

    // Invalid characters: spaces, shell/glob/regex syntax
    assert!(validate_agent_executable_entry("codex*").is_err());
    assert!(validate_agent_executable_entry("codex?").is_err());
    assert!(validate_agent_executable_entry("agent [1]").is_err());
    assert!(validate_agent_executable_entry("agent 1").is_err());
    assert!(validate_agent_executable_entry("agent$").is_err());
    assert!(validate_agent_executable_entry("agent`").is_err());
    assert!(validate_agent_executable_entry("agent\0").is_err());
    assert!(validate_agent_executable_entry("agent\n").is_err());

    // Empty string rejected
    assert!(validate_agent_executable_entry("").is_err());

    // Oversized entry rejected (> 256 bytes)
    let long_entry = "a".repeat(257);
    assert!(validate_agent_executable_entry(&long_entry).is_err());
    let valid_256 = "a".repeat(256);
    assert!(validate_agent_executable_entry(&valid_256).is_ok());

    // List validation: 1..=32 entries
    assert!(validate_agent_executables(&[]).is_err());
    let entries_32: Vec<String> = (0..32).map(|i| format!("agent-{i}")).collect();
    assert!(validate_agent_executables(&entries_32).is_ok());
    let entries_33: Vec<String> = (0..33).map(|i| format!("agent-{i}")).collect();
    assert!(validate_agent_executables(&entries_33).is_err());

    // Duplicate detection
    assert!(validate_agent_executables(&["codex".into(), "codex".into()]).is_err());
    assert!(validate_agent_executables(&["codex".into(), "omp".into(), "codex".into()]).is_err());

    // Full config validate() catches invalid executables even when disabled
    let mut cfg = IdleSuspendConfig::default();
    cfg.enabled = false;
    cfg.agent_executables = vec!["node".to_string()];
    assert!(cfg.validate().is_err());
}

#[test]
fn test_toml_roundtrip_agent_activity_policy_and_custom_executables() {
    use crate::config::IdleSuspendAutomaticPolicy;

    let dir = tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");

    let toml_content = r#"
[workspace]
name = "test-agent-activity-ws"

[server.idle_suspend]
enabled = false
quiet_period_seconds = 900
wake_after_seconds = 600
automatic_policy = "agent-activity"
agent_executables = ["codex", "/opt/bin/my-claude-wrapper"]
"#;
    fs::write(&config_path, toml_content).unwrap();

    let cfg = read_config(&config_path).unwrap();
    assert!(!cfg.server.idle_suspend.enabled);
    assert_eq!(
        cfg.server.idle_suspend.automatic_policy,
        IdleSuspendAutomaticPolicy::AgentActivity
    );
    assert_eq!(
        cfg.server.idle_suspend.agent_executables,
        vec!["codex", "/opt/bin/my-claude-wrapper"]
    );

    // Test writing back preserves and roundtrips
    let out_path = dir.path().join("out.toml");
    write_config(&out_path, &cfg).unwrap();
    let written = read_config(&out_path).unwrap();
    assert_eq!(written.server.idle_suspend, cfg.server.idle_suspend);

    // Check StartupIdleSuspendPolicy captures the agent activity policy and compiled set
    let policy = StartupIdleSuspendPolicy::from_config(&out_path, &written.server.idle_suspend);
    assert_eq!(policy.automatic_policy(), IdleSuspendAutomaticPolicy::AgentActivity);
    assert!(policy.is_agent_activity_policy());
    assert_eq!(policy.agent_executables().len(), 2);
    assert_eq!(
        policy.agent_executables().raw(),
        &["codex".to_string(), "/opt/bin/my-claude-wrapper".to_string()]
    );
    assert_eq!(
        policy.agent_executables().entries(),
        &[
            crate::idle_suspend::AgentExecutableEntry::Basename("codex".to_string()),
            crate::idle_suspend::AgentExecutableEntry::AbsolutePath(std::path::PathBuf::from("/opt/bin/my-claude-wrapper")),
        ]
    );
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

    let audit = preprovisioned_server_audit(audit_path.clone());

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

    let records = audit.read_recent_timing_records(10).unwrap();
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
fn test_server_audit_preprovisioned_contract() {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    let tmp = tempdir().unwrap();
    let audit_path = tmp.path().join("idle-suspend-audit.jsonl");
    let audit = IdleSuspendServerAudit::new(audit_path.clone());
    let record = TimingAuditRecord::new(
        "contract-test".to_string(),
        900,
        600,
        1800,
        1200,
        "contract-001".to_string(),
        TimingAuditResult::Committed,
    )
    .unwrap();

    assert!(audit.record_event(&record).is_err());

    fs::write(&audit_path, b"operator-bytes\n").unwrap();
    fs::set_permissions(&audit_path, fs::Permissions::from_mode(0o600)).unwrap();
    let before_metadata = fs::symlink_metadata(&audit_path).unwrap();
    audit.record_event(&record).unwrap();
    let after_metadata = fs::symlink_metadata(&audit_path).unwrap();
    assert_eq!(before_metadata.ino(), after_metadata.ino());
    assert_eq!(fs::read(&audit_path).unwrap()[..15], b"operator-bytes\n"[..]);

    fs::set_permissions(&audit_path, fs::Permissions::from_mode(0o640)).unwrap();
    assert!(audit.read_recent_records(10).is_err());
    fs::set_permissions(&audit_path, fs::Permissions::from_mode(0o600)).unwrap();

    let target = tmp.path().join("real-audit.jsonl");
    fs::write(&target, b"target\n").unwrap();
    fs::set_permissions(&target, fs::Permissions::from_mode(0o600)).unwrap();
    fs::remove_file(&audit_path).unwrap();
    std::os::unix::fs::symlink(&target, &audit_path).unwrap();
    assert!(audit.record_event(&record).is_err());
    assert_eq!(fs::read(&target).unwrap(), b"target\n");

    let fifo_path = tmp.path().join("fifo-audit.jsonl");
    let fifo_name = std::ffi::CString::new(fifo_path.to_str().unwrap()).unwrap();
    assert_eq!(
        unsafe { libc::mkfifo(fifo_name.as_ptr(), 0o600) },
        0,
        "create FIFO"
    );
    let fifo_audit = IdleSuspendServerAudit::new(fifo_path);
    assert!(fifo_audit.record_event(&record).is_err());
    assert!(fifo_audit.read_recent_records(1).is_err());
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
    CoordinatorForceSuspendResult, CoordinatorTimingResult, ForceSuspendCommand,
    IdleSuspendCoordinator, UpdateTimingCommand,
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
        automatic_policy: crate::config::IdleSuspendAutomaticPolicy::EmptyFleet,
        agent_executables: Arc::new(crate::idle_suspend::AgentExecutableSet::default()),
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
    assert!(validate_canonical_uuid_v4(&reqs[0].request_id).is_ok());
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
    let audit = preprovisioned_server_audit(audit_file.clone());

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
    assert!(fake_backend.program_rtc_wake(Some(600)).is_ok());
    assert_eq!(*fake_backend.programmed_wake.lock().unwrap(), Some(Some(600)));
    assert_eq!(fake_backend.timed_wake_seconds(), Some(600));
    assert!(!fake_backend.is_clear_only());
    assert!(!fake_backend.is_not_called());
    let elapsed = fake_backend.trigger_suspend().unwrap();
    assert_eq!(elapsed, 300);
    assert!(*fake_backend.suspend_called.lock().unwrap());

    // Test simulated failures
    fake_backend.set_fail_rtc(Some("RTC busy".to_string()));
    assert!(fake_backend.program_rtc_wake(Some(600)).is_err());
    fake_backend.set_fail_rtc(None);

    fake_backend.set_fail_suspend(Some("logind permission denied".to_string()));
    assert!(fake_backend.trigger_suspend().is_err());

    // 2. SystemdLogindBackend RTC alarm write test with tempfile
    let tmp = tempdir().unwrap();
    let fake_wakealarm = tmp.path().join("fake_wakealarm");
    let fake_systemctl = tmp.path().join("fake_systemctl");

    let backend = SystemdLogindBackend::with_paths(&fake_wakealarm, &fake_systemctl);
    assert!(backend.program_rtc_wake(Some(300)).is_ok());

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

#[test]
fn test_validate_suspend_wake_seconds_domain() {
    // 0 is valid for execution (indefinite sleep)
    assert!(validate_suspend_wake_seconds(0).is_ok());

    // 1..=59 are rejected
    assert!(matches!(
        validate_suspend_wake_seconds(1),
        Err(ProtocolError::InvalidWakeSeconds(1))
    ));
    assert!(matches!(
        validate_suspend_wake_seconds(59),
        Err(ProtocolError::InvalidWakeSeconds(59))
    ));

    // 60..=86400 are valid bounded timed wake
    assert!(validate_suspend_wake_seconds(MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS).is_ok());
    assert!(validate_suspend_wake_seconds(600).is_ok());
    assert!(validate_suspend_wake_seconds(MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS).is_ok());

    // Values above maximum are rejected
    assert!(matches!(
        validate_suspend_wake_seconds(MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS + 1),
        Err(ProtocolError::InvalidWakeSeconds(_))
    ));
    assert!(matches!(
        validate_suspend_wake_seconds(u64::MAX),
        Err(ProtocolError::InvalidWakeSeconds(_))
    ));
}

#[test]
fn test_automatic_timing_bounds_regression() {
    // Automatic timing validation MUST continue to reject 0 for wake_after_seconds
    assert!(validate_timing_pair(300, 0).is_err());
    assert!(validate_timing_pair(0, 300).is_err());
    assert!(validate_timing_pair(300, 59).is_err());
    assert!(validate_timing_pair(300, 60).is_ok());
    assert!(validate_timing_pair(300, 86400).is_ok());

    // IdleSuspendConfig validate() MUST reject wake_after_seconds = 0
    let mut cfg = IdleSuspendConfig::default();
    cfg.wake_after_seconds = 0;
    assert!(cfg.validate().is_err());
}

#[test]
fn test_suspend_request_frame_zero_sentinel_and_serde() {
    // Request with wake_after_seconds = 0 (indefinite sleep)
    let req_zero = SuspendWithRtcWakeRequest {
        request_id: "req-indefinite-1".to_string(),
        wake_after_seconds: 0,
    };
    let frame_zero = HelperRequestFrame::new_suspend(req_zero.clone()).unwrap();
    assert!(frame_zero.validate().is_ok());

    // Request with invalid wake_after_seconds = 59 fails construction and validation
    let req_invalid = SuspendWithRtcWakeRequest {
        request_id: "req-invalid-1".to_string(),
        wake_after_seconds: 59,
    };
    assert!(HelperRequestFrame::new_suspend(req_invalid).is_err());

    // Serde round-trip with JSON containing wakeAfterSeconds: 0
    let json = serde_json::json!({
        "version": 1,
        "payload": {
            "type": "suspendWithRtcWake",
            "requestId": "req-wire-0",
            "wakeAfterSeconds": 0
        },
        "timestampMs": 1725590000000u64
    });
    let decoded: HelperRequestFrame = serde_json::from_value(json).unwrap();
    assert!(decoded.validate().is_ok());
    match decoded.payload {
        HelperRequestPayload::SuspendWithRtcWake(req) => {
            assert_eq!(req.request_id, "req-wire-0");
            assert_eq!(req.wake_after_seconds, 0);
        }
        _ => panic!("Expected SuspendWithRtcWake"),
    }
}

#[test]
fn test_systemd_logind_backend_clear_only_and_failures() {
    let tmp = tempdir().unwrap();
    let fake_wakealarm = tmp.path().join("fake_wakealarm");
    let fake_systemctl = tmp.path().join("fake_systemctl");
    let backend = SystemdLogindBackend::with_paths(&fake_wakealarm, &fake_systemctl);

    // 1. Clear-only mode (None)
    assert!(backend.program_rtc_wake(None).is_ok());
    let written = fs::read_to_string(&fake_wakealarm).unwrap();
    // In clear-only, "0\n" was written and verified; no target epoch was written
    assert_eq!(written.trim(), "0");

    // 2. Clear failure: unwritable path
    let bad_backend = SystemdLogindBackend::with_paths(
        tmp.path().join("nonexistent_dir").join("wakealarm"),
        &fake_systemctl,
    );
    assert!(bad_backend.program_rtc_wake(None).is_err());
    assert!(bad_backend.program_rtc_wake(Some(300)).is_err());
}

#[test]
fn test_preflight_rtc_exclusive_ownership_and_busy_alarm() {
    let tmp = tempdir().unwrap();
    let wakealarm_path = tmp.path().join("wakealarm");
    let power_path = tmp.path().join("power_state");
    fs::write(&power_path, "mem disk freeze\n").unwrap();

    // 1. Empty wakealarm file (no alarm set) -> passes
    fs::write(&wakealarm_path, "").unwrap();
    let checker = SysfsPreflightChecker::with_paths(
        &power_path,
        &wakealarm_path,
        "mem",
        Box::new(FakeInhibitorProvider::default()),
    );
    assert!(checker.check_rtc_wakealarm().is_ok());

    // 2. Wakealarm file containing "0\n" (cleared alarm) -> passes
    fs::write(&wakealarm_path, "0\n").unwrap();
    assert!(checker.check_rtc_wakealarm().is_ok());

    // 3. Wakealarm file containing non-empty epoch (busy alarm) -> rejected with RtcAlarmBusy
    fs::write(&wakealarm_path, "1725599999\n").unwrap();
    match checker.check_rtc_wakealarm() {
        Err(PreflightError::RtcAlarmBusy(msg)) => {
            assert!(msg.contains("1725599999"));
        }
        other => panic!("Expected RtcAlarmBusy, got: {other:?}"),
    }

    // 4. FakePreflightChecker with rtc_busy simulates busy alarm
    let mut fake = FakePreflightChecker::new_passing();
    fake.rtc_busy = Some("foreign schedule active".to_string());
    match fake.check_rtc_wakealarm() {
        Err(PreflightError::RtcAlarmBusy(msg)) => {
            assert_eq!(msg, "foreign schedule active");
        }
        other => panic!("Expected RtcAlarmBusy, got: {other:?}"),
    }
}

#[tokio::test]
async fn test_helper_server_indefinite_sleep_execution_and_audit() {
    let tmp = tempdir().unwrap();
    let socket_path = tmp.path().join("helper.sock");
    let audit_path = tmp.path().join("audit.jsonl");

    let policy = EnrolledPeerPolicy::new_test_permissive();
    let preflight = Arc::new(FakePreflightChecker::new_passing());
    let backend = Arc::new(FakeActionBackend::with_elapsed(120));
    let audit = Arc::new(HelperAudit::new(&audit_path, 100));

    let server = HelperServer::new(
        policy,
        preflight,
        Arc::clone(&backend),
        Arc::clone(&audit),
        100,
    );

    let listener = tokio::net::UnixListener::bind(&socket_path).unwrap();
    let server_handle = tokio::spawn(async move {
        if let Ok((mut stream, _)) = listener.accept().await {
            let cred = PeerCredentials { pid: 9999, uid: 1000, gid: 1000 };
            let _ = server.handle_connection(&mut stream, cred).await;
        }
    });

    let client = crate::idle_suspend::HelperClient::new(&socket_path);
    // Send request with wake_after_seconds: 0 (indefinite sleep)
    let outcome = client.execute_suspend(SuspendWithRtcWakeRequest {
        request_id: "req-indef-test".to_string(),
        wake_after_seconds: 0,
    }).await.unwrap();

    match outcome {
        SuspendOutcome::ResumedSuccessfully { request_id, elapsed_seconds } => {
            assert_eq!(request_id, "req-indef-test");
            assert_eq!(elapsed_seconds, 120);
        }
        other => panic!("Expected ResumedSuccessfully, got: {other:?}"),
    }

    // Backend received None (clear-only) and trigger_suspend was called
    assert!(backend.is_clear_only());
    assert!(*backend.suspend_called.lock().unwrap());

    server_handle.await.unwrap();

    // Verify audit log explicitly records wake_after_seconds: Some(0) and is_indefinite_sleep() == true
    let records = audit.read_all_records().unwrap();
    assert_eq!(records.len(), 2);
    assert_eq!(records[0].record_type, HelperAuditRecordType::AcceptedIntent);
    assert_eq!(records[0].wake_after_seconds, Some(0));
    assert!(records[0].is_indefinite_sleep());

    assert_eq!(records[1].record_type, HelperAuditRecordType::ExecutionCompleted);
    assert_eq!(records[1].wake_after_seconds, Some(0));
    assert!(records[1].is_indefinite_sleep());
}

#[tokio::test]
async fn test_helper_server_busy_alarm_and_rtc_failure_suppresses_suspend() {
    let tmp = tempdir().unwrap();
    let socket_path = tmp.path().join("helper.sock");
    let audit_path = tmp.path().join("audit.jsonl");

    // 1. Busy alarm preflight failure suppresses suspend
    let policy = EnrolledPeerPolicy::new_test_permissive();
    let mut preflight = FakePreflightChecker::new_passing();
    preflight.rtc_busy = Some("foreign cron wakealarm active".to_string());
    let backend = Arc::new(FakeActionBackend::new());
    let audit = Arc::new(HelperAudit::new(&audit_path, 100));

    let server = HelperServer::new(
        policy,
        Arc::new(preflight),
        Arc::clone(&backend),
        Arc::clone(&audit),
        100,
    );

    let listener = tokio::net::UnixListener::bind(&socket_path).unwrap();
    let server_handle = tokio::spawn(async move {
        if let Ok((mut stream, _)) = listener.accept().await {
            let cred = PeerCredentials { pid: 9999, uid: 1000, gid: 1000 };
            let _ = server.handle_connection(&mut stream, cred).await;
        }
    });

    let client = crate::idle_suspend::HelperClient::new(&socket_path);
    let outcome = client.execute_suspend(SuspendWithRtcWakeRequest {
        request_id: "req-busy-test".to_string(),
        wake_after_seconds: 0,
    }).await.unwrap();

    match outcome {
        SuspendOutcome::ExecutionFailed { request_id, error } => {
            assert_eq!(request_id, "req-busy-test");
            assert!(error.contains("RTC alarm already programmed"));
        }
        other => panic!("Expected ExecutionFailed, got: {other:?}"),
    }

    // Crucial invariant: trigger_suspend was NOT called! Zero suspend calls.
    assert!(!*backend.suspend_called.lock().unwrap());
    assert!(backend.is_not_called());

    server_handle.await.unwrap();

    // 2. RTC programming failure suppresses suspend
    let socket_path_2 = tmp.path().join("helper2.sock");
    let policy2 = EnrolledPeerPolicy::new_test_permissive();
    let preflight2 = Arc::new(FakePreflightChecker::new_passing());
    let backend2 = Arc::new(FakeActionBackend::new());
    backend2.set_fail_rtc(Some("sysfs write permission denied".to_string()));
    let audit2 = Arc::new(HelperAudit::new(tmp.path().join("audit2.jsonl"), 100));

    let server2 = HelperServer::new(
        policy2,
        preflight2,
        Arc::clone(&backend2),
        audit2,
        100,
    );

    let listener2 = tokio::net::UnixListener::bind(&socket_path_2).unwrap();
    let server_handle2 = tokio::spawn(async move {
        if let Ok((mut stream, _)) = listener2.accept().await {
            let cred = PeerCredentials { pid: 9999, uid: 1000, gid: 1000 };
            let _ = server2.handle_connection(&mut stream, cred).await;
        }
    });

    let client2 = crate::idle_suspend::HelperClient::new(&socket_path_2);
    let outcome2 = client2.execute_suspend(SuspendWithRtcWakeRequest {
        request_id: "req-rtc-fail".to_string(),
        wake_after_seconds: 0,
    }).await.unwrap();

    match outcome2 {
        SuspendOutcome::ExecutionFailed { request_id, error } => {
            assert_eq!(request_id, "req-rtc-fail");
            assert!(error.contains("RTC programming failed"));
        }
        other => panic!("Expected ExecutionFailed, got: {other:?}"),
    }

    // Crucial invariant: trigger_suspend was NOT called!
    assert!(!*backend2.suspend_called.lock().unwrap());

    server_handle2.await.unwrap();
}

#[tokio::test]
async fn test_manual_force_suspend_quiescent_ordinary_claim() {
    let tmp = tempdir().unwrap();
    let policy = create_test_policy(tmp.path(), true);
    let timing = Arc::new(RwLock::new(RuntimeIdleSuspendTiming::new(300, 600).unwrap()));
    let executor = Arc::new(FakeExecutor::new(true));
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));
    let audit_file = tmp.path().join("audit.jsonl");
    let audit = preprovisioned_server_audit(audit_file.clone());

    let coordinator = IdleSuspendCoordinator::start(
        policy,
        timing,
        None,
        Some(audit.clone()),
        executor.clone(),
        pty_manager.clone(),
    );

    let cmd = ForceSuspendCommand {
        actor: "operator-user".to_string(),
        wake_after_seconds: 0,
        force: false,
    };

    let result = coordinator.force_suspend(cmd).await;
    let req_id = match result {
        CoordinatorForceSuspendResult::Accepted {
            request_id,
            status_revision,
            fleet_snapshot,
        } => {
            assert!(validate_canonical_uuid_v4(&request_id).is_ok());
            assert_eq!(status_revision, 2);
            assert!(fleet_snapshot.handoff_active);
            request_id
        }
        other => panic!("Expected Accepted, got: {other:?}"),
    };

    // Wait for in-flight executor to finish
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // Handoff released, state transitioned to Resumed
    let status = coordinator.status();
    assert_eq!(status.state, CoordinatorState::Resumed);
    assert!(!pty_manager.fleet_snapshot().handoff_active);

    // Verify audit log has Attempted, Accepted, and TerminalOutcome
    let manual_records = audit.read_recent_manual_records(10).unwrap();
    assert_eq!(manual_records.len(), 3);
    assert_eq!(
        manual_records[0].result,
        ManualAuditResult::TerminalOutcome(SuspendOutcome::ResumedSuccessfully {
            request_id: req_id.clone(),
            elapsed_seconds: 0,
        })
    );
    assert_eq!(manual_records[1].result, ManualAuditResult::Accepted);
    assert_eq!(manual_records[2].result, ManualAuditResult::Attempted);
    assert_eq!(manual_records[2].actor, "operator-user");
    assert_eq!(manual_records[2].request_id, req_id);
    assert_eq!(manual_records[2].wake_after_seconds, 0);
    assert!(!manual_records[2].requested_force);
    assert!(!manual_records[2].effective_force);

    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_manual_force_suspend_active_fleet_requires_confirmation() {
    let tmp = tempdir().unwrap();
    let policy = create_test_policy(tmp.path(), true);
    let timing = Arc::new(RwLock::new(RuntimeIdleSuspendTiming::new(300, 600).unwrap()));
    let executor = Arc::new(FakeExecutor::new(true));
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));
    let audit_file = tmp.path().join("audit.jsonl");
    let audit = preprovisioned_server_audit(audit_file.clone());

    // Make fleet active
    pty_manager.with_fleet_for_test(|f| {
        f.begin_create("t_active", 1).unwrap();
    });

    let coordinator = IdleSuspendCoordinator::start(
        policy,
        timing,
        None,
        Some(audit.clone()),
        executor.clone(),
        pty_manager.clone(),
    );

    let cmd = ForceSuspendCommand {
        actor: "operator-user".to_string(),
        wake_after_seconds: 120,
        force: false,
    };

    let result = coordinator.force_suspend(cmd).await;
    match result {
        CoordinatorForceSuspendResult::ActiveFleetRequiresConfirmation { fleet_snapshot } => {
            assert_eq!(fleet_snapshot.creating_count, 1);
            assert_eq!(fleet_snapshot.running_count(), 1);
            assert!(!fleet_snapshot.handoff_active);
        }
        other => panic!("Expected ActiveFleetRequiresConfirmation, got: {other:?}"),
    }

    // Zero executor calls, zero claims
    assert_eq!(executor.recorded_requests().len(), 0);
    assert!(!pty_manager.fleet_snapshot().handoff_active);

    // Audit log has RejectedConfirmationRequired
    let manual_records = audit.read_recent_manual_records(10).unwrap();
    assert_eq!(manual_records.len(), 1);
    assert_eq!(
        manual_records[0].result,
        ManualAuditResult::RejectedConfirmationRequired
    );
    assert_eq!(manual_records[0].creating_count, 1);

    coordinator.shutdown().await;
}

struct BlockingTestExecutor {
    release_rx: parking_lot::Mutex<Option<tokio::sync::oneshot::Receiver<()>>>,
}

impl IdleSuspendExecutor for BlockingTestExecutor {
    fn check_capability(&self) -> BoxFuture<'_, bool> {
        Box::pin(async { true })
    }

    fn execute_suspend(&self, request: SuspendWithRtcWakeRequest) -> BoxFuture<'_, SuspendOutcome> {
        let rx = self.release_rx.lock().take();
        Box::pin(async move {
            if let Some(r) = rx {
                let _ = r.await;
            }
            SuspendOutcome::ResumedSuccessfully {
                request_id: request.request_id,
                elapsed_seconds: request.wake_after_seconds,
            }
        })
    }
}

#[tokio::test]
async fn test_manual_force_suspend_active_fleet_with_force_succeeds() {
    let tmp = tempdir().unwrap();
    let policy = create_test_policy(tmp.path(), true);
    let timing = Arc::new(RwLock::new(RuntimeIdleSuspendTiming::new(300, 600).unwrap()));
    let (release_tx, release_rx) = tokio::sync::oneshot::channel();
    let executor = Arc::new(BlockingTestExecutor {
        release_rx: parking_lot::Mutex::new(Some(release_rx)),
    });
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));
    let audit_file = tmp.path().join("audit.jsonl");
    let audit = preprovisioned_server_audit(audit_file.clone());

    // Make fleet active
    pty_manager.with_fleet_for_test(|f| {
        f.begin_create("t_active", 1).unwrap();
    });

    let coordinator = IdleSuspendCoordinator::start(
        policy,
        timing,
        None,
        Some(audit.clone()),
        executor.clone(),
        pty_manager.clone(),
    );

    let cmd = ForceSuspendCommand {
        actor: "operator-user".to_string(),
        wake_after_seconds: 300,
        force: true,
    };

    let result = coordinator.force_suspend(cmd).await;
    match result {
        CoordinatorForceSuspendResult::Accepted {
            request_id,
            status_revision,
            fleet_snapshot,
        } => {
            assert!(validate_canonical_uuid_v4(&request_id).is_ok());
            assert_eq!(status_revision, 2);
            assert!(fleet_snapshot.handoff_active);
        }
        other => panic!("Expected Accepted, got: {other:?}"),
    }

    // New terminal creation blocked while handoff in flight
    pty_manager.with_fleet_for_test(|f| {
        assert!(matches!(
            f.begin_create("t_blocked", 2),
            Err(crate::error::AppError::IdleSuspendHandoffInProgress(_))
        ));
    });

    // Release in-flight executor
    let _ = release_tx.send(());
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // Handoff released
    assert!(!pty_manager.fleet_snapshot().handoff_active);

    // Audit log verifies effective_force == true
    let manual_records = audit.read_recent_manual_records(10).unwrap();
    assert_eq!(manual_records.len(), 3);
    assert_eq!(manual_records[2].result, ManualAuditResult::Attempted);
    assert!(manual_records[2].requested_force);
    assert!(manual_records[2].effective_force);

    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_manual_force_suspend_capability_failure() {
    let tmp = tempdir().unwrap();
    let policy = create_test_policy(tmp.path(), true);
    let timing = Arc::new(RwLock::new(RuntimeIdleSuspendTiming::new(300, 600).unwrap()));
    let executor = Arc::new(UnavailableExecutor::new("Host not capable"));
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));
    let audit_file = tmp.path().join("audit.jsonl");
    let audit = preprovisioned_server_audit(audit_file.clone());

    let coordinator = IdleSuspendCoordinator::start(
        policy,
        timing,
        None,
        Some(audit.clone()),
        executor,
        pty_manager.clone(),
    );

    let cmd = ForceSuspendCommand {
        actor: "operator-user".to_string(),
        wake_after_seconds: 0,
        force: false,
    };

    let result = coordinator.force_suspend(cmd).await;
    match result {
        CoordinatorForceSuspendResult::CapabilityUnavailable(detail) => {
            assert!(detail.contains("capability probe failed"));
        }
        other => panic!("Expected CapabilityUnavailable, got: {other:?}"),
    }

    assert!(!pty_manager.fleet_snapshot().handoff_active);
    let manual_records = audit.read_recent_manual_records(10).unwrap();
    assert_eq!(manual_records.len(), 1);
    assert_eq!(
        manual_records[0].result,
        ManualAuditResult::RejectedCapability
    );

    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_manual_force_suspend_wake_seconds_and_actor_validation() {
    let tmp = tempdir().unwrap();
    let policy = create_test_policy(tmp.path(), true);
    let timing = Arc::new(RwLock::new(RuntimeIdleSuspendTiming::new(300, 600).unwrap()));
    let executor = Arc::new(FakeExecutor::new(true));
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));
    let audit = preprovisioned_server_audit(tmp.path().join("audit.jsonl"));

    let coordinator = IdleSuspendCoordinator::start(
        policy,
        timing,
        None,
        Some(audit),
        executor,
        pty_manager,
    );

    // 1. Invalid wake seconds (e.g. 15 seconds, below minimum 60 and not 0)
    let res_invalid_wake = coordinator
        .force_suspend(ForceSuspendCommand {
            actor: "valid-actor".to_string(),
            wake_after_seconds: 15,
            force: false,
        })
        .await;
    assert!(matches!(
        res_invalid_wake,
        CoordinatorForceSuspendResult::ValidationFailed(_)
    ));

    // 2. Overlong wake seconds (e.g. 100_000, above maximum 86400)
    let res_overlong_wake = coordinator
        .force_suspend(ForceSuspendCommand {
            actor: "valid-actor".to_string(),
            wake_after_seconds: 100_000,
            force: false,
        })
        .await;
    assert!(matches!(
        res_overlong_wake,
        CoordinatorForceSuspendResult::ValidationFailed(_)
    ));

    // 3. Empty actor
    let res_empty_actor = coordinator
        .force_suspend(ForceSuspendCommand {
            actor: "   ".to_string(),
            wake_after_seconds: 0,
            force: false,
        })
        .await;
    assert!(matches!(
        res_empty_actor,
        CoordinatorForceSuspendResult::ValidationFailed(_)
    ));

    // 4. Overlong actor (>128 chars)
    let res_overlong_actor = coordinator
        .force_suspend(ForceSuspendCommand {
            actor: "a".repeat(129),
            wake_after_seconds: 0,
            force: false,
        })
        .await;
    assert!(matches!(
        res_overlong_actor,
        CoordinatorForceSuspendResult::ValidationFailed(_)
    ));

    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_manual_force_suspend_with_policy_disabled() {
    let tmp = tempdir().unwrap();
    // Policy disabled!
    let policy = create_test_policy(tmp.path(), false);
    let timing = Arc::new(RwLock::new(RuntimeIdleSuspendTiming::new(300, 600).unwrap()));
    let executor = Arc::new(FakeExecutor::new(true));
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));
    let audit = preprovisioned_server_audit(tmp.path().join("audit.jsonl"));

    let coordinator = IdleSuspendCoordinator::start(
        policy,
        timing,
        None,
        Some(audit),
        executor.clone(),
        pty_manager.clone(),
    );

    // Initial state is Disabled
    assert_eq!(coordinator.status().state, CoordinatorState::Disabled);

    // Manual action succeeds!
    let cmd = ForceSuspendCommand {
        actor: "admin".to_string(),
        wake_after_seconds: 0,
        force: false,
    };

    let result = coordinator.force_suspend(cmd).await;
    assert!(matches!(result, CoordinatorForceSuspendResult::Accepted { .. }));

    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    let status = coordinator.status();
    assert_eq!(status.state, CoordinatorState::Disabled);
    assert!(matches!(status.last_outcome, Some(SuspendOutcome::ResumedSuccessfully { .. })));
    assert!(!pty_manager.fleet_snapshot().handoff_active);

    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_manual_force_suspend_cancels_automatic_armed_grace() {
    let tmp = tempdir().unwrap();
    let policy = create_test_policy(tmp.path(), true);
    let timing = Arc::new(RwLock::new(RuntimeIdleSuspendTiming::new(60, 600).unwrap()));
    let (release_tx, release_rx) = tokio::sync::oneshot::channel();
    let executor = Arc::new(BlockingTestExecutor {
        release_rx: parking_lot::Mutex::new(Some(release_rx)),
    });
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));
    let audit = preprovisioned_server_audit(tmp.path().join("audit.jsonl"));

    let coordinator = IdleSuspendCoordinator::start(
        policy,
        timing,
        None,
        Some(audit),
        executor.clone(),
        pty_manager.clone(),
    );
    let mut status_rx = coordinator.subscribe_status();

    // Transition fleet from quiescent to active
    pty_manager.with_fleet_for_test(|fleet| {
        fleet.begin_create("t_temp", 1).unwrap();
        fleet.publish_live("t_temp", 1);
    });

    while status_rx.borrow().fleet_snapshot.live_count != 1 {
        status_rx.changed().await.unwrap();
    }

    // Transition fleet from active to quiescent -> coordinator arms
    pty_manager.with_fleet_for_test(|fleet| {
        fleet.remove_live("t_temp", 1);
    });

    while status_rx.borrow().state != CoordinatorState::Armed {
        status_rx.changed().await.unwrap();
    }
    assert_eq!(status_rx.borrow().state, CoordinatorState::Armed);

    // Manual suspend is issued while grace is armed
    let result = coordinator
        .force_suspend(ForceSuspendCommand {
            actor: "admin".to_string(),
            wake_after_seconds: 0,
            force: false,
        })
        .await;
    assert!(matches!(result, CoordinatorForceSuspendResult::Accepted { .. }));

    // Status is now HandedOff and arm deadline is cleared
    assert_eq!(coordinator.status().state, CoordinatorState::HandedOff);
    assert!(coordinator.status().arm_deadline_ms.is_none());

    // Release in-flight executor
    let _ = release_tx.send(());

    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    assert_eq!(coordinator.status().state, CoordinatorState::Resumed);

    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_manual_force_suspend_duplicate_click_and_timing_contention() {
    let tmp = tempdir().unwrap();
    let policy = create_test_policy(tmp.path(), true);
    let timing = Arc::new(RwLock::new(RuntimeIdleSuspendTiming::new(300, 600).unwrap()));
    let (release_tx, release_rx) = tokio::sync::oneshot::channel();
    let executor = Arc::new(BlockingTestExecutor {
        release_rx: parking_lot::Mutex::new(Some(release_rx)),
    });
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));
    let audit = preprovisioned_server_audit(tmp.path().join("audit.jsonl"));

    let coordinator = IdleSuspendCoordinator::start(
        policy,
        timing,
        None,
        Some(audit),
        executor.clone(),
        pty_manager.clone(),
    );

    // First click: accepted
    let res1 = coordinator
        .force_suspend(ForceSuspendCommand {
            actor: "admin".to_string(),
            wake_after_seconds: 0,
            force: false,
        })
        .await;
    assert!(matches!(res1, CoordinatorForceSuspendResult::Accepted { .. }));

    // Second click while in-flight: rejected with HandoffInProgress
    let res2 = coordinator
        .force_suspend(ForceSuspendCommand {
            actor: "admin".to_string(),
            wake_after_seconds: 0,
            force: false,
        })
        .await;
    assert!(matches!(res2, CoordinatorForceSuspendResult::HandoffInProgress));

    // Timing update while in-flight: rejected with HandoffInProgress
    let res_timing = coordinator
        .update_timing(UpdateTimingCommand {
            actor: "admin".to_string(),
            quiet_period_seconds: 120,
            wake_after_seconds: 900,
        })
        .await;
    assert!(matches!(res_timing, CoordinatorTimingResult::HandoffInProgress));

    // Release handoff
    let _ = release_tx.send(());
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    assert!(!pty_manager.fleet_snapshot().handoff_active);

    coordinator.shutdown().await;
}
async fn tokio_wait_for(timeout: std::time::Duration, mut predicate: impl FnMut() -> bool) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if predicate() {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    predicate()
}

#[tokio::test]
async fn test_coordinator_agent_activity_disabled_mode_observer_only() {
    use crate::idle_suspend::activity::process::tests::MockProcessSource;
    use crate::idle_suspend::activity::tcp::tests::FakeDiagnosticsSource;
    use crate::idle_suspend::activity::ActivitySampler;
    use crate::pty::event_sink::NoopEventSink;
    use crate::pty::manager::PtySessionManager;
    use tokio::sync::mpsc;

    let mut cfg = IdleSuspendConfig::default();
    cfg.automatic_policy = crate::config::IdleSuspendAutomaticPolicy::AgentActivity;
    cfg.enabled = false;
    let policy = StartupIdleSuspendPolicy::from_config(&PathBuf::from("test.toml"), &cfg);
    let timing = Arc::new(tokio::sync::RwLock::new(
        RuntimeIdleSuspendTiming::from_config(&cfg).unwrap(),
    ));
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));
    let executor = Arc::new(FakeExecutor::new(true));

    let proc_source = MockProcessSource::new();
    let diag_source = FakeDiagnosticsSource::default();
    let (tx, rx) = mpsc::channel(16);
    let sampler = ActivitySampler::with_sources(
        Arc::new(pty_manager.clone()),
        Arc::clone(&policy.agent_executables),
        tx,
        proc_source,
        diag_source,
    );

    let coordinator = IdleSuspendCoordinator::start_with_sampler(
        policy,
        timing,
        None,
        None,
        executor,
        pty_manager,
        None,
        sampler,
        rx,
        None,
    );

    let status = coordinator.status();
    assert_eq!(status.state, CoordinatorState::Disabled);
    assert!(!status.enabled);
    assert!(status.arm_deadline_ms.is_none());
    // Activity status is present (not null) in agent-activity policy
    assert!(status.activity.is_some());

    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_coordinator_agent_activity_clean_boot_no_auto_arm() {
    use crate::idle_suspend::activity::process::tests::MockProcessSource;
    use crate::idle_suspend::activity::tcp::tests::FakeDiagnosticsSource;
    use crate::idle_suspend::activity::ActivitySampler;
    use crate::pty::event_sink::NoopEventSink;
    use crate::pty::manager::PtySessionManager;
    use tokio::sync::mpsc;

    let mut cfg = IdleSuspendConfig::default();
    cfg.automatic_policy = crate::config::IdleSuspendAutomaticPolicy::AgentActivity;
    cfg.enabled = true;
    let policy = StartupIdleSuspendPolicy::from_config(&PathBuf::from("test.toml"), &cfg);
    let timing = Arc::new(tokio::sync::RwLock::new(
        RuntimeIdleSuspendTiming::from_config(&cfg).unwrap(),
    ));
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));
    let executor = Arc::new(FakeExecutor::new(true));

    let proc_source = MockProcessSource::new();
    let diag_source = FakeDiagnosticsSource::default();
    let (tx, rx) = mpsc::channel(16);
    let sampler = ActivitySampler::with_sources(
        Arc::new(pty_manager.clone()),
        Arc::clone(&policy.agent_executables),
        tx,
        proc_source,
        diag_source,
    );

    let coordinator = IdleSuspendCoordinator::start_with_sampler(
        policy,
        timing,
        None,
        None,
        executor,
        pty_manager,
        None,
        sampler,
        rx,
        None,
    );

    // Let the first background sample establish baseline
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let status = coordinator.status();
    assert_eq!(status.state, CoordinatorState::Watching);
    assert!(status.enabled);
    // Clean boot never auto-arms without prior activity
    assert!(status.arm_deadline_ms.is_none());

    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_coordinator_agent_activity_countdown_and_final_claim() {
    use crate::idle_suspend::activity::process::tests::MockProcessSource;
    use crate::idle_suspend::activity::tcp::tests::FakeDiagnosticsSource;
    use crate::idle_suspend::activity::ActivitySampler;
    use crate::pty::event_sink::NoopEventSink;
    use crate::pty::manager::{PtyCreateOpts, PtySessionManager};
    use tokio::sync::mpsc;

    let mut cfg = IdleSuspendConfig::default();
    cfg.automatic_policy = crate::config::IdleSuspendAutomaticPolicy::AgentActivity;
    cfg.enabled = true;
    cfg.quiet_period_seconds = 1; // 1 second quiet for fast test
    let policy = StartupIdleSuspendPolicy::from_config(&PathBuf::from("test.toml"), &cfg);
    let timing = Arc::new(tokio::sync::RwLock::new(
        RuntimeIdleSuspendTiming::new_unvalidated(cfg.quiet_period_seconds, cfg.wake_after_seconds),
    ));
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));
    let executor = Arc::new(FakeExecutor::new(true));

    let id = "coord-agent-term";
    let opts = PtyCreateOpts {
        id: id.to_string(),
        project: None,
        worktree_path: None,
        command: "/bin/sleep 60".to_string(),
        cwd: "/tmp".to_string(),
        env: std::collections::HashMap::new(),
        rows: 24,
        cols: 80,
        name: None,
        restart_policy: crate::config::schema::RestartPolicy::Never,
        restart_max_retries: 0,
    };
    pty_manager.create(opts).expect("create session");
    let snap = pty_manager.capture_activity_snapshot();
    let root = snap.roots.iter().find(|r| r.terminal.session_id == id).unwrap();
    let pid = root.qualification.pid().unwrap_or(33333);
    let identity = root.qualification.process_identity().unwrap_or(crate::pty::activity::ProcessIdentity {
        pid,
        start_ticks: 100,
    });
    pty_manager.test_set_root_qualification(id, crate::pty::activity::RootQualification::Qualified { identity });

    let mut proc_source = MockProcessSource::new();
    proc_source.set_proc(
        identity.pid,
        1,
        PathBuf::from("/usr/bin/codex"),
        vec!["codex".to_string()],
        PathBuf::from("/tmp"),
        (1, 1),
        identity.start_ticks,
    );

    let diag_source = FakeDiagnosticsSource::default();
    let (tx, rx) = mpsc::channel(16);
    let sampler = ActivitySampler::with_sources(
        Arc::new(pty_manager.clone()),
        Arc::clone(&policy.agent_executables),
        tx,
        proc_source,
        diag_source,
    );

    let coordinator = IdleSuspendCoordinator::start_with_sampler(
        policy,
        timing,
        None,
        None,
        executor.clone(),
        pty_manager.clone(),
        None,
        sampler,
        rx,
        None,
    );

    // Wait for countdown and final claim (cadence is 2s, quiet is 1s, so ~3-4s total)
    // Wait for countdown and final claim (coordinator moves to HandedOff, then Resumed via FakeExecutor)
    let claimed = tokio_wait_for(std::time::Duration::from_secs(8), || {
        let s = coordinator.status();
        s.state == CoordinatorState::HandedOff || s.state == CoordinatorState::Resumed
    }).await;
    assert!(claimed, "Coordinator must transition to HandedOff or Resumed after quiet deadline, current: {:?}", coordinator.status().state);
    // Verify executor was invoked
    let calls = executor.recorded_requests();
    assert_eq!(calls.len(), 1);

    coordinator.shutdown().await;
    let _ = pty_manager.kill(id);
}

#[tokio::test]
async fn test_coordinator_agent_activity_invalidation_resets_countdown() {
    use crate::idle_suspend::activity::process::tests::MockProcessSource;
    use crate::idle_suspend::activity::tcp::tests::FakeDiagnosticsSource;
    use crate::idle_suspend::activity::ActivitySampler;
    use crate::pty::event_sink::NoopEventSink;
    use crate::pty::manager::{PtyCreateOpts, PtySessionManager};
    use tokio::sync::mpsc;

    let mut cfg = IdleSuspendConfig::default();
    cfg.automatic_policy = crate::config::IdleSuspendAutomaticPolicy::AgentActivity;
    cfg.enabled = true;
    cfg.quiet_period_seconds = 2;
    let policy = StartupIdleSuspendPolicy::from_config(&PathBuf::from("test.toml"), &cfg);
    let timing = Arc::new(tokio::sync::RwLock::new(
        RuntimeIdleSuspendTiming::new_unvalidated(cfg.quiet_period_seconds, cfg.wake_after_seconds),
    ));
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));
    let executor = Arc::new(FakeExecutor::new(true));

    let id = "coord-invalidation-term";
    let opts = PtyCreateOpts {
        id: id.to_string(),
        project: None,
        worktree_path: None,
        command: "/bin/sleep 60".to_string(),
        cwd: "/tmp".to_string(),
        env: std::collections::HashMap::new(),
        rows: 24,
        cols: 80,
        name: None,
        restart_policy: crate::config::schema::RestartPolicy::Never,
        restart_max_retries: 0,
    };
    pty_manager.create(opts).expect("create session");
    let snap = pty_manager.capture_activity_snapshot();
    let root = snap.roots.iter().find(|r| r.terminal.session_id == id).unwrap();
    let pid = root.qualification.pid().unwrap_or(44444);
    let identity = root.qualification.process_identity().unwrap_or(crate::pty::activity::ProcessIdentity {
        pid,
        start_ticks: 100,
    });
    pty_manager.test_set_root_qualification(id, crate::pty::activity::RootQualification::Qualified { identity });

    let mut proc_source = MockProcessSource::new();
    proc_source.set_proc(
        identity.pid,
        1,
        PathBuf::from("/usr/bin/codex"),
        vec!["codex".to_string()],
        PathBuf::from("/tmp"),
        (1, 1),
        identity.start_ticks,
    );

    let diag_source = FakeDiagnosticsSource::default();
    let (tx, rx) = mpsc::channel(16);
    let sampler = ActivitySampler::with_sources(
        Arc::new(pty_manager.clone()),
        Arc::clone(&policy.agent_executables),
        tx,
        proc_source,
        diag_source,
    );

    let coordinator = IdleSuspendCoordinator::start_with_sampler(
        policy,
        timing,
        None,
        None,
        executor.clone(),
        pty_manager.clone(),
        None,
        sampler,
        rx,
        None,
    );

    // Wait until Armed
    let armed = tokio_wait_for(std::time::Duration::from_secs(3), || {
        coordinator.status().state == CoordinatorState::Armed
    }).await;
    assert!(armed, "Coordinator must reach Armed state");

    // Write terminal input to invalidate countdown
    let _ = pty_manager.write(id, b"echo active\n");

    // Verify coordinator transitions back to Watching
    let watched = tokio_wait_for(std::time::Duration::from_secs(2), || {
        coordinator.status().state == CoordinatorState::Watching
    }).await;
    assert!(watched, "Input must invalidate countdown and return state to Watching");

    coordinator.shutdown().await;
    let _ = pty_manager.kill(id);
}

#[tokio::test]
async fn test_coordinator_agent_activity_spent_epoch_latch() {
    use crate::idle_suspend::activity::process::tests::MockProcessSource;
    use crate::idle_suspend::activity::tcp::tests::FakeDiagnosticsSource;
    use crate::idle_suspend::activity::ActivitySampler;
    use crate::pty::event_sink::NoopEventSink;
    use crate::pty::manager::{PtyCreateOpts, PtySessionManager};
    use tokio::sync::mpsc;

    let mut cfg = IdleSuspendConfig::default();
    cfg.automatic_policy = crate::config::IdleSuspendAutomaticPolicy::AgentActivity;
    cfg.enabled = true;
    cfg.quiet_period_seconds = 1;
    let policy = StartupIdleSuspendPolicy::from_config(&PathBuf::from("test.toml"), &cfg);
    let timing = Arc::new(tokio::sync::RwLock::new(
        RuntimeIdleSuspendTiming::new_unvalidated(cfg.quiet_period_seconds, cfg.wake_after_seconds),
    ));
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));
    let executor = Arc::new(FakeExecutor::new(true));

    let id = "coord-spent-epoch-term";
    let opts = PtyCreateOpts {
        id: id.to_string(),
        project: None,
        worktree_path: None,
        command: "/bin/sleep 60".to_string(),
        cwd: "/tmp".to_string(),
        env: std::collections::HashMap::new(),
        rows: 24,
        cols: 80,
        name: None,
        restart_policy: crate::config::schema::RestartPolicy::Never,
        restart_max_retries: 0,
    };
    pty_manager.create(opts).expect("create session");
    let snap = pty_manager.capture_activity_snapshot();
    let root = snap.roots.iter().find(|r| r.terminal.session_id == id).unwrap();
    let pid = root.qualification.pid().unwrap_or(55555);
    let identity = root.qualification.process_identity().unwrap_or(crate::pty::activity::ProcessIdentity {
        pid,
        start_ticks: 100,
    });
    pty_manager.test_set_root_qualification(id, crate::pty::activity::RootQualification::Qualified { identity });

    let mut proc_source = MockProcessSource::new();
    proc_source.set_proc(
        identity.pid,
        1,
        PathBuf::from("/usr/bin/codex"),
        vec!["codex".to_string()],
        PathBuf::from("/tmp"),
        (1, 1),
        identity.start_ticks,
    );

    let diag_source = FakeDiagnosticsSource::default();
    let (tx, rx) = mpsc::channel(16);
    let sampler = ActivitySampler::with_sources(
        Arc::new(pty_manager.clone()),
        Arc::clone(&policy.agent_executables),
        tx,
        proc_source,
        diag_source,
    );

    let coordinator = IdleSuspendCoordinator::start_with_sampler(
        policy,
        timing,
        None,
        None,
        executor.clone(),
        pty_manager.clone(),
        None,
        sampler,
        rx,
        None,
    );

    // Wait for HandedOff and executor completion
    let resumed = tokio_wait_for(std::time::Duration::from_secs(8), || {
        coordinator.status().state == CoordinatorState::Resumed
    }).await;
    assert!(resumed, "Coordinator must resume after fake executor outcome, current: {:?}", coordinator.status().state);
    // Epoch is now spent. Status reason should reflect EpochSpent after recovery sample
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    // Epoch is now spent. Status reason should reflect EpochSpent after recovery sample completes
    let spent = tokio_wait_for(std::time::Duration::from_secs(4), || {
        coordinator.status().activity.and_then(|a| a.reason_code) == Some(crate::idle_suspend::status::ActivityObservationReason::EpochSpent)
    }).await;
    assert!(spent, "Status reason must reflect EpochSpent after recovery sample, current: {:?}", coordinator.status().activity.and_then(|a| a.reason_code));
    coordinator.shutdown().await;
    let _ = pty_manager.kill(id);
}

#[tokio::test]
async fn test_coordinator_agent_activity_shutdown() {
    use crate::idle_suspend::activity::process::tests::MockProcessSource;
    use crate::idle_suspend::activity::tcp::tests::FakeDiagnosticsSource;
    use crate::idle_suspend::activity::ActivitySampler;
    use crate::pty::event_sink::NoopEventSink;
    use crate::pty::manager::PtySessionManager;
    use tokio::sync::mpsc;

    let mut cfg = IdleSuspendConfig::default();
    cfg.automatic_policy = crate::config::IdleSuspendAutomaticPolicy::AgentActivity;
    cfg.enabled = true;
    let policy = StartupIdleSuspendPolicy::from_config(&PathBuf::from("test.toml"), &cfg);
    let timing = Arc::new(tokio::sync::RwLock::new(
        RuntimeIdleSuspendTiming::from_config(&cfg).unwrap(),
    ));
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));
    let executor = Arc::new(FakeExecutor::new(true));

    let proc_source = MockProcessSource::new();
    let diag_source = FakeDiagnosticsSource::default();
    let (tx, rx) = mpsc::channel(16);
    let sampler = ActivitySampler::with_sources(
        Arc::new(pty_manager.clone()),
        Arc::clone(&policy.agent_executables),
        tx,
        proc_source,
        diag_source,
    );

    let coordinator = IdleSuspendCoordinator::start_with_sampler(
        policy,
        timing,
        None,
        None,
        executor,
        pty_manager,
        None,
        sampler,
        rx,
        None,
    );

    // Shutdown must complete cleanly
    coordinator.shutdown().await;
}

use crate::idle_suspend::event::{
    validate_canonical_uuid, validate_canonical_uuid_v4, ActionCorrelationId, ArmCancelledDataV1,
    ArmStartedDataV1, AttemptStartedDataV1, AutomaticPolicyV1, CoordinatorStartedDataV1,
    EventValidationError, EventWriteError, FinalCheckCompletedDataV1, FinalCheckStartedDataV1,
    HandoffClaimAcceptedDataV1, HandoffClaimRejectedDataV1, HelperOutcomeReceivedDataV1,
    HelperRequestDispatchedDataV1, IdleSuspendEventDataV1, IdleSuspendEventEnvelopeV1,
    IdleSuspendEventWriter, IdleSuspendModeV1, MeasurementRecoveredDataV1,
    MeasurementUnavailableDataV1, ProducerIdentity, ReconciliationCompletedDataV1,
    ServerIdleSuspendEventTypeV1, ServerIdleSuspendReasonCodeV1, TerminalRejectedDataV1,
    DEFAULT_IDLE_SUSPEND_EVENTS_PATH, IDLE_SUSPEND_EVENT_SCHEMA_VERSION, MAX_EVENT_LINE_BYTES,
};

fn make_test_identity() -> ProducerIdentity {
    ProducerIdentity::with_ids(
        "8f03c004-bb50-4822-9218-d75b34091a92".to_string(),
        "73d4a675-9c8f-4cb1-807e-97629fa2a5e4".to_string(),
    )
    .unwrap()
}

fn make_test_correlation() -> ActionCorrelationId {
    ActionCorrelationId::parse("e1f1816e-5cf6-4448-9c16-cf4c9354013a").unwrap()
}

#[test]
fn event_serde_roundtrip_all_14_events() {
    let identity = make_test_identity();
    let corr = make_test_correlation();
    assert_eq!(MAX_EVENT_LINE_BYTES, 16384);
    assert_eq!(
        DEFAULT_IDLE_SUSPEND_EVENTS_PATH,
        "/var/lib/dam-hopper/.config/dam-hopper/diagnostics/idle-suspend-events-v1.jsonl"
    );


    let test_cases: Vec<(
        ServerIdleSuspendEventTypeV1,
        Option<String>,
        Option<IdleSuspendModeV1>,
        IdleSuspendEventDataV1,
    )> = vec![
        (
            ServerIdleSuspendEventTypeV1::CoordinatorStarted,
            None,
            None,
            IdleSuspendEventDataV1::CoordinatorStarted(CoordinatorStartedDataV1 {
                automatic_policy: AutomaticPolicyV1::AgentActivity,
                quiet_period_seconds: 900,
                wake_after_seconds: 600,
                timing_revision: 1,
                status_revision: 2,
            }),
        ),
        (
            ServerIdleSuspendEventTypeV1::AttemptStarted,
            Some(corr.as_str().to_string()),
            Some(IdleSuspendModeV1::Automatic),
            IdleSuspendEventDataV1::AttemptStarted(AttemptStartedDataV1 {
                fleet_generation: 10,
                activity_revision: Some(5),
                timing_revision: 1,
                status_revision: 3,
                wake_after_seconds: 600,
            }),
        ),
        (
            ServerIdleSuspendEventTypeV1::ArmStarted,
            Some(corr.as_str().to_string()),
            Some(IdleSuspendModeV1::Automatic),
            IdleSuspendEventDataV1::ArmStarted(ArmStartedDataV1 {
                fleet_generation: 10,
                activity_revision: Some(5),
                quiet_period_seconds: 900,
                deadline_after_seconds: 300,
            }),
        ),
        (
            ServerIdleSuspendEventTypeV1::ArmCancelled,
            Some(corr.as_str().to_string()),
            Some(IdleSuspendModeV1::Automatic),
            IdleSuspendEventDataV1::ArmCancelled(ArmCancelledDataV1 {
                reason_code: ServerIdleSuspendReasonCodeV1::RecentInput,
                fleet_generation: 10,
                activity_revision: Some(5),
            }),
        ),
        (
            ServerIdleSuspendEventTypeV1::MeasurementUnavailable,
            None,
            None,
            IdleSuspendEventDataV1::MeasurementUnavailable(MeasurementUnavailableDataV1 {
                reason_code: ServerIdleSuspendReasonCodeV1::MeasurementUnavailable,
            }),
        ),
        (
            ServerIdleSuspendEventTypeV1::MeasurementRecovered,
            None,
            None,
            IdleSuspendEventDataV1::MeasurementRecovered(MeasurementRecoveredDataV1 {
                activity_revision: 6,
            }),
        ),
        (
            ServerIdleSuspendEventTypeV1::FinalCheckStarted,
            Some(corr.as_str().to_string()),
            Some(IdleSuspendModeV1::Automatic),
            IdleSuspendEventDataV1::FinalCheckStarted(FinalCheckStartedDataV1 {
                fleet_generation: 10,
                activity_revision: Some(6),
                timing_revision: 1,
            }),
        ),
        (
            ServerIdleSuspendEventTypeV1::FinalCheckCompleted,
            Some(corr.as_str().to_string()),
            Some(IdleSuspendModeV1::Automatic),
            IdleSuspendEventDataV1::FinalCheckCompleted(FinalCheckCompletedDataV1 {
                accepted: true,
                reason_code: None,
                fleet_generation: 10,
                activity_revision: Some(6),
            }),
        ),
        (
            ServerIdleSuspendEventTypeV1::HandoffClaimAccepted,
            Some(corr.as_str().to_string()),
            Some(IdleSuspendModeV1::Automatic),
            IdleSuspendEventDataV1::HandoffClaimAccepted(HandoffClaimAcceptedDataV1 {
                fleet_generation: 10,
            }),
        ),
        (
            ServerIdleSuspendEventTypeV1::HandoffClaimRejected,
            Some(corr.as_str().to_string()),
            Some(IdleSuspendModeV1::Automatic),
            IdleSuspendEventDataV1::HandoffClaimRejected(HandoffClaimRejectedDataV1 {
                reason_code: ServerIdleSuspendReasonCodeV1::StaleFleetGeneration,
                expected_fleet_generation: Some(10),
                actual_fleet_generation: Some(11),
            }),
        ),
        (
            ServerIdleSuspendEventTypeV1::HelperRequestDispatched,
            Some(corr.as_str().to_string()),
            Some(IdleSuspendModeV1::Automatic),
            IdleSuspendEventDataV1::HelperRequestDispatched(HelperRequestDispatchedDataV1 {
                wake_after_seconds: 600,
            }),
        ),
        (
            ServerIdleSuspendEventTypeV1::HelperOutcomeReceived,
            Some(corr.as_str().to_string()),
            Some(IdleSuspendModeV1::Automatic),
            IdleSuspendEventDataV1::HelperOutcomeReceived(HelperOutcomeReceivedDataV1 {
                reason_code: ServerIdleSuspendReasonCodeV1::ResumedSuccessfully,
            }),
        ),
        (
            ServerIdleSuspendEventTypeV1::ReconciliationCompleted,
            Some(corr.as_str().to_string()),
            Some(IdleSuspendModeV1::Automatic),
            IdleSuspendEventDataV1::ReconciliationCompleted(ReconciliationCompletedDataV1 {
                reason_code: ServerIdleSuspendReasonCodeV1::ResumedSuccessfully,
            }),
        ),
        (
            ServerIdleSuspendEventTypeV1::TerminalRejected,
            Some(corr.as_str().to_string()),
            Some(IdleSuspendModeV1::Manual),
            IdleSuspendEventDataV1::TerminalRejected(TerminalRejectedDataV1 {
                reason_code: ServerIdleSuspendReasonCodeV1::ActiveFleet,
                fleet_generation: Some(10),
                activity_revision: None,
            }),
        ),
    ];

    assert_eq!(test_cases.len(), 14);

    for (seq, (ev_type, correlation_id, mode, data)) in test_cases.into_iter().enumerate() {
        let envelope = IdleSuspendEventEnvelopeV1 {
            event_schema_version: IDLE_SUSPEND_EVENT_SCHEMA_VERSION,
            timestamp_ms: 1726215600000 + (seq as u64),
            boot_id: identity.boot_id.clone(),
            producer_instance_id: identity.producer_instance_id.clone(),
            producer_sequence: (seq as u64) + 1,
            event_type: ev_type,
            correlation_id,
            mode,
            data,
        };
        envelope.validate().unwrap();

        let json = serde_json::to_string(&envelope).unwrap();
        assert!(!json.contains("event_schema_version"));
        assert!(json.contains("eventSchemaVersion"));
        assert!(json.contains("producerInstanceId"));

        let decoded: IdleSuspendEventEnvelopeV1 = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded, envelope);
    }
}

#[test]
fn event_serde_rejects_unknown_fields() {
    let valid_json = serde_json::json!({
        "eventSchemaVersion": 1,
        "timestampMs": 1726215600000u64,
        "bootId": "8f03c004-bb50-4822-9218-d75b34091a92",
        "producerInstanceId": "73d4a675-9c8f-4cb1-807e-97629fa2a5e4",
        "producerSequence": 1,
        "eventType": "measurementUnavailable",
        "correlationId": null,
        "mode": null,
        "data": {
            "reasonCode": "measurementUnavailable"
        }
    });

    // Verify valid base deserializes
    let _: IdleSuspendEventEnvelopeV1 = serde_json::from_value(valid_json.clone()).unwrap();

    // Extra field in envelope must fail
    let mut extra_envelope = valid_json.clone();
    extra_envelope.as_object_mut().unwrap().insert("extraField".to_string(), serde_json::json!("forbidden"));
    assert!(serde_json::from_value::<IdleSuspendEventEnvelopeV1>(extra_envelope).is_err());

    // Extra field in data must fail
    let mut extra_data = valid_json.clone();
    extra_data["data"].as_object_mut().unwrap().insert("extraDataField".to_string(), serde_json::json!("forbidden"));
    assert!(serde_json::from_value::<IdleSuspendEventEnvelopeV1>(extra_data).is_err());
}

#[test]
fn event_validation_uuid_and_schema_version() {
    // Canonical lowercase RFC 4122
    assert!(validate_canonical_uuid("8f03c004-bb50-4822-9218-d75b34091a92").is_ok());
    // Uppercase hex rejected
    assert!(validate_canonical_uuid("8F03C004-BB50-4822-9218-D75B34091A92").is_err());
    // Missing hyphens rejected
    assert!(validate_canonical_uuid("8f03c004bb5048229218d75b34091a92").is_err());
    // Invalid chars rejected
    assert!(validate_canonical_uuid("8f03c004-bb50-4822-9218-d75b34091a9g").is_err());

    // UUID v4 check
    assert!(validate_canonical_uuid_v4("73d4a675-9c8f-4cb1-807e-97629fa2a5e4").is_ok());
    // Version 1 rejected
    assert!(validate_canonical_uuid_v4("8f03c004-bb50-1822-9218-d75b34091a92").is_err());

    // ActionCorrelationId strict parsing
    assert!(ActionCorrelationId::parse("73d4a675-9c8f-4cb1-807e-97629fa2a5e4").is_ok());
    assert!(ActionCorrelationId::parse("not-a-uuid").is_err());

    // Helper protocol request ID compatibility holds
    let corr = ActionCorrelationId::new_v4();
    assert!(crate::idle_suspend::protocol::validate_request_id(corr.as_str()).is_ok());
}

#[test]
fn event_validation_scope_and_mode_legality() {
    let identity = make_test_identity();
    let corr = make_test_correlation();

    // Process-wide event with correlationId must fail
    let env_with_corr = IdleSuspendEventEnvelopeV1 {
        event_schema_version: 1,
        timestamp_ms: 1000,
        boot_id: identity.boot_id.clone(),
        producer_instance_id: identity.producer_instance_id.clone(),
        producer_sequence: 1,
        event_type: ServerIdleSuspendEventTypeV1::MeasurementUnavailable,
        correlation_id: Some(corr.as_str().to_string()),
        mode: None,
        data: IdleSuspendEventDataV1::MeasurementUnavailable(MeasurementUnavailableDataV1 {
            reason_code: ServerIdleSuspendReasonCodeV1::MeasurementUnavailable,
        }),
    };
    assert!(matches!(env_with_corr.validate(), Err(EventValidationError::ForbiddenCorrelationId { .. })));

    // Process-wide event with mode must fail
    let env_with_mode = IdleSuspendEventEnvelopeV1 {
        event_schema_version: 1,
        timestamp_ms: 1000,
        boot_id: identity.boot_id.clone(),
        producer_instance_id: identity.producer_instance_id.clone(),
        producer_sequence: 1,
        event_type: ServerIdleSuspendEventTypeV1::CoordinatorStarted,
        correlation_id: None,
        mode: Some(IdleSuspendModeV1::Automatic),
        data: IdleSuspendEventDataV1::CoordinatorStarted(CoordinatorStartedDataV1 {
            automatic_policy: AutomaticPolicyV1::EmptyFleet,
            quiet_period_seconds: 900,
            wake_after_seconds: 600,
            timing_revision: 1,
            status_revision: 1,
        }),
    };
    assert!(matches!(env_with_mode.validate(), Err(EventValidationError::ForbiddenMode { .. })));

    // Attempt-scoped event without correlation must fail
    let env_missing_corr = IdleSuspendEventEnvelopeV1 {
        event_schema_version: 1,
        timestamp_ms: 1000,
        boot_id: identity.boot_id.clone(),
        producer_instance_id: identity.producer_instance_id.clone(),
        producer_sequence: 1,
        event_type: ServerIdleSuspendEventTypeV1::AttemptStarted,
        correlation_id: None,
        mode: Some(IdleSuspendModeV1::Automatic),
        data: IdleSuspendEventDataV1::AttemptStarted(AttemptStartedDataV1 {
            fleet_generation: 1,
            activity_revision: None,
            timing_revision: 1,
            status_revision: 1,
            wake_after_seconds: 600,
        }),
    };
    assert!(matches!(env_missing_corr.validate(), Err(EventValidationError::MissingCorrelationId { .. })));

    // ArmStarted with mode Manual must fail
    let env_arm_manual = IdleSuspendEventEnvelopeV1 {
        event_schema_version: 1,
        timestamp_ms: 1000,
        boot_id: identity.boot_id.clone(),
        producer_instance_id: identity.producer_instance_id.clone(),
        producer_sequence: 1,
        event_type: ServerIdleSuspendEventTypeV1::ArmStarted,
        correlation_id: Some(corr.as_str().to_string()),
        mode: Some(IdleSuspendModeV1::Manual),
        data: IdleSuspendEventDataV1::ArmStarted(ArmStartedDataV1 {
            fleet_generation: 1,
            activity_revision: None,
            quiet_period_seconds: 900,
            deadline_after_seconds: 900,
        }),
    };
    assert!(matches!(env_arm_manual.validate(), Err(EventValidationError::InvalidModeForEvent { .. })));

    // Manual attempt with activityRevision must fail
    let env_manual_activity = IdleSuspendEventEnvelopeV1 {
        event_schema_version: 1,
        timestamp_ms: 1000,
        boot_id: identity.boot_id.clone(),
        producer_instance_id: identity.producer_instance_id.clone(),
        producer_sequence: 1,
        event_type: ServerIdleSuspendEventTypeV1::AttemptStarted,
        correlation_id: Some(corr.as_str().to_string()),
        mode: Some(IdleSuspendModeV1::Manual),
        data: IdleSuspendEventDataV1::AttemptStarted(AttemptStartedDataV1 {
            fleet_generation: 1,
            activity_revision: Some(42),
            timing_revision: 1,
            status_revision: 1,
            wake_after_seconds: 600,
        }),
    };
    assert!(matches!(env_manual_activity.validate(), Err(EventValidationError::ManualAttemptWithActivityRevision)));
}

#[test]
fn event_validation_reason_subsets_and_bounds() {
    let identity = make_test_identity();
    let corr = make_test_correlation();

    // 1. ArmCancelled with non-R_ARM reason (e.g. suspendFailed) must fail
    let env_bad_arm_reason = IdleSuspendEventEnvelopeV1 {
        event_schema_version: 1,
        timestamp_ms: 1000,
        boot_id: identity.boot_id.clone(),
        producer_instance_id: identity.producer_instance_id.clone(),
        producer_sequence: 1,
        event_type: ServerIdleSuspendEventTypeV1::ArmCancelled,
        correlation_id: Some(corr.as_str().to_string()),
        mode: Some(IdleSuspendModeV1::Automatic),
        data: IdleSuspendEventDataV1::ArmCancelled(ArmCancelledDataV1 {
            reason_code: ServerIdleSuspendReasonCodeV1::SuspendFailed,
            fleet_generation: 1,
            activity_revision: None,
        }),
    };
    assert!(matches!(env_bad_arm_reason.validate(), Err(EventValidationError::ForbiddenReasonCode { .. })));

    // 2. FinalCheckCompleted accepted=true with reason must fail
    let env_final_accepted_with_reason = IdleSuspendEventEnvelopeV1 {
        event_schema_version: 1,
        timestamp_ms: 1000,
        boot_id: identity.boot_id.clone(),
        producer_instance_id: identity.producer_instance_id.clone(),
        producer_sequence: 1,
        event_type: ServerIdleSuspendEventTypeV1::FinalCheckCompleted,
        correlation_id: Some(corr.as_str().to_string()),
        mode: Some(IdleSuspendModeV1::Automatic),
        data: IdleSuspendEventDataV1::FinalCheckCompleted(FinalCheckCompletedDataV1 {
            accepted: true,
            reason_code: Some(ServerIdleSuspendReasonCodeV1::RecentInput),
            fleet_generation: 1,
            activity_revision: None,
        }),
    };
    assert!(matches!(env_final_accepted_with_reason.validate(), Err(EventValidationError::FinalCheckAcceptedWithReason)));

    // 3. FinalCheckCompleted accepted=false with null reason must fail
    let env_final_rejected_null_reason = IdleSuspendEventEnvelopeV1 {
        event_schema_version: 1,
        timestamp_ms: 1000,
        boot_id: identity.boot_id.clone(),
        producer_instance_id: identity.producer_instance_id.clone(),
        producer_sequence: 1,
        event_type: ServerIdleSuspendEventTypeV1::FinalCheckCompleted,
        correlation_id: Some(corr.as_str().to_string()),
        mode: Some(IdleSuspendModeV1::Automatic),
        data: IdleSuspendEventDataV1::FinalCheckCompleted(FinalCheckCompletedDataV1 {
            accepted: false,
            reason_code: None,
            fleet_generation: 1,
            activity_revision: None,
        }),
    };
    assert!(matches!(env_final_rejected_null_reason.validate(), Err(EventValidationError::FinalCheckRejectedWithoutReason)));

    // 4. HandoffClaimRejected with staleFleetGeneration missing actual generation must fail
    let env_handoff_missing_gen = IdleSuspendEventEnvelopeV1 {
        event_schema_version: 1,
        timestamp_ms: 1000,
        boot_id: identity.boot_id.clone(),
        producer_instance_id: identity.producer_instance_id.clone(),
        producer_sequence: 1,
        event_type: ServerIdleSuspendEventTypeV1::HandoffClaimRejected,
        correlation_id: Some(corr.as_str().to_string()),
        mode: Some(IdleSuspendModeV1::Automatic),
        data: IdleSuspendEventDataV1::HandoffClaimRejected(HandoffClaimRejectedDataV1 {
            reason_code: ServerIdleSuspendReasonCodeV1::StaleFleetGeneration,
            expected_fleet_generation: Some(1),
            actual_fleet_generation: None,
        }),
    };
    assert!(matches!(env_handoff_missing_gen.validate(), Err(EventValidationError::HandoffStaleGenerationMissingGenerations)));

    // 5. HandoffClaimRejected with handoffBusy carrying generation must fail
    let env_handoff_busy_with_gen = IdleSuspendEventEnvelopeV1 {
        event_schema_version: 1,
        timestamp_ms: 1000,
        boot_id: identity.boot_id.clone(),
        producer_instance_id: identity.producer_instance_id.clone(),
        producer_sequence: 1,
        event_type: ServerIdleSuspendEventTypeV1::HandoffClaimRejected,
        correlation_id: Some(corr.as_str().to_string()),
        mode: Some(IdleSuspendModeV1::Automatic),
        data: IdleSuspendEventDataV1::HandoffClaimRejected(HandoffClaimRejectedDataV1 {
            reason_code: ServerIdleSuspendReasonCodeV1::HandoffBusy,
            expected_fleet_generation: Some(1),
            actual_fleet_generation: None,
        }),
    };
    assert!(matches!(env_handoff_busy_with_gen.validate(), Err(EventValidationError::HandoffRejectionForbiddenGenerations(_))));

    // 6. Numeric bounds: quietPeriodSeconds < 60 fails
    let env_bad_quiet = IdleSuspendEventEnvelopeV1 {
        event_schema_version: 1,
        timestamp_ms: 1000,
        boot_id: identity.boot_id.clone(),
        producer_instance_id: identity.producer_instance_id.clone(),
        producer_sequence: 1,
        event_type: ServerIdleSuspendEventTypeV1::CoordinatorStarted,
        correlation_id: None,
        mode: None,
        data: IdleSuspendEventDataV1::CoordinatorStarted(CoordinatorStartedDataV1 {
            automatic_policy: AutomaticPolicyV1::EmptyFleet,
            quiet_period_seconds: 59,
            wake_after_seconds: 600,
            timing_revision: 1,
            status_revision: 1,
        }),
    };
    assert!(matches!(env_bad_quiet.validate(), Err(EventValidationError::NumericOutOfBounds { field: "quietPeriodSeconds", .. })));

    // 7. Numeric bounds: wakeAfterSeconds non-zero and < 60 fails
    let env_bad_wake = IdleSuspendEventEnvelopeV1 {
        event_schema_version: 1,
        timestamp_ms: 1000,
        boot_id: identity.boot_id.clone(),
        producer_instance_id: identity.producer_instance_id.clone(),
        producer_sequence: 1,
        event_type: ServerIdleSuspendEventTypeV1::HelperRequestDispatched,
        correlation_id: Some(corr.as_str().to_string()),
        mode: Some(IdleSuspendModeV1::Automatic),
        data: IdleSuspendEventDataV1::HelperRequestDispatched(HelperRequestDispatchedDataV1 {
            wake_after_seconds: 30,
        }),
    };
    assert!(matches!(env_bad_wake.validate(), Err(EventValidationError::NumericOutOfBounds { field: "wakeAfterSeconds", .. })));
}

fn setup_trusted_diagnostics_dir(tmp: &tempfile::TempDir) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let diag_dir = tmp.path().join("diagnostics");
    fs::create_dir(&diag_dir).unwrap();
    fs::set_permissions(&diag_dir, fs::Permissions::from_mode(0o700)).unwrap();
    diag_dir.join("idle-suspend-events-v1.jsonl")
}

#[test]
fn event_writer_file_mode_and_sync() {
    use std::os::unix::fs::PermissionsExt;

    let tmp = tempdir().unwrap();
    let event_path = setup_trusted_diagnostics_dir(&tmp);
    let identity = make_test_identity();
    let writer = IdleSuspendEventWriter::with_identity(event_path.clone(), identity);

    // Emit two sequential events
    let e1 = writer.emit(
        1726215600000,
        ServerIdleSuspendEventTypeV1::CoordinatorStarted,
        None,
        None,
        IdleSuspendEventDataV1::CoordinatorStarted(CoordinatorStartedDataV1 {
            automatic_policy: AutomaticPolicyV1::AgentActivity,
            quiet_period_seconds: 900,
            wake_after_seconds: 600,
            timing_revision: 1,
            status_revision: 1,
        }),
    ).unwrap();
    assert_eq!(e1.producer_sequence, 1);

    let corr = make_test_correlation();
    let e2 = writer.emit(
        1726215601000,
        ServerIdleSuspendEventTypeV1::AttemptStarted,
        Some(&corr),
        Some(IdleSuspendModeV1::Automatic),
        IdleSuspendEventDataV1::AttemptStarted(AttemptStartedDataV1 {
            fleet_generation: 1,
            activity_revision: Some(1),
            timing_revision: 1,
            status_revision: 2,
            wake_after_seconds: 600,
        }),
    ).unwrap();
    assert_eq!(e2.producer_sequence, 2);

    // Verify file mode 0600 on disk
    let meta = fs::metadata(&event_path).unwrap();
    assert_eq!(meta.permissions().mode() & 0o7777, 0o600);

    // Read lines back and verify deserialization
    let content = fs::read_to_string(&event_path).unwrap();
    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
    assert_eq!(lines.len(), 2);

    let parsed1: IdleSuspendEventEnvelopeV1 = serde_json::from_str(lines[0]).unwrap();
    let parsed2: IdleSuspendEventEnvelopeV1 = serde_json::from_str(lines[1]).unwrap();
    assert_eq!(parsed1, e1);
    assert_eq!(parsed2, e2);
}

#[test]
fn event_writer_sequence_gap_on_failure() {
    use std::os::unix::fs::PermissionsExt;

    let tmp = tempdir().unwrap();
    let event_path = setup_trusted_diagnostics_dir(&tmp);
    let identity = make_test_identity();
    let writer = IdleSuspendEventWriter::with_identity(event_path.clone(), identity);

    // 1. First event succeeds with sequence 1
    let e1 = writer.emit(
        1000,
        ServerIdleSuspendEventTypeV1::CoordinatorStarted,
        None,
        None,
        IdleSuspendEventDataV1::CoordinatorStarted(CoordinatorStartedDataV1 {
            automatic_policy: AutomaticPolicyV1::EmptyFleet,
            quiet_period_seconds: 900,
            wake_after_seconds: 600,
            timing_revision: 1,
            status_revision: 1,
        }),
    ).unwrap();
    assert_eq!(e1.producer_sequence, 1);

    // 2. Invalidate file permissions to trigger I/O failure (consume sequence 2)
    fs::set_permissions(&event_path, fs::Permissions::from_mode(0o400)).unwrap();

    let err = writer.emit(
        2000,
        ServerIdleSuspendEventTypeV1::MeasurementUnavailable,
        None,
        None,
        IdleSuspendEventDataV1::MeasurementUnavailable(MeasurementUnavailableDataV1 {
            reason_code: ServerIdleSuspendReasonCodeV1::MeasurementUnavailable,
        }),
    );
    assert!(err.is_err(), "Write must fail against non-0600 file");

    // 3. Restore valid file permissions 0600 and write next event
    fs::set_permissions(&event_path, fs::Permissions::from_mode(0o600)).unwrap();

    let e3 = writer.emit(
        3000,
        ServerIdleSuspendEventTypeV1::MeasurementRecovered,
        None,
        None,
        IdleSuspendEventDataV1::MeasurementRecovered(MeasurementRecoveredDataV1 {
            activity_revision: 10,
        }),
    ).unwrap();

    // Observable sequence gap: sequence advanced from 1 to 3!
    assert_eq!(e3.producer_sequence, 3);

    // File contains only sequence 1 and sequence 3
    let content = fs::read_to_string(&event_path).unwrap();
    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
    assert_eq!(lines.len(), 2);
    let p1: IdleSuspendEventEnvelopeV1 = serde_json::from_str(lines[0]).unwrap();
    let p3: IdleSuspendEventEnvelopeV1 = serde_json::from_str(lines[1]).unwrap();
    assert_eq!(p1.producer_sequence, 1);
    assert_eq!(p3.producer_sequence, 3);
}

#[test]
fn event_writer_overflow_and_permanent_disable() {
    let tmp = tempdir().unwrap();
    let event_path = setup_trusted_diagnostics_dir(&tmp);
    let identity = make_test_identity();
    let writer = IdleSuspendEventWriter::with_identity(event_path.clone(), identity);

    writer.set_sequence_for_test(u64::MAX);

    let err = writer.emit(
        1000,
        ServerIdleSuspendEventTypeV1::CoordinatorStarted,
        None,
        None,
        IdleSuspendEventDataV1::CoordinatorStarted(CoordinatorStartedDataV1 {
            automatic_policy: AutomaticPolicyV1::EmptyFleet,
            quiet_period_seconds: 900,
            wake_after_seconds: 600,
            timing_revision: 1,
            status_revision: 1,
        }),
    );
    assert!(matches!(err, Err(EventWriteError::SequenceOverflow)));

    // Subsequent writes must fail with Disabled
    let err2 = writer.emit(
        2000,
        ServerIdleSuspendEventTypeV1::MeasurementUnavailable,
        None,
        None,
        IdleSuspendEventDataV1::MeasurementUnavailable(MeasurementUnavailableDataV1 {
            reason_code: ServerIdleSuspendReasonCodeV1::MeasurementUnavailable,
        }),
    );
    assert!(matches!(err2, Err(EventWriteError::Disabled)));
}

#[test]
fn event_writer_security_checks() {
    use std::os::unix::fs::PermissionsExt;

    let tmp = tempdir().unwrap();
    let identity = make_test_identity();

    // 1. Missing parent directory rejected
    let missing_parent = tmp.path().join("nonexistent-dir").join("events.jsonl");
    let writer1 = IdleSuspendEventWriter::with_identity(missing_parent, identity.clone());
    let err1 = writer1.emit(
        1000,
        ServerIdleSuspendEventTypeV1::CoordinatorStarted,
        None,
        None,
        IdleSuspendEventDataV1::CoordinatorStarted(CoordinatorStartedDataV1 {
            automatic_policy: AutomaticPolicyV1::EmptyFleet,
            quiet_period_seconds: 900,
            wake_after_seconds: 600,
            timing_revision: 1,
            status_revision: 1,
        }),
    );
    assert!(matches!(err1, Err(EventWriteError::ParentPathRejected)));

    // 2. Parent directory with mode 0755 rejected
    let unsafe_parent_dir = tmp.path().join("unsafe-diag");
    fs::create_dir(&unsafe_parent_dir).unwrap();
    fs::set_permissions(&unsafe_parent_dir, fs::Permissions::from_mode(0o755)).unwrap();
    let writer2 = IdleSuspendEventWriter::with_identity(unsafe_parent_dir.join("events.jsonl"), identity.clone());
    let err2 = writer2.emit(
        1000,
        ServerIdleSuspendEventTypeV1::CoordinatorStarted,
        None,
        None,
        IdleSuspendEventDataV1::CoordinatorStarted(CoordinatorStartedDataV1 {
            automatic_policy: AutomaticPolicyV1::EmptyFleet,
            quiet_period_seconds: 900,
            wake_after_seconds: 600,
            timing_revision: 1,
            status_revision: 1,
        }),
    );
    assert!(matches!(err2, Err(EventWriteError::ParentPathRejected)));

    // 3. Symlink target rejected
    let safe_diag_dir = setup_trusted_diagnostics_dir(&tmp);
    let real_target = tmp.path().join("real-events.jsonl");
    fs::write(&real_target, b"").unwrap();
    fs::set_permissions(&real_target, fs::Permissions::from_mode(0o600)).unwrap();
    std::os::unix::fs::symlink(&real_target, &safe_diag_dir).unwrap();

    let writer3 = IdleSuspendEventWriter::with_identity(safe_diag_dir.clone(), identity.clone());
    let err3 = writer3.emit(
        1000,
        ServerIdleSuspendEventTypeV1::CoordinatorStarted,
        None,
        None,
        IdleSuspendEventDataV1::CoordinatorStarted(CoordinatorStartedDataV1 {
            automatic_policy: AutomaticPolicyV1::EmptyFleet,
            quiet_period_seconds: 900,
            wake_after_seconds: 600,
            timing_revision: 1,
            status_revision: 1,
        }),
    );
    assert!(matches!(err3, Err(EventWriteError::FileSecurityRejected)));
}

#[test]
fn event_producer_identity_boot_id_reader() {
    let tmp = tempdir().unwrap();
    let fake_boot_id_path = tmp.path().join("boot_id");

    // Valid canonical UUID with trailing newline
    fs::write(&fake_boot_id_path, b"8f03c004-bb50-4822-9218-d75b34091a92\n").unwrap();
    let id = ProducerIdentity::load_from_path(&fake_boot_id_path).unwrap();
    assert_eq!(id.boot_id, "8f03c004-bb50-4822-9218-d75b34091a92");
    assert!(validate_canonical_uuid_v4(&id.producer_instance_id).is_ok());

    // Invalid boot ID
    fs::write(&fake_boot_id_path, b"invalid-boot-id\n").unwrap();
    assert!(matches!(ProducerIdentity::load_from_path(&fake_boot_id_path), Err(EventWriteError::BootIdInvalid(_))));
}

#[test]
fn event_writer_restart_creates_new_identity_and_resets_sequence() {
    let tmp = tempdir().unwrap();
    let event_path = setup_trusted_diagnostics_dir(&tmp);

    let id1 = ProducerIdentity::with_ids(
        "8f03c004-bb50-4822-9218-d75b34091a92".to_string(),
        uuid::Uuid::new_v4().to_string(),
    ).unwrap();
    let writer1 = IdleSuspendEventWriter::with_identity(event_path.clone(), id1.clone());
    let e1 = writer1.emit(
        1000,
        ServerIdleSuspendEventTypeV1::CoordinatorStarted,
        None,
        None,
        IdleSuspendEventDataV1::CoordinatorStarted(CoordinatorStartedDataV1 {
            automatic_policy: AutomaticPolicyV1::EmptyFleet,
            quiet_period_seconds: 900,
            wake_after_seconds: 600,
            timing_revision: 1,
            status_revision: 1,
        }),
    ).unwrap();
    assert_eq!(e1.producer_sequence, 1);

    // Process restart: new instance ID, sequence resets to 1
    let id2 = ProducerIdentity::with_ids(
        id1.boot_id.clone(),
        uuid::Uuid::new_v4().to_string(),
    ).unwrap();
    assert_ne!(id1.producer_instance_id, id2.producer_instance_id);

    let writer2 = IdleSuspendEventWriter::with_identity(event_path.clone(), id2.clone());
    let e2 = writer2.emit(
        2000,
        ServerIdleSuspendEventTypeV1::CoordinatorStarted,
        None,
        None,
        IdleSuspendEventDataV1::CoordinatorStarted(CoordinatorStartedDataV1 {
            automatic_policy: AutomaticPolicyV1::EmptyFleet,
            quiet_period_seconds: 900,
            wake_after_seconds: 600,
            timing_revision: 2,
            status_revision: 1,
        }),
    ).unwrap();
    assert_eq!(e2.producer_sequence, 1);
    assert_eq!(e2.producer_instance_id, id2.producer_instance_id);
}
fn read_emitted_events(path: &std::path::Path) -> Vec<IdleSuspendEventEnvelopeV1> {
    if !path.exists() {
        return Vec::new();
    }
    let content = std::fs::read_to_string(path).unwrap();
    content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}

#[tokio::test]
async fn test_coordinator_events_quiet_automatic_empty_fleet_success() {
    tokio::time::pause();

    let tmp = tempdir().unwrap();
    let event_path = setup_trusted_diagnostics_dir(&tmp);
    let identity = make_test_identity();
    let writer = Arc::new(IdleSuspendEventWriter::with_identity(event_path.clone(), identity));

    let policy = create_test_policy(tmp.path(), true);
    let timing = Arc::new(RwLock::new(RuntimeIdleSuspendTiming::new(60, 600).unwrap()));
    let pty_manager = PtySessionManager::new(Arc::new(crate::pty::event_sink::NoopEventSink));
    let executor = Arc::new(FakeExecutor::new(true));

    let coordinator = IdleSuspendCoordinator::start_with_writer(
        policy,
        timing,
        None,
        None,
        executor.clone(),
        pty_manager.clone(),
        Some(writer),
    );
    let mut status_rx = coordinator.subscribe_status();

    // Initial event: CoordinatorStarted
    tokio::task::yield_now().await;
    let events = read_emitted_events(&event_path);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].event_type, ServerIdleSuspendEventTypeV1::CoordinatorStarted);
    assert_eq!(events[0].producer_sequence, 1);

    // Trigger fleet non-quiescence, then quiescence
    pty_manager.with_fleet_for_test(|fleet| {
        fleet.begin_create("t1", 1).unwrap();
        fleet.publish_live("t1", 1);
    });
    while status_rx.borrow().fleet_snapshot.live_count != 1 {
        status_rx.changed().await.unwrap();
    }

    pty_manager.with_fleet_for_test(|fleet| {
        fleet.remove_live("t1", 1);
    });
    while status_rx.borrow().state != CoordinatorState::Armed {
        status_rx.changed().await.unwrap();
    }

    // Armed: AttemptStarted, ArmStarted
    let events = read_emitted_events(&event_path);
    assert_eq!(events.len(), 3);
    assert_eq!(events[1].event_type, ServerIdleSuspendEventTypeV1::AttemptStarted);
    assert_eq!(events[2].event_type, ServerIdleSuspendEventTypeV1::ArmStarted);
    let attempt_id = events[1].correlation_id.as_ref().unwrap();
    assert_eq!(events[2].correlation_id.as_ref().unwrap(), attempt_id);
    assert_eq!(events[1].producer_sequence, 2);
    assert_eq!(events[2].producer_sequence, 3);

    // Advance to deadline -> FinalCheckStarted, FinalCheckCompleted, HandoffClaimAccepted, HelperRequestDispatched
    // and then outcome: HelperOutcomeReceived, ReconciliationCompleted
    tokio::time::advance(std::time::Duration::from_secs(65)).await;
    while status_rx.borrow().state != CoordinatorState::Resumed {
        status_rx.changed().await.unwrap();
    }

    let events = read_emitted_events(&event_path);
    assert_eq!(events.len(), 9);
    assert_eq!(events[3].event_type, ServerIdleSuspendEventTypeV1::FinalCheckStarted);
    assert_eq!(events[4].event_type, ServerIdleSuspendEventTypeV1::FinalCheckCompleted);
    assert_eq!(events[5].event_type, ServerIdleSuspendEventTypeV1::HandoffClaimAccepted);
    assert_eq!(events[6].event_type, ServerIdleSuspendEventTypeV1::HelperRequestDispatched);
    assert_eq!(events[7].event_type, ServerIdleSuspendEventTypeV1::HelperOutcomeReceived);
    assert_eq!(events[8].event_type, ServerIdleSuspendEventTypeV1::ReconciliationCompleted);

    // Verify all attempt events share identical UUID correlation_id
    for ev in &events[1..9] {
        assert_eq!(ev.correlation_id.as_ref().unwrap(), attempt_id);
    }
    // Verify strictly monotonic sequences
    for (i, ev) in events.iter().enumerate() {
        assert_eq!(ev.producer_sequence, (i + 1) as u64);
    }

    // Advance further — no extra events!
    tokio::time::advance(std::time::Duration::from_secs(100)).await;
    tokio::task::yield_now().await;
    let events_after = read_emitted_events(&event_path);
    assert_eq!(events_after.len(), 9);

    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_coordinator_events_empty_fleet_arm_cancelled_by_active_fleet() {
    tokio::time::pause();

    let tmp = tempdir().unwrap();
    let event_path = setup_trusted_diagnostics_dir(&tmp);
    let identity = make_test_identity();
    let writer = Arc::new(IdleSuspendEventWriter::with_identity(event_path.clone(), identity));

    let policy = create_test_policy(tmp.path(), true);
    let timing = Arc::new(RwLock::new(RuntimeIdleSuspendTiming::new(60, 600).unwrap()));
    let pty_manager = PtySessionManager::new(Arc::new(crate::pty::event_sink::NoopEventSink));
    let executor = Arc::new(FakeExecutor::new(true));

    let coordinator = IdleSuspendCoordinator::start_with_writer(
        policy,
        timing,
        None,
        None,
        executor,
        pty_manager.clone(),
        Some(writer),
    );
    let mut status_rx = coordinator.subscribe_status();

    tokio::task::yield_now().await;

    // Non-quiescent then quiescent to arm
    pty_manager.with_fleet_for_test(|fleet| {
        fleet.begin_create("t1", 1).unwrap();
        fleet.publish_live("t1", 1);
    });
    while status_rx.borrow().fleet_snapshot.live_count != 1 {
        status_rx.changed().await.unwrap();
    }
    pty_manager.with_fleet_for_test(|fleet| {
        fleet.remove_live("t1", 1);
    });
    while status_rx.borrow().state != CoordinatorState::Armed {
        status_rx.changed().await.unwrap();
    }

    // Spawn new PTY during armed countdown -> active fleet cancellation
    pty_manager.with_fleet_for_test(|fleet| {
        fleet.begin_create("t2", 2).unwrap();
        fleet.publish_live("t2", 2);
    });
    while status_rx.borrow().state != CoordinatorState::Watching {
        status_rx.changed().await.unwrap();
    }

    let events = read_emitted_events(&event_path);
    assert_eq!(events.len(), 5);
    assert_eq!(events[0].event_type, ServerIdleSuspendEventTypeV1::CoordinatorStarted);
    assert_eq!(events[1].event_type, ServerIdleSuspendEventTypeV1::AttemptStarted);
    assert_eq!(events[2].event_type, ServerIdleSuspendEventTypeV1::ArmStarted);
    assert_eq!(events[3].event_type, ServerIdleSuspendEventTypeV1::ArmCancelled);
    assert_eq!(events[4].event_type, ServerIdleSuspendEventTypeV1::TerminalRejected);

    let corr = events[1].correlation_id.as_ref().unwrap();
    assert_eq!(events[3].correlation_id.as_ref().unwrap(), corr);
    assert_eq!(events[4].correlation_id.as_ref().unwrap(), corr);

    if let IdleSuspendEventDataV1::ArmCancelled(data) = &events[3].data {
        assert_eq!(data.reason_code, ServerIdleSuspendReasonCodeV1::ActiveFleet);
    } else {
        panic!("Expected ArmCancelled");
    }

    if let IdleSuspendEventDataV1::TerminalRejected(data) = &events[4].data {
        assert_eq!(data.reason_code, ServerIdleSuspendReasonCodeV1::ActiveFleet);
    } else {
        panic!("Expected TerminalRejected");
    }

    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_coordinator_events_manual_force_suspend_accepted_flow() {
    let tmp = tempdir().unwrap();
    let event_path = setup_trusted_diagnostics_dir(&tmp);
    let identity = make_test_identity();
    let writer = Arc::new(IdleSuspendEventWriter::with_identity(event_path.clone(), identity));

    let policy = create_test_policy(tmp.path(), true);
    let timing = Arc::new(RwLock::new(RuntimeIdleSuspendTiming::new(300, 600).unwrap()));
    let pty_manager = PtySessionManager::new(Arc::new(crate::pty::event_sink::NoopEventSink));
    let executor = Arc::new(FakeExecutor::new(true));

    let audit_file = tmp.path().join("idle-suspend-audit.jsonl");
    let server_audit = preprovisioned_server_audit(audit_file.clone());

    let coordinator = IdleSuspendCoordinator::start_with_writer(
        policy,
        timing,
        None,
        Some(server_audit.clone()),
        executor.clone(),
        pty_manager,
        Some(writer),
    );

    tokio::task::yield_now().await;

    let cmd = ForceSuspendCommand {
        actor: "admin".to_string(),
        wake_after_seconds: 600,
        force: false,
    };

    let res = coordinator.force_suspend(cmd).await;
    let req_id = match res {
        CoordinatorForceSuspendResult::Accepted { request_id, .. } => {
            assert!(validate_canonical_uuid_v4(&request_id).is_ok());
            request_id
        }
        other => panic!("Expected Accepted, got: {other:?}"),
    };

    // Wait for in-flight executor to finish
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let events = read_emitted_events(&event_path);
    assert_eq!(events.len(), 6);
    assert_eq!(events[0].event_type, ServerIdleSuspendEventTypeV1::CoordinatorStarted);
    assert_eq!(events[1].event_type, ServerIdleSuspendEventTypeV1::AttemptStarted);
    assert_eq!(events[2].event_type, ServerIdleSuspendEventTypeV1::HandoffClaimAccepted);
    assert_eq!(events[3].event_type, ServerIdleSuspendEventTypeV1::HelperRequestDispatched);
    assert_eq!(events[4].event_type, ServerIdleSuspendEventTypeV1::HelperOutcomeReceived);
    assert_eq!(events[5].event_type, ServerIdleSuspendEventTypeV1::ReconciliationCompleted);

    // Exact UUID matches across events, audit, and executor request
    for ev in &events[1..6] {
        assert_eq!(ev.correlation_id.as_ref().unwrap(), &req_id);
        assert_eq!(ev.mode, Some(IdleSuspendModeV1::Manual));
    }

    let recorded = executor.recorded_requests();
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0].request_id, req_id);

    let audits = server_audit.read_recent_manual_records(10).unwrap();
    assert!(!audits.is_empty());
    assert_eq!(audits.last().unwrap().request_id, req_id);

    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_coordinator_events_manual_force_suspend_rejections() {
    let tmp = tempdir().unwrap();
    let event_path = setup_trusted_diagnostics_dir(&tmp);
    let identity = make_test_identity();
    let writer = Arc::new(IdleSuspendEventWriter::with_identity(event_path.clone(), identity));

    let policy = create_test_policy(tmp.path(), true);
    let timing = Arc::new(RwLock::new(RuntimeIdleSuspendTiming::new(300, 600).unwrap()));
    let pty_manager = PtySessionManager::new(Arc::new(crate::pty::event_sink::NoopEventSink));
    let executor = Arc::new(FakeExecutor::new(false)); // Capability fails!

    let coordinator = IdleSuspendCoordinator::start_with_writer(
        policy,
        timing,
        None,
        None,
        executor,
        pty_manager,
        Some(writer),
    );

    tokio::task::yield_now().await;

    // 1. Capability failure
    let cmd1 = ForceSuspendCommand {
        actor: "admin".to_string(),
        wake_after_seconds: 600,
        force: false,
    };
    let res1 = coordinator.force_suspend(cmd1).await;
    assert!(matches!(res1, CoordinatorForceSuspendResult::CapabilityUnavailable(_)));

    let events = read_emitted_events(&event_path);
    assert_eq!(events.len(), 3);
    assert_eq!(events[0].event_type, ServerIdleSuspendEventTypeV1::CoordinatorStarted);
    assert_eq!(events[1].event_type, ServerIdleSuspendEventTypeV1::AttemptStarted);
    assert_eq!(events[2].event_type, ServerIdleSuspendEventTypeV1::TerminalRejected);
    if let IdleSuspendEventDataV1::TerminalRejected(data) = &events[2].data {
        assert_eq!(data.reason_code, ServerIdleSuspendReasonCodeV1::CapabilityUnsupported);
    } else {
        panic!("Expected TerminalRejected");
    }

    // 2. Validation failure: wake_after_seconds out of bounds (e.g. 10)
    // Basic input validation fails before attempt admission; no new attempt events emitted.
    let cmd2 = ForceSuspendCommand {
        actor: "admin".to_string(),
        wake_after_seconds: 10,
        force: false,
    };
    let res2 = coordinator.force_suspend(cmd2).await;
    assert!(matches!(res2, CoordinatorForceSuspendResult::ValidationFailed(_)));

    let events2 = read_emitted_events(&event_path);
    assert_eq!(events2.len(), 3); // Still 3 events
    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_coordinator_events_shutdown_while_armed() {
    tokio::time::pause();

    let tmp = tempdir().unwrap();
    let event_path = setup_trusted_diagnostics_dir(&tmp);
    let identity = make_test_identity();
    let writer = Arc::new(IdleSuspendEventWriter::with_identity(event_path.clone(), identity));

    let policy = create_test_policy(tmp.path(), true);
    let timing = Arc::new(RwLock::new(RuntimeIdleSuspendTiming::new(60, 600).unwrap()));
    let pty_manager = PtySessionManager::new(Arc::new(crate::pty::event_sink::NoopEventSink));
    let executor = Arc::new(FakeExecutor::new(true));

    let coordinator = IdleSuspendCoordinator::start_with_writer(
        policy,
        timing,
        None,
        None,
        executor,
        pty_manager.clone(),
        Some(writer),
    );
    let mut status_rx = coordinator.subscribe_status();

    tokio::task::yield_now().await;

    // Arm
    pty_manager.with_fleet_for_test(|fleet| {
        fleet.begin_create("t1", 1).unwrap();
        fleet.publish_live("t1", 1);
    });
    while status_rx.borrow().fleet_snapshot.live_count != 1 {
        status_rx.changed().await.unwrap();
    }
    pty_manager.with_fleet_for_test(|fleet| {
        fleet.remove_live("t1", 1);
    });
    while status_rx.borrow().state != CoordinatorState::Armed {
        status_rx.changed().await.unwrap();
    }

    // Shutdown while Armed
    coordinator.shutdown().await;

    let events = read_emitted_events(&event_path);
    assert_eq!(events.len(), 5);
    assert_eq!(events[3].event_type, ServerIdleSuspendEventTypeV1::ArmCancelled);
    assert_eq!(events[4].event_type, ServerIdleSuspendEventTypeV1::TerminalRejected);
    if let IdleSuspendEventDataV1::ArmCancelled(data) = &events[3].data {
        assert_eq!(data.reason_code, ServerIdleSuspendReasonCodeV1::Shutdown);
    }
    if let IdleSuspendEventDataV1::TerminalRejected(data) = &events[4].data {
        assert_eq!(data.reason_code, ServerIdleSuspendReasonCodeV1::Shutdown);
    }
}
#[tokio::test]
async fn test_coordinator_events_manual_force_suspend_active_fleet_rejection() {
    let tmp = tempdir().unwrap();
    let event_path = setup_trusted_diagnostics_dir(&tmp);
    let identity = make_test_identity();
    let writer = Arc::new(IdleSuspendEventWriter::with_identity(event_path.clone(), identity));

    let policy = create_test_policy(tmp.path(), true);
    let timing = Arc::new(RwLock::new(RuntimeIdleSuspendTiming::new(300, 600).unwrap()));
    let pty_manager = PtySessionManager::new(Arc::new(crate::pty::event_sink::NoopEventSink));
    let executor = Arc::new(FakeExecutor::new(true));

    let audit_file = tmp.path().join("idle-suspend-audit.jsonl");
    let server_audit = preprovisioned_server_audit(audit_file.clone());

    // Create an active session
    pty_manager.with_fleet_for_test(|fleet| {
        fleet.begin_create("active-term", 1).unwrap();
        fleet.publish_live("active-term", 1);
    });

    let coordinator = IdleSuspendCoordinator::start_with_writer(
        policy,
        timing,
        None,
        Some(server_audit),
        executor,
        pty_manager,
        Some(writer),
    );

    tokio::task::yield_now().await;

    // Command without force -> active fleet requires confirmation!
    let cmd = ForceSuspendCommand {
        actor: "admin".to_string(),
        wake_after_seconds: 600,
        force: false,
    };

    let res = coordinator.force_suspend(cmd).await;
    assert!(matches!(res, CoordinatorForceSuspendResult::ActiveFleetRequiresConfirmation { .. }));

    let events = read_emitted_events(&event_path);
    assert_eq!(events.len(), 3);
    assert_eq!(events[0].event_type, ServerIdleSuspendEventTypeV1::CoordinatorStarted);
    assert_eq!(events[1].event_type, ServerIdleSuspendEventTypeV1::AttemptStarted);
    assert_eq!(events[2].event_type, ServerIdleSuspendEventTypeV1::TerminalRejected);
    if let IdleSuspendEventDataV1::TerminalRejected(data) = &events[2].data {
        assert_eq!(data.reason_code, ServerIdleSuspendReasonCodeV1::ActiveFleet);
    } else {
        panic!("Expected TerminalRejected with ActiveFleet");
    }

    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_coordinator_events_agent_activity_measurement_availability_transitions() {
    use crate::idle_suspend::activity::process::tests::MockProcessSource;
    use crate::idle_suspend::activity::tcp::tests::FakeDiagnosticsSource;
    use crate::idle_suspend::activity::ActivitySampler;
    use tokio::sync::mpsc;

    let tmp = tempdir().unwrap();
    let event_path = setup_trusted_diagnostics_dir(&tmp);
    let identity = make_test_identity();
    let writer = Arc::new(IdleSuspendEventWriter::with_identity(event_path.clone(), identity));

    let mut policy = create_test_policy(tmp.path(), true);
    policy.automatic_policy = crate::config::IdleSuspendAutomaticPolicy::AgentActivity;
    let timing = Arc::new(RwLock::new(RuntimeIdleSuspendTiming::new(300, 600).unwrap()));
    let pty_manager = PtySessionManager::new(Arc::new(crate::pty::event_sink::NoopEventSink));
    let executor = Arc::new(FakeExecutor::new(true));

    let proc_source = MockProcessSource::new();
    let diag_source = FakeDiagnosticsSource {
        result: Some(Err(crate::idle_suspend::activity::ActivityUnavailable::new(
            crate::idle_suspend::activity::ActivityUnavailableReason::SocketDiagnostics,
        ))),
    };

    let (tx, rx) = mpsc::channel(16);
    let sampler = ActivitySampler::with_sources(
        Arc::new(pty_manager.clone()),
        Arc::clone(&policy.agent_executables),
        tx,
        proc_source,
        diag_source,
    );

    let coordinator = IdleSuspendCoordinator::start_with_sampler(
        policy,
        timing,
        None,
        None,
        executor,
        pty_manager,
        None,
        sampler,
        rx,
        Some(writer),
    );

    // Initial background tick -> unavailable sample
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let events = read_emitted_events(&event_path);
    // Should have CoordinatorStarted and exactly ONE MeasurementUnavailable
    assert!(events.len() >= 2);
    assert_eq!(events[0].event_type, ServerIdleSuspendEventTypeV1::CoordinatorStarted);
    assert_eq!(events[1].event_type, ServerIdleSuspendEventTypeV1::MeasurementUnavailable);

    let count_before = events.len();

    // Trigger another unavailable tick -> must NOT emit duplicate MeasurementUnavailable!
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    let events_after = read_emitted_events(&event_path);
    assert_eq!(events_after.len(), count_before, "Repeated unavailable sample must not emit duplicate event");

    coordinator.shutdown().await;
}
#[tokio::test]
async fn test_coordinator_events_process_restart_safe_ids() {
    tokio::time::pause();

    let tmp = tempdir().unwrap();
    let event_path = setup_trusted_diagnostics_dir(&tmp);

    // Instance 1: initial process boot
    let identity1 = ProducerIdentity::with_ids(
        "8f03c004-bb50-4822-9218-d75b34091a92".to_string(),
        "11111111-1111-4111-8111-111111111111".to_string(),
    )
    .unwrap();
    let writer1 = Arc::new(IdleSuspendEventWriter::with_identity(event_path.clone(), identity1));

    let policy1 = create_test_policy(tmp.path(), true);
    let timing1 = Arc::new(RwLock::new(RuntimeIdleSuspendTiming::new(60, 600).unwrap()));
    let pty_manager1 = PtySessionManager::new(Arc::new(crate::pty::event_sink::NoopEventSink));
    let executor1 = Arc::new(FakeExecutor::new(true));

    let coordinator1 = IdleSuspendCoordinator::start_with_writer(
        policy1,
        timing1,
        None,
        None,
        executor1.clone(),
        pty_manager1.clone(),
        Some(writer1),
    );
    let mut status_rx1 = coordinator1.subscribe_status();

    // Trigger an attempt in instance 1: fleet active then quiescent
    pty_manager1.with_fleet_for_test(|fleet| {
        fleet.begin_create("t1", 1).unwrap();
        fleet.publish_live("t1", 1);
    });
    while status_rx1.borrow().fleet_snapshot.live_count != 1 {
        status_rx1.changed().await.unwrap();
    }
    pty_manager1.with_fleet_for_test(|fleet| {
        fleet.remove_live("t1", 1);
    });
    while status_rx1.borrow().state != CoordinatorState::Armed {
        status_rx1.changed().await.unwrap();
    }

    // Advance to suspend and resume
    tokio::time::advance(std::time::Duration::from_secs(65)).await;
    while status_rx1.borrow().state != CoordinatorState::Resumed {
        status_rx1.changed().await.unwrap();
    }

    coordinator1.shutdown().await;

    let events_inst1 = read_emitted_events(&event_path);
    assert_eq!(events_inst1.len(), 9);
    let corr1 = events_inst1[1].correlation_id.clone().unwrap();
    assert!(validate_canonical_uuid_v4(&corr1).is_ok());

    // Instance 2: simulated API process restart writing to SAME event log
    let identity2 = ProducerIdentity::with_ids(
        "8f03c004-bb50-4822-9218-d75b34091a92".to_string(), // Same boot ID
        "22222222-2222-4222-8222-222222222222".to_string(), // NEW process instance ID
    )
    .unwrap();
    let writer2 = Arc::new(IdleSuspendEventWriter::with_identity(event_path.clone(), identity2));

    let policy2 = create_test_policy(tmp.path(), true);
    let timing2 = Arc::new(RwLock::new(RuntimeIdleSuspendTiming::new(60, 600).unwrap()));
    let pty_manager2 = PtySessionManager::new(Arc::new(crate::pty::event_sink::NoopEventSink));
    let executor2 = Arc::new(FakeExecutor::new(true));

    let coordinator2 = IdleSuspendCoordinator::start_with_writer(
        policy2,
        timing2,
        None,
        None,
        executor2.clone(),
        pty_manager2.clone(),
        Some(writer2),
    );
    let mut status_rx2 = coordinator2.subscribe_status();

    // Trigger an attempt in instance 2
    pty_manager2.with_fleet_for_test(|fleet| {
        fleet.begin_create("t2", 1).unwrap();
        fleet.publish_live("t2", 1);
    });
    while status_rx2.borrow().fleet_snapshot.live_count != 1 {
        status_rx2.changed().await.unwrap();
    }
    pty_manager2.with_fleet_for_test(|fleet| {
        fleet.remove_live("t2", 1);
    });
    while status_rx2.borrow().state != CoordinatorState::Armed {
        status_rx2.changed().await.unwrap();
    }

    tokio::time::advance(std::time::Duration::from_secs(65)).await;
    while status_rx2.borrow().state != CoordinatorState::Resumed {
        status_rx2.changed().await.unwrap();
    }

    coordinator2.shutdown().await;

    // All events across both process lifetimes in same file:
    let all_events = read_emitted_events(&event_path);
    assert_eq!(all_events.len(), 18, "Must contain 9 events from instance 1 + 9 events from instance 2");

    // 1. First event of Instance 2 is CoordinatorStarted with sequence 1 and new producer instance ID
    let inst2_start = &all_events[9];
    assert_eq!(inst2_start.event_type, ServerIdleSuspendEventTypeV1::CoordinatorStarted);
    assert_eq!(inst2_start.producer_sequence, 1, "Producer sequence must reset on process restart");
    assert_eq!(inst2_start.producer_instance_id, "22222222-2222-4222-8222-222222222222");

    // 2. Correlation ID for instance 2 attempt
    let corr2 = all_events[10].correlation_id.clone().unwrap();
    assert!(validate_canonical_uuid_v4(&corr2).is_ok());

    // 3. Invariant: Action Correlation IDs MUST NOT collide across process restarts (unlike legacy epoch-1)
    assert_ne!(corr1, corr2, "Action UUIDs must be strictly distinct across restarts");

    // 4. Executor requests in instance 1 and instance 2 receive exact distinct UUIDs
    let reqs1 = executor1.recorded_requests();
    let reqs2 = executor2.recorded_requests();
    assert_eq!(reqs1[0].request_id, corr1);
    assert_eq!(reqs2[0].request_id, corr2);
    assert_ne!(reqs1[0].request_id, reqs2[0].request_id, "No ID collision across restarts");
}
