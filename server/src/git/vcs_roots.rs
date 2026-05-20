use std::collections::{BTreeMap, HashMap};
use std::ffi::OsStr;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

use crate::error::AppError;
use crate::git::repository::get_status;
use crate::git::types::{SubmoduleGitlinkInfo, VcsRoot, VcsRootKind, VcsRootMappingState};

const MAX_NESTED_REPO_DEPTH: usize = 8;

#[derive(Debug, Default)]
struct GitmoduleEntry {
    path: Option<String>,
    url: Option<String>,
}

#[derive(Debug)]
struct GitlinkEntry {
    path: String,
    object_id: String,
}

#[derive(Debug, Default)]
struct GitmodulesMap {
    by_path: HashMap<String, (String, Option<String>)>,
    warnings: Vec<String>,
}

pub fn discover_vcs_roots(project_path: &Path) -> Result<Vec<VcsRoot>, AppError> {
    if !project_path.exists() {
        return Err(AppError::GitNotFound(
            project_path.to_string_lossy().into_owned(),
        ));
    }

    let mut roots = BTreeMap::<String, VcsRoot>::new();
    let root_abs = display_path(project_path);
    roots.insert(
        ".".to_string(),
        VcsRoot {
            root_id: ".".to_string(),
            path: ".".to_string(),
            absolute_path: root_abs,
            kind: VcsRootKind::Primary,
            mapping_state: None,
            gitlink: None,
            status: status_for(project_path, "."),
            warnings: Vec::new(),
        },
    );

    let gitmodules = read_gitmodules(project_path);
    if let Some(primary) = roots.get_mut(".") {
        primary.warnings.extend(gitmodules.warnings.clone());
    }

    let gitlinks = read_gitlinks(project_path);
    for warning in &gitlinks.warnings {
        if let Some(primary) = roots.get_mut(".") {
            primary.warnings.push(warning.clone());
        }
    }

    for gitlink in gitlinks.entries {
        let root_id = normalize_root_id(&gitlink.path);
        let abs = project_path.join(&gitlink.path);
        let (module_name, url) = gitmodules
            .by_path
            .get(&root_id)
            .cloned()
            .unwrap_or((String::new(), None));
        let has_mapping = !module_name.is_empty();
        let mapping_state = classify_gitlink(project_path, &gitlink.path, has_mapping);
        let status = if has_git_marker(&abs) {
            status_for(&abs, &root_id)
        } else {
            None
        };
        let mut warnings = Vec::new();
        match mapping_state {
            VcsRootMappingState::Missing => {
                warnings.push("gitlink path is missing on disk".to_string());
            }
            VcsRootMappingState::Uninitialized => {
                warnings.push("gitlink path exists without a usable .git marker".to_string());
            }
            VcsRootMappingState::Unmapped => {
                warnings.push("gitlink has no matching .gitmodules path".to_string());
            }
            VcsRootMappingState::Mapped => {}
        }

        roots.insert(
            root_id.clone(),
            VcsRoot {
                root_id,
                path: normalize_root_id(&gitlink.path),
                absolute_path: display_path(&abs),
                kind: VcsRootKind::Submodule,
                mapping_state: Some(mapping_state),
                gitlink: Some(SubmoduleGitlinkInfo {
                    path: normalize_root_id(&gitlink.path),
                    object_id: gitlink.object_id,
                    module_name: has_mapping.then_some(module_name),
                    url,
                }),
                status,
                warnings,
            },
        );
    }

    for nested in scan_nested_repos(project_path) {
        roots.entry(nested.clone()).or_insert_with(|| {
            let abs = project_path.join(&nested);
            VcsRoot {
                root_id: nested.clone(),
                path: nested.clone(),
                absolute_path: display_path(&abs),
                kind: VcsRootKind::NestedRepo,
                mapping_state: None,
                gitlink: None,
                status: status_for(&abs, &nested),
                warnings: Vec::new(),
            }
        });
    }

    Ok(roots.into_values().collect())
}

pub fn resolve_vcs_root(project_path: &Path, root_id: &str) -> Result<PathBuf, AppError> {
    if root_id != "." {
        let root_path = Path::new(root_id);
        if root_path.is_absolute() || has_traversal(root_path) {
            return Err(AppError::InvalidInput(format!(
                "invalid VCS root id: {root_id}"
            )));
        }
    }

    let project = dunce::canonicalize(project_path)?;
    let candidate = if root_id == "." {
        project.clone()
    } else {
        dunce::canonicalize(project.join(root_id))
            .map_err(|_| AppError::NotFound(format!("VCS root not found: {root_id}")))?
    };

    if !candidate.starts_with(&project) {
        return Err(AppError::InvalidInput(format!(
            "VCS root escapes project: {root_id}"
        )));
    }
    if !has_git_marker(&candidate) {
        return Err(AppError::InvalidInput(format!(
            "VCS root is not initialized: {root_id}"
        )));
    }
    Ok(candidate)
}

fn read_gitlinks(project_path: &Path) -> GitlinkResult {
    let output = Command::new("git")
        .args(["ls-files", "--stage"])
        .current_dir(project_path)
        .output();

    let output = match output {
        Ok(output) => output,
        Err(e) => {
            return GitlinkResult {
                entries: Vec::new(),
                warnings: vec![format!("failed to run git ls-files --stage: {e}")],
            };
        }
    };

    if !output.status.success() {
        return GitlinkResult {
            entries: Vec::new(),
            warnings: vec![format!(
                "git ls-files --stage failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )],
        };
    }

    let entries = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(parse_gitlink_line)
        .collect();
    GitlinkResult {
        entries,
        warnings: Vec::new(),
    }
}

#[derive(Debug)]
struct GitlinkResult {
    entries: Vec<GitlinkEntry>,
    warnings: Vec<String>,
}

fn parse_gitlink_line(line: &str) -> Option<GitlinkEntry> {
    let (meta, path) = line.split_once('\t')?;
    let mut fields = meta.split_whitespace();
    let mode = fields.next()?;
    let object_id = fields.next()?;
    if mode != "160000" {
        return None;
    }
    Some(GitlinkEntry {
        path: path.to_string(),
        object_id: object_id.to_string(),
    })
}

fn read_gitmodules(project_path: &Path) -> GitmodulesMap {
    let gitmodules = project_path.join(".gitmodules");
    if !gitmodules.exists() {
        return GitmodulesMap::default();
    }

    let output = Command::new("git")
        .args([
            "config",
            "-f",
            ".gitmodules",
            "--get-regexp",
            r"^submodule\..*\.(path|url)$",
        ])
        .current_dir(project_path)
        .output();

    let output = match output {
        Ok(output) => output,
        Err(e) => {
            return GitmodulesMap {
                by_path: HashMap::new(),
                warnings: vec![format!("failed to read .gitmodules: {e}")],
            };
        }
    };

    if !output.status.success() {
        return GitmodulesMap {
            by_path: HashMap::new(),
            warnings: vec![format!(
                "invalid .gitmodules ignored: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )],
        };
    }

    let mut by_name = HashMap::<String, GitmoduleEntry>::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Some((key, value)) = line.split_once(' ') else {
            continue;
        };
        if let Some(name) = key.strip_prefix("submodule.") {
            if let Some(name) = name.strip_suffix(".path") {
                by_name.entry(name.to_string()).or_default().path = Some(value.to_string());
            } else if let Some(name) = name.strip_suffix(".url") {
                by_name.entry(name.to_string()).or_default().url = Some(value.to_string());
            }
        }
    }

    let by_path = by_name
        .into_iter()
        .filter_map(|(name, entry)| {
            let path = normalize_root_id(&entry.path?);
            Some((path, (name, entry.url)))
        })
        .collect();

    GitmodulesMap {
        by_path,
        warnings: Vec::new(),
    }
}

fn classify_gitlink(
    project_path: &Path,
    gitlink_path: &str,
    has_mapping: bool,
) -> VcsRootMappingState {
    let path = project_path.join(gitlink_path);
    if !path.exists() {
        VcsRootMappingState::Missing
    } else if !has_git_marker(&path) {
        VcsRootMappingState::Uninitialized
    } else if has_mapping {
        VcsRootMappingState::Mapped
    } else {
        VcsRootMappingState::Unmapped
    }
}

fn scan_nested_repos(project_path: &Path) -> Vec<String> {
    let mut roots = Vec::new();
    scan_dir(project_path, project_path, 0, &mut roots);
    roots.sort();
    roots.dedup();
    roots
}

fn scan_dir(root: &Path, dir: &Path, depth: usize, roots: &mut Vec<String>) {
    if depth >= MAX_NESTED_REPO_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() || should_prune_dir(&entry.file_name()) {
            continue;
        }
        if has_git_marker(&path) {
            roots.push(relative_id(root, &path));
        }
        scan_dir(root, &path, depth + 1, roots);
    }
}

fn should_prune_dir(name: &OsStr) -> bool {
    let name = name.to_string_lossy();
    matches!(
        name.as_ref(),
        ".git" | "node_modules" | "target" | "dist" | "build" | ".dam-hopper" | ".claude"
    ) || name.starts_with('.')
}

fn has_git_marker(path: &Path) -> bool {
    let marker = path.join(".git");
    marker.is_dir() || marker.is_file()
}

fn status_for(path: &Path, root_id: &str) -> Option<crate::git::types::GitStatus> {
    get_status(path, root_id).ok()
}

fn relative_id(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(normalize_path)
        .unwrap_or_else(|_| display_path(path))
}

fn normalize_root_id(path: &str) -> String {
    normalize_path(Path::new(path))
}

fn normalize_path(path: &Path) -> String {
    path.components()
        .filter_map(|c| match c {
            Component::Normal(part) => Some(part.to_string_lossy().to_string()),
            Component::CurDir => None,
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn has_traversal(path: &Path) -> bool {
    path.components().any(|c| {
        matches!(
            c,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    })
}
