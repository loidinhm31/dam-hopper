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
        DamHopperConfig, FeaturesConfig, GlobalConfig, IdleSuspendConfig, RestartPolicy,
        ServerConfig, WorkspaceInfo, DEFAULT_RESTART_MAX_RETRIES,
    },
    crypto::DamHopperOpaqueSuite,
    diagnostics::DiagnosticStore,
    fs::FsSubsystem,
    idle_suspend::{
        coordinator::{CoordinatorTimingResult, UpdateTimingCommand},
        executor::{BoxFuture, FakeExecutor, IdleSuspendExecutor},
        protocol::{SuspendOutcome, SuspendWithRtcWakeRequest},
        status::{CoordinatorState, IdleSuspendStatusV1},
        UnavailableExecutor,
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
            assert!(request_id.starts_with("epoch-"));
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
    assert_eq!(requests[1].request_id, "epoch-2");

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
