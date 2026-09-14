use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use chrono::Utc;
use jsonwebtoken::{encode, EncodingKey, Header};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use tempfile::TempDir;
use tokio::sync::Notify;
use tower::ServiceExt;

use dam_hopper_server::{
    agent_store::AgentStoreService,
        config::{
            DamHopperConfig, FeaturesConfig, GlobalConfig, IdleSuspendAutomaticPolicy,
            IdleSuspendConfig, RestartPolicy, ServerConfig, WorkspaceInfo,
            DEFAULT_RESTART_MAX_RETRIES,
        },
    crypto::DamHopperOpaqueSuite,
    diagnostics::DiagnosticStore,
    fs::FsSubsystem,
    idle_suspend::{
        coordinator::{
            CoordinatorForceSuspendResult, CoordinatorTimingResult, ForceSuspendCommand,
            UpdateTimingCommand,
        },
        executor::{BoxFuture, FakeExecutor, IdleSuspendExecutor},
        protocol::{
            ForceSuspendAcceptedResponse, IdleSuspendConflictResponse, SuspendOutcome,
            SuspendWithRtcWakeRequest,
        },
        status::{CoordinatorState, IdleSuspendStatusV1},
        UnavailableExecutor,
        validate_canonical_uuid_v4,
    },
    pty::{BroadcastEventSink, PtyCreateOpts, PtySessionManager},
    state::AppState,
    telemetry::TelemetryRuntime,
};

mod common;

const TEST_SECRET: &str = "test-secret-jwt-key-12345";

#[derive(Serialize, Deserialize)]
struct TestClaims {
    sub: String,
    exp: usize,
}

fn make_auth_cookie() -> String {
    let claims = TestClaims {
        sub: "admin-tester".to_string(),
        exp: (Utc::now().timestamp() as usize) + 3600,
    };
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(TEST_SECRET.as_bytes()),
    )
    .expect("jwt encode");
    format!("damhopper-auth={token}")
}

fn make_pty_opts(id: &str, command: &str) -> PtyCreateOpts {
    let mut env = HashMap::new();
    env.insert("TERM".into(), "xterm-256color".into());
    env.insert("HOME".into(), std::env::var("HOME").unwrap_or_default());
    PtyCreateOpts {
        id: id.to_string(),
        command: command.to_string(),
        cwd: "/tmp".to_string(),
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
    pub config_path: PathBuf,
}

fn setup_test_fixture(idle_enabled: bool, quiet: u64, wake: u64) -> TestFixture {
    let tmp = tempfile::tempdir().expect("tempdir");
    let workspace_dir = tmp.path().to_path_buf();
    let config_path = workspace_dir.join("dam-hopper.toml");

    let initial_toml = format!(
        r#"[workspace]
name = "test-idle-suspend-ws"
root = "{}"

[server.idle_suspend]
enabled = {}
quiet_period_seconds = {}
wake_after_seconds = {}
"#,
        workspace_dir.display(),
        idle_enabled,
        quiet,
        wake
    );
    std::fs::write(&config_path, initial_toml).expect("write initial toml");
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .mode(0o600)
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
        config_path: config_path.clone(),
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

    TestFixture {
        _tmp: tmp,
        state,
        config_path,
    }
}
async fn setup_agent_activity_fixture(
    idle_enabled: bool,
    quiet: u64,
    wake: u64,
    agent_executables: Option<Vec<String>>,
) -> TestFixture {
    let tmp = tempfile::tempdir().expect("tempdir");
    let workspace_dir = tmp.path().to_path_buf();
    let config_path = workspace_dir.join("dam-hopper.toml");

    let agent_execs = agent_executables.unwrap_or_else(|| {
        vec![
            "codex".to_string(),
            "omp".to_string(),
            "claude".to_string(),
            "agy".to_string(),
        ]
    });
    let execs_toml = agent_execs
        .iter()
        .map(|e| format!("\"{}\"", e))
        .collect::<Vec<_>>()
        .join(", ");
    let safe_quiet = quiet.max(60);
    let safe_wake = wake.max(60);
    let initial_toml = format!(
        r#"[workspace]
name = "test-idle-suspend-ws"
root = "{}"

[server.idle_suspend]
enabled = {}
quiet_period_seconds = {}
wake_after_seconds = {}
automatic_policy = "agent-activity"
agent_executables = [{}]
"#,
        workspace_dir.display(),
        idle_enabled,
        safe_quiet,
        safe_wake,
        execs_toml
    );
    std::fs::write(&config_path, initial_toml).expect("write initial toml");

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .mode(0o600)
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
                quiet_period_seconds: safe_quiet,
                wake_after_seconds: safe_wake,
                automatic_policy: IdleSuspendAutomaticPolicy::AgentActivity,
                agent_executables: agent_execs,
                ..Default::default()
            },
            ..Default::default()
        },
        projects: vec![],
        features: FeaturesConfig::default(),
        config_path: config_path.clone(),
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

    if quiet < 60 || wake < 60 {
        let mut timing_guard = state.idle_suspend_timing.write().await;
        timing_guard.quiet_period_seconds = quiet;
        timing_guard.wake_after_seconds = wake;
    }

    TestFixture {
        _tmp: tmp,
        state,
        config_path,
    }
}

async fn wait_for_predicate<F: Fn() -> bool>(timeout: Duration, predicate: F) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if predicate() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    false
}

// ---------------------------------------------------------------------------
// 1. Cross-module Lifecycle: Empty -> PTY Active -> PTY Removed -> Armed -> Resumed
// ---------------------------------------------------------------------------
#[tokio::test]
async fn test_idle_suspend_cross_module_lifecycle_empty_to_armed_to_resumed() {
    tokio::time::pause();

    let fixture = setup_test_fixture(true, 300, 600);
    let fake_executor = Arc::new(FakeExecutor::new(true));

    let mut ws_hint_rx = fixture.state.event_sink.subscribe_idle_suspend();

    let coordinator = fixture
        .state
        .start_idle_suspend_coordinator(fake_executor.clone())
        .await;

    // Initial state: fleet is quiescent from startup, coordinator enters Watching
    let status = coordinator.status();
    assert_eq!(status.state, CoordinatorState::Watching);
    assert!(status.enabled);
    assert!(status.fleet_snapshot.is_quiescent());
    assert_eq!(status.fleet_snapshot.live_count, 0);

    // REST status check
    let app = dam_hopper_server::api::build_router(fixture.state.clone());
    let req = Request::builder()
        .method("GET")
        .uri("/api/system/idle-suspend/v1/status")
        .header("Cookie", make_auth_cookie())
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let initial_status: IdleSuspendStatusV1 = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(initial_status.state, CoordinatorState::Watching);

    // 1. Simulate PTY creation -> fleet transitions to non-quiescent
    fixture.state.pty_manager.with_fleet_for_test(|fleet| {
        fleet.begin_create("session-1", 1).unwrap();
        fleet.publish_live("session-1", 1);
    });

    // Let tokio process fleet event
    tokio::task::yield_now().await;

    let status_active = coordinator.status();
    assert_eq!(status_active.state, CoordinatorState::Watching);
    assert!(!status_active.fleet_snapshot.is_quiescent());
    assert_eq!(status_active.fleet_snapshot.live_count, 1);

    // 2. Simulate PTY exit/removal -> fleet transitions to quiescent
    fixture.state.pty_manager.with_fleet_for_test(|fleet| {
        fleet.remove_live("session-1", 1);
    });

    // Let tokio process fleet event
    tokio::task::yield_now().await;

    let status_armed = coordinator.status();
    assert_eq!(status_armed.state, CoordinatorState::Armed);
    assert!(status_armed.fleet_snapshot.is_quiescent());
    assert!(status_armed.arm_deadline_ms.is_some());

    // Verify WS event sink received change hint
    assert!(ws_hint_rx.try_recv().is_ok());

    // 3. Advance time to fire the quiet period deadline (300 seconds)
    tokio::time::advance(Duration::from_secs(305)).await;
    tokio::task::yield_now().await;

    // 4. Coordinator claimed handoff, executed suspend, and resumed successfully
    let status_resumed = coordinator.status();
    assert_eq!(status_resumed.state, CoordinatorState::Resumed);
    assert!(status_resumed.last_outcome.is_some());

    match status_resumed.last_outcome.unwrap() {
        SuspendOutcome::ResumedSuccessfully {
            request_id,
            elapsed_seconds,
        } => {
            assert!(validate_canonical_uuid_v4(&request_id).is_ok());
            assert_eq!(elapsed_seconds, 600);
        }
        other => panic!("Expected ResumedSuccessfully, got: {other:?}"),
    }

    // Executor recorded exactly one suspend request
    let recorded = fake_executor.recorded_requests();
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0].wake_after_seconds, 600);

    // 5. Single-flight idle epoch: advance time further by 1000s, NO duplicate suspend!
    tokio::time::advance(Duration::from_secs(1000)).await;
    tokio::task::yield_now().await;
    assert_eq!(
        fake_executor.recorded_requests().len(),
        1,
        "Must not auto-retry suspend while fleet remains empty"
    );

    // 6. Verify canonical semantic event file written beside diagnostics
    assert!(fixture.state.idle_suspend_event_writer.is_some());
    let event_path = fixture._tmp.path().join("idle-suspend-events-v1.jsonl");
    assert!(event_path.exists(), "Event log must exist at fixed diagnostics sibling path");
    let raw_events = std::fs::read_to_string(&event_path).expect("read events");
    let event_lines: Vec<&str> = raw_events.lines().filter(|l| !l.trim().is_empty()).collect();
    assert_eq!(event_lines.len(), 9, "Must emit exactly 9 events in complete lifecycle");
    coordinator.shutdown().await;
}

// ---------------------------------------------------------------------------
// 2. Real PTY Process Lifecycle Integration: Create -> Active -> Remove -> Armed
// ---------------------------------------------------------------------------
#[tokio::test]
async fn test_idle_suspend_real_pty_lifecycle_integration() {
    tokio::time::pause();

    let fixture = setup_test_fixture(true, 300, 600);
    let fake_executor = Arc::new(FakeExecutor::new(true));

    let coordinator = fixture
        .state
        .start_idle_suspend_coordinator(fake_executor.clone())
        .await;

    assert_eq!(coordinator.status().state, CoordinatorState::Watching);

    // Create real PTY session
    let opts = make_pty_opts("integ:idle-test", "cat");
    let meta = fixture.state.pty_manager.create(opts).expect("pty create");
    assert_eq!(meta.id, "integ:idle-test");

    // Let coordinator process fleet change
    tokio::task::yield_now().await;

    let status = coordinator.status();
    assert_eq!(status.state, CoordinatorState::Watching);
    assert_eq!(status.fleet_snapshot.live_count, 1);
    assert!(!status.fleet_snapshot.is_quiescent());

    // Remove real PTY session
    fixture
        .state
        .pty_manager
        .remove("integ:idle-test")
        .expect("pty remove");

    // Let coordinator process fleet change
    tokio::task::yield_now().await;

    let status_after_removal = coordinator.status();
    assert_eq!(status_after_removal.state, CoordinatorState::Armed);
    assert!(status_after_removal.fleet_snapshot.is_quiescent());
    assert!(status_after_removal.arm_deadline_ms.is_some());

    coordinator.shutdown().await;
}

// ---------------------------------------------------------------------------
// 3. Active PTY Spawn Cancels Armed Grace
// ---------------------------------------------------------------------------
#[tokio::test]
async fn test_idle_suspend_pty_spawn_cancels_armed_grace() {
    tokio::time::pause();

    let fixture = setup_test_fixture(true, 300, 600);
    let fake_executor = Arc::new(FakeExecutor::new(true));

    let coordinator = fixture
        .state
        .start_idle_suspend_coordinator(fake_executor.clone())
        .await;

    // Transition fleet: active -> empty to arm the coordinator
    fixture.state.pty_manager.with_fleet_for_test(|fleet| {
        fleet.begin_create("session-cancel", 1).unwrap();
        fleet.publish_live("session-cancel", 1);
    });
    tokio::task::yield_now().await;

    fixture.state.pty_manager.with_fleet_for_test(|fleet| {
        fleet.remove_live("session-cancel", 1);
    });
    tokio::task::yield_now().await;

    assert_eq!(coordinator.status().state, CoordinatorState::Armed);

    // Advance 100s (before 300s deadline)
    tokio::time::advance(Duration::from_secs(100)).await;

    // Spawn new PTY while armed
    fixture.state.pty_manager.with_fleet_for_test(|fleet| {
        fleet.begin_create("session-interrupter", 1).unwrap();
    });
    tokio::task::yield_now().await;

    // Armed state is immediately canceled back to Watching
    let status_canceled = coordinator.status();
    assert_eq!(status_canceled.state, CoordinatorState::Watching);
    assert!(status_canceled.arm_deadline_ms.is_none());

    // Advance past original deadline
    tokio::time::advance(Duration::from_secs(300)).await;
    tokio::task::yield_now().await;

    // Zero suspend requests executed
    assert_eq!(fake_executor.recorded_requests().len(), 0);

    coordinator.shutdown().await;
}

// ---------------------------------------------------------------------------
// 4. Pre-handoff Timing Mutation Rearms, Commits Atomic TOML, and Tests HTTP Guards
// ---------------------------------------------------------------------------
#[tokio::test]
async fn test_idle_suspend_pre_handoff_timing_patch_rearms() {
    tokio::time::pause();

    let fixture = setup_test_fixture(true, 300, 600);
    let fake_executor = Arc::new(FakeExecutor::new(true));

    let coordinator = fixture
        .state
        .start_idle_suspend_coordinator(fake_executor.clone())
        .await;

    // 1. Verify HTTP guard behavior:
    // Bad origin -> 403 invalidOrigin
    let app = dam_hopper_server::api::build_router(fixture.state.clone());
    let patch_body = serde_json::json!({
        "quietPeriodSeconds": 450,
        "wakeAfterSeconds": 900
    });
    let req_bad_origin = Request::builder()
        .method("PATCH")
        .uri("/api/system/idle-suspend/v1/timing")
        .header("Cookie", make_auth_cookie())
        .header("Origin", "https://attacker.evil.com")
        .header("Host", "127.0.0.1:4801")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&patch_body).unwrap()))
        .unwrap();
    let resp_bad_origin = app.clone().oneshot(req_bad_origin).await.unwrap();
    assert_eq!(resp_bad_origin.status(), StatusCode::FORBIDDEN);

    // Missing DB -> 503 authenticationUnavailable
    let req_no_db = Request::builder()
        .method("PATCH")
        .uri("/api/system/idle-suspend/v1/timing")
        .header("Cookie", make_auth_cookie())
        .header("Origin", "http://127.0.0.1:4801")
        .header("Host", "127.0.0.1:4801")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&patch_body).unwrap()))
        .unwrap();
    let resp_no_db = app.oneshot(req_no_db).await.unwrap();
    assert_eq!(resp_no_db.status(), StatusCode::SERVICE_UNAVAILABLE);

    // 2. Test coordinator-level timing mutation:
    // Arm the coordinator first
    fixture.state.pty_manager.with_fleet_for_test(|fleet| {
        fleet.begin_create("session-rearm", 1).unwrap();
        fleet.publish_live("session-rearm", 1);
    });
    tokio::task::yield_now().await;
    fixture.state.pty_manager.with_fleet_for_test(|fleet| {
        fleet.remove_live("session-rearm", 1);
    });
    tokio::task::yield_now().await;
    assert_eq!(coordinator.status().state, CoordinatorState::Armed);

    // Submit timing update to coordinator
    let cmd = UpdateTimingCommand {
        actor: "admin-tester".to_string(),
        quiet_period_seconds: 450,
        wake_after_seconds: 900,
    };
    let result = coordinator.update_timing(cmd).await;
    match result {
        CoordinatorTimingResult::Success {
            changed,
            quiet_period_seconds,
            wake_after_seconds,
            ..
        } => {
            assert!(changed);
            assert_eq!(quiet_period_seconds, 450);
            assert_eq!(wake_after_seconds, 900);
        }
        other => panic!("Expected CoordinatorTimingResult::Success, got: {other:?}"),
    }

    // Verify canonical TOML on disk was updated atomically
    let toml_content = std::fs::read_to_string(&fixture.config_path).unwrap();
    assert!(toml_content.contains("quiet_period_seconds = 450"));
    assert!(toml_content.contains("wake_after_seconds = 900"));

    // Verify coordinator re-armed with new deadline: advance 310s (original 300s passed, but new is 450s)
    tokio::time::advance(Duration::from_secs(310)).await;
    tokio::task::yield_now().await;
    assert_eq!(
        fake_executor.recorded_requests().len(),
        0,
        "Should not trigger on old 300s deadline"
    );

    // Advance remaining 150s (total > 450s)
    tokio::time::advance(Duration::from_secs(150)).await;
    tokio::task::yield_now().await;

    // Triggered with new wake value 900
    let recorded = fake_executor.recorded_requests();
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0].wake_after_seconds, 900);

    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_idle_suspend_automatic_timing_rejects_zero_wake_after_seconds() {
    let fixture = setup_test_fixture(true, 300, 600);
    let fake_executor = Arc::new(FakeExecutor::new(true));
    let coordinator = fixture
        .state
        .start_idle_suspend_coordinator(fake_executor)
        .await;

    // Attempting to update automatic timing with wake_after_seconds = 0 MUST fail validation
    let cmd = UpdateTimingCommand {
        actor: "admin-tester".to_string(),
        quiet_period_seconds: 300,
        wake_after_seconds: 0,
    };
    let result = coordinator.update_timing(cmd).await;
    match result {
        CoordinatorTimingResult::ValidationFailed(error) => {
            assert!(error.contains("wakeAfterSeconds") || error.contains("wake") || error.contains("Bounds"));
        }
        other => panic!("Expected ValidationFailed for wake_after_seconds=0, got: {other:?}"),
    }

    coordinator.shutdown().await;
}

// ---------------------------------------------------------------------------
// 5. Post-handoff Timing Mutation is Rejected with HandoffInProgress (409)
// ---------------------------------------------------------------------------
struct InFlightHandoffExecutor {
    entered: Arc<Notify>,
    release: Arc<Notify>,
    calls: Arc<AtomicUsize>,
}

impl IdleSuspendExecutor for InFlightHandoffExecutor {
    fn check_capability(&self) -> BoxFuture<'_, bool> {
        Box::pin(async { true })
    }

    fn execute_suspend(&self, req: SuspendWithRtcWakeRequest) -> BoxFuture<'_, SuspendOutcome> {
        let entered = Arc::clone(&self.entered);
        let release = Arc::clone(&self.release);
        let calls = Arc::clone(&self.calls);
        Box::pin(async move {
            calls.fetch_add(1, Ordering::SeqCst);
            entered.notify_one();
            release.notified().await;
            SuspendOutcome::ResumedSuccessfully {
                request_id: req.request_id,
                elapsed_seconds: req.wake_after_seconds,
            }
        })
    }
}

#[tokio::test]
async fn test_idle_suspend_handoff_in_progress_rejects_timing_with_409() {
    tokio::time::pause();

    let fixture = setup_test_fixture(true, 300, 600);
    let entered = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let calls = Arc::new(AtomicUsize::new(0));

    let executor = Arc::new(InFlightHandoffExecutor {
        entered: Arc::clone(&entered),
        release: Arc::clone(&release),
        calls: Arc::clone(&calls),
    });

    let coordinator = fixture.state.start_idle_suspend_coordinator(executor).await;

    // Arm the coordinator
    fixture.state.pty_manager.with_fleet_for_test(|fleet| {
        fleet.begin_create("session-handoff", 1).unwrap();
        fleet.publish_live("session-handoff", 1);
    });
    tokio::task::yield_now().await;
    fixture.state.pty_manager.with_fleet_for_test(|fleet| {
        fleet.remove_live("session-handoff", 1);
    });
    tokio::task::yield_now().await;
    assert_eq!(coordinator.status().state, CoordinatorState::Armed);

    // Advance time to fire deadline and enter handoff
    tokio::time::advance(Duration::from_secs(305)).await;
    entered.notified().await;

    // Confirm state is handedOff
    assert_eq!(coordinator.status().state, CoordinatorState::HandedOff);

    // Issue update_timing during handoff
    let cmd = UpdateTimingCommand {
        actor: "admin-tester".to_string(),
        quiet_period_seconds: 400,
        wake_after_seconds: 800,
    };
    let result = coordinator.update_timing(cmd).await;
    assert_eq!(
        result,
        CoordinatorTimingResult::HandoffInProgress,
        "Must return HandoffInProgress (maps to 409) during handoff"
    );

    // Verify disk TOML remains completely unchanged!
    let toml_content = std::fs::read_to_string(&fixture.config_path).unwrap();
    assert!(toml_content.contains("quiet_period_seconds = 300"));
    assert!(toml_content.contains("wake_after_seconds = 600"));

    // Release handoff execution
    release.notify_one();
    tokio::task::yield_now().await;

    // Coordinator transitions to resumed
    assert_eq!(coordinator.status().state, CoordinatorState::Resumed);

    coordinator.shutdown().await;
}

// ---------------------------------------------------------------------------
// 6. Post-Resume Reconciliation & New PTY Starts Fresh Epoch
// ---------------------------------------------------------------------------
#[tokio::test]
async fn test_idle_suspend_post_resume_reconciliation_and_new_pty_epoch() {
    tokio::time::pause();

    let fixture = setup_test_fixture(true, 300, 600);
    let fake_executor = Arc::new(FakeExecutor::new(true));

    let coordinator = fixture
        .state
        .start_idle_suspend_coordinator(fake_executor.clone())
        .await;

    // Epoch 1
    fixture.state.pty_manager.with_fleet_for_test(|fleet| {
        fleet.begin_create("session-epoch1", 1).unwrap();
        fleet.publish_live("session-epoch1", 1);
    });
    tokio::task::yield_now().await;
    fixture.state.pty_manager.with_fleet_for_test(|fleet| {
        fleet.remove_live("session-epoch1", 1);
    });
    tokio::task::yield_now().await;

    tokio::time::advance(Duration::from_secs(305)).await;
    tokio::task::yield_now().await;

    assert_eq!(coordinator.status().state, CoordinatorState::Resumed);
    assert_eq!(fake_executor.recorded_requests().len(), 1);

    // New PTY created after resume -> returns to Watching
    fixture.state.pty_manager.with_fleet_for_test(|fleet| {
        fleet.begin_create("session-epoch2", 1).unwrap();
        fleet.publish_live("session-epoch2", 1);
    });
    tokio::task::yield_now().await;

    let status_active2 = coordinator.status();
    assert_eq!(status_active2.state, CoordinatorState::Watching);
    assert_eq!(status_active2.fleet_snapshot.live_count, 1);

    // PTY exits -> begins Epoch 2
    fixture.state.pty_manager.with_fleet_for_test(|fleet| {
        fleet.remove_live("session-epoch2", 1);
    });
    tokio::task::yield_now().await;

    let status_armed2 = coordinator.status();
    assert_eq!(status_armed2.state, CoordinatorState::Armed);

    // Advance Epoch 2 deadline
    tokio::time::advance(Duration::from_secs(305)).await;
    tokio::task::yield_now().await;

    assert_eq!(coordinator.status().state, CoordinatorState::Resumed);
    let requests = fake_executor.recorded_requests();
    assert_eq!(requests.len(), 2, "Second epoch executed");
    assert!(validate_canonical_uuid_v4(&requests[1].request_id).is_ok());

    coordinator.shutdown().await;
}

// ---------------------------------------------------------------------------
// 7. Inhibitor and Unsupported Capability Fail-Closed Handling
// ---------------------------------------------------------------------------
#[tokio::test]
async fn test_idle_suspend_inhibitor_blocks_and_suppresses() {
    tokio::time::pause();

    let fixture = setup_test_fixture(true, 300, 600);
    let fake_executor = Arc::new(FakeExecutor::new(true));
    fake_executor.set_outcome(SuspendOutcome::BlockedByInhibitor {
        request_id: "test".into(),
        inhibitor: "system-update-lock".into(),
        who: Some("package-manager".into()),
        why: Some("OS upgrade".into()),
    });

    let coordinator = fixture
        .state
        .start_idle_suspend_coordinator(fake_executor)
        .await;

    fixture.state.pty_manager.with_fleet_for_test(|fleet| {
        fleet.begin_create("session-inhibited", 1).unwrap();
        fleet.publish_live("session-inhibited", 1);
    });
    tokio::task::yield_now().await;
    fixture.state.pty_manager.with_fleet_for_test(|fleet| {
        fleet.remove_live("session-inhibited", 1);
    });
    tokio::task::yield_now().await;

    tokio::time::advance(Duration::from_secs(305)).await;
    tokio::task::yield_now().await;

    let status = coordinator.status();
    assert_eq!(status.state, CoordinatorState::Suppressed);
    assert!(status
        .detail
        .as_deref()
        .unwrap()
        .contains("system-update-lock"));

    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_idle_suspend_unavailable_executor_fails_closed() {
    tokio::time::pause();

    let fixture = setup_test_fixture(true, 300, 600);
    let unavailable_executor = Arc::new(UnavailableExecutor::default());

    let coordinator = fixture
        .state
        .start_idle_suspend_coordinator(unavailable_executor)
        .await;

    fixture.state.pty_manager.with_fleet_for_test(|fleet| {
        fleet.begin_create("session-unavailable", 1).unwrap();
        fleet.publish_live("session-unavailable", 1);
    });
    tokio::task::yield_now().await;
    fixture.state.pty_manager.with_fleet_for_test(|fleet| {
        fleet.remove_live("session-unavailable", 1);
    });
    tokio::task::yield_now().await;

    tokio::time::advance(Duration::from_secs(305)).await;
    tokio::task::yield_now().await;

    let status = coordinator.status();
    assert_eq!(status.state, CoordinatorState::Suppressed);
    assert!(status
        .detail
        .as_deref()
        .unwrap()
        .contains("unsupported capability"));

    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_idle_suspend_forced_handoff_with_active_ptys_and_outcome_release() {
    let fixture = setup_test_fixture(true, 300, 600);
    let executor = Arc::new(FakeExecutor::new(true));
    let coordinator = fixture.state.start_idle_suspend_coordinator(executor).await;

    // 1. Create a managed PTY session to make fleet active
    let opts1 = make_pty_opts("pty-active-1", "cat");
    let session1 = fixture.state.pty_manager.create(opts1).expect("create pty");
    assert_eq!(fixture.state.pty_manager.fleet_snapshot().live_count, 1);

    // 2. force: false returns ActiveFleetRequiresConfirmation
    let res_no_force = coordinator
        .force_suspend(ForceSuspendCommand {
            actor: "admin-actor".to_string(),
            wake_after_seconds: 0,
            force: false,
        })
        .await;
    match res_no_force {
        CoordinatorForceSuspendResult::ActiveFleetRequiresConfirmation { fleet_snapshot } => {
            assert_eq!(fleet_snapshot.live_count, 1);
            assert!(!fleet_snapshot.handoff_active);
        }
        other => panic!("Expected ActiveFleetRequiresConfirmation, got: {other:?}"),
    }

    // 3. force: true succeeds
    let res_force = coordinator
        .force_suspend(ForceSuspendCommand {
            actor: "admin-actor".to_string(),
            wake_after_seconds: 0,
            force: true,
        })
        .await;
    assert!(matches!(res_force, CoordinatorForceSuspendResult::Accepted { .. }));

    // 4. Wait for resume outcome
    tokio::time::sleep(Duration::from_millis(60)).await;
    assert_eq!(coordinator.status().state, CoordinatorState::Watching);
    assert!(matches!(
        coordinator.status().last_outcome,
        Some(SuspendOutcome::ResumedSuccessfully { .. })
    ));
    assert!(!fixture.state.pty_manager.fleet_snapshot().handoff_active);

    // 5. Clean up session
    let _ = fixture.state.pty_manager.kill(&session1.id);
    coordinator.shutdown().await;
}
#[tokio::test]
async fn test_idle_suspend_force_suspend_dtos_and_conflict_responses() {
    let snapshot = dam_hopper_server::pty::PtyFleetSnapshot {
        generation: 42,
        live_count: 2,
        creating_count: 1,
        restart_pending_count: 0,
        disposing: false,
        closing: false,
        handoff_active: false,
    };
    assert_eq!(snapshot.running_count(), 3);

    // 1. Accepted response construction and serialization
    let accepted = ForceSuspendAcceptedResponse::new(
        "req-abc-123".to_string(),
        10,
        0,
        true,
        snapshot,
    );
    assert_eq!(accepted.version, 1);
    assert_eq!(accepted.state, "handedOff");
    assert_eq!(accepted.request_id, "req-abc-123");
    assert_eq!(accepted.status_revision, 10);
    assert_eq!(accepted.wake_after_seconds, 0);
    assert!(accepted.forced);
    assert_eq!(accepted.fleet_snapshot.running_count(), 3);

    let accepted_json = serde_json::to_value(&accepted).unwrap();
    assert_eq!(accepted_json["version"], 1);
    assert_eq!(accepted_json["state"], "handedOff");
    assert_eq!(accepted_json["requestId"], "req-abc-123");
    assert_eq!(accepted_json["statusRevision"], 10);
    assert_eq!(accepted_json["wakeAfterSeconds"], 0);
    assert_eq!(accepted_json["forced"], true);
    assert_eq!(accepted_json["fleetSnapshot"]["generation"], 42);
    assert_eq!(accepted_json["fleetSnapshot"]["liveCount"], 2);

    // 2. Conflict response construction and serialization
    let conflict = IdleSuspendConflictResponse::new(
        "idleSuspendActiveFleetConfirmationRequired",
        "active fleet requires confirmation",
        snapshot,
    );
    assert_eq!(conflict.code, "idleSuspendActiveFleetConfirmationRequired");
    assert_eq!(conflict.active_session_count, 3);
    assert_eq!(conflict.fleet_snapshot.live_count, 2);

    let conflict_json = serde_json::to_value(&conflict).unwrap();
    assert_eq!(conflict_json["code"], "idleSuspendActiveFleetConfirmationRequired");
    assert_eq!(conflict_json["activeSessionCount"], 3);
    assert_eq!(conflict_json["fleetSnapshot"]["generation"], 42);

    // 3. API helper response construction and Cache-Control: no-store
    let resp_conflict = dam_hopper_server::api::idle_suspend::idle_suspend_conflict_response(
        "idleSuspendActiveFleetConfirmationRequired",
        "active fleet requires confirmation",
        snapshot,
    );
    assert_eq!(resp_conflict.status(), StatusCode::CONFLICT);
    assert_eq!(
        resp_conflict.headers().get("cache-control").unwrap(),
        "no-store"
    );

    let resp_error = dam_hopper_server::api::idle_suspend::idle_suspend_error_response(
        StatusCode::SERVICE_UNAVAILABLE,
        "idleSuspendCapabilityUnavailable",
        "host lacks RTC alarm or suspend capability",
    );
    assert_eq!(resp_error.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        resp_error.headers().get("cache-control").unwrap(),
        "no-store"
    );
}
#[tokio::test]
async fn test_idle_suspend_manual_force_suspend_policy_disabled_still_succeeds() {
    let fixture = setup_test_fixture(false, 300, 600);
    let executor = Arc::new(FakeExecutor::new(true));
    let coordinator = fixture
        .state
        .start_idle_suspend_coordinator(executor.clone())
        .await;

    // Policy is disabled, but manual force suspend with capable executor succeeds
    let res = coordinator
        .force_suspend(ForceSuspendCommand {
            actor: "admin-actor".to_string(),
            wake_after_seconds: 0,
            force: false,
        })
        .await;

    assert!(matches!(res, CoordinatorForceSuspendResult::Accepted { .. }));

    // Wait for fake resume outcome
    tokio::time::sleep(Duration::from_millis(60)).await;
    assert_eq!(executor.recorded_requests().len(), 1);
    assert_eq!(coordinator.status().state, CoordinatorState::Disabled);
    assert!(matches!(
        coordinator.status().last_outcome,
        Some(SuspendOutcome::ResumedSuccessfully { .. })
    ));
    assert!(!fixture.state.pty_manager.fleet_snapshot().handoff_active);

    coordinator.shutdown().await;
}
#[tokio::test]
async fn test_idle_suspend_manual_force_suspend_cancels_armed_grace() {
    let fixture = setup_test_fixture(true, 60, 600);
    let executor = Arc::new(FakeExecutor::new(true));
    let coordinator = fixture
        .state
        .start_idle_suspend_coordinator(executor.clone())
        .await;

    // 1. Create a managed PTY so fleet becomes active
    let session = fixture
        .state
        .pty_manager
        .create(make_pty_opts("pty-armed-cancel", "cat"))
        .expect("create pty");
    tokio::task::yield_now().await;
    assert_eq!(coordinator.status().state, CoordinatorState::Watching);

    // 2. Kill PTY -> fleet becomes quiescent -> coordinator transitions to Armed
    let _ = fixture.state.pty_manager.kill(&session.id);
    tokio::task::yield_now().await;
    assert_eq!(coordinator.status().state, CoordinatorState::Armed);
    assert!(coordinator.status().arm_deadline_ms.is_some());

    // 3. Manual command arrives while armed -> immediately cancels armed grace and hands off
    let res = coordinator
        .force_suspend(ForceSuspendCommand {
            actor: "operator".to_string(),
            wake_after_seconds: 0,
            force: false,
        })
        .await;

    assert!(matches!(res, CoordinatorForceSuspendResult::Accepted { .. }));

    // Wait for fake resume outcome
    tokio::time::sleep(Duration::from_millis(60)).await;
    assert_eq!(coordinator.status().state, CoordinatorState::Resumed);
    assert!(!fixture.state.pty_manager.fleet_snapshot().handoff_active);

    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_idle_suspend_manual_force_suspend_zero_side_effect_on_active_fleet_without_force() {
    let fixture = setup_test_fixture(true, 300, 600);
    let executor = Arc::new(FakeExecutor::new(true));
    let coordinator = fixture
        .state
        .start_idle_suspend_coordinator(executor.clone())
        .await;

    // 1. Create a managed PTY to make fleet active
    let session = fixture
        .state
        .pty_manager
        .create(make_pty_opts("pty-zero-effect", "cat"))
        .expect("create pty");
    assert_eq!(fixture.state.pty_manager.fleet_snapshot().live_count, 1);

    // 2. Submit manual suspend with force: false
    let res = coordinator
        .force_suspend(ForceSuspendCommand {
            actor: "operator".to_string(),
            wake_after_seconds: 0,
            force: false,
        })
        .await;

    // 3. Must return ActiveFleetRequiresConfirmation
    match res {
        CoordinatorForceSuspendResult::ActiveFleetRequiresConfirmation { fleet_snapshot } => {
            assert_eq!(fleet_snapshot.live_count, 1);
            assert!(!fleet_snapshot.handoff_active);
        }
        other => panic!("Expected ActiveFleetRequiresConfirmation, got: {other:?}"),
    }

    // 4. Assert zero side-effects
    assert_eq!(executor.recorded_requests().len(), 0);
    assert_eq!(coordinator.status().state, CoordinatorState::Watching);
    assert!(coordinator.status().last_outcome.is_none());
    assert!(!fixture.state.pty_manager.fleet_snapshot().handoff_active);

    let _ = fixture.state.pty_manager.kill(&session.id);
    coordinator.shutdown().await;
}

// ---------------------------------------------------------------------------
// 7. Integrated Agent Activity Scenarios (Phase 07)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_integrated_agent_activity_service_only_pty_does_not_block_suspend() {
    let fixture = setup_agent_activity_fixture(
        true,
        2,
        600,
        Some(vec!["codex".to_string(), "omp".to_string()]),
    )
    .await;
    let executor = Arc::new(FakeExecutor::new(true));
    let coordinator = fixture
        .state
        .start_idle_suspend_coordinator(executor.clone())
        .await;

    // 1. Create a service-only PTY (cat, not in agent_executables)
    let session = fixture
        .state
        .pty_manager
        .create(make_pty_opts("pty-service-only", "cat"))
        .expect("create service pty");

    // Fleet has 1 active session
    assert_eq!(fixture.state.pty_manager.fleet_snapshot().live_count, 1);

    // Initial state is Watching, automatic policy is AgentActivity
    assert_eq!(coordinator.status().state, CoordinatorState::Watching);
    assert_eq!(
        coordinator.status().automatic_policy,
        IdleSuspendAutomaticPolicy::AgentActivity
    );

    // 2. Service-only output does not count as agent activity, so coordinator will reach Resumed after quiet
    let resumed = wait_for_predicate(Duration::from_secs(8), || {
        coordinator.status().state == CoordinatorState::Resumed
    })
    .await;
    assert!(
        resumed,
        "Coordinator must resume after automatic suspend for service-only PTY, state: {:?}",
        coordinator.status().state
    );

    // 3. FakeExecutor received exactly 1 request
    assert_eq!(executor.recorded_requests().len(), 1);

    // 4. Live fleet count remains 1 (never relabeled as 0)
    assert_eq!(fixture.state.pty_manager.fleet_snapshot().live_count, 1);

    let _ = fixture.state.pty_manager.kill(&session.id);
    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_integrated_agent_activity_accepted_input_invalidates_quiet() {
    let fixture = setup_agent_activity_fixture(true, 3, 600, Some(vec!["cat".to_string()])).await;
    let executor = Arc::new(FakeExecutor::new(true));
    let coordinator = fixture
        .state
        .start_idle_suspend_coordinator(executor.clone())
        .await;

    let session = fixture
        .state
        .pty_manager
        .create(make_pty_opts("pty-agent-input", "cat"))
        .expect("create agent pty");

    // Wait for coordinator to reach Armed state (quiet = 3s)
    let armed = wait_for_predicate(Duration::from_secs(6), || {
        coordinator.status().state == CoordinatorState::Armed
    })
    .await;
    assert!(armed, "Coordinator must reach Armed state");

    // Write accepted terminal input to invalidate countdown
    let _ = fixture.state.pty_manager.write(&session.id, b"echo active\n");

    // Verify coordinator transitions back to Watching
    let returned_to_watching = wait_for_predicate(Duration::from_secs(3), || {
        coordinator.status().state == CoordinatorState::Watching
    })
    .await;
    assert!(
        returned_to_watching,
        "Accepted input must invalidate countdown and return coordinator to Watching, current state: {:?}",
        coordinator.status().state
    );
    assert_eq!(executor.recorded_requests().len(), 0);

    let _ = fixture.state.pty_manager.kill(&session.id);
    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_integrated_agent_activity_manual_force_race_with_final_check() {
    let fixture = setup_agent_activity_fixture(true, 10, 600, None).await;
    let executor = Arc::new(FakeExecutor::new(true));
    let coordinator = fixture
        .state
        .start_idle_suspend_coordinator(executor.clone())
        .await;

    let session = fixture
        .state
        .pty_manager
        .create(make_pty_opts("pty-manual-race", "cat"))
        .expect("create pty");

    // Submit manual force suspend
    let res = coordinator
        .force_suspend(ForceSuspendCommand {
            actor: "operator".to_string(),
            wake_after_seconds: 0,
            force: true,
        })
        .await;
    assert!(matches!(res, CoordinatorForceSuspendResult::Accepted { .. }));

    // Wait for resume
    let resumed = wait_for_predicate(Duration::from_secs(4), || {
        coordinator.status().state == CoordinatorState::Resumed
    })
    .await;
    assert!(resumed);

    // Exactly 1 request recorded
    assert_eq!(executor.recorded_requests().len(), 1);

    let _ = fixture.state.pty_manager.kill(&session.id);
    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_integrated_agent_activity_disabled_observation() {
    let fixture = setup_agent_activity_fixture(false, 300, 600, None).await;
    let executor = Arc::new(FakeExecutor::new(true));
    let coordinator = fixture
        .state
        .start_idle_suspend_coordinator(executor.clone())
        .await;

    let status = coordinator.status();
    assert_eq!(status.state, CoordinatorState::Disabled);
    assert!(!status.enabled);
    assert_eq!(
        status.automatic_policy,
        IdleSuspendAutomaticPolicy::AgentActivity
    );
    assert!(status.arm_deadline_ms.is_none());
    assert!(status.activity.is_some());
    assert_eq!(executor.recorded_requests().len(), 0);

    coordinator.shutdown().await;
}

#[tokio::test]
async fn test_integrated_agent_activity_shutdown_cleanly_joins() {
    let fixture = setup_agent_activity_fixture(true, 300, 600, None).await;
    let executor = Arc::new(FakeExecutor::new(true));
    let coordinator = fixture
        .state
        .start_idle_suspend_coordinator(executor.clone())
        .await;

    let session = fixture
        .state
        .pty_manager
        .create(make_pty_opts("pty-shutdown-test", "cat"))
        .expect("create pty");

    // Shutdown must complete within 3 seconds
    let shutdown_fut = coordinator.shutdown();
    tokio::time::timeout(Duration::from_secs(3), shutdown_fut)
        .await
        .expect("shutdown must join before timeout");

    let _ = fixture.state.pty_manager.kill(&session.id);
}


struct PanicExecutor;

impl IdleSuspendExecutor for PanicExecutor {
    fn check_capability(&self) -> BoxFuture<'static, bool> {
        Box::pin(async { true })
    }

    fn execute_suspend(
        &self,
        _request: SuspendWithRtcWakeRequest,
    ) -> BoxFuture<'static, SuspendOutcome> {
        panic!("PanicExecutor: execute_suspend MUST NOT be called in live smoke test!");
    }
}

#[test]
#[ignore]
fn activity_live_linux_pty_tcp_child_worker() {
    if std::env::var("DAM_HOPPER_TEST_CHILD_MODE").as_deref() != Ok("1") {
        return;
    }
    let port: u16 = std::env::var("DAM_HOPPER_TEST_PORT")
        .expect("DAM_HOPPER_TEST_PORT")
        .parse()
        .expect("valid port");
    let byte_count: usize = std::env::var("DAM_HOPPER_TEST_BYTES")
        .expect("DAM_HOPPER_TEST_BYTES")
        .parse()
        .expect("valid byte count");

    use std::io::{Read, Write};
    use std::net::TcpStream;

    println!("CHILD_START");
    std::io::stdout().flush().ok();

    let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect to listener");
    let send_data = vec![b'Z'; byte_count];
    stream.write_all(&send_data).expect("write data");
    stream.flush().expect("flush data");

    let mut recv_data = vec![0u8; byte_count];
    stream.read_exact(&mut recv_data).expect("read data");

    println!("CHILD_DONE");
    std::io::stdout().flush().ok();
    // Keep child alive so parent can verify live root and snapshot
    std::thread::sleep(Duration::from_secs(3));
}

#[tokio::test]
#[ignore]
async fn activity_live_linux_pty_tcp_smoke() {
    #[cfg(not(target_os = "linux"))]
    {
        eprintln!("Skipping activity_live_linux_pty_tcp_smoke: Linux only");
        return;
    }

    #[cfg(target_os = "linux")]
    {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let current_exe = std::env::current_exe()
            .expect("current_exe")
            .canonicalize()
            .expect("canonicalize");
        let exe_str = current_exe.display().to_string();

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test listener");
        let port = listener.local_addr().expect("local addr").port();
        listener
            .set_nonblocking(true)
            .expect("set_nonblocking listener");

        // Spawn listener handler in thread
        let (listener_tx, listener_rx) = tokio::sync::oneshot::channel();
        let listener_handle = std::thread::spawn(move || {
            let start = std::time::Instant::now();
            let mut accepted_stream = None;
            while start.elapsed() < Duration::from_secs(5) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        accepted_stream = Some(stream);
                        break;
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(20));
                    }
                    Err(e) => panic!("accept error: {e}"),
                }
            }
            if let Some(mut stream) = accepted_stream {
                let mut buf = vec![0u8; 1024];
                let n = stream.read(&mut buf).expect("read from child");
                stream.write_all(&buf[..n]).expect("echo to child");
                stream.flush().expect("flush echo");
                let _ = listener_tx.send(n);
            }
        });

        // Setup fixture recognizing current_exe as agent
        let fixture = setup_agent_activity_fixture(true, 300, 600, Some(vec![exe_str.clone()])).await;
        let panic_executor = Arc::new(PanicExecutor);
        let coordinator = fixture
            .state
            .start_idle_suspend_coordinator(panic_executor)
            .await;

        let mut pty_opts = make_pty_opts(
            "live-smoke-session",
            &format!(
                "{} activity_live_linux_pty_tcp_child_worker --ignored --exact --nocapture",
                exe_str
            ),
        );
        pty_opts
            .env
            .insert("DAM_HOPPER_TEST_CHILD_MODE".to_string(), "1".to_string());
        pty_opts
            .env
            .insert("DAM_HOPPER_TEST_PORT".to_string(), port.to_string());
        pty_opts
            .env
            .insert("DAM_HOPPER_TEST_BYTES".to_string(), "1024".to_string());

        let session = fixture
            .state
            .pty_manager
            .create(pty_opts)
            .expect("create child session");

        // Wait for child exchange
        let exchanged_bytes = tokio::time::timeout(Duration::from_secs(10), listener_rx)
            .await
            .expect("child exchange timeout")
            .expect("receive from listener");
        assert_eq!(exchanged_bytes, 1024);

        listener_handle.join().expect("join listener thread");

        // Allow snapshot to capture output and process observation
        tokio::time::sleep(Duration::from_millis(500)).await;

        let snap = fixture.state.pty_manager.capture_activity_snapshot();
        assert_eq!(snap.roots.len(), 1);
        let root = &snap.roots[0];
        assert_eq!(root.terminal.session_id, "live-smoke-session");
        // Output sequence must have advanced from child output
        assert!(root.raw_output_sequence.load(Ordering::Relaxed) > 0);

        // Clean up
        let _ = fixture.state.pty_manager.kill(&session.id);
        coordinator.shutdown().await;
    }
}
