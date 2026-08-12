use axum::{
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Extension,
};

use crate::{
    api::auth::AuthenticatedActor,
    fs::media_session::{clear_media_session_cookie, media_session_from_headers},
    state::AppState,
};

/// Revoke the authenticated caller's current media session and clear its cookie.
pub async fn revoke_current_session(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthenticatedActor>,
    headers: HeaderMap,
) -> Response {
    if let Some(token) = media_session_from_headers(&headers) {
        state
            .media_tickets
            .revoke_session_for_actor(&actor.subject, &token);
    }
    (
        StatusCode::NO_CONTENT,
        [(header::SET_COOKIE, clear_media_session_cookie())],
    )
        .into_response()
}

/// Clear the media cookie without inspecting untrusted cookie state.
pub(crate) fn clear_cookie_header() -> axum::http::HeaderValue {
    clear_media_session_cookie()
}
