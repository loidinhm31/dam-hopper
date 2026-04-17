mod restore;
mod worker;

pub use restore::restore_sessions;
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
        
        // Run migrations
        conn.execute_batch(include_str!("migrations/001_initial.sql"))?;
        
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// Saves session metadata to the database.
    pub fn save_session(
        &self,
        meta: &SessionMeta,
        env: &HashMap<String, String>,
        cols: u16,
        rows: u16,
        restart_max_retries: u32,
    ) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
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
            "INSERT OR REPLACE INTO sessions 
             (id, project, command, cwd, session_type, restart_policy, restart_max_retries, 
              env_json, cols, rows, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                meta.id,
                meta.project,
                meta.command,
                meta.cwd,
                session_type,
                restart_policy,
                restart_max_retries as i64,
                env_json,
                cols,
                rows,
                meta.started_at as i64,
                now_ms() as i64,
            ],
        )?;

        Ok(())
    }

    /// Saves session buffer data (scrollback).
    pub fn save_buffer(
        &self,
        id: &str,
        data: &[u8],
        total_written: u64,
    ) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "INSERT OR REPLACE INTO session_buffers (session_id, data, total_written, updated_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![id, data, total_written as i64, now_ms() as i64],
        )?;

        Ok(())
    }

    /// Loads all persisted sessions from the database.
    pub fn load_sessions(&self) -> Result<Vec<PersistedSession>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project, command, cwd, session_type, restart_policy, 
                    env_json, cols, rows, created_at
             FROM sessions
             ORDER BY created_at DESC",
        )?;

        let sessions = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let project: Option<String> = row.get(1)?;
                let command: String = row.get(2)?;
                let cwd: String = row.get(3)?;
                let session_type_str: String = row.get(4)?;
                let restart_policy_str: String = row.get(5)?;
                let env_json: String = row.get(6)?;
                let cols: u16 = row.get(7)?;
                let rows: u16 = row.get(8)?;
                let created_at: i64 = row.get(9)?;

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
                    project,
                    command,
                    cwd,
                    session_type,
                    alive: false, // Will be set to true when restored
                    exit_code: None,
                    started_at: created_at as u64,
                    restart_count: 0,
                    last_exit_at: None,
                    restart_policy,
                };

                Ok(PersistedSession { meta, env, cols, rows })
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

    /// Deletes a session and its buffer data.
    pub fn delete_session(&self, id: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        
        // session_buffers has ON DELETE CASCADE, so this removes both
        conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])?;

        Ok(())
    }

    /// Removes expired session buffers (older than TTL).
    /// Returns the number of buffers deleted.
    pub fn cleanup_expired(&self, ttl_hours: u64) -> Result<usize, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let cutoff = now_ms() - (ttl_hours * 60 * 60 * 1000);

        let deleted = conn.execute(
            "DELETE FROM session_buffers WHERE updated_at < ?1",
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
    use crate::pty::session::{SessionType, now_ms as session_now_ms};
    use tempfile::NamedTempFile;

    fn create_test_store() -> (SessionStore, NamedTempFile) {
        let temp = NamedTempFile::new().unwrap();
        let store = SessionStore::open(temp.path()).unwrap();
        (store, temp)
    }

    fn create_test_session() -> SessionMeta {
        SessionMeta {
            id: "test-session-1".to_string(),
            project: Some("test-project".to_string()),
            command: "npm run dev".to_string(),
            cwd: "/test/path".to_string(),
            session_type: SessionType::Shell,
            alive: true,
            exit_code: None,
            started_at: session_now_ms(),
            restart_count: 0,
            last_exit_at: None,
            restart_policy: RestartPolicy::OnFailure,
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

        store.save_session(&meta, &env, 120, 32, 5).unwrap();

        let sessions = store.load_sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].meta.id, "test-session-1");
        assert_eq!(sessions[0].meta.command, "npm run dev");
        assert_eq!(sessions[0].env.get("NODE_ENV").unwrap(), "development");
        assert_eq!(sessions[0].cols, 120);
        assert_eq!(sessions[0].rows, 32);
    }

    #[test]
    fn save_and_load_buffer() {
        let (store, _temp) = create_test_store();
        let meta = create_test_session();
        let env = HashMap::new();
        
        // Save session first (required by FK constraint)
        store.save_session(&meta, &env, 120, 32, 5).unwrap();
        
        let data = b"hello terminal output";
        store.save_buffer("test-session-1", data, 21).unwrap();

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

        store.save_session(&meta, &env, 120, 32, 5).unwrap();
        store.save_buffer("test-session-1", b"data", 4).unwrap();

        store.delete_session("test-session-1").unwrap();

        let sessions = store.load_sessions().unwrap();
        assert_eq!(sessions.len(), 0);

        let buffer = store.load_buffer("test-session-1").unwrap();
        assert!(buffer.is_none());
    }

    #[test]
    fn cleanup_expired_buffers() {
        let (store, _temp) = create_test_store();
        let meta = SessionMeta {
            id: "session-1".to_string(),
            project: None,
            command: "test".to_string(),
            cwd: "/".to_string(),
            session_type: SessionType::Shell,
            alive: true,
            exit_code: None,
            started_at: session_now_ms(),
            restart_count: 0,
            last_exit_at: None,
            restart_policy: RestartPolicy::Never,
        };
        let env = HashMap::new();
        
        // Save session first (required by FK constraint)
        store.save_session(&meta, &env, 120, 32, 5).unwrap();
        
        // Save a buffer with current timestamp
        store.save_buffer("session-1", b"recent", 6).unwrap();
        
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
