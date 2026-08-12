//! Typed, bounded browser-to-server contracts for the semantic socket.

use super::navigation_response::SemanticNavigationCancellation;
use super::protocol::{
    validate_opaque_id, SemanticNavigationRequest, SemanticUri, MAX_DOCUMENT_BYTES, MAX_SEQUENCE,
};
use super::transport_errors::SemanticTransportError;

pub const SEMANTIC_PROTOCOL_VERSION: u16 = 1;
pub const MAX_SEMANTIC_WS_MESSAGE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_OPEN_DOCUMENTS: usize = 256;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SemanticClientMessage {
    Project {
        profile_id: String,
        project_id: String,
    },
    Prewarm {
        project_id: String,
        language: super::protocol::SemanticLanguage,
        tab_generation: u64,
    },
    DocumentOpen {
        uri: SemanticUri,
        document_version: u64,
        text: String,
    },
    DocumentChange {
        uri: SemanticUri,
        document_version: u64,
        text: String,
    },
    DocumentClose {
        uri: SemanticUri,
        document_version: u64,
    },
    Navigate(SemanticNavigationRequest),
    Cancel(SemanticNavigationCancellation),
    Resync {
        project_id: String,
    },
}

impl SemanticClientMessage {
    pub fn validate(&self) -> Result<(), SemanticTransportError> {
        match self {
            Self::Project {
                profile_id,
                project_id,
            } => {
                validate_opaque_id(profile_id, "profile_id")?;
                validate_opaque_id(project_id, "project_id")?;
            }
            Self::Prewarm {
                project_id,
                language: _,
                tab_generation,
            } => {
                validate_opaque_id(project_id, "project_id")?;
                validate_version(*tab_generation)?;
            }
            Self::DocumentOpen {
                uri,
                document_version,
                text,
            }
            | Self::DocumentChange {
                uri,
                document_version,
                text,
            } => {
                uri.validate()?;
                validate_version(*document_version)?;
                if text.len() > MAX_DOCUMENT_BYTES as usize {
                    return Err(SemanticTransportError::DocumentTooLarge);
                }
            }
            Self::DocumentClose {
                uri,
                document_version,
            } => {
                uri.validate()?;
                validate_version(*document_version)?;
            }
            Self::Navigate(request) => request.validate()?,
            Self::Cancel(cancel) => cancel.validate()?,
            Self::Resync { project_id } => validate_opaque_id(project_id, "project_id")?,
        }
        Ok(())
    }
}

fn validate_version(version: u64) -> Result<(), SemanticTransportError> {
    if version > MAX_SEQUENCE {
        Err(SemanticTransportError::SequenceOutsideLimit)
    } else {
        Ok(())
    }
}
