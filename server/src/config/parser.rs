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

    let raw: DamHopperConfigRaw = toml::from_str(&content).map_err(|e| {
        AppError::Config(format!(
            "Invalid TOML in {}: {}",
            file_path.display(),
            e
        ))
    })?;

    validate_config(&raw)?;

    let canonical = file_path
        .canonicalize()
        .unwrap_or_else(|_| file_path.to_path_buf());
    let config_dir = canonical.parent().unwrap_or(Path::new("/"));

    let projects = raw
        .projects
        .into_iter()
        .map(|p| resolve_project(p, config_dir))
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

        // Reject absolute paths and path traversal in project.path
        validate_relative_path(&project.path, &format!("projects.{}.path", project.name))?;

        // Reject absolute paths and path traversal in env_file
        if let Some(env_file) = &project.env_file {
            validate_relative_path(
                env_file,
                &format!("projects.{}.env_file", project.name),
            )?;
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

/// Reject absolute paths and `..` components to prevent path traversal attacks.
/// Config paths should always be relative to the workspace root.
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
    let abs_project_path = config_dir.join(&raw.path);

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
        restart_max_retries: raw.restart_max_retries.unwrap_or(DEFAULT_RESTART_MAX_RETRIES),
        health_check_url: raw.health_check_url,
    })
}

fn resolve_terminal(raw: TerminalProfileRaw, project_path: &Path) -> TerminalProfile {
    TerminalProfile {
        name: raw.name,
        command: raw.command,
        cwd: project_path
            .join(&raw.cwd)
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
    let config_dir = abs_path.parent().unwrap_or(Path::new("/"));

    let raw = build_raw_toml(config, config_dir);
    let toml_str = toml::to_string_pretty(&raw).map_err(|e| {
        AppError::Config(format!("Failed to serialize config: {}", e))
    })?;

    atomic_write(file_path, &toml_str)
}

fn build_raw_toml(config: &DamHopperConfig, config_dir: &Path) -> toml::Value {
    use toml::Value;

    let mut map = toml::map::Map::new();

    let mut ws = toml::map::Map::new();
    ws.insert("name".to_string(), Value::String(config.workspace.name.clone()));
    ws.insert("root".to_string(), Value::String(config.workspace.root.clone()));
    map.insert("workspace".to_string(), Value::Table(ws));

    if let Some(agent_store) = &config.agent_store {
        let mut ast = toml::map::Map::new();
        ast.insert("path".to_string(), Value::String(agent_store.path.clone()));
        map.insert("agent_store".to_string(), Value::Table(ast));
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

fn project_to_toml(p: &ProjectConfig, config_dir: &Path) -> toml::Value {
    use toml::Value;

    let mut map = toml::map::Map::new();
    map.insert("name".to_string(), Value::String(p.name.clone()));

    let abs = PathBuf::from(&p.path);
    let rel = pathdiff::diff_paths(&abs, config_dir)
        .unwrap_or(abs)
        .to_string_lossy()
        .to_string();
    let rel = if rel.is_empty() { ".".to_string() } else { rel };
    map.insert("path".to_string(), Value::String(rel));
    map.insert("type".to_string(), Value::String(p.project_type.to_string()));

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
        map.insert("restart_max_retries".to_string(), Value::Integer(p.restart_max_retries as i64));
    }
    if let Some(url) = &p.health_check_url {
        map.insert("health_check_url".to_string(), Value::String(url.clone()));
    }

    // NOTE: `agents` is intentionally not written back — writeConfig is the build/run UI path.
    // Agent assignment is managed by the agent-store subsystem, not the config editor.

    toml::Value::Table(map)
}
