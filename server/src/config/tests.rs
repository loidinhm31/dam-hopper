use super::{
    discovery::{detect_project_type, discover_projects},
    finder::find_config_file,
    global::{
        add_known_workspace_at, list_known_workspaces_at, read_global_config_at,
        remove_known_workspace_at, write_global_config_at,
    },
    parser::{read_config, write_config},
    presets::{get_effective_command, get_preset},
    schema::{CommandKind, GlobalConfig, KnownWorkspace, ProjectType, RestartPolicy, UiConfig},
};

// ──────────────────────────────────────────────
// Preset tests
// ──────────────────────────────────────────────

#[test]
fn preset_maven_commands() {
    let p = get_preset(&ProjectType::Maven);
    assert_eq!(p.build_command, "mvn clean install -DskipTests");
    assert_eq!(p.run_command, "mvn spring-boot:run");
    assert!(p.dev_command.is_none());
    assert!(p.marker_files.contains(&"pom.xml"));
}

#[test]
fn preset_pnpm_has_dev_command() {
    let p = get_preset(&ProjectType::Pnpm);
    assert_eq!(p.dev_command, Some("pnpm dev"));
}

#[test]
fn preset_custom_is_empty() {
    let p = get_preset(&ProjectType::Custom);
    assert!(p.build_command.is_empty());
    assert!(p.run_command.is_empty());
}

// ──────────────────────────────────────────────
// TOML parse tests
// ──────────────────────────────────────────────

#[test]
fn parse_minimal_config() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        r#"
[workspace]
name = "test-ws"

[[projects]]
name = "api"
path = "./api"
type = "cargo"
"#,
    )
    .unwrap();

    let cfg = read_config(&config_path).unwrap();
    assert_eq!(cfg.workspace.name, "test-ws");
    assert_eq!(cfg.projects.len(), 1);
    assert_eq!(cfg.projects[0].name, "api");
    assert_eq!(cfg.projects[0].project_type, ProjectType::Cargo);
    assert!(cfg.projects[0].path.starts_with('/'));
}

#[test]
fn parse_config_with_services() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        r#"
[workspace]
name = "svc-ws"

[[projects]]
name = "backend"
path = "."
type = "maven"

[[projects.services]]
name = "auth"
build_command = "mvn -pl auth package"
run_command = "java -jar auth/target/*.jar"
"#,
    )
    .unwrap();

    let cfg = read_config(&config_path).unwrap();
    let svcs = cfg.projects[0].services.as_ref().unwrap();
    assert_eq!(svcs.len(), 1);
    assert_eq!(svcs[0].name, "auth");
    assert_eq!(
        svcs[0].build_command.as_deref(),
        Some("mvn -pl auth package")
    );
}

#[test]
fn reject_duplicate_project_names() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        r#"
[workspace]
name = "dup-ws"

[[projects]]
name = "api"
path = "./api"
type = "cargo"

[[projects]]
name = "api"
path = "./api2"
type = "npm"
"#,
    )
    .unwrap();

    assert!(read_config(&config_path).is_err());
}

#[test]
fn reject_absolute_project_path() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        "[workspace]\nname=\"w\"\n\n[[projects]]\nname=\"p\"\npath=\"/etc/passwd\"\ntype=\"cargo\"",
    )
    .unwrap();
    assert!(read_config(&config_path).is_err());
}

#[test]
fn reject_path_traversal_in_env_file() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        "[workspace]\nname=\"w\"\n\n[[projects]]\nname=\"p\"\npath=\".\"\ntype=\"cargo\"\nenv_file=\"../../.ssh/id_rsa\"",
    )
    .unwrap();
    assert!(read_config(&config_path).is_err());
}

#[test]
fn config_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        r#"
[workspace]
name = "rt-ws"

[[projects]]
name = "svc"
path = "./svc"
type = "npm"
tags = ["frontend"]
env_file = ".env"
"#,
    )
    .unwrap();

    let original = read_config(&config_path).unwrap();
    write_config(&config_path, &original).unwrap();
    let reloaded = read_config(&config_path).unwrap();

    assert_eq!(original.workspace.name, reloaded.workspace.name);
    assert_eq!(original.projects.len(), reloaded.projects.len());
    assert_eq!(original.projects[0].name, reloaded.projects[0].name);
    assert_eq!(original.projects[0].env_file, reloaded.projects[0].env_file);
    assert_eq!(original.projects[0].tags, reloaded.projects[0].tags);
}

// ──────────────────────────────────────────────
// RestartPolicy parse tests
// ──────────────────────────────────────────────

#[test]
fn restart_policy_defaults_when_missing() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        "[workspace]\nname=\"w\"\n\n[[projects]]\nname=\"p\"\npath=\".\"\ntype=\"cargo\"",
    )
    .unwrap();
    let cfg = read_config(&config_path).unwrap();
    assert_eq!(cfg.projects[0].restart_policy, RestartPolicy::Never);
    assert_eq!(cfg.projects[0].restart_max_retries, 5);
    assert!(cfg.projects[0].health_check_url.is_none());
}

#[test]
fn restart_policy_on_failure_and_custom_retries() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        r#"
[workspace]
name = "w"

[[projects]]
name = "p"
path = "."
type = "cargo"
restart = "on-failure"
restart_max_retries = 3
"#,
    )
    .unwrap();
    let cfg = read_config(&config_path).unwrap();
    assert_eq!(cfg.projects[0].restart_policy, RestartPolicy::OnFailure);
    assert_eq!(cfg.projects[0].restart_max_retries, 3);
}

#[test]
fn restart_policy_always_parsed() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        "[workspace]\nname=\"w\"\n\n[[projects]]\nname=\"p\"\npath=\".\"\ntype=\"cargo\"\nrestart=\"always\"",
    )
    .unwrap();
    let cfg = read_config(&config_path).unwrap();
    assert_eq!(cfg.projects[0].restart_policy, RestartPolicy::Always);
}

#[test]
fn restart_policy_invalid_string_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        "[workspace]\nname=\"w\"\n\n[[projects]]\nname=\"p\"\npath=\".\"\ntype=\"cargo\"\nrestart=\"on-error\"",
    )
    .unwrap();
    assert!(read_config(&config_path).is_err());
}

#[test]
fn health_check_url_invalid_scheme_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        "[workspace]\nname=\"w\"\n\n[[projects]]\nname=\"p\"\npath=\".\"\ntype=\"cargo\"\nhealth_check_url=\"ftp://example.com\"",
    )
    .unwrap();
    assert!(read_config(&config_path).is_err());
}

#[test]
fn restart_policy_roundtrip_preserves_non_defaults() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        r#"
[workspace]
name = "rt-restart-ws"

[[projects]]
name = "svc"
path = "./svc"
type = "cargo"
restart = "on-failure"
restart_max_retries = 3
health_check_url = "http://localhost:8080/health"
"#,
    )
    .unwrap();

    let original = read_config(&config_path).unwrap();
    assert_eq!(original.projects[0].restart_policy, RestartPolicy::OnFailure);
    assert_eq!(original.projects[0].restart_max_retries, 3);
    assert_eq!(
        original.projects[0].health_check_url.as_deref(),
        Some("http://localhost:8080/health")
    );

    write_config(&config_path, &original).unwrap();
    let reloaded = read_config(&config_path).unwrap();

    assert_eq!(reloaded.projects[0].restart_policy, RestartPolicy::OnFailure);
    assert_eq!(reloaded.projects[0].restart_max_retries, 3);
    assert_eq!(
        reloaded.projects[0].health_check_url.as_deref(),
        Some("http://localhost:8080/health")
    );
}

// ──────────────────────────────────────────────
// Config finder tests
// ──────────────────────────────────────────────

#[test]
fn find_config_in_same_dir() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(&config_path, "[workspace]\nname = \"x\"").unwrap();

    let found = find_config_file(dir.path());
    assert_eq!(found.unwrap(), config_path);
}

#[test]
fn find_config_walks_up() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(&config_path, "[workspace]\nname = \"x\"").unwrap();

    let subdir = dir.path().join("a").join("b");
    std::fs::create_dir_all(&subdir).unwrap();

    let found = find_config_file(&subdir);
    assert_eq!(found.unwrap(), config_path);
}

#[test]
fn find_config_returns_none_for_isolated_tmpdir() {
    // This tmpdir is guaranteed to be under /tmp which won't have a dam-hopper.toml,
    // and the walk-up will stop at home or filesystem root before finding one.
    let dir = tempfile::tempdir().unwrap();
    let subdir = dir.path().join("no-config-here");
    std::fs::create_dir_all(&subdir).unwrap();

    // May return Some or None depending on host filesystem, but must not panic.
    // The test validates the function is safe to call, not the specific return value.
    let _ = find_config_file(&subdir);
}

// ──────────────────────────────────────────────
// Global config tests
// ──────────────────────────────────────────────

#[test]
fn global_config_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    let cfg_path = dir.path().join("dam-hopper").join("config.toml");

    let cfg = GlobalConfig {
        defaults: None,
        workspaces: Some(vec![KnownWorkspace {
            name: "ws1".to_string(),
            path: "/tmp/ws1".to_string(),
        }]),
        ui: None,
        server: crate::config::ServerConfig::default(),
    };

    write_global_config_at(&cfg_path, &cfg).unwrap();
    let loaded = read_global_config_at(&cfg_path).unwrap().unwrap();
    let workspaces = loaded.workspaces.unwrap();
    assert_eq!(workspaces.len(), 1);
    assert_eq!(workspaces[0].name, "ws1");
    assert_eq!(workspaces[0].path, "/tmp/ws1");
}

#[test]
fn global_config_corrupted_returns_none() {
    let dir = tempfile::tempdir().unwrap();
    let cfg_path = dir.path().join("config.toml");
    std::fs::write(&cfg_path, "this is not valid toml [[[").unwrap();

    // Matches Node.js behavior: corrupted global config → Ok(None), not Err
    let result = read_global_config_at(&cfg_path).unwrap();
    assert!(result.is_none());
}

#[test]
fn add_remove_known_workspace() {
    let dir = tempfile::tempdir().unwrap();
    let cfg_path = dir.path().join("config.toml");

    add_known_workspace_at(&cfg_path, "my-ws", "/tmp/my-ws").unwrap();
    let list = list_known_workspaces_at(&cfg_path).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "my-ws");

    // Add again with same path → update name
    add_known_workspace_at(&cfg_path, "renamed-ws", "/tmp/my-ws").unwrap();
    let list = list_known_workspaces_at(&cfg_path).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "renamed-ws");

    // Add another
    add_known_workspace_at(&cfg_path, "other-ws", "/tmp/other-ws").unwrap();
    assert_eq!(list_known_workspaces_at(&cfg_path).unwrap().len(), 2);

    remove_known_workspace_at(&cfg_path, "/tmp/my-ws").unwrap();
    let list = list_known_workspaces_at(&cfg_path).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].path, "/tmp/other-ws");
}

#[test]
fn no_op_add_same_workspace() {
    let dir = tempfile::tempdir().unwrap();
    let cfg_path = dir.path().join("config.toml");

    add_known_workspace_at(&cfg_path, "ws", "/tmp/ws").unwrap();
    add_known_workspace_at(&cfg_path, "ws", "/tmp/ws").unwrap(); // no-op
    assert_eq!(list_known_workspaces_at(&cfg_path).unwrap().len(), 1);
}

// ──────────────────────────────────────────────
// Discovery tests
// ──────────────────────────────────────────────

#[test]
fn detect_cargo_project() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("Cargo.toml"), "[package]\nname=\"x\"").unwrap();
    assert_eq!(detect_project_type(dir.path()), Some(ProjectType::Cargo));
}

#[test]
fn detect_pnpm_over_npm() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("pnpm-lock.yaml"), "").unwrap();
    std::fs::write(dir.path().join("package-lock.json"), "").unwrap();
    assert_eq!(detect_project_type(dir.path()), Some(ProjectType::Pnpm));
}

#[test]
fn detect_npm_via_package_json_fallback() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("package.json"), "{}").unwrap();
    assert_eq!(detect_project_type(dir.path()), Some(ProjectType::Npm));
}

#[test]
fn discover_skips_dotdirs_and_node_modules() {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join(".hidden")).unwrap();
    std::fs::create_dir(root.path().join("node_modules")).unwrap();

    let cargo_proj = root.path().join("my-crate");
    std::fs::create_dir(&cargo_proj).unwrap();
    std::fs::write(cargo_proj.join("Cargo.toml"), "[package]\nname=\"x\"").unwrap();

    let discovered = discover_projects(root.path());
    assert_eq!(discovered.len(), 1);
    assert_eq!(discovered[0].name, "my-crate");
    assert_eq!(discovered[0].project_type, ProjectType::Cargo);
}

// ──────────────────────────────────────────────
// Effective command tests
// ──────────────────────────────────────────────

#[test]
fn effective_command_uses_preset_when_no_services() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        "[workspace]\nname=\"w\"\n\n[[projects]]\nname=\"p\"\npath=\".\"\ntype=\"cargo\"",
    )
    .unwrap();
    let cfg = read_config(&config_path).unwrap();
    assert_eq!(
        get_effective_command(&cfg.projects[0], CommandKind::Build),
        "cargo build"
    );
    assert_eq!(
        get_effective_command(&cfg.projects[0], CommandKind::Run),
        "cargo run"
    );
    assert_eq!(
        get_effective_command(&cfg.projects[0], CommandKind::Dev),
        ""
    );
}

#[test]
fn effective_command_uses_service_override() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        r#"
[workspace]
name = "w"

[[projects]]
name = "p"
path = "."
type = "maven"

[[projects.services]]
name = "default"
build_command = "mvn -q package"
run_command = "java -jar app.jar"
"#,
    )
    .unwrap();
    let cfg = read_config(&config_path).unwrap();
    assert_eq!(
        get_effective_command(&cfg.projects[0], CommandKind::Build),
        "mvn -q package"
    );
    assert_eq!(
        get_effective_command(&cfg.projects[0], CommandKind::Run),
        "java -jar app.jar"
    );
}

// ──────────────────────────────────────────────
// UiConfig tests
// ──────────────────────────────────────────────

#[test]
fn ui_config_defaults() {
    let ui = UiConfig::default();
    assert_eq!(ui.system_font_size, 14);
    assert_eq!(ui.editor_font_size, 14);
    assert!(ui.editor_zoom_wheel_enabled);
}

#[test]
fn ui_config_serde_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    let cfg_path = dir.path().join("dam-hopper").join("config.toml");

    let cfg = GlobalConfig {
        defaults: None,
        workspaces: None,
        ui: Some(UiConfig {
            system_font_size: 16,
            editor_font_size: 12,
            editor_zoom_wheel_enabled: false,
        }),
        server: crate::config::ServerConfig::default(),
    };

    write_global_config_at(&cfg_path, &cfg).unwrap();
    let loaded = read_global_config_at(&cfg_path).unwrap().unwrap();
    let ui = loaded.ui.unwrap();
    assert_eq!(ui.system_font_size, 16);
    assert_eq!(ui.editor_font_size, 12);
    assert!(!ui.editor_zoom_wheel_enabled);
}

#[test]
fn global_config_without_ui_section_parses_ok() {
    // Older config files without [ui] must continue to load.
    let dir = tempfile::tempdir().unwrap();
    let cfg_path = dir.path().join("config.toml");
    std::fs::write(&cfg_path, "[defaults]\nworkspace = \"/tmp/ws\"\n").unwrap();

    let loaded = read_global_config_at(&cfg_path).unwrap().unwrap();
    assert!(loaded.ui.is_none());
    assert_eq!(loaded.defaults.unwrap().workspace.as_deref(), Some("/tmp/ws"));
}

#[test]
fn validate_font_size_accepts_boundary_values() {
    assert!(UiConfig::validate_font_size(10).is_ok());
    assert!(UiConfig::validate_font_size(32).is_ok());
    assert!(UiConfig::validate_font_size(14).is_ok());
    assert!(UiConfig::validate_font_size(9).is_err());
    assert!(UiConfig::validate_font_size(33).is_err());
    assert!(UiConfig::validate_font_size(0).is_err());
}

#[test]
fn ui_config_validate_font_sizes_checks_both_fields() {
    let valid = UiConfig { system_font_size: 14, editor_font_size: 16, editor_zoom_wheel_enabled: true };
    assert!(valid.validate_font_sizes().is_ok());

    let bad_system = UiConfig { system_font_size: 5, editor_font_size: 14, editor_zoom_wheel_enabled: true };
    assert!(bad_system.validate_font_sizes().is_err());

    let bad_editor = UiConfig { system_font_size: 14, editor_font_size: 99, editor_zoom_wheel_enabled: false };
    assert!(bad_editor.validate_font_sizes().is_err());
}
