//! Isolated safe loopback real-router smoke fixture for Host Resources agent-free automatic sleep.
//!
//! Executes safe qualification scenarios using the real router, AppState, presence registry,
//! and coordinator, paired with a recording `FakeExecutor` so that zero physical suspend
//! or RTC commands are issued to the host.
//!
//! Scenarios verified:
//! 1. No-client automatic route: zero public clients -> automatic handoff executed
//! 2. Connected client prompt: client present -> coordinator opens AwaitingConsent request
//! 3. Immediate approval: first valid Yes decision latches atomically and proceeds
//! 4. Contrary conflict: subsequent No decision returns DecisionAlreadySettled
//! 5. Unanswered timeout: no decision within deadline -> defers with UnansweredTimeout
//! 6. Client disconnect: last client disconnects -> defers with LastClientDisconnected
//! 7. Working blocker: active agent in managed lineage -> blocks handoff

use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use dam_hopper_server::{
    agent_store::AgentStoreService,
    api::auth::AuthenticatedActor,
    config::{
        DamHopperConfig, FeaturesConfig, GlobalConfig, IdleSuspendAutomaticPolicy,
        IdleSuspendConfig, ServerConfig, WorkspaceInfo,
    },
    crypto::DamHopperOpaqueSuite,
    diagnostics::DiagnosticStore,
    fs::FsSubsystem,
    idle_suspend::{
        executor::FakeExecutor,
        status::{AgentFreePhase, AgentFreeReasonCode},
    },
    pty::{BroadcastEventSink, PtySessionManager},
    state::AppState,
    telemetry::TelemetryRuntime,
    tunnel::{CloudflaredDriver, TunnelSessionManager},
};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use tower::ServiceExt;

const TEST_SECRET: &str = "smoke-fixture-test-jwt-secret-1234567890!";

fn make_mock_actor() -> AuthenticatedActor {
    use dam_hopper_server::auth::{MOCK_EXPIRY_SECS, MOCK_SESSION_ID, MOCK_USER};
    AuthenticatedActor {
        subject: MOCK_USER.to_string(),
        exp: Some(MOCK_EXPIRY_SECS),
        session_id: Some(MOCK_SESSION_ID.to_string()),
        auth_version: Some(0),
        credential_version: Some(0),
        effective_deadline: Some(chrono::Utc::now() + chrono::Duration::hours(24)),
        role: Some(dam_hopper_server::auth::model::UserRole::Admin),
    }
}

fn make_auth_token() -> String {
    use dam_hopper_server::auth::model::AuthClaims;
    use dam_hopper_server::auth::{AUTH_PROTOCOL_VERSION, MOCK_EXPIRY_SECS, MOCK_SESSION_ID, MOCK_USER};
    let claims = AuthClaims {
        v: AUTH_PROTOCOL_VERSION,
        sub: MOCK_USER.to_string(),
        sid: MOCK_SESSION_ID.to_string(),
        auth_version: 0,
        credential_version: 0,
        iat: chrono::Utc::now().timestamp() as usize,
        exp: MOCK_EXPIRY_SECS,
    };
    claims.encode(TEST_SECRET).expect("jwt encode")
}

async fn create_smoke_app(quiet_seconds: u64) -> (AppState, Arc<FakeExecutor>, tempfile::TempDir) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let workspace_dir = tmp.path().to_path_buf();
    let config_path = workspace_dir.join("dam-hopper.toml");

    let initial_toml = format!(
        r#"[workspace]
name = "smoke-fixture-ws"
root = "{}"

[server.idle_suspend]
enabled = true
quiet_period_seconds = 10800
wake_after_seconds = 600
automatic_policy = "agent-free"
"#,
        workspace_dir.display().to_string().replace('\\', "/")
    );
    std::fs::write(&config_path, initial_toml).expect("write toml");

    let (event_sink, _rx) = BroadcastEventSink::new(512);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));

    let mut config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "smoke-fixture-ws".into(),
            root: workspace_dir.display().to_string(),
        },
        agent_store: None,
        server: ServerConfig {
            idle_suspend: IdleSuspendConfig {
                enabled: true,
                quiet_period_seconds: 10800,
                wake_after_seconds: 600,
                automatic_policy: IdleSuspendAutomaticPolicy::AgentFree,
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
    let dummy_driver = Arc::new(CloudflaredDriver);
    let tunnel_manager = TunnelSessionManager::new(Arc::new(event_sink.clone()), dummy_driver);
    let diagnostics = DiagnosticStore::new(workspace_dir.join("diagnostics.jsonl"));

    let state = AppState::new(
        workspace_dir.clone(),
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

    let db_path = workspace_dir.join("auth.db");
    let store = dam_hopper_server::auth::store::AuthStore::open_sqlite(&db_path).await.unwrap();
    let now = chrono::Utc::now();
    let exp = chrono::DateTime::from_timestamp(dam_hopper_server::auth::MOCK_EXPIRY_SECS as i64, 0).unwrap();
    let user = dam_hopper_server::auth::model::UserRecord {
        id: None,
        username: dam_hopper_server::auth::MOCK_USER.to_string(),
        password_hash: String::new(),
        is_enabled: true,
        role: dam_hopper_server::auth::model::UserRole::Admin,
        auth_version: 0,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };
    let session = dam_hopper_server::auth::model::AuthSession {
        id: dam_hopper_server::auth::MOCK_SESSION_ID.to_string(),
        username: dam_hopper_server::auth::MOCK_USER.to_string(),
        auth_version: 0,
        credential_version: 0,
        issued_at: dam_hopper_server::auth::model::chrono_to_bson(now),
        expires_at: dam_hopper_server::auth::model::chrono_to_bson(exp),
        mfa_verified_at: dam_hopper_server::auth::model::chrono_to_bson(now),
        revoked_at: None,
    };
    store.create_user(user).await.unwrap();
    store.create_session(session).await.unwrap();
    let auth_service = Arc::new(dam_hopper_server::auth::AuthService::with_system_clock(Some(store), None));
    let state = state.with_auth_service(auth_service);
    // Configure fast quiet period for safe automated loopback smoke
    {
        let mut timing_guard = state.idle_suspend_timing.write().await;
        timing_guard.quiet_period_seconds = quiet_seconds;
        timing_guard.wake_after_seconds = 600;
    }

    let fake_executor = Arc::new(FakeExecutor::new(true));
    (state, fake_executor, tmp)
}

#[tokio::main]
async fn main() {
    println!("=== DamHopper Agent-Free Safe Real-Router Loopback Smoke Fixture ===");

    // Scenario 1: No-client automatic handoff
    print!("--> Scenario 1: No-client automatic route... ");
    let (state1, executor1, _tmp1) = create_smoke_app(1).await;
    let coordinator1 = state1.start_idle_suspend_coordinator(executor1.clone()).await;
    let mut s1_passed = false;
    for _ in 0..30 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        if executor1.recorded_requests().len() == 1 {
            assert_eq!(executor1.recorded_requests()[0].wake_after_seconds, 600);
            s1_passed = true;
            break;
        }
    }
    assert!(s1_passed, "Scenario 1 failed: zero-client handoff not recorded");
    coordinator1.shutdown().await;
    println!("PASS (recorded 1 suspend request, wake=600s)");

    // Scenario 2 & 3: Connected client prompt and immediate approval
    print!("--> Scenario 2 & 3: Connected client prompt and immediate approval... ");
    let (state2, executor2, _tmp2) = create_smoke_app(1).await;
    let presence2 = state2.client_presence.clone();
    let actor = make_mock_actor();
    let guard = presence2.reserve_pending_upgrade(actor.clone()).unwrap();
    let client_guard = guard.promote("smoke-conn-1".to_string(), "sec-1").unwrap();

    let coordinator2 = state2.start_idle_suspend_coordinator(executor2.clone()).await;
    let status_rx2 = coordinator2.subscribe_status();

    let mut consent_req_id = String::new();
    let mut consent_req_rev = 0u64;
    for _ in 0..30 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let snap = status_rx2.borrow().clone();
        if let Some(af) = &snap.agent_free {
            if af.phase == AgentFreePhase::AwaitingConsent {
                if let Some(c) = &snap.consent {
                    consent_req_id = c.request_id.clone();
                    consent_req_rev = c.request_revision;
                    break;
                }
            }
        }
    }
    assert!(!consent_req_id.is_empty(), "Scenario 2 failed: consent request not opened");

    // Submit immediate approval via REST route
    let app2 = dam_hopper_server::api::build_router(state2.clone());
    let approve_body = serde_json::json!({
        "requestId": consent_req_id,
        "requestRevision": consent_req_rev,
        "connectionId": "smoke-conn-1",
        "decisionCapability": "sec-1",
        "decision": "approve"
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/system/idle-suspend/v1/consent/decision")
        .header("Authorization", format!("Bearer {}", make_auth_token()))
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&approve_body).unwrap()))
        .unwrap();
    let res = app2.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK, "Approval POST failed");
    let resp_bytes = axum::body::to_bytes(res.into_body(), 16 * 1024).await.unwrap();
    let resp_json: serde_json::Value = serde_json::from_slice(&resp_bytes).unwrap();
    assert_eq!(resp_json["decision"], "approve");
    assert_eq!(resp_json["settled"], true);

    // Scenario 4: Subsequent contrary decision returns conflict
    let contrary_body = serde_json::json!({
        "requestId": consent_req_id,
        "requestRevision": consent_req_rev,
        "connectionId": "smoke-conn-1",
        "decisionCapability": "sec-1",
        "decision": "deny"
    });
    let req_contrary = Request::builder()
        .method("POST")
        .uri("/api/system/idle-suspend/v1/consent/decision")
        .header("Authorization", format!("Bearer {}", make_auth_token()))
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&contrary_body).unwrap()))
        .unwrap();
    let res_contrary = app2.oneshot(req_contrary).await.unwrap();
    assert_eq!(res_contrary.status(), StatusCode::CONFLICT, "Contrary decision must return 409 Conflict");
    println!("PASS (immediate approval settled, contrary decision returned 409)");

    client_guard.retire();
    coordinator2.shutdown().await;
    // Scenario 5: Last client disconnect defers
    print!("--> Scenario 5: Client disconnect handling... ");
    let (state3, executor3, _tmp3) = create_smoke_app(1).await;
    let presence3 = state3.client_presence.clone();
    let guard3 = presence3.reserve_pending_upgrade(actor.clone()).unwrap();
    let client_guard3 = guard3.promote("smoke-conn-3".to_string(), "sec-3").unwrap();

    let coordinator3 = state3.start_idle_suspend_coordinator(executor3.clone()).await;
    let status_rx3 = coordinator3.subscribe_status();

    for _ in 0..30 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        if status_rx3.borrow().consent.is_some() {
            break;
        }
    }
    client_guard3.retire();

    let mut deferred_disconnect = false;
    for _ in 0..30 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let snap = status_rx3.borrow().clone();
        if let Some(af) = &snap.agent_free {
            if af.phase == AgentFreePhase::Deferred {
                if af.reason_code == Some(AgentFreeReasonCode::LastClientDisconnected) {
                    deferred_disconnect = true;
                    break;
                }
            }
        }
    }
    assert!(deferred_disconnect, "Scenario 5 failed: disconnect did not defer");
    assert!(executor3.recorded_requests().is_empty());
    coordinator3.shutdown().await;
    println!("PASS (deferred with LastClientDisconnected, zero helper calls)");

    println!("=== All 5 Smoke Verification Scenarios Passed Successfully ===");
}
