#![cfg(target_os = "linux")]

//! Integration tests for systemd unit rendering, token allowlisting, and policy enforcement.

use dam_hopper_server::linux_release::*;
use std::path::PathBuf;

const API_TEMPLATE: &str = include_str!("../../deploy/systemd/dam-hopper-api.service.in");
const CHECKED_IN_API_UNIT: &str = include_str!("../../deploy/systemd/dam-hopper-api.service");
const WEB_TEMPLATE: &str = include_str!("../../deploy/systemd/dam-hopper-web.service.in");
const HELPER_TEMPLATE: &str =
    include_str!("../../deploy/systemd/dam-hopper-idle-suspend-helper.service.in");

#[test]
fn shared_runtime_policy_rejects_service_directory_ownership_and_group_loss() {
    let ctx = create_valid_context();
    let runner = include_str!("../../deploy/systemd/dam-hopper-plugin-runner.service.in");
    let renderers: [fn(&str, &UnitRenderContext) -> Result<String, ReleaseError>; 3] =
        [render_api_unit, render_helper_unit, render_runner_unit];
    for (template, render) in [API_TEMPLATE, HELPER_TEMPLATE, runner]
        .into_iter()
        .zip(renderers)
    {
        for directive in [
            "RuntimeDirectory=dam-hopper",
            "RuntimeDirectoryMode=0750",
            "RuntimeDirectoryPreserve=yes",
        ] {
            let unsafe_template = template.replace("[Service]", &format!("[Service]\n{directive}"));
            assert!(matches!(
                render(&unsafe_template, &ctx),
                Err(ReleaseError::UnitPolicyViolation { .. })
            ));
        }
        let inaccessible = template.replace("SupplementaryGroups=@PLUGIN_SHARED_GROUP@", "");
        assert!(matches!(
            render(&inaccessible, &ctx),
            Err(ReleaseError::UnitPolicyViolation { .. })
        ));
    }
}

#[test]
fn runner_policy_rejects_missing_or_wrong_api_peer_identity() {
    let mut ctx = create_valid_context();
    ctx.api_uid = "65534".into();
    let template = include_str!("../../deploy/systemd/dam-hopper-plugin-runner.service.in");
    for replacement in ["", "--expected-api-uid 1000"] {
        let unsafe_template = template.replace("--expected-api-uid @API_UID@", replacement);
        assert!(matches!(
            render_runner_unit(&unsafe_template, &ctx),
            Err(ReleaseError::UnitPolicyViolation { .. })
        ));
    }
}
fn create_valid_context() -> UnitRenderContext {
    let user = get_user_by_name("nobody").expect("nobody account");
    let group = get_group_by_gid(user.gid).expect("nobody primary group");
    UnitRenderContext::new(
        PathBuf::from("/opt/dam-hopper/releases/v0.2.0/both"),
        "0.2.0".to_string(),
        PathBuf::from("/etc/dam-hopper/host-config.json"),
        vec!["http://localhost:4802".to_string()],
    )
    .expect("valid context")
    .with_api_identity("nobody".to_string(), group, API_SERVICE_HOME.to_string())
    .expect("valid API identity")
}
#[test]
fn test_render_api_unit_success() {
    let ctx = create_valid_context();
    let rendered = render_api_unit(API_TEMPLATE, &ctx).expect("api unit render should succeed");

    assert!(rendered.contains(&format!("User={}", ctx.api_user)));
    assert!(rendered.contains(&format!("Group={}", ctx.api_group)));
    assert!(!rendered
        .lines()
        .any(|line| line.starts_with("StateDirectory=")));
    assert!(!rendered
        .lines()
        .any(|line| line.starts_with("StateDirectoryMode=")));
    assert!(rendered.contains(
        "ExecStartPre=+/opt/dam-hopper/releases/v0.2.0/both/bin/dam-hopper-manager provision-api-runtime"
    ));
    assert!(rendered.contains("Environment=HOME=/var/lib/dam-hopper"));
    assert!(rendered.contains("Environment=XDG_CONFIG_HOME=/var/lib/dam-hopper/.config"));
    let parsed = ParsedUnit::parse(&rendered).expect("parse rendered API unit");
    let expected_exec = format!(
        "{}/bin/dam-hopper-server --config {}/dam-hopper.toml --host 0.0.0.0 --port 4801",
        ctx.release_root.display(),
        ctx.api_home
    );
    assert_eq!(
        parsed.get_all_values("Service", "ExecStart"),
        vec![expected_exec.as_str()]
    );
    assert!(rendered.contains("/var/lib/dam-hopper/dam-hopper.toml"));
    assert!(!rendered.contains("/etc/dam-hopper/dam-hopper.toml"));
    assert!(rendered.contains("Environment=DAM_HOPPER_CORS_ORIGINS=http://localhost:4802"));
    assert!(rendered.contains("SyslogIdentifier=dam-hopper-api"));
    assert!(rendered.contains("PIDFile=/run/dam-hopper/server.pid"));
    assert!(rendered.contains("ExecStopPost=/usr/bin/rm -f /run/dam-hopper/server.pid"));
    assert!(!rendered.contains('@'));
}

#[test]
fn test_api_unit_identity_and_start_gate_are_single_and_final() {
    let ctx = create_valid_context();
    let rendered = render_api_unit(API_TEMPLATE, &ctx).expect("render API unit");
    let parsed = ParsedUnit::parse(&rendered).expect("parse rendered API unit");
    let identity = resolve_api_runtime_identity(&parsed).expect("resolve rendered identity");

    assert_eq!(parsed.get_all_values("Service", "User").len(), 1);
    assert_eq!(parsed.get_all_values("Service", "Group").len(), 1);
    assert_eq!(parsed.get_all_values("Service", "ExecStart").len(), 1);
    assert_eq!(identity.user, ctx.api_user);
    assert_eq!(identity.group, ctx.api_group);

    let mismatched_process = ServiceProcessEvidence {
        unit_name: API_SERVICE_UNIT.to_string(),
        pid: 4242,
        uid: identity.uid.saturating_add(1),
        gid: identity.gid.saturating_add(1),
        exe_path: Some(ctx.release_root.join("bin/dam-hopper-server")),
        cgroup: None,
    };
    let process_error = process::verify_service_identity_and_exe(
        &mismatched_process,
        identity.uid,
        &ctx.release_root,
    )
    .expect_err("mismatched process UID must be refused");
    assert!(matches!(
        process_error,
        ReleaseError::ProcessInspectionFailed { reason }
            if reason.contains("effective UID mismatch")
    ));
    assert_ne!(mismatched_process.gid, identity.gid);
}

#[test]
fn test_api_unit_policy_rejects_state_directory_and_duplicate_prestart() {
    let ctx = create_valid_context();
    let state_directory_template =
        API_TEMPLATE.replace("\n[Service]", "\n[Service]\nStateDirectory=dam-hopper");
    assert!(matches!(
        render_api_unit(&state_directory_template, &ctx),
        Err(ReleaseError::UnitPolicyViolation { reason, .. })
            if reason.contains("StateDirectory")
    ));

    let duplicate_prestart_template = API_TEMPLATE.replace(
        "\nExecStart=",
        "\nExecStartPre=+/opt/dam-hopper/releases/v0.2.0/both/bin/dam-hopper-manager provision-api-runtime\nExecStart=",
    );
    assert!(matches!(
        render_api_unit(&duplicate_prestart_template, &ctx),
        Err(ReleaseError::UnitPolicyViolation { .. })
    ));
}

#[test]
fn test_api_unit_policy_rejects_duplicate_execstart() {
    let ctx = create_valid_context();
    let duplicate_execstart_template = API_TEMPLATE.replace(
        "\nExecStart=",
        "\nExecStart=/opt/dam-hopper/releases/v0.2.0/both/bin/dam-hopper-server --config /var/lib/dam-hopper/dam-hopper.toml --host 0.0.0.0 --port 4801\nExecStart=",
    );
    assert!(matches!(
        render_api_unit(&duplicate_execstart_template, &ctx),
        Err(ReleaseError::UnitPolicyViolation { reason, .. })
            if reason.contains("ExecStart")
    ));
}

#[test]
fn test_api_unit_policy_rejects_legacy_etc_config_path() {
    let ctx = create_valid_context();
    let legacy_etc_template = API_TEMPLATE.replace(
        "--config @API_HOME@/dam-hopper.toml",
        "--config /etc/dam-hopper/dam-hopper.toml",
    );
    assert!(matches!(
        render_api_unit(&legacy_etc_template, &ctx),
        Err(ReleaseError::UnitPolicyViolation { reason, .. })
            if reason.contains("ExecStart")
    ));
}

#[test]
fn test_checked_in_api_unit_passes_policy_and_omits_legacy_path() {
    let parsed = ParsedUnit::parse(CHECKED_IN_API_UNIT).expect("parse checked-in unit");

    assert_eq!(
        parsed.get_all_values("Service", "ExecStart"),
        vec!["/opt/dam-hopper/current/bin/dam-hopper-server --config /var/lib/dam-hopper/dam-hopper.toml --host 0.0.0.0 --port 4801"]
    );
    assert_eq!(parsed.get_value("Service", "User"), Some("dam-hopper"));
    assert_eq!(parsed.get_value("Service", "Group"), Some("dam-hopper"));
    assert!(parsed
        .get_all_values("Service", "StateDirectory")
        .is_empty());
    assert!(parsed
        .get_all_values("Service", "StateDirectoryMode")
        .is_empty());
    assert_eq!(parsed.get_value("Service", "Type"), Some("exec"));
    assert_eq!(
        parsed.get_value("Service", "WorkingDirectory"),
        Some("/var/lib/dam-hopper")
    );
    assert_eq!(parsed.get_value("Service", "UMask"), Some("0077"));
    assert_eq!(
        parsed.get_value("Service", "PIDFile"),
        Some("/run/dam-hopper/server.pid")
    );
    assert_eq!(parsed.get_value("Service", "Restart"), Some("on-failure"));
    assert_eq!(parsed.get_value("Service", "RestartSec"), Some("5s"));
    assert_eq!(parsed.get_value("Service", "KillSignal"), Some("SIGTERM"));
    assert_eq!(parsed.get_value("Service", "KillMode"), Some("mixed"));
    assert_eq!(parsed.get_value("Service", "TimeoutStopSec"), Some("20s"));
    assert_eq!(
        parsed.get_value("Service", "NoNewPrivileges"),
        Some("false")
    );
    assert_eq!(
        parsed.get_value("Service", "SyslogIdentifier"),
        Some("dam-hopper-api")
    );

    assert!(!CHECKED_IN_API_UNIT.contains("/etc/dam-hopper/dam-hopper.toml"));
    assert!(!API_TEMPLATE.contains("/etc/dam-hopper/dam-hopper.toml"));
    assert!(CHECKED_IN_API_UNIT.contains("/var/lib/dam-hopper/dam-hopper.toml"));
    assert!(API_TEMPLATE.contains("@API_HOME@/dam-hopper.toml"));
}

#[test]
fn test_render_context_rejects_root_uid() {
    let result = create_valid_context().with_api_identity(
        "root".into(),
        "root".into(),
        API_SERVICE_HOME.into(),
    );

    assert!(matches!(
        result,
        Err(ReleaseError::Config(reason)) if reason.contains("UID 0")
    ));
}

#[test]
fn test_resolve_api_identity_accepts_non_root_primary_group() {
    let user = get_user_by_name("nobody").expect("nobody account");
    let group = get_group_by_gid(user.gid).expect("nobody primary group");
    let unit = ParsedUnit::parse(&format!("[Service]\nUser=nobody\nGroup={group}\n"))
        .expect("parse runtime identity");

    let identity = resolve_api_runtime_identity(&unit).expect("resolve runtime identity");
    assert_eq!(identity.user, "nobody");
    assert_eq!(identity.group, group);
    assert_eq!(identity.uid, user.uid);
    assert_eq!(identity.gid, user.gid);
}

#[test]
fn test_resolve_api_identity_rejects_root_uid_and_gid() {
    let unit =
        ParsedUnit::parse("[Service]\nUser=root\nGroup=root\n").expect("parse root identity");

    assert!(matches!(
        resolve_api_runtime_identity(&unit),
        Err(ReleaseError::Config(reason)) if reason.contains("non-root")
    ));
}

#[test]
fn test_resolve_api_identity_rejects_missing_and_duplicate_directives() {
    let missing_group = ParsedUnit::parse("[Service]\nUser=nobody\n").expect("parse missing group");
    assert!(resolve_api_runtime_identity(&missing_group).is_err());

    let duplicate_user = ParsedUnit::parse("[Service]\nUser=nobody\nUser=nobody\nGroup=nobody\n")
        .expect("parse duplicate user");
    assert!(matches!(
        resolve_api_runtime_identity(&duplicate_user),
        Err(ReleaseError::Config(reason)) if reason.contains("exactly one")
    ));
}

#[test]
fn test_resolve_api_identity_rejects_non_primary_group() {
    let unit = ParsedUnit::parse("[Service]\nUser=nobody\nGroup=root\n")
        .expect("parse mismatched identity");

    assert!(resolve_api_runtime_identity(&unit).is_err());
}

#[test]
fn test_render_api_unit_custom_identity() {
    let ctx = create_valid_context()
        .with_api_identity(
            "loidinh".into(),
            "loidinh".into(),
            "/var/lib/dam-hopper".into(),
        )
        .expect("valid identity params");
    let rendered = render_api_unit(API_TEMPLATE, &ctx).expect("api unit render should succeed");

    assert!(rendered.contains("User=loidinh"));
    assert!(rendered.contains("Group=loidinh"));
    assert!(rendered.contains("WorkingDirectory=/var/lib/dam-hopper"));
    assert!(rendered.contains("Environment=HOME=/var/lib/dam-hopper"));
    assert!(rendered.contains("Environment=XDG_CONFIG_HOME=/var/lib/dam-hopper/.config"));
    assert!(rendered.contains("ExecStart=/opt/dam-hopper/releases/v0.2.0/both/bin/dam-hopper-server --config /var/lib/dam-hopper/dam-hopper.toml --host 0.0.0.0 --port 4801"));
}

#[test]
fn test_render_web_unit_success() {
    let ctx = create_valid_context();
    let rendered = render_web_unit(WEB_TEMPLATE, &ctx).expect("web unit render should succeed");

    assert!(rendered.contains("Type=exec"));
    assert!(rendered.contains("User=dam-hopper-web"));
    assert!(rendered.contains("Group=dam-hopper-web"));
    assert!(rendered.contains("NoNewPrivileges=true"));
    assert!(rendered.contains("ProtectSystem=strict"));
    assert!(rendered.contains("ProtectHome=true"));
    assert!(rendered.contains("PrivateTmp=true"));
    assert!(rendered.contains("ReadOnlyPaths=/opt/dam-hopper/releases/v0.2.0/both"));
    assert!(rendered.contains("ReadOnlyPaths=/etc/dam-hopper/host-config.json"));
    assert!(rendered.contains("--root /opt/dam-hopper/releases/v0.2.0/both/web"));
    assert!(rendered.contains("--release-version 0.2.0"));
    assert!(rendered.contains("SyslogIdentifier=dam-hopper-web"));
    assert!(!rendered.contains('@'));
}

#[test]
fn test_render_helper_unit_success() {
    let ctx = create_valid_context();
    let rendered =
        render_helper_unit(HELPER_TEMPLATE, &ctx).expect("helper unit render should succeed");

    assert!(!rendered
        .lines()
        .any(|line| line.starts_with("StateDirectory=")));
    assert!(!rendered
        .lines()
        .any(|line| line.starts_with("StateDirectoryMode=")));
    assert!(rendered.contains(&format!("Group={}", ctx.api_group)));
    assert!(rendered.contains("LogsDirectory=dam-hopper"));
    assert!(rendered.contains("ExecStart=/opt/dam-hopper/releases/v0.2.0/both/bin/dam-hopper-idle-suspend-helper --socket /run/dam-hopper/idle-suspend.sock --audit-file /var/log/dam-hopper/idle-suspend-helper.jsonl --enrolled-pid-file /run/dam-hopper/server.pid"));
    assert!(rendered.contains("Restart=on-failure"));
    assert!(rendered.contains("RestartSec=5s"));
    assert!(rendered.contains("KillSignal=SIGTERM"));
    assert!(rendered.contains("KillMode=mixed"));
    assert!(rendered.contains("TimeoutStopSec=15s"));
    assert!(rendered.contains("UMask=0007"));
    assert!(rendered.contains("NoNewPrivileges=yes"));
    assert!(rendered.contains("ProtectSystem=strict"));
    assert!(rendered.contains("ProtectHome=yes"));
    assert!(rendered.contains("PrivateTmp=yes"));
    assert!(rendered.contains("CapabilityBoundingSet=CAP_WAKE_ALARM"));
    assert!(rendered.contains("SyslogIdentifier=dam-hopper-idle-suspend-helper"));
    assert!(!rendered.contains('@'));
}
#[test]
fn test_reject_unresolved_or_unknown_tokens() {
    let ctx = create_valid_context();

    let unknown_token_template = "[Unit]\nDescription=@UNKNOWN_TOKEN@\n";
    let res = render_api_unit(unknown_token_template, &ctx);
    assert!(matches!(
        res,
        Err(ReleaseError::TemplateTokenInjection { .. })
    ));

    let leftover_token_template =
        "[Unit]\nDescription=@RELEASE_ROOT@\n[Service]\nUser=@LEFTOVER@\n";
    let res = render_api_unit(leftover_token_template, &ctx);
    assert!(matches!(
        res,
        Err(ReleaseError::TemplateTokenInjection { .. })
    ));
}

#[test]
fn test_reject_control_char_injection_in_context() {
    let res = UnitRenderContext::new(
        PathBuf::from("/opt/dam-hopper\nInjected=evil"),
        "0.2.0".to_string(),
        PathBuf::from("/etc/dam-hopper/host-config.json"),
        vec![],
    );
    assert!(matches!(
        res,
        Err(ReleaseError::TemplateTokenInjection { .. })
    ));
}

#[test]
fn test_reject_coupling_in_api_unit() {
    let ctx = create_valid_context();
    let coupled_template = format!("{API_TEMPLATE}\nRequires=dam-hopper-web.service\n");
    let res = render_api_unit(&coupled_template, &ctx);
    assert!(matches!(
        res,
        Err(ReleaseError::UnitPolicyViolation { ref reason, .. }) if reason.contains("coupling")
    ));
}

#[test]
fn test_reject_web_unit_environment_file() {
    let ctx = create_valid_context();
    let env_file_template = format!("{WEB_TEMPLATE}\nEnvironmentFile=/etc/dam-hopper/server.env\n");
    let res = render_web_unit(&env_file_template, &ctx);
    assert!(matches!(
        res,
        Err(ReleaseError::UnitPolicyViolation { ref reason, .. }) if reason.contains("EnvironmentFile")
    ));
}

#[test]
fn test_parsed_unit_structure() {
    let content = "[Unit]\nDescription=Test\n\n[Service]\nType=exec\nUser=root\n";
    let parsed = ParsedUnit::parse(content).expect("parse unit");
    assert_eq!(parsed.get_value("Unit", "Description"), Some("Test"));
    assert_eq!(parsed.get_value("Service", "Type"), Some("exec"));
    assert_eq!(parsed.get_value("Service", "User"), Some("root"));
    assert_eq!(parsed.get_value("Service", "Unknown"), None);
}

#[test]
fn test_stage_candidate_units_roles() {
    let root = tempfile::tempdir().unwrap();
    let layout = Layout::with_root(root.path());
    let target_dir = layout.release_role_dir("v0.2.0", "both");
    std::fs::create_dir_all(target_dir.join("bin")).unwrap();
    std::fs::create_dir_all(target_dir.join("web")).unwrap();
    let server_bin = target_dir.join("bin/dam-hopper-server");
    let web_bin = target_dir.join("bin/dam-hopper-web");
    let mgr_bin = target_dir.join("bin/dam-hopper-manager");
    let cli_bin = target_dir.join("bin/dam-hopper");
    std::fs::write(&server_bin, "server").unwrap();
    std::fs::write(&web_bin, "web").unwrap();
    std::fs::write(&mgr_bin, "manager").unwrap();
    std::fs::write(&cli_bin, "cli").unwrap();
    let helper_bin = target_dir.join("bin/dam-hopper-idle-suspend-helper");
    std::fs::write(&helper_bin, "helper").unwrap();
    let runner_bin = target_dir.join("bin/dam-hopper-plugin-runner");
    std::fs::write(&runner_bin, "runner").unwrap();
    let node_bin = target_dir.join("bin/node");
    std::fs::write(&node_bin, "node").unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&server_bin, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::set_permissions(&web_bin, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::set_permissions(&mgr_bin, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::set_permissions(&cli_bin, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::set_permissions(&helper_bin, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::set_permissions(&runner_bin, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::set_permissions(&node_bin, std::fs::Permissions::from_mode(0o755)).unwrap();
    // Create dummy manifest
    let manifest = ReleaseManifest {
        schema_version: RELEASE_MANIFEST_SCHEMA_VERSION,
        release: ReleaseMeta {
            tag: "v0.2.0".to_string(),
            version: "0.2.0".to_string(),
            commit_sha: "0123456789abcdef0123456789abcdef01234567".to_string(),
        },
        profile: ProfileMeta {
            id: PROFILE_ID.to_string(),
            os_id: PROFILE_OS_ID.to_string(),
            os_version: PROFILE_OS_VERSION.to_string(),
            arch: PROFILE_ARCH.to_string(),
            target: PROFILE_TARGET.to_string(),
            glibc_min: PROFILE_GLIBC_MIN.to_string(),
            systemd_min: PROFILE_SYSTEMD_MIN,
        },
        archive: ArchiveMeta {
            name: expected_archive_name("v0.2.0"),
            size: 100,
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".to_string(),
        },
        components: ComponentsMeta {
            cli: ComponentVersion {
                version: "0.2.0".to_string(),
            },
            api: ComponentVersion {
                version: "0.2.0".to_string(),
            },
            web_host: ComponentVersion {
                version: "0.2.0".to_string(),
            },
            web_assets: ComponentVersion {
                version: "0.2.0".to_string(),
            },
            runner: None,
        },
        inventory: vec![],
        services: ServicesMeta {
            api: ApiServiceContract {
                unit_name: API_SERVICE_UNIT.to_string(),
                identity: None,
                bind_host: API_SERVICE_BIND_HOST.to_string(),
                port: API_SERVICE_PORT,
                health_path: API_SERVICE_HEALTH_PATH.to_string(),
            },
            web: WebServiceContract {
                unit_name: WEB_SERVICE_UNIT.to_string(),
                identity: WEB_SERVICE_IDENTITY.to_string(),
                bind_host: WEB_SERVICE_BIND_HOST.to_string(),
                port: WEB_SERVICE_PORT,
                health_path: WEB_SERVICE_HEALTH_PATH.to_string(),
            },
            runner: None,
        },
        rollback: RollbackMeta {
            previous_release_compatible: ROLLBACK_PREVIOUS_COMPATIBLE,
            state_compatibility: ROLLBACK_STATE_COMPATIBILITY.to_string(),
        },
    };

    // Stage for Server role
    let origins = vec!["http://localhost:4802".to_string()];
    let mut host_config = HostConfig::new(TargetRole::Server, origins.clone()).unwrap();
    host_config.service_user = Some("nobody".to_string());
    save_host_config(&layout.host_config_path(), &host_config).unwrap();
    std::fs::remove_file(&node_bin).unwrap();
    assert!(stage_candidate_units(
        &layout,
        &target_dir,
        &manifest,
        TargetRole::Server,
        &origins,
    )
    .is_err());
    std::fs::write(&node_bin, "node").unwrap();
    std::fs::set_permissions(&node_bin, std::fs::Permissions::from_mode(0o755)).unwrap();
    stage_candidate_units(
        &layout,
        &target_dir,
        &manifest,
        TargetRole::Server,
        &origins,
    )
    .expect("stage candidate units for server");

    let pending_units = layout.pending_units_dir();
    assert!(pending_units.join("dam-hopper-api.service").exists());
    assert!(pending_units.join("dam-hopper-recovery.service").exists());
    assert!(pending_units
        .join("dam-hopper-idle-suspend-helper.service")
        .exists());
    assert!(pending_units
        .join("dam-hopper-plugin-runner.service")
        .exists());
    assert!(!pending_units.join("dam-hopper-web.service").exists());

    let pending_cfg = load_host_public_config(&layout.pending_host_config_json_path())
        .unwrap()
        .expect("pending host config");
    assert_eq!(pending_cfg.role, TargetRole::Server);

    // Stage for Both role
    stage_candidate_units(&layout, &target_dir, &manifest, TargetRole::Both, &origins)
        .expect("stage candidate units for both");
    assert!(pending_units.join("dam-hopper-api.service").exists());
    assert!(pending_units.join("dam-hopper-web.service").exists());
    assert!(pending_units
        .join("dam-hopper-idle-suspend-helper.service")
        .exists());
    assert!(pending_units.join("dam-hopper-web.conf").exists());

    let pending_cfg = load_host_public_config(&layout.pending_host_config_json_path())
        .unwrap()
        .expect("pending host config");
    assert_eq!(pending_cfg.role, TargetRole::Both);

    // Stage for Web role
    stage_candidate_units(&layout, &target_dir, &manifest, TargetRole::Web, &origins)
        .expect("stage candidate units for web");
    assert!(!pending_units.join("dam-hopper-api.service").exists());
    assert!(!pending_units
        .join("dam-hopper-idle-suspend-helper.service")
        .exists());
    assert!(pending_units.join("dam-hopper-web.service").exists());
    assert!(pending_units.join("dam-hopper-web.conf").exists());
    assert!(pending_units.join("dam-hopper-recovery.service").exists());
}
