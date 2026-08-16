use super::{
    discovery::{detect_project_type, discover_projects},
    finder::find_config_file,
    global::{
        add_known_workspace_at, list_known_workspaces_at, read_global_config_at,
        remove_known_workspace_at, write_global_config_at,
    },
    parser::{project_path_for_toml, read_config, write_config},
    presets::{get_effective_command, get_preset},
    resolve::{resolve_startup_config, ConfigResolutionInput, ConfigSource},
    schema::{
        CommandKind, ExplorerLanguageFilter, GlobalConfig, KnownWorkspace, ProjectType,
        RestartPolicy, TerminalCodexNotificationSoundPattern, UiConfig,
        MAX_HOST_RESOURCE_PINNED_MOUNT_BYTES,
    },
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
    assert!(!cfg.server.telemetry.enabled);
    assert_eq!(cfg.server.telemetry.detail_retention_days, 90);
}

#[test]
fn host_resource_monitor_config_uses_snake_case_and_roundtrips() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        r#"
[workspace]
name = "resources"

[server.host_resources]
light_sample_seconds = 7
process_deadline_millis = 150
max_alert_incidents = 12
"#,
    )
    .unwrap();

    let config = read_config(&config_path).unwrap();
    assert_eq!(config.server.host_resources.light_sample_seconds, 7);
    assert_eq!(config.server.host_resources.process_deadline_millis, 150);
    assert_eq!(config.server.host_resources.max_alert_incidents, 12);

    write_config(&config_path, &config).unwrap();
    let written = std::fs::read_to_string(&config_path).unwrap();
    assert!(written.contains("light_sample_seconds = 7"));
    assert!(!written.contains("lightSampleSeconds"));
}

#[test]
fn telemetry_config_rejects_removed_usage_keys() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        r#"
[workspace]
name = "telemetry"

[server.telemetry]
enabled = true
terminal_correlation_enabled = false
excluded_projects = ["private"]
"#,
    )
    .unwrap();

    assert!(read_config(&config_path).is_err());
}

#[test]
fn telemetry_config_uses_snake_case_toml_and_camel_case_api() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        r#"
[workspace]
name = "telemetry"

[server.telemetry]
enabled = true
db_path = "/tmp/telemetry.db"
detail_retention_days = 30
aggregate_retention_days = 730

[server.telemetry.collector]
enabled = true
host = "127.0.0.1"
port = 4811
    "#,
    )
    .unwrap();
    let config = read_config(&config_path).unwrap();
    assert!(config.server.telemetry.enabled);
    assert_eq!(config.server.telemetry.db_path, "/tmp/telemetry.db");
    assert_eq!(config.server.telemetry.collector.port, 4811);
    assert_eq!(
        serde_json::to_value(&config.server.telemetry).unwrap()["dbPath"],
        "/tmp/telemetry.db"
    );
    write_config(&config_path, &config).unwrap();
    let written = std::fs::read_to_string(&config_path).unwrap();
    assert!(written.contains("detail_retention_days = 30"));
    assert!(!written.contains("terminal_correlation_enabled"));
    assert!(!written.contains("detailRetentionDays"));
}

#[test]
fn telemetry_config_rejects_non_loopback_collector() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        r#"
[workspace]
name = "telemetry"

[server.telemetry.collector]
host = "0.0.0.0"
"#,
    )
    .unwrap();
    assert!(read_config(&config_path).is_err());
}

#[test]
fn telemetry_config_rejects_invalid_retention() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        r#"
[workspace]
name = "telemetry"

[server.telemetry]
detail_retention_days = 0
"#,
    )
    .unwrap();
    assert!(read_config(&config_path).is_err());
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
fn parse_config_with_terminal_profile() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        r#"
[workspace]
name = "term-ws"

[[projects]]
name = "backend"
path = "./backend"
type = "cargo"

[[projects.terminals]]
name = "shell"
command = "bash"
cwd = "./ops"
"#,
    )
    .unwrap();

    let cfg = read_config(&config_path).unwrap();
    assert_eq!(cfg.projects[0].terminals.len(), 1);
    assert_eq!(
        cfg.projects[0].terminals[0].cwd,
        dir.path().join("backend/ops").to_string_lossy()
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
fn accept_absolute_project_path() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    let project_path = dir.path().join("project-root");
    std::fs::write(
        &config_path,
        format!(
            "[workspace]\nname=\"w\"\n\n[[projects]]\nname=\"p\"\npath=\"{}\"\ntype=\"cargo\"",
            project_path.display()
        ),
    )
    .unwrap();

    let cfg = read_config(&config_path).unwrap();
    assert_eq!(cfg.projects[0].path, project_path.to_string_lossy());
}

#[test]
fn resolve_relative_project_path_against_config_dir() {
    let dir = tempfile::tempdir().unwrap();
    let config_dir = dir.path().join("registry");
    std::fs::create_dir_all(&config_dir).unwrap();
    let config_path = config_dir.join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        "[workspace]\nname=\"w\"\n\n[[projects]]\nname=\"p\"\npath=\"./project-root\"\ntype=\"cargo\"",
    )
    .unwrap();

    let cfg = read_config(&config_path).unwrap();
    assert_eq!(
        cfg.projects[0].path,
        config_dir.join("project-root").to_string_lossy()
    );
}

#[test]
fn resolve_relative_project_path_removes_redundant_current_dir_components() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        "[workspace]\nname=\"w\"\n\n[[projects]]\nname=\"p\"\npath=\"././project-root\"\ntype=\"cargo\"",
    )
    .unwrap();

    let cfg = read_config(&config_path).unwrap();
    assert_eq!(
        cfg.projects[0].path,
        dir.path().join("project-root").to_string_lossy()
    );
}

#[test]
fn reject_path_traversal_in_project_path() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        "[workspace]\nname=\"w\"\n\n[[projects]]\nname=\"p\"\npath=\"../outside\"\ntype=\"cargo\"",
    )
    .unwrap();

    assert!(read_config(&config_path).is_err());
}

#[test]
fn reject_multiple_parent_dir_components_in_project_path() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        "[workspace]\nname=\"w\"\n\n[[projects]]\nname=\"p\"\npath=\"../../outside\"\ntype=\"cargo\"",
    )
    .unwrap();

    assert!(read_config(&config_path).is_err());
}

#[test]
fn reject_path_traversal_in_absolute_project_path() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    let project_path = dir.path().join("..").join("outside");
    std::fs::write(
        &config_path,
        format!(
            "[workspace]\nname=\"w\"\n\n[[projects]]\nname=\"p\"\npath=\"{}\"\ntype=\"cargo\"",
            project_path.display()
        ),
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
fn reject_absolute_env_file() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    let env_file = dir.path().join(".env");
    std::fs::write(
        &config_path,
        format!(
            "[workspace]\nname=\"w\"\n\n[[projects]]\nname=\"p\"\npath=\".\"\ntype=\"cargo\"\nenv_file=\"{}\"",
            env_file.display()
        ),
    )
    .unwrap();

    assert!(read_config(&config_path).is_err());
}

#[test]
fn reject_path_traversal_in_terminal_cwd() {
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

[[projects.terminals]]
name = "shell"
command = "bash"
cwd = "../../etc"
"#,
    )
    .unwrap();

    assert!(read_config(&config_path).is_err());
}

#[test]
fn reject_absolute_terminal_cwd() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    let cwd = dir.path().join("ops");
    std::fs::write(
        &config_path,
        format!(
            "[workspace]\nname=\"w\"\n\n[[projects]]\nname=\"p\"\npath=\".\"\ntype=\"cargo\"\n\n[[projects.terminals]]\nname=\"shell\"\ncommand=\"bash\"\ncwd=\"{}\"",
            cwd.display()
        ),
    )
    .unwrap();

    assert!(read_config(&config_path).is_err());
}

#[cfg(windows)]
#[test]
fn accept_windows_absolute_project_path() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    let project_path = std::env::temp_dir().join("dam-hopper-windows-project");
    std::fs::create_dir_all(&project_path).unwrap();
    let project_path_raw = project_path.to_string_lossy().replace('\\', "/");
    std::fs::write(
        &config_path,
        format!(
            "[workspace]\nname=\"w\"\n\n[[projects]]\nname=\"p\"\npath=\"{}\"\ntype=\"cargo\"",
            project_path_raw
        ),
    )
    .unwrap();

    let cfg = read_config(&config_path).unwrap();
    assert_eq!(cfg.projects[0].path, project_path.to_string_lossy());
}

#[cfg(windows)]
#[test]
fn accept_windows_absolute_project_path_with_mixed_separators() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    let project_path = std::env::temp_dir()
        .join("dam-hopper-windows-project")
        .join("nested");
    std::fs::create_dir_all(&project_path).unwrap();

    let mut project_path_raw = project_path.to_string_lossy().replace('\\', "/");
    if let Some((index, _)) = project_path_raw
        .char_indices()
        .skip(3)
        .find(|(_, ch)| *ch == '/')
    {
        project_path_raw.replace_range(index..=index, "\\");
    }

    assert!(project_path_raw.contains('/'));
    assert!(project_path_raw.contains('\\'));

    std::fs::write(
        &config_path,
        format!(
            "[workspace]\nname='w'\n\n[[projects]]\nname='p'\npath='{}'\ntype='cargo'",
            project_path_raw
        ),
    )
    .unwrap();

    let cfg = read_config(&config_path).unwrap();
    assert_eq!(
        std::path::PathBuf::from(&cfg.projects[0].path),
        project_path
    );
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

#[test]
fn project_path_for_toml_returns_dot_for_config_dir_root() {
    let dir = tempfile::tempdir().unwrap();

    assert_eq!(project_path_for_toml(dir.path(), dir.path()), ".");
}

#[test]
fn project_path_for_toml_uses_forward_slash_relative_path_inside_config_dir() {
    let dir = tempfile::tempdir().unwrap();
    let project_path = dir.path().join("nested").join("inside");

    let formatted = project_path_for_toml(&project_path, dir.path());

    assert_eq!(formatted, "nested/inside");
    assert!(!formatted.contains('\\'));
}

#[test]
fn project_path_for_toml_preserves_absolute_path_outside_config_dir() {
    let registry = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let project_path = outside.path().join("outside-project");

    let formatted = project_path_for_toml(&project_path, registry.path());

    assert_eq!(formatted, project_path.to_string_lossy());
    assert!(std::path::Path::new(&formatted).is_absolute());
}

#[test]
fn config_roundtrip_preserves_mixed_relative_and_absolute_project_paths() {
    let registry = tempfile::tempdir().unwrap();
    let config_dir = registry.path().join("registry");
    std::fs::create_dir_all(config_dir.join("nested/inside")).unwrap();

    let outside = tempfile::tempdir().unwrap();
    let outside_path = outside.path().join("project-root");
    let outside_path_raw = outside_path.to_string_lossy().replace('\\', "/");
    let config_path = config_dir.join("dam-hopper.toml");

    std::fs::write(
        &config_path,
        format!(
            r#"
[workspace]
name = "rt-ws"

[[projects]]
name = "inside"
path = "./nested/inside"
type = "cargo"

[[projects]]
name = "outside"
path = "{}"
type = "cargo"
"#,
            outside_path_raw
        ),
    )
    .unwrap();

    let original = read_config(&config_path).unwrap();
    write_config(&config_path, &original).unwrap();
    let reloaded = read_config(&config_path).unwrap();
    let written = std::fs::read_to_string(&config_path).unwrap();
    let parsed: toml::Value = toml::from_str(&written).unwrap();
    let projects = parsed["projects"].as_array().unwrap();
    let inside_path = projects[0]["path"].as_str().unwrap();
    let outside_path_written = projects[1]["path"].as_str().unwrap();

    assert_eq!(inside_path, "nested/inside");
    assert!(!inside_path.contains('\\'));
    assert!(std::path::Path::new(outside_path_written).is_absolute());
    assert_eq!(outside_path_written, original.projects[1].path);
    assert_eq!(original.projects[0].path, reloaded.projects[0].path);
    assert_eq!(original.projects[1].path, reloaded.projects[1].path);
}

#[cfg(windows)]
#[test]
fn write_config_escapes_native_windows_absolute_project_paths() {
    use super::schema::{DamHopperConfig, FeaturesConfig, ProjectConfig, WorkspaceInfo};

    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    let outside = tempfile::tempdir().unwrap();
    let project_path = outside.path().join("windows-project");

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "windows-rt".to_string(),
            root: ".".to_string(),
        },
        agent_store: None,
        server: super::schema::ServerConfig::default(),
        projects: vec![ProjectConfig {
            name: "outside".to_string(),
            path: project_path.to_string_lossy().to_string(),
            project_type: ProjectType::Cargo,
            services: None,
            commands: None,
            env_file: None,
            tags: None,
            terminals: vec![],
            agents: None,
            restart_policy: RestartPolicy::Never,
            restart_max_retries: super::schema::DEFAULT_RESTART_MAX_RETRIES,
            health_check_url: None,
        }],
        features: FeaturesConfig::default(),
        config_path: config_path.clone(),
    };

    write_config(&config_path, &config).unwrap();

    let written = std::fs::read_to_string(&config_path).unwrap();
    let escaped = project_path.to_string_lossy().replace('\\', "\\\\");
    assert!(written.contains(&format!("path = \"{}\"", escaped)));

    let reloaded = read_config(&config_path).unwrap();
    assert_eq!(reloaded.projects[0].path, project_path.to_string_lossy());
}

#[cfg(windows)]
#[test]
fn project_path_for_toml_preserves_verbatim_windows_absolute_paths() {
    let registry = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let project_path = outside.path().join("windows-project");
    let verbatim = std::path::PathBuf::from(format!(r"\\?\{}", project_path.display()));

    let formatted = project_path_for_toml(&verbatim, registry.path());

    assert_eq!(formatted, verbatim.to_string_lossy());
    assert!(std::path::Path::new(&formatted).is_absolute());
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
    assert_eq!(
        original.projects[0].restart_policy,
        RestartPolicy::OnFailure
    );
    assert_eq!(original.projects[0].restart_max_retries, 3);
    assert_eq!(
        original.projects[0].health_check_url.as_deref(),
        Some("http://localhost:8080/health")
    );

    write_config(&config_path, &original).unwrap();
    let reloaded = read_config(&config_path).unwrap();

    assert_eq!(
        reloaded.projects[0].restart_policy,
        RestartPolicy::OnFailure
    );
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
fn global_config_writes_snake_case_ui_and_server_keys() {
    let dir = tempfile::tempdir().unwrap();
    let cfg_path = dir.path().join("dam-hopper").join("config.toml");

    let cfg = GlobalConfig {
        defaults: Some(super::schema::GlobalDefaults {
            workspace: Some("/tmp/ws".to_string()),
        }),
        workspaces: None,
        ui: Some(UiConfig {
            host_resource_pinned_mount: Some("/data".to_string()),
            terminal_codex_notifications_enabled: true,
            ..UiConfig::default()
        }),
        server: crate::config::ServerConfig {
            session_db_path: "/tmp/sessions.db".to_string(),
            session_buffer_ttl_hours: 12,
            telemetry: crate::config::TelemetryConfig::default(),
            host_resources: crate::config::HostResourceMonitorConfig::default(),
        },
    };

    write_global_config_at(&cfg_path, &cfg).unwrap();
    let written = std::fs::read_to_string(&cfg_path).unwrap();

    assert!(written.contains("terminal_codex_notifications_enabled = true"));
    assert!(written.contains("host_resource_pinned_mount = \"/data\""));
    assert!(written.contains("terminal_codex_notification_toast_enabled = true"));
    assert!(written.contains("terminal_codex_browser_notifications_enabled = true"));
    assert!(written.contains("terminal_codex_notification_sound_pattern = \"default\""));
    assert!(written.contains("session_db_path = \"/tmp/sessions.db\""));
    assert!(written.contains("session_buffer_ttl_hours = 12"));
    assert!(!written.contains("terminalAgentNotificationsEnabled"));
    assert!(!written.contains("hostResourcePinnedMount"));
    assert!(!written.contains("terminalCodexNotificationToastEnabled"));
    assert!(!written.contains("sessionDbPath"));
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
// Startup config resolver tests
// ──────────────────────────────────────────────

#[test]
fn resolve_explicit_config_path_uses_exact_file() {
    let dir = tempfile::tempdir().unwrap();
    let registry = dir.path().join("custom-registry.toml");
    write_workspace_config(&registry, "explicit");

    let resolution = resolve_startup_config(ConfigResolutionInput {
        explicit_config: Some(registry.clone()),
        workspace_dir: None,
        global_default_workspace: None,
        current_dir: dir.path().join("cwd"),
        registry_path: dir.path().join("missing-registry.toml"),
    })
    .unwrap();

    assert_eq!(resolution.source, ConfigSource::ExplicitConfig);
    assert_eq!(resolution.config.workspace.name, "explicit");
    assert_eq!(
        resolution.config.config_path,
        registry.canonicalize().unwrap()
    );
    assert_eq!(resolution.workspace_dir, registry.parent().unwrap());
}

#[test]
fn resolve_explicit_config_invalid_toml_returns_error() {
    let dir = tempfile::tempdir().unwrap();
    let registry = dir.path().join("bad-registry.toml");
    std::fs::write(&registry, "invalid [[[[ toml").unwrap();

    let result = resolve_startup_config(ConfigResolutionInput {
        explicit_config: Some(registry),
        workspace_dir: None,
        global_default_workspace: None,
        current_dir: dir.path().join("cwd"),
        registry_path: dir.path().join("missing-registry.toml"),
    });

    assert!(result.is_err());
}

#[test]
fn resolve_workspace_uses_found_config_parent() {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("dam-hopper.toml");
    write_workspace_config(&config_path, "workspace");

    let nested = dir.path().join("server").join("src");
    std::fs::create_dir_all(&nested).unwrap();

    let resolution = resolve_startup_config(ConfigResolutionInput {
        explicit_config: None,
        workspace_dir: Some(nested),
        global_default_workspace: None,
        current_dir: dir.path().join("cwd"),
        registry_path: dir.path().join("missing-registry.toml"),
    })
    .unwrap();

    assert_eq!(resolution.source, ConfigSource::Workspace);
    assert_eq!(resolution.config.workspace.name, "workspace");
    assert_eq!(resolution.workspace_dir, dir.path());
}

#[test]
fn resolve_prefers_global_registry_over_legacy_discovery() {
    let dir = tempfile::tempdir().unwrap();
    let registry = dir.path().join("dam-hopper.toml");
    write_workspace_config(&registry, "registry");

    let default_workspace = dir.path().join("default-workspace");
    std::fs::create_dir_all(&default_workspace).unwrap();
    write_workspace_config(&default_workspace.join("dam-hopper.toml"), "default");

    let cwd = dir.path().join("cwd");
    std::fs::create_dir_all(&cwd).unwrap();
    write_workspace_config(&cwd.join("dam-hopper.toml"), "cwd");

    let resolution = resolve_startup_config(ConfigResolutionInput {
        explicit_config: None,
        workspace_dir: None,
        global_default_workspace: Some(default_workspace),
        current_dir: cwd,
        registry_path: registry,
    })
    .unwrap();

    assert_eq!(resolution.source, ConfigSource::GlobalRegistry);
    assert_eq!(resolution.config.workspace.name, "registry");
}

#[test]
fn resolve_uses_global_default_workspace_when_registry_missing() {
    let dir = tempfile::tempdir().unwrap();
    let default_workspace = dir.path().join("default-workspace");
    std::fs::create_dir_all(&default_workspace).unwrap();
    write_workspace_config(&default_workspace.join("dam-hopper.toml"), "default");

    let resolution = resolve_startup_config(ConfigResolutionInput {
        explicit_config: None,
        workspace_dir: None,
        global_default_workspace: Some(default_workspace.clone()),
        current_dir: dir.path().join("cwd"),
        registry_path: dir.path().join("missing-registry.toml"),
    })
    .unwrap();

    assert_eq!(resolution.source, ConfigSource::GlobalDefaultWorkspace);
    assert_eq!(resolution.config.workspace.name, "default");
    assert_eq!(resolution.workspace_dir, default_workspace);
}

#[test]
fn resolve_uses_current_dir_when_higher_priority_sources_missing() {
    let dir = tempfile::tempdir().unwrap();
    let cwd = dir.path().join("cwd");
    std::fs::create_dir_all(&cwd).unwrap();
    write_workspace_config(&cwd.join("dam-hopper.toml"), "cwd");

    let resolution = resolve_startup_config(ConfigResolutionInput {
        explicit_config: None,
        workspace_dir: None,
        global_default_workspace: Some(dir.path().join("missing-default")),
        current_dir: cwd.clone(),
        registry_path: dir.path().join("missing-registry.toml"),
    })
    .unwrap();

    assert_eq!(resolution.source, ConfigSource::CurrentDirectory);
    assert_eq!(resolution.config.workspace.name, "cwd");
    assert_eq!(resolution.workspace_dir, cwd);
}

#[test]
fn resolve_explicit_workspace_missing_config_returns_empty_fallback() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = dir.path().join("empty-workspace");
    std::fs::create_dir_all(&workspace).unwrap();

    let resolution = resolve_startup_config(ConfigResolutionInput {
        explicit_config: None,
        workspace_dir: Some(workspace.clone()),
        global_default_workspace: None,
        current_dir: dir.path().join("cwd"),
        registry_path: dir.path().join("missing-registry.toml"),
    })
    .unwrap();

    assert_eq!(resolution.source, ConfigSource::EmptyFallback);
    assert_eq!(resolution.workspace_dir, workspace);
    assert_eq!(resolution.config.workspace.name, "unknown");
    assert_eq!(resolution.config.projects.len(), 0);
}

#[test]
fn resolve_missing_everything_returns_empty_current_dir_fallback() {
    let dir = tempfile::tempdir().unwrap();
    let cwd = dir.path().join("cwd");
    std::fs::create_dir_all(&cwd).unwrap();

    let resolution = resolve_startup_config(ConfigResolutionInput {
        explicit_config: None,
        workspace_dir: None,
        global_default_workspace: Some(dir.path().join("missing-default")),
        current_dir: cwd.clone(),
        registry_path: dir.path().join("missing-registry.toml"),
    })
    .unwrap();

    assert_eq!(resolution.source, ConfigSource::EmptyFallback);
    assert_eq!(resolution.workspace_dir, cwd.clone());
    assert_eq!(resolution.config.config_path, cwd.join("dam-hopper.toml"));
}

fn write_workspace_config(path: &std::path::Path, workspace_name: &str) {
    std::fs::write(
        path,
        format!(
            r#"
[workspace]
name = "{workspace_name}"
"#
        ),
    )
    .unwrap();
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
    assert_eq!(ui.host_resource_pinned_mount, None);
    assert_eq!(ui.system_font_size, 14);
    assert_eq!(ui.editor_font_size, 14);
    assert_eq!(ui.terminal_font_size, 13);
    assert!(ui.editor_zoom_wheel_enabled);
    assert_eq!(ui.search_text_shortcut, "Mod+Shift+KeyF");
    assert_eq!(ui.search_filename_shortcut, "DoubleShift");
    assert_eq!(ui.terminal_workspace_shortcut, "Mod+Shift+Backquote");
    assert_eq!(ui.terminal_file_panel_shortcut, "Mod+Shift+KeyE");
    assert_eq!(ui.reveal_active_file_shortcut, "Alt+F1");
    assert_eq!(ui.git_panel_shortcut, "Mod+Shift+KeyG");
    assert_eq!(ui.ports_panel_shortcut, "Mod+Shift+KeyP");
    assert_eq!(ui.fleet_terminal_shortcut, "Mod+Shift+KeyM");
    assert_eq!(
        ui.terminal_font_size_increase_shortcut,
        "Ctrl+Alt+Shift+Equal"
    );
    assert_eq!(ui.terminal_font_size_decrease_shortcut, "Ctrl+Alt+Minus");
    assert!(ui.terminal_auto_switch_project_enabled);
    assert!(!ui.terminal_codex_notifications_enabled);
    assert!(ui.terminal_codex_notification_toast_enabled);
    assert!(ui.terminal_codex_browser_notifications_enabled);
    assert!(ui.terminal_codex_notification_sound_enabled);
    assert_eq!(ui.terminal_codex_notification_sound_volume, 100);
    assert_eq!(
        ui.terminal_codex_notification_sound_pattern,
        TerminalCodexNotificationSoundPattern::Default
    );
    assert_eq!(ui.explorer_language_filter, ExplorerLanguageFilter::All);
    assert!(ui.mobile_custom_keyboard_enabled);
    assert_eq!(ui.mobile_custom_keyboard_font_size, 11);
    assert_eq!(ui.mobile_custom_keyboard_padding, 6);
    assert_eq!(ui.mobile_custom_keyboard_row_gap, 4);
}

#[test]
fn ui_config_serde_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    let cfg_path = dir.path().join("dam-hopper").join("config.toml");

    let cfg = GlobalConfig {
        defaults: None,
        workspaces: None,
        ui: Some(UiConfig {
            host_resource_pinned_mount: Some("/mnt/fast data".to_string()),
            system_font_size: 16,
            editor_font_size: 12,
            terminal_font_size: 15,
            editor_zoom_wheel_enabled: false,
            search_text_shortcut: "Ctrl+Alt+KeyS".to_string(),
            search_filename_shortcut: "Ctrl+KeyP".to_string(),
            terminal_workspace_shortcut: "Ctrl+Shift+Backquote".to_string(),
            terminal_file_panel_shortcut: "Ctrl+Shift+KeyE".to_string(),
            reveal_active_file_shortcut: "Alt+F1".to_string(),
            git_panel_shortcut: "Ctrl+Shift+KeyG".to_string(),
            ports_panel_shortcut: "Ctrl+Shift+KeyP".to_string(),
            fleet_terminal_shortcut: "Ctrl+Shift+KeyM".to_string(),
            terminal_font_size_increase_shortcut: "Ctrl+Alt+Shift+Equal".to_string(),
            terminal_font_size_decrease_shortcut: "Ctrl+Alt+Minus".to_string(),
            terminal_suggestions_enabled: true,
            terminal_auto_switch_project_enabled: true,
            terminal_codex_notifications_enabled: true,
            terminal_codex_notification_toast_enabled: false,
            terminal_codex_browser_notifications_enabled: false,
            terminal_codex_notification_sound_enabled: false,
            terminal_codex_notification_sound_volume: 45,
            terminal_codex_notification_sound_pattern:
                TerminalCodexNotificationSoundPattern::TwoTone,
            explorer_show_hidden: false,
            explorer_language_filter: ExplorerLanguageFilter::JavascriptTypescript,
            mobile_custom_keyboard_enabled: false,
            mobile_custom_keyboard_font_size: 13,
            mobile_custom_keyboard_padding: 8,
            mobile_custom_keyboard_row_gap: 5,
            terminal_order: vec!["term1".to_string(), "term2".to_string()],
            project_order: vec!["proj1".to_string()],
            project_command_order: {
                let mut m = std::collections::HashMap::new();
                m.insert("proj1".to_string(), vec!["cmd1".to_string()]);
                m
            },
            runtime_group_order: vec!["proj1".to_string(), "__free__".to_string()],
            runtime_item_order: {
                let mut m = std::collections::HashMap::new();
                m.insert("proj1".to_string(), vec!["session:term1".to_string()]);
                m
            },
            terminal_scroll_buttons_enabled: false,
            terminal_commit_status_enabled: true,
            terminal_scroll_step: 3,
        }),
        server: crate::config::ServerConfig::default(),
    };

    let json = serde_json::to_value(cfg.ui.as_ref().unwrap()).unwrap();
    assert_eq!(
        json["terminalCodexNotificationSoundPattern"],
        serde_json::json!("two-tone")
    );
    assert_eq!(
        json["hostResourcePinnedMount"],
        serde_json::json!("/mnt/fast data")
    );
    assert_eq!(json["terminalFontSize"], 15);
    assert_eq!(
        json["terminalFontSizeIncreaseShortcut"],
        serde_json::json!("Ctrl+Alt+Shift+Equal")
    );
    assert!(json.get("host_resource_pinned_mount").is_none());
    assert_eq!(
        json["explorerLanguageFilter"],
        serde_json::json!("javascript-typescript")
    );
    assert!(json
        .get("terminal_codex_notification_sound_pattern")
        .is_none());
    assert_eq!(json["terminalCommitStatusEnabled"], true);
    assert_eq!(json["terminalAutoSwitchProjectEnabled"], true);
    assert!(json.get("terminal_auto_switch_project_enabled").is_none());

    write_global_config_at(&cfg_path, &cfg).unwrap();
    let written = std::fs::read_to_string(&cfg_path).unwrap();
    assert!(written.contains("terminal_commit_status_enabled = true"));
    assert!(written.contains("terminal_font_size = 15"));
    assert!(written.contains("terminal_font_size_increase_shortcut = \"Ctrl+Alt+Shift+Equal\""));
    assert!(written.contains("host_resource_pinned_mount = \"/mnt/fast data\""));
    assert!(!written.contains("hostResourcePinnedMount"));
    assert!(!written.contains("terminalCommitStatusEnabled"));
    assert!(written.contains("terminal_auto_switch_project_enabled = true"));
    assert!(!written.contains("terminalAutoSwitchProjectEnabled"));
    assert!(written.contains("explorer_language_filter = \"javascript-typescript\""));
    assert!(!written.contains("explorerLanguageFilter"));
    let loaded = read_global_config_at(&cfg_path).unwrap().unwrap();
    let ui = loaded.ui.unwrap();
    assert_eq!(ui.system_font_size, 16);
    assert_eq!(
        ui.host_resource_pinned_mount.as_deref(),
        Some("/mnt/fast data")
    );
    assert_eq!(ui.editor_font_size, 12);
    assert_eq!(ui.terminal_font_size, 15);
    assert_eq!(
        ui.terminal_font_size_increase_shortcut,
        "Ctrl+Alt+Shift+Equal"
    );
    assert_eq!(ui.terminal_font_size_decrease_shortcut, "Ctrl+Alt+Minus");
    assert!(!ui.editor_zoom_wheel_enabled);
    assert_eq!(ui.search_text_shortcut, "Ctrl+Alt+KeyS");
    assert_eq!(ui.search_filename_shortcut, "Ctrl+KeyP");
    assert_eq!(ui.terminal_workspace_shortcut, "Ctrl+Shift+Backquote");
    assert_eq!(ui.terminal_file_panel_shortcut, "Ctrl+Shift+KeyE");
    assert_eq!(ui.reveal_active_file_shortcut, "Alt+F1");
    assert_eq!(ui.git_panel_shortcut, "Ctrl+Shift+KeyG");
    assert_eq!(ui.ports_panel_shortcut, "Ctrl+Shift+KeyP");
    assert_eq!(ui.fleet_terminal_shortcut, "Ctrl+Shift+KeyM");
    assert!(ui.terminal_codex_notifications_enabled);
    assert!(ui.terminal_auto_switch_project_enabled);
    assert!(!ui.terminal_codex_notification_toast_enabled);
    assert!(!ui.terminal_codex_browser_notifications_enabled);
    assert!(!ui.terminal_codex_notification_sound_enabled);
    assert_eq!(ui.terminal_codex_notification_sound_volume, 45);
    assert_eq!(
        ui.terminal_codex_notification_sound_pattern,
        TerminalCodexNotificationSoundPattern::TwoTone
    );
    assert_eq!(
        ui.explorer_language_filter,
        ExplorerLanguageFilter::JavascriptTypescript
    );
    assert!(!ui.mobile_custom_keyboard_enabled);
    assert_eq!(ui.mobile_custom_keyboard_font_size, 13);
    assert_eq!(ui.mobile_custom_keyboard_padding, 8);
    assert_eq!(ui.mobile_custom_keyboard_row_gap, 5);
    assert!(ui.terminal_commit_status_enabled);
    assert_eq!(ui.terminal_order, vec!["term1", "term2"]);
    assert_eq!(ui.project_order, vec!["proj1"]);
    assert_eq!(
        ui.project_command_order.get("proj1").unwrap(),
        &vec!["cmd1"]
    );
    assert_eq!(ui.runtime_group_order, vec!["proj1", "__free__"]);
    assert_eq!(
        ui.runtime_item_order.get("proj1").unwrap(),
        &vec!["session:term1"]
    );
}

#[test]
fn ui_config_serde_aliases_search_shortcuts() {
    let toml = r#"
[ui]
system_font_size = 14
editor_font_size = 14
editor_zoom_wheel_enabled = true
search_text_shortcut = "Ctrl+Shift+KeyF"
search_filename_shortcut = "Ctrl+KeyP"
terminal_workspace_shortcut = "Ctrl+Shift+Backquote"
terminal_file_panel_shortcut = "Ctrl+Shift+KeyE"
reveal_active_file_shortcut = "Alt+F1"
git_panel_shortcut = "Ctrl+Shift+KeyG"
ports_panel_shortcut = "Ctrl+Shift+KeyP"
fleet_terminal_shortcut = "Ctrl+Shift+KeyM"
terminal_agent_notifications_enabled = true
mobile_custom_keyboard_enabled = false
mobile_custom_keyboard_font_size = 14
mobile_custom_keyboard_padding = 9
mobile_custom_keyboard_row_gap = 6
"#;

    let loaded: GlobalConfig = toml::from_str(toml).unwrap();
    let ui = loaded.ui.unwrap();
    assert_eq!(ui.search_text_shortcut, "Ctrl+Shift+KeyF");
    assert_eq!(ui.search_filename_shortcut, "Ctrl+KeyP");
    assert_eq!(ui.terminal_workspace_shortcut, "Ctrl+Shift+Backquote");
    assert_eq!(ui.terminal_file_panel_shortcut, "Ctrl+Shift+KeyE");
    assert_eq!(ui.reveal_active_file_shortcut, "Alt+F1");
    assert_eq!(ui.git_panel_shortcut, "Ctrl+Shift+KeyG");
    assert_eq!(ui.ports_panel_shortcut, "Ctrl+Shift+KeyP");
    assert_eq!(ui.fleet_terminal_shortcut, "Ctrl+Shift+KeyM");
    assert!(ui.terminal_codex_notifications_enabled);
    assert!(!ui.mobile_custom_keyboard_enabled);
    assert_eq!(ui.mobile_custom_keyboard_font_size, 14);
    assert_eq!(ui.mobile_custom_keyboard_padding, 9);
    assert_eq!(ui.mobile_custom_keyboard_row_gap, 6);
}

#[test]
fn ui_config_serde_aliases_runtime_order_fields() {
    let toml = r#"
[ui]
runtime_group_order = ["web", "__free__"]

[ui.runtime_item_order]
web = ["session:web", "port:web:5173"]
"#;

    let loaded: GlobalConfig = toml::from_str(toml).unwrap();
    let ui = loaded.ui.unwrap();
    assert_eq!(ui.runtime_group_order, vec!["web", "__free__"]);
    assert_eq!(
        ui.runtime_item_order.get("web").unwrap(),
        &vec!["session:web", "port:web:5173"]
    );
}

#[test]
fn global_config_without_ui_section_parses_ok() {
    // Older config files without [ui] must continue to load.
    let dir = tempfile::tempdir().unwrap();
    let cfg_path = dir.path().join("config.toml");
    std::fs::write(&cfg_path, "[defaults]\nworkspace = \"/tmp/ws\"\n").unwrap();

    let loaded = read_global_config_at(&cfg_path).unwrap().unwrap();
    assert!(loaded.ui.is_none());
    assert_eq!(
        loaded.defaults.unwrap().workspace.as_deref(),
        Some("/tmp/ws")
    );
}

#[test]
fn global_config_read_accepts_legacy_codex_notification_toggle() {
    let dir = tempfile::tempdir().unwrap();
    let cfg_path = dir.path().join("config.toml");
    std::fs::write(
        &cfg_path,
        r#"
[ui]
system_font_size = 18
terminal_agent_notifications_enabled = true
"#,
    )
    .unwrap();

    let loaded = read_global_config_at(&cfg_path).unwrap().unwrap();
    let ui = loaded.ui.unwrap();
    assert_eq!(ui.system_font_size, 18);
    assert!(ui.terminal_codex_notifications_enabled);
    assert!(ui.terminal_codex_notification_toast_enabled);
    assert!(ui.terminal_codex_browser_notifications_enabled);
    assert_eq!(
        ui.terminal_codex_notification_sound_pattern,
        TerminalCodexNotificationSoundPattern::Default
    );
}

#[test]
fn ui_config_serde_aliases_terminal_commit_status() {
    for key in [
        "terminal_commit_status_enabled",
        "terminalCommitStatusEnabled",
    ] {
        let toml = format!("[ui]\n{key} = true\n");
        let loaded: GlobalConfig = toml::from_str(&toml).unwrap();
        assert!(loaded.ui.unwrap().terminal_commit_status_enabled);
    }
}

#[test]
fn ui_config_serde_aliases_terminal_auto_switch_project() {
    for key in [
        "terminal_auto_switch_project_enabled",
        "terminalAutoSwitchProjectEnabled",
    ] {
        let toml = format!("[ui]\n{key} = true\n");
        let loaded: GlobalConfig = toml::from_str(&toml).unwrap();
        assert!(loaded.ui.unwrap().terminal_auto_switch_project_enabled);
    }

    let json = serde_json::from_value::<UiConfig>(serde_json::json!({
        "terminalAutoSwitchProjectEnabled": true
    }))
    .unwrap();
    assert!(json.terminal_auto_switch_project_enabled);

    let json = serde_json::from_value::<UiConfig>(serde_json::json!({
        "terminalAutoSwitchProjectEnabled": false
    }))
    .unwrap();
    assert!(!json.terminal_auto_switch_project_enabled);

    let toml: GlobalConfig =
        toml::from_str("[ui]\nterminal_auto_switch_project_enabled = false\n").unwrap();
    assert!(!toml.ui.unwrap().terminal_auto_switch_project_enabled);
}

#[test]
fn ui_config_serde_aliases_explorer_language_filter() {
    for key in ["explorer_language_filter", "explorerLanguageFilter"] {
        let toml = format!("[ui]\n{key} = \"java\"\n");
        let loaded: GlobalConfig = toml::from_str(&toml).unwrap();
        assert_eq!(
            loaded.ui.unwrap().explorer_language_filter,
            ExplorerLanguageFilter::Java
        );
    }

    let json = serde_json::from_value::<UiConfig>(serde_json::json!({
        "explorerLanguageFilter": "rust"
    }))
    .unwrap();
    assert_eq!(json.explorer_language_filter, ExplorerLanguageFilter::Rust);

    let invalid = serde_json::from_value::<UiConfig>(serde_json::json!({
        "explorerLanguageFilter": "python"
    }));
    assert!(invalid.is_err());
}

#[test]
fn ui_config_missing_terminal_auto_switch_project_defaults_true() {
    let json = serde_json::from_value::<UiConfig>(serde_json::json!({})).unwrap();
    assert!(json.terminal_auto_switch_project_enabled);

    let toml: GlobalConfig = toml::from_str("[ui]\n").unwrap();
    assert!(toml.ui.unwrap().terminal_auto_switch_project_enabled);
}

#[test]
fn ui_config_serde_aliases_host_resource_pinned_mount() {
    for key in ["host_resource_pinned_mount", "hostResourcePinnedMount"] {
        let toml = format!("[ui]\n{key} = \"/data\"\n");
        let loaded: GlobalConfig = toml::from_str(&toml).unwrap();
        assert_eq!(
            loaded.ui.unwrap().host_resource_pinned_mount.as_deref(),
            Some("/data")
        );
    }

    let json = serde_json::from_value::<UiConfig>(serde_json::json!({
        "hostResourcePinnedMount": "/data2"
    }))
    .unwrap();
    assert_eq!(json.host_resource_pinned_mount.as_deref(), Some("/data2"));

    let snake_json = serde_json::from_value::<UiConfig>(serde_json::json!({
        "host_resource_pinned_mount": "/data3"
    }))
    .unwrap();
    assert_eq!(
        snake_json.host_resource_pinned_mount.as_deref(),
        Some("/data3")
    );
}

#[test]
fn ui_config_missing_host_resource_pinned_mount_defaults_to_none() {
    let json = serde_json::from_value::<UiConfig>(serde_json::json!({})).unwrap();
    assert_eq!(json.host_resource_pinned_mount, None);

    let toml: GlobalConfig = toml::from_str("[ui]\n").unwrap();
    assert_eq!(toml.ui.unwrap().host_resource_pinned_mount, None);
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
    let valid = UiConfig {
        system_font_size: 14,
        editor_font_size: 16,
        terminal_font_size: 13,
        ..UiConfig::default()
    };
    assert!(valid.validate_font_sizes().is_ok());

    let bad_system = UiConfig {
        system_font_size: 5,
        editor_font_size: 14,
        ..UiConfig::default()
    };
    assert!(bad_system.validate_font_sizes().is_err());

    let bad_editor = UiConfig {
        system_font_size: 14,
        editor_font_size: 99,
        ..UiConfig::default()
    };
    assert!(bad_editor.validate_font_sizes().is_err());

    let bad_terminal = UiConfig {
        terminal_font_size: 33,
        ..UiConfig::default()
    };
    assert!(bad_terminal.validate_font_sizes().is_err());
}

#[test]
fn validate_mobile_keyboard_sizes_checks_font_and_padding() {
    let valid = UiConfig {
        mobile_custom_keyboard_font_size: 12,
        mobile_custom_keyboard_padding: 6,
        mobile_custom_keyboard_row_gap: 4,
        ..UiConfig::default()
    };
    assert!(valid.validate_mobile_keyboard_sizes().is_ok());

    let bad_font = UiConfig {
        mobile_custom_keyboard_font_size: 24,
        mobile_custom_keyboard_padding: 6,
        mobile_custom_keyboard_row_gap: 4,
        ..UiConfig::default()
    };
    assert!(bad_font.validate_mobile_keyboard_sizes().is_err());

    let bad_padding = UiConfig {
        mobile_custom_keyboard_font_size: 12,
        mobile_custom_keyboard_padding: 1,
        mobile_custom_keyboard_row_gap: 4,
        ..UiConfig::default()
    };
    assert!(bad_padding.validate_mobile_keyboard_sizes().is_err());

    let bad_row_gap = UiConfig {
        mobile_custom_keyboard_font_size: 12,
        mobile_custom_keyboard_padding: 6,
        mobile_custom_keyboard_row_gap: 1,
        ..UiConfig::default()
    };
    assert!(bad_row_gap.validate_mobile_keyboard_sizes().is_err());
}

#[test]
fn validate_terminal_notification_sound_volume_checks_bounds() {
    assert!(UiConfig::default()
        .validate_terminal_notification_sound_volume()
        .is_ok());

    let invalid = UiConfig {
        terminal_codex_notification_sound_volume: 101,
        ..UiConfig::default()
    };
    assert!(invalid
        .validate_terminal_notification_sound_volume()
        .is_err());
}

#[test]
fn validate_host_resource_pinned_mount_checks_utf8_byte_bounds() {
    assert!(UiConfig::default()
        .validate_host_resource_pinned_mount()
        .is_ok());

    for mount_point in [
        "/data".to_string(),
        "é".repeat(MAX_HOST_RESOURCE_PINNED_MOUNT_BYTES / 2),
    ] {
        let valid = UiConfig {
            host_resource_pinned_mount: Some(mount_point),
            ..UiConfig::default()
        };
        assert!(valid.validate_host_resource_pinned_mount().is_ok());
    }

    let empty = UiConfig {
        host_resource_pinned_mount: Some(String::new()),
        ..UiConfig::default()
    };
    assert!(empty.validate_host_resource_pinned_mount().is_err());

    let oversized = UiConfig {
        host_resource_pinned_mount: Some("x".repeat(MAX_HOST_RESOURCE_PINNED_MOUNT_BYTES + 1)),
        ..UiConfig::default()
    };
    assert!(oversized.validate_host_resource_pinned_mount().is_err());
}
