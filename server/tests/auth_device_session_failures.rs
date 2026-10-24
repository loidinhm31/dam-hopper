//! Real SQLite failures after successful authentication must not become acknowledgements.
use axum::{body::Body, http::{header, Request, StatusCode}};
use chrono::Duration;
use dam_hopper_server::auth::Clock;
use tower::ServiceExt;

mod common;
use common::auth_fixtures::AuthTestFixture;

#[tokio::test]
async fn authenticated_inventory_and_mutation_storage_failures_are_non_cacheable() {
    let fixture = AuthTestFixture::new_sqlite().await;
    fixture.create_enrolled_user("alice", "password", &[0x55; 20]).await;
    let now = fixture.clock.now();
    let (caller, token) = fixture.create_session("alice", 1, now, now + Duration::days(30), now).await;
    let (other, other_token) = fixture.create_session("alice", 1, now, now + Duration::days(30), now).await;

    // The caller still decodes correctly. Only inventory encounters this corrupt
    // unrelated row; this tests handler failure rather than auth middleware failure.
    fixture.sqlite_conn().execute(
        "UPDATE auth_sessions SET user_agent = char(10) WHERE id = ?1", [&other.id],
    ).unwrap();
    let response = fixture.app.clone().oneshot(Request::builder()
        .uri("/api/auth/sessions")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    fixture.sqlite_conn().execute(
        "UPDATE auth_sessions SET user_agent = NULL WHERE id = ?1", [&other.id],
    ).unwrap();

    // A genuine database write rejection occurs only after authentication's reads.
    fixture.sqlite_conn().execute_batch(
        "CREATE TRIGGER reject_device_revoke BEFORE UPDATE OF revoked_at_ms ON auth_sessions
         BEGIN SELECT RAISE(ABORT, 'database write rejected'); END;",
    ).unwrap();
    let response = fixture.app.clone().oneshot(Request::builder().method("DELETE")
        .uri(format!("/api/auth/sessions/{}", caller.id))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    assert!(response.headers().get(header::SET_COOKIE).is_none());
    assert!(fixture.store.get_session(&caller.id).await.unwrap().unwrap().revoked_at.is_none());
    assert!(fixture.store.get_session(&other.id).await.unwrap().unwrap().revoked_at.is_none());
    for credential in [&token, &other_token] {
        let response = fixture.app.clone().oneshot(Request::builder()
            .uri("/api/auth/sessions")
            .header(header::AUTHORIZATION, format!("Bearer {credential}"))
            .body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
}
