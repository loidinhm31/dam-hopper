use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::state::AppState;
use crate::tunnel::{TunnelError, TunnelSession};

#[derive(Debug, Deserialize)]
pub struct CreateTunnelRequest {
    pub port: u16,
    pub label: String,
}

#[derive(Debug, Serialize)]
pub struct ErrorBody {
    pub error: String,
}

fn err(msg: impl Into<String>) -> Json<ErrorBody> {
    Json(ErrorBody { error: msg.into() })
}

pub async fn create_tunnel(
    State(state): State<AppState>,
    Json(body): Json<CreateTunnelRequest>,
) -> impl IntoResponse {
    if body.port == 0 {
        return (StatusCode::BAD_REQUEST, err("port must be 1-65535")).into_response();
    }

    let label: String = body.label.trim().chars().filter(|c| !c.is_control()).collect();
    if label.is_empty() {
        return (StatusCode::BAD_REQUEST, err("label must not be empty")).into_response();
    }
    if label.chars().count() > 64 {
        return (StatusCode::BAD_REQUEST, err("label must be 64 characters or fewer"))
            .into_response();
    }

    match state.tunnel_manager.create(body.port, label).await {
        Ok(session) => (StatusCode::CREATED, Json(session)).into_response(),
        Err(TunnelError::DuplicatePort(p)) => (
            StatusCode::CONFLICT,
            err(format!("tunnel already running on port {p}")),
        )
            .into_response(),
        Err(TunnelError::BinaryMissing | TunnelError::BinaryMissingHint(_)) => (
            StatusCode::SERVICE_UNAVAILABLE,
            err("cloudflared binary not found"),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            err(format!("{e}")),
        )
            .into_response(),
    }
}

#[derive(Debug, Serialize)]
pub struct InstallStatusResponse {
    pub installing: bool,
    pub installed: bool,
}

pub async fn install_status(State(state): State<AppState>) -> Json<InstallStatusResponse> {
    let (installing, installed) = state.tunnel_manager.install_status().await;
    Json(InstallStatusResponse { installing, installed })
}

pub async fn install_cloudflared(State(state): State<AppState>) -> impl IntoResponse {
    match state.tunnel_manager.start_install() {
        Ok(()) => StatusCode::ACCEPTED.into_response(),
        Err(TunnelError::InstallInProgress) => {
            (StatusCode::CONFLICT, err("install already in progress")).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(format!("{e}"))).into_response(),
    }
}

pub async fn list_tunnels(State(state): State<AppState>) -> Json<Vec<TunnelSession>> {
    Json(state.tunnel_manager.list().await)
}

pub async fn stop_tunnel(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> impl IntoResponse {
    match state.tunnel_manager.stop(id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(TunnelError::NotFound(_)) => (
            StatusCode::NOT_FOUND,
            err(format!("tunnel not found: {id}")),
        )
            .into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(format!("{e}"))).into_response(),
    }
}
