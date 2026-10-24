//! Strongly typed protocol, filtered JSON-RPC messages, version extension,
//! identity fences, and state transitions for the semantic subsystem.
//!
//! Enforces:
//! - Phase 01 proven G4 adaptive sync wire representation.
//! - Phase 01 proven G5 version extension (`damHopperDocumentVersion`) stripped before child dispatch.
//! - Comprehensive identity fencing: connection, target, session, child, and document open incarnations.
//! - Controlled method allowlist rejecting unknown commands, code actions, workspace edits, and plugins.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Supported client-to-server semantic methods.
pub const METHOD_INITIALIZE: &str = "initialize";
pub const METHOD_INITIALIZED: &str = "initialized";
pub const METHOD_SHUTDOWN: &str = "shutdown";
pub const METHOD_EXIT: &str = "exit";
pub const METHOD_DID_OPEN: &str = "textDocument/didOpen";
pub const METHOD_DID_CHANGE: &str = "textDocument/didChange";
pub const METHOD_DID_CLOSE: &str = "textDocument/didClose";
pub const METHOD_DEFINITION: &str = "textDocument/definition";
pub const METHOD_IMPLEMENTATION: &str = "textDocument/implementation";
pub const METHOD_CANCEL_REQUEST: &str = "$/cancelRequest";

/// Check if a method is allowed in the semantic filtered profile.
pub fn is_allowed_semantic_method(method: &str) -> bool {
    matches!(
        method,
        METHOD_INITIALIZE
            | METHOD_INITIALIZED
            | METHOD_SHUTDOWN
            | METHOD_EXIT
            | METHOD_DID_OPEN
            | METHOD_DID_CHANGE
            | METHOD_DID_CLOSE
            | METHOD_DEFINITION
            | METHOD_IMPLEMENTATION
            | METHOD_CANCEL_REQUEST
    )
}

/// Check if a language ID is supported by the bundled TypeScript language server.
pub fn is_supported_language(language_id: &str) -> bool {
    matches!(
        language_id,
        "typescript" | "typescriptreact" | "javascript" | "javascriptreact"
    )
}

/// Check whether a method in the semantic profile is a request (requires `id`).
pub fn is_request_method(method: &str) -> bool {
    matches!(
        method,
        "damHopper/attachTarget"
            | METHOD_INITIALIZE
            | METHOD_DEFINITION
            | METHOD_IMPLEMENTATION
            | METHOD_SHUTDOWN
    )
}

/// Check whether a method in the semantic profile is a notification (forbids `id`).
pub fn is_notification_method(method: &str) -> bool {
    matches!(
        method,
        METHOD_INITIALIZED
            | METHOD_DID_OPEN
            | METHOD_DID_CHANGE
            | METHOD_DID_CLOSE
            | METHOD_CANCEL_REQUEST
            | METHOD_EXIT
    )
}

/// Validate a client JSON-RPC request ID: must be an integer or a non-empty string
/// up to 64 bytes with no control characters.
pub fn validate_request_id(id: &serde_json::Value) -> bool {
    match id {
        serde_json::Value::Number(n) => n.is_i64() || n.is_u64(),
        serde_json::Value::String(s) => {
            !s.is_empty() && s.len() <= 64 && !s.chars().any(|c| c.is_control())
        }
        _ => false,
    }
}

/// Infer the supported TypeScript/JavaScript language ID from a file path extension.
pub fn language_id_for_path(path: &std::path::Path) -> Option<&'static str> {
    match path.extension().and_then(|e| e.to_str()) {
        Some("ts") | Some("mts") | Some("cts") => Some("typescript"),
        Some("tsx") => Some("typescriptreact"),
        Some("js") | Some("mjs") | Some("cjs") => Some("javascript"),
        Some("jsx") => Some("javascriptreact"),
        _ => None,
    }
}

/// Check that a JSON object contains only keys from the allowed list.
pub fn object_has_only_keys(
    obj: &serde_json::Map<String, serde_json::Value>,
    allowed: &[&str],
) -> bool {
    obj.keys().all(|k| allowed.contains(&k.as_str()))
}

/// Recursively check whether a JSON value contains any forbidden command, executable,
/// plugin, environment, or token override field.
pub fn contains_forbidden_override_field(val: &serde_json::Value) -> bool {
    const FORBIDDEN_KEYS: &[&str] = &[
        "command",
        "commands",
        "arguments",
        "executable",
        "nodePath",
        "tsserverPath",
        "tsserver",
        "plugins",
        "env",
        "cwd",
        "settings",
        "workDoneToken",
        "partialResultToken",
    ];
    match val {
        serde_json::Value::Object(map) => {
            for (k, v) in map {
                if FORBIDDEN_KEYS.contains(&k.as_str()) || contains_forbidden_override_field(v) {
                    return true;
                }
            }
            false
        }
        serde_json::Value::Array(items) => items.iter().any(contains_forbidden_override_field),
        _ => false,
    }
}

/// Explicit semantic supervisor lifecycle states.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SemanticState {
    Disabled,
    Idle,
    Starting,
    Ready,
    Unsupported,
    MissingTool,
    Incompatible,
    Overloaded,
    Timeout,
    Crashed,
    Invalidated,
    ShuttingDown,
    SafeDisabled,
}

impl fmt::Display for SemanticState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Disabled => write!(f, "disabled"),
            Self::Idle => write!(f, "idle"),
            Self::Starting => write!(f, "starting"),
            Self::Ready => write!(f, "ready"),
            Self::Unsupported => write!(f, "unsupported"),
            Self::MissingTool => write!(f, "missing-tool"),
            Self::Incompatible => write!(f, "incompatible"),
            Self::Overloaded => write!(f, "overloaded"),
            Self::Timeout => write!(f, "timeout"),
            Self::Crashed => write!(f, "crashed"),
            Self::Invalidated => write!(f, "invalidated"),
            Self::ShuttingDown => write!(f, "shutting-down"),
            Self::SafeDisabled => write!(f, "safe-disabled"),
        }
    }
}

/// Unique identifier for an authenticated client connection.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ConnectionId(pub String);

impl fmt::Display for ConnectionId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Session lookup key identifying an isolated child session.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SessionKey {
    pub connection_id: ConnectionId,
    pub project: String,
    pub worktree: Option<String>,
}

impl SessionKey {
    pub fn new(
        connection_id: ConnectionId,
        project: impl Into<String>,
        worktree: Option<String>,
    ) -> Self {
        Self {
            connection_id,
            project: project.into(),
            worktree,
        }
    }
}

/// Composite identity fence tracking connection, target, and session generations.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionIdentityFence {
    pub connection_id: ConnectionId,
    pub connection_generation: u64,
    pub project: String,
    pub worktree: Option<String>,
    pub target_generation: u64,
    pub session_generation: u64,
    pub child_incarnation: u64,
}

/// Full request fence validating source document incarnation, version, and request identity.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RequestIdentityFence {
    pub session_fence: SessionIdentityFence,
    pub uri: String,
    pub document_open_incarnation: u64,
    pub document_version: i64,
    pub request_id: serde_json::Value,
}

/// 0-based line and character position within a document (UTF-16 code unit offset).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Position {
    pub line: u32,
    pub character: u32,
}

/// Text range bounded by start and end positions.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Range {
    pub start: Position,
    pub end: Position,
}

/// Text document identifier.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextDocumentIdentifier {
    pub uri: String,
}

/// Versioned text document identifier.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VersionedTextDocumentIdentifier {
    pub uri: String,
    pub version: i64,
}

/// Full text document item used on `textDocument/didOpen`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocumentItem {
    pub uri: String,
    pub language_id: String,
    pub version: i64,
    pub text: String,
}

/// Parameters for `textDocument/didOpen`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DidOpenTextDocumentParams {
    pub text_document: TextDocumentItem,
}

/// Single content change event.
/// Below 64 KiB: range and range_length are None (full replacement).
/// At or above 64 KiB: range is Some (ranged incremental edit).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocumentContentChangeEvent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<Range>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range_length: Option<u32>,
    pub text: String,
}

/// Parameters for `textDocument/didChange`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DidChangeTextDocumentParams {
    pub text_document: VersionedTextDocumentIdentifier,
    pub content_changes: Vec<TextDocumentContentChangeEvent>,
}

/// Parameters for `textDocument/didClose`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DidCloseTextDocumentParams {
    pub text_document: TextDocumentIdentifier,
}

/// DamHopper extended parameters for `textDocument/definition` and `textDocument/implementation`.
/// Carries `damHopperDocumentVersion` and `damHopperModelGeneration` for staleness fencing.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationParams {
    pub text_document: TextDocumentIdentifier,
    pub position: Position,
    /// Required DamHopper version extension: must match the current document overlay version.
    pub dam_hopper_document_version: i64,
    /// Optional model open incarnation / generation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dam_hopper_model_generation: Option<u64>,
}

impl NavigationParams {
    /// Strips `damHopper*` extension fields, returning a standard LSP JSON payload
    /// suitable for forwarding to the child process stdio writer.
    pub fn to_standard_lsp_params(&self) -> serde_json::Value {
        serde_json::json!({
            "textDocument": {
                "uri": self.text_document.uri,
            },
            "position": {
                "line": self.position.line,
                "character": self.position.character,
            }
        })
    }
}

/// Parameters for `$/cancelRequest`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CancelParams {
    pub id: serde_json::Value,
}

/// Aggregate safe counters and runtime metrics exposed by the supervisor.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticAggregateStatus {
    pub state: SemanticState,
    pub enabled: bool,
    pub active_sessions: usize,
    pub active_trees: usize,
    pub open_documents: usize,
    pub total_overlay_bytes: usize,
    pub in_flight_requests: usize,
    pub resource_policy_version: String,
    pub tool_integrity_status: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_method_allowlist() {
        assert!(is_allowed_semantic_method(METHOD_INITIALIZE));
        assert!(is_allowed_semantic_method(METHOD_INITIALIZED));
        assert!(is_allowed_semantic_method(METHOD_SHUTDOWN));
        assert!(is_allowed_semantic_method(METHOD_EXIT));
        assert!(is_allowed_semantic_method(METHOD_DID_OPEN));
        assert!(is_allowed_semantic_method(METHOD_DID_CHANGE));
        assert!(is_allowed_semantic_method(METHOD_DID_CLOSE));
        assert!(is_allowed_semantic_method(METHOD_DEFINITION));
        assert!(is_allowed_semantic_method(METHOD_IMPLEMENTATION));
        assert!(is_allowed_semantic_method(METHOD_CANCEL_REQUEST));

        assert!(!is_allowed_semantic_method("textDocument/codeAction"));
        assert!(!is_allowed_semantic_method("workspace/executeCommand"));
        assert!(!is_allowed_semantic_method("workspace/applyEdit"));
    }

    #[test]
    fn test_supported_languages() {
        assert!(is_supported_language("typescript"));
        assert!(is_supported_language("typescriptreact"));
        assert!(is_supported_language("javascript"));
        assert!(is_supported_language("javascriptreact"));

        assert!(!is_supported_language("rust"));
        assert!(!is_supported_language("python"));
        assert!(!is_supported_language("html"));
    }

    #[test]
    fn test_navigation_params_strip_extension() {
        let nav = NavigationParams {
            text_document: TextDocumentIdentifier {
                uri: "dam-hopper://semantic/target-1/src/index.ts".into(),
            },
            position: Position {
                line: 10,
                character: 4,
            },
            dam_hopper_document_version: 5,
            dam_hopper_model_generation: Some(2),
        };

        let std_params = nav.to_standard_lsp_params();
        assert_eq!(
            std_params["textDocument"]["uri"],
            "dam-hopper://semantic/target-1/src/index.ts"
        );
        assert_eq!(std_params["position"]["line"], 10);
        assert_eq!(std_params["position"]["character"], 4);
        assert!(std_params.get("damHopperDocumentVersion").is_none());
        assert!(std_params.get("damHopperModelGeneration").is_none());
    }

    #[test]
    fn test_validate_request_id_and_override_fields() {
        assert!(validate_request_id(&serde_json::json!(1)));
        assert!(validate_request_id(&serde_json::json!("req-42")));
        assert!(!validate_request_id(&serde_json::Value::Null));
        assert!(!validate_request_id(&serde_json::json!("")));
        assert!(!validate_request_id(&serde_json::json!("a".repeat(65))));
        assert!(!validate_request_id(&serde_json::json!("bad\0id")));
        assert!(!validate_request_id(&serde_json::json!(1.5)));
        assert!(!validate_request_id(&serde_json::json!([1])));
        assert!(!validate_request_id(&serde_json::json!({"id": 1})));

        assert!(contains_forbidden_override_field(&serde_json::json!({
            "initializationOptions": { "tsserver": { "path": "/bin/sh" } }
        })));
        assert!(contains_forbidden_override_field(&serde_json::json!({
            "command": "workspace/executeCommand"
        })));
        assert!(!contains_forbidden_override_field(&serde_json::json!({
            "capabilities": {}
        })));
    }
}
