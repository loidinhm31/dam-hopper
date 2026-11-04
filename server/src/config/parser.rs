use std::path::{Component, Path, PathBuf};

use crate::error::AppError;
use crate::utils::atomic_write;

use super::schema::{
    DamHopperConfig, DamHopperConfigRaw, ProjectConfig, ProjectConfigRaw, RestartPolicy,
    ServiceConfig, TerminalProfile, TerminalProfileRaw, WorkspaceRootError,
    DEFAULT_RESTART_MAX_RETRIES,
};

// ──────────────────────────────────────────────
// Read
// ──────────────────────────────────────────────

pub fn read_config(file_path: &Path) -> Result<DamHopperConfig, AppError> {
    let content = std::fs::read_to_string(file_path).map_err(|e| {
        AppError::Config(format!(
            "Cannot read config file {}: {}",
            file_path.display(),
            e
        ))
    })?;
    parse_config_str_at_path(&content, file_path)
}

pub fn parse_config_str_at_path(
    content: &str,
    file_path: &Path,
) -> Result<DamHopperConfig, AppError> {
    let raw: DamHopperConfigRaw = toml::from_str(content)
        .map_err(|e| AppError::Config(format!("Invalid TOML in {}: {}", file_path.display(), e)))?;

    validate_config(&raw)?;

    let canonical = dunce::canonicalize(file_path)
        .unwrap_or_else(|_| file_path.to_path_buf());
    let config_dir = canonical
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| fallback_config_dir().to_path_buf());

    let workspace_root_candidate = raw.workspace.resolve_root(&config_dir).ok();
    let project_base_dir = workspace_root_candidate
        .as_deref()
        .unwrap_or(&config_dir);

    let projects = raw
        .projects
        .into_iter()
        .map(|p| resolve_project(p, project_base_dir))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(DamHopperConfig {
        workspace: raw.workspace,
        agent_store: raw.agent_store,
        server: raw.server,
        projects,
        features: raw.features,
        ui: raw.ui,
        workspaces: raw.workspaces,
        config_path: canonical,
    })
}
fn validate_config(raw: &DamHopperConfigRaw) -> Result<(), AppError> {
    raw.server.validate().map_err(AppError::Config)?;
    // Unique project names
    let names: Vec<&str> = raw.projects.iter().map(|p| p.name.as_str()).collect();
    let unique: std::collections::HashSet<_> = names.iter().collect();
    if unique.len() != names.len() {
        return Err(AppError::Config("Project names must be unique".to_string()));
    }

    for project in &raw.projects {
        if project.name.is_empty() {
            return Err(AppError::Config(
                "Project name must not be empty".to_string(),
            ));
        }

        // Allow absolute project paths, but still reject traversal components.
        validate_project_path(&project.path, &format!("projects.{}.path", project.name))?;

        // Reject absolute paths and path traversal in env_file
        if let Some(env_file) = &project.env_file {
            validate_relative_path(env_file, &format!("projects.{}.env_file", project.name))?;
        }

        // Unique service names
        if let Some(services) = &project.services {
            let snames: Vec<&str> = services.iter().map(|s| s.name.as_str()).collect();
            let sunique: std::collections::HashSet<_> = snames.iter().collect();
            if sunique.len() != snames.len() {
                return Err(AppError::Config(format!(
                    "Project '{}': service names must be unique",
                    project.name
                )));
            }
        }

        // Unique terminal profile names
        if let Some(terminals) = &project.terminals {
            let tnames: Vec<&str> = terminals.iter().map(|t| t.name.as_str()).collect();
            let tunique: std::collections::HashSet<_> = tnames.iter().collect();
            if tunique.len() != tnames.len() {
                return Err(AppError::Config(format!(
                    "Project '{}': terminal profile names must be unique",
                    project.name
                )));
            }

            for terminal in terminals {
                validate_relative_path(
                    &terminal.cwd,
                    &format!("projects.{}.terminals.{}.cwd", project.name, terminal.name),
                )?;
            }
        }

        // health_check_url must be an http/https URL when present
        if let Some(url) = &project.health_check_url {
            if !url.starts_with("http://") && !url.starts_with("https://") {
                return Err(AppError::Config(format!(
                    "Project '{}': health_check_url must start with http:// or https://, got: {}",
                    project.name, url
                )));
            }
        }
    }
    Ok(())
}

/// Reject `..` components to prevent path traversal attacks while allowing
/// absolute project roots in the registry.
///
/// `resolve_project_path()` relies on this guarantee to normalize relative
/// paths lexically without touching the filesystem.
fn validate_project_path(raw: &str, field: &str) -> Result<(), AppError> {
    let p = Path::new(raw);
    if p.components().any(|c| c == Component::ParentDir) {
        return Err(AppError::Config(format!(
            "Field '{}' must not contain '..' components: {}",
            field, raw
        )));
    }
    Ok(())
}

/// Reject absolute paths and `..` components to prevent path traversal attacks.
/// Supporting paths like env files should stay project-relative.
fn validate_relative_path(raw: &str, field: &str) -> Result<(), AppError> {
    let p = Path::new(raw);
    let is_windows_rooted_or_drive =
        raw.starts_with('\\') || (raw.len() >= 2 && raw.as_bytes()[1] == b':');
    if is_windows_rooted_or_drive
        || p.is_absolute()
        || p.has_root()
        || p.components()
            .any(|c| matches!(c, Component::Prefix(_) | Component::ParentDir))
    {
        return Err(AppError::Config(format!(
            "Field '{}' must be a relative path without traversal or root prefixes, got: {}",
            field, raw
        )));
    }
    Ok(())
}

fn resolve_project(raw: ProjectConfigRaw, config_dir: &Path) -> Result<ProjectConfig, AppError> {
    let raw_project_path = Path::new(&raw.path);
    let abs_project_path = resolve_project_path(config_dir, raw_project_path);

    let terminals = raw
        .terminals
        .unwrap_or_default()
        .into_iter()
        .map(|t| resolve_terminal(t, &abs_project_path))
        .collect();

    let services = raw
        .services
        .map(|svcs| svcs.into_iter().map(ServiceConfig::from).collect());

    Ok(ProjectConfig {
        name: raw.name,
        path: abs_project_path.to_string_lossy().to_string(),
        project_type: raw.project_type,
        services,
        commands: raw.commands,
        env_file: raw.env_file,
        tags: raw.tags,
        terminals,
        agents: raw.agents,
        restart_policy: raw.restart.unwrap_or(RestartPolicy::Never),
        restart_max_retries: raw
            .restart_max_retries
            .unwrap_or(DEFAULT_RESTART_MAX_RETRIES),
        health_check_url: raw.health_check_url,
    })
}

fn resolve_project_path(config_dir: &Path, raw_project_path: &Path) -> PathBuf {
    if raw_project_path.is_absolute() {
        return raw_project_path.to_path_buf();
    }

    join_validated_relative_path(config_dir, raw_project_path)
}

fn join_validated_relative_path(base_dir: &Path, relative_path: &Path) -> PathBuf {
    debug_assert!(
        !relative_path
            .components()
            .any(|component| component == Component::ParentDir),
        "Relative path must be validated before joining"
    );

    let mut joined = base_dir.to_path_buf();

    for component in relative_path.components() {
        if let Component::Normal(part) = component {
            joined.push(part);
        }
    }

    joined
}

fn fallback_config_dir() -> &'static Path {
    #[cfg(windows)]
    {
        Path::new("C:\\")
    }

    #[cfg(not(windows))]
    {
        Path::new("/")
    }
}

fn resolve_terminal(raw: TerminalProfileRaw, project_path: &Path) -> TerminalProfile {
    TerminalProfile {
        name: raw.name,
        command: raw.command,
        cwd: join_validated_relative_path(project_path, Path::new(&raw.cwd))
            .to_string_lossy()
            .to_string(),
    }
}

/// Determines if a path points to, is inside of, or is an ancestor of a sensitive server
/// configuration or daemon directory (such as ~/.config/dam-hopper, /var/lib/dam-hopper, /etc/dam-hopper).
pub fn is_sensitive_workspace_root(path: &Path) -> bool {
    let canonical = dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());

    let mut sensitive_dirs = Vec::new();
    sensitive_dirs.push(super::global::dam_hopper_config_dir());
    if let Some(home) = dirs::home_dir() {
        sensitive_dirs.push(home.join(".config").join("dam-hopper"));
    }
    sensitive_dirs.push(PathBuf::from("/var/lib/dam-hopper"));
    sensitive_dirs.push(PathBuf::from("/etc/dam-hopper"));

    for dir in sensitive_dirs {
        let canonical_dir = dunce::canonicalize(&dir).unwrap_or(dir);
        // Exact match or inside sensitive directory
        if canonical == canonical_dir || canonical.starts_with(&canonical_dir) {
            return true;
        }
        // Ancestor of sensitive directory (candidate contains the sensitive directory)
        if canonical_dir.starts_with(&canonical) {
            return true;
        }
    }

    // Component-level safety guard: detect any path segment sequence .config -> dam-hopper
    let components: Vec<_> = canonical
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect();
    for window in components.windows(2) {
        if window[0] == ".config" && window[1] == "dam-hopper" {
            return true;
        }
    }

    // If candidate contains a .config/dam-hopper subdirectory, it contains sensitive daemon data
    if canonical.join(".config").join("dam-hopper").exists() {
        return true;
    }

    false
}

/// Authoritatively resolves the workspace browse root relative to the config file directory.
///
/// Requires the root to exist on disk as a directory and passes sensitive directory safety guards.
pub fn resolve_workspace_root(
    config_dir: &Path,
    raw_root: &str,
) -> Result<PathBuf, WorkspaceRootError> {
    let trimmed = raw_root.trim();
    if trimmed.is_empty() {
        return Err(WorkspaceRootError::Unconfigured);
    }
    let candidate = if trimmed == "." {
        config_dir.to_path_buf()
    } else {
        let p = Path::new(trimmed);
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            config_dir.join(p)
        }
    };

    let canonical = dunce::canonicalize(&candidate).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            WorkspaceRootError::NotFound(candidate.clone())
        } else {
            WorkspaceRootError::CanonicalizationFailed(format!("{}: {}", candidate.display(), e))
        }
    })?;

    if !canonical.is_dir() {
        return Err(WorkspaceRootError::NotADirectory(canonical));
    }

    let canonical_config_dir = dunce::canonicalize(config_dir).unwrap_or_else(|_| config_dir.to_path_buf());
    if is_sensitive_workspace_root(&canonical_config_dir) && canonical_config_dir.starts_with(&canonical) {
        return Err(WorkspaceRootError::SensitiveDirectory(canonical));
    }

    if is_sensitive_workspace_root(&canonical) {
        return Err(WorkspaceRootError::SensitiveDirectory(canonical));
    }

    Ok(canonical)
}

// ──────────────────────────────────────────────
// Write
// ──────────────────────────────────────────────

pub fn write_config(file_path: &Path, config: &DamHopperConfig) -> Result<(), AppError> {
    let abs_path = dunce::canonicalize(file_path)
        .unwrap_or_else(|_| file_path.to_path_buf());
    let config_dir = abs_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| fallback_config_dir().to_path_buf());

    let workspace_root_candidate = config.resolve_workspace_root().ok();
    let project_base_dir = workspace_root_candidate
        .as_deref()
        .unwrap_or(&config_dir);

    let raw = build_raw_toml(config, project_base_dir, file_path)?;
    let toml_str = toml::to_string_pretty(&raw)
        .map_err(|e| AppError::Config(format!("Failed to serialize config: {}", e)))?;

    atomic_write(file_path, &toml_str)
}

fn build_raw_toml(
    config: &DamHopperConfig,
    project_base_dir: &Path,
    file_path: &Path,
) -> Result<toml::Value, AppError> {
    use toml::Value;

    let mut map = if file_path.exists() {
        let existing = std::fs::read_to_string(file_path)
            .map_err(|e| AppError::Config(format!("Cannot read config {}: {}", file_path.display(), e)))?;
        toml::from_str::<toml::Value>(&existing)
            .map_err(|e| AppError::Config(format!("Invalid TOML in {}: {}", file_path.display(), e)))?
            .as_table()
            .cloned()
            .unwrap_or_default()
    } else {
        toml::map::Map::new()
    };

    let mut ws = toml::map::Map::new();
    ws.insert(
        "name".to_string(),
        Value::String(config.workspace.name.clone()),
    );
    if !config.workspace.root.is_empty() {
        ws.insert(
            "root".to_string(),
            Value::String(config.workspace.root.clone()),
        );
    }
    map.insert("workspace".to_string(), Value::Table(ws));

    if let Some(agent_store) = &config.agent_store {
        let mut ast = toml::map::Map::new();
        ast.insert("path".to_string(), Value::String(agent_store.path.clone()));
        map.insert("agent_store".to_string(), Value::Table(ast));
    }

    let serialized_server = server_to_toml(&config.server);
    if let Some(existing_server) = map.get_mut("server").and_then(|t| t.as_table_mut()) {
        existing_server.remove("advisor");
        if !config.server.session_changes_enabled {
            existing_server.remove("session_changes_enabled");
        }
        if let Some(new_server) = serialized_server.as_table() {
            for (sk, sv) in new_server {
                existing_server.insert(sk.clone(), sv.clone());
            }
        }
        if existing_server.is_empty() && config.server == Default::default() {
            map.remove("server");
        }
    } else if config.server != Default::default() {
        let mut s = serialized_server;
        if let Some(t) = s.as_table_mut() {
            t.remove("advisor");
        }
        map.insert("server".to_string(), s);
    }

    let projects: Vec<Value> = config
        .projects
        .iter()
        .map(|p| project_to_toml(p, project_base_dir))
        .collect();
    if !projects.is_empty() {
        map.insert("projects".to_string(), Value::Array(projects));
    } else {
        map.remove("projects");
    }

    if let Some(ui) = &config.ui {
        let ui_json = serde_json::to_value(ui)
            .map_err(|e| AppError::Config(format!("Failed to serialize ui config: {e}")))?;
        let mut normalized_json = ui_json;
        super::global::normalize_ui_json_for_toml(&mut normalized_json);
        if let Some(ui_toml) = super::global::json_to_toml(&normalized_json) {
            map.insert("ui".to_string(), ui_toml);
        }
    }

    if let Some(workspaces) = &config.workspaces {
        let ws_json = serde_json::to_value(workspaces)
            .map_err(|e| AppError::Config(format!("Failed to serialize workspaces: {e}")))?;
        if let Some(ws_toml) = super::global::json_to_toml(&ws_json) {
            map.insert("workspaces".to_string(), ws_toml);
        }
    }

    Ok(Value::Table(map))
}

pub(crate) fn server_to_toml(server: &super::schema::ServerConfig) -> toml::Value {
    use toml::Value;
    let mut config = toml::map::Map::new();
    config.insert(
        "session_db_path".to_string(),
        Value::String(server.session_db_path.clone()),
    );
    config.insert(
        "session_buffer_ttl_hours".to_string(),
        Value::Integer(server.session_buffer_ttl_hours as i64),
    );
    config.insert(
        "workflow_event_retention_days".to_string(),
        Value::Integer(server.workflow_event_retention_days.into()),
    );
    config.insert(
        "workflow_deleted_note_retention_days".to_string(),
        Value::Integer(server.workflow_deleted_note_retention_days.into()),
    );
    config.insert(
        "workflow_stale_after_hours".to_string(),
        Value::Integer(server.workflow_stale_after_hours.into()),
    );
    if server.session_changes_enabled {
        config.insert(
            "session_changes_enabled".to_string(),
            Value::Boolean(true),
        );
    }
    if server.host_resources != Default::default() {
        let resources = &server.host_resources;
        let mut table = toml::map::Map::new();
        table.insert(
            "light_sample_seconds".into(),
            Value::Integer(resources.light_sample_seconds as i64),
        );
        table.insert(
            "process_sample_seconds".into(),
            Value::Integer(resources.process_sample_seconds as i64),
        );
        table.insert(
            "pss_sample_seconds".into(),
            Value::Integer(resources.pss_sample_seconds as i64),
        );
        table.insert(
            "jitter_millis".into(),
            Value::Integer(resources.jitter_millis as i64),
        );
        table.insert(
            "process_deadline_millis".into(),
            Value::Integer(resources.process_deadline_millis as i64),
        );
        table.insert(
            "snapshot_deadline_millis".into(),
            Value::Integer(resources.snapshot_deadline_millis as i64),
        );
        table.insert(
            "ring_capacity".into(),
            Value::Integer(resources.ring_capacity as i64),
        );
        table.insert(
            "max_alert_incidents".into(),
            Value::Integer(resources.max_alert_incidents as i64),
        );
        table.insert(
            "reclaimable_cache_percent".into(),
            Value::Integer(resources.reclaimable_cache_percent as i64),
        );
        table.insert(
            "available_warning_percent".into(),
            Value::Integer(resources.available_warning_percent as i64),
        );
        table.insert(
            "available_critical_percent".into(),
            Value::Integer(resources.available_critical_percent as i64),
        );
        table.insert(
            "available_oom_percent".into(),
            Value::Integer(resources.available_oom_percent as i64),
        );
        table.insert(
            "psi_some_percent".into(),
            Value::Integer(resources.psi_some_percent as i64),
        );
        table.insert(
            "psi_full_percent".into(),
            Value::Integer(resources.psi_full_percent as i64),
        );
        config.insert("host_resources".into(), Value::Table(table));
    }
    if server.idle_suspend != Default::default() {
        let idle_suspend = &server.idle_suspend;
        let mut table = toml::map::Map::new();
        table.insert("enabled".to_string(), Value::Boolean(idle_suspend.enabled));
        table.insert(
            "quiet_period_seconds".to_string(),
            Value::Integer(idle_suspend.quiet_period_seconds as i64),
        );
        table.insert(
            "wake_after_seconds".to_string(),
            Value::Integer(idle_suspend.wake_after_seconds as i64),
        );
        if let Some(enrollment) = &idle_suspend.enrollment_reference {
            table.insert(
                "enrollment_reference".to_string(),
                Value::String(enrollment.clone()),
            );
        }
        if idle_suspend.capability_selection != Default::default() {
            table.insert(
                "capability_selection".to_string(),
                Value::String(idle_suspend.capability_selection.as_str().to_string()),
            );
        }
        if idle_suspend.automatic_policy != Default::default() {
            table.insert(
                "automatic_policy".to_string(),
                Value::String(idle_suspend.automatic_policy.as_str().to_string()),
            );
        }
        if idle_suspend.agent_executables != super::schema::default_idle_suspend_agent_executables() {
            let execs = idle_suspend
                .agent_executables
                .iter()
                .cloned()
                .map(Value::String)
                .collect();
            table.insert("agent_executables".to_string(), Value::Array(execs));
        }
        config.insert("idle_suspend".to_string(), Value::Table(table));
    }
    Value::Table(config)
}

pub(crate) fn project_path_for_toml(abs: &Path, config_dir: &Path) -> String {
    match pathdiff::diff_paths(abs, config_dir) {
        Some(relative)
            if !relative.is_absolute()
                && !matches!(relative.components().next(), Some(Component::ParentDir)) =>
        {
            let relative = relative.to_string_lossy().replace('\\', "/");
            if relative.is_empty() {
                ".".to_string()
            } else {
                relative
            }
        }
        _ => abs.to_string_lossy().to_string(),
    }
}

fn project_to_toml(p: &ProjectConfig, config_dir: &Path) -> toml::Value {
    use toml::Value;

    let mut map = toml::map::Map::new();
    map.insert("name".to_string(), Value::String(p.name.clone()));

    let abs = PathBuf::from(&p.path);
    map.insert(
        "path".to_string(),
        Value::String(project_path_for_toml(&abs, config_dir)),
    );
    map.insert(
        "type".to_string(),
        Value::String(p.project_type.to_string()),
    );

    if let Some(services) = &p.services {
        let svcs: Vec<Value> = services
            .iter()
            .map(|s| {
                let mut sm = toml::map::Map::new();
                sm.insert("name".to_string(), Value::String(s.name.clone()));
                if let Some(bc) = &s.build_command {
                    sm.insert("build_command".to_string(), Value::String(bc.clone()));
                }
                if let Some(rc) = &s.run_command {
                    sm.insert("run_command".to_string(), Value::String(rc.clone()));
                }
                Value::Table(sm)
            })
            .collect();
        map.insert("services".to_string(), Value::Array(svcs));
    }

    if let Some(commands) = &p.commands {
        let mut cm = toml::map::Map::new();
        for (k, v) in commands {
            cm.insert(k.clone(), Value::String(v.clone()));
        }
        map.insert("commands".to_string(), Value::Table(cm));
    }

    if let Some(env_file) = &p.env_file {
        map.insert("env_file".to_string(), Value::String(env_file.clone()));
    }

    if let Some(tags) = &p.tags {
        map.insert(
            "tags".to_string(),
            Value::Array(tags.iter().map(|t| Value::String(t.clone())).collect()),
        );
    }

    if !p.terminals.is_empty() {
        let project_path = PathBuf::from(&p.path);
        let terms: Vec<Value> = p
            .terminals
            .iter()
            .map(|t| {
                let mut tm = toml::map::Map::new();
                tm.insert("name".to_string(), Value::String(t.name.clone()));
                tm.insert("command".to_string(), Value::String(t.command.clone()));
                let abs_cwd = PathBuf::from(&t.cwd);
                // Terminal cwd stays project-relative even when the project path
                // itself is written as an absolute registry path.
                let rel_cwd = pathdiff::diff_paths(&abs_cwd, &project_path)
                    .unwrap_or(abs_cwd)
                    .to_string_lossy()
                    .replace('\\', "/");
                let rel_cwd = if rel_cwd.is_empty() {
                    ".".to_string()
                } else {
                    rel_cwd
                };
                tm.insert("cwd".to_string(), Value::String(rel_cwd));
                Value::Table(tm)
            })
            .collect();
        map.insert("terminals".to_string(), Value::Array(terms));
    }

    // Only write non-default restart fields to keep TOML files clean.
    if p.restart_policy != RestartPolicy::Never {
        let policy_str = match p.restart_policy {
            RestartPolicy::Never => "never",
            RestartPolicy::OnFailure => "on-failure",
            RestartPolicy::Always => "always",
        };
        map.insert("restart".to_string(), Value::String(policy_str.to_string()));
    }
    if p.restart_max_retries != DEFAULT_RESTART_MAX_RETRIES {
        map.insert(
            "restart_max_retries".to_string(),
            Value::Integer(p.restart_max_retries as i64),
        );
    }
    if let Some(url) = &p.health_check_url {
        map.insert("health_check_url".to_string(), Value::String(url.clone()));
    }

    // NOTE: `agents` is intentionally not written back — writeConfig is the build/run UI path.
    // Agent assignment is managed by the agent-store subsystem, not the config editor.

    toml::Value::Table(map)
}
