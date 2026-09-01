use crate::workflow::enums::*;
use crate::workflow::model::{
    validate_item_hierarchy, validate_item_transition, validate_title, WorkflowEvent, WorkflowItem,
};
use crate::workflow::store::error::WorkflowStoreError;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use std::collections::HashSet;
use std::str::FromStr;

pub fn row_to_item(row: &Row<'_>) -> rusqlite::Result<WorkflowItem> {
    let kind_str: String = row.get(5)?;
    let status_str: String = row.get(8)?;
    let source_str: String = row.get(10)?;

    let kind = ItemKind::from_str(&kind_str).unwrap_or(ItemKind::Task);
    let status = ItemStatus::from_str(&status_str).unwrap_or(ItemStatus::Backlog);
    let source = WorkflowSource::from_str(&source_str).unwrap_or(WorkflowSource::Manual);

    Ok(WorkflowItem {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        project_name: row.get(2)?,
        worktree_path: row.get(3)?,
        parent_id: row.get(4)?,
        kind,
        title: row.get(6)?,
        summary: row.get(7)?,
        status,
        sort_order: row.get(9)?,
        source,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        completed_at: row.get(13)?,
        archived_at: row.get(14)?,
    })
}

/// Creates a new work item inside a transaction, validating hierarchy, scope, and cycles.
pub fn create_item_tx(
    tx: &Transaction<'_>,
    item: &WorkflowItem,
    event: Option<&WorkflowEvent>,
) -> Result<WorkflowItem, WorkflowStoreError> {
    validate_title(&item.title)?;

    // If request_id/event is provided and already recorded, return current item
    if let Some(ev) = event {
        let existing_event: Option<String> = tx
            .query_row(
                "SELECT id FROM workflow_events WHERE id = ?1",
                params![ev.id],
                |row| row.get(0),
            )
            .optional()?;
        if existing_event.is_some() {
            if let Some(existing_item) = get_item_tx(tx, &item.id, &item.workspace_id)? {
                return Ok(existing_item);
            }
        }
    }

    let parent_kind = if let Some(ref pid) = item.parent_id {
        let parent = get_item_tx(tx, pid, &item.workspace_id)?
            .ok_or_else(|| WorkflowStoreError::ItemNotFound(pid.clone()))?;

        if parent.project_name != item.project_name {
            return Err(WorkflowStoreError::HierarchyViolation(
                "Parent item belongs to a different project".to_string(),
            ));
        }

        // Cycle & depth validation
        let mut visited = HashSet::new();
        visited.insert(item.id.clone());
        visited.insert(pid.clone());

        let mut current_parent = parent.parent_id.clone();
        let mut depth = 2usize;

        while let Some(ancestor_id) = current_parent {
            if !visited.insert(ancestor_id.clone()) {
                return Err(WorkflowStoreError::HierarchyViolation(
                    "Hierarchy cycle detected".to_string(),
                ));
            }
            depth += 1;
            if depth > crate::workflow::MAX_HIERARCHY_DEPTH {
                return Err(WorkflowStoreError::HierarchyViolation(format!(
                    "Maximum hierarchy depth of {} exceeded",
                    crate::workflow::MAX_HIERARCHY_DEPTH
                )));
            }

            let ancestor = get_item_tx(tx, &ancestor_id, &item.workspace_id)?
                .ok_or_else(|| WorkflowStoreError::ItemNotFound(ancestor_id))?;
            current_parent = ancestor.parent_id;
        }

        Some(parent.kind)
    } else {
        None
    };

    validate_item_hierarchy(item.kind, parent_kind)?;

    let completed_at = if item.status == ItemStatus::Done {
        Some(item.updated_at)
    } else {
        item.completed_at
    };

    tx.execute(
        "INSERT INTO workflow_items (
            id, workspace_id, project_name, worktree_path, parent_id,
            kind, title, summary, status, sort_order,
            source, created_at, updated_at, completed_at, archived_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            item.id,
            item.workspace_id,
            item.project_name,
            item.worktree_path,
            item.parent_id,
            item.kind.as_str(),
            item.title,
            item.summary,
            item.status.as_str(),
            item.sort_order,
            item.source.as_str(),
            item.created_at,
            item.updated_at,
            completed_at,
            item.archived_at,
        ],
    )?;

    if let Some(ev) = event {
        super::event::record_event_tx(tx, ev)?;
    }

    let mut result = item.clone();
    result.completed_at = completed_at;
    Ok(result)
}

/// Updates an existing work item inside a transaction.
pub fn update_item_tx(
    tx: &Transaction<'_>,
    id: &str,
    workspace_id: &str,
    title: Option<&str>,
    summary: Option<Option<&str>>,
    status: Option<ItemStatus>,
    sort_order: Option<i64>,
    worktree_path: Option<Option<&str>>,
    updated_at: u64,
    event: Option<&WorkflowEvent>,
) -> Result<WorkflowItem, WorkflowStoreError> {
    let current = get_item_tx(tx, id, workspace_id)?
        .ok_or_else(|| WorkflowStoreError::ItemNotFound(id.to_string()))?;

    let new_title = if let Some(t) = title {
        validate_title(t)?;
        t.trim().to_string()
    } else {
        current.title
    };

    let new_summary = match summary {
        Some(s) => s.map(|v| v.to_string()),
        None => current.summary,
    };

    let (new_status, completed_at) = if let Some(target_status) = status {
        validate_item_transition(current.status, target_status)?;
        let comp = match target_status {
            ItemStatus::Done => Some(updated_at),
            _ => None,
        };
        (target_status, comp)
    } else {
        (current.status, current.completed_at)
    };

    let new_sort_order = sort_order.unwrap_or(current.sort_order);
    let new_worktree = match worktree_path {
        Some(wt) => wt.map(|v| v.to_string()),
        None => current.worktree_path,
    };

    tx.execute(
        "UPDATE workflow_items
         SET title = ?1, summary = ?2, status = ?3, sort_order = ?4,
             worktree_path = ?5, updated_at = ?6, completed_at = ?7
         WHERE id = ?8 AND workspace_id = ?9",
        params![
            new_title,
            new_summary,
            new_status.as_str(),
            new_sort_order,
            new_worktree,
            updated_at,
            completed_at,
            id,
            workspace_id,
        ],
    )?;

    if let Some(ev) = event {
        super::event::record_event_tx(tx, ev)?;
    }

    Ok(WorkflowItem {
        id: id.to_string(),
        workspace_id: workspace_id.to_string(),
        project_name: current.project_name,
        worktree_path: new_worktree,
        parent_id: current.parent_id,
        kind: current.kind,
        title: new_title,
        summary: new_summary,
        status: new_status,
        sort_order: new_sort_order,
        source: current.source,
        created_at: current.created_at,
        updated_at,
        completed_at,
        archived_at: current.archived_at,
    })
}

/// Retrieves a single work item by ID and workspace.
pub fn get_item_tx(
    tx: &Transaction<'_>,
    id: &str,
    workspace_id: &str,
) -> Result<Option<WorkflowItem>, WorkflowStoreError> {
    let mut stmt = tx.prepare(
        "SELECT id, workspace_id, project_name, worktree_path, parent_id,
                kind, title, summary, status, sort_order,
                source, created_at, updated_at, completed_at, archived_at
         FROM workflow_items
         WHERE id = ?1 AND workspace_id = ?2",
    )?;

    let item = stmt
        .query_row(params![id, workspace_id], row_to_item)
        .optional()?;

    Ok(item)
}

/// Retrieves a single work item by ID and workspace using connection.
pub fn get_item(
    conn: &Connection,
    id: &str,
    workspace_id: &str,
) -> Result<Option<WorkflowItem>, WorkflowStoreError> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, project_name, worktree_path, parent_id,
                kind, title, summary, status, sort_order,
                source, created_at, updated_at, completed_at, archived_at
         FROM workflow_items
         WHERE id = ?1 AND workspace_id = ?2",
    )?;

    let item = stmt
        .query_row(params![id, workspace_id], row_to_item)
        .optional()?;

    Ok(item)
}

/// Lists items for a workspace, optionally filtered by project and status.
pub fn list_items(
    conn: &Connection,
    workspace_id: &str,
    project_name: Option<&str>,
    status: Option<ItemStatus>,
    limit: usize,
) -> Result<Vec<WorkflowItem>, WorkflowStoreError> {
    let limit = limit.min(crate::workflow::MAX_OVERVIEW_ITEMS + 1);
    let mut query = String::from(
        "SELECT id, workspace_id, project_name, worktree_path, parent_id,
                kind, title, summary, status, sort_order,
                source, created_at, updated_at, completed_at, archived_at
         FROM workflow_items
         WHERE workspace_id = ?1",
    );

    if project_name.is_some() {
        query.push_str(" AND project_name = ?2");
    }
    if status.is_some() {
        if project_name.is_some() {
            query.push_str(" AND status = ?3");
        } else {
            query.push_str(" AND status = ?2");
        }
    }
    query.push_str(" ORDER BY sort_order ASC, updated_at DESC LIMIT ");
    query.push_str(&limit.to_string());

    let mut stmt = conn.prepare(&query)?;
    let rows = match (project_name, status) {
        (Some(p), Some(s)) => {
            stmt.query_map(params![workspace_id, p, s.as_str()], row_to_item)?
        }
        (Some(p), None) => stmt.query_map(params![workspace_id, p], row_to_item)?,
        (None, Some(s)) => stmt.query_map(params![workspace_id, s.as_str()], row_to_item)?,
        (None, None) => stmt.query_map(params![workspace_id], row_to_item)?,
    };

    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

/// Deletes a work item and its descendant hierarchy.
pub fn delete_item_tx(
    tx: &Transaction<'_>,
    id: &str,
    workspace_id: &str,
    event: Option<&WorkflowEvent>,
) -> Result<bool, WorkflowStoreError> {
    let rows_affected = tx.execute(
        "DELETE FROM workflow_items WHERE id = ?1 AND workspace_id = ?2",
        params![id, workspace_id],
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
