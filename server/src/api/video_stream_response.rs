//! Compatibility adapter for the pre-extraction video stream response.

use axum::{
    http::{HeaderMap, Method},
    response::Response,
};

use crate::{fs::MediaTicketKind, state::AppState};

use super::media_stream_response;

/// Preserve the old private module entry point while routing through the
/// shared media implementation used by both video and image capabilities.
pub(crate) async fn respond(
    state: AppState,
    ticket: String,
    method: Method,
    request_headers: HeaderMap,
) -> Response {
    media_stream_response::respond(
        state,
        ticket,
        MediaTicketKind::Video,
        method,
        request_headers,
    )
    .await
}
