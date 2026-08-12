//! Sanitized server-to-browser semantic events.

use serde::Serialize;

use super::protocol::{SemanticDescriptorAvailability, SemanticUri};
use super::transport_protocol::MAX_SEMANTIC_WS_MESSAGE_BYTES;
use super::trust::SemanticTrustState;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticDocumentReplay {
    pub uri: SemanticUri,
    pub document_version: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SemanticTrustEventReason {
    Transition,
    Revoked,
    PolicyChanged,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SemanticCloseReason {
    ClientDisconnected,
    WorkspaceChanged,
    ProjectRevoked,
    PolicyChanged,
    ServerShutdown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SemanticStatusState {
    Starting,
    Ready,
    Indexing,
    Restricted,
    Crashed,
    Unavailable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SemanticTransportErrorCode {
    InvalidMessage,
    UnknownMessage,
    UnknownProject,
    ProjectMismatch,
    ProfileMismatch,
    StaleDocument,
    PolicyChanged,
    DeadlineExceeded,
    UnsupportedCapability,
    InternalUnavailable,
    MessageTooLarge,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all_fields = "camelCase")]
pub enum SemanticServerMessage {
    #[serde(rename = "semantic:handshake")]
    Handshake {
        protocol_version: u16,
        session_epoch: u64,
        workspace_generation: u64,
        availability: Vec<SemanticDescriptorAvailability>,
        trust: Vec<SemanticTrustState>,
    },
    #[serde(rename = "semantic:project")]
    Project {
        project_id: String,
        workspace_generation: u64,
        trust: SemanticTrustState,
        availability: Vec<SemanticDescriptorAvailability>,
    },
    #[serde(rename = "semantic:document_accepted")]
    DocumentAccepted {
        uri: SemanticUri,
        document_version: u64,
    },
    #[serde(rename = "semantic:replay")]
    Replay {
        project_id: String,
        documents: Vec<SemanticDocumentReplay>,
    },
    #[serde(rename = "semantic:status")]
    Status {
        project_id: String,
        state: SemanticStatusState,
        policy_revision: u64,
    },
    #[serde(rename = "semantic:progress")]
    Progress {
        request_id: String,
        document_version: u64,
        policy_revision: u64,
        state: SemanticStatusState,
    },
    #[serde(rename = "semantic:trust_changed")]
    TrustChanged {
        project_id: String,
        trust: SemanticTrustState,
        reason: SemanticTrustEventReason,
    },
    #[serde(rename = "semantic:workspace_changed")]
    WorkspaceChanged { reason: SemanticCloseReason },
    #[serde(rename = "semantic:error")]
    Error { code: SemanticTransportErrorCode },
    #[serde(rename = "semantic:closed")]
    Closed { reason: SemanticCloseReason },
}

pub fn serialize_server_message(
    message: &SemanticServerMessage,
) -> Result<String, SemanticTransportErrorCode> {
    let json = serde_json::to_string(message)
        .map_err(|_| SemanticTransportErrorCode::InternalUnavailable)?;
    if json.len() > MAX_SEMANTIC_WS_MESSAGE_BYTES {
        return Err(SemanticTransportErrorCode::MessageTooLarge);
    }
    Ok(json)
}

impl From<super::transport_errors::SemanticTransportError> for SemanticTransportErrorCode {
    fn from(error: super::transport_errors::SemanticTransportError) -> Self {
        use super::transport_errors::SemanticTransportError;
        match error {
            SemanticTransportError::MessageTooLarge => Self::MessageTooLarge,
            SemanticTransportError::UnknownMessage => Self::UnknownMessage,
            _ => Self::InvalidMessage,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_messages_expose_no_host_identity() {
        let message = SemanticServerMessage::Status {
            project_id: "project".into(),
            state: SemanticStatusState::Ready,
            policy_revision: 2,
        };
        let json = serialize_server_message(&message).unwrap();
        assert!(json.contains("semantic:status"));
        assert!(!json.contains("file:") && !json.contains("stderr"));
    }
}
