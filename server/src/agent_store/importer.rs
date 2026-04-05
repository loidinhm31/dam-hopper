use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::fs;
use tokio::process::Command;

use crate::error::{AppError, Result};
use super::schema::AgentItemCategory;
use super::store::parse_frontmatter;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RepoScanItem {
    pub name: String,
    pub category: AgentItemCategory,
    pub description: Option<String>,
    /// Relative path from the scanned root to this item.
    pub relative_path: String,
}

#[derive(Debug)]
pub struct RepoScanResult {
    pub repo_url: String,
    pub tmp_dir: PathBuf,
    pub items: Vec<RepoScanItem>,
}

#[derive(Debug)]
pub struct LocalScanResult {
    pub dir_path: PathBuf,
    pub items: Vec<RepoScanItem>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ImportResult {
    pub name: String,
    pub success: bool,
    pub error: Option<String>,
}

/// Clone a repo (shallow, depth=1) to a temp dir and scan for importable items.
/// Caller must call `cleanup_import(&result.tmp_dir)` when done.
pub async fn scan_repo(repo_url: &str) -> Result<RepoScanResult> {
    validate_repo_url(repo_url)?;

    let tmp_dir = {
        let base = std::env::temp_dir().join("devhub-import");
        fs::create_dir_all(&base).await?;
        let id = uuid::Uuid::new_v4().to_string();
        base.join(id)
    };
    fs::create_dir_all(&tmp_dir).await?;

    git_clone(repo_url, &tmp_dir).await?;

    let items = scan_dir(&tmp_dir).await;
    Ok(RepoScanResult {
        repo_url: repo_url.to_string(),
        tmp_dir,
        items,
    })
}

/// Scan a local directory for importable items. No cleanup needed.
pub async fn scan_local_dir(dir_path: &Path) -> Result<LocalScanResult> {
    let resolved = dir_path.canonicalize()
        .map_err(|_| AppError::NotFound(format!("Path does not exist: {}", dir_path.display())))?;

    let meta = fs::symlink_metadata(&resolved).await
        .map_err(|_| AppError::NotFound(format!("Path does not exist: {}", resolved.display())))?;
    if !meta.is_dir() {
        return Err(AppError::Internal(format!("Not a directory: {}", resolved.display())));
    }

    let items = scan_dir(&resolved).await;
    Ok(LocalScanResult { dir_path: resolved, items })
}

/// Copy selected items from source_dir into the central store.
/// Does NOT overwrite existing items — returns error for conflicts.
pub async fn import_from_repo(
    source_dir: &Path,
    selected_items: &[RepoScanItem],
    store_path: &Path,
) -> Result<Vec<ImportResult>> {
    let source_dir = source_dir.canonicalize().unwrap_or(source_dir.to_path_buf());
    let mut results = Vec::new();

    for item in selected_items {
        // Belt-and-suspenders: reject any relative_path component that is ".." before
        // canonicalize — this catches literal ".." components that canonicalize would resolve.
        if item.relative_path.split(['/', '\\']).any(|c| c == "..") {
            results.push(ImportResult {
                name: item.name.clone(),
                success: false,
                error: Some("Invalid path: \"..\" component detected".to_string()),
            });
            continue;
        }

        // Guard against symlink-based traversal via canonicalize + starts_with
        let src = source_dir.join(&item.relative_path);
        let src_canonical = match src.canonicalize() {
            Ok(p) => p,
            Err(_) => {
                results.push(ImportResult {
                    name: item.name.clone(),
                    success: false,
                    error: Some(format!("Source path not found: {}", item.relative_path)),
                });
                continue;
            }
        };

        if !src_canonical.starts_with(&source_dir) {
            results.push(ImportResult {
                name: item.name.clone(),
                success: false,
                error: Some("Invalid path: traversal detected".to_string()),
            });
            continue;
        }

        let target_name = match item.category {
            AgentItemCategory::Command | AgentItemCategory::Subagent => {
                if item.name.ends_with(".md") {
                    item.name.clone()
                } else {
                    format!("{}.md", item.name)
                }
            }
            _ => item.name.clone(),
        };

        let target = store_path.join(item.category.store_dir()).join(&target_name);
        if target.exists() {
            results.push(ImportResult {
                name: item.name.clone(),
                success: false,
                error: Some("Already exists in store".to_string()),
            });
            continue;
        }

        if let Some(parent) = target.parent() {
            let _ = fs::create_dir_all(parent).await;
        }

        match copy_recursive(&src_canonical, &target).await {
            Ok(()) => results.push(ImportResult { name: item.name.clone(), success: true, error: None }),
            Err(e) => results.push(ImportResult { name: item.name.clone(), success: false, error: Some(e.to_string()) }),
        }
    }

    Ok(results)
}

/// Remove the temp directory created by `scan_repo`.
pub async fn cleanup_import(tmp_dir: &Path) -> Result<()> {
    let _ = fs::remove_dir_all(tmp_dir).await;
    Ok(())
}

// ── Internals ─────────────────────────────────────────────────────────────────

fn validate_repo_url(url: &str) -> Result<()> {
    // Only allow recognized git URL schemes to prevent command injection
    let valid = url.starts_with("https://")
        || url.starts_with("http://")
        || url.starts_with("ssh://")
        || url.starts_with("git://")
        || url.starts_with("git@");
    if !valid {
        return Err(AppError::Internal(format!("Unsupported repo URL format: \"{url}\"")));
    }
    // Reject shell metacharacters
    for ch in [';', '&', '|', '`', '$', '(', ')', '<', '>'] {
        if url.contains(ch) {
            return Err(AppError::Internal(format!("Invalid character in repo URL: '{ch}'")));
        }
    }
    Ok(())
}

const GIT_CLONE_TIMEOUT: Duration = Duration::from_secs(60);

async fn git_clone(repo_url: &str, target_dir: &Path) -> Result<()> {
    let clone_fut = Command::new("git")
        .args(["clone", "--depth", "1", repo_url, &target_dir.to_string_lossy()])
        .output();

    let output = tokio::time::timeout(GIT_CLONE_TIMEOUT, clone_fut)
        .await
        .map_err(|_| AppError::Internal(format!("git clone timed out after {}s: {repo_url}", GIT_CLONE_TIMEOUT.as_secs())))?
        .map_err(|e| AppError::Internal(format!("git clone failed to spawn: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Internal(format!(
            "git clone failed (exit {}): {}",
            output.status.code().unwrap_or(-1),
            &stderr[..stderr.len().min(400)]
        )));
    }
    Ok(())
}

async fn scan_dir(root: &Path) -> Vec<RepoScanItem> {
    let mut items = Vec::new();

    find_skills(root, root, &mut items).await;
    find_commands(root, root, &mut items).await;
    find_hooks(root, root, &mut items).await;
    find_subagents(root, root, &mut items).await;

    items
}

fn relative_to(path: &Path, base: &Path) -> String {
    pathdiff::diff_paths(path, base)
        .unwrap_or_else(|| path.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

async fn find_skills(dir: &Path, root: &Path, out: &mut Vec<RepoScanItem>) {
    let Ok(mut rd) = fs::read_dir(dir).await else {
        return;
    };
    while let Ok(Some(entry)) = rd.next_entry().await {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();

        if name.starts_with('.') && name != ".claude" && name != ".gemini" {
            continue;
        }

        if path.is_dir() {
            let skill_md = path.join("SKILL.md");
            if skill_md.exists() {
                let (data, description) = if let Ok(content) = fs::read_to_string(&skill_md).await {
                    let (fm, _) = parse_frontmatter(&content);
                    let desc = fm.get("description").and_then(|v| v.as_str()).map(String::from);
                    let name_from_fm = fm.get("name").and_then(|v| v.as_str()).map(String::from);
                    (name_from_fm, desc)
                } else {
                    (None, None)
                };
                out.push(RepoScanItem {
                    name: data.unwrap_or(name),
                    category: AgentItemCategory::Skill,
                    description,
                    relative_path: relative_to(&path, root),
                });
            } else {
                // Recurse
                Box::pin(find_skills(&path, root, out)).await;
            }
        }
    }
}

async fn find_commands(dir: &Path, root: &Path, out: &mut Vec<RepoScanItem>) {
    let Ok(mut rd) = fs::read_dir(dir).await else {
        return;
    };
    while let Ok(Some(entry)) = rd.next_entry().await {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();

        if name.starts_with('.') && name != ".claude" && name != ".gemini" {
            continue;
        }

        if path.is_dir() {
            Box::pin(find_commands(&path, root, out)).await;
        } else if path.is_file() && name.ends_with(".md") {
            if name == "SKILL.md" || name == "README.md" {
                continue;
            }
            // Skip subagent files
            let rel = relative_to(&path, root);
            if rel.contains("/.claude/agents/") || rel.contains("/.gemini/agents/") {
                continue;
            }

            if let Ok(content) = fs::read_to_string(&path).await {
                let (fm, _) = parse_frontmatter(&content);
                if fm.get("description").is_none() {
                    continue;
                }
                let description = fm.get("description").and_then(|v| v.as_str()).map(String::from);
                out.push(RepoScanItem {
                    name: name[..name.len() - 3].to_string(),
                    category: AgentItemCategory::Command,
                    description,
                    relative_path: rel,
                });
            }
        }
    }
}

async fn find_hooks(root: &Path, scan_root: &Path, out: &mut Vec<RepoScanItem>) {
    for agent_dir in [".claude", ".gemini"] {
        let hooks_dir = root.join(agent_dir).join("hooks");
        let Ok(mut rd) = fs::read_dir(&hooks_dir).await else {
            continue;
        };
        while let Ok(Some(entry)) = rd.next_entry().await {
            if entry.path().is_file() {
                out.push(RepoScanItem {
                    name: entry.file_name().to_string_lossy().into_owned(),
                    category: AgentItemCategory::Hook,
                    description: None,
                    relative_path: relative_to(&entry.path(), scan_root),
                });
            }
        }
    }
}

async fn find_subagents(root: &Path, scan_root: &Path, out: &mut Vec<RepoScanItem>) {
    for agent_dir in [".claude", ".gemini"] {
        let agents_dir = root.join(agent_dir).join("agents");
        let Ok(mut rd) = fs::read_dir(&agents_dir).await else {
            continue;
        };
        while let Ok(Some(entry)) = rd.next_entry().await {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !entry.path().is_file() || !name.ends_with(".md") {
                continue;
            }
            let description = fs::read_to_string(entry.path()).await.ok().and_then(|c| {
                let (fm, _) = parse_frontmatter(&c);
                let desc = fm.get("description").and_then(|v| v.as_str()).map(String::from);
                desc
            });
            let item_name = {
                if let Ok(content) = fs::read_to_string(entry.path()).await {
                    let (fm, _) = parse_frontmatter(&content);
                    fm.get("name").and_then(|v| v.as_str()).map(String::from)
                } else {
                    None
                }
            }.unwrap_or_else(|| name[..name.len() - 3].to_string());

            out.push(RepoScanItem {
                name: item_name,
                category: AgentItemCategory::Subagent,
                description,
                relative_path: relative_to(&entry.path(), scan_root),
            });
        }
    }
}

async fn copy_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    let meta = fs::symlink_metadata(src).await?;
    if meta.is_dir() {
        fs::create_dir_all(dst).await?;
        let mut rd = fs::read_dir(src).await?;
        while let Ok(Some(entry)) = rd.next_entry().await {
            let child_dst = dst.join(entry.file_name());
            Box::pin(copy_recursive(&entry.path(), &child_dst)).await?;
        }
    } else {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::copy(src, dst).await?;
    }
    Ok(())
}
