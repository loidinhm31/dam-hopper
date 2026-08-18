use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
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

fn owner_changed(captured: &Option<(String, u64)>, current: &Option<(String, u64)>) -> bool {
    captured.is_some() && captured != current
}

pub async fn create_tunnel(
    State(state): State<AppState>,
    Json(body): Json<CreateTunnelRequest>,
) -> impl IntoResponse {
    if body.port == 0 {
        return (StatusCode::BAD_REQUEST, err("port must be 1-65535")).into_response();
    }

    let label: String = body
        .label
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .collect();
    if label.is_empty() {
        return (StatusCode::BAD_REQUEST, err("label must not be empty")).into_response();
    }
    if label.chars().count() > 64 {
        return (
            StatusCode::BAD_REQUEST,
            err("label must be 64 characters or fewer"),
        )
            .into_response();
    }

    let owner = match &state.port_forward_manager {
        Some(manager) => manager.owner_for_port(body.port).await,
        None => None,
    };

    match state
        .tunnel_manager
        .create_for_owner(body.port, label, owner.clone())
        .await
    {
        Ok(session) => {
            // Port ownership can change while cloudflared is starting. Do not
            // leave an automatically-owned tunnel attached to an incarnation
            // that no longer owns the port. Ownerless/manual tunnels remain
            // independent of PTY discovery and are monitored by the port
            // loss poller instead.
            if owner.is_some() {
                let current_owner = match &state.port_forward_manager {
                    Some(manager) => manager.owner_for_port(body.port).await,
                    None => None,
                };
                if owner_changed(&owner, &current_owner) {
                    if let Err(error) = state.tunnel_manager.stop(session.id).await {
                        tracing::warn!(
                            tunnel_id = %session.id,
                            %error,
                            "Failed to stop tunnel after its port owner changed"
                        );
                    }
                    return (
                        StatusCode::CONFLICT,
                        err("port ownership changed while creating tunnel; retry"),
                    )
                        .into_response();
                }
            }
            (StatusCode::CREATED, Json(session)).into_response()
        }
        Err(TunnelError::DuplicatePort(p)) => (
            StatusCode::CONFLICT,
            err(format!("tunnel already running on port {p}")),
        )
            .into_response(),
        Err(TunnelError::CreationCancelled) => (
            StatusCode::CONFLICT,
            err("tunnel creation was cancelled; retry"),
        )
            .into_response(),
        Err(TunnelError::BinaryMissing | TunnelError::BinaryMissingHint(_)) => (
            StatusCode::SERVICE_UNAVAILABLE,
            err("cloudflared binary not found"),
        )
            .into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(format!("{e}"))).into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::owner_changed;

    #[test]
    fn ownerless_manual_tunnel_is_not_invalidated_by_discovery() {
        let current = Some(("session".to_string(), 3));
        assert!(!owner_changed(&None, &current));
    }

    #[test]
    fn owned_tunnel_rejects_a_changed_incarnation() {
        let captured = Some(("session".to_string(), 3));
        let current = Some(("session".to_string(), 4));
        assert!(owner_changed(&captured, &current));
    }
}

#[derive(Debug, Serialize)]
pub struct InstallStatusResponse {
    pub installing: bool,
    pub installed: bool,
}

pub async fn install_status(State(state): State<AppState>) -> Json<InstallStatusResponse> {
    let (installing, installed) = state.tunnel_manager.install_status().await;
    Json(InstallStatusResponse {
        installing,
        installed,
    })
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

pub async fn stop_tunnel(State(state): State<AppState>, Path(id): Path<Uuid>) -> impl IntoResponse {
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
