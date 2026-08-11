//! Revision-aware semantic navigation responses and the bounded outbound writer.

use serde::{Deserialize, Serialize};

use super::protocol::{
    validate_navigation_targets, validate_opaque_id, ProtocolError, SemanticDescriptorAvailability,
    SemanticNavigationTarget, MAX_RESPONSE_BYTES, MAX_SEQUENCE,
};

/// Browser-to-server control input; response serialization uses private wire DTOs.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticNavigationCancellation {
    pub request_id: String,
    pub document_version: u64,
}

impl SemanticNavigationCancellation {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        validate_response_context(&self.request_id, self.document_version, 0)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SemanticNavigationErrorCode {
    RequestInvalid,
    StaleDocument,
    PolicyChanged,
    DeadlineExceeded,
    ResponseTooLarge,
    InternalUnavailable,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SemanticNavigationResponse {
    Targets {
        request_id: String,
        document_version: u64,
        policy_revision: u64,
        targets: Vec<SemanticNavigationTarget>,
    },
    Empty {
        request_id: String,
        document_version: u64,
        policy_revision: u64,
    },
    Cancelled {
        request_id: String,
        document_version: u64,
        policy_revision: u64,
    },
    Stale {
        request_id: String,
        document_version: u64,
        policy_revision: u64,
    },
    Unavailable {
        request_id: String,
        document_version: u64,
        policy_revision: u64,
        availability: SemanticDescriptorAvailability,
    },
    Error {
        request_id: String,
        document_version: u64,
        policy_revision: u64,
        error: SemanticNavigationErrorCode,
    },
}

impl SemanticNavigationResponse {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        match self {
            Self::Targets {
                request_id,
                document_version,
                policy_revision,
                targets,
            } => {
                validate_response_context(request_id, *document_version, *policy_revision)?;
                validate_navigation_targets(targets)
            }
            Self::Empty {
                request_id,
                document_version,
                policy_revision,
            }
            | Self::Cancelled {
                request_id,
                document_version,
                policy_revision,
            }
            | Self::Stale {
                request_id,
                document_version,
                policy_revision,
            }
            | Self::Error {
                request_id,
                document_version,
                policy_revision,
                ..
            } => validate_response_context(request_id, *document_version, *policy_revision),
            Self::Unavailable {
                request_id,
                document_version,
                policy_revision,
                availability,
            } => {
                validate_response_context(request_id, *document_version, *policy_revision)?;
                availability.validate()
            }
        }
    }
}

/// The future transport must write responses through this bounded serializer.
pub fn serialize_navigation_response(
    response: &SemanticNavigationResponse,
) -> Result<Vec<u8>, ProtocolError> {
    response.validate()?;
    let payload = serde_json::to_vec(&WireNavigationResponse::from(response))
        .expect("private semantic navigation wire DTOs must serialize");
    if payload.len() > MAX_RESPONSE_BYTES {
        return Err(ProtocolError::ResponseTooLarge);
    }
    Ok(payload)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WireNavigationTarget<'a> {
    uri: WireUri<'a>,
    range: WireRange,
    label: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WireUri<'a> {
    profile_id: &'a str,
    project_id: &'a str,
    path: &'a str,
    language: &'static str,
}

#[derive(Serialize)]
struct WirePosition {
    line: u32,
    character: u32,
}

#[derive(Serialize)]
struct WireRange {
    start: WirePosition,
    end: WirePosition,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WireDescriptorAvailability<'a> {
    descriptor_id: &'a str,
    language: &'static str,
    state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum WireNavigationResponse<'a> {
    Targets {
        request_id: &'a str,
        document_version: u64,
        policy_revision: u64,
        targets: Vec<WireNavigationTarget<'a>>,
    },
    Empty {
        request_id: &'a str,
        document_version: u64,
        policy_revision: u64,
    },
    Cancelled {
        request_id: &'a str,
        document_version: u64,
        policy_revision: u64,
    },
    Stale {
        request_id: &'a str,
        document_version: u64,
        policy_revision: u64,
    },
    Unavailable {
        request_id: &'a str,
        document_version: u64,
        policy_revision: u64,
        availability: WireDescriptorAvailability<'a>,
    },
    Error {
        request_id: &'a str,
        document_version: u64,
        policy_revision: u64,
        error: &'static str,
    },
}

impl<'a> From<&'a SemanticNavigationResponse> for WireNavigationResponse<'a> {
    fn from(response: &'a SemanticNavigationResponse) -> Self {
        match response {
            SemanticNavigationResponse::Targets {
                request_id,
                document_version,
                policy_revision,
                targets,
            } => Self::Targets {
                request_id,
                document_version: *document_version,
                policy_revision: *policy_revision,
                targets: targets
                    .iter()
                    .map(|target| WireNavigationTarget {
                        uri: wire_uri(&target.uri),
                        range: wire_range(&target.range),
                        label: &target.label,
                    })
                    .collect(),
            },
            SemanticNavigationResponse::Empty {
                request_id,
                document_version,
                policy_revision,
            } => Self::Empty {
                request_id,
                document_version: *document_version,
                policy_revision: *policy_revision,
            },
            SemanticNavigationResponse::Cancelled {
                request_id,
                document_version,
                policy_revision,
            } => Self::Cancelled {
                request_id,
                document_version: *document_version,
                policy_revision: *policy_revision,
            },
            SemanticNavigationResponse::Stale {
                request_id,
                document_version,
                policy_revision,
            } => Self::Stale {
                request_id,
                document_version: *document_version,
                policy_revision: *policy_revision,
            },
            SemanticNavigationResponse::Unavailable {
                request_id,
                document_version,
                policy_revision,
                availability,
            } => Self::Unavailable {
                request_id,
                document_version: *document_version,
                policy_revision: *policy_revision,
                availability: WireDescriptorAvailability {
                    descriptor_id: &availability.descriptor_id,
                    language: language_wire(availability.language),
                    state: availability_state_wire(availability.state),
                    reason: availability.reason.map(availability_reason_wire),
                },
            },
            SemanticNavigationResponse::Error {
                request_id,
                document_version,
                policy_revision,
                error,
            } => Self::Error {
                request_id,
                document_version: *document_version,
                policy_revision: *policy_revision,
                error: error.as_wire(),
            },
        }
    }
}

fn wire_uri(uri: &super::protocol::SemanticUri) -> WireUri<'_> {
    WireUri {
        profile_id: &uri.profile_id,
        project_id: &uri.project_id,
        path: &uri.path,
        language: language_wire(uri.language),
    }
}

fn wire_range(range: &super::protocol::SemanticRange) -> WireRange {
    WireRange {
        start: WirePosition {
            line: range.start.line,
            character: range.start.character,
        },
        end: WirePosition {
            line: range.end.line,
            character: range.end.character,
        },
    }
}

const fn language_wire(language: super::protocol::SemanticLanguage) -> &'static str {
    match language {
        super::protocol::SemanticLanguage::Rust => "rust",
        super::protocol::SemanticLanguage::Typescript => "typescript",
        super::protocol::SemanticLanguage::Javascript => "javascript",
        super::protocol::SemanticLanguage::Java => "java",
    }
}

const fn availability_state_wire(
    state: super::protocol::DescriptorAvailabilityState,
) -> &'static str {
    match state {
        super::protocol::DescriptorAvailabilityState::Ready => "ready",
        super::protocol::DescriptorAvailabilityState::BundleUnavailable => "bundleUnavailable",
        super::protocol::DescriptorAvailabilityState::BundleInvalid => "bundleInvalid",
        super::protocol::DescriptorAvailabilityState::UnsupportedCapability => {
            "unsupportedCapability"
        }
        super::protocol::DescriptorAvailabilityState::Restricted => "restricted",
        super::protocol::DescriptorAvailabilityState::Starting => "starting",
        super::protocol::DescriptorAvailabilityState::Indexing => "indexing",
        super::protocol::DescriptorAvailabilityState::Crashed => "crashed",
    }
}

const fn availability_reason_wire(
    reason: super::protocol::DescriptorAvailabilityReason,
) -> &'static str {
    match reason {
        super::protocol::DescriptorAvailabilityReason::ReleaseManifestMissing => {
            "releaseManifestMissing"
        }
        super::protocol::DescriptorAvailabilityReason::ReleaseManifestInvalid => {
            "releaseManifestInvalid"
        }
        super::protocol::DescriptorAvailabilityReason::CapabilityUnsupported => {
            "capabilityUnsupported"
        }
        super::protocol::DescriptorAvailabilityReason::ProjectRestricted => "projectRestricted",
        super::protocol::DescriptorAvailabilityReason::RuntimeStarting => "runtimeStarting",
        super::protocol::DescriptorAvailabilityReason::RuntimeIndexing => "runtimeIndexing",
        super::protocol::DescriptorAvailabilityReason::RuntimeCrashed => "runtimeCrashed",
    }
}

impl SemanticNavigationErrorCode {
    const fn as_wire(self) -> &'static str {
        match self {
            Self::RequestInvalid => "requestInvalid",
            Self::StaleDocument => "staleDocument",
            Self::PolicyChanged => "policyChanged",
            Self::DeadlineExceeded => "deadlineExceeded",
            Self::ResponseTooLarge => "responseTooLarge",
            Self::InternalUnavailable => "internalUnavailable",
        }
    }
}

fn validate_response_context(
    request_id: &str,
    document_version: u64,
    policy_revision: u64,
) -> Result<(), ProtocolError> {
    validate_opaque_id(request_id, "request_id")?;
    if document_version > MAX_SEQUENCE || policy_revision > MAX_SEQUENCE {
        return Err(ProtocolError::SequenceOutsideLimit);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::semantic::protocol::{
        SemanticLanguage, SemanticPosition, SemanticRange, SemanticUri, MAX_LABEL_BYTES,
        MAX_TARGETS,
    };

    #[test]
    fn response_and_cancellation_are_revision_bound() {
        let response = SemanticNavigationResponse::Stale {
            request_id: "request".into(),
            document_version: 2,
            policy_revision: 3,
        };
        assert_eq!(
            String::from_utf8(serialize_navigation_response(&response).unwrap()).unwrap(),
            r#"{"kind":"stale","requestId":"request","documentVersion":2,"policyRevision":3}"#
        );
        assert_eq!(
            SemanticNavigationCancellation {
                request_id: "request".into(),
                document_version: MAX_SEQUENCE + 1,
            }
            .validate(),
            Err(ProtocolError::SequenceOutsideLimit)
        );
    }

    #[test]
    fn outbound_response_writer_rejects_escaped_target_payloads_over_one_mib() {
        let target = SemanticNavigationTarget {
            uri: SemanticUri {
                profile_id: "profile".into(),
                project_id: "project".into(),
                path: "\"".repeat(1024),
                language: SemanticLanguage::Rust,
            },
            range: SemanticRange {
                start: SemanticPosition {
                    line: 0,
                    character: 0,
                },
                end: SemanticPosition {
                    line: 0,
                    character: 1,
                },
            },
            label: "\"".repeat(MAX_LABEL_BYTES),
        };
        let response = SemanticNavigationResponse::Targets {
            request_id: "request".into(),
            document_version: 1,
            policy_revision: 1,
            targets: vec![target; usize::from(MAX_TARGETS)],
        };
        assert_eq!(
            serialize_navigation_response(&response),
            Err(ProtocolError::ResponseTooLarge)
        );
    }
}
