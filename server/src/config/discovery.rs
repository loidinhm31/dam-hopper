use std::path::Path;

use serde::Serialize;

use super::{
    presets::{get_preset, DETECTION_ORDER},
    schema::ProjectType,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredProject {
    pub name: String,
    pub path: String,
    pub project_type: ProjectType,
    pub is_git_repo: bool,
}

pub fn detect_project_type(project_dir: &Path) -> Option<ProjectType> {
    for project_type in DETECTION_ORDER {
        let preset = get_preset(project_type);
        for marker in preset.marker_files {
            if project_dir.join(marker).exists() {
                return Some(project_type.clone());
            }
        }
    }
    // Fallback: package.json → treat as npm
    if project_dir.join("package.json").exists() {
        return Some(ProjectType::Npm);
    }
    None
}

pub fn discover_projects(root_dir: &Path) -> Vec<DiscoveredProject> {
    let entries = match std::fs::read_dir(root_dir) {
        Ok(e) => e,
        Err(_) => return vec![],
    };

    entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let file_type = entry.file_type().ok()?;
            if !file_type.is_dir() {
                return None;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name == "node_modules" {
                return None;
            }
            let project_path = entry.path();
            let project_type = detect_project_type(&project_path)?;
            let is_git_repo = project_path.join(".git").exists();
            Some(DiscoveredProject {
                name,
                path: project_path.to_string_lossy().to_string(),
                project_type,
                is_git_repo,
            })
        })
        .collect()
}
