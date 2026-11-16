use axum::{
    body::Bytes,
    extract::{rejection::JsonRejection, Extension, Path, State},
    http::{header::CONTENT_TYPE, HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    api::auth::AuthenticatedActor,
    browser_debug::{
        ArtifactSource, BrowserDebugArtifactResponse, BrowserDebugError,
        BrowserDebugHandoffResponse, BrowserSelectionV1,
    },
    error::AppError,
    state::AppState,
};
use super::error::ApiError;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateBrowserDebugArtifactRequest {
    pub terminal_id: String,
    pub terminal_incarnation: u64,
    pub selection: BrowserSelectionV1,
}

pub async fn create(
    State(state): State<AppState>,
    actor: Option<Extension<AuthenticatedActor>>,
    payload: Result<Json<CreateBrowserDebugArtifactRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<BrowserDebugArtifactResponse>), ApiError> {
    let Extension(actor) = actor.ok_or_else(unauthorized_error)?;
    let Json(body) = payload.map_err(json_rejection)?;
    let live_incarnation = state
        .pty_manager
        .live_incarnation(&body.terminal_id)
        .ok_or_else(|| {
            ApiError::from_app(AppError::BrowserDebug(BrowserDebugError::NotFound))
        })?;
    if live_incarnation != body.terminal_incarnation {
        return Err(ApiError::from_app(AppError::BrowserDebug(
            BrowserDebugError::IncarnationMismatch,
        )));
    }
    let response = state
        .browser_debug_artifacts
        .create(
            actor.subject,
            ArtifactSource::Cooperative,
            body.terminal_id,
            body.terminal_incarnation,
            body.selection,
        )
        .await
        .map_err(browser_debug_error)?;
    Ok((StatusCode::CREATED, Json(response)))
}

pub async fn upload_png(
    State(state): State<AppState>,
    actor: Option<Extension<AuthenticatedActor>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<BrowserDebugArtifactResponse>, ApiError> {
    let Extension(actor) = actor.ok_or_else(unauthorized_error)?;
    let id = Uuid::parse_str(&id)
        .map_err(|_| ApiError::from_app(AppError::BrowserDebug(BrowserDebugError::NotFound)))?;
    let content_type = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok());
    if !matches!(
        content_type.and_then(|value| value.split(';').next()),
        Some("image/png")
    ) {
        return Err(ApiError::from_app(AppError::BrowserDebug(
            BrowserDebugError::InvalidPng,
        )));
    }
    let response = state
        .browser_debug_artifacts
        .upload_png(id, &actor, body)
        .await
        .map_err(browser_debug_error)?;
    Ok(Json(response))
}

pub async fn delete(
    State(state): State<AppState>,
    actor: Option<Extension<AuthenticatedActor>>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let Extension(actor) = actor.ok_or_else(unauthorized_error)?;
    let id = Uuid::parse_str(&id)
        .map_err(|_| ApiError::from_app(AppError::BrowserDebug(BrowserDebugError::NotFound)))?;
    state
        .browser_debug_artifacts
        .delete(id, &actor)
        .await
        .map_err(browser_debug_error)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn handoff(
    State(state): State<AppState>,
    actor: Option<Extension<AuthenticatedActor>>,
    Path(id): Path<String>,
) -> Result<Json<BrowserDebugHandoffResponse>, ApiError> {
    let Extension(actor) = actor.ok_or_else(unauthorized_error)?;
    let id = Uuid::parse_str(&id)
        .map_err(|_| ApiError::from_app(AppError::BrowserDebug(BrowserDebugError::NotFound)))?;
    let response = state
        .browser_debug_artifacts
        .execute_handoff(id, &actor, &state.pty_manager)
        .await
        .map_err(ApiError::from_app)?;
    Ok(Json(response))
}

fn json_rejection(error: JsonRejection) -> ApiError {
    let error = if error.status() == StatusCode::PAYLOAD_TOO_LARGE {
        BrowserDebugError::TooLarge
    } else {
        BrowserDebugError::InvalidSelection
    };
    ApiError::from_app(AppError::BrowserDebug(error))
}

fn browser_debug_error(error: BrowserDebugError) -> ApiError {
    ApiError::from_app(AppError::BrowserDebug(error))
}

fn unauthorized_error() -> ApiError {
    ApiError::custom(StatusCode::UNAUTHORIZED, "UNAUTHORIZED", "authentication required")
}
