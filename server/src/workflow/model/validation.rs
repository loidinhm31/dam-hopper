use super::enums::*;
use crate::workflow::{
    MAX_EVENT_PAYLOAD_BYTES, MAX_EXTERNAL_ID_CHARS, MAX_HARNESS_LABEL_CHARS, MAX_NOTE_BYTES,
    MAX_RUN_ID_CHARS, MAX_TITLE_CHARS,
};

/// Validates item title length and non-emptiness.
pub fn validate_title(title: &str) -> Result<(), WorkflowModelError> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err(WorkflowModelError::TitleEmpty);
    }
    let char_count = trimmed.chars().count();
    if char_count > MAX_TITLE_CHARS {
        return Err(WorkflowModelError::TitleTooLong {
            actual: char_count,
            max: MAX_TITLE_CHARS,
        });
    }
    Ok(())
}

/// Validates note body size and non-emptiness.
pub fn validate_note_body(body: &str) -> Result<(), WorkflowModelError> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return Err(WorkflowModelError::NoteEmpty);
    }
    let byte_count = body.len();
    if byte_count > MAX_NOTE_BYTES {
        return Err(WorkflowModelError::NoteTooLong {
            actual: byte_count,
            max: MAX_NOTE_BYTES,
        });
    }
    Ok(())
}

/// Validates external resource ID length and non-emptiness.
pub fn validate_external_id(id: &str) -> Result<(), WorkflowModelError> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err(WorkflowModelError::ExternalIdEmpty);
    }
    let char_count = trimmed.chars().count();
    if char_count > MAX_EXTERNAL_ID_CHARS {
        return Err(WorkflowModelError::ExternalIdTooLong {
            actual: char_count,
            max: MAX_EXTERNAL_ID_CHARS,
        });
    }
    Ok(())
}

/// Validates event payload JSON size.
pub fn validate_event_payload(payload: &str) -> Result<(), WorkflowModelError> {
    let byte_count = payload.len();
    if byte_count > MAX_EVENT_PAYLOAD_BYTES {
        return Err(WorkflowModelError::PayloadTooLong {
            actual: byte_count,
            max: MAX_EVENT_PAYLOAD_BYTES,
        });
    }
    Ok(())
}

/// Validates agent harness label length.
pub fn validate_harness_label(label: &str) -> Result<(), WorkflowModelError> {
    let char_count = label.chars().count();
    if char_count > MAX_HARNESS_LABEL_CHARS {
        return Err(WorkflowModelError::HarnessLabelTooLong {
            actual: char_count,
            max: MAX_HARNESS_LABEL_CHARS,
        });
    }
    Ok(())
}

/// Validates agent run ID length.
pub fn validate_run_id(id: &str) -> Result<(), WorkflowModelError> {
    let char_count = id.chars().count();
    if char_count > MAX_RUN_ID_CHARS {
        return Err(WorkflowModelError::RunIdTooLong {
            actual: char_count,
            max: MAX_RUN_ID_CHARS,
        });
    }
    Ok(())
}

/// Validates state transitions for work items.
///
/// Rules:
/// - Backlog <-> Next
/// - Backlog / Next -> InProgress, Canceled
/// - InProgress -> Blocked, Done, Canceled, Backlog, Next
/// - Blocked -> InProgress, Canceled
/// - Done -> InProgress (reopen)
/// - Canceled -> InProgress (reopen)
/// - Self-transitions are valid no-ops.
pub fn validate_item_transition(
    current: ItemStatus,
    target: ItemStatus,
) -> Result<(), WorkflowModelError> {
    if current == target {
        return Ok(());
    }

    let allowed = match current {
        ItemStatus::Backlog => matches!(
            target,
            ItemStatus::Next | ItemStatus::InProgress | ItemStatus::Canceled
        ),
        ItemStatus::Next => matches!(
            target,
            ItemStatus::Backlog | ItemStatus::InProgress | ItemStatus::Canceled
        ),
        ItemStatus::InProgress => matches!(
            target,
            ItemStatus::Blocked
                | ItemStatus::Done
                | ItemStatus::Canceled
                | ItemStatus::Backlog
                | ItemStatus::Next
        ),
        ItemStatus::Blocked => matches!(target, ItemStatus::InProgress | ItemStatus::Canceled),
        ItemStatus::Done => matches!(target, ItemStatus::InProgress),
        ItemStatus::Canceled => matches!(target, ItemStatus::InProgress),
    };

    if allowed {
        Ok(())
    } else {
        Err(WorkflowModelError::InvalidItemTransition {
            from: current,
            to: target,
        })
    }
}

/// Validates state transitions for work sessions.
///
/// Rules:
/// - Running -> Ended, Abandoned
/// - Ended / Abandoned are terminal; self-transition is permitted as an idempotent no-op.
pub fn validate_session_transition(
    current: SessionStatus,
    target: SessionStatus,
) -> Result<(), WorkflowModelError> {
    if current == target {
        return Ok(());
    }

    let allowed = match current {
        SessionStatus::Running => {
            matches!(target, SessionStatus::Ended | SessionStatus::Abandoned)
        }
        SessionStatus::Ended | SessionStatus::Abandoned => false,
    };

    if allowed {
        Ok(())
    } else {
        Err(WorkflowModelError::InvalidSessionTransition {
            from: current,
            to: target,
        })
    }
}

/// Validates Plan-first hierarchy constraints for an item given its kind and parent kind.
///
/// Rules:
/// - Plan must NOT have a parent.
/// - Phase MUST have a Plan parent.
/// - Task may have NO parent (standalone), a Plan parent, or a Phase parent.
/// - Task cannot have a Task parent.
pub fn validate_item_hierarchy(
    kind: ItemKind,
    parent_kind: Option<ItemKind>,
) -> Result<(), WorkflowModelError> {
    match kind {
        ItemKind::Plan => {
            if parent_kind.is_some() {
                return Err(WorkflowModelError::InvalidParentKind {
                    child_kind: kind,
                    parent_kind,
                });
            }
        }
        ItemKind::Phase => {
            if parent_kind != Some(ItemKind::Plan) {
                return Err(WorkflowModelError::InvalidParentKind {
                    child_kind: kind,
                    parent_kind,
                });
            }
        }
        ItemKind::Task => match parent_kind {
            None | Some(ItemKind::Plan) | Some(ItemKind::Phase) => {}
            Some(ItemKind::Task) => {
                return Err(WorkflowModelError::InvalidParentKind {
                    child_kind: kind,
                    parent_kind,
                });
            }
        },
    }
    Ok(())
}

/// Validates timestamp ordering for work sessions.
pub fn validate_timestamps(
    started_at: u64,
    ended_at: Option<u64>,
) -> Result<(), WorkflowModelError> {
    if let Some(ended) = ended_at {
        if started_at > ended {
            return Err(WorkflowModelError::InvalidTimestampOrder {
                started_at,
                ended_at: ended,
            });
        }
    }
    Ok(())
}
