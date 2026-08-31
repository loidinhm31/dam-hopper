mod restore;
mod worker;

pub use restore::{restore_sessions, restore_sessions_with_state};
pub use worker::{PersistCmd, PersistWorker};

use crate::config::RestartPolicy;
use crate::pty::SessionMeta;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

/// Session persistence store using SQLite.
///
/// Provides CRUD operations for session metadata and buffer data.
/// Thread-safe via Arc<Mutex<Connection>>.
pub struct SessionStore {
    conn: Arc<Mutex<Connection>>,
}

/// Session data as persisted in the database.
#[derive(Debug, Clone)]
pub struct PersistedSession {
    pub meta: SessionMeta,
    pub env: HashMap<String, String>,
    pub cols: u16,
    pub rows: u16,
    pub incarnation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersistedPort {
    pub session_id: String,
    pub port: u16,
    pub project: Option<String>,
    pub incarnation: u64,
}

impl SessionStore {
    /// Opens or creates the SQLite database at the given path.
    /// Runs migrations automatically.
    /// On Unix, creates file with 0o600 permissions (user-only access).
    pub fn open(path: &Path) -> Result<Self, rusqlite::Error> {
        // Create file with restricted permissions first (Unix only)
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            if !path.exists() {
                std::fs::OpenOptions::new()
                    .write(true)
                    .create(true)
                    .mode(0o600)
                    .open(path)
                    .map_err(|e| {
                        rusqlite::Error::SqliteFailure(
                            rusqlite::ffi::Error::new(1),
                            Some(format!("Failed to create DB with permissions: {}", e)),
                        )
                    })?;
            }
        }

        let conn = Connection::open(path)?;

        // Run migrations (idempotent)
        conn.execute_batch(include_str!("migrations/001_initial.sql"))?;

        // 002: add `alive` column — SQLite ALTER TABLE isn't idempotent, so guard it.
        let has_alive: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'alive'",
            [],
            |row| row.get(0),
        )?;
        if has_alive == 0 {
            conn.execute_batch(include_str!("migrations/002_alive.sql"))?;
        }
        conn.execute_batch(include_str!("migrations/003_persisted_ports.sql"))?;
        let has_worktree_path: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'worktree_path'",
            [],
            |row| row.get(0),
        )?;
        if has_worktree_path == 0 {
            conn.execute_batch(include_str!("migrations/004_worktree_path.sql"))?;
        }
        let has_target_unavailable: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'target_unavailable'",
            [],
            |row| row.get(0),
        )?;
        if has_target_unavailable == 0 {
            conn.execute_batch(include_str!("migrations/005_target_unavailable.sql"))?;
        }
        let has_incarnation: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'incarnation'",
            [],
            |row| row.get(0),
        )?;
        if has_incarnation == 0 {
            conn.execute_batch(include_str!("migrations/006_incarnation.sql"))?;
        }
        conn.execute_batch(include_str!("migrations/007_session_removals.sql"))?;
        let has_persisted_port_incarnation: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('persisted_ports') WHERE name = 'incarnation'",
            [],
            |row| row.get(0),
        )?;
        if has_persisted_port_incarnation == 0 {
            conn.execute_batch(include_str!(
                "migrations/008_persisted_port_incarnation.sql"
            ))?;
        }
        let has_name: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'name'",
            [],
            |row| row.get(0),
        )?;
        if has_name == 0 {
            conn.execute_batch(include_str!("migrations/009_session_name.sql"))?;
        }

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// Saves metadata for a concrete PTY incarnation. The UPSERT keeps the
    /// session buffer row intact and rejects stale reader commands that arrive
    /// after a newer incarnation has already been persisted.
    pub fn save_session_for_incarnation(
        &self,
        meta: &SessionMeta,
        incarnation: u64,
        env: &HashMap<String, String>,
        cols: u16,
        rows: u16,
        restart_max_retries: u32,
    ) -> Result<(), rusqlite::Error> {
        self.save_session_for_incarnation_with_target_state(
            meta,
            incarnation,
            env,
            cols,
            rows,
            restart_max_retries,
            false,
        )
    }

    /// Upserts a target-scoped session as an unavailable, non-respawning
    /// identity. This is needed when PTY setup fails before the normal
    /// `SessionCreated` command can create a row.
    pub fn save_session_target_unavailable_for_incarnation(
        &self,
        meta: &SessionMeta,
        incarnation: u64,
        env: &HashMap<String, String>,
        cols: u16,
        rows: u16,
        restart_max_retries: u32,
    ) -> Result<(), rusqlite::Error> {
        self.save_session_for_incarnation_with_target_state(
            meta,
            incarnation,
            env,
            cols,
            rows,
            restart_max_retries,
            true,
        )
    }

    fn save_session_for_incarnation_with_target_state(
        &self,
        meta: &SessionMeta,
        incarnation: u64,
        env: &HashMap<String, String>,
        cols: u16,
        rows: u16,
        restart_max_retries: u32,
        target_unavailable: bool,
    ) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let removal_watermark: Option<i64> = conn
            .query_row(
                "SELECT incarnation FROM session_removals WHERE id = ?1",
                params![meta.id],
                |row| row.get(0),
            )
            .optional()?;
        if removal_watermark.is_some_and(|watermark| (incarnation as i64) <= watermark) {
            return Ok(());
        }
        let env_json = serde_json::to_string(env).unwrap_or_else(|_| "{}".to_string());

        let session_type = match meta.session_type {
            crate::pty::session::SessionType::Shell => "shell",
            crate::pty::session::SessionType::Terminal => "terminal",
            crate::pty::session::SessionType::Build => "build",
            crate::pty::session::SessionType::Run => "run",
            crate::pty::session::SessionType::Custom => "custom",
            crate::pty::session::SessionType::Free => "free",
            crate::pty::session::SessionType::Unknown => "unknown",
        };

        let restart_policy = match meta.restart_policy {
            RestartPolicy::Never => "never",
            RestartPolicy::OnFailure => "on-failure",
            RestartPolicy::Always => "always",
        };

        conn.execute(
            "INSERT INTO sessions
             (id, project, command, cwd, worktree_path, name, session_type, restart_policy,
             restart_max_retries, env_json, cols, rows, created_at, updated_at, alive,
              target_unavailable, incarnation)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 1, ?15, ?16)
             ON CONFLICT(id) DO UPDATE SET
                project = excluded.project,
                command = excluded.command,
                cwd = excluded.cwd,
                worktree_path = excluded.worktree_path,
                name = excluded.name,
                session_type = excluded.session_type,
                restart_policy = excluded.restart_policy,
                restart_max_retries = excluded.restart_max_retries,
                env_json = excluded.env_json,
                cols = excluded.cols,
                rows = excluded.rows,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                alive = excluded.alive,
                target_unavailable = CASE
                    WHEN sessions.incarnation = excluded.incarnation
                         AND sessions.target_unavailable = 1
                    THEN 1
                    ELSE excluded.target_unavailable
                END,
                incarnation = excluded.incarnation
             WHERE excluded.incarnation >= sessions.incarnation",
            params![
                meta.id,
                meta.project,
                meta.command,
                meta.cwd,
                meta.worktree_path,
                meta.name,
                session_type,
                restart_policy,
                restart_max_retries as i64,
                env_json,
                cols,
                rows,
                meta.started_at as i64,
                now_ms() as i64,
                target_unavailable as i64,
                incarnation as i64,
            ],
        )?;

        // A genuinely newer create clears the removal watermark. Older
        // SessionCreated commands remain blocked by the incarnation UPSERT
        // condition above even if they arrive after this cleanup.
        conn.execute(
            "DELETE FROM session_removals WHERE id = ?1 AND incarnation < ?2",
            params![meta.id, incarnation as i64],
        )?;

        Ok(())
    }

    pub fn mark_session_dead_for_incarnation(
        &self,
        id: &str,
        incarnation: u64,
    ) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sessions
             SET alive = 0, updated_at = ?1
             WHERE id = ?2
               AND incarnation = ?3
               AND target_unavailable = 0",
            params![now_ms() as i64, id, incarnation as i64],
        )?;
        Ok(())
    }

    pub fn mark_session_target_unavailable_for_incarnation(
        &self,
        id: &str,
        incarnation: u64,
    ) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sessions
             SET alive = 1, target_unavailable = 1, updated_at = ?1
             WHERE id = ?2 AND incarnation = ?3",
            params![now_ms() as i64, id, incarnation as i64],
        )?;
        Ok(())
    }

    pub fn save_buffer_for_incarnation(
        &self,
        id: &str,
        incarnation: u64,
        data: &[u8],
        total_written: u64,
    ) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();

        let current: bool = conn.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM sessions WHERE id = ?1 AND incarnation = ?2
             )",
            params![id, incarnation as i64],
            |row| row.get(0),
        )?;
        if !current {
            return Ok(());
        }

        conn.execute(
            "INSERT INTO session_buffers (session_id, data, total_written, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(session_id) DO UPDATE SET
                data = excluded.data,
                total_written = excluded.total_written,
                updated_at = excluded.updated_at",
            params![id, data, total_written as i64, now_ms() as i64],
        )?;

        Ok(())
    }

    /// Loads all persisted sessions from the database.
    pub fn load_sessions(&self) -> Result<Vec<PersistedSession>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT s.id, s.project, s.command, s.cwd, s.worktree_path, s.name, s.session_type,
                    s.restart_policy, s.env_json, s.cols, s.rows, s.created_at,
                    s.target_unavailable, s.incarnation
             FROM sessions AS s
             WHERE s.alive = 1
               AND NOT EXISTS (
                   SELECT 1 FROM session_removals AS r
                   WHERE r.id = s.id AND r.incarnation >= s.incarnation
               )
             ORDER BY s.created_at DESC",
        )?;

        let sessions = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let project: Option<String> = row.get(1)?;
                let command: String = row.get(2)?;
                let cwd: String = row.get(3)?;
                let worktree_path: Option<String> = row.get(4)?;
                let name: Option<String> = row.get(5)?;
                let session_type_str: String = row.get(6)?;
                let restart_policy_str: String = row.get(7)?;
                let env_json: String = row.get(8)?;
                let cols: u16 = row.get(9)?;
                let rows: u16 = row.get(10)?;
                let created_at: i64 = row.get(11)?;
                let target_unavailable: bool = row.get::<_, i64>(12)? != 0;
                let incarnation: i64 = row.get(13)?;

                let session_type = match session_type_str.as_str() {
                    "shell" => crate::pty::session::SessionType::Shell,
                    "terminal" => crate::pty::session::SessionType::Terminal,
                    "build" => crate::pty::session::SessionType::Build,
                    "run" => crate::pty::session::SessionType::Run,
                    "custom" => crate::pty::session::SessionType::Custom,
                    "free" => crate::pty::session::SessionType::Free,
                    _ => crate::pty::session::SessionType::Unknown,
                };

                let restart_policy = match restart_policy_str.as_str() {
                    "on-failure" => RestartPolicy::OnFailure,
                    "always" => RestartPolicy::Always,
                    _ => RestartPolicy::Never,
                };

                let env: HashMap<String, String> =
                    serde_json::from_str(&env_json).unwrap_or_default();

                let meta = SessionMeta {
                    id: id.clone(),
                    incarnation: 0,
                    project,
                    command,
                    cwd,
                    worktree_path,
                    name,
                    session_type,
                    alive: false, // Will be set to true when restored
                    exit_code: None,
                    started_at: created_at as u64,
                    restart_count: 0,
                    last_exit_at: None,
                    restart_policy,
                    target_unavailable,
                };

                Ok(PersistedSession {
                    meta,
                    env,
                    cols,
                    rows,
                    incarnation: incarnation.max(0) as u64,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(sessions)
    }

    /// Loads buffer data for a specific session.
    /// Returns (data, total_written) if found, None if not.
    pub fn load_buffer(&self, id: &str) -> Result<Option<(Vec<u8>, u64)>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT data, total_written FROM session_buffers WHERE session_id = ?1",
            params![id],
            |row| {
                let data: Vec<u8> = row.get(0)?;
                let total_written: i64 = row.get(1)?;
                Ok((data, total_written as u64))
            },
        )
        .optional()
    }

    pub fn rename_session_for_incarnation(
        &self,
        id: &str,
        incarnation: u64,
        name: Option<String>,
    ) -> Result<bool, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let changed = conn.execute(
            "UPDATE sessions SET name = ?1, updated_at = ?2
             WHERE id = ?3 AND incarnation = ?4
               AND NOT EXISTS (
                   SELECT 1 FROM session_removals AS r
                   WHERE r.id = sessions.id AND r.incarnation >= sessions.incarnation
               )",
            params![name, now_ms() as i64, id, incarnation as i64],
        )?;
        Ok(changed != 0)
    }

    fn delete_session_in_transaction(
        transaction: &rusqlite::Transaction<'_>,
        id: &str,
        incarnation: u64,
    ) -> Result<(), rusqlite::Error> {
        transaction.execute(
            "INSERT INTO session_removals (id, incarnation, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET
                incarnation = excluded.incarnation,
                updated_at = excluded.updated_at
             WHERE excluded.incarnation > session_removals.incarnation",
            params![id, incarnation as i64, now_ms() as i64],
        )?;
        transaction.execute(
            "DELETE FROM session_buffers
             WHERE session_id = ?1
               AND NOT EXISTS (
                   SELECT 1 FROM sessions
                   WHERE id = ?1 AND incarnation > (
                       SELECT incarnation FROM session_removals WHERE id = ?1
                   )
               )",
            params![id],
        )?;
        transaction.execute(
            "DELETE FROM persisted_ports
             WHERE session_id = ?1
               AND incarnation <= (
                   SELECT incarnation FROM session_removals WHERE id = ?1
               )",
            params![id],
        )?;
        transaction.execute(
            "DELETE FROM sessions
             WHERE id = ?1
               AND incarnation <= (
                   SELECT incarnation FROM session_removals WHERE id = ?1
               )",
            params![id],
        )?;
        Ok(())
    }

    pub fn cleanup_dead_sessions(&self) -> Result<usize, rusqlite::Error> {
        let mut conn = self.conn.lock().unwrap();
        let transaction = conn.transaction()?;
        let mut stmt =
            transaction.prepare("SELECT id, incarnation FROM sessions WHERE alive = 0")?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?.max(0) as u64,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(stmt);
        for (id, incarnation) in &rows {
            Self::delete_session_in_transaction(&transaction, id, *incarnation)?;
        }
        transaction.commit()?;
        Ok(rows.len())
    }

    pub fn delete_session_for_incarnation(
        &self,
        id: &str,
        incarnation: u64,
    ) -> Result<(), rusqlite::Error> {
        let mut conn = self.conn.lock().unwrap();
        let transaction = conn.transaction()?;
        Self::delete_session_in_transaction(&transaction, id, incarnation)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn load_session_incarnation(&self, id: &str) -> Result<Option<u64>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT incarnation FROM sessions WHERE id = ?1",
            params![id],
            |row| {
                let incarnation: i64 = row.get(0)?;
                Ok(incarnation.max(0) as u64)
            },
        )
        .optional()
    }

    pub fn max_session_incarnation(&self) -> Result<Option<u64>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let incarnation: Option<i64> = conn.query_row(
            "SELECT MAX(incarnation) FROM (
                 SELECT MAX(incarnation) AS incarnation FROM sessions
                 UNION ALL
                 SELECT MAX(incarnation) AS incarnation FROM session_removals
             )",
            [],
            |row| row.get(0),
        )?;
        Ok(incarnation.map(|value| value.max(0) as u64))
    }

    pub fn save_detected_port(
        &self,
        session_id: &str,
        incarnation: u64,
        port: u16,
        project: Option<&str>,
    ) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let removal_watermark: Option<i64> = conn
            .query_row(
                "SELECT incarnation FROM session_removals WHERE id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .optional()?;
        if removal_watermark.is_some_and(|watermark| (incarnation as i64) <= watermark) {
            return Ok(());
        }
        conn.execute(
            "INSERT INTO persisted_ports
                (session_id, port, project, incarnation, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(session_id, port) DO UPDATE SET
                project = excluded.project,
                incarnation = excluded.incarnation,
                updated_at = excluded.updated_at
             WHERE excluded.incarnation >= persisted_ports.incarnation",
            params![
                session_id,
                port as i64,
                project,
                incarnation as i64,
                now_ms() as i64
            ],
        )?;
        Ok(())
    }

    pub fn delete_detected_port(
        &self,
        session_id: &str,
        incarnation: u64,
        port: u16,
    ) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM persisted_ports
             WHERE session_id = ?1 AND incarnation = ?2 AND port = ?3",
            params![session_id, incarnation as i64, port as i64],
        )?;
        Ok(())
    }

    pub fn delete_detected_ports_for_session(
        &self,
        session_id: &str,
        incarnation: u64,
    ) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM persisted_ports WHERE session_id = ?1 AND incarnation = ?2",
            params![session_id, incarnation as i64],
        )?;
        Ok(())
    }

    pub fn load_detected_ports(&self) -> Result<Vec<PersistedPort>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT session_id, port, project, incarnation
             FROM persisted_ports ORDER BY updated_at DESC",
        )?;
        let ports = stmt
            .query_map([], |row| {
                let port: i64 = row.get(1)?;
                let incarnation: i64 = row.get(3)?;
                Ok(PersistedPort {
                    session_id: row.get(0)?,
                    port: port as u16,
                    project: row.get(2)?,
                    incarnation: incarnation.max(0) as u64,
                })
            })?
            .collect();
        ports
    }

    /// Removes expired session buffers (older than TTL).
    /// Returns the number of buffers deleted.
    pub fn cleanup_expired(&self, ttl_hours: u64) -> Result<usize, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let cutoff = now_ms() - (ttl_hours * 60 * 60 * 1000);

        let deleted = conn.execute(
            "DELETE FROM session_buffers WHERE updated_at <= ?1",
            params![cutoff as i64],
        )?;

        Ok(deleted)
    }
}

/// Current time as Unix milliseconds.
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pty::session::{now_ms as session_now_ms, SessionType};
    use tempfile::NamedTempFile;

    fn create_test_store() -> (SessionStore, NamedTempFile) {
        let temp = NamedTempFile::new().unwrap();
        let store = SessionStore::open(temp.path()).unwrap();
        (store, temp)
    }

    fn create_test_session() -> SessionMeta {
        SessionMeta {
            id: "test-session-1".to_string(),
            incarnation: 0,
            project: Some("test-project".to_string()),
            command: "npm run dev".to_string(),
            cwd: "/test/path".to_string(),
            worktree_path: Some("/test/worktree".to_string()),
            name: None,
            session_type: SessionType::Shell,
            alive: true,
            exit_code: None,
            started_at: session_now_ms(),
            restart_count: 0,
            last_exit_at: None,
            restart_policy: RestartPolicy::OnFailure,
            target_unavailable: false,
        }
    }

    #[test]
    fn create_session_store() {
        let (store, _temp) = create_test_store();
        assert!(store.load_sessions().is_ok());
    }

    #[test]
    fn save_and_load_session() {
        let (store, _temp) = create_test_store();
        let meta = create_test_session();
        let env = HashMap::from([
            ("NODE_ENV".to_string(), "development".to_string()),
            ("PORT".to_string(), "3000".to_string()),
        ]);

        store
            .save_session_for_incarnation(&meta, 0, &env, 120, 32, 5)
            .unwrap();

        let sessions = store.load_sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].meta.id, "test-session-1");
        assert_eq!(sessions[0].meta.command, "npm run dev");
        assert_eq!(
            sessions[0].meta.worktree_path.as_deref(),
            Some("/test/worktree")
        );
        assert_eq!(sessions[0].env.get("NODE_ENV").unwrap(), "development");
        assert_eq!(sessions[0].cols, 120);
        assert_eq!(sessions[0].rows, 32);
    }

    #[test]
    fn session_rename_round_trip_preserves_name_and_rejects_stale_identity() {
        let (store, _temp) = create_test_store();
        let mut meta = create_test_session();
        meta.name = Some("Release shell".to_string());
        let env = HashMap::new();

        store
            .save_session_for_incarnation(&meta, 7, &env, 120, 32, 5)
            .unwrap();
        assert_eq!(
            store.load_sessions().unwrap()[0].meta.name.as_deref(),
            Some("Release shell")
        );

        assert!(store
            .rename_session_for_incarnation(&meta.id, 7, Some("Renamed shell".to_string()))
            .unwrap());
        assert_eq!(
            store.load_sessions().unwrap()[0].meta.name.as_deref(),
            Some("Renamed shell")
        );
        assert!(!store
            .rename_session_for_incarnation(&meta.id, 6, Some("stale".to_string()))
            .unwrap());
        assert_eq!(
            store.load_sessions().unwrap()[0].meta.name.as_deref(),
            Some("Renamed shell")
        );
    }

    #[test]
    fn expired_dead_session_cleanup_removes_rows_and_buffers() {
        let (store, _temp) = create_test_store();
        let meta = create_test_session();
        let env = HashMap::new();

        store
            .save_session_for_incarnation(&meta, 17, &env, 80, 24, 5)
            .unwrap();
        store
            .save_buffer_for_incarnation(&meta.id, 17, b"dead output", 11)
            .unwrap();
        store
            .mark_session_dead_for_incarnation(&meta.id, 17)
            .unwrap();

        assert_eq!(store.cleanup_dead_sessions().unwrap(), 1);
        assert!(store.load_buffer(&meta.id).unwrap().is_none());
        let conn = store.conn.lock().unwrap();
        let remaining: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sessions WHERE id = ?1",
                params![meta.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(remaining, 0);
    }

    #[test]
    fn save_and_load_buffer() {
        let (store, _temp) = create_test_store();
        let meta = create_test_session();
        let env = HashMap::new();

        // Save session first (required by FK constraint)
        store
            .save_session_for_incarnation(&meta, 0, &env, 120, 32, 5)
            .unwrap();

        let data = b"hello terminal output";
        store
            .save_buffer_for_incarnation("test-session-1", 0, data, 21)
            .unwrap();

        let result = store.load_buffer("test-session-1").unwrap();
        assert!(result.is_some());

        let (loaded_data, total_written) = result.unwrap();
        assert_eq!(loaded_data, data);
        assert_eq!(total_written, 21);
    }

    #[test]
    fn delete_session_cascades_to_buffer() {
        let (store, _temp) = create_test_store();
        let meta = create_test_session();
        let env = HashMap::new();

        store
            .save_session_for_incarnation(&meta, 0, &env, 120, 32, 5)
            .unwrap();
        store
            .save_buffer_for_incarnation("test-session-1", 0, b"data", 4)
            .unwrap();

        store
            .delete_session_for_incarnation("test-session-1", 0)
            .unwrap();

        let sessions = store.load_sessions().unwrap();
        assert_eq!(sessions.len(), 0);

        let buffer = store.load_buffer("test-session-1").unwrap();
        assert!(buffer.is_none());
    }

    #[test]
    fn removal_watermark_is_part_of_incarnation_allocator_seed() {
        let (store, _temp) = create_test_store();
        let meta = create_test_session();
        let env = HashMap::new();

        store
            .save_session_for_incarnation(&meta, 10, &env, 80, 24, 5)
            .unwrap();
        store.delete_session_for_incarnation(&meta.id, 20).unwrap();

        assert_eq!(store.max_session_incarnation().unwrap(), Some(20));

        store
            .save_session_for_incarnation(&meta, 19, &env, 80, 24, 5)
            .unwrap();
        assert!(store.load_sessions().unwrap().is_empty());

        store
            .save_session_for_incarnation(&meta, 21, &env, 80, 24, 5)
            .unwrap();
        assert_eq!(store.load_sessions().unwrap()[0].incarnation, 21);
    }

    #[test]
    fn load_sessions_ignores_rows_covered_by_removal_watermark() {
        let (store, _temp) = create_test_store();
        let meta = create_test_session();
        let env = HashMap::new();

        store
            .save_session_for_incarnation(&meta, 10, &env, 80, 24, 5)
            .unwrap();
        {
            let conn = store.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO session_removals (id, incarnation, updated_at)
                 VALUES (?1, ?2, ?3)",
                params![meta.id, 20_i64, session_now_ms() as i64],
            )
            .unwrap();
        }

        assert!(store.load_sessions().unwrap().is_empty());
    }

    #[test]
    fn target_unavailable_state_survives_late_dead_transition() {
        let (store, _temp) = create_test_store();
        let meta = create_test_session();
        let env = HashMap::new();

        store
            .save_session_for_incarnation(&meta, 10, &env, 80, 24, 5)
            .unwrap();
        store
            .mark_session_target_unavailable_for_incarnation(&meta.id, 10)
            .unwrap();
        store
            .save_session_for_incarnation(&meta, 10, &env, 80, 24, 5)
            .unwrap();
        store
            .mark_session_dead_for_incarnation(&meta.id, 10)
            .unwrap();

        let sessions = store.load_sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert!(sessions[0].meta.target_unavailable);
    }

    #[test]
    fn target_unavailable_upsert_persists_first_failed_create() {
        let (store, _temp) = create_test_store();
        let meta = create_test_session();
        let env = HashMap::from([("SECRET_NAME".to_string(), "redacted-at-test".to_string())]);

        store
            .save_session_target_unavailable_for_incarnation(&meta, 12, &env, 132, 40, 7)
            .unwrap();

        let sessions = store.load_sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert!(sessions[0].meta.target_unavailable);
        assert_eq!(sessions[0].incarnation, 12);
        assert_eq!(sessions[0].env, env);
        assert_eq!(sessions[0].cols, 132);
        assert_eq!(sessions[0].rows, 40);
    }

    #[test]
    fn save_load_and_delete_detected_ports() {
        let (store, _temp) = create_test_store();

        store
            .save_detected_port("session-a", 10, 5173, Some("web"))
            .unwrap();
        store
            .save_detected_port("session-b", 20, 8080, None)
            .unwrap();

        let ports = store.load_detected_ports().unwrap();
        assert_eq!(ports.len(), 2);
        assert!(ports.contains(&PersistedPort {
            session_id: "session-a".to_string(),
            port: 5173,
            project: Some("web".to_string()),
            incarnation: 10,
        }));

        store.delete_detected_port("session-a", 10, 5173).unwrap();
        let ports = store.load_detected_ports().unwrap();
        assert_eq!(ports.len(), 1);
        assert_eq!(ports[0].session_id, "session-b");

        store
            .delete_detected_ports_for_session("session-b", 20)
            .unwrap();
        assert!(store.load_detected_ports().unwrap().is_empty());
    }

    #[test]
    fn stale_port_deletion_does_not_touch_new_incarnation() {
        let (store, _temp) = create_test_store();

        store
            .save_detected_port("reused", 10, 5173, Some("old"))
            .unwrap();
        store
            .save_detected_port("reused", 11, 5173, Some("new"))
            .unwrap();
        store.delete_detected_port("reused", 10, 5173).unwrap();

        let ports = store.load_detected_ports().unwrap();
        assert_eq!(ports.len(), 1);
        assert_eq!(ports[0].incarnation, 11);
        assert_eq!(ports[0].project.as_deref(), Some("new"));
    }

    #[test]
    fn stale_port_save_does_not_overwrite_new_incarnation() {
        let (store, _temp) = create_test_store();

        store
            .save_detected_port("reused", 11, 5173, Some("new"))
            .unwrap();
        store
            .save_detected_port("reused", 10, 5173, Some("old"))
            .unwrap();

        let ports = store.load_detected_ports().unwrap();
        assert_eq!(ports.len(), 1);
        assert_eq!(ports[0].incarnation, 11);
        assert_eq!(ports[0].project.as_deref(), Some("new"));
    }

    #[test]
    fn cleanup_expired_buffers() {
        let (store, _temp) = create_test_store();
        let meta = SessionMeta {
            id: "session-1".to_string(),
            incarnation: 0,
            project: None,
            command: "test".to_string(),
            cwd: "/".to_string(),
            worktree_path: None,
            name: None,
            session_type: SessionType::Shell,
            alive: true,
            exit_code: None,
            started_at: session_now_ms(),
            restart_count: 0,
            last_exit_at: None,
            restart_policy: RestartPolicy::Never,
            target_unavailable: false,
        };
        let env = HashMap::new();

        // Save session first (required by FK constraint)
        store
            .save_session_for_incarnation(&meta, 0, &env, 120, 32, 5)
            .unwrap();

        // Save a buffer with current timestamp
        store
            .save_buffer_for_incarnation("session-1", 0, b"recent", 6)
            .unwrap();

        // Cleanup with 0 TTL should remove everything
        let deleted = store.cleanup_expired(0).unwrap();
        assert_eq!(deleted, 1);

        let buffer = store.load_buffer("session-1").unwrap();
        assert!(buffer.is_none());
    }

    #[test]
    fn load_buffer_returns_none_when_not_found() {
        let (store, _temp) = create_test_store();
        let result = store.load_buffer("nonexistent").unwrap();
        assert!(result.is_none());
    }
}
