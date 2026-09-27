use axum::extract::{Request, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use axum_extra::extract::CookieJar;
use serde::{Deserialize, Serialize};

use crate::api::auth::{auth_cookie_header, extract_token_and_mechanism, UserRole};
use crate::auth::model::{
    bson_to_chrono, chrono_to_bson, AuthChallenge, AuthClaims, AuthSession, ChallengePurpose,
    MfaConfirmed,
};
use crate::auth::policy::{
    check_account_throttle, compute_mfa_due_at, compute_session_deadlines,
    validate_challenge_readiness, AUTH_PROTOCOL_VERSION, CHALLENGE_LIFETIME_SECS,
};
use crate::auth::totp::{TotpEngine, TotpError, TOTP_DIGITS, TOTP_ISSUER, TOTP_STEP_SECS};
use crate::auth::AuthService;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthErrorResponse {
    pub error: String,
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginChallengeResponse {
    pub state: String,
    pub challenge_token: String,
    pub challenge_expires_at: String,
    pub auth_protocol: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MfaSetupRequest {
    pub challenge_token: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MfaSetupResponse {
    pub secret: String,
    pub otpauth_uri: String,
    pub issuer: String,
    pub account_name: String,
    pub algorithm: String,
    pub digits: u8,
    pub period: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MfaConfirmRequest {
    pub challenge_token: String,
    pub code: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MfaVerifyRequest {
    pub challenge_token: String,
    pub code: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MfaChallengeResponse {
    pub challenge_token: String,
    pub challenge_expires_at: String,
    pub auth_protocol: u32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSessionResponse {
    pub state: String,
    pub token: String,
    pub expires_at: String,
    pub mfa_due_at: String,
    pub user: String,
    pub role: UserRole,
    pub auth_protocol: u32,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

pub fn auth_error_response(
    status: StatusCode,
    code: &'static str,
    message: impl Into<String>,
    retry_after: Option<i64>,
) -> Response {
    let mut resp = (
        status,
        Json(AuthErrorResponse {
            error: message.into(),
            code: code.to_string(),
            retry_after,
        }),
    )
        .into_response();
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
    if let Some(secs) = retry_after {
        if let Ok(val) = HeaderValue::from_str(&secs.to_string()) {
            resp.headers_mut().insert(header::RETRY_AFTER, val);
        }
    }
    resp
}

pub fn no_store_json_response<T: Serialize>(status: StatusCode, body: T) -> Response {
    let mut resp = (status, Json(body)).into_response();
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
    resp
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// POST /api/auth/mfa/setup — retrieves pending secret and otpauth URI for enrollment
pub async fn setup(
    State(state): State<AppState>,
    Json(body): Json<MfaSetupRequest>,
) -> Response {
    let now = state.auth_service.clock().now();
    let (Some(store), Some(mfa_key)) = (state.auth_service.store(), state.auth_service.mfa_key()) else {
        return auth_error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "AUTH_UNAVAILABLE",
            "Authentication backend unavailable",
            None,
        );
    };

    let Ok(digest) = AuthService::digest_challenge_token(&body.challenge_token) else {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "CHALLENGE_EXPIRED",
            "Invalid or expired challenge token",
            None,
        );
    };

    let challenge = match store.get_challenge(&digest).await {
        Ok(Some(c)) => c,
        Ok(None) => {
            return auth_error_response(
                StatusCode::UNAUTHORIZED,
                "CHALLENGE_EXPIRED",
                "Invalid or expired challenge token",
                None,
            );
        }
        Err(e) => {
            tracing::error!("Error reading challenge {}: {}", digest, e);
            return auth_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "AUTH_UNAVAILABLE",
                "Database error retrieving challenge",
                None,
            );
        }
    };

    if let Err(_err_msg) = validate_challenge_readiness(&challenge, ChallengePurpose::Enroll, now) {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "CHALLENGE_EXPIRED",
            "Challenge expired or invalid",
            None,
        );
    }

    let user = match store.get_user(&challenge.username).await {
        Ok(Some(u)) => u,
        Ok(None) => {
            return auth_error_response(
                StatusCode::UNAUTHORIZED,
                "ACCOUNT_DISABLED",
                "Account not found",
                None,
            );
        }
        Err(e) => {
            tracing::error!("Error reading user {}: {}", challenge.username, e);
            return auth_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "AUTH_UNAVAILABLE",
                "Database error retrieving user",
                None,
            );
        }
    };

    if !user.is_enabled {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "ACCOUNT_DISABLED",
            "Account is pending approval or disabled",
            None,
        );
    }

    if user.auth_version != challenge.auth_version {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "CHALLENGE_EXPIRED",
            "Account state updated since challenge was issued",
            None,
        );
    }

    if user.mfa.is_some() {
        return auth_error_response(
            StatusCode::BAD_REQUEST,
            "ALREADY_ENROLLED",
            "MFA is already enrolled for this account",
            None,
        );
    }

    let (Some(ciphertext), Some(nonce), Some(key_id)) = (
        &challenge.pending_secret_ciphertext,
        &challenge.pending_secret_nonce,
        &challenge.pending_secret_key_id,
    ) else {
        return auth_error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "Pending secret missing from enrollment challenge",
            None,
        );
    };

    let secret = match mfa_key.decrypt(&user.username, "enrollment-pending", key_id, ciphertext, nonce) {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("Failed to decrypt pending secret for {}: {}", user.username, e);
            return auth_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "AUTH_UNAVAILABLE",
                "Failed to decrypt pending MFA secret",
                None,
            );
        }
    };

    let secret_base32 = TotpEngine::secret_to_base32(&secret);
    let otpauth_uri = match TotpEngine::generate_otpauth_uri(&secret, &user.username, TOTP_ISSUER) {
        Ok(uri) => uri,
        Err(e) => {
            tracing::error!("Failed to generate otpauth URI for {}: {}", user.username, e);
            return auth_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "INTERNAL_ERROR",
                "Failed to generate OTP URI",
                None,
            );
        }
    };

    no_store_json_response(
        StatusCode::OK,
        MfaSetupResponse {
            secret: secret_base32,
            otpauth_uri,
            issuer: TOTP_ISSUER.to_string(),
            account_name: user.username,
            algorithm: "SHA1".to_string(),
            digits: TOTP_DIGITS,
            period: TOTP_STEP_SECS,
        },
    )
}

/// POST /api/auth/mfa/confirm — completes MFA enrollment and creates first session
pub async fn confirm(
    State(state): State<AppState>,
    Json(body): Json<MfaConfirmRequest>,
) -> Response {
    let now = state.auth_service.clock().now();
    let (Some(store), Some(mfa_key)) = (state.auth_service.store(), state.auth_service.mfa_key()) else {
        return auth_error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "AUTH_UNAVAILABLE",
            "Authentication backend unavailable",
            None,
        );
    };

    let Ok(digest) = AuthService::digest_challenge_token(&body.challenge_token) else {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "CHALLENGE_EXPIRED",
            "Invalid or expired challenge token",
            None,
        );
    };

    let challenge = match store.get_challenge(&digest).await {
        Ok(Some(c)) => c,
        Ok(None) => {
            return auth_error_response(
                StatusCode::UNAUTHORIZED,
                "CHALLENGE_EXPIRED",
                "Invalid or expired challenge token",
                None,
            );
        }
        Err(_) => {
            return auth_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "AUTH_UNAVAILABLE",
                "Database error retrieving challenge",
                None,
            );
        }
    };

    if let Err(_err_msg) = validate_challenge_readiness(&challenge, ChallengePurpose::Enroll, now) {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "CHALLENGE_EXPIRED",
            "Challenge expired or invalid",
            None,
        );
    }

    let _ = store.increment_challenge_attempt(&digest).await;

    let user = match store.get_user(&challenge.username).await {
        Ok(Some(u)) => u,
        Ok(None) => {
            return auth_error_response(
                StatusCode::UNAUTHORIZED,
                "ACCOUNT_DISABLED",
                "Account not found",
                None,
            );
        }
        Err(_) => {
            return auth_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "AUTH_UNAVAILABLE",
                "Database error retrieving user",
                None,
            );
        }
    };

    if !user.is_enabled {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "ACCOUNT_DISABLED",
            "Account is pending approval or disabled",
            None,
        );
    }

    let (is_throttled, retry_after) = check_account_throttle(&user, now);
    if is_throttled {
        return auth_error_response(
            StatusCode::TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            "Too many failed verification attempts. Please wait before retrying.",
            retry_after,
        );
    }

    if user.auth_version != challenge.auth_version {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "CHALLENGE_EXPIRED",
            "Account state updated since challenge was issued",
            None,
        );
    }

    if user.mfa.is_some() {
        return auth_error_response(
            StatusCode::BAD_REQUEST,
            "ALREADY_ENROLLED",
            "MFA is already enrolled for this account",
            None,
        );
    }

    let (Some(ciphertext), Some(nonce), Some(key_id)) = (
        &challenge.pending_secret_ciphertext,
        &challenge.pending_secret_nonce,
        &challenge.pending_secret_key_id,
    ) else {
        return auth_error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "Pending secret missing from enrollment challenge",
            None,
        );
    };

    let secret = match mfa_key.decrypt(&user.username, "enrollment-pending", key_id, ciphertext, nonce) {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("Failed to decrypt pending secret for {}: {}", user.username, e);
            return auth_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "AUTH_UNAVAILABLE",
                "Failed to decrypt pending MFA secret",
                None,
            );
        }
    };

    let matched_step = match TotpEngine::verify_code(
        &secret,
        &body.code,
        now.timestamp() as u64,
        None,
    ) {
        Ok(step) => step,
        Err(TotpError::InvalidCode) | Err(TotpError::InvalidFormat) => {
            let _ = store.record_failed_attempt(&user.username, now).await;
            return auth_error_response(
                StatusCode::UNAUTHORIZED,
                "INVALID_MFA_CODE",
                "Invalid verification code",
                None,
            );
        }
        Err(TotpError::ReplayedCode) => {
            let _ = store.record_failed_attempt(&user.username, now).await;
            return auth_error_response(
                StatusCode::UNAUTHORIZED,
                "REPLAYED_MFA_CODE",
                "Verification code already used",
                None,
            );
        }
        Err(e) => {
            tracing::warn!("TOTP verification failed for {}: {}", user.username, e);
            return auth_error_response(
                StatusCode::UNAUTHORIZED,
                "INVALID_MFA_CODE",
                "Invalid verification code",
                None,
            );
        }
    };

    // Re-encrypt the secret for durable confirmed factor storage
    let (confirmed_ciphertext, confirmed_nonce) = match mfa_key.encrypt(
        &user.username,
        "enrollment-confirmed",
        &secret,
    ) {
        Ok(enc) => enc,
        Err(e) => {
            tracing::error!("Failed to encrypt confirmed secret for {}: {}", user.username, e);
            return auth_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "INTERNAL_ERROR",
                "Failed to store confirmed MFA secret",
                None,
            );
        }
    };

    let mfa_confirmed = MfaConfirmed {
        secret_ciphertext: confirmed_ciphertext,
        nonce: confirmed_nonce,
        key_id: mfa_key.key_id().to_string(),
        enrolled_at: chrono_to_bson(now),
        last_accepted_step: matched_step,
    };

    let consumed = match store
        .consume_challenge(&digest, ChallengePurpose::Enroll, now)
        .await
    {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("Failed to consume enrollment challenge {}: {}", digest, e);
            return auth_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "AUTH_UNAVAILABLE",
                "Database error consuming challenge",
                None,
            );
        }
    };

    if !consumed {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "CHALLENGE_EXPIRED",
            "Challenge expired or already used",
            None,
        );
    }

    let cas_success = match store
        .confirm_enrollment(&user.username, user.auth_version, mfa_confirmed)
        .await
    {
        Ok(success) => success,
        Err(e) => {
            tracing::error!("CAS enrollment update failed for {}: {}", user.username, e);
            return auth_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "AUTH_UNAVAILABLE",
                "Failed to persist confirmed enrollment",
                None,
            );
        }
    };

    if !cas_success {
        return auth_error_response(
            StatusCode::CONFLICT,
            "CONCURRENT_ENROLLMENT_CONFLICT",
            "MFA enrollment could not be completed; a competing enrollment or reset occurred",
            None,
        );
    }

    let _ = store.clear_failed_attempts(&user.username).await;

    // Create session
    let session_id = uuid::Uuid::new_v4().to_string();
    let (expires_at, mfa_due_at) = compute_session_deadlines(now);

    let session = AuthSession {
        id: session_id.clone(),
        username: user.username.clone(),
        auth_version: user.auth_version,
        credential_version: 1,
        issued_at: chrono_to_bson(now),
        expires_at: chrono_to_bson(expires_at),
        mfa_verified_at: chrono_to_bson(now),
        revoked_at: None,
    };

    if let Err(e) = store.create_session(session).await {
        tracing::error!("Failed to create auth session for {}: {}", user.username, e);
        return auth_error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "AUTH_UNAVAILABLE",
            "Failed to persist active session",
            None,
        );
    }

    let claims = AuthClaims {
        v: AUTH_PROTOCOL_VERSION,
        sub: user.username.clone(),
        sid: session_id,
        auth_version: user.auth_version,
        credential_version: 1,
        iat: now.timestamp() as usize,
        exp: expires_at.timestamp() as usize,
    };

    let token = match claims.encode(&state.jwt_secret) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("Failed to sign JWT for {}: {}", user.username, e);
            return auth_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "INTERNAL_ERROR",
                "Failed to mint session token",
                None,
            );
        }
    };

    let cookie_attrs = auth_cookie_header(&token, false);
    let mut response = (
        StatusCode::OK,
        [(header::SET_COOKIE, cookie_attrs)],
        Json(AuthSessionResponse {
            state: "authenticated".to_string(),
            token,
            expires_at: expires_at.to_rfc3339(),
            mfa_due_at: mfa_due_at.to_rfc3339(),
            user: user.username,
            role: user.role,
            auth_protocol: AUTH_PROTOCOL_VERSION,
        }),
    )
        .into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
    response
}

/// POST /api/auth/mfa/verify — verifies TOTP code for LoginMfa or StepUp challenge
pub async fn verify(
    State(state): State<AppState>,
    Json(body): Json<MfaVerifyRequest>,
) -> Response {
    let now = state.auth_service.clock().now();
    let (Some(store), Some(mfa_key)) = (state.auth_service.store(), state.auth_service.mfa_key()) else {
        return auth_error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "AUTH_UNAVAILABLE",
            "Authentication backend unavailable",
            None,
        );
    };

    let Ok(digest) = AuthService::digest_challenge_token(&body.challenge_token) else {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "CHALLENGE_EXPIRED",
            "Invalid or expired challenge token",
            None,
        );
    };

    let challenge = match store.get_challenge(&digest).await {
        Ok(Some(c)) => c,
        Ok(None) => {
            return auth_error_response(
                StatusCode::UNAUTHORIZED,
                "CHALLENGE_EXPIRED",
                "Invalid or expired challenge token",
                None,
            );
        }
        Err(_) => {
            return auth_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "AUTH_UNAVAILABLE",
                "Database error retrieving challenge",
                None,
            );
        }
    };

    if challenge.purpose != ChallengePurpose::LoginMfa && challenge.purpose != ChallengePurpose::StepUp {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "CHALLENGE_EXPIRED",
            "Challenge purpose is not valid for code verification",
            None,
        );
    }

    if let Err(_err_msg) = validate_challenge_readiness(&challenge, challenge.purpose, now) {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "CHALLENGE_EXPIRED",
            "Challenge expired or invalid",
            None,
        );
    }

    let _ = store.increment_challenge_attempt(&digest).await;

    let user = match store.get_user(&challenge.username).await {
        Ok(Some(u)) => u,
        Ok(None) => {
            return auth_error_response(
                StatusCode::UNAUTHORIZED,
                "ACCOUNT_DISABLED",
                "Account not found",
                None,
            );
        }
        Err(_) => {
            return auth_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "AUTH_UNAVAILABLE",
                "Database error retrieving user",
                None,
            );
        }
    };

    if !user.is_enabled {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "ACCOUNT_DISABLED",
            "Account is pending approval or disabled",
            None,
        );
    }

    let (is_throttled, retry_after) = check_account_throttle(&user, now);
    if is_throttled {
        return auth_error_response(
            StatusCode::TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            "Too many failed verification attempts. Please wait before retrying.",
            retry_after,
        );
    }

    if user.auth_version != challenge.auth_version {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "CHALLENGE_EXPIRED",
            "Account state updated since challenge was issued",
            None,
        );
    }

    let Some(mfa) = &user.mfa else {
        return auth_error_response(
            StatusCode::BAD_REQUEST,
            "ENROLLMENT_REQUIRED",
            "Account is not enrolled in MFA",
            None,
        );
    };

    let secret = match mfa_key.decrypt(
        &user.username,
        "enrollment-confirmed",
        &mfa.key_id,
        &mfa.secret_ciphertext,
        &mfa.nonce,
    ) {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("Failed to decrypt confirmed secret for {}: {}", user.username, e);
            return auth_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "AUTH_UNAVAILABLE",
                "Failed to decrypt confirmed MFA secret",
                None,
            );
        }
    };

    let matched_step = match TotpEngine::verify_code(
        &secret,
        &body.code,
        now.timestamp() as u64,
        Some(mfa.last_accepted_step),
    ) {
        Ok(step) => step,
        Err(TotpError::InvalidCode) | Err(TotpError::InvalidFormat) => {
            let _ = store.record_failed_attempt(&user.username, now).await;
            return auth_error_response(
                StatusCode::UNAUTHORIZED,
                "INVALID_MFA_CODE",
                "Invalid verification code",
                None,
            );
        }
        Err(TotpError::ReplayedCode) => {
            let _ = store.record_failed_attempt(&user.username, now).await;
            return auth_error_response(
                StatusCode::UNAUTHORIZED,
                "REPLAYED_MFA_CODE",
                "Verification code already used",
                None,
            );
        }
        Err(e) => {
            tracing::warn!("TOTP verification failed for {}: {}", user.username, e);
            return auth_error_response(
                StatusCode::UNAUTHORIZED,
                "INVALID_MFA_CODE",
                "Invalid verification code",
                None,
            );
        }
    };

    // Advance TOTP step atomically
    let advanced = match store
        .advance_totp_step(&user.username, user.auth_version, matched_step)
        .await
    {
        Ok(b) => b,
        Err(e) => {
            tracing::error!("Failed to advance TOTP step for {}: {}", user.username, e);
            return auth_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "AUTH_UNAVAILABLE",
                "Database error recording TOTP step",
                None,
            );
        }
    };

    if !advanced {
        let _ = store.record_failed_attempt(&user.username, now).await;
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "REPLAYED_MFA_CODE",
            "Verification code already used",
            None,
        );
    }

    let consumed = match store
        .consume_challenge(&digest, challenge.purpose, now)
        .await
    {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("Failed to consume challenge {}: {}", digest, e);
            return auth_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "AUTH_UNAVAILABLE",
                "Database error consuming challenge",
                None,
            );
        }
    };

    if !consumed {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "CHALLENGE_EXPIRED",
            "Challenge expired or already used",
            None,
        );
    }

    let _ = store.clear_failed_attempts(&user.username).await;

    match challenge.purpose {
        ChallengePurpose::LoginMfa => {
            let session_id = uuid::Uuid::new_v4().to_string();
            let (expires_at, mfa_due_at) = compute_session_deadlines(now);

            let session = AuthSession {
                id: session_id.clone(),
                username: user.username.clone(),
                auth_version: user.auth_version,
                credential_version: 1,
                issued_at: chrono_to_bson(now),
                expires_at: chrono_to_bson(expires_at),
                mfa_verified_at: chrono_to_bson(now),
                revoked_at: None,
            };

            if let Err(e) = store.create_session(session).await {
                tracing::error!("Failed to create auth session for {}: {}", user.username, e);
                return auth_error_response(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "AUTH_UNAVAILABLE",
                    "Failed to persist active session",
                    None,
                );
            }

            let claims = AuthClaims {
                v: AUTH_PROTOCOL_VERSION,
                sub: user.username.clone(),
                sid: session_id,
                auth_version: user.auth_version,
                credential_version: 1,
                iat: now.timestamp() as usize,
                exp: expires_at.timestamp() as usize,
            };

            let token = match claims.encode(&state.jwt_secret) {
                Ok(t) => t,
                Err(e) => {
                    tracing::error!("Failed to sign JWT for {}: {}", user.username, e);
                    return auth_error_response(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "INTERNAL_ERROR",
                        "Failed to mint session token",
                        None,
                    );
                }
            };

            let cookie_attrs = auth_cookie_header(&token, false);
            let mut response = (
                StatusCode::OK,
                [(header::SET_COOKIE, cookie_attrs)],
                Json(AuthSessionResponse {
                    state: "authenticated".to_string(),
                    token,
                    expires_at: expires_at.to_rfc3339(),
                    mfa_due_at: mfa_due_at.to_rfc3339(),
                    user: user.username,
                    role: user.role,
                    auth_protocol: AUTH_PROTOCOL_VERSION,
                }),
            )
                .into_response();
            response.headers_mut().insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("no-store"),
            );
            response
        }
        ChallengePurpose::StepUp => {
            let (Some(session_id), Some(expected_cred_ver)) =
                (&challenge.session_id, challenge.credential_version)
            else {
                return auth_error_response(
                    StatusCode::BAD_REQUEST,
                    "INVALID_CHALLENGE",
                    "StepUp challenge missing bound session state",
                    None,
                );
            };

            let updated_session = match store
                .advance_session_mfa(session_id, expected_cred_ver, now)
                .await
            {
                Ok(Some(s)) => s,
                Ok(None) => {
                    return auth_error_response(
                        StatusCode::UNAUTHORIZED,
                        "SESSION_EXPIRED",
                        "Session has expired or was revoked",
                        None,
                    );
                }
                Err(e) => {
                    tracing::error!("Failed to advance session MFA for {}: {}", session_id, e);
                    return auth_error_response(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "AUTH_UNAVAILABLE",
                        "Failed to update session MFA freshness",
                        None,
                    );
                }
            };

            // Re-read updated credential version & deadlines
            let new_credential_version = updated_session.credential_version;
            let expires_at = bson_to_chrono(updated_session.expires_at);
            let mfa_due_at = compute_mfa_due_at(now, expires_at);

            let claims = AuthClaims {
                v: AUTH_PROTOCOL_VERSION,
                sub: user.username.clone(),
                sid: session_id.clone(),
                auth_version: user.auth_version,
                credential_version: new_credential_version,
                iat: now.timestamp() as usize,
                exp: expires_at.timestamp() as usize,
            };

            let token = match claims.encode(&state.jwt_secret) {
                Ok(t) => t,
                Err(e) => {
                    tracing::error!("Failed to sign JWT for {}: {}", user.username, e);
                    return auth_error_response(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "INTERNAL_ERROR",
                        "Failed to mint session token",
                        None,
                    );
                }
            };

            let cookie_attrs = auth_cookie_header(&token, false);
            let mut response = (
                StatusCode::OK,
                [(header::SET_COOKIE, cookie_attrs)],
                Json(AuthSessionResponse {
                    state: "authenticated".to_string(),
                    token,
                    expires_at: expires_at.to_rfc3339(),
                    mfa_due_at: mfa_due_at.to_rfc3339(),
                    user: user.username,
                    role: user.role,
                    auth_protocol: AUTH_PROTOCOL_VERSION,
                }),
            )
                .into_response();
            response.headers_mut().insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("no-store"),
            );
            response
        }
        _ => auth_error_response(
            StatusCode::BAD_REQUEST,
            "INVALID_CHALLENGE",
            "Unsupported challenge purpose",
            None,
        ),
    }
}

/// POST /api/auth/mfa/challenge — creates a step-up challenge for an unexpired session
pub async fn challenge(
    State(state): State<AppState>,
    jar: CookieJar,
    request: Request,
) -> Response {
    let now = state.auth_service.clock().now();
    let (Some(store), _) = (state.auth_service.store(), state.auth_service.mfa_key()) else {
        return auth_error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "AUTH_UNAVAILABLE",
            "Authentication backend unavailable",
            None,
        );
    };

    let Some((token, _mechanism)) = extract_token_and_mechanism(&request, &jar) else {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "AUTH_REQUIRED",
            "Authentication required",
            None,
        );
    };

    let Some(claims) = AuthClaims::decode(&token, &state.jwt_secret) else {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "AUTH_REQUIRED",
            "Authentication token invalid or legacy format",
            None,
        );
    };

    let session = match store.get_session(&claims.sid).await {
        Ok(Some(s)) => s,
        Ok(None) => {
            return auth_error_response(
                StatusCode::UNAUTHORIZED,
                "SESSION_EXPIRED",
                "Session not found",
                None,
            );
        }
        Err(e) => {
            tracing::error!("Error reading session {}: {}", claims.sid, e);
            return auth_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "AUTH_UNAVAILABLE",
                "Database error retrieving session",
                None,
            );
        }
    };

    if session.revoked_at.is_some() {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "SESSION_REVOKED",
            "Session was revoked",
            None,
        );
    }

    let expires_at = bson_to_chrono(session.expires_at);
    if now >= expires_at {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "SESSION_EXPIRED",
            "Session has expired; full login required",
            None,
        );
    }

    if claims.credential_version != session.credential_version {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "SESSION_REVOKED",
            "Session credential superseded by earlier rotation",
            None,
        );
    }

    let user = match store.get_user(&claims.sub).await {
        Ok(Some(u)) => u,
        Ok(None) => {
            return auth_error_response(
                StatusCode::UNAUTHORIZED,
                "ACCOUNT_DISABLED",
                "Account not found",
                None,
            );
        }
        Err(e) => {
            tracing::error!("Error reading user {}: {}", claims.sub, e);
            return auth_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "AUTH_UNAVAILABLE",
                "Database error retrieving user",
                None,
            );
        }
    };

    if !user.is_enabled {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "ACCOUNT_DISABLED",
            "Account is pending approval or disabled",
            None,
        );
    }

    if user.auth_version != session.auth_version || claims.auth_version != user.auth_version {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "SESSION_REVOKED",
            "Account authorization version mismatch",
            None,
        );
    }

    let (token_hex, digest) = AuthService::generate_challenge_token();
    let challenge_expires_at = now + chrono::Duration::seconds(CHALLENGE_LIFETIME_SECS);

    let auth_challenge = AuthChallenge {
        id: digest,
        username: user.username,
        auth_version: user.auth_version,
        purpose: ChallengePurpose::StepUp,
        created_at: chrono_to_bson(now),
        expires_at: chrono_to_bson(challenge_expires_at),
        attempts: 0,
        consumed_at: None,
        pending_secret_ciphertext: None,
        pending_secret_nonce: None,
        pending_secret_key_id: None,
        session_id: Some(session.id),
        credential_version: Some(session.credential_version),
    };

    if let Err(e) = store.create_challenge(auth_challenge).await {
        tracing::error!("Failed to create step-up challenge: {}", e);
        return auth_error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "AUTH_UNAVAILABLE",
            "Failed to persist step-up challenge",
            None,
        );
    }

    no_store_json_response(
        StatusCode::OK,
        MfaChallengeResponse {
            challenge_token: token_hex,
            challenge_expires_at: challenge_expires_at.to_rfc3339(),
            auth_protocol: AUTH_PROTOCOL_VERSION,
        },
    )
}
