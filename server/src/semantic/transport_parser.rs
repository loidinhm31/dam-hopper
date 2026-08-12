//! Strict JSON parser for semantic browser messages.

use serde::Deserialize;
use serde_json::{Map, Value};

use super::navigation_response::SemanticNavigationCancellation;
use super::protocol::{SemanticNavigationRequest, SemanticUri};
use super::transport_errors::SemanticTransportError;
use super::transport_protocol::{SemanticClientMessage, MAX_SEMANTIC_WS_MESSAGE_BYTES};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectMessage {
    profile_id: String,
    project_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrewarmMessage {
    project_id: String,
    language: super::protocol::SemanticLanguage,
    tab_generation: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DocumentMessage {
    uri: SemanticUri,
    document_version: u64,
    text: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CloseMessage {
    uri: SemanticUri,
    document_version: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CancelMessage {
    request_id: String,
    document_version: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResyncMessage {
    project_id: String,
}

/// Parse one browser message and reject unknown fields before dispatch.
pub fn parse_client_message(raw: &str) -> Result<SemanticClientMessage, SemanticTransportError> {
    if raw.len() > MAX_SEMANTIC_WS_MESSAGE_BYTES {
        return Err(SemanticTransportError::MessageTooLarge);
    }
    let mut object = serde_json::from_str::<Value>(raw)
        .map_err(|_| SemanticTransportError::InvalidMessage)?
        .as_object()
        .cloned()
        .ok_or(SemanticTransportError::InvalidMessage)?;
    let kind = object
        .remove("kind")
        .and_then(|value| value.as_str().map(str::to_owned))
        .ok_or(SemanticTransportError::InvalidMessage)?;
    let message = match kind.as_str() {
        "semantic:project" => {
            let value = parse_fields(&object, &["profileId", "projectId"])?;
            let message: ProjectMessage = from_object(value)?;
            SemanticClientMessage::Project {
                profile_id: message.profile_id,
                project_id: message.project_id,
            }
        }
        "semantic:prewarm" => {
            let value = parse_fields(&object, &["projectId", "language", "tabGeneration"])?;
            let message: PrewarmMessage = from_object(value)?;
            SemanticClientMessage::Prewarm {
                project_id: message.project_id,
                language: message.language,
                tab_generation: message.tab_generation,
            }
        }
        "semantic:document_open" => {
            let value = parse_fields(&object, &["uri", "documentVersion", "text"])?;
            let message: DocumentMessage = from_object(value)?;
            SemanticClientMessage::DocumentOpen {
                uri: message.uri,
                document_version: message.document_version,
                text: message.text,
            }
        }
        "semantic:document_change" => {
            let value = parse_fields(&object, &["uri", "documentVersion", "text"])?;
            let message: DocumentMessage = from_object(value)?;
            SemanticClientMessage::DocumentChange {
                uri: message.uri,
                document_version: message.document_version,
                text: message.text,
            }
        }
        "semantic:document_close" => {
            let value = parse_fields(&object, &["uri", "documentVersion"])?;
            let message: CloseMessage = from_object(value)?;
            SemanticClientMessage::DocumentClose {
                uri: message.uri,
                document_version: message.document_version,
            }
        }
        "semantic:navigate" => {
            let value = parse_fields(
                &object,
                &[
                    "requestId",
                    "documentVersion",
                    "operation",
                    "uri",
                    "position",
                    "maxTargets",
                ],
            )?;
            let request: SemanticNavigationRequest = from_object(value)?;
            SemanticClientMessage::Navigate(request)
        }
        "semantic:cancel" => {
            let value = parse_fields(&object, &["requestId", "documentVersion"])?;
            let message: CancelMessage = from_object(value)?;
            SemanticClientMessage::Cancel(SemanticNavigationCancellation {
                request_id: message.request_id,
                document_version: message.document_version,
            })
        }
        "semantic:resync" => {
            let value = parse_fields(&object, &["projectId"])?;
            let message: ResyncMessage = from_object(value)?;
            SemanticClientMessage::Resync {
                project_id: message.project_id,
            }
        }
        _ => return Err(SemanticTransportError::UnknownMessage),
    };
    message.validate()?;
    Ok(message)
}

fn parse_fields(
    object: &Map<String, Value>,
    allowed: &[&str],
) -> Result<Value, SemanticTransportError> {
    if object.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(SemanticTransportError::UnknownField);
    }
    Ok(Value::Object(object.clone()))
}

fn from_object<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, SemanticTransportError> {
    serde_json::from_value(value).map_err(|_| SemanticTransportError::InvalidMessage)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_rejects_unknown_fields_and_host_options() {
        let raw = r#"{"kind":"semantic:navigate","requestId":"r","documentVersion":1,"operation":"definition","uri":{"profileId":"p","projectId":"x","path":"src/main.rs","language":"rust"},"position":{"line":0,"character":0},"rootUri":"/tmp"}"#;
        assert_eq!(
            parse_client_message(raw),
            Err(SemanticTransportError::UnknownField)
        );
    }

    #[test]
    fn parser_accepts_full_snapshot_lifecycle() {
        let raw = r#"{"kind":"semantic:document_open","uri":{"profileId":"p","projectId":"x","path":"src/main.rs","language":"rust"},"documentVersion":0,"text":"fn main() {}"}"#;
        assert!(matches!(
            parse_client_message(raw),
            Ok(SemanticClientMessage::DocumentOpen {
                document_version: 0,
                ..
            })
        ));
    }
}
