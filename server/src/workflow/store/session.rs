use crate::workflow::enums::*;
use crate::workflow::model::{
    validate_external_id, validate_harness_label, validate_run_id, validate_session_transition,
    validate_timestamps, WorkflowEvent, WorkflowResourceLink, WorkflowSession,
};
use crate::workflow::store::error::WorkflowStoreError;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use std::str::FromStr;

pub fn row_to_session(row: &Row<'_>) -> rusqlite::Result<WorkflowSession> {
    let status_str: String = row.get(5)?;
    let source_str: String = row.get(8)?;

    let status = SessionStatus::from_str(&status_str).unwrap_or(SessionStatus::Running);
    let source = WorkflowSource::from_str(&source_str).unwrap_or(WorkflowSource::Manual);

    Ok(WorkflowSession {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        project_name: row.get(2)?,
        worktree_path: row.get(3)?,
        item_id: row.get(4)?,
        status,
        started_at: row.get(6)?,
        ended_at: row.get(7)?,
        source,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

pub fn row_to_link(row: &Row<'_>) -> rusqlite::Result<WorkflowResourceLink> {
    let rtype_str: String = row.get(2)?;
    let state_str: String = row.get(7)?;
    let source_str: String = row.get(11)?;

    let resource_type =
        ResourceLinkType::from_str(&rtype_str).unwrap_or(ResourceLinkType::Terminal);
    let observed_state =
        ResourceObservedState::from_str(&state_str).unwrap_or(ResourceObservedState::Attached);
    let link_source = WorkflowSource::from_str(&source_str).unwrap_or(WorkflowSource::Manual);

    Ok(WorkflowResourceLink {
        id: row.get(0)?,
        session_id: row.get(1)?,
        resource_type,
        external_id: row.get(3)?,
        incarnation: row.get(4)?,
        harness_label: row.get(5)?,
        run_id: row.get(6)?,
        observed_state,
        suggested_end_time: row.get(8)?,
        first_seen_at: row.get(9)?,
        last_seen_at: row.get(10)?,
        link_source,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

/// Starts a new work session inside a transaction.
pub fn start_session_tx(
    tx: &Transaction<'_>,
    session: &WorkflowSession,
    link: Option<&WorkflowResourceLink>,
    event: Option<&WorkflowEvent>,
) -> Result<WorkflowSession, WorkflowStoreError> {
    validate_timestamps(session.started_at, session.ended_at)?;
    if let Some(item_id) = &session.item_id {
        let item = super::item::get_item_tx(tx, item_id, &session.workspace_id)?
            .ok_or_else(|| WorkflowStoreError::ItemNotFound(item_id.clone()))?;
        if item.project_name != session.project_name || item.worktree_path != session.worktree_path {
            return Err(WorkflowStoreError::HierarchyViolation(
                "Session target does not match item target".to_string(),
            ));
        }
    }
    tx.execute(
        "INSERT INTO workflow_sessions (
            id, workspace_id, project_name, worktree_path, item_id,
            status, started_at, ended_at, source, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            session.id,
            session.workspace_id,
            session.project_name,
            session.worktree_path,
            session.item_id,
            session.status.as_str(),
            session.started_at,
            session.ended_at,
            session.source.as_str(),
            session.created_at,
            session.updated_at,
        ],
    )?;

    if let Some(l) = link {
        link_resource_tx(tx, l, None)?;
    }

    if let Some(ev) = event {
        super::event::record_event_tx(tx, ev)?;
    }

    Ok(session.clone())
}

/// Updates session status (ended, abandoned) with manual timestamps.
pub fn update_session_status_tx(
    tx: &Transaction<'_>,
    id: &str,
    workspace_id: &str,
    new_status: SessionStatus,
    ended_at: Option<u64>,
    updated_at: u64,
    event: Option<&WorkflowEvent>,
) -> Result<WorkflowSession, WorkflowStoreError> {
    let current = get_session_tx(tx, id, workspace_id)?
        .ok_or_else(|| WorkflowStoreError::SessionNotFound(id.to_string()))?;

    validate_session_transition(current.status, new_status)?;

    let final_ended_at = match (new_status, ended_at) {
        (SessionStatus::Running, _) => None,
        (SessionStatus::Ended, Some(e)) => {
            validate_timestamps(current.started_at, Some(e))?;
            Some(e)
        }
        (SessionStatus::Ended, None) => current.ended_at,
        (SessionStatus::Abandoned, supplied) => supplied.or(current.ended_at),
    };

    let updated_at = updated_at.max(current.updated_at.saturating_add(1));
    tx.execute(
        "UPDATE workflow_sessions
         SET status = ?1, ended_at = ?2, updated_at = ?3
         WHERE id = ?4 AND workspace_id = ?5",
        params![
            new_status.as_str(),
            final_ended_at,
            updated_at,
            id,
            workspace_id,
        ],
    )?;

    if let Some(ev) = event {
        super::event::record_event_tx(tx, ev)?;
    }

    Ok(WorkflowSession {
        id: id.to_string(),
        workspace_id: workspace_id.to_string(),
        project_name: current.project_name,
        worktree_path: current.worktree_path,
        item_id: current.item_id,
        status: new_status,
        started_at: current.started_at,
        ended_at: final_ended_at,
        source: current.source,
        created_at: current.created_at,
        updated_at,
    })
}

/// Links an external resource (terminal or agent) to a session.
pub fn link_resource_tx(
    tx: &Transaction<'_>,
    link: &WorkflowResourceLink,
    event: Option<&WorkflowEvent>,
) -> Result<WorkflowResourceLink, WorkflowStoreError> {
    validate_external_id(&link.external_id)?;
    if let Some(label) = &link.harness_label {
        validate_harness_label(label)?;
    }
    if let Some(run_id) = &link.run_id {
        validate_run_id(run_id)?;
    }

    tx.execute(
        "INSERT INTO workflow_resource_links (
            id, session_id, resource_type, external_id, incarnation,
            harness_label, run_id, observed_state, suggested_end_time,
            first_seen_at, last_seen_at, link_source, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
        ON CONFLICT(session_id, resource_type, external_id) DO UPDATE SET
            incarnation = excluded.incarnation,
            harness_label = excluded.harness_label,
            run_id = excluded.run_id,
            observed_state = excluded.observed_state,
            suggested_end_time = excluded.suggested_end_time,
            last_seen_at = excluded.last_seen_at,
            updated_at = excluded.updated_at",
        params![
            link.id,
            link.session_id,
            link.resource_type.as_str(),
            link.external_id,
            link.incarnation,
            link.harness_label,
            link.run_id,
            link.observed_state.as_str(),
            link.suggested_end_time,
            link.first_seen_at,
            link.last_seen_at,
            link.link_source.as_str(),
            link.created_at,
            link.updated_at,
        ],
    )?;

    if let Some(ev) = event {
        super::event::record_event_tx(tx, ev)?;
    }

    Ok(link.clone())
}

/// Updates observation state and suggested end time for an external resource link.
/// CRITICAL: Never touches session status, started_at, or ended_at.
pub fn update_resource_observation_tx(
    tx: &Transaction<'_>,
    session_id: &str,
    resource_type: ResourceLinkType,
    external_id: &str,
    observed_state: ResourceObservedState,
    suggested_end_time: Option<u64>,
    observed_at: u64,
    event: Option<&WorkflowEvent>,
) -> Result<Option<WorkflowResourceLink>, WorkflowStoreError> {
    let rows_affected = tx.execute(
        "UPDATE workflow_resource_links
         SET observed_state = ?1, suggested_end_time = ?2, last_seen_at = ?3, updated_at = ?3
         WHERE session_id = ?4 AND resource_type = ?5 AND external_id = ?6",
        params![
            observed_state.as_str(),
            suggested_end_time,
            observed_at,
            session_id,
            resource_type.as_str(),
            external_id,
        ],
    )?;

    if rows_affected > 0 {
        if let Some(ev) = event {
            super::event::record_event_tx(tx, ev)?;
        }
        let link = get_link_tx(tx, session_id, resource_type, external_id)?;
        Ok(link)
    } else {
        Ok(None)
    }
}

/// Unlinks a resource from a session.
pub fn unlink_resource_tx(
    tx: &Transaction<'_>,
    session_id: &str,
    resource_type: ResourceLinkType,
    external_id: &str,
    event: Option<&WorkflowEvent>,
) -> Result<bool, WorkflowStoreError> {
    let rows_affected = tx.execute(
        "DELETE FROM workflow_resource_links
         WHERE session_id = ?1 AND resource_type = ?2 AND external_id = ?3",
        params![session_id, resource_type.as_str(), external_id],
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

pub fn get_session_tx(
    tx: &Transaction<'_>,
    id: &str,
    workspace_id: &str,
) -> Result<Option<WorkflowSession>, WorkflowStoreError> {
    let mut stmt = tx.prepare(
        "SELECT id, workspace_id, project_name, worktree_path, item_id,
                status, started_at, ended_at, source, created_at, updated_at
         FROM workflow_sessions
         WHERE id = ?1 AND workspace_id = ?2",
    )?;

    let session = stmt
        .query_row(params![id, workspace_id], row_to_session)
        .optional()?;

    Ok(session)
}

pub fn get_session(
    conn: &Connection,
    id: &str,
    workspace_id: &str,
) -> Result<Option<WorkflowSession>, WorkflowStoreError> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, project_name, worktree_path, item_id,
                status, started_at, ended_at, source, created_at, updated_at
         FROM workflow_sessions
         WHERE id = ?1 AND workspace_id = ?2",
    )?;

    let session = stmt
        .query_row(params![id, workspace_id], row_to_session)
        .optional()?;

    Ok(session)
}

pub fn get_link_tx(
    tx: &Transaction<'_>,
    session_id: &str,
    resource_type: ResourceLinkType,
    external_id: &str,
) -> Result<Option<WorkflowResourceLink>, WorkflowStoreError> {
    let mut stmt = tx.prepare(
        "SELECT id, session_id, resource_type, external_id, incarnation,
                harness_label, run_id, observed_state, suggested_end_time,
                first_seen_at, last_seen_at, link_source, created_at, updated_at
         FROM workflow_resource_links
         WHERE session_id = ?1 AND resource_type = ?2 AND external_id = ?3",
    )?;

    let link = stmt
        .query_row(
            params![session_id, resource_type.as_str(), external_id],
            row_to_link,
        )
        .optional()?;

    Ok(link)
}

pub fn get_links_for_session(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<WorkflowResourceLink>, WorkflowStoreError> {
    let mut stmt = conn.prepare(
        "SELECT id, session_id, resource_type, external_id, incarnation,
                harness_label, run_id, observed_state, suggested_end_time,
                first_seen_at, last_seen_at, link_source, created_at, updated_at
         FROM workflow_resource_links
         WHERE session_id = ?1",
    )?;

    let rows = stmt.query_map(params![session_id], row_to_link)?;
    let mut links = Vec::new();
    for row in rows {
        links.push(row?);
    }
    Ok(links)
}

pub fn list_active_sessions(
    conn: &Connection,
    workspace_id: &str,
    project_name: Option<&str>,
    limit: usize,
) -> Result<Vec<WorkflowSession>, WorkflowStoreError> {
    let limit = limit.min(crate::workflow::MAX_OVERVIEW_SESSIONS);
    let mut query = String::from(
        "SELECT id, workspace_id, project_name, worktree_path, item_id,
                status, started_at, ended_at, source, created_at, updated_at
         FROM workflow_sessions
         WHERE workspace_id = ?1 AND status = 'running'",
    );

    if project_name.is_some() {
        query.push_str(" AND project_name = ?2");
    }
    query.push_str(" ORDER BY updated_at DESC LIMIT ");
    query.push_str(&limit.to_string());

    let mut stmt = conn.prepare(&query)?;
    let rows = match project_name {
        Some(p) => stmt.query_map(params![workspace_id, p], row_to_session)?,
        None => stmt.query_map(params![workspace_id], row_to_session)?,
    };

    let mut sessions = Vec::new();
    for row in rows {
        sessions.push(row?);
    }
    Ok(sessions)
}

pub fn get_session_by_id_tx(
    tx: &Transaction<'_>,
    id: &str,
) -> Result<Option<WorkflowSession>, WorkflowStoreError> {
    let mut stmt = tx.prepare(
        "SELECT id, workspace_id, project_name, worktree_path, item_id,
                status, started_at, ended_at, source, created_at, updated_at
         FROM workflow_sessions
         WHERE id = ?1",
    )?;

    let session = stmt.query_row(params![id], row_to_session).optional()?;
    Ok(session)
}

pub fn get_session_by_id(
    conn: &Connection,
    id: &str,
) -> Result<Option<WorkflowSession>, WorkflowStoreError> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, project_name, worktree_path, item_id,
                status, started_at, ended_at, source, created_at, updated_at
         FROM workflow_sessions
         WHERE id = ?1",
    )?;

    let session = stmt.query_row(params![id], row_to_session).optional()?;
    Ok(session)
}

pub fn find_links_by_external_id_tx(
    tx: &Transaction<'_>,
    resource_type: ResourceLinkType,
    external_id: &str,
) -> Result<Vec<WorkflowResourceLink>, WorkflowStoreError> {
    let mut stmt = tx.prepare(
        "SELECT id, session_id, resource_type, external_id, incarnation,
                harness_label, run_id, observed_state, suggested_end_time,
                first_seen_at, last_seen_at, link_source, created_at, updated_at
         FROM workflow_resource_links
         WHERE resource_type = ?1 AND external_id = ?2",
    )?;

    let rows = stmt.query_map(params![resource_type.as_str(), external_id], row_to_link)?;
    let mut links = Vec::new();
    for row in rows {
        links.push(row?);
    }
    Ok(links)
}

pub fn find_links_by_external_id(
    conn: &Connection,
    resource_type: ResourceLinkType,
    external_id: &str,
) -> Result<Vec<WorkflowResourceLink>, WorkflowStoreError> {
    let mut stmt = conn.prepare(
        "SELECT id, session_id, resource_type, external_id, incarnation,
                harness_label, run_id, observed_state, suggested_end_time,
                first_seen_at, last_seen_at, link_source, created_at, updated_at
         FROM workflow_resource_links
         WHERE resource_type = ?1 AND external_id = ?2",
    )?;

    let rows = stmt.query_map(params![resource_type.as_str(), external_id], row_to_link)?;
    let mut links = Vec::new();
    for row in rows {
        links.push(row?);
    }
    Ok(links)
}

pub fn list_all_links_by_type(
    conn: &Connection,
    resource_type: ResourceLinkType,
) -> Result<Vec<WorkflowResourceLink>, WorkflowStoreError> {
    let mut stmt = conn.prepare(
        "SELECT id, session_id, resource_type, external_id, incarnation,
                harness_label, run_id, observed_state, suggested_end_time,
                first_seen_at, last_seen_at, link_source, created_at, updated_at
         FROM workflow_resource_links
         WHERE resource_type = ?1",
    )?;

    let rows = stmt.query_map(params![resource_type.as_str()], row_to_link)?;
    let mut links = Vec::new();
    for row in rows {
        links.push(row?);
    }
    Ok(links)
}
