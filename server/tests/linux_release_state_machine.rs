//! State machine transition, crash recovery, and retention tests.

mod common;

use dam_hopper_server::linux_release::*;
use std::{
    cell::RefCell,
    env,
    fs,
    rc::Rc,
};
use tempfile::tempdir;

#[test]
fn test_api_runtime_lifecycle_matrix_records_route_ordering() {
    let root = tempdir().unwrap();
    let layout = Layout::with_root(root.path());
    let mut candidates = Vec::new();
    for variable in ["USER", "LOGNAME"] {
        if let Ok(username) = env::var(variable) {
            candidates.push(username);
        }
    }
    candidates.extend(["nobody".to_string(), "daemon".to_string()]);
    let (username, user_info) = candidates
        .into_iter()
        .find_map(|username| {
            get_user_by_name(&username)
                .filter(|info| info.uid != 0 && info.gid != 0)
                .map(|info| (username, info))
        })
        .expect("a non-root API test account must exist");
    let group = get_group_by_gid(user_info.gid).expect("API test account primary group");
    let unit_path = root.path().join("dam-hopper-api.service");
    fs::write(
        &unit_path,
        format!("[Service]\nUser={username}\nGroup={group}\n"),
    )
    .unwrap();

    let role_name = |role: Option<TargetRole>| role.map_or("none", |role| role.as_str());
    let cases = [
        (
            "activation-server-candidate",
            Some(TargetRole::Web),
            Some(TargetRole::Server),
            TargetRole::Server,
            true,
        ),
        (
            "activation-web-candidate",
            Some(TargetRole::Server),
            Some(TargetRole::Web),
            TargetRole::Web,
            true,
        ),
        (
            "activation-both-candidate",
            Some(TargetRole::Web),
            Some(TargetRole::Both),
            TargetRole::Both,
            true,
        ),
        (
            "rollback-server-prior-active",
            Some(TargetRole::Web),
            Some(TargetRole::Server),
            TargetRole::Server,
            true,
        ),
        (
            "rollback-web-prior-active",
            Some(TargetRole::Server),
            Some(TargetRole::Web),
            TargetRole::Web,
            true,
        ),
        (
            "recovery-server-active",
            Some(TargetRole::Server),
            Some(TargetRole::Web),
            TargetRole::Server,
            false,
        ),
        (
            "recovery-web-active",
            Some(TargetRole::Web),
            Some(TargetRole::Server),
            TargetRole::Web,
            false,
        ),
    ];

    for (route, previous_active, candidate_or_prior, becoming_active, starts_api) in cases {
        let events = Rc::new(RefCell::new(Vec::new()));
        let state_event = format!(
            "{route}:state-selected:{}:{}:{}",
            role_name(previous_active),
            role_name(candidate_or_prior),
            becoming_active.as_str()
        );
        events.borrow_mut().push(state_event.clone());

        if starts_api {
            if becoming_active.includes_server() {
                let provision_events = Rc::clone(&events);
                let start_events = Rc::clone(&events);
                let expected_uid = user_info.uid;
                let expected_gid = user_info.gid;
                provision_and_start_api_with(
                    &layout,
                    &unit_path,
                    move |_layout, identity| {
                        assert_eq!(
                            (identity.uid, identity.gid),
                            (expected_uid, expected_gid),
                            "{route} resolved unexpected API identity"
                        );
                        provision_events
                            .borrow_mut()
                            .push(format!("{route}:runtime-provisioned"));
                        Ok(())
                    },
                    move || {
                        start_events
                            .borrow_mut()
                            .push(format!("{route}:api-started"));
                        Ok(())
                    },
                )
                .unwrap();
            } else {
                events
                    .borrow_mut()
                    .push(format!("{route}:no-api-gate"));
            }
        } else {
            // Recovery provisions an active server during boot preflight but
            // deliberately leaves service startup to the normal boot path.
            if becoming_active.includes_server() {
                events
                    .borrow_mut()
                    .push(format!("{route}:runtime-provisioned"));
            } else {
                events
                    .borrow_mut()
                    .push(format!("{route}:no-api-gate"));
            }
            events.borrow_mut().push(format!("{route}:recovery-ready"));
        }

        let expected = if starts_api && becoming_active.includes_server() {
            vec![
                state_event,
                format!("{route}:runtime-provisioned"),
                format!("{route}:api-started"),
            ]
        } else if starts_api {
            vec![state_event, format!("{route}:no-api-gate")]
        } else if becoming_active.includes_server() {
            vec![
                state_event,
                format!("{route}:runtime-provisioned"),
                format!("{route}:recovery-ready"),
            ]
        } else {
            vec![
                state_event,
                format!("{route}:no-api-gate"),
                format!("{route}:recovery-ready"),
            ]
        };
        assert_eq!(events.borrow().as_slice(), expected.as_slice(), "{route}");
    }
}

#[test]
fn test_api_runtime_provision_rejects_root_identity() {
    let root = tempdir().unwrap();
    let layout = Layout::with_root(root.path());
    let identity = ApiRuntimeIdentity {
        user: "root".into(),
        group: "root".into(),
        uid: 0,
        gid: 0,
    };

    assert!(matches!(
        provision_api_runtime(&layout, &identity),
        Err(ReleaseError::Config(reason)) if reason.contains("non-root")
    ));
    assert!(!layout.api_state_dir().exists());
}

#[test]
fn test_durable_fs_primitives() {
    let root = tempdir().unwrap();
    let file_path = root.path().join("sub/dir/test.txt");

    atomic_write_file(&file_path, b"hello durable", Some(0o600)).expect("atomic write file");
    assert_eq!(fs::read_to_string(&file_path).unwrap(), "hello durable");

    let json_path = root.path().join("sub/dir/test.json");
    let test_val = serde_json::json!({ "key": "value", "num": 42 });
    atomic_write_json(&json_path, &test_val, Some(0o600)).expect("atomic write json");

    let copy_path = root.path().join("sub/dir/copy.txt");
    copy_file_durable(&file_path, &copy_path, Some(0o644)).expect("copy file durable");
    assert_eq!(fs::read_to_string(&copy_path).unwrap(), "hello durable");

    let symlink_path = root.path().join("sub/dir/link.txt");
    atomic_symlink(&copy_path, &symlink_path).expect("atomic symlink");
    assert_eq!(fs::read_link(&symlink_path).unwrap(), copy_path);
}

#[test]
fn test_state_envelope_lifecycle_and_generations() {
    let root = tempdir().unwrap();
    let state_path = root.path().join("state.json");

    let mut state = load_or_init_manager_state(&state_path).expect("init default state");
    assert_eq!(state.generation, 1);
    assert_eq!(state.current_deployment_state(), DeploymentState::Absent);

    state.active = Some(ReleaseRecord {
        tag: "v1.0.0".into(),
        version: "1.0.0".into(),
        role: TargetRole::Both,
        release_path: "/opt/dam-hopper/releases/v1.0.0/both".into(),
        manifest_sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".into(),
        archive_sha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789".into(),
        installed_at: "2026-09-03T00:00:00Z".into(),
        committed_at: "2026-09-03T00:01:00Z".into(),
        api_unit_sha256: None,
        web_unit_sha256: None,
        host_config_sha256: None,
        helper_unit_sha256: None,
    });

    save_manager_state(&state_path, &mut state).expect("save active state");
    assert_eq!(state.generation, 2);
    assert_eq!(state.current_deployment_state(), DeploymentState::Active);

    let reloaded = load_or_init_manager_state(&state_path).expect("reload state");
    assert_eq!(reloaded.generation, 2);
    assert_eq!(reloaded.active.unwrap().tag, "v1.0.0");
}

#[cfg(unix)]
#[test]
fn test_state_loader_rejects_symlink() {
    let root = tempdir().unwrap();
    let real_path = root.path().join("real-state.json");
    let link_path = root.path().join("state.json");
    let mut state = ManagerState::new();
    save_manager_state(&real_path, &mut state).unwrap();
    std::os::unix::fs::symlink(&real_path, &link_path).unwrap();

    assert!(matches!(
        load_or_init_manager_state(&link_path),
        Err(ReleaseError::OwnershipViolation { .. })
    ));
}

#[test]
fn test_transaction_id_rejects_path_traversal() {
    let transaction = TransactionRecord {
        tx_id: "../escape".into(),
        phase: TransactionPhase::Staged,
        started_at: "2026-09-03T00:00:00Z".into(),
        target_tag: "v1.0.0".into(),
        target_role: TargetRole::Server,
        previous_tag: None,
        previous_role: None,
        units_backup_dir: None,
        config_backup_path: None,
        public_config_backup_path: None,
        migration: None,
    };

    assert!(transaction.validate().is_err());
}

#[test]
fn test_transition_graph_strict_boundaries() {
    use DeploymentState::*;

    // Valid progression
    assert!(validate_transition(Absent, Staged).is_ok());
    assert!(validate_transition(Active, Staged).is_ok());
    assert!(validate_transition(Staged, Pending).is_ok());
    assert!(validate_transition(Pending, Quiesced).is_ok());
    assert!(validate_transition(Quiesced, Switched).is_ok());
    assert!(validate_transition(Switched, Probing).is_ok());
    assert!(validate_transition(Probing, Committed).is_ok());
    assert!(validate_transition(Committed, Active).is_ok());

    // Valid rollbacks
    assert!(validate_transition(Probing, RollingBack).is_ok());
    assert!(validate_transition(Switched, RollingBack).is_ok());
    assert!(validate_transition(Quiesced, RollingBack).is_ok());
    assert!(validate_transition(RollingBack, RolledBack).is_ok());
    assert!(validate_transition(RolledBack, Active).is_ok());
    assert!(validate_transition(RolledBack, Absent).is_ok());

    // Disallowed skips and backwards transitions
    assert!(validate_transition(Absent, Pending).is_err());
    assert!(validate_transition(Active, Pending).is_err());
    assert!(validate_transition(Pending, Switched).is_err());
    assert!(validate_transition(Quiesced, Committed).is_err());
    assert!(validate_transition(Probing, Active).is_err());
    assert!(validate_transition(Committed, Pending).is_err());
    assert!(validate_transition(Switched, Quiesced).is_err());
}

#[test]
fn test_recovery_classification() {
    let mut state = ManagerState::new();
    assert_eq!(classify_recovery(&state), RecoveryAction::NoAction);

    state.pending = Some(PendingCandidateRecord {
        tag: "v1.1.0".into(),
        role: TargetRole::Server,
        staged_at: "2026-09-03T00:00:00Z".into(),
        release_path: "/opt/dam-hopper/releases/v1.1.0/server".into(),
        manifest_sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".into(),
        archive_sha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789".into(),
        pending_units_path: None,
        pending_host_config_path: None,
        api_unit_sha256: None,
        web_unit_sha256: None,
        host_config_sha256: None,
        helper_unit_sha256: None,
    });
    assert_eq!(classify_recovery(&state), RecoveryAction::ResumePending);

    // Simulated in-flight transaction
    state.transaction = Some(TransactionRecord {
        tx_id: "tx-test-1".into(),
        phase: TransactionPhase::Probing,
        started_at: "2026-09-03T00:00:00Z".into(),
        target_tag: "v1.1.0".into(),
        target_role: TargetRole::Server,
        previous_tag: None,
        previous_role: None,
        units_backup_dir: None,
        config_backup_path: None,
        public_config_backup_path: None,
        migration: None,
    });
    assert_eq!(classify_recovery(&state), RecoveryAction::RestorePrevious);

    state.transaction.as_mut().unwrap().phase = TransactionPhase::Committed;
    assert_eq!(classify_recovery(&state), RecoveryAction::RepairCommitted);

    state.transaction.as_mut().unwrap().phase = TransactionPhase::Failed;
    assert!(matches!(
        classify_recovery(&state),
        RecoveryAction::RecoveryRequired(_)
    ));
}

#[test]
fn test_reference_safe_retention() {
    let root = tempdir().unwrap();
    let layout = Layout::with_root(root.path());
    let mut state = ManagerState::new();

    state.active = Some(ReleaseRecord {
        tag: "v1.0.0".into(),
        version: "1.0.0".into(),
        role: TargetRole::Server,
        release_path: layout
            .release_role_dir("v1.0.0", "server")
            .display()
            .to_string(),
        manifest_sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".into(),
        archive_sha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789".into(),
        installed_at: "2026-09-03T00:00:00Z".into(),
        committed_at: "2026-09-03T00:01:00Z".into(),
        api_unit_sha256: None,
        web_unit_sha256: None,
        host_config_sha256: None,
        helper_unit_sha256: None,
    });

    state.previous = Some(ReleaseRecord {
        tag: "v0.9.0".into(),
        version: "0.9.0".into(),
        role: TargetRole::Server,
        release_path: layout
            .release_role_dir("v0.9.0", "server")
            .display()
            .to_string(),
        manifest_sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".into(),
        archive_sha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789".into(),
        installed_at: "2026-09-02T00:00:00Z".into(),
        committed_at: "2026-09-02T00:01:00Z".into(),
        api_unit_sha256: None,
        web_unit_sha256: None,
        host_config_sha256: None,
        helper_unit_sha256: None,
    });

    // Create directories for active, previous, and an unreferenced older version v0.8.0
    let active_dir = layout.release_role_dir("v1.0.0", "server");
    let prev_dir = layout.release_role_dir("v0.9.0", "server");
    let old_dir = layout.release_role_dir("v0.8.0", "server");

    fs::create_dir_all(&active_dir).unwrap();
    fs::create_dir_all(&prev_dir).unwrap();
    fs::create_dir_all(&old_dir).unwrap();

    let (mut manifest, _) = common::release_fixtures::create_test_manifest_and_archive();
    manifest.release.tag = "v0.8.0".to_string();
    manifest.release.version = "0.8.0".to_string();
    manifest.components.cli.version = "0.8.0".to_string();
    manifest.components.api.version = "0.8.0".to_string();
    manifest.components.web_host.version = "0.8.0".to_string();
    manifest.components.web_assets.version = "0.8.0".to_string();
    manifest.archive.name = "dam-hopper-v0.8.0-fedora44-x86_64-systemd.tar.gz".to_string();
    fs::write(
        old_dir.join("release-manifest.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    fs::create_dir_all(old_dir.join("bin")).unwrap();
    fs::write(old_dir.join("bin/dam-hopper-manager"), b"manager").unwrap();
    fs::write(old_dir.join("bin/dam-hopper-server"), b"server").unwrap();
    fs::write(old_dir.join("bin/dam-hopper-web"), b"web").unwrap();
    fs::create_dir_all(old_dir.join("systemd")).unwrap();
    use std::os::unix::fs::PermissionsExt;
    if let Some(parent) = old_dir.parent() {
        let _ = fs::set_permissions(parent, fs::Permissions::from_mode(0o755));
    }
    fs::set_permissions(&old_dir, fs::Permissions::from_mode(0o755)).unwrap();
    fs::set_permissions(old_dir.join("bin"), fs::Permissions::from_mode(0o755)).unwrap();
    fs::set_permissions(old_dir.join("systemd"), fs::Permissions::from_mode(0o755)).unwrap();
    fs::set_permissions(
        old_dir.join("bin/dam-hopper-manager"),
        fs::Permissions::from_mode(0o755),
    )
    .unwrap();
    fs::set_permissions(
        old_dir.join("bin/dam-hopper-server"),
        fs::Permissions::from_mode(0o755),
    )
    .unwrap();
    fs::set_permissions(
        old_dir.join("bin/dam-hopper-web"),
        fs::Permissions::from_mode(0o755),
    )
    .unwrap();
    fs::write(old_dir.join("systemd/dam-hopper-api.service"), b"unit").unwrap();
    fs::write(old_dir.join("systemd/dam-hopper-web.service"), b"unit").unwrap();
    fs::create_dir_all(old_dir.join("sysusers.d")).unwrap();
    fs::set_permissions(
        old_dir.join("sysusers.d"),
        fs::Permissions::from_mode(0o755),
    )
    .unwrap();
    fs::write(old_dir.join("sysusers.d/dam-hopper-web.conf"), b"conf").unwrap();
    fs::create_dir_all(old_dir.join("web")).unwrap();
    fs::set_permissions(old_dir.join("web"), fs::Permissions::from_mode(0o755)).unwrap();
    fs::write(old_dir.join("web/index.html"), b"html").unwrap();
    fs::write(old_dir.join("LICENSE"), b"license").unwrap();
    let _ = fs::set_permissions(
        old_dir.join("release-manifest.json"),
        fs::Permissions::from_mode(0o644),
    );
    let _ = fs::set_permissions(
        old_dir.join("systemd/dam-hopper-api.service"),
        fs::Permissions::from_mode(0o644),
    );
    let _ = fs::set_permissions(
        old_dir.join("systemd/dam-hopper-web.service"),
        fs::Permissions::from_mode(0o644),
    );
    let _ = fs::set_permissions(
        old_dir.join("sysusers.d/dam-hopper-web.conf"),
        fs::Permissions::from_mode(0o644),
    );
    let _ = fs::set_permissions(
        old_dir.join("web/index.html"),
        fs::Permissions::from_mode(0o644),
    );
    let _ = fs::set_permissions(old_dir.join("LICENSE"), fs::Permissions::from_mode(0o644));
    let pruned = apply_retention(&layout, &state).expect("apply retention");
    assert_eq!(pruned, 1);
    assert!(active_dir.exists());
    assert!(prev_dir.exists());
    assert!(!old_dir.exists());
}

#[tokio::test]
async fn test_recovery_and_activation_boundaries() {
    let root = tempdir().unwrap();
    let layout = Layout::with_root(root.path());

    // 1. Activation with nothing staged or active returns clear error
    let res = execute_activation(&layout).await;
    assert!(matches!(res, Err(ReleaseError::Config(_))));

    // 2. Boot recovery on fresh empty layout succeeds without error
    let rec_res = execute_recovery(&layout, true).await;
    assert!(rec_res.is_ok());

    // 3. Boot recovery with pending candidate keeps units disabled
    let mut state = ManagerState::new();
    state.pending = Some(PendingCandidateRecord {
        tag: "v1.0.0".into(),
        role: TargetRole::Server,
        staged_at: "2026-09-03T00:00:00Z".into(),
        release_path: "/opt/dam-hopper/releases/v1.0.0/server".into(),
        manifest_sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".into(),
        archive_sha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789".into(),
        pending_units_path: None,
        pending_host_config_path: None,
        api_unit_sha256: None,
        web_unit_sha256: None,
        host_config_sha256: None,
        helper_unit_sha256: None,
    });
    save_manager_state(&layout.manager_state_path(), &mut state).unwrap();

    let rec_res2 = execute_recovery(&layout, true).await;
    assert!(rec_res2.is_ok());

    // 4. Inconsistent corrupt state triggers RECOVERY_REQUIRED
    state.transaction = Some(TransactionRecord {
        tx_id: "tx-corrupt".into(),
        phase: TransactionPhase::Failed,
        started_at: "2026-09-03T00:00:00Z".into(),
        target_tag: "v1.0.0".into(),
        target_role: TargetRole::Server,
        previous_tag: None,
        previous_role: None,
        units_backup_dir: None,
        config_backup_path: None,
        public_config_backup_path: None,
        migration: None,
    });
    save_manager_state(&layout.manager_state_path(), &mut state).unwrap();

    let rec_res3 = execute_recovery(&layout, true).await;
    assert!(
        rec_res3.is_err(),
        "corrupt/failed transaction must trigger RECOVERY_REQUIRED error"
    );
}

#[test]
fn test_disable_if_enabled_on_nonexistent_unit() {
    let res = disable_if_enabled("dam-hopper-nonexistent-unit-12345.service");
    assert!(
        res.is_ok(),
        "disable_if_enabled on nonexistent unit must succeed cleanly"
    );
}
#[test]
fn test_systemctl_disable_idempotent_on_nonexistent_unit() {
    if current_euid() != 0 {
        // Non-root systemctl disable fails with Access Denied before inspecting unit existence.
        return;
    }
    let res = systemctl_disable("dam-hopper-nonexistent-unit-12345.service");
    assert!(
        res.is_ok(),
        "systemctl_disable on nonexistent unit must treat missing unit as already disabled"
    );
}

#[test]
fn test_helper_service_lifecycle_invariants() {
    // 1. HELPER_SERVICE_UNIT must be in ALL_SERVICE_UNITS
    assert!(
        ALL_SERVICE_UNITS.contains(&HELPER_SERVICE_UNIT),
        "ALL_SERVICE_UNITS must contain HELPER_SERVICE_UNIT"
    );

    // 2. Status inspection includes all required services and roles
    let statuses = collect_all_services_status();
    assert_eq!(statuses.len(), 4);

    let helper_status = statuses
        .iter()
        .find(|s| s.unit_name == HELPER_SERVICE_UNIT)
        .expect("helper service status must be reported");
    assert_eq!(helper_status.role, "server");

    let api_status = statuses
        .iter()
        .find(|s| s.unit_name == API_SERVICE_UNIT)
        .expect("api service status must be reported");
    assert_eq!(api_status.role, "server");

    let web_status = statuses
        .iter()
        .find(|s| s.unit_name == WEB_SERVICE_UNIT)
        .expect("web service status must be reported");
    assert_eq!(web_status.role, "web");

    let recovery_status = statuses
        .iter()
        .find(|s| s.unit_name == RECOVERY_SERVICE_UNIT)
        .expect("recovery service status must be reported");
    assert_eq!(recovery_status.role, "recovery");

    // 3. Disable helper unit on unprivileged/unconfigured host is idempotent
    let res = disable_if_enabled(HELPER_SERVICE_UNIT);
    assert!(
        res.is_ok(),
        "disable_if_enabled on helper unit must be idempotent"
    );
}
