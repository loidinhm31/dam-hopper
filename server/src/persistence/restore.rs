use tracing::{info, warn};

use crate::{
    config::schema::{DamHopperConfig, ProjectConfig},
    error::AppError,
    fs::FsError,
    pty::manager::{PtyCreateOpts, PtySessionManager},
    state::AppState,
    workspace_target::WorkspaceTargetError,
};

use super::SessionStore;

/// Restores sessions from SQLite persistence on server startup.
///
/// ## Behavior
/// - Only sessions with `alive = 1` in the DB are considered. Explicitly
///   target-unavailable sessions are restored as non-running orphan metadata;
///   all other rows are respawned.
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
    restore_sessions_inner(
        store,
        pty_manager,
        &config.projects,
        config.server.session_buffer_ttl_hours,
    )
    .await
}

/// Restore sessions after the application state has installed target
/// validation. Target-scoped sessions are skipped when their registered
/// worktree or persisted cwd is no longer authorized.
pub async fn restore_sessions_with_state(
    store: &SessionStore,
    state: &AppState,
) -> Result<usize, AppError> {
    // Keep restore validation and PTY creation in the same lifecycle boundary
    // as worktree removal; otherwise a target could disappear between them.
    let _workspace_context = state.workspace_context_guard.write().await;
    let (projects, session_buffer_ttl_hours) = {
        let config = state.config.read().await;
        (
            config.projects.clone(),
            config.server.session_buffer_ttl_hours,
        )
    };
    restore_sessions_inner(
        store,
        &state.pty_manager,
        &projects,
        session_buffer_ttl_hours,
    )
    .await
}

async fn restore_sessions_inner(
    store: &SessionStore,
    pty_manager: &PtySessionManager,
    projects: &[ProjectConfig],
    session_buffer_ttl_hours: u64,
) -> Result<usize, AppError> {
    store
        .cleanup_dead_sessions()
        .map_err(|e| AppError::PersistenceError(e.to_string()))?;
    let persisted = store
        .load_sessions()
        .map_err(|e| AppError::PersistenceError(e.to_string()))?;

    let mut restored = 0;

    for session in persisted {
        let id = session.meta.id.clone();

        // Verify project still exists in config
        let project_exists = projects
            .iter()
            .any(|p| Some(&p.name) == session.meta.project.as_ref());

        if session.meta.project.is_some() && !project_exists {
            warn!(
                id = %id,
                project = ?session.meta.project,
                "Deleting session for removed project"
            );
            store
                .delete_session_for_incarnation(&id, session.incarnation)
                .map_err(|e| AppError::PersistenceError(e.to_string()))?;
            continue;
        }

        let restore_target = match (
            session.meta.project.as_deref(),
            session.meta.worktree_path.as_deref(),
        ) {
            (Some(project), Some(worktree_path)) => Some((
                project.to_string(),
                worktree_path.to_string(),
                session.meta.cwd.clone(),
            )),
            (None, Some(worktree_path)) => {
                warn!(
                    id = %id,
                    worktree_path,
                    "Deleting persisted terminal with target but no project"
                );
                store
                    .delete_session_for_incarnation(&id, session.incarnation)
                    .map_err(|e| AppError::PersistenceError(e.to_string()))?;
                continue;
            }
            _ => None,
        };
        let persisted_meta = session.meta.clone();
        let persisted_incarnation = session.incarnation;

        if session.meta.target_unavailable {
            pty_manager.restore_unavailable_session(session.meta.clone(), session.incarnation);
            info!(id = %id, "Restored unavailable terminal identity without respawn");
            continue;
        }

        // Use restart_max_retries from project config if available, otherwise use default
        let restart_max_retries = session
            .meta
            .project
            .as_ref()
            .and_then(|proj_name| {
                projects
                    .iter()
                    .find(|p| &p.name == proj_name)
                    .map(|p| p.restart_max_retries)
            })
            .unwrap_or(crate::config::schema::DEFAULT_RESTART_MAX_RETRIES);

        let (cwd, worktree_path) = match (
            session.meta.project.as_deref(),
            session.meta.worktree_path.as_deref(),
        ) {
            (Some(project), Some(worktree_path)) => {
                match pty_manager
                    .validate_targeted_session(project, worktree_path, &session.meta.cwd)
                    .await
                {
                    Ok((canonical_target, canonical_cwd)) => {
                        (canonical_cwd, Some(canonical_target))
                    }
                    Err(error) if is_target_unavailable_error(&error) => {
                        warn!(
                            id = %id,
                            project,
                            worktree_path,
                            error = %error,
                            "Skipping persisted terminal for unavailable worktree target"
                        );
                        store
                            .mark_session_target_unavailable_for_incarnation(
                                &id,
                                session.incarnation,
                            )
                            .map_err(|store_error| {
                                AppError::PersistenceError(store_error.to_string())
                            })?;
                        pty_manager
                            .restore_unavailable_session(session.meta.clone(), session.incarnation);
                        continue;
                    }
                    Err(error) => {
                        warn!(
                            id = %id,
                            project,
                            worktree_path,
                            error = %error,
                            "Deleting persisted terminal with invalid worktree target"
                        );
                        store
                            .delete_session_for_incarnation(&id, session.incarnation)
                            .map_err(|store_error| {
                                AppError::PersistenceError(store_error.to_string())
                            })?;
                        continue;
                    }
                }
            }
            _ => (session.meta.cwd.clone(), session.meta.worktree_path.clone()),
        };

        let opts = PtyCreateOpts {
            id: id.clone(),
            command: session.meta.command.clone(),
            cwd,
            env: session.env,
            cols: session.cols,
            rows: session.rows,
            project: session.meta.project.clone(),
            worktree_path,
            name: session.meta.name.clone(),
            restart_policy: session.meta.restart_policy,
            restart_max_retries,
        };

        // Read the snapshot before creating the PTY. `create_with_buffer`
        // hydrates it before the reader thread starts, so fast startup output
        // cannot overwrite the pre-restart history first.
        let initial_buffer = match store.load_buffer(&id) {
            Ok(buffer) => buffer,
            Err(error) => {
                warn!(id = %id, error = %error, "Failed to load buffer for hydration");
                None
            }
        };
        let initial_buffer_info = initial_buffer
            .as_ref()
            .map(|(data, total_written)| (data.len(), *total_written));

        match pty_manager.create_with_buffer(opts, initial_buffer) {
            Ok(_) => {
                if let Some((bytes, total_written)) = initial_buffer_info {
                    info!(
                        id = %id,
                        bytes,
                        total_written,
                        "Hydrated restored session buffer"
                    );
                }
                info!(id = %id, "Restored session from persistence");
                restored += 1;
            }
            Err(e) => {
                let target_disappeared =
                    if let Some((project, worktree_path, cwd)) = &restore_target {
                        match pty_manager
                            .validate_targeted_session(project, worktree_path, cwd)
                            .await
                        {
                            Ok(_) => false,
                            Err(error) => is_target_unavailable_error(&error),
                        }
                    } else {
                        false
                    };

                if target_disappeared {
                    warn!(
                        id = %id,
                        error = %e,
                        "Target disappeared while restoring terminal; retaining unavailable identity"
                    );
                    store
                        .mark_session_target_unavailable_for_incarnation(&id, persisted_incarnation)
                        .map_err(|store_error| {
                            AppError::PersistenceError(store_error.to_string())
                        })?;
                    pty_manager.restore_unavailable_session(persisted_meta, persisted_incarnation);
                } else {
                    warn!(id = %id, error = %e, "Deleting failed persisted session");
                    store
                        .delete_session_for_incarnation(&id, persisted_incarnation)
                        .map_err(|store_error| {
                            AppError::PersistenceError(store_error.to_string())
                        })?;
                }
            }
        }
    }

    // Cleanup expired buffers
    let expired = store
        .cleanup_expired(session_buffer_ttl_hours)
        .map_err(|e| AppError::PersistenceError(e.to_string()))?;

    if expired > 0 {
        info!(count = expired, "Cleaned up expired session buffers");
    }

    Ok(restored)
}

fn is_target_unavailable_error(error: &AppError) -> bool {
    matches!(
        error,
        AppError::WorkspaceTarget(
            WorkspaceTargetError::UnregisteredTarget | WorkspaceTargetError::UnavailableTarget
        ) | AppError::Fs(FsError::NotFound)
            | AppError::NotFound(_)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        config::schema::{
            DamHopperConfig, ProjectConfig, ProjectType, RestartPolicy, ServerConfig, WorkspaceInfo,
        },
        fs::FsSubsystem,
        persistence::SessionStore,
        pty::{
            event_sink::BroadcastEventSink, session::SessionMeta, PtySessionManager,
            PtyTargetContext,
        },
        workspace_target::WorkspaceTargetResolver,
    };
    use std::{
        collections::HashMap,
        path::{Path, PathBuf},
        process::Command,
        sync::Arc,
    };
    use tempfile::NamedTempFile;

    fn create_test_store() -> (SessionStore, NamedTempFile) {
        let temp = NamedTempFile::new().unwrap();
        let store = SessionStore::open(temp.path()).unwrap();
        (store, temp)
    }

    #[test]
    fn restore_reconciles_only_target_loss_errors() {
        use crate::{error::AppError, fs::FsError, workspace_target::WorkspaceTargetError};

        assert!(is_target_unavailable_error(&AppError::WorkspaceTarget(
            WorkspaceTargetError::UnregisteredTarget,
        )));
        assert!(is_target_unavailable_error(&AppError::WorkspaceTarget(
            WorkspaceTargetError::UnavailableTarget,
        )));
        assert!(is_target_unavailable_error(&AppError::Fs(
            FsError::NotFound
        )));
        assert!(is_target_unavailable_error(&AppError::NotFound(
            "missing target".to_string(),
        )));

        assert!(!is_target_unavailable_error(&AppError::WorkspaceTarget(
            WorkspaceTargetError::InvalidPath,
        )));
        assert!(!is_target_unavailable_error(&AppError::WorkspaceTarget(
            WorkspaceTargetError::UnknownProject,
        )));
        assert!(!is_target_unavailable_error(&AppError::PtyError(
            "spawn failed".to_string(),
        )));
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
                telemetry: crate::config::TelemetryConfig::default(),
                host_resources: crate::config::HostResourceMonitorConfig::default(),
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

    fn git(args: &[&str], cwd: &Path) {
        let output = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn init_git_repo(path: &Path) {
        git(&["init", "-b", "main"], path);
        git(&["config", "user.email", "test@example.com"], path);
        git(&["config", "user.name", "Test User"], path);
        std::fs::write(path.join("README.md"), "root\n").unwrap();
        git(&["add", "README.md"], path);
        git(&["commit", "-m", "init"], path);
    }

    fn install_target_context(manager: &PtySessionManager, project_root: &Path) {
        manager.set_target_context(PtyTargetContext::new(
            FsSubsystem::new(vec![(
                "test-project".to_string(),
                project_root.to_path_buf(),
            )]),
            WorkspaceTargetResolver::new(),
            Arc::new(tokio::sync::RwLock::new(())),
        ));
    }

    #[tokio::test]
    async fn restore_respawns_never_policy_sessions() {
        // Persistence no longer gates on restart_policy — any session that was
        // alive when the server stopped should come back on restart.
        let (store, _temp) = create_test_store();
        let config = create_test_config();

        let meta = SessionMeta {
            id: "test-never-session".to_string(),
            incarnation: 0,
            project: Some("test-project".to_string()),
            command: "echo hi".to_string(),
            cwd: "/test/path".to_string(),
            worktree_path: None,
            name: None,
            session_type: crate::pty::session::SessionType::Shell,
            alive: true,
            exit_code: None,
            started_at: crate::pty::session::now_ms(),
            restart_count: 0,
            last_exit_at: None,
            restart_policy: RestartPolicy::Never,
            target_unavailable: false,
        };

        let env = HashMap::new();
        store
            .save_session_for_incarnation(&meta, 0, &env, 120, 32, 5)
            .unwrap();

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
            incarnation: 0,
            project: Some("test-project".to_string()),
            command: "echo done".to_string(),
            cwd: "/test/path".to_string(),
            worktree_path: None,
            name: None,
            session_type: crate::pty::session::SessionType::Shell,
            alive: true,
            exit_code: None,
            started_at: crate::pty::session::now_ms(),
            restart_count: 0,
            last_exit_at: None,
            restart_policy: RestartPolicy::OnFailure,
            target_unavailable: false,
        };

        let env = HashMap::new();
        store
            .save_session_for_incarnation(&meta, 0, &env, 120, 32, 5)
            .unwrap();
        store
            .mark_session_dead_for_incarnation("test-dead-session", 0)
            .unwrap();

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
            incarnation: 0,
            project: Some("test-project".to_string()),
            command: "true".to_string(),
            cwd: "/test/path".to_string(),
            worktree_path: None,
            name: None,
            session_type: crate::pty::session::SessionType::Shell,
            alive: true,
            exit_code: None,
            started_at: crate::pty::session::now_ms(),
            restart_count: 0,
            last_exit_at: None,
            restart_policy: RestartPolicy::Never,
            target_unavailable: false,
        };

        let env = HashMap::new();
        store
            .save_session_for_incarnation(&meta, 0, &env, 120, 32, 5)
            .unwrap();
        let persisted = b"pre-restart history\n";
        store
            .save_buffer_for_incarnation("test-hydrate", 0, persisted, persisted.len() as u64)
            .unwrap();

        let (event_sink, _rx) = BroadcastEventSink::new(100);
        let pty_manager = PtySessionManager::new(Arc::new(event_sink));

        let restored = restore_sessions(&store, &pty_manager, &config)
            .await
            .unwrap();
        assert_eq!(restored, 1);

        // Give the freshly-spawned `true` process a moment, then read the
        // buffer. Hydration is owned by create(), so the persisted bytes must
        // appear exactly once.
        let replay = pty_manager
            .get_buffer_with_offset("test-hydrate", None)
            .unwrap();
        assert_eq!(replay.data, "pre-restart history\n");
        assert_eq!(replay.offset, persisted.len() as u64);
    }

    #[tokio::test]
    async fn restore_skips_removed_project_sessions() {
        let (store, _temp) = create_test_store();
        let mut config = create_test_config();

        // Save session for a project
        let meta = SessionMeta {
            id: "test-session-3".to_string(),
            incarnation: 0,
            project: Some("removed-project".to_string()), // Project doesn't exist in config
            command: "npm start".to_string(),
            cwd: "/test/path".to_string(),
            worktree_path: None,
            name: None,
            session_type: crate::pty::session::SessionType::Run,
            alive: true,
            exit_code: None,
            started_at: crate::pty::session::now_ms(),
            restart_count: 0,
            last_exit_at: None,
            restart_policy: RestartPolicy::Always,
            target_unavailable: false,
        };

        let env = HashMap::new();
        store
            .save_session_for_incarnation(&meta, 0, &env, 120, 32, 5)
            .unwrap();

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
            incarnation: 0,
            project: Some("test-project".to_string()),
            command: "echo 'test'".to_string(),
            cwd: "/test/path".to_string(),
            worktree_path: None,
            name: None,
            session_type: crate::pty::session::SessionType::Shell,
            alive: true, // Will be ignored (sessions in DB are alive candidates)
            exit_code: None,
            started_at: crate::pty::session::now_ms(),
            restart_count: 0,
            last_exit_at: None,
            restart_policy: RestartPolicy::OnFailure,
            target_unavailable: false,
        };

        let env = HashMap::new();
        store
            .save_session_for_incarnation(&meta, 0, &env, 120, 32, 5)
            .unwrap();

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

    #[tokio::test]
    async fn restore_retains_session_for_unavailable_worktree() {
        let repo = tempfile::tempdir().unwrap();
        let worktree_parent = tempfile::tempdir().unwrap();
        init_git_repo(repo.path());
        git(&["branch", "feature"], repo.path());
        let worktree = worktree_parent.path().join("feature");
        let worktree_text = worktree.to_string_lossy().into_owned();
        git(&["worktree", "add", &worktree_text, "feature"], repo.path());
        std::fs::remove_dir_all(&worktree).unwrap();

        let (store, _temp) = create_test_store();
        let mut config = create_test_config();
        config.projects[0].path = repo.path().to_string_lossy().into_owned();
        let meta = SessionMeta {
            id: "stale-worktree-session".to_string(),
            incarnation: 0,
            project: Some("test-project".to_string()),
            command: "sleep 30".to_string(),
            cwd: worktree_text.clone(),
            worktree_path: Some(worktree_text),
            name: None,
            session_type: crate::pty::session::SessionType::Terminal,
            alive: true,
            exit_code: None,
            started_at: crate::pty::session::now_ms(),
            restart_count: 0,
            last_exit_at: None,
            restart_policy: RestartPolicy::Always,
            target_unavailable: false,
        };
        store
            .save_session_for_incarnation(&meta, 0, &HashMap::new(), 80, 24, 5)
            .unwrap();

        let (event_sink, _rx) = BroadcastEventSink::new(100);
        let pty_manager = PtySessionManager::new(Arc::new(event_sink));
        install_target_context(&pty_manager, repo.path());

        let restored = restore_sessions(&store, &pty_manager, &config)
            .await
            .unwrap();

        assert_eq!(restored, 0);
        let sessions = pty_manager.list();
        assert_eq!(sessions.len(), 1);
        assert!(!sessions[0].alive);
        assert!(sessions[0].target_unavailable);
    }

    #[tokio::test]
    async fn restore_deletes_malformed_target_unavailable_rows() {
        let (store, _temp) = create_test_store();
        let config = create_test_config();
        let meta = SessionMeta {
            id: "malformed-target-unavailable".to_string(),
            incarnation: 0,
            project: None,
            command: "sleep 30".to_string(),
            cwd: "/missing/worktree".to_string(),
            worktree_path: Some("/missing/worktree".to_string()),
            name: Some("Retain only valid targets".to_string()),
            session_type: crate::pty::session::SessionType::Terminal,
            alive: true,
            exit_code: None,
            started_at: crate::pty::session::now_ms(),
            restart_count: 0,
            last_exit_at: None,
            restart_policy: RestartPolicy::Always,
            target_unavailable: true,
        };
        store
            .save_session_for_incarnation(&meta, 0, &HashMap::new(), 80, 24, 5)
            .unwrap();

        let (event_sink, _rx) = BroadcastEventSink::new(100);
        let pty_manager = PtySessionManager::new(Arc::new(event_sink));

        let restored = restore_sessions(&store, &pty_manager, &config)
            .await
            .unwrap();

        assert_eq!(restored, 0);
        assert!(pty_manager.list().is_empty());
        assert!(store.load_sessions().unwrap().is_empty());
    }

    #[tokio::test]
    async fn restore_revalidates_external_worktree_and_nested_cwd() {
        let repo = tempfile::tempdir().unwrap();
        let worktree_parent = tempfile::tempdir().unwrap();
        init_git_repo(repo.path());
        git(&["branch", "feature"], repo.path());
        let worktree = worktree_parent.path().join("feature");
        let worktree_text = worktree.to_string_lossy().into_owned();
        git(&["worktree", "add", &worktree_text, "feature"], repo.path());
        let nested = worktree.join("src");
        std::fs::create_dir(&nested).unwrap();

        let (store, _temp) = create_test_store();
        let mut config = create_test_config();
        config.projects[0].path = repo.path().to_string_lossy().into_owned();
        let meta = SessionMeta {
            id: "external-worktree-session".to_string(),
            incarnation: 0,
            project: Some("test-project".to_string()),
            command: "sleep 30".to_string(),
            cwd: nested.to_string_lossy().into_owned(),
            worktree_path: Some(worktree_text.clone()),
            name: None,
            session_type: crate::pty::session::SessionType::Terminal,
            alive: true,
            exit_code: None,
            started_at: crate::pty::session::now_ms(),
            restart_count: 0,
            last_exit_at: None,
            restart_policy: RestartPolicy::Always,
            target_unavailable: false,
        };
        store
            .save_session_for_incarnation(&meta, 0, &HashMap::new(), 80, 24, 5)
            .unwrap();

        let (event_sink, _rx) = BroadcastEventSink::new(100);
        let pty_manager = PtySessionManager::new(Arc::new(event_sink));
        install_target_context(&pty_manager, repo.path());

        let restored = restore_sessions(&store, &pty_manager, &config)
            .await
            .unwrap();

        assert_eq!(restored, 1);
        let session = pty_manager.list().into_iter().next().unwrap();
        assert_eq!(
            session.worktree_path.as_deref(),
            Some(worktree_text.as_str())
        );
        assert_eq!(
            session.cwd,
            dunce::canonicalize(nested).unwrap().to_string_lossy()
        );
        pty_manager.kill("external-worktree-session").unwrap();
    }
}
