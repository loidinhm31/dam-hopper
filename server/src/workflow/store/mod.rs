pub mod error;
pub mod event;
pub mod item;
pub mod note;
pub mod overview;
pub mod session;
pub mod workspace;

pub use error::WorkflowStoreError;

use crate::workflow::model::*;
use rusqlite::{params, Connection};
use std::sync::{Arc, Mutex};

/// Thread-safe storage repository for workflow tracking entities.
#[derive(Clone)]
pub struct WorkflowStore {
    conn: Arc<Mutex<Connection>>,
}

impl WorkflowStore {
    /// Creates a new `WorkflowStore` wrapping a shared SQLite connection.
    pub fn new(conn: Arc<Mutex<Connection>>) -> Self {
        Self { conn }
    }

    /// Acquires the internal SQLite mutex for operations.
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>, WorkflowStoreError> {
        self.conn.lock().map_err(|_| {
            WorkflowStoreError::Sqlite(rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(1),
                Some("Failed to acquire SQLite mutex lock".to_string()),
            ))
        })
    }

    // -----------------------------------------------------------------------
    // Workspaces
    // -----------------------------------------------------------------------

    pub fn get_or_create_workspace(
        &self,
        locator: &str,
        name: &str,
        now_ms: u64,
    ) -> Result<WorkflowWorkspace, WorkflowStoreError> {
        let mut conn = self.lock()?;
        workspace::get_or_create_workspace(&mut conn, locator, name, now_ms)
    }

    pub fn get_workspace_by_id(
        &self,
        id: &str,
    ) -> Result<Option<WorkflowWorkspace>, WorkflowStoreError> {
        let conn = self.lock()?;
        workspace::get_workspace_by_id(&conn, id)
    }

    pub fn get_workspace_by_locator(
        &self,
        locator: &str,
    ) -> Result<Option<WorkflowWorkspace>, WorkflowStoreError> {
        let conn = self.lock()?;
        workspace::get_workspace_by_locator(&conn, locator)
    }

    // -----------------------------------------------------------------------
    // Work Items
    // -----------------------------------------------------------------------

    pub fn create_item(
        &self,
        item: &WorkflowItem,
        event: Option<&WorkflowEvent>,
    ) -> Result<WorkflowItem, WorkflowStoreError> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let result = item::create_item_tx(&tx, item, event)?;
        tx.commit()?;
        Ok(result)
    }

    pub fn update_item(
        &self,
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
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let result = item::update_item_tx(
            &tx,
            id,
            workspace_id,
            title,
            summary,
            status,
            sort_order,
            worktree_path,
            updated_at,
            event,
        )?;
        tx.commit()?;
        Ok(result)
    }
    pub fn update_item_cas(
        &self, id: &str, workspace_id: &str, title: Option<&str>,
        summary: Option<Option<&str>>, status: Option<ItemStatus>, sort_order: Option<i64>,
        worktree_path: Option<Option<&str>>, updated_at: u64, expected_updated_at: u64,
        event: Option<&WorkflowEvent>,
    ) -> Result<WorkflowItem, WorkflowStoreError> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let result = item::update_item_tx_cas(&tx,id,workspace_id,title,summary,status,sort_order,worktree_path,updated_at,Some(expected_updated_at),event)?;
        tx.commit()?;
        Ok(result)
    }

    pub fn get_item(
        &self,
        id: &str,
        workspace_id: &str,
    ) -> Result<Option<WorkflowItem>, WorkflowStoreError> {
        let conn = self.lock()?;
        item::get_item(&conn, id, workspace_id)
    }

    pub fn list_items(
        &self,
        workspace_id: &str,
        project_name: Option<&str>,
        status: Option<ItemStatus>,
        limit: usize,
    ) -> Result<Vec<WorkflowItem>, WorkflowStoreError> {
        let conn = self.lock()?;
        item::list_items(&conn, workspace_id, project_name, status, limit)
    }

    pub fn delete_item(&self,id:&str,workspace_id:&str,event:Option<&WorkflowEvent>)->Result<bool,WorkflowStoreError>{let mut conn=self.lock()?;let tx=conn.transaction()?;let deleted=item::delete_item_tx(&tx,id,workspace_id,event)?;tx.commit()?;Ok(deleted)}
    pub fn delete_item_cas(&self,id:&str,workspace_id:&str,expected_updated_at:u64,event:Option<&WorkflowEvent>)->Result<bool,WorkflowStoreError>{let mut conn=self.lock()?;let tx=conn.transaction()?;let result=item::delete_item_tx_cas(&tx,id,workspace_id,Some(expected_updated_at),event)?;tx.commit()?;Ok(result)}

    // -----------------------------------------------------------------------
    // Work Sessions & Resource Links
    // -----------------------------------------------------------------------

    pub fn start_session(
        &self,
        session: &WorkflowSession,
        link: Option<&WorkflowResourceLink>,
        event: Option<&WorkflowEvent>,
    ) -> Result<WorkflowSession, WorkflowStoreError> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let result = session::start_session_tx(&tx, session, link, event)?;
        tx.commit()?;
        Ok(result)
    }

    pub fn update_session_status(
        &self,
        id: &str,
        workspace_id: &str,
        new_status: SessionStatus,
        ended_at: Option<u64>,
        updated_at: u64,
        event: Option<&WorkflowEvent>,
    ) -> Result<WorkflowSession, WorkflowStoreError> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let result = session::update_session_status_tx(
            &tx,
            id,
            workspace_id,
            new_status,
            ended_at,
            updated_at,
            event,
        )?;
        tx.commit()?;
        Ok(result)
    }

    pub fn link_resource(
        &self,
        link: &WorkflowResourceLink,
        event: Option<&WorkflowEvent>,
    ) -> Result<WorkflowResourceLink, WorkflowStoreError> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let result = session::link_resource_tx(&tx, link, event)?;
        tx.commit()?;
        Ok(result)
    }

    pub fn update_resource_observation(
        &self,
        session_id: &str,
        resource_type: ResourceLinkType,
        external_id: &str,
        observed_state: ResourceObservedState,
        suggested_end_time: Option<u64>,
        observed_at: u64,
        event: Option<&WorkflowEvent>,
    ) -> Result<Option<WorkflowResourceLink>, WorkflowStoreError> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let result = session::update_resource_observation_tx(
            &tx,
            session_id,
            resource_type,
            external_id,
            observed_state,
            suggested_end_time,
            observed_at,
            event,
        )?;
        tx.commit()?;
        Ok(result)
    }

    pub fn unlink_resource(
        &self,
        session_id: &str,
        resource_type: ResourceLinkType,
        external_id: &str,
        event: Option<&WorkflowEvent>,
    ) -> Result<bool, WorkflowStoreError> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let result =
            session::unlink_resource_tx(&tx, session_id, resource_type, external_id, event)?;
        tx.commit()?;
        Ok(result)
    }

    pub fn get_session(
        &self,
        id: &str,
        workspace_id: &str,
    ) -> Result<Option<WorkflowSession>, WorkflowStoreError> {
        let conn = self.lock()?;
        session::get_session(&conn, id, workspace_id)
    }

    pub fn list_active_sessions(
        &self,
        workspace_id: &str,
        project_name: Option<&str>,
        limit: usize,
    ) -> Result<Vec<WorkflowSession>, WorkflowStoreError> {
        let conn = self.lock()?;
        session::list_active_sessions(&conn, workspace_id, project_name, limit)
    }

    pub fn get_links_for_session(
        &self,
        session_id: &str,
    ) -> Result<Vec<WorkflowResourceLink>, WorkflowStoreError> {
        let conn = self.lock()?;
        session::get_links_for_session(&conn, session_id)
    }

    // -----------------------------------------------------------------------
    // Notes
    // -----------------------------------------------------------------------

    pub fn create_note(
        &self,
        note: &WorkflowNote,
        event: Option<&WorkflowEvent>,
    ) -> Result<WorkflowNote, WorkflowStoreError> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let result = note::create_note_tx(&tx, note, event)?;
        tx.commit()?;
        Ok(result)
    }

    pub fn soft_delete_note(
        &self,
        id: &str,
        workspace_id: &str,
        deleted_at: u64,
        event: Option<&WorkflowEvent>,
    ) -> Result<bool, WorkflowStoreError> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let result = note::soft_delete_note_tx(&tx, id, workspace_id, deleted_at, event)?;
        tx.commit()?;
        Ok(result)
    }
    pub fn get_note(&self, id: &str, workspace_id: &str) -> Result<Option<WorkflowNote>, WorkflowStoreError> {
        let conn = self.lock()?;
        note::get_note(&conn, id, workspace_id)
    }

    pub fn soft_delete_note_cas(&self,id:&str,workspace_id:&str,deleted_at:u64,expected:u64,event:Option<&WorkflowEvent>)->Result<bool,WorkflowStoreError>{let mut conn=self.lock()?;let tx=conn.transaction()?;let result=note::soft_delete_note_tx_cas(&tx,id,workspace_id,deleted_at,expected,event)?;tx.commit()?;Ok(result)}
    pub fn list_notes_for_item(
        &self,
        item_id: &str,
        workspace_id: &str,
        include_deleted: bool,
    ) -> Result<Vec<WorkflowNote>, WorkflowStoreError> {
        let conn = self.lock()?;
        note::list_notes_for_item(&conn, item_id, workspace_id, include_deleted)
    }

    pub fn list_notes_for_session(
        &self,
        session_id: &str,
        workspace_id: &str,
        include_deleted: bool,
    ) -> Result<Vec<WorkflowNote>, WorkflowStoreError> {
        let conn = self.lock()?;
        note::list_notes_for_session(&conn, session_id, workspace_id, include_deleted)
    }

    // -----------------------------------------------------------------------
    // Events & History
    // -----------------------------------------------------------------------

    pub fn record_event(&self, event: &WorkflowEvent) -> Result<(), WorkflowStoreError> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        event::record_event_tx(&tx, event)?;
        tx.commit()?;
        Ok(())
    }

    pub fn list_events_keyset(
        &self,
        workspace_id: &str,
        cursor_recorded_at: Option<u64>,
        cursor_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<WorkflowEvent>, WorkflowStoreError> {
        let conn = self.lock()?;
        event::list_events_keyset(
            &conn,
            workspace_id,
            cursor_recorded_at,
            cursor_id,
            limit,
        )
    }

    pub fn get_event(&self, id: &str, workspace_id: &str) -> Result<Option<WorkflowEvent>, WorkflowStoreError> {
        let conn = self.lock()?;
        event::get_event(&conn, id, workspace_id)
    }
    pub fn purge_history_before(&self, workspace_id: &str, before_ms: u64, limit: usize) -> Result<(usize, usize), WorkflowStoreError> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let event_count = tx.execute("DELETE FROM workflow_events WHERE rowid IN (SELECT rowid FROM workflow_events WHERE workspace_id=?1 AND recorded_at<?2 LIMIT ?3)", params![workspace_id,before_ms,limit as i64])?;
        let note_count = tx.execute("DELETE FROM workflow_notes WHERE rowid IN (SELECT rowid FROM workflow_notes WHERE workspace_id=?1 AND deleted_at IS NOT NULL AND deleted_at<?2 LIMIT ?3)", params![workspace_id,before_ms,limit as i64])?;
        tx.commit()?;
        Ok((event_count,note_count))
    }
    // -----------------------------------------------------------------------
    // Overview & Purge
    // -----------------------------------------------------------------------

    pub fn get_overview(
        &self,
        workspace_id: &str,
        now_ms: u64,
        max_projects: usize,
        max_items: usize,
        max_sessions: usize,
    ) -> Result<WorkflowOverview, WorkflowStoreError> {
        let conn = self.lock()?;
        overview::get_overview(
            &conn,
            workspace_id,
            now_ms,
            max_projects,
            max_items,
            max_sessions,
        )
    }

    pub fn purge_expired_events(
        &self,
        workspace_id: &str,
        now_ms: u64,
        batch_limit: usize,
    ) -> Result<usize, WorkflowStoreError> {
        let mut conn = self.lock()?;
        event::purge_expired_events(&mut conn, workspace_id, now_ms, batch_limit)
    }

    pub fn purge_soft_deleted_notes(
        &self,
        workspace_id: &str,
        older_than_ms: u64,
        batch_limit: usize,
    ) -> Result<usize, WorkflowStoreError> {
        let mut conn = self.lock()?;
        event::purge_soft_deleted_notes(&mut conn, workspace_id, older_than_ms, batch_limit)
    }
}
