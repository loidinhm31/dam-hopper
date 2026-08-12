use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const MAX_TARGETS: u16 = 500;
pub const MAX_DOCUMENT_BYTES: u64 = 5 * 1024 * 1024;
pub const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
pub const MAX_POSITION: u32 = 1_000_000;
pub const MAX_LABEL_BYTES: usize = 512;
pub const MAX_REASON_BYTES: usize = 512;
pub const MAX_SEQUENCE: u64 = 9_007_199_254_740_991;

pub use super::transport_errors::SemanticTransportError;
pub use super::transport_messages::{
    SemanticCloseReason, SemanticDocumentReplay, SemanticServerMessage, SemanticStatusState,
    SemanticTransportErrorCode, SemanticTrustEventReason,
};
pub use super::transport_parser::parse_client_message;
pub use super::transport_protocol::{
    SemanticClientMessage, MAX_OPEN_DOCUMENTS, MAX_SEMANTIC_WS_MESSAGE_BYTES,
    SEMANTIC_PROTOCOL_VERSION,
};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticUri {
    pub profile_id: String,
    pub project_id: String,
    pub path: String,
    pub language: SemanticLanguage,
}

impl SemanticUri {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        validate_opaque_id(&self.profile_id, "profile_id")?;
        validate_opaque_id(&self.project_id, "project_id")?;
        if self.path.is_empty()
            || self.path.len() > 1024
            || self.path.trim() != self.path
            || self.path.starts_with('/')
            || self.path.get(1..2) == Some(":")
            || looks_like_uri_scheme(&self.path)
            || self.path.contains('\\')
            || self.path.contains('\0')
            || self
                .path
                .split('/')
                .any(|segment| segment.is_empty() || matches!(segment, "." | ".."))
        {
            return Err(ProtocolError::InvalidRelativePath);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SemanticLanguage {
    Rust,
    Typescript,
    Javascript,
    Java,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NavigationOperation {
    Definition,
    Implementation,
    References,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticPosition {
    pub line: u32,
    pub character: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticRange {
    pub start: SemanticPosition,
    pub end: SemanticPosition,
}

impl SemanticRange {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        self.start.validate()?;
        self.end.validate()?;
        if (self.end.line, self.end.character) < (self.start.line, self.start.character) {
            return Err(ProtocolError::InvalidRange);
        }
        Ok(())
    }
}

impl SemanticPosition {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.line > MAX_POSITION || self.character > MAX_POSITION {
            return Err(ProtocolError::PositionOutsideLimit);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticNavigationRequest {
    pub request_id: String,
    pub document_version: u64,
    pub operation: NavigationOperation,
    pub uri: SemanticUri,
    pub position: SemanticPosition,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_targets: Option<u16>,
}

impl SemanticNavigationRequest {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        validate_opaque_id(&self.request_id, "request_id")?;
        if self.document_version > MAX_SEQUENCE {
            return Err(ProtocolError::SequenceOutsideLimit);
        }
        self.uri.validate()?;
        self.position.validate()?;
        if self
            .max_targets
            .is_some_and(|limit| limit == 0 || limit > MAX_TARGETS)
        {
            return Err(ProtocolError::TargetLimitExceeded);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SemanticNavigationTarget {
    pub uri: SemanticUri,
    pub range: SemanticRange,
    pub label: String,
}

impl SemanticNavigationTarget {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        self.uri.validate()?;
        self.range.validate()?;
        valid_text(&self.label, MAX_LABEL_BYTES, "label")
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DescriptorAvailabilityState {
    Ready,
    BundleUnavailable,
    BundleInvalid,
    UnsupportedCapability,
    Restricted,
    Starting,
    Indexing,
    Crashed,
}

/// Stable public diagnostics. Arbitrary host or runtime text is never serialized.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DescriptorAvailabilityReason {
    ReleaseManifestMissing,
    ReleaseManifestInvalid,
    CapabilityUnsupported,
    ProjectRestricted,
    RuntimeStarting,
    RuntimeIndexing,
    RuntimeCrashed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticDescriptorAvailability {
    pub descriptor_id: String,
    pub language: SemanticLanguage,
    pub state: DescriptorAvailabilityState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<DescriptorAvailabilityReason>,
}

impl SemanticDescriptorAvailability {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        validate_opaque_id(&self.descriptor_id, "descriptor_id")?;
        Ok(())
    }
}

pub fn validate_navigation_targets(
    targets: &[SemanticNavigationTarget],
) -> Result<(), ProtocolError> {
    if targets.len() > usize::from(MAX_TARGETS) {
        return Err(ProtocolError::TargetLimitExceeded);
    }
    for target in targets {
        target.validate()?;
    }
    Ok(())
}

pub(crate) fn validate_opaque_id(value: &str, field: &'static str) -> Result<(), ProtocolError> {
    if value.is_empty()
        || value.len() > 128
        || value.trim() != value
        || !value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'.' | b'_' | b'-'))
        })
    {
        return Err(ProtocolError::InvalidIdentifier(field));
    }
    Ok(())
}

fn looks_like_uri_scheme(path: &str) -> bool {
    let Some((scheme, _)) = path.split_once(':') else {
        return false;
    };
    !scheme.is_empty()
        && scheme.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphabetic()
                || (index > 0 && (byte.is_ascii_digit() || matches!(byte, b'+' | b'.' | b'-')))
        })
}

fn valid_text(value: &str, maximum: usize, field: &'static str) -> Result<(), ProtocolError> {
    if value.is_empty() || value.len() > maximum || value.trim() != value || value.contains('\0') {
        return Err(ProtocolError::InvalidText(field));
    }
    Ok(())
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum ProtocolError {
    #[error("{0} must be a non-empty bounded identifier")]
    InvalidIdentifier(&'static str),
    #[error("path must be normalized and project-relative")]
    InvalidRelativePath,
    #[error("range end precedes range start")]
    InvalidRange,
    #[error("position is outside the protocol limit")]
    PositionOutsideLimit,
    #[error("{0} must be non-empty bounded text")]
    InvalidText(&'static str),
    #[error("requested target limit is outside the protocol cap")]
    TargetLimitExceeded,
    #[error("serialized navigation targets exceed the response byte cap")]
    ResponseTooLarge,
    #[error("document or policy revision is outside the protocol limit")]
    SequenceOutsideLimit,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn uri(path: &str) -> SemanticUri {
        SemanticUri {
            profile_id: "profile".into(),
            project_id: "project".into(),
            path: path.into(),
            language: SemanticLanguage::Rust,
        }
    }

    #[test]
    fn ready_availability_omits_empty_reason_on_wire() {
        let availability = SemanticDescriptorAvailability {
            descriptor_id: "rust-analyzer".into(),
            language: SemanticLanguage::Rust,
            state: DescriptorAvailabilityState::Ready,
            reason: None,
        };
        let json = serde_json::to_value(availability).unwrap();
        assert!(json.get("reason").is_none());
    }

    #[test]
    fn browser_safe_uri_rejects_host_and_file_identities() {
        for path in [
            "/tmp/a.rs",
            "../a.rs",
            "src\\a.rs",
            "file:///tmp/a.rs",
            "file:/tmp/a.rs",
            "file:relative.rs",
            " src/main.rs",
            "src/main.rs ",
            "C:/tmp/a.rs",
        ] {
            assert_eq!(
                uri(path).validate(),
                Err(ProtocolError::InvalidRelativePath)
            );
        }
    }

    #[test]
    fn request_rejects_path_like_ids_and_out_of_bounds_positions() {
        let path_like_id = SemanticNavigationRequest {
            request_id: "r".into(),
            document_version: 0,
            operation: NavigationOperation::Definition,
            uri: SemanticUri {
                profile_id: "file:///profile".into(),
                ..uri("src/main.rs")
            },
            position: SemanticPosition {
                line: 0,
                character: 0,
            },
            max_targets: None,
        };
        assert_eq!(
            path_like_id.validate(),
            Err(ProtocolError::InvalidIdentifier("profile_id"))
        );
        let out_of_bounds = SemanticNavigationRequest {
            request_id: "r".into(),
            document_version: 0,
            operation: NavigationOperation::Definition,
            uri: uri("src/main.rs"),
            position: SemanticPosition {
                line: MAX_POSITION + 1,
                character: 0,
            },
            max_targets: None,
        };
        assert_eq!(
            out_of_bounds.validate(),
            Err(ProtocolError::PositionOutsideLimit)
        );
    }

    #[test]
    fn request_rejects_unknown_and_capped_input() {
        let raw = r#"{"requestId":"r","operation":"definition","uri":{"profileId":"p","projectId":"x","path":"src/main.rs","language":"rust"},"position":{"line":0,"character":0},"rootUri":"/tmp"}"#;
        assert!(serde_json::from_str::<SemanticNavigationRequest>(raw).is_err());
        let missing_document_version = r#"{"requestId":"r","operation":"definition","uri":{"profileId":"p","projectId":"x","path":"src/main.rs","language":"rust"},"position":{"line":0,"character":0}}"#;
        assert!(
            serde_json::from_str::<SemanticNavigationRequest>(missing_document_version).is_err()
        );
        let request = SemanticNavigationRequest {
            request_id: "r".into(),
            document_version: 0,
            operation: NavigationOperation::References,
            uri: uri("src/main.rs"),
            position: SemanticPosition {
                line: 0,
                character: 0,
            },
            max_targets: Some(MAX_TARGETS + 1),
        };
        assert_eq!(request.validate(), Err(ProtocolError::TargetLimitExceeded));
        let invalid_request_id = SemanticNavigationRequest {
            request_id: "not an opaque id".into(),
            document_version: 0,
            operation: NavigationOperation::Definition,
            uri: uri("src/main.rs"),
            position: SemanticPosition {
                line: 0,
                character: 0,
            },
            max_targets: None,
        };
        assert_eq!(
            invalid_request_id.validate(),
            Err(ProtocolError::InvalidIdentifier("request_id"))
        );
    }
}
