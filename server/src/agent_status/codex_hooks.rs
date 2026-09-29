//! Codex CLI native hook event adapter.
//!
//! Enforces allowlisted DTO parsing, subagent rejection, and conservative state normalization
//! in accordance with the Phase 01 static binary qualification of Codex CLI 0.158.0.
//!
//! Invariants:
//! - All prompt, tool arguments, assistant messages, model names, and transcript paths are discarded.
//! - Subagent hooks (`agent_id` or `agent_type` present) are rejected for root status tracking.
//! - Codex CLI provides status only: NO `Blocked` state and NO attention events are emitted.
//! - `Stop` is a settle candidate only: invalidates turn certainty to `Unknown`, never emits completion.
//! - `Interrupt` records `Idle` with `TurnOutcome::Interrupted` for the active turn.
//! - `PermissionRequest` is a candidate only: transitions active turn to `Unknown` without attention.

use serde::Deserialize;
use thiserror::Error;

use crate::agent_status::types::validate_opaque_id;

/// Qualified events supported by Codex CLI 0.158.0.
///
/// Note: `PostToolUseFailure` is excluded because static binary inspection of 0.158.0
/// confirmed it is not part of the Codex hook schemas.
pub const CODEX_QUALIFIED_EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PermissionRequest",
    "PostToolUse",
    "PreCompact",
    "PostCompact",
    "Stop",
    "Interrupt",
    "SessionEnd",
];

/// Maximum allowed payload size for incoming hook stdin.
pub const MAX_HOOK_PAYLOAD_BYTES: usize = 1_048_576; // 1 MiB

fn present_marker<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<bool, D::Error> {
    let _ = serde::de::IgnoredAny::deserialize(deserializer)?;
    Ok(true)
}

/// Allowlisted raw input from Codex CLI command hook.
#[derive(Debug, Deserialize)]
pub struct CodexHookInput {
    /// Opaque native session identifier.
    pub session_id: Option<String>,

    /// Event name from hook execution (`hook_event_name` or `event`).
    #[serde(alias = "event")]
    pub hook_event_name: Option<String>,

    /// Turn identifier for prompt/turn correlation.
    #[serde(alias = "prompt_id")]
    pub turn_id: Option<String>,

    /// Optional tool invocation identifier.
    #[serde(alias = "tool_use_id")]
    pub tool_call_id: Option<String>,

    /// Subagent markers: any presence indicates a child/nested agent.
    #[serde(default, deserialize_with = "present_marker")]
    pub agent_id: bool,
    #[serde(default, deserialize_with = "present_marker")]
    pub agent_type: bool,
}

/// Normalized and qualified Codex hook event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedCodexEvent {
    pub canonical_event: &'static str,
    pub session_id: String,
    pub turn_id: Option<String>,
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CodexHookError {
    #[error("payload exceeds maximum size of {0} bytes")]
    PayloadTooLarge(usize),
    #[error("malformed hook JSON: {0}")]
    MalformedJson(String),
    #[error("subagent hook ignored for root process status")]
    SubagentIgnored,
    #[error("missing session identifier")]
    MissingSessionId,
    #[error("missing hook event name")]
    MissingEventName,
    #[error("unsupported or unqualified Codex event: {0}")]
    UnqualifiedEvent(String),
    #[error("invalid opaque identifier {field}: {reason}")]
    InvalidIdentifier {
        field: &'static str,
        reason: String,
    },
}

/// Canonicalize and check if the given event name is allowlisted for Codex CLI.
pub fn normalize_codex_event(raw: &str) -> Option<&'static str> {
    let canonical = match raw {
        "SessionStart" | "session_start" | "session-start" => "SessionStart",
        "UserPromptSubmit" | "user_prompt_submit" | "user-prompt-submit" => "UserPromptSubmit",
        "PreToolUse" | "pre_tool_use" | "pre-tool-use" => "PreToolUse",
        "PermissionRequest" | "permission_request" | "permission-request" => "PermissionRequest",
        "PostToolUse" | "post_tool_use" | "post-tool-use" => "PostToolUse",
        "PreCompact" | "pre_compact" | "pre-compact" => "PreCompact",
        "PostCompact" | "post_compact" | "post-compact" => "PostCompact",
        "Stop" | "stop" => "Stop",
        "Interrupt" | "interrupt" => "Interrupt",
        "SessionEnd" | "session_end" | "session-end" => "SessionEnd",
        _ => return None,
    };

    if CODEX_QUALIFIED_EVENTS.contains(&canonical) {
        Some(canonical)
    } else {
        None
    }
}

/// Parse raw hook bytes into a validated, normalized Codex event.
///
/// Fails closed if the payload is malformed, from a subagent, or contains unqualified events.
pub fn parse_and_normalize_codex_hook(bytes: &[u8]) -> Result<NormalizedCodexEvent, CodexHookError> {
    if bytes.len() > MAX_HOOK_PAYLOAD_BYTES {
        return Err(CodexHookError::PayloadTooLarge(MAX_HOOK_PAYLOAD_BYTES));
    }

    let input: CodexHookInput = serde_json::from_slice(bytes)
        .map_err(|e| CodexHookError::MalformedJson(e.to_string()))?;

    // 1. Child marker check: subagent callbacks must never claim or modify root status.
    if input.agent_id || input.agent_type {
        return Err(CodexHookError::SubagentIgnored);
    }

    // 2. Session ID validation.
    let session_id = input
        .session_id
        .ok_or(CodexHookError::MissingSessionId)?
        .trim()
        .to_string();
    if session_id.is_empty() {
        return Err(CodexHookError::MissingSessionId);
    }
    validate_opaque_id("session_id", &session_id).map_err(|e| {
        CodexHookError::InvalidIdentifier {
            field: "session_id",
            reason: e.to_string(),
        }
    })?;

    // 3. Event name normalization and qualification against Phase 01 inventory.
    let raw_event = input
        .hook_event_name
        .ok_or(CodexHookError::MissingEventName)?
        .trim()
        .to_string();
    let canonical_event = normalize_codex_event(&raw_event)
        .ok_or_else(|| CodexHookError::UnqualifiedEvent(raw_event))?;

    // 4. Validate turn and tool call IDs if present.
    let turn_id = match &input.turn_id {
        Some(t) if !t.trim().is_empty() => {
            let trimmed = t.trim().to_string();
            validate_opaque_id("turn_id", &trimmed).map_err(|e| {
                CodexHookError::InvalidIdentifier {
                    field: "turn_id",
                    reason: e.to_string(),
                }
            })?;
            Some(trimmed)
        }
        _ => None,
    };

    let tool_call_id = match &input.tool_call_id {
        Some(tc) if !tc.trim().is_empty() => {
            let trimmed = tc.trim().to_string();
            validate_opaque_id("tool_call_id", &trimmed).map_err(|e| {
                CodexHookError::InvalidIdentifier {
                    field: "tool_call_id",
                    reason: e.to_string(),
                }
            })?;
            Some(trimmed)
        }
        _ => None,
    };

    Ok(NormalizedCodexEvent {
        canonical_event,
        session_id,
        turn_id,
        tool_call_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_codex_qualified_events_inventory() {
        assert_eq!(CODEX_QUALIFIED_EVENTS.len(), 10);
        assert!(!CODEX_QUALIFIED_EVENTS.contains(&"PostToolUseFailure"));
        assert!(!CODEX_QUALIFIED_EVENTS.contains(&"Notification"));
        assert!(!CODEX_QUALIFIED_EVENTS.contains(&"StopFailure"));
        assert!(CODEX_QUALIFIED_EVENTS.contains(&"Interrupt"));
        assert!(CODEX_QUALIFIED_EVENTS.contains(&"PreCompact"));
        assert!(CODEX_QUALIFIED_EVENTS.contains(&"PostCompact"));
    }

    #[test]
    fn test_parse_valid_user_prompt_submit() {
        let json = br#"{
            "hook_event_name": "UserPromptSubmit",
            "session_id": "sess-codex-1",
            "turn_id": "turn-1",
            "prompt": "Super confidential prompt text that must be dropped",
            "cwd": "/some/path"
        }"#;

        let event = parse_and_normalize_codex_hook(json).expect("valid prompt submit");
        assert_eq!(event.canonical_event, "UserPromptSubmit");
        assert_eq!(event.session_id, "sess-codex-1");
        assert_eq!(event.turn_id.as_deref(), Some("turn-1"));
        assert_eq!(event.tool_call_id, None);
    }

    #[test]
    fn test_reject_subagent_events() {
        let json_with_agent_id = br#"{
            "hook_event_name": "UserPromptSubmit",
            "session_id": "sess-codex-1",
            "turn_id": "turn-1",
            "agent_id": "child-agent-uuid"
        }"#;
        assert_eq!(
            parse_and_normalize_codex_hook(json_with_agent_id),
            Err(CodexHookError::SubagentIgnored)
        );

        let json_with_agent_type = br#"{
            "hook_event_name": "Stop",
            "session_id": "sess-codex-1",
            "agent_type": "worker"
        }"#;
        assert_eq!(
            parse_and_normalize_codex_hook(json_with_agent_type),
            Err(CodexHookError::SubagentIgnored)
        );
    }

    #[test]
    fn test_reject_unqualified_event() {
        let json = br#"{
            "hook_event_name": "Notification",
            "session_id": "sess-codex-1"
        }"#;
        assert!(matches!(
            parse_and_normalize_codex_hook(json),
            Err(CodexHookError::UnqualifiedEvent(_))
        ));

        let json_failure = br#"{
            "hook_event_name": "PostToolUseFailure",
            "session_id": "sess-codex-1"
        }"#;
        assert!(matches!(
            parse_and_normalize_codex_hook(json_failure),
            Err(CodexHookError::UnqualifiedEvent(_))
        ));
    }

    #[test]
    fn test_compact_events_normalized() {
        let json_pre = br#"{
            "hook_event_name": "pre_compact",
            "session_id": "sess-codex-1",
            "turn_id": "turn-1"
        }"#;
        let event = parse_and_normalize_codex_hook(json_pre).expect("pre-compact");
        assert_eq!(event.canonical_event, "PreCompact");

        let json_post = br#"{
            "hook_event_name": "post-compact",
            "session_id": "sess-codex-1",
            "turn_id": "turn-1"
        }"#;
        let event = parse_and_normalize_codex_hook(json_post).expect("post-compact");
        assert_eq!(event.canonical_event, "PostCompact");
    }

    #[test]
    fn test_interrupt_normalized() {
        let json = br#"{
            "hook_event_name": "interrupt",
            "session_id": "sess-codex-1",
            "turn_id": "turn-1"
        }"#;
        let event = parse_and_normalize_codex_hook(json).expect("interrupt");
        assert_eq!(event.canonical_event, "Interrupt");
    }
}
