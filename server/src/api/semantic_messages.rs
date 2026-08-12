//! Bounded semantic transport serialization helpers.

use tokio::sync::mpsc;

use crate::semantic::navigation_response::{
    serialize_navigation_response, SemanticNavigationResponse,
};
use crate::semantic::protocol::{SemanticServerMessage, SemanticTransportErrorCode};

pub(crate) fn transport_error(code: SemanticTransportErrorCode) -> SemanticServerMessage {
    SemanticServerMessage::Error { code }
}

pub(crate) async fn send_message(
    out_tx: &mpsc::Sender<String>,
    message: SemanticServerMessage,
) -> bool {
    let Ok(json) = crate::semantic::transport_messages::serialize_server_message(&message) else {
        return false;
    };
    out_tx.try_send(json).is_ok()
}

pub(crate) fn serialize_navigation_response_for_send(
    response: &SemanticNavigationResponse,
) -> Option<String> {
    match serialize_navigation_response(response) {
        Ok(bytes) => String::from_utf8(bytes).ok(),
        Err(_) => crate::semantic::transport_messages::serialize_server_message(&transport_error(
            SemanticTransportErrorCode::MessageTooLarge,
        ))
        .ok(),
    }
}
