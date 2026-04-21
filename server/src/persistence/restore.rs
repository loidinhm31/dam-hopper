use tracing::{debug, info, warn};

use crate::{
    config::schema::DamHopperConfig,
    error::AppError,
    pty::manager::{PtyCreateOpts, PtySessionManager},
};

use super::SessionStore;

/// Restores sessions from SQLite persistence on server startup.
///
/// ## Behavior
/// - Only sessions with `alive = 1` in the DB are restored (cleanly exited
///   or explicitly removed sessions stay dormant).
/// - Sessions for removed projects are skipped with warning.
/// - The restored session's scrollback is hydrated from the persisted buffer
///   so clients see pre-restart history on `terminal:attach`.
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
        let id = session.meta.id.clone();

        // Verify project still exists in config
        let project_exists = config
            .projects
            .iter()
            .any(|p| Some(&p.name) == session.meta.project.as_ref());

        if session.meta.project.is_some() && !project_exists {
            warn!(
                id = %id,
                project = ?session.meta.project,
                "Skipping session for removed project"
            );
            continue;
        }

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
            id: id.clone(),
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
                // Hydrate the new PTY's scrollback with persisted output so
                // the client sees history on attach. The re-spawned process
                // will then append new output on top.
                match store.load_buffer(&id) {
                    Ok(Some((data, total_written))) => {
                        if let Err(e) = pty_manager.hydrate_buffer(&id, &data, total_written) {
                            warn!(id = %id, error = %e, "Failed to hydrate restored buffer");
                        } else {
                            debug!(
                                id = %id,
                                bytes = data.len(),
                                total_written,
                                "Hydrated restored session buffer"
                            );
                        }
                    }
                    Ok(None) => {
                        debug!(id = %id, "No persisted buffer to hydrate");
                    }
                    Err(e) => {
                        warn!(id = %id, error = %e, "Failed to load buffer for hydration");
                    }
                }

                info!(id = %id, "Restored session from persistence");
                restored += 1;
            }
            Err(e) => {
                warn!(id = %id, error = %e, "Failed to restore session");
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
            DamHopperConfig, ProjectConfig, ProjectType, RestartPolicy, ServerConfig,
            WorkspaceInfo,
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
    async fn restore_respawns_never_policy_sessions() {
        // Persistence no longer gates on restart_policy — any session that was
        // alive when the server stopped should come back on restart.
        let (store, _temp) = create_test_store();
        let config = create_test_config();

        let meta = SessionMeta {
            id: "test-never-session".to_string(),
            project: Some("test-project".to_string()),
            command: "echo hi".to_string(),
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

        let (event_sink, _rx) = BroadcastEventSink::new(100);
        let pty_manager = PtySessionManager::new(Arc::new(event_sink));

        let restored = restore_sessions(&store, &pty_manager, &config)
            .await
            .unwrap();

        assert_eq!(restored, 1);
    }

    #[tokio::test]
    async fn restore_skips_dead_sessions() {
        let (store, _temp) = create_test_store();
        let config = create_test_config();

        let meta = SessionMeta {
            id: "test-dead-session".to_string(),
            project: Some("test-project".to_string()),
            command: "echo done".to_string(),
            cwd: "/test/path".to_string(),
            session_type: crate::pty::session::SessionType::Shell,
            alive: true,
            exit_code: None,
            started_at: crate::pty::session::now_ms(),
            restart_count: 0,
            last_exit_at: None,
            restart_policy: RestartPolicy::OnFailure,
        };

        let env = HashMap::new();
        store.save_session(&meta, &env, 120, 32, 5).unwrap();
        store.mark_session_dead("test-dead-session").unwrap();

        let (event_sink, _rx) = BroadcastEventSink::new(100);
        let pty_manager = PtySessionManager::new(Arc::new(event_sink));

        let restored = restore_sessions(&store, &pty_manager, &config)
            .await
            .unwrap();

        assert_eq!(restored, 0, "Sessions marked dead must not respawn");
    }

    #[tokio::test]
    async fn restore_hydrates_buffer_from_persistence() {
        let (store, _temp) = create_test_store();
        let config = create_test_config();

        let meta = SessionMeta {
            id: "test-hydrate".to_string(),
            project: Some("test-project".to_string()),
            command: "true".to_string(),
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
        let persisted = b"pre-restart history\n";
        store
            .save_buffer("test-hydrate", persisted, persisted.len() as u64)
            .unwrap();

        let (event_sink, _rx) = BroadcastEventSink::new(100);
        let pty_manager = PtySessionManager::new(Arc::new(event_sink));

        let restored = restore_sessions(&store, &pty_manager, &config)
            .await
            .unwrap();
        assert_eq!(restored, 1);

        // Give the freshly-spawned `true` process a moment, then read the buffer.
        // Hydrated bytes must appear at the start regardless of what the new
        // process prints.
        let (data, _) = pty_manager
            .get_buffer_with_offset("test-hydrate", None)
            .unwrap();
        assert!(
            data.contains("pre-restart history"),
            "expected hydrated buffer in {data:?}"
        );
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
