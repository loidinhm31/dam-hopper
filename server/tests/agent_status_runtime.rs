use std::net::SocketAddr;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{HeaderValue, Request, StatusCode};
use tokio_tungstenite::tungstenite::Message;

use dam_hopper_server::agent_status::{
    AgentKind, AgentState, AgentStatusAvailability, AgentStatusBroadcastEvent,
    AgentStatusCollector, AgentStatusRuntime, ReporterEventKind, ReporterHello,
    ReporterReport, TurnOutcome, AGENT_STATUS_PROTOCOL_VERSION, MAX_PRIVATE_FRAME_BYTES,
};

fn sample_hello(reporter_id: &str, session_id: &str) -> ReporterHello {
    ReporterHello {
        version: AGENT_STATUS_PROTOCOL_VERSION,
        agent_kind: AgentKind::Omp,
        reporter_id: reporter_id.to_string(),
        agent_session_id: session_id.to_string(),
        adapter_version: "18.3.5".to_string(),
    }
}

fn sample_report(
    seq: u64,
    event: ReporterEventKind,
    state: AgentState,
    session_id: &str,
    turn_id: Option<&str>,
    outcome: Option<TurnOutcome>,
) -> ReporterReport {
    ReporterReport {
        kind: "report".to_string(),
        seq,
        event,
        state,
        agent_session_id: session_id.to_string(),
        turn_id: turn_id.map(str::to_string),
        outcome,
        blocked_reason: None,
    }
}

fn build_ws_request(url: &str, token: Option<&str>, origin: Option<&str>) -> Request<()> {
    let mut req = url.into_client_request().unwrap();
    if let Some(tok) = token {
        req.headers_mut().insert(
            "Authorization",
            HeaderValue::from_str(&format!("Bearer {tok}")).unwrap(),
        );
    }
    if let Some(orig) = origin {
        req.headers_mut().insert(
            "Origin",
            HeaderValue::from_str(orig).unwrap(),
        );
    }
    req
}

#[tokio::test]
async fn test_collector_handshake_authentication_and_security() {
    let runtime = AgentStatusRuntime::new(AgentStatusAvailability::Ready, None);
    let collector = AgentStatusCollector::bind(
        runtime.clone(),
        SocketAddr::from(([127, 0, 0, 1], 0)),
    )
    .await
    .expect("bind collector");

    let ws_url = collector.ws_url().to_string();

    // 1. Missing Authorization header => 401
    let req_no_auth = build_ws_request(&ws_url, None, None);
    let err = connect_async(req_no_auth).await.unwrap_err();
    match err {
        tokio_tungstenite::tungstenite::Error::Http(resp) => {
            assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        }
        _ => panic!("expected HTTP 401 error, got {err:?}"),
    }

    // 2. Invalid Bearer token => 401
    let req_invalid_token = build_ws_request(&ws_url, Some("invalid-token-12345"), None);
    let err = connect_async(req_invalid_token).await.unwrap_err();
    match err {
        tokio_tungstenite::tungstenite::Error::Http(resp) => {
            assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        }
        _ => panic!("expected HTTP 401 error, got {err:?}"),
    }

    // 3. Browser Origin header present => 403 Forbidden
    let req_origin = build_ws_request(&ws_url, Some("any-token"), Some("http://localhost:3000"));
    let err = connect_async(req_origin).await.unwrap_err();
    match err {
        tokio_tungstenite::tungstenite::Error::Http(resp) => {
            assert_eq!(resp.status(), StatusCode::FORBIDDEN);
        }
        _ => panic!("expected HTTP 403 error, got {err:?}"),
    }

    // 4. Query parameters present => 400 Bad Request
    let req_query = build_ws_request(&format!("{ws_url}?token=secret"), Some("any-token"), None);
    let err = connect_async(req_query).await.unwrap_err();
    match err {
        tokio_tungstenite::tungstenite::Error::Http(resp) => {
            assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        }
        _ => panic!("expected HTTP 400 error, got {err:?}"),
    }

    // 5. Pending reservation (not yet committed/activated) => 503 Service Unavailable (retryable)
    let reservation = runtime.reserve_credential("term-1", 1).expect("reserve");
    let token = reservation.token().to_string();

    let req_pending = build_ws_request(&ws_url, Some(&token), None);
    let err = connect_async(req_pending).await.unwrap_err();
    match err {
        tokio_tungstenite::tungstenite::Error::Http(resp) => {
            assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
        }
        _ => panic!("expected HTTP 503 error, got {err:?}"),
    }

    // 6. Activate reservation => connects successfully
    reservation.activate();

    let req_active = build_ws_request(&ws_url, Some(&token), None);
    let (mut ws_stream, resp) = connect_async(req_active).await.expect("connect active");
    assert_eq!(resp.status(), StatusCode::SWITCHING_PROTOCOLS);

    // Send hello to complete admission
    let hello = sample_hello("rep-1", "sess-1");
    ws_stream
        .send(Message::Text(serde_json::to_string(&hello).unwrap().into()))
        .await
        .expect("send hello");

    let ack_msg = ws_stream.next().await.unwrap().unwrap();
    match ack_msg {
        Message::Text(text) => {
            assert!(text.contains("\"kind\":\"accepted\""));
            assert!(text.contains("\"heartbeatMs\":5000"));
        }
        _ => panic!("expected text accepted message"),
    }

    collector.shutdown();
}

#[tokio::test]
async fn test_collector_turn_lifecycle_and_clean_disconnect() {
    let runtime = AgentStatusRuntime::new(AgentStatusAvailability::Ready, None);
    let collector = AgentStatusCollector::bind(
        runtime.clone(),
        SocketAddr::from(([127, 0, 0, 1], 0)),
    )
    .await
    .expect("bind collector");

    let ws_url = collector.ws_url().to_string();

    let reservation = runtime.reserve_credential("term-1", 1).unwrap();
    let token = reservation.token().to_string();
    reservation.activate();

    let req = build_ws_request(&ws_url, Some(&token), None);
    let (mut ws_stream, _) = connect_async(req).await.unwrap();

    // 1. Send Hello
    let hello = sample_hello("rep-1", "sess-1");
    ws_stream
        .send(Message::Text(serde_json::to_string(&hello).unwrap().into()))
        .await
        .unwrap();

    let accepted = ws_stream.next().await.unwrap().unwrap();
    assert!(accepted.to_text().unwrap().contains("\"kind\":\"accepted\""));

    // Verify snapshot shows unknown baseline
    let snap = runtime.snapshot();
    assert_eq!(snap.terminals.len(), 1);
    assert_eq!(snap.terminals[0].state, AgentState::Unknown);

    // 2. Send TurnStarted report
    let start_rep = sample_report(
        1,
        ReporterEventKind::TurnStarted,
        AgentState::Working,
        "sess-1",
        Some("turn-1"),
        None,
    );
    ws_stream
        .send(Message::Text(serde_json::to_string(&start_rep).unwrap().into()))
        .await
        .unwrap();

    let ack1 = ws_stream.next().await.unwrap().unwrap();
    assert_eq!(ack1.to_text().unwrap(), "{\"kind\":\"ack\",\"seq\":1}");

    // Verify snapshot shows working
    assert_eq!(runtime.snapshot().terminals[0].state, AgentState::Working);

    // 3. Send TurnEnded report
    let end_rep = sample_report(
        2,
        ReporterEventKind::TurnEnded,
        AgentState::Idle,
        "sess-1",
        Some("turn-1"),
        Some(TurnOutcome::Ended),
    );
    ws_stream
        .send(Message::Text(serde_json::to_string(&end_rep).unwrap().into()))
        .await
        .unwrap();

    let ack2 = ws_stream.next().await.unwrap().unwrap();
    assert_eq!(ack2.to_text().unwrap(), "{\"kind\":\"ack\",\"seq\":2}");
    assert_eq!(runtime.snapshot().terminals[0].state, AgentState::Idle);

    // 4. Disconnect socket -> immediately marks unknown (C06)
    drop(ws_stream);
    tokio::time::sleep(Duration::from_millis(50)).await;

    assert_eq!(runtime.snapshot().terminals[0].state, AgentState::Unknown);

    collector.shutdown();
}

#[tokio::test]
async fn test_collector_reconnect_replaces_old_socket_and_rejects_occupied() {
    let runtime = AgentStatusRuntime::new(AgentStatusAvailability::Ready, None);
    let collector = AgentStatusCollector::bind(
        runtime.clone(),
        SocketAddr::from(([127, 0, 0, 1], 0)),
    )
    .await
    .expect("bind collector");

    let ws_url = collector.ws_url().to_string();

    let reservation = runtime.reserve_credential("term-1", 1).unwrap();
    let token = reservation.token().to_string();
    reservation.activate();

    let make_conn = || {
        let url = ws_url.clone();
        let tok = token.clone();
        async move {
            let req = build_ws_request(&url, Some(&tok), None);
            connect_async(req).await.unwrap().0
        }
    };

    // Client 1 connects with rep-1
    let mut ws1 = make_conn().await;
    let hello1 = sample_hello("rep-1", "sess-1");
    ws1.send(Message::Text(serde_json::to_string(&hello1).unwrap().into()))
        .await
        .unwrap();
    let acc1 = ws1.next().await.unwrap().unwrap();
    assert!(acc1.to_text().unwrap().contains("\"reporterEpoch\":1"));

    // Client 2 attempts to connect with different reporter "rep-2" => rejected occupied
    let mut ws2 = make_conn().await;
    let hello2 = sample_hello("rep-2", "sess-1");
    ws2.send(Message::Text(serde_json::to_string(&hello2).unwrap().into()))
        .await
        .unwrap();
    let rej = ws2.next().await.unwrap().unwrap();
    assert!(rej.to_text().unwrap().contains("\"kind\":\"rejected\""));
    assert!(rej.to_text().unwrap().contains("occupied"));

    // Client 1 is still connected and operational!
    let rep1 = sample_report(
        1,
        ReporterEventKind::Heartbeat,
        AgentState::Unknown,
        "sess-1",
        None,
        None,
    );
    ws1.send(Message::Text(serde_json::to_string(&rep1).unwrap().into()))
        .await
        .unwrap();
    let ack = ws1.next().await.unwrap().unwrap();
    assert_eq!(ack.to_text().unwrap(), "{\"kind\":\"ack\",\"seq\":1}");

    // Client 3 connects with SAME reporter "rep-1" => supersedes client 1
    let mut ws3 = make_conn().await;
    ws3.send(Message::Text(serde_json::to_string(&hello1).unwrap().into()))
        .await
        .unwrap();
    let acc3 = ws3.next().await.unwrap().unwrap();
    assert!(acc3.to_text().unwrap().contains("\"reporterEpoch\":2"));

    // Client 1 should now receive a Close message
    let old_close = ws1.next().await;
    assert!(
        matches!(old_close, Some(Ok(Message::Close(_))) | None),
        "old connection received close"
    );

    collector.shutdown();
}

#[tokio::test]
async fn test_collector_frame_limit_and_rate_limiting() {
    let runtime = AgentStatusRuntime::new(AgentStatusAvailability::Ready, None);
    let collector = AgentStatusCollector::bind(
        runtime.clone(),
        SocketAddr::from(([127, 0, 0, 1], 0)),
    )
    .await
    .expect("bind collector");

    let ws_url = collector.ws_url().to_string();

    let reservation = runtime.reserve_credential("term-1", 1).unwrap();
    let token = reservation.token().to_string();
    reservation.activate();

    let req = build_ws_request(&ws_url, Some(&token), None);
    let (mut ws, _) = connect_async(req).await.unwrap();

    let hello = sample_hello("rep-1", "sess-1");
    ws.send(Message::Text(serde_json::to_string(&hello).unwrap().into()))
        .await
        .unwrap();
    let _ = ws.next().await.unwrap().unwrap(); // accepted
    // Send oversized frame (> 4096 bytes)
    // The transport protocol layer drops/resets connection when max_frame_size is exceeded
    let oversized_str = "x".repeat(MAX_PRIVATE_FRAME_BYTES + 100);
    let _ = ws.send(Message::Text(oversized_str.into())).await;
    let resp = ws.next().await;
    assert!(
        resp.is_none() || resp.unwrap().is_err(),
        "oversized frame caused socket reset/close"
    );

    // Now test rate limiting on a fresh connection
    let mut ws2 = {
        let req = build_ws_request(&ws_url, Some(&token), None);
        connect_async(req).await.unwrap().0
    };
    ws2.send(Message::Text(serde_json::to_string(&hello).unwrap().into()))
        .await
        .unwrap();
    let _ = ws2.next().await.unwrap().unwrap(); // accepted

    // Burst 45 reports rapidly (burst limit is 40)
    let mut rate_limited = false;
    for seq in 1..=45 {
        let rep = sample_report(
            seq,
            ReporterEventKind::Heartbeat,
            AgentState::Unknown,
            "sess-1",
            None,
            None,
        );
        if ws2.send(Message::Text(serde_json::to_string(&rep).unwrap().into())).await.is_err() {
            break;
        }
        if let Some(Ok(Message::Text(text))) = ws2.next().await {
            if text.contains("rate limit exceeded") {
                rate_limited = true;
                break;
            }
        }
    }
    assert!(rate_limited, "expected rate limit exceeded message on burst");
    collector.shutdown();
}

#[tokio::test]
async fn test_browser_websocket_agent_status_push_events() {
    let runtime = AgentStatusRuntime::with_epoch(7777, AgentStatusAvailability::Ready, None);
    let mut broadcast_rx = runtime.subscribe();

    // Verify broadcast event sending and receiving
    let row = dam_hopper_server::agent_status::TerminalAgentStatusRow {
        id: "term-1".to_string(),
        incarnation: 1,
        agent_kind: AgentKind::Omp,
        agent_session_id: "sess-1".to_string(),
        reporter_epoch: 1,
        state: AgentState::Working,
        source: dam_hopper_server::agent_status::AgentObservationSource::Lifecycle,
        observed_at_ms: Some(1000),
        expires_at_ms: None,
        reason: None,
        turn_id: Some("turn-1".to_string()),
        attention_revision: 0,
        last_outcome: None,
    };
    let changed_payload = dam_hopper_server::agent_status::AgentStatusChangedPayload {
        server_epoch: 7777,
        revision: 1,
        row: row.clone(),
        attention: None,
    };
    runtime.broadcast_event(AgentStatusBroadcastEvent::Changed(changed_payload.clone()));

    let ev = broadcast_rx.recv().await.unwrap();
    match &ev {
        AgentStatusBroadcastEvent::Changed(p) => {
            assert_eq!(p.server_epoch, 7777);
            assert_eq!(p.row.state, AgentState::Working);
        }
        _ => panic!("expected changed event"),
    }

    // Verify wire JSON format has exact kind tag "terminal:agentStatusChanged"
    let json = serde_json::to_string(&ev).unwrap();
    assert!(json.contains("\"kind\":\"terminal:agentStatusChanged\""));
    assert!(json.contains("\"serverEpoch\":7777"));
    assert!(json.contains("\"state\":\"working\""));

    // Verify removed event wire format
    let removed_ev = AgentStatusBroadcastEvent::Removed(
        dam_hopper_server::agent_status::AgentStatusRemovedPayload {
            server_epoch: 7777,
            revision: 2,
            terminal_id: "term-1".to_string(),
            incarnation: 1,
        },
    );
    let json_removed = serde_json::to_string(&removed_ev).unwrap();
    assert!(json_removed.contains("\"kind\":\"terminal:agentStatusRemoved\""));
    assert!(json_removed.contains("\"terminalId\":\"term-1\""));

    // Verify invalidated event wire format
    let invalidated_ev = AgentStatusBroadcastEvent::Invalidated(
        dam_hopper_server::agent_status::AgentStatusInvalidatedPayload {
            server_epoch: 7777,
            revision: 3,
        },
    );
    let json_invalidated = serde_json::to_string(&invalidated_ev).unwrap();
    assert!(json_invalidated.contains("\"kind\":\"terminal:agentStatusInvalidated\""));
}

#[tokio::test]
async fn test_collector_lease_expiration_transitions_to_unknown() {
    let runtime = AgentStatusRuntime::new(AgentStatusAvailability::Ready, None);
    let collector = AgentStatusCollector::bind(
        runtime.clone(),
        SocketAddr::from(([127, 0, 0, 1], 0)),
    )
    .await
    .expect("bind collector");

    let ws_url = collector.ws_url().to_string();

    let reservation = runtime.reserve_credential("term-lease", 1).unwrap();
    let token = reservation.token().to_string();
    reservation.activate();

    let req = build_ws_request(&ws_url, Some(&token), None);
    let (mut ws_stream, _) = connect_async(req).await.unwrap();

    let hello = sample_hello("rep-lease", "sess-1");
    ws_stream
        .send(Message::Text(serde_json::to_string(&hello).unwrap().into()))
        .await
        .unwrap();
    let _ = ws_stream.next().await.unwrap().unwrap(); // accepted

    // Send TurnStarted report
    let start_rep = sample_report(
        1,
        ReporterEventKind::TurnStarted,
        AgentState::Working,
        "sess-1",
        Some("turn-1"),
        None,
    );
    ws_stream
        .send(Message::Text(serde_json::to_string(&start_rep).unwrap().into()))
        .await
        .unwrap();
    let _ = ws_stream.next().await.unwrap().unwrap(); // ack 1

    assert_eq!(runtime.snapshot().terminals[0].state, AgentState::Working);

    // Subscribe to broadcast events
    let mut rx = runtime.subscribe();

    // Trigger lease expiration check:
    // Simulate now_ms being 20_000ms after last report time (lease is 15_000ms)
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
        + 20_000;
    let expired_count = runtime.check_leases_with_time(now_ms, 15_000).unwrap();
    assert_eq!(expired_count, 1);

    // Verify snapshot immediately marks terminal as Unknown
    let snap = runtime.snapshot();
    assert_eq!(snap.terminals[0].state, AgentState::Unknown);

    // Verify broadcast event was sent
    let ev = rx.recv().await.unwrap();
    match ev {
        AgentStatusBroadcastEvent::Changed(p) => {
            assert_eq!(p.row.id, "term-lease");
            assert_eq!(p.row.state, AgentState::Unknown);
            // Lease expiration NEVER emits attention or completion alert
            assert!(p.attention.is_none());
        }
        _ => panic!("expected changed event"),
    }

    // Verify reporter connection received close signal from server
    let close_msg = ws_stream.next().await;
    assert!(
        matches!(close_msg, Some(Ok(Message::Close(_))) | None),
        "expired reporter connection received close"
    );

    collector.shutdown();
}

#[tokio::test]
async fn test_omp_extension_api_lifecycle() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let agent_dir = tmp.path().canonicalize().expect("canonicalize");
    let agent_dir_str = agent_dir.to_str().unwrap();

    let query = dam_hopper_server::api::agent_status::ExtensionQuery {
        agent_dir: Some(agent_dir_str.to_string()),
    };

    // 1. Initial status is absent
    let status_rep = dam_hopper_server::api::agent_status::get_omp_extension_status(
        axum::extract::Query(query),
    )
    .await
    .expect("get status")
    .0;
    assert_eq!(status_rep.status, dam_hopper_server::agent_status::ManagedExtensionStatus::Absent);

    // 2. Install extension via API handler
    let install_body = dam_hopper_server::api::agent_status::ExtensionInstallBody {
        agent_dir: Some(agent_dir_str.to_string()),
    };
    let installed_rep = dam_hopper_server::api::agent_status::install_omp_extension(
        axum::Json(install_body),
    )
    .await
    .expect("install")
    .0;
    assert_eq!(installed_rep.status, dam_hopper_server::agent_status::ManagedExtensionStatus::Current);
    assert_eq!(installed_rep.version.as_deref(), Some("1.0.0"));

    // 3. Uninstall extension via API handler
    let query_del = dam_hopper_server::api::agent_status::ExtensionQuery {
        agent_dir: Some(agent_dir_str.to_string()),
    };
    let uninstalled_rep = dam_hopper_server::api::agent_status::uninstall_omp_extension(
        axum::extract::Query(query_del),
    )
    .await
    .expect("uninstall")
    .0;
    assert_eq!(uninstalled_rep.status, dam_hopper_server::agent_status::ManagedExtensionStatus::Absent);
}

#[tokio::test]
async fn test_agent_paths_verification_api() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let agent_dir = tmp.path().join("omp-agent");
    let codex_dir = tmp.path().join("codex");
    std::fs::create_dir_all(&agent_dir).expect("create agent_dir");
    std::fs::create_dir_all(&codex_dir).expect("create codex_dir");

    let agent_dir_str = agent_dir.to_str().unwrap().to_string();
    let codex_dir_str = codex_dir.to_str().unwrap().to_string();

    // 1. Initial verification with explicit paths (extension absent, codex config absent)
    let query = dam_hopper_server::api::agent_status::PathsVerificationQuery {
        agent_dir: Some(agent_dir_str.clone()),
        codex_dir: Some(codex_dir_str.clone()),
        claude_dir: None,
    };
    let res = dam_hopper_server::api::agent_status::get_agent_paths_verification(
        axum::extract::Query(query),
    )
    .await
    .expect("verify paths")
    .0;

    assert_eq!(res.omp_install_dir, agent_dir_str);
    assert_eq!(res.codex_config_dir, codex_dir_str);
    // Extension is absent -> cannot enable
    assert!(!res.omp_can_enable);
    assert!(res.omp_reason.is_some());
    // Codex config is absent -> cannot enable
    assert!(!res.codex_config_exists);
    assert!(!res.codex_can_enable);
    assert!(res.codex_reason.is_some());

    // 2. Install extension into agent_dir
    let install_body = dam_hopper_server::api::agent_status::ExtensionInstallBody {
        agent_dir: Some(agent_dir_str.clone()),
    };
    let installed = dam_hopper_server::api::agent_status::install_omp_extension(
        axum::Json(install_body),
    )
    .await
    .expect("install extension")
    .0;
    assert_eq!(installed.status, dam_hopper_server::agent_status::ManagedExtensionStatus::Current);

    // 3. Create codex config.toml
    std::fs::write(codex_dir.join("config.toml"), "[tui]\n").expect("write codex config");

    // 4. Verify again with paths matching runtime paths (simulate runtime env vars)
    // Temporarily set env vars so runtime notification paths match our temp paths
    unsafe {
        std::env::set_var("PI_CODING_AGENT_DIR", &agent_dir_str);
        std::env::set_var("CODEX_HOME", &codex_dir_str);
    }

    let query2 = dam_hopper_server::api::agent_status::PathsVerificationQuery {
        agent_dir: Some(agent_dir_str.clone()),
        codex_dir: Some(codex_dir_str.clone()),
        claude_dir: None,
    };
    let res2 = dam_hopper_server::api::agent_status::get_agent_paths_verification(
        axum::extract::Query(query2),
    )
    .await
    .expect("verify paths with matching runtime")
    .0;

    assert_eq!(res2.omp_status, dam_hopper_server::agent_status::ManagedExtensionStatus::Current);
    assert!(res2.omp_can_enable);
    assert!(res2.omp_reason.is_none());
    assert!(res2.codex_config_exists);
    assert!(res2.codex_can_enable);
    assert!(res2.codex_reason.is_none());

    // 5. Test path mismatch: point agent_dir to another directory
    let other_dir = tmp.path().join("other-agent");
    std::fs::create_dir_all(&other_dir).expect("create other_dir");
    let query3 = dam_hopper_server::api::agent_status::PathsVerificationQuery {
        agent_dir: Some(other_dir.to_str().unwrap().to_string()),
        codex_dir: Some(codex_dir_str.clone()),
        claude_dir: None,
    };
    let res3 = dam_hopper_server::api::agent_status::get_agent_paths_verification(
        axum::extract::Query(query3),
    )
    .await
    .expect("verify mismatched paths")
    .0;

    assert!(!res3.omp_can_enable);
    assert!(res3.omp_reason.as_ref().unwrap().contains("does not match notification runtime path"));

    unsafe {
        std::env::remove_var("PI_CODING_AGENT_DIR");
        std::env::remove_var("CODEX_HOME");
    }
}
