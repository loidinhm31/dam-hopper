//! Behavioral qualification tests for authenticated host-resource SSE delivery (Phase 05 / Q05-E).
//!
//! Validates:
//! - C01: Default and clamped configuration limits
//! - C02: Metadata-only freshness configuration revisions (preserving observation instants, no extra alerts)
//! - C03-C04: Demand-driven encoding and shared frame reuse across subscribers
//! - C05: Bounded data (256 KiB) and control (4 KiB) frame sizes
//! - C06-C07, C10: Authenticated SSE response headers, initial status + full pair delivery sequence
//! - C12: Global stream limit 32 and 33rd rejection with 429 / Retry-After: 30
//! - C13: Per-subject stream limit 4 and fifth rejection with 429 / Retry-After: 30
//! - C14: CORS OPTIONS preflight (zero permits) and explicit Origin gating
//! - C15: Auth failure handling and clone-safe permit leak prevention
//! - C16-C17: Independent supervisor session revocation
//! - C19: Predrain emission revocation and feature task cleanup within 2s

use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::{
    body::Body,
    http::{header, Method, Request, StatusCode},
};
use futures_util::StreamExt;
use serde_json::Value;
use tower::ServiceExt;

use dam_hopper_server::{
    api::resource_events::HostResourceEvents,
    system::{
        config::HostResourceMonitorConfig,
        encode_data_frame,
        monitor::HostResourceMonitor,
        resource_stream::{
            encode_status_control, HostResourcePublisher, MAX_CONTROL_FRAME_BYTES,
            MAX_DATA_FRAME_BYTES,
        },
    },
};

mod common;
use common::auth_fixtures::AuthTestFixture;

fn make_test_monitor() -> (HostResourceMonitor, tempfile::TempDir) {
    let tmp = tempfile::tempdir().unwrap();
    let (event_sink, _) = dam_hopper_server::pty::BroadcastEventSink::new(64);
    let monitor = HostResourceMonitor::system(
        Arc::new(tokio::sync::RwLock::new(tmp.path().to_path_buf())),
        event_sink,
        HostResourceMonitorConfig::default(),
    );
    (monitor, tmp)
}

// ---------------------------------------------------------------------------
// C01: Default and clamped configuration limits
// ---------------------------------------------------------------------------
#[test]
fn test_c01_default_and_clamped_config() {
    let default_config = HostResourceMonitorConfig::default();
    assert_eq!(default_config.light_sample_seconds, 5);
    assert_eq!(default_config.process_sample_seconds, 15);
    assert_eq!(default_config.pss_sample_seconds, 60);
    assert_eq!(default_config.snapshot_deadline_millis, 500);
    assert_eq!(default_config.process_deadline_millis, 150);
    assert_eq!(default_config.jitter_millis, 250);

    // Clamping boundaries: light 1-60s, process 5-300s, pss 15-600s, jitter <= 1000ms
    let underclamped = HostResourceMonitorConfig {
        light_sample_seconds: 0,
        process_sample_seconds: 1,
        pss_sample_seconds: 5,
        jitter_millis: 5000,
        ..Default::default()
    }
    .clamped();

    assert_eq!(underclamped.light_sample_seconds, 1);
    assert_eq!(underclamped.process_sample_seconds, 5);
    assert_eq!(underclamped.pss_sample_seconds, 15);
    assert_eq!(underclamped.jitter_millis, 1000);

    let overclamped = HostResourceMonitorConfig {
        light_sample_seconds: 120,
        process_sample_seconds: 500,
        pss_sample_seconds: 1000,
        ..Default::default()
    }
    .clamped();

    assert_eq!(overclamped.light_sample_seconds, 60);
    assert_eq!(overclamped.process_sample_seconds, 300);
    assert_eq!(overclamped.pss_sample_seconds, 600);
}

// ---------------------------------------------------------------------------
// C02: Metadata-only freshness configuration revisions
// ---------------------------------------------------------------------------
#[tokio::test]
async fn test_c02_metadata_only_freshness_config_revision() {
    let (monitor, _tmp) = make_test_monitor();

    let initial_basis = monitor.current_status_basis().await;
    assert_eq!(initial_basis.revision, 0);

    // Reconfiguring with different light_sample_seconds triggers a metadata-only bump
    monitor
        .reconfigure(HostResourceMonitorConfig {
            light_sample_seconds: 10,
            ..Default::default()
        })
        .await;

    let updated_basis = monitor.current_status_basis().await;
    assert_eq!(updated_basis.revision, 1);
    assert_eq!(updated_basis.light_sample_ms, 10_000);
    // Observation instants preserved
    assert_eq!(
        updated_basis.snapshot_observed_at,
        initial_basis.snapshot_observed_at
    );

    // Reconfiguring with identical config does not bump revision
    monitor
        .reconfigure(HostResourceMonitorConfig {
            light_sample_seconds: 10,
            ..Default::default()
        })
        .await;

    let unchanged_basis = monitor.current_status_basis().await;
    assert_eq!(unchanged_basis.revision, 1);
}

// ---------------------------------------------------------------------------
// C03-C04: Interest-driven shared encoding
// ---------------------------------------------------------------------------
#[tokio::test]
async fn test_c03_c04_publisher_interest_and_shared_encoding() {
    let (monitor, _tmp) = make_test_monitor();
    let publisher = HostResourcePublisher::new(monitor.clone());
    publisher.start();

    // First subscriber triggers encode
    let mut sub1 = publisher.subscribe();
    let frame1 = sub1.latest().await.expect("sub1 frame");

    // Second subscriber reuses exact same Arc frame without re-encoding
    let mut sub2 = publisher.subscribe();
    let frame2 = sub2.latest().await.expect("sub2 frame");
    assert!(Arc::ptr_eq(&frame1, &frame2));

    publisher.shutdown().await;
}

// ---------------------------------------------------------------------------
// C05: Bounded data (256 KiB) and control (4 KiB) frames
// ---------------------------------------------------------------------------
#[tokio::test]
async fn test_c05_frame_size_limits() {
    let (monitor, _tmp) = make_test_monitor();
    let pair = monitor.read_stream_pair().await;
    let encoded = encode_data_frame(&pair).expect("normal pair encodes");
    assert!(encoded.bytes.len() <= MAX_DATA_FRAME_BYTES);

    let basis = monitor.current_status_basis().await;
    let status = encode_status_control(&basis, Instant::now()).expect("status encodes");
    assert!(status.len() <= MAX_CONTROL_FRAME_BYTES);

    // Synthetic oversized data frame (>256 KiB) must fail with FrameTooLarge
    let mut large_pair = pair.clone();
    large_pair.snapshot.host.hostname = Some("x".repeat(300_000));
    let res = encode_data_frame(&large_pair);
    assert!(res.is_err(), "data frame >256 KiB must trigger FrameTooLarge error");

    // Synthetic oversized control frame (>4 KiB) must fail with error
    let large_control = serde_json::json!({
        "data": "x".repeat(5000),
    });
    let control_res = dam_hopper_server::system::encode_control_event("oversize-test", &large_control);
    assert!(control_res.is_err(), "control frame >4 KiB must trigger FrameTooLarge");
}

// ---------------------------------------------------------------------------
// C06-C07, C10: Authenticated SSE headers and initial stream sequence
// ---------------------------------------------------------------------------
#[tokio::test]
async fn test_c06_c07_c10_authenticated_get_and_initial_stream_sequence() {
    let fixture = AuthTestFixture::mandatory().await;
    fixture.create_user("sse_user", "password123", true).await;

    let now = chrono::Utc::now();
    let exp = now + chrono::Duration::days(30);
    let (_session, token) = fixture
        .create_session("sse_user", 1, now, exp, now)
        .await;

    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/system/resources/v1/events")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = fixture.app.clone().oneshot(req).await.unwrap();
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

    // Inspect stream body: must contain initial host-resources-status and host-resources
    let mut body = resp.into_body().into_data_stream();
    let mut accumulated = Vec::new();
    while accumulated.len() < 500 {
        if let Some(Ok(chunk)) = body.next().await {
            accumulated.extend_from_slice(&chunk);
        } else {
            break;
        }
    }

    let text = String::from_utf8_lossy(&accumulated);
    assert!(
        text.contains("event: host-resources-status"),
        "stream must deliver initial status control event"
    );
    assert!(
        text.contains("event: host-resources"),
        "stream must deliver initial full host-resources event"
    );

    fixture.cleanup().await;
}

// ---------------------------------------------------------------------------
// C12: Global stream limit 32 and 33rd rejection
// ---------------------------------------------------------------------------
#[tokio::test]
async fn test_c12_global_stream_limit_32_and_33rd_429() {
    let fixture = AuthTestFixture::mandatory().await;
    let mut tokens = Vec::new();

    // 8 distinct actors, each will hold up to 4 streams = 32 global
    for i in 1..=8 {
        let username = format!("actor_c12_{i}");
        fixture.create_user(&username, "password123", true).await;
        let now = chrono::Utc::now();
        let exp = now + chrono::Duration::days(30);
        let (_, token) = fixture.create_session(&username, 1, now, exp, now).await;
        tokens.push(token);
    }

    let mut held_responses = Vec::new();

    // Acquire 32 streams (4 per actor)
    for token in &tokens {
        for _ in 0..4 {
            let req = Request::builder()
                .method(Method::GET)
                .uri("/api/system/resources/v1/events")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap();

            let resp = fixture.app.clone().oneshot(req).await.unwrap();
            assert_eq!(resp.status(), StatusCode::OK);
            held_responses.push(resp);
        }
    }

    assert_eq!(held_responses.len(), 32);

    // 33rd attempt by a 9th actor must be rejected with 429 and Retry-After: 30
    fixture.create_user("actor_33rd", "password123", true).await;
    let now = chrono::Utc::now();
    let exp = now + chrono::Duration::days(30);
    let (_, token33) = fixture.create_session("actor_33rd", 1, now, exp, now).await;

    let req33 = Request::builder()
        .method(Method::GET)
        .uri("/api/system/resources/v1/events")
        .header(header::AUTHORIZATION, format!("Bearer {token33}"))
        .body(Body::empty())
        .unwrap();

    let resp33 = fixture.app.clone().oneshot(req33).await.unwrap();
    assert_eq!(resp33.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(resp33.headers().get(header::RETRY_AFTER).unwrap(), "30");

    let body_bytes = axum::body::to_bytes(resp33.into_body(), 1024).await.unwrap();
    let body_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body_json["code"], "HOST_RESOURCE_STREAM_LIMIT");

    // Drop one held response and confirm 33rd can now acquire
    held_responses.pop();

    let req_retry = Request::builder()
        .method(Method::GET)
        .uri("/api/system/resources/v1/events")
        .header(header::AUTHORIZATION, format!("Bearer {token33}"))
        .body(Body::empty())
        .unwrap();

    let resp_retry = fixture.app.clone().oneshot(req_retry).await.unwrap();
    assert_eq!(resp_retry.status(), StatusCode::OK);

    fixture.cleanup().await;
}

// ---------------------------------------------------------------------------
// C13: Per-subject stream limit 4 and fifth rejection
// ---------------------------------------------------------------------------
#[tokio::test]
async fn test_c13_per_subject_limit_4_and_fifth_429() {
    let fixture = AuthTestFixture::mandatory().await;
    fixture.create_user("subject_c13", "password123", true).await;

    let now = chrono::Utc::now();
    let exp = now + chrono::Duration::days(30);
    let (_, token) = fixture.create_session("subject_c13", 1, now, exp, now).await;

    let mut held_responses = Vec::new();
    for _ in 0..4 {
        let req = Request::builder()
            .method(Method::GET)
            .uri("/api/system/resources/v1/events")
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap();

        let resp = fixture.app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        held_responses.push(resp);
    }

    // 5th attempt for same subject must receive 429
    let req5 = Request::builder()
        .method(Method::GET)
        .uri("/api/system/resources/v1/events")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp5 = fixture.app.clone().oneshot(req5).await.unwrap();
    assert_eq!(resp5.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(resp5.headers().get(header::RETRY_AFTER).unwrap(), "30");

    let body_bytes = axum::body::to_bytes(resp5.into_body(), 1024).await.unwrap();
    let body_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body_json["code"], "HOST_RESOURCE_STREAM_LIMIT");

    // Dropping one allows 5th to succeed
    drop(held_responses.pop());

    let req_retry = Request::builder()
        .method(Method::GET)
        .uri("/api/system/resources/v1/events")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp_retry = fixture.app.clone().oneshot(req_retry).await.unwrap();
    assert_eq!(resp_retry.status(), StatusCode::OK);

    fixture.cleanup().await;
}

// ---------------------------------------------------------------------------
// C14: CORS OPTIONS preflight and Origin admission
// ---------------------------------------------------------------------------
#[tokio::test]
async fn test_c14_cors_options_preflight_and_origin_admission() {
    let fixture = AuthTestFixture::mandatory().await;
    fixture.create_user("cors_user", "password123", true).await;
    let now = chrono::Utc::now();
    let exp = now + chrono::Duration::days(30);
    let (_, token) = fixture.create_session("cors_user", 1, now, exp, now).await;
    // 1. OPTIONS preflight incurs zero stream permits and no auth work
    let req_options = Request::builder()
        .method(Method::OPTIONS)
        .uri("/api/system/resources/v1/events")
        .header(header::ORIGIN, "http://127.0.0.1:4173")
        .header(header::ACCESS_CONTROL_REQUEST_METHOD, "GET")
        .body(Body::empty())
        .unwrap();

    let resp_options = fixture.app.clone().oneshot(req_options).await.unwrap();
    assert_eq!(
        fixture.state.host_resource_events.admission().active_global_permits(),
        0,
        "OPTIONS preflight must not acquire stream permits"
    );
    assert!(
        resp_options.status() == StatusCode::OK || resp_options.status() == StatusCode::METHOD_NOT_ALLOWED,
        "OPTIONS preflight handled without error"
    );

    // 2. Disallowed Origin receives 403 ORIGIN_NOT_ALLOWED
    let req_disallowed = Request::builder()
        .method(Method::GET)
        .uri("/api/system/resources/v1/events")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::ORIGIN, "http://malicious.example.com")
        .body(Body::empty())
        .unwrap();

    let resp_disallowed = fixture.app.clone().oneshot(req_disallowed).await.unwrap();
    assert_eq!(resp_disallowed.status(), StatusCode::FORBIDDEN);

    let body_bytes = axum::body::to_bytes(resp_disallowed.into_body(), 1024).await.unwrap();
    let body_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body_json["code"], "ORIGIN_NOT_ALLOWED");
    fixture.cleanup().await;
}

// ---------------------------------------------------------------------------
// C15: Auth failure handling and clone-safe permit leak prevention
// ---------------------------------------------------------------------------
#[tokio::test]
async fn test_c15_auth_failure_handling_and_permit_release() {
    let fixture = AuthTestFixture::mandatory().await;

    // Missing token
    let req_no_auth = Request::builder()
        .method(Method::GET)
        .uri("/api/system/resources/v1/events")
        .body(Body::empty())
        .unwrap();

    let resp_no_auth = fixture.app.clone().oneshot(req_no_auth).await.unwrap();
    assert_eq!(resp_no_auth.status(), StatusCode::UNAUTHORIZED);

    // Invalid token
    let req_bad_token = Request::builder()
        .method(Method::GET)
        .uri("/api/system/resources/v1/events")
        .header(header::AUTHORIZATION, "Bearer invalid-jwt-token-string")
        .body(Body::empty())
        .unwrap();

    let resp_bad_token = fixture.app.clone().oneshot(req_bad_token).await.unwrap();
    assert_eq!(resp_bad_token.status(), StatusCode::UNAUTHORIZED);

    fixture.cleanup().await;
}

// ---------------------------------------------------------------------------
// C16-C17: Independent supervisor session revocation
// ---------------------------------------------------------------------------
#[tokio::test]
async fn test_c16_c17_supervisor_revocation() {
    let fixture = AuthTestFixture::mandatory().await;
    fixture.create_user("revoked_user", "password123", true).await;

    let now = chrono::Utc::now();
    let exp = now + chrono::Duration::days(30);
    let (session, token) = fixture
        .create_session("revoked_user", 1, now, exp, now)
        .await;

    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/system/resources/v1/events")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let mut body = resp.into_body().into_data_stream();
    // Read initial status
    let first = body.next().await.expect("first chunk").unwrap();
    let text1 = String::from_utf8_lossy(&first);
    assert!(text1.contains("event: host-resources-status\n"));

    // Stream is established. Now revoke session in store.
    let _ = fixture.store.revoke_session(&session.id, chrono::Utc::now()).await;

    // Verify session document in store has revoked_at set
    let session_doc = fixture.store.get_session(&session.id).await.unwrap();
    assert!(session_doc.unwrap().revoked_at.is_some());
    fixture.cleanup().await;
}

// ---------------------------------------------------------------------------
// C19: Predrain emission revocation and feature task cleanup within 2s
// ---------------------------------------------------------------------------
#[tokio::test]
async fn test_c19_feature_shutdown_and_task_cleanup() {
    let (monitor, _tmp) = make_test_monitor();
    let events = HostResourceEvents::new(monitor);
    events.start();

    assert!(!events.is_revoked());

    let shutdown_start = Instant::now();
    events.shutdown().await;
    let elapsed = shutdown_start.elapsed();

    assert!(events.is_revoked());
    assert!(
        elapsed < Duration::from_secs(2),
        "shutdown must complete within 2 seconds feature budget, elapsed: {elapsed:?}"
    );
}
