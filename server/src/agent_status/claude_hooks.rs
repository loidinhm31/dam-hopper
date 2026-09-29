//! Claude Code native hook event adapter.
//!
//! Enforces allowlisted DTO parsing, subagent rejection, and conservative state normalization
//! in accordance with the Phase 01 static binary qualification of Claude Code 2.1.250.
//!
//! Invariants:
//! - All prompt, tool input/output, notification messages, error details, and transcript paths are discarded.
//! - Subagent hooks (`agent_id` or `agent_type` present) are rejected for root process status tracking.
//! - `Notification(permission_prompt)` qualifies `Blocked` with `BlockedReason::Approval`.
//! - `Notification(agent_needs_input)` qualifies `Blocked` with `BlockedReason::Question`.
//! - `StopFailure` qualifies `Blocked` with `BlockedReason::Error`.
//! - `PreToolUse(AskUserQuestion)` and `PermissionRequest` are candidates only: transition active turn to `Unknown` without attention.
//! - Claude Code has no native `Interrupt` hook: Escape gaps expire honestly to `Unknown` via the 15-second evidence lease.
//! - `Stop` is a settle candidate only: invalidates turn certainty to `Unknown`, never emits completion.

use serde::Deserialize;
use thiserror::Error;

use crate::agent_status::types::{validate_opaque_id, BlockedReason};

/// Qualified events supported by Claude Code 2.1.250.
///
/// Note: `Interrupt` is absent because Claude Code emits no native hook on Escape/Ctrl+C.
pub const CLAUDE_QUALIFIED_EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PermissionRequest",
    "PostToolUse",
    "PostToolUseFailure",
    "PreCompact",
    "PostCompact",
    "Notification",
    "Stop",
    "StopFailure",
    "SessionEnd",
];

/// Maximum allowed payload size for incoming hook stdin.
pub const MAX_HOOK_PAYLOAD_BYTES: usize = 1_048_576; // 1 MiB

fn present_marker<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<bool, D::Error> {
    let _ = serde::de::IgnoredAny::deserialize(deserializer)?;
    Ok(true)
}

/// Allowlisted raw input from Claude Code command hook.
#[derive(Debug, Deserialize)]
pub struct ClaudeHookInput {
    /// Opaque native session identifier.
    pub session_id: Option<String>,

    /// Event name from hook execution (`hook_event_name` or `event`).
    #[serde(alias = "event")]
    pub hook_event_name: Option<String>,

    /// Turn/prompt identifier for prompt/turn correlation.
    #[serde(alias = "prompt_id")]
    pub turn_id: Option<String>,

    /// Optional tool invocation identifier.
    #[serde(alias = "tool_use_id")]
    pub tool_call_id: Option<String>,

    /// Tool name, used solely to identify question candidates like `AskUserQuestion`.
    pub tool_name: Option<String>,

    /// Notification type (e.g. `permission_prompt`, `agent_needs_input`, `idle_prompt`).
    pub notification_type: Option<String>,

    /// Subagent markers: any presence indicates a child/nested agent.
    #[serde(default, deserialize_with = "present_marker")]
    pub agent_id: bool,
    #[serde(default, deserialize_with = "present_marker")]
    pub agent_type: bool,
}

/// Normalized and qualified Claude hook event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedClaudeEvent {
    pub canonical_event: &'static str,
    pub session_id: String,
    pub turn_id: Option<String>,
    pub tool_call_id: Option<String>,
    pub reason: Option<BlockedReason>,
    pub notification_type: Option<String>,
    pub is_question_candidate: bool,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ClaudeHookError {
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
    #[error("unsupported or unqualified Claude event: {0}")]
    UnqualifiedEvent(String),
    #[error("invalid opaque identifier {field}: {reason}")]
    InvalidIdentifier {
        field: &'static str,
        reason: String,
    },
}

/// Canonicalize and check if the given event name is allowlisted for Claude Code.
pub fn normalize_claude_event(raw: &str) -> Option<&'static str> {
    let canonical = match raw {
        "SessionStart" | "session_start" | "session-start" => "SessionStart",
        "UserPromptSubmit" | "user_prompt_submit" | "user-prompt-submit" => "UserPromptSubmit",
        "PreToolUse" | "pre_tool_use" | "pre-tool-use" => "PreToolUse",
        "PermissionRequest" | "permission_request" | "permission-request" => "PermissionRequest",
        "PostToolUse" | "post_tool_use" | "post-tool-use" => "PostToolUse",
        "PostToolUseFailure" | "post_tool_use_failure" | "post-tool-use-failure" => {
            "PostToolUseFailure"
        }
        "PreCompact" | "pre_compact" | "pre-compact" => "PreCompact",
        "PostCompact" | "post_compact" | "post-compact" => "PostCompact",
        "Notification" | "notification" => "Notification",
        "Stop" | "stop" => "Stop",
        "StopFailure" | "stop_failure" | "stop-failure" => "StopFailure",
        "SessionEnd" | "session_end" | "session-end" => "SessionEnd",
        _ => return None,
    };

    if CLAUDE_QUALIFIED_EVENTS.contains(&canonical) {
        Some(canonical)
    } else {
        None
    }
}

/// Parse raw hook bytes into a validated, normalized Claude event.
///
/// Fails closed if the payload is malformed, from a subagent, or contains unqualified events.
pub fn parse_and_normalize_claude_hook(bytes: &[u8]) -> Result<NormalizedClaudeEvent, ClaudeHookError> {
    if bytes.len() > MAX_HOOK_PAYLOAD_BYTES {
        return Err(ClaudeHookError::PayloadTooLarge(MAX_HOOK_PAYLOAD_BYTES));
    }

    let input: ClaudeHookInput = serde_json::from_slice(bytes)
        .map_err(|e| ClaudeHookError::MalformedJson(e.to_string()))?;

    // 1. Child marker check: subagent callbacks must never claim or modify root status.
    if input.agent_id || input.agent_type {
        return Err(ClaudeHookError::SubagentIgnored);
    }

    // 2. Session ID validation.
    let session_id = input
        .session_id
        .ok_or(ClaudeHookError::MissingSessionId)?
        .trim()
        .to_string();
    if session_id.is_empty() {
        return Err(ClaudeHookError::MissingSessionId);
    }
    validate_opaque_id("session_id", &session_id).map_err(|e| {
        ClaudeHookError::InvalidIdentifier {
            field: "session_id",
            reason: e.to_string(),
        }
    })?;

    // 3. Event name normalization and qualification against Phase 01 inventory.
    let raw_event = input
        .hook_event_name
        .ok_or(ClaudeHookError::MissingEventName)?
        .trim()
        .to_string();
    let canonical_event = normalize_claude_event(&raw_event)
        .ok_or_else(|| ClaudeHookError::UnqualifiedEvent(raw_event))?;

    // 4. Validate turn and tool call IDs if present.
    let turn_id = match &input.turn_id {
        Some(t) if !t.trim().is_empty() => {
            let trimmed = t.trim().to_string();
            validate_opaque_id("turn_id", &trimmed).map_err(|e| {
                ClaudeHookError::InvalidIdentifier {
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
                ClaudeHookError::InvalidIdentifier {
                    field: "tool_call_id",
                    reason: e.to_string(),
                }
            })?;
            Some(trimmed)
        }
        _ => None,
    };

    let notification_type = match &input.notification_type {
        Some(nt) if !nt.trim().is_empty() => {
            let trimmed = nt.trim().to_string();
            validate_opaque_id("notification_type", &trimmed).map_err(|e| {
                ClaudeHookError::InvalidIdentifier {
                    field: "notification_type",
                    reason: e.to_string(),
                }
            })?;
            Some(trimmed)
        }
        _ => None,
    };

    // 5. Evaluate question candidate in PreToolUse without storing tool input or arguments.
    let is_question_candidate = canonical_event == "PreToolUse"
        && input
            .tool_name
            .as_deref()
            .is_some_and(|name| {
                name.eq_ignore_ascii_case("askuserquestion")
                    || name.eq_ignore_ascii_case("ask_user_question")
                    || name.eq_ignore_ascii_case("ask-user-question")
            });

    // 6. Map closed reason codes for qualifying blocked events.
    let reason = match canonical_event {
        "StopFailure" => Some(BlockedReason::Error),
        "Notification" => match notification_type.as_deref() {
            Some("permission_prompt") => Some(BlockedReason::Approval),
            Some("agent_needs_input") => Some(BlockedReason::Question),
            _ => None,
        },
        _ => None,
    };

    Ok(NormalizedClaudeEvent {
        canonical_event,
        session_id,
        turn_id,
        tool_call_id,
        reason,
        notification_type,
        is_question_candidate,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_claude_qualified_events_inventory() {
        assert_eq!(CLAUDE_QUALIFIED_EVENTS.len(), 12);
        assert!(!CLAUDE_QUALIFIED_EVENTS.contains(&"Interrupt"));
        assert!(CLAUDE_QUALIFIED_EVENTS.contains(&"PostToolUseFailure"));
        assert!(CLAUDE_QUALIFIED_EVENTS.contains(&"Notification"));
        assert!(CLAUDE_QUALIFIED_EVENTS.contains(&"StopFailure"));
        assert!(CLAUDE_QUALIFIED_EVENTS.contains(&"PreCompact"));
        assert!(CLAUDE_QUALIFIED_EVENTS.contains(&"PostCompact"));
    }

    #[test]
    fn test_parse_permission_prompt_notification() {
        let json = br#"{
            "hook_event_name": "Notification",
            "session_id": "sess-claude-1",
            "prompt_id": "prompt-1",
            "notification_type": "permission_prompt",
            "message": "Sensitive prompt text that must be dropped",
            "title": "Approval Required"
        }"#;

        let event = parse_and_normalize_claude_hook(json).expect("valid notification");
        assert_eq!(event.canonical_event, "Notification");
        assert_eq!(event.session_id, "sess-claude-1");
        assert_eq!(event.turn_id.as_deref(), Some("prompt-1"));
        assert_eq!(event.reason, Some(BlockedReason::Approval));
        assert_eq!(event.notification_type.as_deref(), Some("permission_prompt"));
        assert!(!event.is_question_candidate);
    }

    #[test]
    fn test_parse_agent_needs_input_notification() {
        let json = br#"{
            "hook_event_name": "Notification",
            "session_id": "sess-claude-1",
            "prompt_id": "prompt-1",
            "notification_type": "agent_needs_input"
        }"#;

        let event = parse_and_normalize_claude_hook(json).expect("valid notification");
        assert_eq!(event.canonical_event, "Notification");
        assert_eq!(event.reason, Some(BlockedReason::Question));
    }

    #[test]
    fn test_parse_stop_failure_qualifies_error() {
        let json = br#"{
            "hook_event_name": "StopFailure",
            "session_id": "sess-claude-1",
            "prompt_id": "prompt-1",
            "error_details": "Sensitive internal stack trace dropped"
        }"#;

        let event = parse_and_normalize_claude_hook(json).expect("valid stop failure");
        assert_eq!(event.canonical_event, "StopFailure");
        assert_eq!(event.reason, Some(BlockedReason::Error));
    }

    #[test]
    fn test_pre_tool_use_ask_user_question_is_candidate_only() {
        let json = br#"{
            "hook_event_name": "PreToolUse",
            "session_id": "sess-claude-1",
            "prompt_id": "prompt-1",
            "tool_use_id": "tool-1",
            "tool_name": "AskUserQuestion",
            "tool_input": { "question": "What is your preference?" }
        }"#;

        let event = parse_and_normalize_claude_hook(json).expect("valid pre-tool");
        assert_eq!(event.canonical_event, "PreToolUse");
        assert!(event.is_question_candidate);
        assert_eq!(event.reason, None); // Candidate only, no blocked reason
    }

    #[test]
    fn test_pre_tool_use_normal_tool_not_question_candidate() {
        let json = br#"{
            "hook_event_name": "PreToolUse",
            "session_id": "sess-claude-1",
            "prompt_id": "prompt-1",
            "tool_use_id": "tool-1",
            "tool_name": "Bash",
            "tool_input": { "command": "ls -la" }
        }"#;

        let event = parse_and_normalize_claude_hook(json).expect("valid pre-tool");
        assert_eq!(event.canonical_event, "PreToolUse");
        assert!(!event.is_question_candidate);
    }

    #[test]
    fn test_reject_subagent_events() {
        let json = br#"{
            "hook_event_name": "UserPromptSubmit",
            "session_id": "sess-claude-1",
            "agent_id": "child-agent-123"
        }"#;
        assert_eq!(
            parse_and_normalize_claude_hook(json),
            Err(ClaudeHookError::SubagentIgnored)
        );
    }

    #[test]
    fn test_reject_unqualified_interrupt_in_claude() {
        let json = br#"{
            "hook_event_name": "Interrupt",
            "session_id": "sess-claude-1"
        }"#;
        assert!(matches!(
            parse_and_normalize_claude_hook(json),
            Err(ClaudeHookError::UnqualifiedEvent(_))
        ));
    }
}
