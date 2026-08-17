use std::path::{Component, Path};

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
        image_mime,
        media_session::{media_session_cookie, MediaSessionToken, MEDIA_SESSION_COOKIE},
        ImageTicketIssue, ImageTicketRecord, MediaTicketKind,
    },
    state::AppState,
    workspace_target::ProjectTargetRef,
};

use super::{
    error::ApiError,
    fs::{resolve, ResolvedFsPath},
    media_stream_response,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IssueImageTicketRequest {
    pub project: String,
    #[serde(default)]
    pub worktree_path: Option<String>,
    pub path: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevokeImageTicketRequest {
    pub ticket: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueImageTicketResponse {
    pub ticket: String,
    pub stream_path: String,
    pub expires_at: u128,
    pub purpose: crate::fs::ImageTicketPurpose,
    pub authorization_mode: &'static str,
}

pub async fn issue_ticket(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthenticatedActor>,
    jar: CookieJar,
    Json(request): Json<IssueImageTicketRequest>,
) -> Result<Response, ApiError> {
    let _workspace_context = state.workspace_context_guard.read().await;
    let expected_generation = state.image_stream_tickets.generation();
    let target_ref = ProjectTargetRef {
        project: request.project,
        worktree_path: request.worktree_path,
    };
    let resolved = resolve_image_path(&state, &target_ref, &request.path).await?;
    let canonical = resolved.canonical;
    let mime = image_mime(&canonical)
        .ok_or_else(|| ApiError::from(AppError::InvalidInput("unsupported image type".into())))?;
    let file = media_stream_response::open_regular_file(&canonical)
        .await
        .map_err(|_| ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)))?;
    let metadata = file
        .metadata()
        .await
        .map_err(|_| ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)))?;
    let record = ImageTicketRecord {
        target: resolved.target,
        project_relative_path: request.path.into(),
        file: media_stream_response::version_from_open_file(canonical.clone(), &file, &metadata)
            .map_err(|_| ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)))?,
        mime: mime.to_owned(),
        filename: canonical
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("image")
            .to_owned(),
    };
    let existing = jar
        .get(MEDIA_SESSION_COOKIE)
        .and_then(|cookie| MediaSessionToken::from_cookie_value(cookie.value()));
    let (lease, session) = match state.image_stream_tickets.issue_bound(
        expected_generation,
        &actor.subject,
        existing,
        record,
    ) {
        Ok(lease) => lease,
        Err(ImageTicketIssue::Capacity) => return Ok(capacity_response()),
        Err(ImageTicketIssue::ContextChanged) => {
            return Err(ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)))
        }
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
        Json(IssueImageTicketResponse {
            stream_path: format!("/api/fs/image/stream/{}", lease.ticket),
            ticket: lease.ticket,
            expires_at: lease.expires_at_epoch_ms,
            purpose: crate::fs::ImageTicketPurpose::Preview,
            authorization_mode: "session-cookie-v1",
        }),
    )
        .into_response())
}

pub async fn revoke_ticket(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthenticatedActor>,
    jar: CookieJar,
    Json(request): Json<RevokeImageTicketRequest>,
) -> StatusCode {
    let _workspace_context = state.workspace_context_guard.read().await;
    if let Some(token) = jar
        .get(MEDIA_SESSION_COOKIE)
        .and_then(|cookie| MediaSessionToken::from_cookie_value(cookie.value()))
    {
        state
            .image_stream_tickets
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
        MediaTicketKind::Image,
        method,
        headers,
        allowed_origin.is_some(),
    )
    .await
}

async fn resolve_image_path(
    state: &AppState,
    target_ref: &ProjectTargetRef,
    relative_path: &str,
) -> Result<ResolvedFsPath, ApiError> {
    let resolved = resolve(state, target_ref, relative_path)
        .await
        .map_err(safe_resolution_error)?;
    reject_symlink_components(resolved.target.target_path(), relative_path).await?;
    Ok(resolved)
}

async fn reject_symlink_components(root: &Path, relative_path: &str) -> Result<(), ApiError> {
    let mut current = root.to_path_buf();
    for component in Path::new(relative_path).components() {
        match component {
            Component::Normal(name) => current.push(name),
            Component::CurDir => continue,
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(ApiError::from(AppError::Fs(crate::fs::FsError::PathEscape)))
            }
        }
        let metadata = tokio::fs::symlink_metadata(&current)
            .await
            .map_err(|_| ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)))?;
        if metadata.file_type().is_symlink() {
            return Err(ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)));
        }
    }
    Ok(())
}

fn safe_resolution_error(error: AppError) -> ApiError {
    match error.status_code() {
        403 => ApiError::from(AppError::Fs(crate::fs::FsError::PathEscape)),
        503 => ApiError::from(AppError::Fs(crate::fs::FsError::Unavailable)),
        _ => ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)),
    }
}

fn capacity_response() -> Response {
    (
        StatusCode::TOO_MANY_REQUESTS,
        [(header::RETRY_AFTER, "1")],
        Json(serde_json::json!({
            "error": "image ticket capacity reached", "code": "IMAGE_TICKET_CAPACITY"
        })),
    )
        .into_response()
}
