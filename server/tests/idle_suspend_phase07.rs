use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use tempfile::TempDir;

use dam_hopper_server::{
    agent_store::AgentStoreService,
    config::{
        DamHopperConfig, FeaturesConfig, GlobalConfig, IdleSuspendConfig,
        RestartPolicy, ServerConfig, WorkspaceInfo, DEFAULT_RESTART_MAX_RETRIES,
    },
    crypto::DamHopperOpaqueSuite,
    diagnostics::DiagnosticStore,
    fs::FsSubsystem,
    idle_suspend::{
        coordinator::{CoordinatorForceSuspendResult, ForceSuspendCommand},
        executor::FakeExecutor,
        status::CoordinatorState,
        validate_canonical_uuid_v4, IdleSuspendEventEnvelopeV1,
        IdleSuspendModeV1, ServerAuditRecord,
        ServerIdleSuspendEventTypeV1,
    },
    pty::{BroadcastEventSink, PtyCreateOpts, PtySessionManager},
    state::AppState,
    telemetry::TelemetryRuntime,
};

#[path = "common/mod.rs"]
mod common;

const TEST_SECRET: &str = "test-secret-jwt-key-12345";


fn make_pty_opts(id: &str, command: &str) -> PtyCreateOpts {
    let mut env = HashMap::new();
    env.insert("TERM".into(), "xterm-256color".into());
    env.insert("HOME".into(), std::env::var("HOME").unwrap_or_default());
    let command = if command == "cat" {
        common::read_stdin_command().to_string()
    } else {
        command.to_string()
    };
    PtyCreateOpts {
        id: id.to_string(),
        command,
        cwd: common::test_temp_cwd(),
        env,
        cols: 80,
        rows: 24,
        project: None,
        worktree_path: None,
        name: None,
        restart_policy: RestartPolicy::Never,
        restart_max_retries: DEFAULT_RESTART_MAX_RETRIES,
    }
}

struct TestFixture {
    pub _tmp: TempDir,
    pub state: AppState,
}

fn setup_test_fixture(idle_enabled: bool, quiet: u64, wake: u64) -> TestFixture {
    let tmp = tempfile::tempdir().expect("tempdir");
    let workspace_dir = tmp.path().to_path_buf();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&workspace_dir, std::fs::Permissions::from_mode(0o700));
    }
    let config_path = workspace_dir.join("dam-hopper.toml");

    let initial_toml = format!(
        r#"[workspace]
name = "test-idle-suspend-ws"

[server.idle_suspend]
enabled = {}
quiet_period_seconds = {}
wake_after_seconds = {}
"#,
        idle_enabled, quiet, wake
    );
    std::fs::write(&config_path, initial_toml).expect("write initial toml");

    {
        let mut opts = std::fs::OpenOptions::new();
        opts.create(true).write(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let _ = opts
            .open(workspace_dir.join("idle-suspend-audit.jsonl"))
            .expect("preprovision audit log");
    }

    let (event_sink, _rx) = BroadcastEventSink::new(512);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));

    let mut config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test-idle-suspend-ws".into(),
            root: workspace_dir.display().to_string(),
        },
        agent_store: None,
        server: ServerConfig {
            idle_suspend: IdleSuspendConfig {
                enabled: idle_enabled,
                quiet_period_seconds: quiet,
                wake_after_seconds: wake,
                ..Default::default()
            },
            ..Default::default()
        },
        projects: vec![],
        features: FeaturesConfig::default(),
        config_path,
    };
    config.server.telemetry.db_path = tmp.path().join("telemetry.db").display().to_string();

    let agent_store = AgentStoreService::new(workspace_dir.join(".dam-hopper/agent-store"));
    let fs = FsSubsystem::new(vec![]);
    let tunnel_manager = common::make_tunnel_manager(&event_sink);
    let diagnostics = DiagnosticStore::new(workspace_dir.join("diagnostics.jsonl"));

    let state = AppState::new(
        workspace_dir,
        config,
        GlobalConfig::default(),
        pty_manager,
        agent_store,
        event_sink,
        TEST_SECRET.to_string(),
        fs,
        None,
        false,
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
        TelemetryRuntime::new(),
    )
    .expect("AppState::new");

    TestFixture { _tmp: tmp, state }
}

#[tokio::test]
async fn test_idle_suspend_phase07_cross_layer_automatic_chain_and_rejections() {
    tokio::time::pause();

    let fixture = setup_test_fixture(true, 60, 60);
    let fake_executor = Arc::new(FakeExecutor::new(true));

    let coordinator = fixture
        .state
        .start_idle_suspend_coordinator(fake_executor.clone())
        .await;

    // Transition fleet from active to quiescent to arm the coordinator
    fixture.state.pty_manager.with_fleet_for_test(|fleet| {
        fleet.begin_create("session-1", 1).unwrap();
        fleet.publish_live("session-1", 1);
    });
    tokio::task::yield_now().await;
    fixture.state.pty_manager.with_fleet_for_test(|fleet| {
        fleet.remove_live("session-1", 1);
    });
    tokio::task::yield_now().await;
    assert_eq!(coordinator.status().state, CoordinatorState::Armed);

    // Fast-forward past arm deadline to trigger FinalCheck and automatic suspend
    tokio::time::advance(Duration::from_secs(61)).await;
    tokio::task::yield_now().await;

    assert_eq!(
        fake_executor.recorded_requests().len(),
        1,
        "FakeExecutor must have recorded exactly one suspend request"
    );

    let event_path = fixture._tmp.path().join("idle-suspend-events-v1.jsonl");
    assert!(event_path.exists());
    let raw_events = std::fs::read_to_string(&event_path).expect("read events");
    let event_lines: Vec<&str> = raw_events.lines().filter(|l| !l.trim().is_empty()).collect();

    assert!(!raw_events.contains(TEST_SECRET), "Event log must not contain JWT test secret");
    assert!(!raw_events.contains("damhopper-auth"), "Event log must not contain auth cookie names");

    let parsed_events: Vec<IdleSuspendEventEnvelopeV1> = event_lines
        .iter()
        .map(|l| serde_json::from_str(l).expect("parse IdleSuspendEventEnvelopeV1"))
        .collect();

    for (i, ev) in parsed_events.iter().enumerate() {
        assert_eq!(ev.producer_sequence, (i + 1) as u64);
        assert_eq!(ev.event_schema_version, 1);
        validate_canonical_uuid_v4(&ev.boot_id).expect("valid boot_id");
        validate_canonical_uuid_v4(&ev.producer_instance_id).expect("valid producer_instance_id");
    }

    assert_eq!(parsed_events[0].event_type, ServerIdleSuspendEventTypeV1::CoordinatorStarted);
    assert_eq!(parsed_events[0].correlation_id, None);
    assert_eq!(parsed_events[0].mode, None);

    assert_eq!(parsed_events[1].event_type, ServerIdleSuspendEventTypeV1::AttemptStarted);
    assert_eq!(parsed_events[1].mode, Some(IdleSuspendModeV1::Automatic));
    let attempt_corr_id = parsed_events[1].correlation_id.clone().expect("must have correlation_id");

    for ev in &parsed_events[1..] {
        if let Some(corr) = &ev.correlation_id {
            assert_eq!(corr, &attempt_corr_id);
        }
        if let Some(m) = ev.mode {
            assert_eq!(m, IdleSuspendModeV1::Automatic);
        }
    }

    let types: Vec<ServerIdleSuspendEventTypeV1> = parsed_events.iter().map(|e| e.event_type).collect();
    assert!(types.contains(&ServerIdleSuspendEventTypeV1::ArmStarted));
    assert!(types.contains(&ServerIdleSuspendEventTypeV1::FinalCheckStarted));
    assert!(types.contains(&ServerIdleSuspendEventTypeV1::FinalCheckCompleted));
    assert!(types.contains(&ServerIdleSuspendEventTypeV1::HandoffClaimAccepted));
    assert!(types.contains(&ServerIdleSuspendEventTypeV1::HelperRequestDispatched));
    assert!(types.contains(&ServerIdleSuspendEventTypeV1::HelperOutcomeReceived));
    assert!(types.contains(&ServerIdleSuspendEventTypeV1::ReconciliationCompleted));

    coordinator.shutdown().await;

    // Part B: Arm cancellation by active PTY session
    let fixture2 = setup_test_fixture(true, 300, 60);
    let fake_executor2 = Arc::new(FakeExecutor::new(true));
    let coordinator2 = fixture2
        .state
        .start_idle_suspend_coordinator(fake_executor2.clone())
        .await;

    fixture2.state.pty_manager.with_fleet_for_test(|fleet| {
        fleet.begin_create("session-arm-test", 1).unwrap();
        fleet.publish_live("session-arm-test", 1);
    });
    tokio::task::yield_now().await;
    fixture2.state.pty_manager.with_fleet_for_test(|fleet| {
        fleet.remove_live("session-arm-test", 1);
    });
    tokio::task::yield_now().await;
    assert_eq!(coordinator2.status().state, CoordinatorState::Armed);

    let session = fixture2
        .state
        .pty_manager
        .create(make_pty_opts("rejection-test-pty", "cat"))
        .expect("create pty");

    tokio::task::yield_now().await;
    let status2 = coordinator2.status();
    assert_eq!(status2.state, CoordinatorState::Watching);

    let event_path2 = fixture2._tmp.path().join("idle-suspend-events-v1.jsonl");
    let raw_events2 = std::fs::read_to_string(&event_path2).expect("read events 2");
    let parsed_events2: Vec<IdleSuspendEventEnvelopeV1> = raw_events2
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).expect("parse event"))
        .collect();

    let has_arm_cancelled = parsed_events2
        .iter()
        .any(|e| e.event_type == ServerIdleSuspendEventTypeV1::ArmCancelled);
    assert!(has_arm_cancelled, "Must emit ArmCancelled event when PTY is spawned during armed grace");

    let _ = fixture2.state.pty_manager.kill(&session.id);
    coordinator2.shutdown().await;
}

#[tokio::test]
async fn test_idle_suspend_phase07_cross_layer_manual_chain_and_audit_correlation() {
    tokio::time::pause();

    let fixture = setup_test_fixture(true, 300, 60);
    let fake_executor = Arc::new(FakeExecutor::new(true));

    let coordinator = fixture
        .state
        .start_idle_suspend_coordinator(fake_executor.clone())
        .await;

    let res = coordinator
        .force_suspend(ForceSuspendCommand {
            actor: "test-operator".to_string(),
            wake_after_seconds: 120,
            force: true,
        })
        .await;

    let expected_correlation_id = match res {
        CoordinatorForceSuspendResult::Accepted { request_id, .. } => request_id,
        other => panic!("Expected Accepted response, got {other:?}"),
    };

    validate_canonical_uuid_v4(&expected_correlation_id).expect("valid correlation uuid v4");
    tokio::task::yield_now().await;

    let event_path = fixture._tmp.path().join("idle-suspend-events-v1.jsonl");
    assert!(event_path.exists());
    let raw_events = std::fs::read_to_string(&event_path).expect("read events");
    let parsed_events: Vec<IdleSuspendEventEnvelopeV1> = raw_events
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).expect("parse event"))
        .collect();

    let manual_events: Vec<&IdleSuspendEventEnvelopeV1> = parsed_events
        .iter()
        .filter(|e| e.correlation_id.as_deref() == Some(&expected_correlation_id))
        .collect();

    assert!(!manual_events.is_empty(), "Must have emitted events for manual correlation_id");
    for ev in &manual_events {
        assert_eq!(ev.mode, Some(IdleSuspendModeV1::Manual));
    }

    let manual_types: Vec<ServerIdleSuspendEventTypeV1> = manual_events.iter().map(|e| e.event_type).collect();
    assert!(manual_types.contains(&ServerIdleSuspendEventTypeV1::AttemptStarted));
    assert!(manual_types.contains(&ServerIdleSuspendEventTypeV1::HandoffClaimAccepted));
    assert!(manual_types.contains(&ServerIdleSuspendEventTypeV1::HelperRequestDispatched));
    assert!(manual_types.contains(&ServerIdleSuspendEventTypeV1::HelperOutcomeReceived));
    assert!(manual_types.contains(&ServerIdleSuspendEventTypeV1::ReconciliationCompleted));

    let audit_path = fixture._tmp.path().join("idle-suspend-audit.jsonl");
    assert!(audit_path.exists());
    let raw_audit = std::fs::read_to_string(&audit_path).expect("read audit");
    let audit_records: Vec<ServerAuditRecord> = raw_audit
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).expect("parse ServerAuditRecord"))
        .collect();

    let matching_manual_audit = audit_records.iter().find(|r| match r {
        ServerAuditRecord::Manual(m) => m.request_id == expected_correlation_id,
        _ => false,
    });
    assert!(
        matching_manual_audit.is_some(),
        "Server audit log must contain a record with matching request_id / correlation_id"
    );

    let session = fixture
        .state
        .pty_manager
        .create(make_pty_opts("manual-active-pty", "cat"))
        .expect("create pty");

    tokio::task::yield_now().await;

    let conflict_res = coordinator
        .force_suspend(ForceSuspendCommand {
            actor: "test-operator".to_string(),
            wake_after_seconds: 0,
            force: false,
        })
        .await;

    let conflict_snapshot = match conflict_res {
        CoordinatorForceSuspendResult::ActiveFleetRequiresConfirmation { fleet_snapshot } => fleet_snapshot,
        other => panic!("Expected ActiveFleetRequiresConfirmation, got {other:?}"),
    };
    assert_eq!(conflict_snapshot.live_count, 1);

    let raw_events_after = std::fs::read_to_string(&event_path).expect("read events after");
    let parsed_events_after: Vec<IdleSuspendEventEnvelopeV1> = raw_events_after
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).expect("parse event"))
        .collect();

    let has_terminal_rejected = parsed_events_after
        .iter()
        .any(|e| e.event_type == ServerIdleSuspendEventTypeV1::TerminalRejected);
    assert!(has_terminal_rejected, "Must emit TerminalRejected event on manual rejection");

    let _ = fixture.state.pty_manager.kill(&session.id);
    coordinator.shutdown().await;
}
