use crate::workflow::enums::*;
use crate::workflow::model::{validate_note_body, WorkflowEvent, WorkflowNote};
use crate::workflow::store::error::WorkflowStoreError;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use std::str::FromStr;

pub fn row_to_note(row: &Row<'_>) -> rusqlite::Result<WorkflowNote> {
    let source_str: String = row.get(5)?;
    let source = WorkflowSource::from_str(&source_str).unwrap_or(WorkflowSource::Manual);

    Ok(WorkflowNote {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        item_id: row.get(2)?,
        session_id: row.get(3)?,
        body: row.get(4)?,
        source,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        deleted_at: row.get(8)?,
    })
}

/// Creates a new note attached to an item or session.
pub fn create_note_tx(
    tx: &Transaction<'_>,
    note: &WorkflowNote,
    event: Option<&WorkflowEvent>,
) -> Result<WorkflowNote, WorkflowStoreError> {
    validate_note_body(&note.body)?;

    if note.item_id.is_none() && note.session_id.is_none() {
        return Err(WorkflowStoreError::Validation(
            crate::workflow::model::WorkflowModelError::NoteTargetMissing,
        ));
    }

    if let Some(item_id) = &note.item_id {
        let item = super::item::get_item_tx(tx, item_id, &note.workspace_id)?
            .ok_or_else(|| WorkflowStoreError::ItemNotFound(item_id.clone()))?;
        if let Some(session_id) = &note.session_id {
            let session = super::session::get_session_tx(tx, session_id, &note.workspace_id)?
                .ok_or_else(|| WorkflowStoreError::SessionNotFound(session_id.clone()))?;
            if item.project_name != session.project_name || item.worktree_path != session.worktree_path {
                return Err(WorkflowStoreError::HierarchyViolation("Note targets differ".to_string()));
            }
        }
    }
    if let Some(session_id) = &note.session_id {
        let _ = super::session::get_session_tx(tx, session_id, &note.workspace_id)?
            .ok_or_else(|| WorkflowStoreError::SessionNotFound(session_id.clone()))?;
    }

    tx.execute(
        "INSERT INTO workflow_notes (
            id, workspace_id, item_id, session_id, body,
            source, created_at, updated_at, deleted_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            note.id,
            note.workspace_id,
            note.item_id,
            note.session_id,
            note.body,
            note.source.as_str(),
            note.created_at,
            note.updated_at,
            note.deleted_at,
        ],
    )?;

    if let Some(ev) = event {
        super::event::record_event_tx(tx, ev)?;
    }

    Ok(note.clone())
}

/// Soft-deletes a note by setting deleted_at.
pub fn soft_delete_note_tx(
    tx: &Transaction<'_>,
    id: &str,
    workspace_id: &str,
    deleted_at: u64,
    event: Option<&WorkflowEvent>,
) -> Result<bool, WorkflowStoreError> {
    let rows_affected = tx.execute(
        "UPDATE workflow_notes
         SET deleted_at = ?1, updated_at = ?1
         WHERE id = ?2 AND workspace_id = ?3 AND deleted_at IS NULL",
        params![deleted_at, id, workspace_id],
    )?;

    if rows_affected > 0 {
        if let Some(ev) = event {
            super::event::record_event_tx(tx, ev)?;
        }
        Ok(true)
    } else {
        Ok(false)
    }
}
pub fn soft_delete_note_tx_cas(tx:&Transaction<'_>,id:&str,workspace_id:&str,deleted_at:u64,expected:u64,event:Option<&WorkflowEvent>)->Result<bool,WorkflowStoreError>{let current=get_note_tx(tx,id,workspace_id)?.ok_or_else(||WorkflowStoreError::NoteNotFound(id.to_owned()))?;if current.updated_at!=expected{return Err(WorkflowStoreError::OptimisticConflict);}soft_delete_note_tx(tx,id,workspace_id,deleted_at,event)}

pub fn get_note_tx(
    tx: &Transaction<'_>,
    id: &str,
    workspace_id: &str,
) -> Result<Option<WorkflowNote>, WorkflowStoreError> {
    let mut stmt = tx.prepare(
        "SELECT id, workspace_id, item_id, session_id, body,
                source, created_at, updated_at, deleted_at
         FROM workflow_notes
         WHERE id = ?1 AND workspace_id = ?2",
    )?;

    let note = stmt
        .query_row(params![id, workspace_id], row_to_note)
        .optional()?;

    Ok(note)
}
pub fn get_note(conn: &Connection, id: &str, workspace_id: &str) -> Result<Option<WorkflowNote>, WorkflowStoreError> {
    let mut stmt = conn.prepare("SELECT id, workspace_id, item_id, session_id, body, source, created_at, updated_at, deleted_at FROM workflow_notes WHERE id = ?1 AND workspace_id = ?2")?;
    Ok(stmt.query_row(params![id, workspace_id], row_to_note).optional()?)
}

pub fn list_notes_for_item(
    conn: &Connection,
    item_id: &str,
    workspace_id: &str,
    include_deleted: bool,
) -> Result<Vec<WorkflowNote>, WorkflowStoreError> {
    let query = if include_deleted {
        "SELECT id, workspace_id, item_id, session_id, body,
                source, created_at, updated_at, deleted_at
         FROM workflow_notes
         WHERE item_id = ?1 AND workspace_id = ?2
         ORDER BY created_at ASC"
    } else {
        "SELECT id, workspace_id, item_id, session_id, body,
                source, created_at, updated_at, deleted_at
         FROM workflow_notes
         WHERE item_id = ?1 AND workspace_id = ?2 AND deleted_at IS NULL
         ORDER BY created_at ASC"
    };

    let mut stmt = conn.prepare(query)?;
    let rows = stmt.query_map(params![item_id, workspace_id], row_to_note)?;

    let mut notes = Vec::new();
    for row in rows {
        notes.push(row?);
    }
    Ok(notes)
}

pub fn list_notes_for_session(
    conn: &Connection,
    session_id: &str,
    workspace_id: &str,
    include_deleted: bool,
) -> Result<Vec<WorkflowNote>, WorkflowStoreError> {
    let query = if include_deleted {
        "SELECT id, workspace_id, item_id, session_id, body,
                source, created_at, updated_at, deleted_at
         FROM workflow_notes
         WHERE session_id = ?1 AND workspace_id = ?2
         ORDER BY created_at ASC"
    } else {
        "SELECT id, workspace_id, item_id, session_id, body,
                source, created_at, updated_at, deleted_at
         FROM workflow_notes
         WHERE session_id = ?1 AND workspace_id = ?2 AND deleted_at IS NULL
         ORDER BY created_at ASC"
    };

    let mut stmt = conn.prepare(query)?;
    let rows = stmt.query_map(params![session_id, workspace_id], row_to_note)?;

    let mut notes = Vec::new();
    for row in rows {
        notes.push(row?);
    }
    Ok(notes)
}
