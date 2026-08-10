use axum::{
    extract::{Path as AxumPath, State},
    http::{header, HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::{
    error::AppError,
    fs::{
        is_supported_video, VideoFileVersion, VideoTicketIssue, VideoTicketPurpose,
        VideoTicketRecord,
    },
    state::AppState,
};

use super::video_stream_response;
use super::{error::ApiError, fs::resolve};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IssueVideoTicketRequest {
    pub project: String,
    pub path: String,
    pub purpose: VideoTicketPurpose,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevokeVideoTicketRequest {
    pub ticket: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueVideoTicketResponse {
    pub ticket: String,
    pub stream_path: String,
    pub expires_at: u128,
    pub purpose: VideoTicketPurpose,
}

pub async fn issue_ticket(
    State(state): State<AppState>,
    Json(request): Json<IssueVideoTicketRequest>,
) -> Result<Response, ApiError> {
    let _workspace_context = state.workspace_context_guard.read().await;
    let expected_generation = state.video_stream_tickets.generation();
    let canonical = resolve(&state, &request.project, &request.path)
        .await
        .map_err(ApiError::from)?;
    if !is_supported_video(&canonical) {
        return Err(ApiError::from(AppError::InvalidInput(
            "unsupported video type".into(),
        )));
    }

    let metadata = open_regular_file(&canonical).await?;

    let filename = canonical
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("video")
        .to_owned();
    let mime = mime_guess::from_path(&canonical)
        .first_raw()
        .unwrap_or("application/octet-stream")
        .to_owned();
    let record = VideoTicketRecord {
        purpose: request.purpose,
        project: request.project,
        project_relative_path: request.path.into(),
        file: VideoFileVersion::from_metadata(canonical, &metadata)
            .map_err(|_| ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)))?,
        mime,
        filename,
    };
    let lease = match state
        .video_stream_tickets
        .issue(expected_generation, record)
    {
        VideoTicketIssue::Issued(lease) => lease,
        VideoTicketIssue::Capacity => return Ok(capacity_response()),
        VideoTicketIssue::ContextChanged => {
            return Err(ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)));
        }
    };

    Ok((
        StatusCode::CREATED,
        [(header::CACHE_CONTROL, "no-store")],
        Json(IssueVideoTicketResponse {
            stream_path: format!("/api/fs/video/stream/{}", lease.ticket),
            ticket: lease.ticket,
            expires_at: lease.expires_at_epoch_ms,
            purpose: lease.purpose,
        }),
    )
        .into_response())
}

async fn open_regular_file(canonical: &Path) -> Result<std::fs::Metadata, ApiError> {
    let path_metadata = tokio::fs::symlink_metadata(canonical)
        .await
        .map_err(|_| ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)))?;
    if !path_metadata.is_file() {
        return Err(ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)));
    }

    #[cfg(unix)]
    let file = {
        use std::os::unix::fs::OpenOptionsExt;

        let path = canonical.to_path_buf();
        let file = tokio::task::spawn_blocking(move || {
            std::fs::OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW)
                .open(path)
        })
        .await
        .map_err(|_| ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)))?
        .map_err(|_| ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)))?;
        tokio::fs::File::from_std(file)
    };

    #[cfg(not(unix))]
    let file = tokio::fs::File::open(canonical)
        .await
        .map_err(|_| ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)))?;

    let metadata = file
        .metadata()
        .await
        .map_err(|_| ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)))?;
    if !metadata.is_file() {
        return Err(ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)));
    }
    Ok(metadata)
}

pub async fn revoke_ticket(
    State(state): State<AppState>,
    Json(request): Json<RevokeVideoTicketRequest>,
) -> StatusCode {
    let _workspace_context = state.workspace_context_guard.read().await;
    state.video_stream_tickets.revoke(&request.ticket);
    StatusCode::NO_CONTENT
}

pub async fn stream_ticket(
    State(state): State<AppState>,
    AxumPath(ticket): AxumPath<String>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    video_stream_response::respond(state, ticket, method, headers).await
}

fn capacity_response() -> Response {
    (
        StatusCode::TOO_MANY_REQUESTS,
        [(header::RETRY_AFTER, "1")],
        Json(serde_json::json!({
            "error": "video ticket capacity reached",
            "code": "VIDEO_TICKET_CAPACITY"
        })),
    )
        .into_response()
}
