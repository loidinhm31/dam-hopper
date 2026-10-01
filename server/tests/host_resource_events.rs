//! Integration tests for bounded authenticated host-resource SSE delivery (Phase 02).

use std::sync::Arc;

use axum::{
    body::Body,
    http::{header, HeaderValue, Method, Request, StatusCode},
};
use futures_util::StreamExt;
use parking_lot::Mutex;
use serde_json::Value;
use tempfile::tempdir;
use tower::ServiceExt;

use dam_hopper_server::{
    agent_store::AgentStoreService,
    api::router::{build_router, build_router_with_origins},
    auth::AuthService,
    config::{DamHopperConfig, FeaturesConfig, GlobalConfig, ServerConfig, WorkspaceInfo},
    crypto::DamHopperOpaqueSuite,
    diagnostics::DiagnosticStore,
    fs::FsSubsystem,
    pty::{BroadcastEventSink, PtySessionManager},
    state::AppState,
};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;

mod common;

static ENV_LOCK: Mutex<()> = Mutex::new(());

const TEST_JWT_SECRET: &str = "test-jwt-secret-key-32-bytes-long!";

fn create_test_state(no_auth: bool, allowed_origins: Vec<String>) -> (AppState, tempfile::TempDir) {
    let tmp = tempdir().expect("tempdir");
    let workspace_root = tmp.path().to_path_buf();
    let (event_sink, _rx) = BroadcastEventSink::new(512);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test-workspace".into(),
            root: workspace_root.display().to_string(),
        },
        agent_store: None,
        server: ServerConfig::default(),
        projects: vec![],
        features: FeaturesConfig::default(),
        config_path: workspace_root.join("dam-hopper.toml"),
    };

    let global_config = GlobalConfig::default();
    let store_path = workspace_root.join(".dam-hopper/agent-store");
    let agent_store = AgentStoreService::new(store_path);
    let fs = FsSubsystem::new(vec![]);

    let _guard = ENV_LOCK.lock();
    let old_rust_env = std::env::var("RUST_ENV").ok();
    let old_environment = std::env::var("ENVIRONMENT").ok();
    std::env::remove_var("RUST_ENV");
    std::env::remove_var("ENVIRONMENT");

    let tunnel_manager = common::make_tunnel_manager(&event_sink);
    let diagnostics = DiagnosticStore::new(workspace_root.join("diagnostics.jsonl"));
    let mut state = AppState::new(
        workspace_root,
        config,
        global_config,
        pty_manager,
        agent_store,
        event_sink,
        TEST_JWT_SECRET.to_string(),
        fs,
        None,
        no_auth,
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )
    .expect("create test AppState");

    state.cors_origins = Arc::new(allowed_origins);

    if let Some(val) = old_rust_env {
        std::env::set_var("RUST_ENV", val);
    }
    if let Some(val) = old_environment {
        std::env::set_var("ENVIRONMENT", val);
    }

    (state, tmp)
}


// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_no_auth_get_stream_success() {
    let (state, _tmp) = create_test_state(true, vec![]);
    state.host_resource_events.start();

    let router = build_router(state.clone());
    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/system/resources/v1/events")
        .body(Body::empty())
        .unwrap();

    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    assert_eq!(
        resp.headers().get(header::CONTENT_TYPE).unwrap(),
        "text/event-stream; charset=utf-8"
    );
    assert_eq!(
        resp.headers().get(header::CACHE_CONTROL).unwrap(),
        "private, no-store, no-transform"
    );
    assert_eq!(
        resp.headers().get("x-accel-buffering").unwrap(),
        "no"
    );
    assert!(resp.headers().get(header::CONNECTION).is_none());

    let mut body_stream = resp.into_body().into_data_stream();
    let first_chunk = body_stream.next().await.expect("first chunk").unwrap();
    let text = String::from_utf8_lossy(&first_chunk);
    assert!(
        text.contains("event: host-resources-status\n"),
        "expected initial status event, got: {text}"
    );

    let second_chunk = body_stream.next().await.expect("second chunk").unwrap();
    let text2 = String::from_utf8_lossy(&second_chunk);
    assert!(
        text2.contains("event: host-resources\n"),
        "expected data event, got: {text2}"
    );
}

#[tokio::test]
async fn test_origin_admission_allowed_and_denied() {
    let allowed = "http://localhost:4801";
    let (state, _tmp) = create_test_state(true, vec![allowed.to_string()]);
    state.host_resource_events.start();

    let origins = vec![HeaderValue::from_str(allowed).unwrap()];
    let router = build_router_with_origins(state.clone(), origins);

    // Disallowed origin -> 403 Forbidden
    let bad_req = Request::builder()
        .method(Method::GET)
        .uri("/api/system/resources/v1/events")
        .header(header::ORIGIN, "https://evil.com")
        .body(Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(bad_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["code"], "ORIGIN_NOT_ALLOWED");

    // Malformed origin (userinfo) -> 403 Forbidden
    let malformed_req = Request::builder()
        .method(Method::GET)
        .uri("/api/system/resources/v1/events")
        .header(header::ORIGIN, "http://user:pass@evil.com")
        .body(Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(malformed_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // Allowed origin -> 200 OK
    let good_req = Request::builder()
        .method(Method::GET)
        .uri("/api/system/resources/v1/events")
        .header(header::ORIGIN, allowed)
        .body(Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(good_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Absent origin in dev mode -> 200 OK
    let absent_req = Request::builder()
        .method(Method::GET)
        .uri("/api/system/resources/v1/events")
        .body(Body::empty())
        .unwrap();
    let resp = router.oneshot(absent_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_cors_preflight_configured_vs_empty() {
    let allowed = "http://100.91.26.60:4802";

    // 1. With configured allowed_origins: OPTIONS returns 200 with CORS headers
    {
        let (state, _tmp) = create_test_state(true, vec![allowed.to_string()]);
        state.host_resource_events.start();
        let origins = vec![HeaderValue::from_str(allowed).unwrap()];
        let router = build_router_with_origins(state.clone(), origins);

        let preflight = Request::builder()
            .method(Method::OPTIONS)
            .uri("/api/system/resources/v1/events")
            .header(header::ORIGIN, allowed)
            .header(header::ACCESS_CONTROL_REQUEST_METHOD, "GET")
            .header(
                header::ACCESS_CONTROL_REQUEST_HEADERS,
                "authorization, cache-control, pragma",
            )
            .body(Body::empty())
            .unwrap();

        let resp = router.oneshot(preflight).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN).unwrap(),
            allowed
        );
        let allow_methods = resp
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_METHODS)
            .expect("Access-Control-Allow-Methods present")
            .to_str()
            .unwrap()
            .split(',')
            .map(|m| m.trim().to_ascii_uppercase())
            .collect::<Vec<_>>();
        assert!(allow_methods.contains(&"GET".to_string()));

        let allow_headers = resp
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_HEADERS)
            .expect("Access-Control-Allow-Headers present")
            .to_str()
            .unwrap()
            .split(',')
            .map(|h| h.trim().to_ascii_lowercase())
            .collect::<Vec<_>>();
        assert!(allow_headers.contains(&"authorization".to_string()));
        assert!(allow_headers.contains(&"cache-control".to_string()));
        assert!(allow_headers.contains(&"pragma".to_string()));

        // Ensure no permit was consumed
        assert_eq!(state.host_resource_events.admission().active_global_permits(), 0);
    }

    // 2. With empty allowed_origins: NO CorsLayer is installed, OPTIONS returns 405
    {
        let (state, _tmp) = create_test_state(true, vec![]);
        state.host_resource_events.start();
        let router = build_router_with_origins(state.clone(), vec![]);

        let preflight = Request::builder()
            .method(Method::OPTIONS)
            .uri("/api/system/resources/v1/events")
            .header(header::ORIGIN, allowed)
            .header(header::ACCESS_CONTROL_REQUEST_METHOD, "GET")
            .header(
                header::ACCESS_CONTROL_REQUEST_HEADERS,
                "authorization, cache-control, pragma",
            )
            .body(Body::empty())
            .unwrap();

        let resp = router.oneshot(preflight).await.unwrap();
        assert_eq!(resp.status(), StatusCode::METHOD_NOT_ALLOWED);
        // Ensure no permit was consumed
        assert_eq!(state.host_resource_events.admission().active_global_permits(), 0);
    }
}

#[tokio::test]
async fn test_bearer_only_rejection_of_cookie() {
    let (state, _tmp) = create_test_state(false, vec![]);
    state.host_resource_events.start();
    let router = build_router(state.clone());

    // 1. Cookie credentials -> rejected with 401 AUTH_REQUIRED
    let cookie_req = Request::builder()
        .method(Method::GET)
        .uri("/api/system/resources/v1/events")
        .header(header::COOKIE, "damhopper-auth=some-token")
        .body(Body::empty())
        .unwrap();

    let resp = router.clone().oneshot(cookie_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["code"], "AUTH_REQUIRED");

    // 2. Missing auth -> rejected with 401
    let unauth_req = Request::builder()
        .method(Method::GET)
        .uri("/api/system/resources/v1/events")
        .body(Body::empty())
        .unwrap();

    let resp = router.oneshot(unauth_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_global_33rd_stream_limit_429() {
    let (state, _tmp) = create_test_state(true, vec![]);
    state.host_resource_events.start();

    // Acquire all 32 permits manually
    let mut permits = Vec::new();
    for _ in 0..32 {
        let p = state
            .host_resource_events
            .admission()
            .try_acquire_global()
            .expect("acquire permit");
        permits.push(p);
    }
    assert_eq!(state.host_resource_events.admission().active_global_permits(), 32);

    let router = build_router(state.clone());
    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/system/resources/v1/events")
        .body(Body::empty())
        .unwrap();

    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(resp.headers().get(header::RETRY_AFTER).unwrap(), "30");

    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["code"], "HOST_RESOURCE_STREAM_LIMIT");

    // Release one permit
    permits.pop();
    assert_eq!(state.host_resource_events.admission().active_global_permits(), 31);

    let req2 = Request::builder()
        .method(Method::GET)
        .uri("/api/system/resources/v1/events")
        .body(Body::empty())
        .unwrap();

    let resp2 = router.oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_subject_5th_stream_limit_429() {
    let (state, _tmp) = create_test_state(true, vec![]);
    state.host_resource_events.start();

    // In dev mode, subject is "dev-user". Acquire 4 subject permits
    let mut guards = Vec::new();
    for _ in 0..4 {
        let g = state
            .host_resource_events
            .admission()
            .try_acquire_subject("dev-user")
            .expect("acquire subject slot");
        guards.push(g);
    }
    assert_eq!(state.host_resource_events.admission().active_subject_count("dev-user"), 4);

    let router = build_router(state.clone());
    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/system/resources/v1/events")
        .body(Body::empty())
        .unwrap();

    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(resp.headers().get(header::RETRY_AFTER).unwrap(), "30");

    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["code"], "HOST_RESOURCE_STREAM_LIMIT");

    // Release one guard
    guards.pop();
    assert_eq!(state.host_resource_events.admission().active_subject_count("dev-user"), 3);

    let req2 = Request::builder()
        .method(Method::GET)
        .uri("/api/system/resources/v1/events")
        .body(Body::empty())
        .unwrap();

    let resp2 = router.oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_shutdown_revocation_returns_503() {
    let (state, _tmp) = create_test_state(true, vec![]);
    state.host_resource_events.start();

    // Revoke emission
    state.host_resource_events.revoke_emission();

    let router = build_router(state.clone());
    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/system/resources/v1/events")
        .body(Body::empty())
        .unwrap();

    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["code"], "AUTH_UNAVAILABLE");
}

#[tokio::test]
async fn test_authenticated_bearer_success() {
    let (state, _tmp) = create_test_state(false, vec![]);
    state.host_resource_events.start();

    let (mock_auth, claims) = AuthService::new_mock_default();
    let token = claims.encode(&state.jwt_secret).expect("encode JWT");
    let state = state.with_auth_service(Arc::new(mock_auth));

    let router = build_router(state.clone());
    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/system/resources/v1/events")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        resp.headers().get(header::CONTENT_TYPE).unwrap(),
        "text/event-stream; charset=utf-8"
    );
}

#[tokio::test]
async fn test_cloned_extension_take_once() {
    let sem = Arc::new(tokio::sync::Semaphore::new(1));
    let permit = sem.clone().try_acquire_owned().unwrap();
    let admission_permit = dam_hopper_server::api::resource_events::AdmissionPermit::new(permit);

    let clone1 = admission_permit.clone();
    let clone2 = admission_permit.clone();

    let taken1 = clone1.take();
    assert!(taken1.is_some(), "first take succeeds");

    let taken2 = clone2.take();
    assert!(taken2.is_none(), "second take returns None");

    let taken3 = admission_permit.take();
    assert!(taken3.is_none(), "third take returns None");
}
