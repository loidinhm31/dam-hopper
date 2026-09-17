use axum::{
    extract::State,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::Deserialize;

use crate::{
    api::auth::AuthenticatedActor,
    fs::media_session::{clear_media_session_cookie, MediaClientId},
    state::AppState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevokeMediaSessionRequest {
    pub media_client_id: MediaClientId,
}

/// Revoke the authenticated caller's media session and tickets for the specified client ID.
pub async fn revoke_current_session(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthenticatedActor>,
    Json(request): Json<RevokeMediaSessionRequest>,
) -> Response {
    state
        .media_tickets
        .revoke_sessions_and_tickets_for_client(&actor.subject, &request.media_client_id);
    (
        StatusCode::NO_CONTENT,
        [(
            header::SET_COOKIE,
            clear_media_session_cookie(&request.media_client_id),
        )],
    )
        .into_response()
}
