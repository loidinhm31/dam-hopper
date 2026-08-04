use std::path::{Component, Path, PathBuf};

use crate::error::AppError;
use crate::utils::atomic_write;

use super::schema::{
    DamHopperConfig, DamHopperConfigRaw, ProjectConfig, ProjectConfigRaw, RestartPolicy,
    ServiceConfig, TerminalProfile, TerminalProfileRaw, DEFAULT_RESTART_MAX_RETRIES,
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

    let raw: DamHopperConfigRaw = toml::from_str(&content)
        .map_err(|e| AppError::Config(format!("Invalid TOML in {}: {}", file_path.display(), e)))?;

    validate_config(&raw)?;

    let canonical = file_path
        .canonicalize()
        .unwrap_or_else(|_| file_path.to_path_buf());
    let config_dir = canonical
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| fallback_config_dir().to_path_buf());

    let projects = raw
        .projects
        .into_iter()
        .map(|p| resolve_project(p, &config_dir))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(DamHopperConfig {
        workspace: raw.workspace,
        agent_store: raw.agent_store,
        server: raw.server,
        projects,
        features: raw.features,
        config_path: canonical,
    })
}

fn validate_config(raw: &DamHopperConfigRaw) -> Result<(), AppError> {
    raw.server.telemetry.validate().map_err(AppError::Config)?;

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
    if p.is_absolute() {
        return Err(AppError::Config(format!(
            "Field '{}' must be a relative path, got absolute: {}",
            field, raw
        )));
    }
    if p.components().any(|c| c == Component::ParentDir) {
        return Err(AppError::Config(format!(
            "Field '{}' must not contain '..' components: {}",
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

// ──────────────────────────────────────────────
// Write
// ──────────────────────────────────────────────

pub fn write_config(file_path: &Path, config: &DamHopperConfig) -> Result<(), AppError> {
    let abs_path = file_path
        .canonicalize()
        .unwrap_or_else(|_| file_path.to_path_buf());
    let config_dir = abs_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| fallback_config_dir().to_path_buf());

    let raw = build_raw_toml(config, &config_dir);
    let toml_str = toml::to_string_pretty(&raw)
        .map_err(|e| AppError::Config(format!("Failed to serialize config: {}", e)))?;

    atomic_write(file_path, &toml_str)
}

fn build_raw_toml(config: &DamHopperConfig, config_dir: &Path) -> toml::Value {
    use toml::Value;

    let mut map = toml::map::Map::new();

    let mut ws = toml::map::Map::new();
    ws.insert(
        "name".to_string(),
        Value::String(config.workspace.name.clone()),
    );
    ws.insert(
        "root".to_string(),
        Value::String(config.workspace.root.clone()),
    );
    map.insert("workspace".to_string(), Value::Table(ws));

    if let Some(agent_store) = &config.agent_store {
        let mut ast = toml::map::Map::new();
        ast.insert("path".to_string(), Value::String(agent_store.path.clone()));
        map.insert("agent_store".to_string(), Value::Table(ast));
    }

    if config.server != Default::default() {
        map.insert("server".to_string(), server_to_toml(&config.server));
    }

    let projects: Vec<Value> = config
        .projects
        .iter()
        .map(|p| project_to_toml(p, config_dir))
        .collect();
    if !projects.is_empty() {
        map.insert("projects".to_string(), Value::Array(projects));
    }

    Value::Table(map)
}

fn server_to_toml(server: &super::schema::ServerConfig) -> toml::Value {
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
    if server.telemetry != Default::default() {
        let telemetry = &server.telemetry;
        let mut table = toml::map::Map::new();
        table.insert("enabled".to_string(), Value::Boolean(telemetry.enabled));
        table.insert("paused".to_string(), Value::Boolean(telemetry.paused));
        table.insert(
            "db_path".to_string(),
            Value::String(telemetry.db_path.clone()),
        );
        table.insert(
            "detail_retention_days".to_string(),
            Value::Integer(telemetry.detail_retention_days.into()),
        );
        if let Some(days) = telemetry.aggregate_retention_days {
            table.insert(
                "aggregate_retention_days".to_string(),
                Value::Integer(days.into()),
            );
        }
        let mut collector = toml::map::Map::new();
        collector.insert(
            "enabled".to_string(),
            Value::Boolean(telemetry.collector.enabled),
        );
        collector.insert(
            "host".to_string(),
            Value::String(telemetry.collector.host.clone()),
        );
        collector.insert(
            "port".to_string(),
            Value::Integer(telemetry.collector.port.into()),
        );
        table.insert("collector".to_string(), Value::Table(collector));
        config.insert("telemetry".to_string(), Value::Table(table));
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
                    .to_string();
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
