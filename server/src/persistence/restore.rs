use tracing::{debug, info, warn};

use crate::{
    config::schema::{DamHopperConfig, RestartPolicy},
    error::AppError,
    pty::manager::{PtyCreateOpts, PtySessionManager},
};

use super::SessionStore;

/// Restores sessions from SQLite persistence on server startup.
///
/// ## Behavior
/// - Only sessions with `restart_policy != Never` are restored.
/// - Only sessions that were alive at persist time are restored.
/// - Sessions for removed projects are skipped with warning.
/// - Buffer data is loaded lazily via `terminal:attach`, not here.
///
/// ## Returns
/// Number of sessions successfully restored.
///
/// ## Errors
/// Returns error only if database is corrupt/inaccessible.
/// Individual session restore failures are logged as warnings and skipped.
pub async fn restore_sessions(
    store: &SessionStore,
    pty_manager: &PtySessionManager,
    config: &DamHopperConfig,
) -> Result<usize, AppError> {
    let persisted = store
        .load_sessions()
        .map_err(|e| AppError::PersistenceError(e.to_string()))?;

    let mut restored = 0;

    for session in persisted {
        // Skip non-restartable sessions
        if session.meta.restart_policy == RestartPolicy::Never {
            debug!(id = %session.meta.id, "Skipping never-restart session");
            continue;
        }

        // Verify project still exists in config
        let project_exists = config
            .projects
            .iter()
            .any(|p| Some(&p.name) == session.meta.project.as_ref());

        if session.meta.project.is_some() && !project_exists {
            warn!(
                id = %session.meta.id,
                project = ?session.meta.project,
                "Skipping session for removed project"
            );
            continue;
        }

        // Spawn PTY
        // Use restart_max_retries from project config if available, otherwise use default
        let restart_max_retries = session
            .meta
            .project
            .as_ref()
            .and_then(|proj_name| {
                config
                    .projects
                    .iter()
                    .find(|p| &p.name == proj_name)
                    .map(|p| p.restart_max_retries)
            })
            .unwrap_or(crate::config::schema::DEFAULT_RESTART_MAX_RETRIES);

        let opts = PtyCreateOpts {
            id: session.meta.id.clone(),
            command: session.meta.command.clone(),
            cwd: session.meta.cwd.clone(),
            env: session.env,
            cols: session.cols,
            rows: session.rows,
            project: session.meta.project.clone(),
            restart_policy: session.meta.restart_policy,
            restart_max_retries,
        };

        match pty_manager.create(opts) {
            Ok(_) => {
                info!(id = %session.meta.id, "Restored session from persistence");
                restored += 1;
            }
            Err(e) => {
                warn!(id = %session.meta.id, error = %e, "Failed to restore session");
            }
        }
    }

    // Cleanup expired buffers
    let expired = store
        .cleanup_expired(config.server.session_buffer_ttl_hours)
        .map_err(|e| AppError::PersistenceError(e.to_string()))?;

    if expired > 0 {
        info!(count = expired, "Cleaned up expired session buffers");
    }

    Ok(restored)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        config::schema::{
            DamHopperConfig, ProjectConfig, ProjectType, ServerConfig, WorkspaceInfo,
        },
        persistence::SessionStore,
        pty::{event_sink::BroadcastEventSink, session::SessionMeta},
    };
    use std::{collections::HashMap, path::PathBuf, sync::Arc};
    use tempfile::NamedTempFile;

    fn create_test_store() -> (SessionStore, NamedTempFile) {
        let temp = NamedTempFile::new().unwrap();
        let store = SessionStore::open(temp.path()).unwrap();
        (store, temp)
    }

    fn create_test_config() -> DamHopperConfig {
        DamHopperConfig {
            workspace: WorkspaceInfo {
                name: "test-workspace".to_string(),
                root: ".".to_string(),
            },
            agent_store: None,
            server: ServerConfig {
                session_persistence: true,
                session_db_path: "test.db".to_string(),
                session_buffer_ttl_hours: 24,
            },
            projects: vec![ProjectConfig {
                name: "test-project".to_string(),
                path: "/test/path".to_string(),
                project_type: ProjectType::Npm,
                services: None,
                commands: None,
                env_file: None,
                tags: None,
                terminals: vec![],
                agents: None,
                restart_policy: RestartPolicy::OnFailure,
                restart_max_retries: 5,
                health_check_url: None,
            }],
            features: Default::default(),
            config_path: PathBuf::from("/test/dam-hopper.toml"),
        }
    }

    #[tokio::test]
    async fn restore_skips_never_restart_sessions() {
        let (store, _temp) = create_test_store();
        let config = create_test_config();

        // Create a session with Never restart policy
        let meta = SessionMeta {
            id: "test-session-1".to_string(),
            project: Some("test-project".to_string()),
            command: "npm run dev".to_string(),
            cwd: "/test/path".to_string(),
            session_type: crate::pty::session::SessionType::Shell,
            alive: true,
            exit_code: None,
            started_at: crate::pty::session::now_ms(),
            restart_count: 0,
            last_exit_at: None,
            restart_policy: RestartPolicy::Never,
        };

        let env = HashMap::new();
        store.save_session(&meta, &env, 120, 32, 5).unwrap();

        // Create manager
        let (event_sink, _rx) = BroadcastEventSink::new(100);
        let pty_manager = PtySessionManager::new(Arc::new(event_sink));

        // Restore should skip the session
        let restored = restore_sessions(&store, &pty_manager, &config)
            .await
            .unwrap();

        assert_eq!(restored, 0);
    }

    #[tokio::test]
    async fn restore_skips_removed_project_sessions() {
        let (store, _temp) = create_test_store();
        let mut config = create_test_config();

        // Save session for a project
        let meta = SessionMeta {
            id: "test-session-3".to_string(),
            project: Some("removed-project".to_string()), // Project doesn't exist in config
            command: "npm start".to_string(),
            cwd: "/test/path".to_string(),
            session_type: crate::pty::session::SessionType::Run,
            alive: true,
            exit_code: None,
            started_at: crate::pty::session::now_ms(),
            restart_count: 0,
            last_exit_at: None,
            restart_policy: RestartPolicy::Always,
        };

        let env = HashMap::new();
        store.save_session(&meta, &env, 120, 32, 5).unwrap();

        // Remove project from config
        config.projects.clear();

        // Create manager
        let (event_sink, _rx) = BroadcastEventSink::new(100);
        let pty_manager = PtySessionManager::new(Arc::new(event_sink));

        // Restore should skip the session for removed project
        let restored = restore_sessions(&store, &pty_manager, &config)
            .await
            .unwrap();

        assert_eq!(restored, 0);
    }

    #[tokio::test]
    async fn restore_successfully_spawns_restartable_sessions() {
        let (store, _temp) = create_test_store();
        let config = create_test_config();

        // Save a restartable session (OnFailure policy, alive)
        let meta = SessionMeta {
            id: "test-session-4".to_string(),
            project: Some("test-project".to_string()),
            command: "echo 'test'".to_string(),
            cwd: "/test/path".to_string(),
            session_type: crate::pty::session::SessionType::Shell,
            alive: true, // Will be ignored (sessions in DB are alive candidates)
            exit_code: None,
            started_at: crate::pty::session::now_ms(),
            restart_count: 0,
            last_exit_at: None,
            restart_policy: RestartPolicy::OnFailure,
        };

        let env = HashMap::new();
        store.save_session(&meta, &env, 120, 32, 5).unwrap();

        // Create manager
        let (event_sink, _rx) = BroadcastEventSink::new(100);
        let pty_manager = PtySessionManager::new(Arc::new(event_sink));

        // Restore should successfully spawn the session
        let restored = restore_sessions(&store, &pty_manager, &config)
            .await
            .unwrap();

        assert_eq!(restored, 1, "Should restore 1 session");

        // Verify session exists in manager
        let sessions = pty_manager.list();
        assert_eq!(sessions.len(), 1, "Manager should have 1 session");
        assert_eq!(sessions[0].id, "test-session-4");
        assert!(sessions[0].alive, "Restored session should be alive");
    }
}
