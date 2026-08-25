use axum::{
    body::Bytes,
    extract::{rejection::JsonRejection, Path, State},
    http::{header::CONTENT_TYPE, HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    browser_debug::{
        terminal_reference, BrowserDebugArtifactResponse, BrowserDebugError,
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
    pub selection: BrowserSelectionV1,
}

pub async fn create(
    State(state): State<AppState>,
    payload: Result<Json<CreateBrowserDebugArtifactRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<BrowserDebugArtifactResponse>), ApiError> {
    let Json(body) = payload.map_err(json_rejection)?;
    if !state.pty_manager.is_alive(&body.terminal_id) {
        return Err(ApiError::from_app(AppError::BrowserDebug(
            BrowserDebugError::NotFound,
        )));
    }
    let response = state
        .browser_debug_artifacts
        .create(body.terminal_id, body.selection)
        .await
        .map_err(browser_debug_error)?;
    Ok((StatusCode::CREATED, Json(response)))
}

pub async fn upload_png(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<BrowserDebugArtifactResponse>, ApiError> {
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
        .upload_png(id, body)
        .await
        .map_err(browser_debug_error)?;
    Ok(Json(response))
}

pub async fn delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let id = Uuid::parse_str(&id)
        .map_err(|_| ApiError::from_app(AppError::BrowserDebug(BrowserDebugError::NotFound)))?;
    state
        .browser_debug_artifacts
        .delete(id)
        .await
        .map_err(browser_debug_error)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn handoff(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<BrowserDebugHandoffResponse>, ApiError> {
    let id = Uuid::parse_str(&id)
        .map_err(|_| ApiError::from_app(AppError::BrowserDebug(BrowserDebugError::NotFound)))?;
    let artifact = state
        .browser_debug_artifacts
        .claim_handoff(id)
        .await
        .map_err(browser_debug_error)?;
    if !state.pty_manager.is_alive(&artifact.terminal_id) {
        state.browser_debug_artifacts.release_handoff(id).await;
        return Err(ApiError::from_app(AppError::BrowserDebug(
            BrowserDebugError::NotFound,
        )));
    }
    let reference = match terminal_reference(&artifact) {
        Ok(reference) => reference,
        Err(error) => {
            state.browser_debug_artifacts.release_handoff(id).await;
            return Err(browser_debug_error(error));
        }
    };
    if let Err(error) = state
        .pty_manager
        .write(&artifact.terminal_id, reference.as_bytes())
    {
        state.browser_debug_artifacts.release_handoff(id).await;
        return Err(ApiError::from_app(error));
    }
    Ok(Json(BrowserDebugHandoffResponse { inserted: true }))
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
