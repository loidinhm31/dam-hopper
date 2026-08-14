use axum::{
    extract::{Path as AxumPath, State},
    http::{header, HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    Extension, Json,
};
use axum_extra::extract::CookieJar;
use serde::{Deserialize, Serialize};

use crate::{
    api::auth::AuthenticatedActor,
    error::AppError,
    fs::{
        is_supported_video,
        media_session::{media_session_cookie, MediaSessionToken, MEDIA_SESSION_COOKIE},
        MediaTicketKind, VideoTicketIssue, VideoTicketPurpose, VideoTicketRecord,
    },
    state::AppState,
};

use super::{error::ApiError, fs::resolve, media_stream_response};

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
    pub authorization_mode: &'static str,
}

pub async fn issue_ticket(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthenticatedActor>,
    jar: CookieJar,
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
    let file = media_stream_response::open_regular_file(&canonical)
        .await
        .map_err(|_| ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)))?;
    let metadata = file
        .metadata()
        .await
        .map_err(|_| ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)))?;
    let filename = canonical
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("video")
        .to_owned();
    let record = VideoTicketRecord {
        purpose: request.purpose,
        project: request.project,
        project_relative_path: request.path.into(),
        file: media_stream_response::version_from_open_file(canonical.clone(), &file, &metadata)
            .map_err(|_| ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)))?,
        mime: mime_guess::from_path(&canonical)
            .first_raw()
            .unwrap_or("application/octet-stream")
            .to_owned(),
        filename,
    };
    let existing = jar
        .get(MEDIA_SESSION_COOKIE)
        .and_then(|cookie| MediaSessionToken::from_cookie_value(cookie.value()));
    let (lease, session) = match state.video_stream_tickets.issue_bound(
        expected_generation,
        &actor.subject,
        existing,
        record,
    ) {
        Ok(lease) => lease,
        Err(VideoTicketIssue::Capacity) => return Ok(capacity_response()),
        Err(VideoTicketIssue::ContextChanged) => {
            return Err(ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)))
        }
        Err(VideoTicketIssue::Issued(_)) => unreachable!("bound issue cannot return a lease enum"),
    };
    let cookie = media_session_cookie(&session);
    Ok((
        StatusCode::CREATED,
        [
            (header::CACHE_CONTROL, "no-store"),
            (
                header::SET_COOKIE,
                cookie.to_str().expect("generated cookie is valid"),
            ),
        ],
        Json(IssueVideoTicketResponse {
            stream_path: format!("/api/fs/video/stream/{}", lease.ticket),
            ticket: lease.ticket,
            expires_at: lease.expires_at_epoch_ms,
            purpose: lease.purpose,
            authorization_mode: "session-cookie-v1",
        }),
    )
        .into_response())
}

pub async fn revoke_ticket(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthenticatedActor>,
    jar: CookieJar,
    Json(request): Json<RevokeVideoTicketRequest>,
) -> StatusCode {
    let _workspace_context = state.workspace_context_guard.read().await;
    if let Some(token) = jar
        .get(MEDIA_SESSION_COOKIE)
        .and_then(|cookie| MediaSessionToken::from_cookie_value(cookie.value()))
    {
        state
            .video_stream_tickets
            .revoke_bound(&request.ticket, &actor.subject, &token);
    }
    StatusCode::NO_CONTENT
}

pub(crate) async fn stream_ticket(
    State(state): State<AppState>,
    AxumPath(ticket): AxumPath<String>,
    method: Method,
    headers: HeaderMap,
    allowed_origin: Option<Extension<super::router::AllowedMediaOrigin>>,
) -> Response {
    media_stream_response::respond(
        state,
        ticket,
        MediaTicketKind::Video,
        method,
        headers,
        allowed_origin.is_some(),
    )
    .await
}

fn capacity_response() -> Response {
    (
        StatusCode::TOO_MANY_REQUESTS,
        [(header::RETRY_AFTER, "1")],
        Json(serde_json::json!({
            "error": "video ticket capacity reached", "code": "VIDEO_TICKET_CAPACITY"
        })),
    )
        .into_response()
}
