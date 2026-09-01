use crate::workflow::enums::*;
use crate::workflow::model::{validate_event_payload, WorkflowEvent};
use crate::workflow::store::error::WorkflowStoreError;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use std::str::FromStr;

pub fn row_to_event(row: &Row<'_>) -> rusqlite::Result<WorkflowEvent> {
    let type_str: String = row.get(2)?;
    let source_str: String = row.get(3)?;

    let event_type =
        WorkflowEventType::from_str(&type_str).unwrap_or(WorkflowEventType::ItemCreated);
    let source = WorkflowSource::from_str(&source_str).unwrap_or(WorkflowSource::Manual);

    Ok(WorkflowEvent {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        event_type,
        source,
        project_name: row.get(4)?,
        worktree_path: row.get(5)?,
        item_id: row.get(6)?,
        session_id: row.get(7)?,
        occurred_at: row.get(8)?,
        recorded_at: row.get(9)?,
        payload_json: row.get(10)?,
        expires_at: row.get(11)?,
    })
}

/// Records an activity event inside a transaction (idempotent via INSERT OR IGNORE).
pub fn record_event_tx(
    tx: &Transaction<'_>,
    event: &WorkflowEvent,
) -> Result<(), WorkflowStoreError> {
    if let Some(ref payload) = event.payload_json {
        validate_event_payload(payload)?;
    }

    tx.execute(
        "INSERT OR IGNORE INTO workflow_events (
            id, workspace_id, event_type, source, project_name, worktree_path,
            item_id, session_id, occurred_at, recorded_at, payload_json, expires_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            event.id,
            event.workspace_id,
            event.event_type.as_str(),
            event.source.as_str(),
            event.project_name,
            event.worktree_path,
            event.item_id,
            event.session_id,
            event.occurred_at,
            event.recorded_at,
            event.payload_json,
            event.expires_at,
        ],
    )?;

    Ok(())
}
pub fn get_event(conn: &Connection, id: &str, workspace_id: &str) -> Result<Option<WorkflowEvent>, WorkflowStoreError> {
    let mut stmt = conn.prepare("SELECT id, workspace_id, event_type, source, project_name, worktree_path, item_id, session_id, occurred_at, recorded_at, payload_json, expires_at FROM workflow_events WHERE id = ?1 AND workspace_id = ?2")?;
    Ok(stmt.query_row(params![id, workspace_id], row_to_event).optional()?)
}

/// Lists activity events using keyset pagination (recorded_at DESC, id DESC).
pub fn list_events_keyset(
    conn: &Connection,
    workspace_id: &str,
    cursor_recorded_at: Option<u64>,
    cursor_id: Option<&str>,
    limit: usize,
) -> Result<Vec<WorkflowEvent>, WorkflowStoreError> {
    let limit = limit.clamp(1, crate::workflow::MAX_HISTORY_LIMIT + 1);

    let (query, has_cursor) = match (cursor_recorded_at, cursor_id) {
        (Some(_), Some(_)) => (
            "SELECT id, workspace_id, event_type, source, project_name, worktree_path,
                    item_id, session_id, occurred_at, recorded_at, payload_json, expires_at
             FROM workflow_events
             WHERE workspace_id = ?1 AND (recorded_at < ?2 OR (recorded_at = ?2 AND id < ?3))
             ORDER BY recorded_at DESC, id DESC
             LIMIT ?4",
            true,
        ),
        _ => (
            "SELECT id, workspace_id, event_type, source, project_name, worktree_path,
                    item_id, session_id, occurred_at, recorded_at, payload_json, expires_at
             FROM workflow_events
             WHERE workspace_id = ?1
             ORDER BY recorded_at DESC, id DESC
             LIMIT ?2",
            false,
        ),
    };

    let mut stmt = conn.prepare(query)?;
    let rows = if has_cursor {
        let rec_at = cursor_recorded_at.unwrap();
        let cid = cursor_id.unwrap();
        stmt.query_map(
            params![workspace_id, rec_at, cid, limit as i64],
            row_to_event,
        )?
    } else {
        stmt.query_map(params![workspace_id, limit as i64], row_to_event)?
    };

    let mut events = Vec::new();
    for row in rows {
        events.push(row?);
    }
    Ok(events)
}

/// Purges expired events bounded by a batch limit.
pub fn purge_expired_events(
    conn: &mut Connection,
    workspace_id: &str,
    now_ms: u64,
    batch_limit: usize,
) -> Result<usize, WorkflowStoreError> {
    let tx = conn.transaction()?;
    let count = tx.execute(
        "DELETE FROM workflow_events
         WHERE id IN (
             SELECT id FROM workflow_events
             WHERE workspace_id = ?1 AND expires_at IS NOT NULL AND expires_at <= ?2
             LIMIT ?3
         )",
        params![workspace_id, now_ms, batch_limit as i64],
    )?;
    tx.commit()?;
    Ok(count)
}

/// Purges soft-deleted notes older than a retention timestamp, bounded by a batch limit.
pub fn purge_soft_deleted_notes(
    conn: &mut Connection,
    workspace_id: &str,
    older_than_ms: u64,
    batch_limit: usize,
) -> Result<usize, WorkflowStoreError> {
    let tx = conn.transaction()?;
    let count = tx.execute(
        "DELETE FROM workflow_notes
         WHERE id IN (
             SELECT id FROM workflow_notes
             WHERE workspace_id = ?1 AND deleted_at IS NOT NULL AND deleted_at <= ?2
             LIMIT ?3
         )",
        params![workspace_id, older_than_ms, batch_limit as i64],
    )?;
    tx.commit()?;
    Ok(count)
}
