use axum::{body::{to_bytes, Body}, http::{header, HeaderValue, Request, StatusCode}};
use chrono::Duration;
use dam_hopper_server::auth::{model::AuthClaims, totp::TotpEngine, Clock};
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;
use common::auth_fixtures::{AuthTestFixture, TEST_JWT_SECRET};

async fn post(fixture: &AuthTestFixture, uri: &str, body: Value, user_agent: Option<HeaderValue>, token: Option<&str>) -> Value {
    let mut request = Request::builder().method("POST").uri(uri).header(header::CONTENT_TYPE, "application/json");
    if let Some(agent) = user_agent { request = request.header(header::USER_AGENT, agent); }
    if let Some(token) = token { request = request.header(header::AUTHORIZATION, format!("Bearer {token}")); }
    let response = fixture.app.clone().oneshot(request.body(Body::from(serde_json::to_vec(&body).unwrap())).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK, "{uri}");
    serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap()
}

#[tokio::test]
async fn full_mfa_sessions_capture_bounded_optional_metadata_and_stepup_preserves_it() {
    let fixture = AuthTestFixture::new_sqlite().await;
    fixture.create_user("alice", "password", true).await;
    let credentials = json!({"username": "alice", "password": "password"});
    let challenge = post(&fixture, "/api/auth/login", credentials.clone(), None, None).await;
    assert_eq!(challenge["state"], "enrollmentRequired");
    let setup = post(&fixture, "/api/auth/mfa/setup", json!({"challengeToken": challenge["challengeToken"]}), None, None).await;
    let secret = TotpEngine::base32_to_secret(setup["secret"].as_str().unwrap()).unwrap();
    let code = TotpEngine::generate_code_at(&secret, fixture.clock.now().timestamp() as u64).unwrap();
    let agent = format!("{}界", "a".repeat(511));
    let enrollment = post(&fixture, "/api/auth/mfa/confirm", json!({
        "challengeToken": challenge["challengeToken"], "code": code,
    }), Some(HeaderValue::from_bytes(agent.as_bytes()).unwrap()), None).await;
    let token = enrollment["token"].as_str().unwrap();
    let claims = AuthClaims::decode(token, TEST_JWT_SECRET).unwrap();
    let original = fixture.store.get_session(&claims.sid).await.unwrap().unwrap();
    assert_eq!(original.user_agent, Some("a".repeat(511)));

    fixture.clock.advance(Duration::seconds(30));
    let challenge = post(&fixture, "/api/auth/mfa/challenge", json!({}), None, Some(token)).await;
    let code = TotpEngine::generate_code_at(&secret, fixture.clock.now().timestamp() as u64).unwrap();
    let stepup = post(&fixture, "/api/auth/mfa/verify", json!({
        "challengeToken": challenge["challengeToken"], "code": code,
    }), Some(HeaderValue::from_static("Different stepup client")), None).await;
    let rotated = AuthClaims::decode(stepup["token"].as_str().unwrap(), TEST_JWT_SECRET).unwrap();
    assert_eq!(rotated.sid, claims.sid);
    let updated = fixture.store.get_session(&claims.sid).await.unwrap().unwrap();
    assert_eq!(updated.user_agent, original.user_agent);
    assert_eq!(updated.issued_at, original.issued_at);
    assert_eq!(updated.expires_at, original.expires_at);
    assert_eq!(updated.credential_version, original.credential_version + 1);

    let variants = [
        (None, None),
        (Some(HeaderValue::from_static("")), None),
        (Some(HeaderValue::from_bytes("界".repeat(200).as_bytes()).unwrap()), Some("界".repeat(170))),
        (Some(HeaderValue::from_str(&"x".repeat(600)).unwrap()), Some("x".repeat(512))),
        (Some(HeaderValue::from_bytes(&[0xff, 0xfe]).unwrap()), None),
    ];
    for (agent, expected) in variants {
        fixture.clock.advance(Duration::seconds(30));
        let challenge = post(&fixture, "/api/auth/login", credentials.clone(), None, None).await;
        assert_eq!(challenge["state"], "mfaRequired");
        let code = TotpEngine::generate_code_at(&secret, fixture.clock.now().timestamp() as u64).unwrap();
        let login = post(&fixture, "/api/auth/mfa/verify", json!({
            "challengeToken": challenge["challengeToken"], "code": code,
        }), agent, None).await;
        let claims = AuthClaims::decode(login["token"].as_str().unwrap(), TEST_JWT_SECRET).unwrap();
        let session = fixture.store.get_session(&claims.sid).await.unwrap().unwrap();
        assert_eq!(session.user_agent, expected);
        assert!(session.user_agent.as_ref().is_none_or(|agent| agent.len() <= 512));
    }
}
