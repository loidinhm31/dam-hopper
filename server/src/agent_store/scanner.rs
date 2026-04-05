use std::path::{Path, PathBuf};
use tokio::fs;

use super::schema::{AgentPresence, AgentType, ProjectAgentScanResult, agent_paths};

/// Scan a single project directory for agent configurations.
pub async fn scan_project(project_name: &str, project_path: &Path) -> ProjectAgentScanResult {
    let mut result = ProjectAgentScanResult {
        project_name: project_name.to_string(),
        project_path: project_path.to_path_buf(),
        agents: Default::default(),
    };

    let agents = [AgentType::Claude, AgentType::Gemini];

    for agent in agents {
        let paths = agent_paths(agent);
        let root_dir = project_path.join(paths.root);
        if !root_dir.exists() {
            continue;
        }

        let skills = list_subdirs(&project_path.join(paths.skills)).await;
        let commands = list_md_files(&project_path.join(paths.commands)).await;
        let hooks = list_files(&project_path.join(paths.hooks)).await;
        let has_memory_file = project_path.join(paths.memory_file).exists();
        let has_mcp_config = project_path.join(paths.mcp_config).exists();

        result.agents.insert(
            agent.to_string(),
            AgentPresence {
                has_config: true,
                skills,
                commands,
                hooks,
                has_memory_file,
                has_mcp_config,
            },
        );
    }

    result
}

/// Scan all projects in the workspace for agent configurations.
pub async fn scan_all_projects(
    projects: &[(&str, &Path)],
    workspace_root: &Path,
) -> Vec<ProjectAgentScanResult> {
    let mut results = Vec::with_capacity(projects.len());
    for (name, rel_path) in projects {
        let abs_path = workspace_root.join(rel_path);
        results.push(scan_project(name, &abs_path).await);
    }
    results
}

/// Check if a path is a symlink and resolve its target.
pub async fn check_symlink(path: &Path) -> (bool, Option<PathBuf>) {
    match fs::symlink_metadata(path).await {
        Ok(meta) if meta.file_type().is_symlink() => match fs::read_link(path).await {
            Ok(target) => (true, Some(target)),
            Err(_) => (true, None),
        },
        _ => (false, None),
    }
}

async fn list_subdirs(dir: &Path) -> Vec<String> {
    let mut result = Vec::new();
    let Ok(mut rd) = fs::read_dir(dir).await else {
        return result;
    };
    while let Ok(Some(entry)) = rd.next_entry().await {
        if let Ok(ft) = entry.file_type().await {
            if ft.is_dir() {
                result.push(entry.file_name().to_string_lossy().into_owned());
            }
        }
    }
    result
}

async fn list_md_files(dir: &Path) -> Vec<String> {
    let mut result = Vec::new();
    let Ok(mut rd) = fs::read_dir(dir).await else {
        return result;
    };
    while let Ok(Some(entry)) = rd.next_entry().await {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".md") {
            if let Ok(ft) = entry.file_type().await {
                if ft.is_file() {
                    result.push(name[..name.len() - 3].to_string());
                }
            }
        }
    }
    result
}

async fn list_files(dir: &Path) -> Vec<String> {
    let mut result = Vec::new();
    let Ok(mut rd) = fs::read_dir(dir).await else {
        return result;
    };
    while let Ok(Some(entry)) = rd.next_entry().await {
        if let Ok(ft) = entry.file_type().await {
            if ft.is_file() {
                result.push(entry.file_name().to_string_lossy().into_owned());
            }
        }
    }
    result
}
