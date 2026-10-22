use axum::{body::{to_bytes, Body}, http::{header, Request, StatusCode}, response::Response};
use chrono::Duration;
use dam_hopper_server::auth::{model::{chrono_to_bson, AuthSession}, Clock};
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::auth_fixtures::AuthTestFixture;

async fn request(fixture: &AuthTestFixture, method: &str, uri: &str, token: Option<&str>) -> Response {
    let mut request = Request::builder().method(method).uri(uri);
    if let Some(token) = token { request = request.header(header::AUTHORIZATION, format!("Bearer {token}")); }
    let response = fixture.app.clone().oneshot(request.body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    if method == "DELETE" {
        assert!(response.headers().get(header::SET_COOKIE).is_none());
    }
    response
}

async fn json(response: Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap()
}

async fn actor(fixture: &AuthTestFixture, name: &str) -> (AuthSession, String) {
    fixture.create_enrolled_user(name, "password", &[0x33; 20]).await;
    let now = fixture.clock.now();
    fixture.create_session(name, 1, now, now + Duration::days(30), now).await
}

#[tokio::test]
async fn paginated_list_has_tie_safe_continuation_current_marker_and_only_public_fields() {
    let fixture = AuthTestFixture::new_sqlite().await;
    let (current, token) = actor(&fixture, "alice").await;
    let now = fixture.clock.now();
    // All timestamps tie. The random sess-* caller sorts after these z-* rows.
    for index in 0..55 {
        let session = AuthSession {
            id: format!("z-{index:03}"), username: "alice".into(), auth_version: 1,
            credential_version: 1, issued_at: chrono_to_bson(now),
            expires_at: chrono_to_bson(now + Duration::days(30)),
            mfa_verified_at: chrono_to_bson(now - Duration::days(11)),
            revoked_at: None, user_agent: None,
        };
        fixture.store.create_session(session).await.unwrap();
    }
    let (foreign, _) = actor(&fixture, "bob").await;
    let mut obsolete = foreign.clone();
    obsolete.id = "z-obsolete".into();
    obsolete.username = "alice".into();
    obsolete.auth_version = 0;
    fixture.store.create_session(obsolete).await.unwrap();

    let first = request(&fixture, "GET", "/api/auth/sessions", Some(&token)).await;
    assert_eq!(first.status(), StatusCode::OK);
    let first = json(first).await;
    let rows = first["sessions"].as_array().unwrap();
    assert_eq!(rows.len(), 50);
    assert!(rows.iter().all(|row| row["current"] == false));
    for row in rows {
        let mut keys: Vec<_> = row.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["current", "expiresAt", "id", "issuedAt", "mfaVerifiedAt", "userAgent"]);
        assert!(row["userAgent"].is_null());
        for field in ["issuedAt", "expiresAt", "mfaVerifiedAt"] {
            let date = chrono::DateTime::parse_from_rfc3339(row[field].as_str().unwrap()).unwrap();
            assert_eq!(date.offset().local_minus_utc(), 0);
        }
    }
    let cursor = first["nextCursor"].as_str().unwrap();
    let second = json(request(&fixture, "GET", &format!("/api/auth/sessions?cursor={cursor}"), Some(&token)).await).await;
    assert!(second["nextCursor"].is_null());
    let second_rows = second["sessions"].as_array().unwrap();
    assert_eq!(second_rows.len(), 6);
    assert_eq!(second_rows.iter().filter(|row| row["current"] == true).count(), 1);
    assert!(second_rows.iter().any(|row| row["id"] == current.id));
    let ids: std::collections::HashSet<_> = rows.iter().chain(second_rows).map(|row| row["id"].as_str().unwrap()).collect();
    assert_eq!(ids.len(), 56);
}

#[tokio::test]
async fn revoke_is_owner_scoped_idempotent_and_preserves_surviving_credentials() {
    let fixture = AuthTestFixture::new_sqlite().await;
    let (current, token) = actor(&fixture, "alice").await;
    let now = fixture.clock.now();
    let (sibling, sibling_token) = fixture.create_session("alice", 1, now, now + Duration::days(30), now).await;
    let (foreign, foreign_token) = actor(&fixture, "bob").await;
    let foreign_response = request(&fixture, "DELETE", &format!("/api/auth/sessions/{}", foreign.id), Some(&token)).await;
    assert_eq!(foreign_response.status(), StatusCode::NOT_FOUND);
    let foreign_error = json(foreign_response).await;
    let missing = request(&fixture, "DELETE", "/api/auth/sessions/missing", Some(&token)).await;
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    let (_, survivor_token) = fixture.create_session("alice", 1, now, now + Duration::days(30), now).await;
    assert_eq!(foreign_error, json(missing).await);

    let path = format!("/api/auth/sessions/{}", sibling.id);
    let response = request(&fixture, "DELETE", &path, Some(&token)).await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(response.headers().get(header::SET_COOKIE).is_none());
    let revoked_at = fixture.store.get_session(&sibling.id).await.unwrap().unwrap().revoked_at;
    fixture.clock.advance(Duration::seconds(1));
    assert_eq!(request(&fixture, "DELETE", &path, Some(&token)).await.status(), StatusCode::NO_CONTENT);
    assert_eq!(fixture.store.get_session(&sibling.id).await.unwrap().unwrap().revoked_at, revoked_at);
    assert_eq!(request(&fixture, "GET", "/api/auth/sessions", Some(&sibling_token)).await.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(request(&fixture, "GET", "/api/auth/sessions", Some(&token)).await.status(), StatusCode::OK);

    // Explicit bearer wins over an unrelated cookie. Self-revoke must neither
    // clear that cookie nor revoke its backing session.
    let response = fixture.app.clone().oneshot(Request::builder().method("DELETE")
        .uri(format!("/api/auth/sessions/{}", current.id))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::COOKIE, format!("damhopper-auth={foreign_token}"))
        .body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    assert!(response.headers().get(header::SET_COOKIE).is_none());
    assert_eq!(request(&fixture, "GET", "/api/auth/sessions", Some(&token)).await.status(), StatusCode::UNAUTHORIZED);
    let revoked_cookie = fixture.app.clone().oneshot(Request::builder()
        .uri("/api/auth/sessions")
        .header(header::COOKIE, format!("damhopper-auth={token}"))
        .body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(revoked_cookie.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(revoked_cookie.headers()[header::CACHE_CONTROL], "no-store");
    assert!(revoked_cookie.headers().get(header::SET_COOKIE).is_none());
    let cookie_response = fixture.app.clone().oneshot(Request::builder()
        .uri("/api/auth/sessions")
        .header(header::COOKIE, format!("damhopper-auth={foreign_token}"))
        .body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(cookie_response.status(), StatusCode::OK);
    assert_eq!(cookie_response.headers()[header::CACHE_CONTROL], "no-store");
    assert_eq!(request(&fixture, "DELETE", &format!("/api/auth/sessions/{}", current.id), Some(&token)).await.status(), StatusCode::UNAUTHORIZED);
    assert!(fixture.store.get_session(&foreign.id).await.unwrap().unwrap().revoked_at.is_none());
    assert_eq!(request(&fixture, "GET", "/api/auth/sessions", Some(&survivor_token)).await.status(), StatusCode::OK);
}

#[tokio::test]
async fn errors_are_non_cacheable_and_bad_cursors_never_list_sessions() {
    let fixture = AuthTestFixture::new_sqlite().await;
    let (_, token) = actor(&fixture, "alice").await;
    for (method, path) in [("GET", "/api/auth/sessions"), ("DELETE", "/api/auth/sessions/missing")] {
        assert_eq!(request(&fixture, method, path, None).await.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(request(&fixture, method, path, Some("invalid")).await.status(), StatusCode::UNAUTHORIZED);
    }
    for cursor in ["!bad".to_string(), String::new(), "a".repeat(513)] {
        let response = request(&fixture, "GET", &format!("/api/auth/sessions?cursor={cursor}"), Some(&token)).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(json(response).await["code"], "INVALID_CURSOR");
    }
    // Existing live auth remains the authority if persistence is unavailable.
    fixture.sqlite_conn().execute_batch("DROP TABLE auth_sessions").unwrap();
    for (method, path) in [("GET", "/api/auth/sessions"), ("DELETE", "/api/auth/sessions/missing")] {
        assert_eq!(request(&fixture, method, path, Some(&token)).await.status(), StatusCode::SERVICE_UNAVAILABLE);
    }
}

#[tokio::test]
async fn cookie_reads_remain_authorized_but_mutation_requires_validated_explicit_bearer() {
    let fixture = AuthTestFixture::new_sqlite().await;
    let (alice, _) = actor(&fixture, "alice").await;
    let (bob, token) = actor(&fixture, "bob").await;
    let now = fixture.clock.now();
    let (sibling, _) = fixture.create_session("bob", 1, now, now + Duration::days(30), now).await;
    for authorization in [None, Some("Basic invalid"), Some("Bearer"), Some("Bearer "), Some("Bearer invalid")] {
        let expected = if matches!(authorization, Some("Bearer " | "Bearer invalid")) {
            StatusCode::UNAUTHORIZED
        } else {
            StatusCode::FORBIDDEN
        };
        for id in [alice.id.as_str(), bob.id.as_str(), sibling.id.as_str(), "missing"] {
            let mut request = Request::builder().method("DELETE")
                .uri(format!("/api/auth/sessions/{id}"))
                .header(header::COOKIE, format!("damhopper-auth={token}"));
            if let Some(authorization) = authorization {
                request = request.header(header::AUTHORIZATION, authorization);
            }
            let response = fixture.app.clone().oneshot(request.body(Body::empty()).unwrap()).await.unwrap();
            assert_eq!(response.status(), expected);
            assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
            assert!(response.headers().get(header::SET_COOKIE).is_none());
            let error = json(response).await;
            assert_eq!(error["code"], if expected == StatusCode::FORBIDDEN { "BearerRequired" } else { "AUTH_REQUIRED" });
        }
        for id in [&alice.id, &bob.id, &sibling.id] {
            assert!(fixture.store.get_session(id).await.unwrap().unwrap().revoked_at.is_none());
        }
        let response = fixture.app.clone().oneshot(Request::builder()
            .uri("/api/auth/sessions")
            .header(header::COOKIE, format!("damhopper-auth={token}"))
            .body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let page = json(response).await;
        let rows = page["sessions"].as_array().unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().any(|row| row["id"] == bob.id && row["current"] == true));
        assert!(rows.iter().any(|row| row["id"] == sibling.id && row["current"] == false));
    }
}

#[tokio::test]
async fn existing_auth_policy_denials_and_query_extractor_errors_remain_non_cacheable() {
    let fixture = AuthTestFixture::new_sqlite().await;
    let (_, valid) = actor(&fixture, "alice").await;
    let now = fixture.clock.now();
    let (_, stale_mfa) = fixture.create_session("alice", 1,
        now - Duration::days(11), now + Duration::days(19), now - Duration::days(11)).await;
    let (_, expired) = fixture.create_session("alice", 1,
        now - Duration::days(30), now, now).await;
    let (superseded, old_credential) = fixture.create_session("alice", 1,
        now, now + Duration::days(30), now).await;
    fixture.store.advance_session_mfa(&superseded.id, 1, now).await.unwrap().unwrap();
    for token in [stale_mfa, expired, old_credential] {
        for (method, path) in [("GET", "/api/auth/sessions"), ("DELETE", "/api/auth/sessions/missing")] {
            assert_eq!(request(&fixture, method, path, Some(&token)).await.status(), StatusCode::UNAUTHORIZED);
        }
    }
    assert_eq!(request(&fixture, "GET", "/api/auth/sessions?cursor=a&cursor=b", Some(&valid))
        .await.status(), StatusCode::BAD_REQUEST);
    fixture.sqlite_conn().execute("UPDATE auth_users SET is_enabled = 0 WHERE username = 'alice'", []).unwrap();
    for (method, path) in [("GET", "/api/auth/sessions"), ("DELETE", "/api/auth/sessions/missing")] {
        let response = request(&fixture, method, path, Some(&valid)).await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(json(response).await["code"], "ACCOUNT_DISABLED");
    }
    fixture.sqlite_conn().execute(
        "UPDATE auth_users SET is_enabled = 1, auth_version = auth_version + 1 WHERE username = 'alice'", [],
    ).unwrap();
    for (method, path) in [("GET", "/api/auth/sessions"), ("DELETE", "/api/auth/sessions/missing")] {
        let response = request(&fixture, method, path, Some(&valid)).await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(json(response).await["code"], "SESSION_REVOKED");
    }
}
