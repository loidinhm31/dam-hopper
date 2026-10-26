#![cfg(target_os = "linux")]

//! Focused Phase 09 integration suite for `/ws/semantic/v1` live authentication
//! cutoff under non-reading consumers (SQLite + mandatory MongoDB), including
//! nonzero unsaved overlay accounting before cutoff and zero accounting after
//! independently observed bounded tree reap. Also covers strict input/result URI
//! containment, symlink/root replacement nondisclosure, and capability/method/
//! command-field denial.

use std::{
    net::SocketAddr,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::net::TcpListener;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{handshake::client::generate_key, http, Message},
};

use dam_hopper_server::{
    agent_store::AgentStoreService,
    api::{
        build_router_with_origins,
        semantic_ws::{
            subscribe_semantic_socket_observations, AuthCutoffTelemetry, SemanticSocketObservation,
            SemanticSocketObservationKind as Observation, CLOSE_AUTH_UNAVAILABLE,
            CLOSE_FULL_LOGIN_REQUIRED, CLOSE_MFA_REQUIRED, SEMANTIC_SUBPROTOCOL,
        },
    },
    auth::{
        model::{AuthClaims, AuthSession, UserRecord},
        Clock, AUTH_PROTOCOL_VERSION, MOCK_EXPIRY_SECS, MOCK_SESSION_ID, MOCK_USER,
    },
    config::{
        DamHopperConfig, FeaturesConfig, GlobalConfig, ProjectConfig, ProjectType, WorkspaceInfo,
    },
    crypto::DamHopperOpaqueSuite,
    diagnostics::DiagnosticStore,
    fs::FsSubsystem,
    pty::{BroadcastEventSink, NoopEventSink, PtySessionManager},
    state::AppState,
};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;

mod common;

const TEST_SECRET: &str = "test-semantic-containment-jwt-secret";
const TRUSTED_ORIGIN: &str = "http://trusted.semantic.local";

fn make_valid_jwt(sub: &str, sid: &str) -> String {
    let claims = AuthClaims {
        v: AUTH_PROTOCOL_VERSION,
        sub: sub.to_string(),
        sid: sid.to_string(),
        auth_version: 0,
        credential_version: 0,
        iat: chrono::Utc::now().timestamp() as usize,
        exp: MOCK_EXPIRY_SECS,
    };
    claims.encode(TEST_SECRET).unwrap()
}

async fn start_server_with_origin(state: AppState) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = build_router_with_origins(
        state,
        vec![axum::http::HeaderValue::from_static(TRUSTED_ORIGIN)],
    );
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    addr
}

async fn read_next_json(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Result<Value, String> {
    read_next_json_with_timeout(ws, Duration::from_secs(5)).await
}

async fn read_initialize_json(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    expected_id: u64,
) -> Result<Value, String> {
    // Match the production client's handshake budget, not its navigation budget.
    let response = read_next_json_with_timeout(ws, Duration::from_secs(15)).await?;
    if response.get("id").and_then(Value::as_u64) != Some(expected_id) {
        return Err("Initialize response ID mismatch".into());
    }
    if response.get("error").is_some() || !response.get("result").is_some_and(Value::is_object) {
        return Err("Initialize response did not contain a successful result".into());
    }
    Ok(response)
}

async fn read_next_json_with_timeout(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    budget: Duration,
) -> Result<Value, String> {
    let deadline = tokio::time::Instant::now() + budget;
    loop {
        // Even an always-ready stream of control frames cannot extend the deadline.
        if tokio::time::Instant::now() >= deadline {
            return Err(format!(
                "JSON receive timeout after {} ms",
                budget.as_millis()
            ));
        }
        let message = tokio::time::timeout_at(deadline, ws.next())
            .await
            .map_err(|_| format!("JSON receive timeout after {} ms", budget.as_millis()))?;
        match message {
            Some(Ok(Message::Text(text))) => {
                // Never include payloads, credentials, paths or raw parser errors.
                return serde_json::from_str(&text).map_err(|error| {
                    format!(
                        "Invalid JSON: category={:?}, line={}, column={}",
                        error.classify(),
                        error.line(),
                        error.column(),
                    )
                });
            }
            Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
            Some(Ok(Message::Close(frame))) => {
                return Err(format!(
                    "WebSocket Close: code={:?} (reason redacted)",
                    frame.map(|frame| u16::from(frame.code)),
                ));
            }
            Some(Ok(Message::Binary(_))) => return Err("Unexpected binary frame".into()),
            Some(Ok(_)) => return Err("Unexpected non-JSON frame".into()),
            Some(Err(_)) => return Err("WebSocket transport error (details redacted)".into()),
            None => return Err("WebSocket EOF without Close frame".into()),
        }
    }
}

#[tokio::test]
async fn test_uri_containment_symlink_root_replacement_and_command_field_denial() {
    let tmp = TempDir::new().unwrap();
    let project_dir = tmp.path().join("containment-project");
    let outside_dir = tmp.path().join("outside-secret-zone");
    std::fs::create_dir_all(project_dir.join("src")).unwrap();
    std::fs::create_dir_all(&outside_dir).unwrap();

    let in_file = project_dir.join("src/index.ts");
    let outside_file = outside_dir.join("secret.ts");
    std::fs::write(&in_file, "export const x = 1;\n").unwrap();
    std::fs::write(&outside_file, "export const secret = 'top-secret';\n").unwrap();

    // Symlink vectors inside project_dir pointing to outside_dir
    std::os::unix::fs::symlink(&outside_file, project_dir.join("src/live_escape.ts")).unwrap();
    std::os::unix::fs::symlink(
        outside_dir.join("nonexistent.ts"),
        project_dir.join("src/dangling_escape.ts"),
    )
    .unwrap();
    std::os::unix::fs::symlink(&outside_dir, project_dir.join("src/linked_dir")).unwrap();

    let toolchain = common::semantic_fixtures::TestToolchain::new();
    let profile = toolchain.tool_profile();
    let workspace_dir = tmp.path().to_path_buf();

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "containment-ws".into(),
            root: ".".into(),
        },
        agent_store: None,
        server: dam_hopper_server::config::ServerConfig::default(),
        projects: vec![ProjectConfig {
            name: "containment-project".into(),
            path: project_dir.to_string_lossy().to_string(),
            project_type: ProjectType::Custom,
            services: None,
            commands: None,
            env_file: None,
            tags: None,
            terminals: vec![],
            agents: None,
            restart_policy: Default::default(),
            restart_max_retries: 5,
            health_check_url: None,
        }],
        features: FeaturesConfig::default(),
        config_path: workspace_dir.join("dam-hopper.toml"),
    };

    let (event_sink, _rx) = BroadcastEventSink::new(64);
    let state = AppState::new(
        workspace_dir.clone(),
        config,
        GlobalConfig::default(),
        PtySessionManager::new(Arc::new(NoopEventSink)),
        AgentStoreService::new(workspace_dir.join(".dam-hopper/agent-store")),
        event_sink.clone(),
        TEST_SECRET.to_string(),
        FsSubsystem::new(vec![]),
        None,
        false,
        common::make_tunnel_manager(&event_sink),
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        DiagnosticStore::new(workspace_dir.join("diagnostics.jsonl")),
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )
    .unwrap()
    .with_auth_service(Arc::new(
        dam_hopper_server::auth::AuthService::new_mock_default().0,
    ))
    .with_semantic_supervisor(Arc::new(
        dam_hopper_server::semantic::supervisor::SemanticSupervisor::new(Some(profile)),
    ));
    state.semantic_supervisor.set_enabled(true).await;

    let addr = start_server_with_origin(state.clone()).await;
    let token = make_valid_jwt(MOCK_USER, MOCK_SESSION_ID);

    let req = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .header("Origin", TRUSTED_ORIGIN)
        .body(())
        .unwrap();
    let (mut ws, _) = connect_async(req).await.unwrap();

    // 1. Top-level unknown/command field denial
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "damHopper/attachTarget",
            "command": "workspace/executeCommand",
            "params": { "target": { "project": "containment-project" }, "descriptor": "typescript" }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let res1 = read_next_json(&mut ws).await.unwrap();
    assert_eq!(res1["error"]["data"]["damHopperCode"], "UNKNOWN_FIELD");

    // 2. attachTarget unknown/override field denial
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "damHopper/attachTarget",
            "params": {
                "target": { "project": "containment-project", "rootPath": "/etc" },
                "descriptor": "typescript"
            }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let res2 = read_next_json(&mut ws).await.unwrap();
    assert_eq!(
        res2["error"]["data"]["damHopperCode"],
        "UNKNOWN_ATTACH_FIELD"
    );

    // 3. Valid attachTarget
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "damHopper/attachTarget",
            "params": { "target": { "project": "containment-project" }, "descriptor": "typescript" }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let attach_res = read_next_json(&mut ws).await.unwrap();
    let target_id = attach_res["result"]["targetId"]
        .as_str()
        .unwrap()
        .to_string();

    // 4. initialize with forbidden custom rootUri / initializationOptions / tsserverPath must be rejected with zero children
    for (idx, bad_init_params) in [
        json!({ "rootUri": "file:///etc" }),
        json!({ "rootPath": "/etc" }),
        json!({ "initializationOptions": { "tsserver": { "path": "/bin/sh" } } }),
        json!({ "capabilities": { "plugins": ["evil-plugin"] } }),
    ]
    .into_iter()
    .enumerate()
    {
        let req_id = 10 + idx as i64;
        ws.send(Message::Text(
            json!({
                "jsonrpc": "2.0",
                "id": req_id,
                "method": "initialize",
                "params": bad_init_params
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();
        let bad_init_res = read_next_json(&mut ws).await.unwrap();
        assert_eq!(bad_init_res["id"], req_id);
        assert_eq!(
            bad_init_res["error"]["data"]["damHopperCode"],
            "FORBIDDEN_INITIALIZE_FIELD"
        );
    }
    assert_eq!(
        state
            .semantic_supervisor
            .get_aggregate_status()
            .await
            .active_sessions,
        0,
        "Rejected initialize parameters must spawn zero children"
    );

    // 5. Valid initialize + initialized
    ws.send(Message::Text(
        json!({ "jsonrpc": "2.0", "id": 20, "method": "initialize", "params": {} })
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    let _ = read_initialize_json(&mut ws, 20).await.unwrap();
    ws.send(Message::Text(
        json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} })
            .to_string()
            .into(),
    ))
    .await
    .unwrap();

    // 6. Attack URI containment & symlink vectors on navigation without host path disclosure
    let outside_str = outside_dir.to_string_lossy().to_string();
    let project_str = project_dir.to_string_lossy().to_string();
    for (idx, (attack_uri, expected_code)) in [
        (
            format!("dam-hopper://semantic/{target_id}/../outside-secret-zone/secret.ts"),
            "INVALID_URI",
        ),
        (
            format!("dam-hopper://semantic/{target_id}/src/%2e%2e/secret.ts"),
            "INVALID_URI",
        ),
        (
            format!("dam-hopper://semantic/{target_id}/src%2Findex.ts"),
            "INVALID_URI",
        ),
        (
            format!("dam-hopper://semantic/{target_id}/src%5Cindex.ts"),
            "INVALID_URI",
        ),
        (
            format!("dam-hopper://semantic/{target_id}/C:foo.ts"),
            "INVALID_URI",
        ),
        (
            format!("dam-hopper://semantic/{target_id}/src/live_escape.ts"),
            "OUTSIDE_TARGET",
        ),
        (
            format!("dam-hopper://semantic/{target_id}/src/dangling_escape.ts"),
            "OUTSIDE_TARGET",
        ),
        (
            format!("dam-hopper://semantic/{target_id}/src/linked_dir/new.ts"),
            "OUTSIDE_TARGET",
        ),
    ]
    .into_iter()
    .enumerate()
    {
        let req_id = 30 + idx as i64;
        ws.send(Message::Text(
            json!({
                "jsonrpc": "2.0",
                "id": req_id,
                "method": "textDocument/definition",
                "params": {
                    "textDocument": { "uri": attack_uri },
                    "position": { "line": 0, "character": 0 },
                    "damHopperDocumentVersion": 1
                }
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();
        let err_res = read_next_json(&mut ws).await.unwrap();
        assert_eq!(err_res["id"], req_id);
        assert_eq!(err_res["error"]["data"]["damHopperCode"], expected_code);
        let raw_err_str = err_res.to_string();
        assert!(
            !raw_err_str.contains(&outside_str) && !raw_err_str.contains(&project_str),
            "Error response must never disclose host filesystem paths: {raw_err_str}"
        );
    }

    // 7. Unknown field on navigation params (`command` / `workDoneToken`) must be denied
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "id": 60,
            "method": "textDocument/definition",
            "params": {
                "textDocument": { "uri": format!("dam-hopper://semantic/{target_id}/src/index.ts") },
                "position": { "line": 0, "character": 0 },
                "damHopperDocumentVersion": 1,
                "workDoneToken": "tok-1"
            }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let nav_field_err = read_next_json(&mut ws).await.unwrap();
    assert_eq!(
        nav_field_err["error"]["data"]["damHopperCode"],
        "UNKNOWN_NAVIGATION_FIELD"
    );

    // 8. Replace target root directory with a symlink to outside_dir mid-session
    let backup_dir = tmp.path().join("containment-project-backup");
    std::fs::rename(&project_dir, &backup_dir).unwrap();
    std::os::unix::fs::symlink(&outside_dir, &project_dir).unwrap();

    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "id": 70,
            "method": "textDocument/definition",
            "params": {
                "textDocument": { "uri": format!("dam-hopper://semantic/{target_id}/src/index.ts") },
                "position": { "line": 0, "character": 0 },
                "damHopperDocumentVersion": 1
            }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let root_replaced_err = read_next_json(&mut ws).await.unwrap();
    assert_eq!(root_replaced_err["id"], 70);
    assert_eq!(
        root_replaced_err["error"]["data"]["damHopperCode"],
        "TARGET_IDENTITY_MODIFIED"
    );
}

#[derive(Clone, Copy, Debug)]
enum InvalidationTrigger {
    DisableAccount,
    RevokeSession,
    BumpUserAuthVersion,
    BumpSessionCredentialVersion,
    DeleteSession,
    DeleteAccount,
    MfaDeadlineDue,
    SessionExpired,
    BackendStoreTimeout,
    BackendQueryFailure,
}

async fn connect_low_rcvbuf_ws(
    addr: SocketAddr,
    token: &str,
) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
    let tcp_sock = tokio::net::TcpSocket::new_v4().unwrap();
    tcp_sock.set_recv_buffer_size(4096).unwrap();
    let tcp_stream = tcp_sock.connect(addr).await.unwrap();

    let req = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .header("Origin", TRUSTED_ORIGIN)
        .body(())
        .unwrap();

    let (ws, resp) =
        tokio_tungstenite::client_async(req, tokio_tungstenite::MaybeTlsStream::Plain(tcp_stream))
            .await
            .unwrap();
    assert_eq!(resp.status(), 101);
    ws
}

type SemanticWs =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// Per-case evidence is retained through failure, never globally cleared, and
/// contains only fixed stage names, timings, byte counts and aggregate counters.
struct CaseObserver {
    receiver: tokio::sync::broadcast::Receiver<SemanticSocketObservation>,
    state: AppState,
    connection_id: Option<String>,
    started: Instant,
    trigger: InvalidationTrigger,
    backend: &'static str,
    events: Vec<Value>,
    samples: Vec<Value>,
    sample_tick: tokio::time::Interval,
    pending: Option<(u64, Instant)>,
    blocked_at_cutoff_ms: Option<u64>,
    cutoff: Option<AuthCutoffTelemetry>,
    cutoff_event: Option<SemanticSocketObservation>,
    closed_event: Option<SemanticSocketObservation>,
    reap_observed: bool,
    cancel_observed: bool,
    qualified: bool,
}

impl CaseObserver {
    fn new(fixture: &common::auth_fixtures::AuthTestFixture, trigger: InvalidationTrigger) -> Self {
        Self {
            receiver: subscribe_semantic_socket_observations(),
            state: fixture.state.clone(),
            connection_id: None,
            started: Instant::now(),
            trigger,
            backend: if fixture.sqlite_path().is_some() {
                "sqlite"
            } else {
                "mongo"
            },
            events: Vec::new(),
            samples: Vec::new(),
            sample_tick: tokio::time::interval(Duration::from_millis(250)),
            pending: None,
            blocked_at_cutoff_ms: None,
            cutoff: None,
            cutoff_event: None,
            closed_event: None,
            reap_observed: false,
            cancel_observed: false,
            qualified: false,
        }
    }

    async fn sample(&mut self) {
        assert!(
            self.samples.len() < 160,
            "Finite per-case observation budget exhausted"
        );
        let status = tokio::time::timeout(
            Duration::from_millis(500),
            self.state.semantic_supervisor.get_aggregate_status(),
        )
        .await
        .expect("Aggregate observation must not hang behind teardown");
        self.samples.push(json!({
            "elapsedMs": self.started.elapsed().as_millis(),
            "activeSessions": status.active_sessions,
            "activeTrees": status.active_trees,
            "openDocuments": status.open_documents,
            "overlayBytes": status.total_overlay_bytes,
        }));
    }

    async fn next(&mut self, deadline: Instant) -> Option<SemanticSocketObservation> {
        loop {
            tokio::select! {
                result = self.receiver.recv() => {
                    let event = result.expect("Bounded socket observer must not lag or close");
                    if let Some(id) = &self.connection_id {
                        if event.connection_id != *id {
                            continue;
                        }
                    } else {
                        let Observation::Opened { presence } = &event.kind else { continue };
                        if !presence.upgrade().is_some_and(|registry| Arc::ptr_eq(&registry, &self.state.client_presence)) {
                            continue;
                        }
                        self.connection_id = Some(event.connection_id.clone());
                    }
                    let stage = match &event.kind {
                        Observation::Opened { .. } => "opened",
                        Observation::AuthCheckStarted => "authCheckStarted",
                        Observation::AuthCheckPassed { .. } => "authCheckPassed",
                        Observation::SendPending { send_id, bytes, accounted_bytes } => {
                            assert!(*accounted_bytes >= *bytes);
                            assert!(*accounted_bytes <= dam_hopper_server::semantic::resources::MAX_QUEUED_BYTES);
                            if *bytes >= 1024 * 1024 {
                                self.pending = Some((*send_id, event.at));
                            }
                            "sendPending"
                        }
                        Observation::SendFinished { send_id, .. } => {
                            if self.pending.is_some_and(|(id, _)| id == *send_id) {
                                self.pending = None;
                            }
                            "sendFinished"
                        }
                        Observation::AdmissionRevoked => {
                            self.blocked_at_cutoff_ms = self.pending.map(|(_, since)|
                                event.at.saturating_duration_since(since).as_millis() as u64);
                            "admissionRevoked"
                        }
                        Observation::ReapCompleted => { self.reap_observed = true; "reapCompleted" }
                        Observation::CancelSignalled => { self.cancel_observed = true; "cancelSignalled" }
                        Observation::AuthCutoffCompleted(telemetry) => {
                            self.cutoff = Some(telemetry.clone());
                            self.cutoff_event = Some(event.clone());
                            "authCutoffCompleted"
                        }
                        Observation::Closed => {
                            self.pending = None;
                            self.closed_event = Some(event.clone());
                            "closed"
                        }
                    };
                    assert!(self.events.len() < 256, "Finite per-case event budget exhausted");
                    let mut record = json!({
                        "stage": stage,
                        "elapsedMs": event.at.saturating_duration_since(self.started).as_millis(),
                    });
                    match &event.kind {
                        Observation::SendPending { send_id, bytes, accounted_bytes } => {
                            record["sendId"] = json!(send_id);
                            record["bytes"] = json!(bytes);
                            record["accountedBytes"] = json!(accounted_bytes);
                        }
                        Observation::SendFinished { send_id, succeeded } => {
                            record["sendId"] = json!(send_id);
                            record["succeeded"] = json!(succeeded);
                        }
                        _ => {}
                    }
                    self.events.push(record);
                    return Some(event);
                }
                _ = self.sample_tick.tick() => {
                    self.sample().await;
                    return None;
                }
                _ = tokio::time::sleep_until(deadline.into()) => {
                    return None;
                }
            }
        }
    }
    async fn observe_until(&mut self, until: Instant) {
        while Instant::now() < until {
            self.next(until).await;
        }
    }

    async fn wait_for(
        &mut self,
        deadline: Instant,
        predicate: impl Fn(&Observation) -> bool,
    ) -> SemanticSocketObservation {
        for event in [&self.cutoff_event, &self.closed_event]
            .into_iter()
            .flatten()
        {
            if predicate(&event.kind) {
                return event.clone();
            }
        }
        loop {
            assert!(
                Instant::now() < deadline,
                "Bounded live-auth observation timed out for {:?}",
                self.trigger
            );
            if let Some(event) = self.next(deadline).await {
                if predicate(&event.kind) {
                    return event;
                }
            }
        }
    }
}

impl Drop for CaseObserver {
    fn drop(&mut self) {
        eprintln!(
            "semantic_auth_case {}",
            json!({
                "backend": self.backend,
                "trigger": format!("{:?}", self.trigger),
                "qualified": self.qualified,
                "blockedAtCutoffMs": self.blocked_at_cutoff_ms,
                "cutoff": self.cutoff,
                "events": self.events,
                "aggregateSamples": self.samples,
            })
        );
    }
}

struct UnreadSocket(tokio::task::JoinHandle<(SemanticWs, &'static str)>);

impl Drop for UnreadSocket {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Fill the real socket until an actual large send has remained Pending for
/// 100ms. No client reads, production sleeps, or assumed TCP buffer capacity.
async fn saturate_outbound_backpressure(
    ws: SemanticWs,
    observer: &mut CaseObserver,
) -> UnreadSocket {
    let payload = json!({
        "jsonrpc": "2.0", "id": 1000,
        "method": format!("unknown_{}", "x".repeat(1024 * 1024)),
        "params": {},
    })
    .to_string();
    let socket = UnreadSocket(tokio::spawn(async move {
        let mut ws = ws;
        // At most 16 replies: below the message cap and rate burst. A stalled
        // reader can also backpressure client writes; retain the unread socket
        // instead of requiring the entire finite producer batch to drain.
        let mut outcome = "allRequestsSent";
        for _ in 0..16 {
            match tokio::time::timeout(
                Duration::from_secs(1),
                ws.send(Message::Text(payload.clone().into())),
            )
            .await
            {
                Ok(Ok(())) => {}
                Ok(Err(_)) => {
                    outcome = "transportEnded";
                    break;
                }
                Err(_) => {
                    outcome = "sendBackpressured";
                    break;
                }
            }
        }
        (ws, outcome)
    }));
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        assert!(
            Instant::now() < deadline,
            "No sustained real socket backpressure was observed"
        );
        assert!(observer.cutoff.is_none() && observer.closed_event.is_none(),
            "Auth cutoff/connection close occurred before real backpressure overlap was established");
        if observer
            .pending
            .is_some_and(|(_, since)| since.elapsed() >= Duration::from_millis(100))
        {
            return socket;
        }
        observer.next(deadline).await;
    }
}

/// A separate process is essential: Unix fcntl locks belong to the process,
/// not the thread. SQLite's bundled Unix WAL VFS uses bytes 123..128 for its
/// five reader slots (WALINDEX_LOCK_OFFSET=120, WAL_READ_LOCK(i)=3+i).
/// Holding *all* slots forces real SELECT contention, unlike BEGIN IMMEDIATE
/// in WAL mode, which does not prevent readers at all.
#[test]
#[ignore = "Subprocess-only SQLite lock fixture, exercised by the SQLite matrix"]
fn sqlite_wal_reader_lock_helper() {
    use std::io::{Read, Write};
    use std::os::fd::AsRawFd;
    let Some(db_path) = std::env::var_os("SEMANTIC_AUTH_WAL_LOCK_DB") else {
        return;
    };
    let socket_path = std::env::var_os("SEMANTIC_AUTH_WAL_LOCK_CONTROL").unwrap();
    let mut control = std::os::unix::net::UnixStream::connect(socket_path).unwrap();
    control
        .set_read_timeout(Some(Duration::from_secs(30)))
        .unwrap();
    let mut shm_path = db_path;
    shm_path.push("-shm");
    let shm = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(shm_path)
        .unwrap();
    // SAFETY: flock is a plain C record; all fields used by F_SETLK are set.
    let mut lock: libc::flock = unsafe { std::mem::zeroed() };
    lock.l_type = libc::F_WRLCK as _;
    lock.l_whence = libc::SEEK_SET as _;
    lock.l_start = 123;
    lock.l_len = 5;
    // SAFETY: shm is open, and lock points to a valid flock for this syscall.
    assert_eq!(
        unsafe { libc::fcntl(shm.as_raw_fd(), libc::F_SETLK, &lock) },
        0,
        "Failed to acquire SQLite WAL reader slots: {}",
        std::io::Error::last_os_error()
    );
    control.write_all(&[1]).unwrap();
    let mut release = [0];
    control
        .read_exact(&mut release)
        .expect("Parent must release WAL lock within bounded watchdog");
    // The descriptor remains live until the helper exits, releasing all locks.
    drop(shm);
}

struct SqliteReadBlocker {
    child: Option<std::process::Child>,
    control: tokio::net::UnixStream,
}

impl SqliteReadBlocker {
    async fn acquire(fixture: &common::auth_fixtures::AuthTestFixture) -> Self {
        use tokio::io::AsyncReadExt;
        let control_path = fixture.tmp_dir.path().join("wal-read-lock.sock");
        let listener = tokio::net::UnixListener::bind(&control_path).unwrap();
        let child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--ignored",
                "--exact",
                "sqlite_wal_reader_lock_helper",
                "--nocapture",
            ])
            .env("SEMANTIC_AUTH_WAL_LOCK_DB", fixture.sqlite_path().unwrap())
            .env("SEMANTIC_AUTH_WAL_LOCK_CONTROL", &control_path)
            .spawn()
            .unwrap();
        // Install the child guard before any await so failure cannot leak locks.
        let (temporary, peer) = tokio::net::UnixStream::pair().unwrap();
        drop(peer);
        let mut blocker = Self {
            child: Some(child),
            control: temporary,
        };
        let (control, _) = tokio::time::timeout(Duration::from_secs(3), listener.accept())
            .await
            .expect("WAL helper did not connect")
            .unwrap();
        blocker.control = control;
        let mut ready = [0];
        tokio::time::timeout(
            Duration::from_secs(3),
            blocker.control.read_exact(&mut ready),
        )
        .await
        .expect("WAL helper did not acquire all reader locks")
        .unwrap();
        assert_eq!(ready, [1]);
        blocker
    }

    async fn release(mut self) {
        use tokio::io::AsyncWriteExt;
        self.control.write_all(&[1]).await.unwrap();
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if let Some(status) = self.child.as_mut().unwrap().try_wait().unwrap() {
                    assert!(status.success(), "WAL reader lock helper failed");
                    self.child = None;
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("WAL lock helper did not exit");
    }
}

impl Drop for SqliteReadBlocker {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

struct MongoProxyControl {
    stalled: AtomicBool,
    blocked_bytes: AtomicU64,
    resumed: tokio::sync::Notify,
}
struct MongoStallReset<'a>(&'a MongoProxyControl);

impl Drop for MongoStallReset<'_> {
    fn drop(&mut self) {
        self.0.set_stalled(false);
    }
}

impl MongoProxyControl {
    fn set_stalled(&self, stalled: bool) {
        if stalled {
            self.blocked_bytes.store(0, Ordering::SeqCst);
        }
        self.stalled.store(stalled, Ordering::SeqCst);
        if !stalled {
            self.resumed.notify_waiters();
        }
    }

    async fn forward<R, W>(&self, mut reader: R, mut writer: W)
    where
        R: tokio::io::AsyncRead + Unpin,
        W: tokio::io::AsyncWrite + Unpin,
    {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut buf = [0u8; 8192];
        loop {
            let n = match reader.read(&mut buf).await {
                Ok(0) | Err(_) => return,
                Ok(n) => n,
            };
            if self.stalled.load(Ordering::SeqCst) {
                self.blocked_bytes.fetch_add(n as u64, Ordering::SeqCst);
                loop {
                    // Register before checking the flag so resume cannot be lost.
                    let resumed = self.resumed.notified();
                    tokio::pin!(resumed);
                    resumed.as_mut().enable();
                    if !self.stalled.load(Ordering::SeqCst) {
                        break;
                    }
                    resumed.await;
                }
            }
            if writer.write_all(&buf[..n]).await.is_err() {
                return;
            }
        }
    }
}

struct MongoProxy(tokio::task::JoinHandle<()>);

impl Drop for MongoProxy {
    fn drop(&mut self) {
        // The accept task owns its JoinSet, whose drop also aborts connections.
        self.0.abort();
    }
}

/// Real Mongo traffic is held at a TCP boundary, never a store mock or failpoint.
async fn start_mongo_tcp_proxy(
    upstream_host_port: &str,
) -> (SocketAddr, Arc<MongoProxyControl>, MongoProxy) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let local_addr = listener.local_addr().unwrap();
    let control = Arc::new(MongoProxyControl {
        stalled: AtomicBool::new(false),
        blocked_bytes: AtomicU64::new(0),
        resumed: tokio::sync::Notify::new(),
    });
    let control_accept = Arc::clone(&control);
    let upstream_target = upstream_host_port.to_string();
    let task = tokio::spawn(async move {
        let mut connections = tokio::task::JoinSet::new();
        loop {
            tokio::select! {
                accepted = listener.accept() => {
                    let Ok((client, _)) = accepted else { break };
                    let target = upstream_target.clone();
                    let control = Arc::clone(&control_accept);
                    connections.spawn(async move {
                        let Ok(upstream) = tokio::net::TcpStream::connect(target).await else { return };
                        let (cr, cw) = client.into_split();
                        let (ur, uw) = upstream.into_split();
                        tokio::select! {
                            _ = control.forward(cr, uw) => {},
                            _ = control.forward(ur, cw) => {},
                        }
                    });
                }
                _ = connections.join_next(), if !connections.is_empty() => {}
            }
        }
    });
    (local_addr, control, MongoProxy(task))
}

async fn run_nonreading_cutoff_case(
    fixture: &common::auth_fixtures::AuthTestFixture,
    addr: SocketAddr,
    project_name: &str,
    trigger: InvalidationTrigger,
    expected_close_code: u16,
    mongo_proxy: Option<&Arc<MongoProxyControl>>,
) {
    tokio::time::timeout(
        Duration::from_secs(40),
        observe_nonreading_cutoff_case(
            fixture,
            addr,
            project_name,
            trigger,
            expected_close_code,
            mongo_proxy,
        ),
    )
    .await
    .unwrap_or_else(|_| panic!("Whole-case live-auth watchdog expired for {trigger:?}"));
}

async fn observe_nonreading_cutoff_case(
    fixture: &common::auth_fixtures::AuthTestFixture,
    addr: SocketAddr,
    project_name: &str,
    trigger: InvalidationTrigger,
    expected_close_code: u16,
    mongo_proxy: Option<&Arc<MongoProxyControl>>,
) {
    let mut observer = CaseObserver::new(fixture, trigger);
    let _resume_proxy = mongo_proxy.map(|proxy| MongoStallReset(proxy));
    if let Some(proxy) = mongo_proxy {
        proxy.set_stalled(false);
    }

    let username = format!("user-{}", uuid::Uuid::new_v4().simple());
    let secret = [0x42u8; 20];
    let _user = fixture
        .create_enrolled_user(&username, "Password123!", &secret)
        .await;
    let now = fixture.clock.now();
    let expires = now + chrono::Duration::hours(1);
    // Exercise MFA freshness independently of the later one-hour session expiry.
    let verified_at = if matches!(trigger, InvalidationTrigger::MfaDeadlineDue) {
        now - chrono::Duration::seconds(dam_hopper_server::auth::policy::MFA_VALIDITY_SECS)
            + chrono::Duration::minutes(1)
    } else {
        now
    };
    let (session, token) = fixture
        .create_session(&username, 0, now, expires, verified_at)
        .await;

    let mut ws = connect_low_rcvbuf_ws(addr, &token).await;

    // Attach and initialize normally; never infer watcher phase from their latency.
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "damHopper/attachTarget",
            "params": { "target": { "project": project_name }, "descriptor": "typescript" }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let attached = read_next_json(&mut ws).await.unwrap();
    assert!(
        attached.get("result").is_some(),
        "Real target attach must succeed"
    );

    ws.send(Message::Text(
        json!({ "jsonrpc": "2.0", "id": 2, "method": "initialize", "params": {} })
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    let initialized = read_initialize_json(&mut ws, 2).await.unwrap();
    assert!(
        initialized.get("result").is_some(),
        "Real child initialize must succeed"
    );

    ws.send(Message::Text(
        json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} })
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    let target_id = attached["result"]["targetId"].as_str().unwrap();
    let overlay_text = "export const unsaved = true;\n";
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didOpen",
            "params": {
                "textDocument": {
                    "uri": format!("dam-hopper://semantic/{target_id}/overlay.ts"),
                    "languageId": "typescript",
                    "version": 1,
                    "text": overlay_text,
                },
            },
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();

    // Client send completion is not actor admission. Wait for a real positive
    // sample within the existing finite observation budgets, then choose cadence.
    let overlay_deadline = Instant::now() + Duration::from_secs(2);
    loop {
        assert!(
            Instant::now() < overlay_deadline,
            "Unsaved overlay was not admitted before cutoff setup"
        );
        tokio::time::timeout_at(overlay_deadline.into(), observer.next(overlay_deadline))
            .await
            .expect("Unsaved overlay observation exceeded setup deadline");
        assert!(
            Instant::now() < overlay_deadline,
            "Unsaved overlay observation arrived after setup deadline"
        );
        if let Some(ready) = observer.samples.last() {
            if ready["openDocuments"] == 1 && ready["overlayBytes"] == overlay_text.len() {
                assert_eq!(ready["activeSessions"], 1);
                assert_eq!(ready["activeTrees"], 1);
                break;
            }
        }
    }

    let healthy = observer
        .wait_for(Instant::now() + Duration::from_secs(12), |kind| {
            matches!(kind, Observation::AuthCheckPassed { next_check_at }
            if *next_check_at > Instant::now() + Duration::from_secs(3))
        })
        .await;
    let Observation::AuthCheckPassed { next_check_at } = healthy.kind else {
        unreachable!()
    };
    let mut sqlite_blocker = None;

    // Apply live auth invalidation trigger
    match trigger {
        InvalidationTrigger::DisableAccount => {
            if let Some(sqlite_path) = fixture.sqlite_path() {
                let conn = rusqlite::Connection::open(sqlite_path).unwrap();
                conn.execute(
                    "UPDATE auth_users SET is_enabled = 0 WHERE username = ?1",
                    [&username],
                )
                .unwrap();
            } else {
                fixture
                    .db()
                    .collection::<UserRecord>("users")
                    .update_one(
                        mongodb::bson::doc! { "username": &username },
                        mongodb::bson::doc! { "$set": { "isEnabled": false } },
                    )
                    .await
                    .unwrap();
            }
        }
        InvalidationTrigger::RevokeSession => {
            fixture
                .store
                .revoke_session(&session.id, now)
                .await
                .unwrap();
        }
        InvalidationTrigger::BumpUserAuthVersion => {
            assert_eq!(fixture.operator_reset_mfa(&username, 1).await, 1);
        }
        InvalidationTrigger::BumpSessionCredentialVersion => {
            fixture
                .store
                .advance_session_mfa(&session.id, 0, now)
                .await
                .unwrap();
        }
        InvalidationTrigger::DeleteSession => {
            if let Some(sqlite_path) = fixture.sqlite_path() {
                let conn = rusqlite::Connection::open(sqlite_path).unwrap();
                conn.execute("DELETE FROM auth_sessions WHERE id = ?1", [&session.id])
                    .unwrap();
            } else {
                fixture
                    .db()
                    .collection::<AuthSession>("authSessions")
                    .delete_one(mongodb::bson::doc! { "_id": &session.id })
                    .await
                    .unwrap();
            }
        }
        InvalidationTrigger::DeleteAccount => {
            if let Some(sqlite_path) = fixture.sqlite_path() {
                let conn = rusqlite::Connection::open(sqlite_path).unwrap();
                conn.execute("DELETE FROM auth_users WHERE username = ?1", [&username])
                    .unwrap();
            } else {
                fixture
                    .db()
                    .collection::<UserRecord>("users")
                    .delete_one(mongodb::bson::doc! { "username": &username })
                    .await
                    .unwrap();
            }
        }
        InvalidationTrigger::MfaDeadlineDue => {
            fixture.clock.advance(chrono::Duration::minutes(1));
        }
        InvalidationTrigger::SessionExpired => {
            fixture.clock.advance(chrono::Duration::hours(2));
        }
        InvalidationTrigger::BackendStoreTimeout => {}
        InvalidationTrigger::BackendQueryFailure => {
            if let Some(sqlite_path) = fixture.sqlite_path() {
                let conn = rusqlite::Connection::open(sqlite_path).unwrap();
                conn.execute("DROP TABLE auth_sessions", []).unwrap();
            } else {
                fixture
                    .db()
                    .collection::<mongodb::bson::Document>("authSessions")
                    .update_one(
                        mongodb::bson::doc! { "_id": &session.id },
                        mongodb::bson::doc! { "$set": { "expiresAt": "corrupt-not-bson-datetime" } },
                    )
                    .await
                    .unwrap();
            }
        }
    }

    let timeout_case = matches!(trigger, InvalidationTrigger::BackendStoreTimeout);
    let flood_at = if timeout_case {
        // The helper acknowledges real WAL reader-slot locks. The watcher's
        // own AuthStore SELECT must then hit the actual 2s lookup deadline;
        // no competing probe can acquire the store's connection mutex first.
        observer
            .observe_until(next_check_at - Duration::from_secs(1))
            .await;
        if fixture.sqlite_path().is_some() {
            sqlite_blocker = Some(SqliteReadBlocker::acquire(fixture).await);
        } else {
            mongo_proxy
                .expect("Mongo timeout requires owned TCP proxy")
                .set_stalled(true);
        }
        let check = observer
            .wait_for(next_check_at + Duration::from_secs(1), |kind| {
                matches!(kind, Observation::AuthCheckStarted)
            })
            .await;
        // The writer has its own 2s send deadline. Start saturation during the
        // *observed* lookup, so ordinary writer timeout cannot preempt cutoff.
        check.at + dam_hopper_server::semantic::resources::AUTH_STORE_LOOKUP_TIMEOUT
            - Duration::from_secs(1)
    } else {
        next_check_at - Duration::from_secs(1)
    };
    observer.observe_until(flood_at).await;
    let mut unread = saturate_outbound_backpressure(ws, &mut observer).await;

    observer
        .wait_for(flood_at + Duration::from_secs(10), |kind| {
            matches!(kind, Observation::AuthCutoffCompleted(_))
        })
        .await;

    // Release fault boundaries before any assertions; timed-out spawn_blocking
    // SQLite work is not cancelled by dropping its async caller.
    if let Some(blocker) = sqlite_blocker {
        blocker.release().await;
        assert!(tokio::time::timeout(
            Duration::from_secs(5),
            fixture.store.get_session(&session.id),
        )
        .await
        .expect("Timed-out watcher SQLite work did not drain")
        .unwrap()
        .is_some());
    }
    if let Some(proxy) = mongo_proxy {
        proxy.set_stalled(false);
    }

    let telemetry = observer.cutoff.as_ref().unwrap();
    assert_eq!(
        telemetry.connection_id,
        *observer.connection_id.as_ref().unwrap()
    );
    assert_eq!(
        telemetry.close_code, expected_close_code,
        "Close code for {trigger:?}"
    );
    assert!(
        observer.blocked_at_cutoff_ms.is_some_and(|ms| ms >= 100),
        "Must observe the same large send Pending for >=100ms and unfinished at admission cutoff",
    );
    assert!(
        observer.reap_observed && observer.cancel_observed,
        "Reap and cancellation stages must be observed for the exact socket"
    );
    if timeout_case {
        assert!(
            telemetry.store_check_duration_ms >= 1900,
            "Real backend lookup deadline was not exercised: {}ms",
            telemetry.store_check_duration_ms
        );
        if let Some(proxy) = mongo_proxy {
            assert!(
                proxy.blocked_bytes.load(Ordering::SeqCst) > 0,
                "Mongo timeout must include observed real blackholed TCP traffic"
            );
        }
    }
    assert!(
        telemetry.admission_cutoff_duration_ms <= 50,
        "Admission cutoff must be immediate: {}ms",
        telemetry.admission_cutoff_duration_ms
    );
    assert!(
        telemetry.reap_completed_duration_ms <= 6000,
        "Tree reap must complete within the 6s qualification budget: {}ms",
        telemetry.reap_completed_duration_ms
    );
    assert!(
        telemetry.cancel_signal_duration_ms <= 6000,
        "Cancellation must complete independently of delivery within 6s"
    );

    observer.sample().await;
    let last = observer.samples.last().unwrap();
    assert_eq!(
        last["activeSessions"], 0,
        "Child sessions must be removed without client reads"
    );
    assert_eq!(
        last["activeTrees"], 0,
        "Physical tree reap, not just map removal, is required"
    );
    assert_eq!(
        last["openDocuments"], 0,
        "Document accounting must clear after bounded reap"
    );
    assert_eq!(
        last["overlayBytes"], 0,
        "Overlay accounting must clear after bounded reap"
    );

    observer
        .wait_for(Instant::now() + Duration::from_secs(3), |kind| {
            matches!(kind, Observation::Closed)
        })
        .await;
    let (ws, producer_outcome) = tokio::time::timeout(Duration::from_secs(1), &mut unread.0)
        .await
        .expect("Finite backpressure request sender did not finish")
        .expect("Backpressure request sender failed");
    observer
        .events
        .push(json!({ "stage": "floodSenderFinished", "outcome": producer_outcome }));
    observer.qualified = true;
    drop(ws);
}

#[tokio::test]
async fn test_live_auth_cutoff_sqlite_matrix_nonreading_consumer() {
    let fixture = common::auth_fixtures::AuthTestFixture::new_sqlite().await;
    let project_dir = fixture.tmp_dir.path().join("sqlite-auth-project");
    std::fs::create_dir_all(&project_dir).unwrap();
    std::fs::write(
        project_dir.join("overlay.ts"),
        "export const saved = true;\n",
    )
    .unwrap();

    {
        let mut cfg = fixture.state.config.write().await;
        cfg.projects.push(ProjectConfig {
            name: "sqlite-auth-project".into(),
            path: project_dir.to_string_lossy().to_string(),
            project_type: ProjectType::Custom,
            services: None,
            commands: None,
            env_file: None,
            tags: None,
            terminals: vec![],
            agents: None,
            restart_policy: Default::default(),
            restart_max_retries: 5,
            health_check_url: None,
        });
    }

    let toolchain = common::semantic_fixtures::TestToolchain::new();
    let profile = toolchain.tool_profile();
    let state = fixture.state.clone().with_semantic_supervisor(Arc::new(
        dam_hopper_server::semantic::supervisor::SemanticSupervisor::new(Some(profile)),
    ));
    state.semantic_supervisor.set_enabled(true).await;

    let mut fixture = fixture;
    fixture.state = state.clone();
    let addr = start_server_with_origin(state).await;

    for (trigger, expected_code) in [
        (
            InvalidationTrigger::DisableAccount,
            CLOSE_FULL_LOGIN_REQUIRED,
        ),
        (
            InvalidationTrigger::RevokeSession,
            CLOSE_FULL_LOGIN_REQUIRED,
        ),
        (
            InvalidationTrigger::BumpUserAuthVersion,
            CLOSE_FULL_LOGIN_REQUIRED,
        ),
        (
            InvalidationTrigger::BumpSessionCredentialVersion,
            CLOSE_FULL_LOGIN_REQUIRED,
        ),
        (
            InvalidationTrigger::DeleteSession,
            CLOSE_FULL_LOGIN_REQUIRED,
        ),
        (
            InvalidationTrigger::DeleteAccount,
            CLOSE_FULL_LOGIN_REQUIRED,
        ),
        (InvalidationTrigger::MfaDeadlineDue, CLOSE_MFA_REQUIRED),
        (
            InvalidationTrigger::SessionExpired,
            CLOSE_FULL_LOGIN_REQUIRED,
        ),
        (
            InvalidationTrigger::BackendStoreTimeout,
            CLOSE_AUTH_UNAVAILABLE,
        ),
        (
            InvalidationTrigger::BackendQueryFailure,
            CLOSE_AUTH_UNAVAILABLE,
        ),
    ] {
        run_nonreading_cutoff_case(
            &fixture,
            addr,
            "sqlite-auth-project",
            trigger,
            expected_code,
            None,
        )
        .await;
    }
}

#[tokio::test]
async fn test_live_auth_cutoff_mongo_mandatory_matrix_nonreading_consumer() {
    let raw_uri = std::env::var("TEST_MONGODB_URI")
        .unwrap_or_else(|_| "mongodb://127.0.0.1:27018".to_string());
    // Qualification owns a plain loopback MongoDB endpoint. Reject URI forms
    // this TCP proxy cannot preserve instead of silently misrouting credentials.
    let endpoint = raw_uri
        .strip_prefix("mongodb://")
        .expect("Qualification Mongo URI must use mongodb://");
    let host_port = endpoint.split(['/', '?']).next().unwrap();
    assert!(
        endpoint == host_port || endpoint == format!("{host_port}/"),
        "Qualification Mongo URI must not specify database, credentials, TLS, or query options"
    );
    let upstream: SocketAddr = host_port
        .parse()
        .expect("Qualification Mongo URI requires one numeric loopback host:port");
    assert!(
        upstream.ip().is_loopback(),
        "Qualification Mongo must be owned loopback"
    );
    let (proxy_addr, proxy_stalled, _proxy) = start_mongo_tcp_proxy(host_port).await;
    let proxy_client = mongodb::Client::with_uri_str(format!(
        "mongodb://{proxy_addr}/?directConnection=true&serverSelectionTimeoutMS=10000&connectTimeoutMS=10000",
    )).await.unwrap();
    let db_name = format!("test_semantic_auth_{}", uuid::Uuid::new_v4().simple());
    let db = proxy_client.database(&db_name);
    tokio::time::timeout(
        Duration::from_secs(10),
        db.run_command(mongodb::bson::doc! { "ping": 1 }),
    )
    .await
    .expect("Mandatory real MongoDB is unavailable")
    .unwrap();
    let store = dam_hopper_server::auth::AuthStore::from_mongo(db.clone());
    tokio::time::timeout(Duration::from_secs(10), store.init_indexes())
        .await
        .expect("Mandatory Mongo index setup timed out")
        .unwrap();
    // Reuse the fixture's existing workspace/state constructor, then replace
    // both store handles with this explicit proxy-backed real Mongo store.
    // No process-global URI mutation or collateral fixture routing.
    let mut fixture = common::auth_fixtures::AuthTestFixture::new_sqlite().await;
    fixture.state = fixture.state.clone().with_auth_service(Arc::new(
        dam_hopper_server::auth::AuthService::new(
            Some(store.clone()),
            Some(dam_hopper_server::auth::secret::MfaEncryptionKey::new(
                fixture.raw_mfa_key,
                "test-mfa-fixture-key",
            )),
            fixture.clock.clone(),
        ),
    ));
    fixture.app = dam_hopper_server::api::build_router(fixture.state.clone());
    fixture.store = store;
    fixture.db = Some(db);
    fixture.db_name = Some(db_name);
    fixture.sqlite_path = None;
    let project_dir = fixture.tmp_dir.path().join("mongo-auth-project");
    std::fs::create_dir_all(&project_dir).unwrap();
    std::fs::write(
        project_dir.join("overlay.ts"),
        "export const saved = true;\n",
    )
    .unwrap();

    {
        let mut cfg = fixture.state.config.write().await;
        cfg.projects.push(ProjectConfig {
            name: "mongo-auth-project".into(),
            path: project_dir.to_string_lossy().to_string(),
            project_type: ProjectType::Custom,
            services: None,
            commands: None,
            env_file: None,
            tags: None,
            terminals: vec![],
            agents: None,
            restart_policy: Default::default(),
            restart_max_retries: 5,
            health_check_url: None,
        });
    }

    let toolchain = common::semantic_fixtures::TestToolchain::new();
    let profile = toolchain.tool_profile();
    let state = fixture.state.clone().with_semantic_supervisor(Arc::new(
        dam_hopper_server::semantic::supervisor::SemanticSupervisor::new(Some(profile)),
    ));
    state.semantic_supervisor.set_enabled(true).await;

    let mut fixture = fixture;
    fixture.state = state.clone();
    let addr = start_server_with_origin(state).await;

    for (trigger, expected_code) in [
        (
            InvalidationTrigger::DisableAccount,
            CLOSE_FULL_LOGIN_REQUIRED,
        ),
        (
            InvalidationTrigger::RevokeSession,
            CLOSE_FULL_LOGIN_REQUIRED,
        ),
        (
            InvalidationTrigger::BumpUserAuthVersion,
            CLOSE_FULL_LOGIN_REQUIRED,
        ),
        (
            InvalidationTrigger::BumpSessionCredentialVersion,
            CLOSE_FULL_LOGIN_REQUIRED,
        ),
        (
            InvalidationTrigger::DeleteSession,
            CLOSE_FULL_LOGIN_REQUIRED,
        ),
        (
            InvalidationTrigger::DeleteAccount,
            CLOSE_FULL_LOGIN_REQUIRED,
        ),
        (InvalidationTrigger::MfaDeadlineDue, CLOSE_MFA_REQUIRED),
        (
            InvalidationTrigger::SessionExpired,
            CLOSE_FULL_LOGIN_REQUIRED,
        ),
        (
            InvalidationTrigger::BackendQueryFailure,
            CLOSE_AUTH_UNAVAILABLE,
        ),
        (
            InvalidationTrigger::BackendStoreTimeout,
            CLOSE_AUTH_UNAVAILABLE,
        ),
    ] {
        run_nonreading_cutoff_case(
            &fixture,
            addr,
            "mongo-auth-project",
            trigger,
            expected_code,
            Some(&proxy_stalled),
        )
        .await;
    }

    fixture.cleanup().await;
}
