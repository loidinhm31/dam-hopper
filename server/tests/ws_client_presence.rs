//! Integration tests for public WebSocket presence, liveness, and session binding.
//!
//! Spins a real dam-hopper-server on loopback, connects real WebSocket clients via
//! tokio-tungstenite, exercises the full upgrade reservation -> live guard -> receipt
//! delivery -> liveness -> graceful teardown lifecycle, and verifies admission fences.

use std::{
    net::SocketAddr,
    sync::Arc,
    time::{Duration, Instant},
};

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tempfile::TempDir;
use tokio::net::TcpListener;
use tokio_tungstenite::{connect_async, tungstenite::Message};

use dam_hopper_server::{
    agent_store::AgentStoreService,
    api::build_router,
    config::{DamHopperConfig, FeaturesConfig, GlobalConfig, WorkspaceInfo},
    crypto::DamHopperOpaqueSuite,
    diagnostics::DiagnosticStore,
    fs::FsSubsystem,
    idle_suspend::ClientPresenceRegistry,
    pty::{BroadcastEventSink, NoopEventSink, PtySessionManager},
    state::AppState,
};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;

mod common;

const TEST_TOKEN: &str = "ws-presence-jwt-secret-xyz";

fn test_jwt() -> String {
    use dam_hopper_server::auth::model::AuthClaims;
    use dam_hopper_server::auth::{
        AUTH_PROTOCOL_VERSION, MOCK_EXPIRY_SECS, MOCK_SESSION_ID, MOCK_USER,
    };
    let claims = AuthClaims {
        v: AUTH_PROTOCOL_VERSION,
        sub: MOCK_USER.to_string(),
        sid: MOCK_SESSION_ID.to_string(),
        auth_version: 0,
        credential_version: 0,
        iat: chrono::Utc::now().timestamp() as usize,
        exp: MOCK_EXPIRY_SECS,
    };
    claims.encode(TEST_TOKEN).unwrap()
}

fn make_test_state(tmp: &TempDir, presence_registry: Option<Arc<ClientPresenceRegistry>>) -> AppState {
    let workspace_dir = tmp.path().to_path_buf();
    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "ws-presence-test".into(),
            root: ".".into(),
        },
        agent_store: None,
        server: dam_hopper_server::config::ServerConfig::default(),
        projects: vec![],
        features: FeaturesConfig::default(),
        config_path: workspace_dir.join("dam-hopper.toml"),
    };

    let (event_sink, _rx) = BroadcastEventSink::new(64);
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink::default()));
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
        TEST_TOKEN.to_string(),
        fs,
        None,
        false,
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )
    .expect("make_test_state failed")
    .with_auth_service(Arc::new(dam_hopper_server::auth::AuthService::new_mock_default().0));

    if let Some(presence) = presence_registry {
        state.with_client_presence(presence)
    } else {
        state
    }
}

async fn spawn_server(state: AppState) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = build_router(state);
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    addr
}

async fn next_text_frame(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    timeout: Duration,
) -> Option<Value> {
    let deadline = Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return None;
        }
        match tokio::time::timeout(remaining, ws.next()).await {
            Ok(Some(Ok(Message::Text(t)))) => {
                return serde_json::from_str(&t).ok();
            }
            Ok(Some(Ok(_))) => continue,
            _ => return None,
        }
    }
}

#[tokio::test]
async fn test_ws_public_client_presence_receipt_and_lifecycle() {
    let tmp = TempDir::new().unwrap();
    let registry = ClientPresenceRegistry::new();
    let state = make_test_state(&tmp, Some(Arc::clone(&registry)));
    let addr = spawn_server(state).await;

    // Initially zero connections
    let initial_snap = registry.snapshot();
    assert_eq!(initial_snap.connection_count, 0);
    assert_eq!(initial_snap.pending_upgrade_count, 0);

    let token = test_jwt();
    let ws_url = format!("ws://{addr}/ws?token={token}");

    let (mut ws, response) = connect_async(&ws_url).await.expect("connect ws");
    assert_eq!(response.status(), 101);

    // First frame received MUST be host:uiConnection
    let frame = next_text_frame(&mut ws, Duration::from_secs(5))
        .await
        .expect("expected uiConnection frame");

    assert_eq!(frame["kind"], "host:uiConnection");
    assert_eq!(frame["version"], 1);
    let connection_id = frame["connectionId"].as_str().expect("connectionId string");
    let capability_secret = frame["decisionCapability"].as_str().expect("decisionCapability string");
    assert!(!connection_id.is_empty());
    assert!(!capability_secret.is_empty());

    // Presence registry must now report exactly 1 live connection
    let live_snap = registry.snapshot();
    assert_eq!(live_snap.connection_count, 1);
    assert_eq!(live_snap.pending_upgrade_count, 0);
    assert!(live_snap.available);

    // Capability verification succeeds for the live connection
    let actor = dam_hopper_server::api::auth::AuthenticatedActor::with_session(
        dam_hopper_server::auth::MOCK_USER,
        Some(dam_hopper_server::auth::MOCK_EXPIRY_SECS),
        dam_hopper_server::auth::MOCK_SESSION_ID,
        0,
        0,
        chrono::Utc::now() + chrono::Duration::hours(1),
        dam_hopper_server::auth::model::UserRole::User,
    );
    assert!(registry
        .verify_decision_capability(connection_id, capability_secret, &actor)
        .is_ok());

    // Wrong capability secret rejected
    assert!(registry
        .verify_decision_capability(connection_id, "wrong-secret", &actor)
        .is_err());

    // Close WebSocket cleanly
    ws.close(None).await.expect("close ws");

    // Wait briefly for server teardown
    let deadline = Instant::now() + Duration::from_secs(5);
    while registry.snapshot().connection_count > 0 && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    let closed_snap = registry.snapshot();
    assert_eq!(closed_snap.connection_count, 0);
    assert_eq!(closed_snap.pending_upgrade_count, 0);
}

#[tokio::test]
async fn test_ws_multiple_clients_and_independent_exit() {
    let tmp = TempDir::new().unwrap();
    let registry = ClientPresenceRegistry::new();
    let state = make_test_state(&tmp, Some(Arc::clone(&registry)));
    let addr = spawn_server(state).await;

    let token = test_jwt();

    let (mut ws1, _) = connect_async(format!("ws://{addr}/ws?token={token}"))
        .await
        .expect("connect ws1");
    let (mut ws2, _) = connect_async(format!("ws://{addr}/ws?token={token}"))
        .await
        .expect("connect ws2");

    let frame1 = next_text_frame(&mut ws1, Duration::from_secs(5))
        .await
        .unwrap();
    let frame2 = next_text_frame(&mut ws2, Duration::from_secs(5))
        .await
        .unwrap();

    let conn1 = frame1["connectionId"].as_str().unwrap();
    let conn2 = frame2["connectionId"].as_str().unwrap();
    assert_ne!(conn1, conn2);

    let sec1 = frame1["decisionCapability"].as_str().unwrap();
    let sec2 = frame2["decisionCapability"].as_str().unwrap();
    assert_ne!(sec1, sec2);

    assert_eq!(registry.snapshot().connection_count, 2);

    // Drop client 1
    drop(ws1);
    let deadline = Instant::now() + Duration::from_secs(5);
    while registry.snapshot().connection_count > 1 && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(registry.snapshot().connection_count, 1);

    // Drop client 2
    drop(ws2);
    let deadline = Instant::now() + Duration::from_secs(5);
    while registry.snapshot().connection_count > 0 && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(registry.snapshot().connection_count, 0);
}

#[tokio::test]
async fn test_ws_capacity_saturation_rejection() {
    let tmp = TempDir::new().unwrap();
    // Registry with max 1 connection
    let registry = ClientPresenceRegistry::with_capacity(1);
    let state = make_test_state(&tmp, Some(Arc::clone(&registry)));
    let addr = spawn_server(state).await;

    let token = test_jwt();

    // Client 1 connects successfully
    let (mut ws1, _) = connect_async(format!("ws://{addr}/ws?token={token}"))
        .await
        .expect("client 1 connect");
    let _ = next_text_frame(&mut ws1, Duration::from_secs(5)).await.unwrap();

    assert_eq!(registry.snapshot().connection_count, 1);
    assert!(!registry.snapshot().available);

    // Client 2 attempts to connect while saturated -> 503 Service Unavailable
    let err = connect_async(format!("ws://{addr}/ws?token={token}"))
        .await
        .unwrap_err();

    match err {
        tokio_tungstenite::tungstenite::Error::Http(resp) => {
            assert_eq!(resp.status(), 503);
        }
        other => panic!("expected 503 error, got: {other:?}"),
    }

    // Client 1 disconnects -> slot freed
    drop(ws1);
    let deadline = Instant::now() + Duration::from_secs(5);
    while registry.snapshot().connection_count > 0 && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(registry.snapshot().available);

    // Client 2 can now connect
    let (mut ws2, _) = connect_async(format!("ws://{addr}/ws?token={token}"))
        .await
        .expect("client 2 connect after freed");
    let frame2 = next_text_frame(&mut ws2, Duration::from_secs(5)).await.unwrap();
    assert_eq!(frame2["kind"], "host:uiConnection");
}

#[tokio::test]
async fn test_ws_ping_pong_liveness_interaction() {
    let tmp = TempDir::new().unwrap();
    let registry = ClientPresenceRegistry::new();
    let state = make_test_state(&tmp, Some(Arc::clone(&registry)));
    let addr = spawn_server(state).await;

    let token = test_jwt();
    let (mut ws, _) = connect_async(format!("ws://{addr}/ws?token={token}"))
        .await
        .expect("connect");

    let frame = next_text_frame(&mut ws, Duration::from_secs(5)).await.unwrap();
    let _conn_id = frame["connectionId"].as_str().unwrap();

    // Client sends Ping with payload
    ws.send(Message::Ping("test-nonce-123".into()))
        .await
        .expect("send ping");

    // Client expects matching Pong frame from server
    let pong_received = tokio::time::timeout(Duration::from_secs(5), async {
        while let Some(Ok(msg)) = ws.next().await {
            if let Message::Pong(payload) = msg {
                if payload.as_ref() == b"test-nonce-123" {
                    return true;
                }
            }
        }
        false
    })
    .await
    .unwrap_or(false);

    assert!(pong_received, "Server must respond to Ping with matching Pong");

    // Liveness deadline check in registry passes
    assert!(registry.check_heartbeat_deadlines(Duration::from_secs(10)).is_empty());

    // Sending Pong from client refreshes liveness
    ws.send(Message::Pong(vec![].into())).await.expect("send pong");
    assert!(registry.check_heartbeat_deadlines(Duration::from_secs(10)).is_empty());
    assert_eq!(registry.snapshot().connection_count, 1);

    drop(ws);
}
#[tokio::test]
async fn test_ws_unauthenticated_rejection_leaves_presence_zero() {
    let tmp = TempDir::new().unwrap();
    let registry = ClientPresenceRegistry::new();
    let state = make_test_state(&tmp, Some(Arc::clone(&registry)));
    let addr = spawn_server(state).await;

    // Connect with completely invalid token
    let err = connect_async(format!("ws://{addr}/ws?token=invalid-garbage-token"))
        .await
        .unwrap_err();

    match err {
        tokio_tungstenite::tungstenite::Error::Http(resp) => {
            assert_eq!(resp.status(), 401);
        }
        other => panic!("expected 401 error, got: {other:?}"),
    }

    // Presence count and pending count must remain strictly zero
    let snap = registry.snapshot();
    assert_eq!(snap.connection_count, 0);
    assert_eq!(snap.pending_upgrade_count, 0);
    assert_eq!(snap.revision, 0);
}
