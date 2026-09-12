//! Integration tests for systemd unit rendering, token allowlisting, and policy enforcement.

use dam_hopper_server::linux_release::*;
use std::path::PathBuf;

const API_TEMPLATE: &str = include_str!("../../deploy/systemd/dam-hopper-api.service.in");
const WEB_TEMPLATE: &str = include_str!("../../deploy/systemd/dam-hopper-web.service.in");
const HELPER_TEMPLATE: &str =
    include_str!("../../deploy/systemd/dam-hopper-idle-suspend-helper.service.in");

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
    assert!(!rendered.lines().any(|line| line.starts_with("StateDirectory=")));
    assert!(!rendered
        .lines()
        .any(|line| line.starts_with("StateDirectoryMode=")));
    assert!(rendered.contains(
        "ExecStartPre=+/opt/dam-hopper/releases/v0.2.0/both/bin/dam-hopper-manager provision-api-runtime"
    ));
    assert!(rendered.contains("Environment=HOME=/var/lib/dam-hopper"));
    assert!(rendered.contains("Environment=XDG_CONFIG_HOME=/var/lib/dam-hopper/.config"));
    assert!(
        rendered.contains("ExecStart=/opt/dam-hopper/releases/v0.2.0/both/bin/dam-hopper-server")
    );
    assert!(rendered.contains("Environment=DAM_HOPPER_CORS_ORIGINS=http://localhost:4802"));
    assert!(rendered.contains("SyslogIdentifier=dam-hopper-api"));
    assert!(rendered.contains("PIDFile=/run/dam-hopper/server.pid"));
    assert!(rendered
        .contains("ExecStartPost=/usr/bin/sh -c 'echo $MAINPID > /run/dam-hopper/server.pid'"));
    assert!(rendered.contains("ExecStopPost=/usr/bin/rm -f /run/dam-hopper/server.pid"));
    assert!(!rendered.contains('@'));
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
    let root = get_user_by_name("root").expect("root account");
    let group = get_group_by_gid(root.gid).expect("root primary group");
    let unit = ParsedUnit::parse(&format!("[Service]\nUser=nobody\nGroup={group}\n"))
        .expect("parse mismatched identity");

    assert!(resolve_api_runtime_identity(&unit).is_err());
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

    assert!(!rendered.lines().any(|line| line.starts_with("StateDirectory=")));
    assert!(rendered.contains(&format!("Group={}", ctx.api_group)));
    assert!(rendered.contains("RuntimeDirectory=dam-hopper"));
    assert!(rendered.contains("RuntimeDirectoryMode=0775"));
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
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&server_bin, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::set_permissions(&web_bin, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::set_permissions(&mgr_bin, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::set_permissions(&cli_bin, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::set_permissions(&helper_bin, std::fs::Permissions::from_mode(0o755)).unwrap();
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
        },
        inventory: vec![],
        services: ServicesMeta {
            api: ApiServiceContract {
                unit_name: API_SERVICE_UNIT.to_string(),
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
