use crate::workflow::model::WorkflowWorkspace;
use crate::workflow::store::error::WorkflowStoreError;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

/// Gets or creates a workspace record mapped to a canonical config locator.
pub fn get_or_create_workspace(
    conn: &mut Connection,
    locator: &str,
    name: &str,
    now_ms: u64,
) -> Result<WorkflowWorkspace, WorkflowStoreError> {
    if let Some(existing) = get_workspace_by_locator(conn, locator)? {
        return Ok(existing);
    }

    let id = Uuid::new_v4().to_string();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO workflow_workspaces (id, locator, name, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, locator, name, now_ms],
    )?;
    tx.commit()?;

    Ok(WorkflowWorkspace {
        id,
        locator: locator.to_string(),
        name: name.to_string(),
        created_at: now_ms,
        updated_at: now_ms,
    })
}

/// Retrieves a workspace by its UUID.
pub fn get_workspace_by_id(
    conn: &Connection,
    id: &str,
) -> Result<Option<WorkflowWorkspace>, WorkflowStoreError> {
    let mut stmt = conn.prepare(
        "SELECT id, locator, name, created_at, updated_at
         FROM workflow_workspaces
         WHERE id = ?1",
    )?;

    let ws = stmt
        .query_row(params![id], |row| {
            Ok(WorkflowWorkspace {
                id: row.get(0)?,
                locator: row.get(1)?,
                name: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .optional()?;

    Ok(ws)
}

/// Retrieves a workspace by its canonical locator path.
pub fn get_workspace_by_locator(
    conn: &Connection,
    locator: &str,
) -> Result<Option<WorkflowWorkspace>, WorkflowStoreError> {
    let mut stmt = conn.prepare(
        "SELECT id, locator, name, created_at, updated_at
         FROM workflow_workspaces
         WHERE locator = ?1",
    )?;

    let ws = stmt
        .query_row(params![locator], |row| {
            Ok(WorkflowWorkspace {
                id: row.get(0)?,
                locator: row.get(1)?,
                name: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .optional()?;

    Ok(ws)
}
