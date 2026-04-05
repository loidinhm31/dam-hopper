use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tokio::fs;
use tracing::{debug, warn};

use crate::error::{AppError, Result};
use super::schema::{
    AgentItemCategory, AgentType, BrokenSymlink, DistributionMethod, DistributionStatus,
    HealthCheckResult, OrphanedItem, ShipResult, agent_paths,
};
use super::store::assert_safe_name;

/// Ship an item from the central store to a project for a specific agent.
pub async fn ship(
    store_path: &Path,
    item_name: &str,
    category: AgentItemCategory,
    project_path: &Path,
    agent: AgentType,
    method: DistributionMethod,
) -> ShipResult {
    let make_result = |success: bool, error: Option<String>, target_path: Option<PathBuf>| ShipResult {
        item: item_name.to_string(),
        category,
        project: project_path.to_string_lossy().into_owned(),
        agent,
        method,
        success,
        error,
        target_path,
    };

    if let Err(e) = assert_safe_name(item_name) {
        return make_result(false, Some(e.to_string()), None);
    }

    let agent_p = agent_paths(agent);

    match category {
        AgentItemCategory::McpServer => {
            match ship_mcp_server(store_path, item_name, project_path, agent_p.mcp_config).await {
                Ok(()) => {
                    let target = project_path.join(agent_p.mcp_config);
                    make_result(true, None, Some(target))
                }
                Err(e) => make_result(false, Some(e.to_string()), None),
            }
        }
        AgentItemCategory::MemoryTemplate => {
            make_result(false, Some("memory-template distribution not implemented here — use memory module".to_string()), None)
        }
        _ => {
            let (source_path, target_path) = resolve_ship_paths(store_path, item_name, category, project_path, agent_p);

            if let Some(parent) = target_path.parent() {
                if let Err(e) = fs::create_dir_all(parent).await {
                    return make_result(false, Some(e.to_string()), None);
                }
            }

            match fs::symlink_metadata(&target_path).await {
                Ok(_) => {
                    match check_existing_target(&target_path, &source_path).await {
                        true => return make_result(true, None, Some(target_path)),
                        false => {
                            return make_result(
                                false,
                                Some(format!(
                                    "Target already exists and is not a store symlink: {}",
                                    target_path.display()
                                )),
                                None,
                            );
                        }
                    }
                }
                Err(_) => {} // does not exist — proceed
            }

            match method {
                DistributionMethod::Symlink => {
                    let parent = target_path.parent().unwrap_or(Path::new("/"));
                    let rel_source = match pathdiff::diff_paths(&source_path, parent) {
                        Some(rel) => rel,
                        None => {
                            // diff_paths returns None when paths have no common ancestor (e.g. different Windows drives).
                            // Fall back to absolute path — symlink will resolve but won't be portable.
                            warn!(
                                item = item_name,
                                source = %source_path.display(),
                                target = %target_path.display(),
                                "pathdiff returned None; using absolute symlink source"
                            );
                            source_path.clone()
                        }
                    };
                    match create_symlink(&rel_source, &target_path) {
                        Ok(()) => {
                            debug!(item = item_name, target = %target_path.display(), "shipped (symlink)");
                            make_result(true, None, Some(target_path))
                        }
                        Err(e) => make_result(false, Some(e.to_string()), None),
                    }
                }
                DistributionMethod::Copy => {
                    match copy_recursive(&source_path, &target_path).await {
                        Ok(()) => {
                            debug!(item = item_name, target = %target_path.display(), "shipped (copy)");
                            make_result(true, None, Some(target_path))
                        }
                        Err(e) => make_result(false, Some(e.to_string()), None),
                    }
                }
            }
        }
    }
}

/// Unship: remove a shipped item from a project.
pub async fn unship(
    store_path: &Path,
    item_name: &str,
    category: AgentItemCategory,
    project_path: &Path,
    agent: AgentType,
    force: bool,
) -> ShipResult {
    let make_result = |method: DistributionMethod, success: bool, error: Option<String>| ShipResult {
        item: item_name.to_string(),
        category,
        project: project_path.to_string_lossy().into_owned(),
        agent,
        method,
        success,
        error,
        target_path: None,
    };

    if let Err(e) = assert_safe_name(item_name) {
        return make_result(DistributionMethod::Symlink, false, Some(e.to_string()));
    }

    let agent_p = agent_paths(agent);

    if category == AgentItemCategory::McpServer {
        match unship_mcp_server(store_path, item_name, project_path, agent_p.mcp_config).await {
            Ok(()) => return make_result(DistributionMethod::Symlink, true, None),
            Err(e) => return make_result(DistributionMethod::Symlink, false, Some(e.to_string())),
        }
    }

    if category == AgentItemCategory::MemoryTemplate {
        return make_result(DistributionMethod::Symlink, false, Some("memory-template unship not implemented".to_string()));
    }

    let (source_path, target_path) = resolve_ship_paths(store_path, item_name, category, project_path, agent_p);

    match fs::symlink_metadata(&target_path).await {
        Err(_) => return make_result(DistributionMethod::Symlink, true, None), // already gone
        Ok(meta) => {
            if meta.file_type().is_symlink() {
                match fs::remove_file(&target_path).await {
                    Ok(()) => {
                        debug!(item = item_name, target = %target_path.display(), "unshipped (symlink removed)");
                        make_result(DistributionMethod::Symlink, true, None)
                    }
                    Err(e) => make_result(DistributionMethod::Symlink, false, Some(e.to_string())),
                }
            } else {
                // Copied item: check for modifications
                let is_dir = meta.is_dir();
                let modified = content_differs(&target_path, &source_path, is_dir).await;
                if modified && !force {
                    return make_result(
                        DistributionMethod::Copy,
                        false,
                        Some(format!(
                            "Copied item \"{item_name}\" has been modified. Use force=true to remove anyway."
                        )),
                    );
                }
                // Note: force-remove is not atomic. If removal of a deep file fails (e.g. permissions),
                // the item is left in a partially-removed state. This is logged but not rolled back.
                let remove_result = if is_dir {
                    fs::remove_dir_all(&target_path).await
                } else {
                    fs::remove_file(&target_path).await
                };
                match remove_result {
                    Ok(()) => {
                        debug!(item = item_name, target = %target_path.display(), modified, "unshipped (copy removed)");
                        make_result(DistributionMethod::Copy, true, None)
                    }
                    Err(e) => {
                        warn!(item = item_name, target = %target_path.display(), "unship copy-remove failed: {e}");
                        make_result(DistributionMethod::Copy, false, Some(e.to_string()))
                    }
                }
            }
        }
    }
}

/// Absorb: move an item from a project into the central store, then create a symlink.
/// Safety: copy to store → remove original → ship (symlink).
pub async fn absorb(
    store_path: &Path,
    item_name: &str,
    category: AgentItemCategory,
    project_path: &Path,
    agent: AgentType,
) -> ShipResult {
    let make_err = |error: String| ShipResult {
        item: item_name.to_string(),
        category,
        project: project_path.to_string_lossy().into_owned(),
        agent,
        method: DistributionMethod::Symlink,
        success: false,
        error: Some(error),
        target_path: None,
    };

    if let Err(e) = assert_safe_name(item_name) {
        return make_err(e.to_string());
    }

    let agent_p = agent_paths(agent);
    let (store_target, project_item) = resolve_ship_paths(store_path, item_name, category, project_path, agent_p);

    match fs::symlink_metadata(&project_item).await {
        Err(_) => return make_err(format!("Item not found at: {}", project_item.display())),
        Ok(meta) if meta.file_type().is_symlink() => {
            return make_err(format!("Item is already a symlink: {}", project_item.display()));
        }
        Ok(_) => {}
    }

    if store_target.exists() {
        return make_err(format!("Item already exists in store: {}", store_target.display()));
    }

    if let Some(parent) = store_target.parent() {
        if let Err(e) = fs::create_dir_all(parent).await {
            return make_err(e.to_string());
        }
    }

    if let Err(e) = copy_recursive(&project_item, &store_target).await {
        // Clean up any partial copy before returning the error
        let _ = fs::remove_dir_all(&store_target).await;
        let _ = fs::remove_file(&store_target).await;
        return make_err(format!("Failed to copy item to store: {e}"));
    }

    let remove_result = if project_item.is_dir() {
        fs::remove_dir_all(&project_item).await
    } else {
        fs::remove_file(&project_item).await
    };
    if let Err(e) = remove_result {
        // Item is already safely copied to store; caller can re-ship manually.
        warn!(
            item = item_name,
            store_target = %store_target.display(),
            "absorb: copied to store but failed to remove original; item now exists in both locations: {e}"
        );
        return make_err(format!("Copied to store but failed to remove original: {e}"));
    }
    debug!(item = item_name, store_target = %store_target.display(), "absorbed into store");

    ship(store_path, item_name, category, project_path, agent, DistributionMethod::Symlink).await
}

/// Bulk ship: ship multiple items to multiple projects.
pub async fn bulk_ship(
    store_path: &Path,
    items: &[(&str, AgentItemCategory)],
    projects: &[(&Path, AgentType)],
    method: DistributionMethod,
) -> Vec<ShipResult> {
    let mut results = Vec::new();
    for (proj_path, agent) in projects {
        for (item_name, category) in items {
            let r = ship(store_path, item_name, *category, proj_path, *agent, method).await;
            results.push(r);
        }
    }
    results
}

/// Build distribution matrix: item_key → projKey(`<name>:<agent>`) → DistributionStatus.
pub async fn get_distribution_matrix(
    store_path: &Path,
    store_items: &[(&str, AgentItemCategory)],
    projects: &[(&str, &Path)],
    agents: &[AgentType],
) -> HashMap<String, HashMap<String, DistributionStatus>> {
    let mut matrix: HashMap<String, HashMap<String, DistributionStatus>> = HashMap::new();

    for (item_name, category) in store_items {
        // MCP server and memory-template aren't file-based in the same way
        if matches!(category, AgentItemCategory::McpServer | AgentItemCategory::MemoryTemplate) {
            continue;
        }

        let item_key = format!("{}:{}", category, item_name);
        let mut project_map: HashMap<String, DistributionStatus> = HashMap::new();

        for (proj_name, proj_path) in projects {
            for agent in agents {
                let proj_key = format!("{proj_name}:{agent}");
                let agent_p = agent_paths(*agent);
                let (_, target_path) = resolve_ship_paths(store_path, item_name, *category, proj_path, agent_p);

                let status = match fs::symlink_metadata(&target_path).await {
                    Err(_) => DistributionStatus { shipped: false, method: None },
                    Ok(meta) => {
                        let method = if meta.file_type().is_symlink() {
                            DistributionMethod::Symlink
                        } else {
                            DistributionMethod::Copy
                        };
                        DistributionStatus { shipped: true, method: Some(method) }
                    }
                };

                project_map.insert(proj_key, status);
            }
        }

        matrix.insert(item_key, project_map);
    }

    matrix
}

/// Health check: find broken symlinks and orphaned items in agent dirs across all projects.
///
/// TOCTOU note: The check between `read_link()` and `exists()` is inherently racy.
/// This is acceptable since health_check is a read-only monitoring operation, not a
/// write operation. False negatives (missed issues) are possible under concurrent writes
/// but false positives (reporting healthy symlinks as broken) are not.
pub async fn health_check(
    store_path: &Path,
    projects: &[(&str, &Path)],
    agents: &[AgentType],
) -> HealthCheckResult {
    let mut result = HealthCheckResult {
        broken_symlinks: vec![],
        orphaned_items: vec![],
    };

    for (proj_name, proj_path) in projects {
        for agent in agents {
            let agent_p = agent_paths(*agent);
            let dirs_to_check = [
                proj_path.join(agent_p.skills),
                proj_path.join(agent_p.commands),
                proj_path.join(agent_p.hooks),
            ];

            for dir in &dirs_to_check {
                let Ok(mut rd) = fs::read_dir(dir).await else {
                    continue;
                };

                while let Ok(Some(entry)) = rd.next_entry().await {
                    let entry_path = entry.path();
                    let Ok(meta) = fs::symlink_metadata(&entry_path).await else {
                        continue;
                    };

                    if meta.file_type().is_symlink() {
                        let Ok(target) = fs::read_link(&entry_path).await else {
                            continue;
                        };

                        let resolved = if target.is_absolute() {
                            target.clone()
                        } else {
                            entry_path.parent().unwrap_or(Path::new("/")).join(&target)
                        };

                        if !resolved.exists() {
                            result.broken_symlinks.push(BrokenSymlink {
                                project: proj_name.to_string(),
                                path: entry_path,
                                target: resolved,
                            });
                        } else if !is_within_root(&resolved, store_path) {
                            result.orphaned_items.push(OrphanedItem {
                                project: proj_name.to_string(),
                                path: entry_path,
                                reason: "symlink points outside agent store".to_string(),
                            });
                        }
                    }
                }
            }
        }
    }

    result
}

// ── Internal helpers ──────────────────────────────────────────────────────────

use super::schema::AgentPathConfig;

fn resolve_ship_paths(
    store_path: &Path,
    item_name: &str,
    category: AgentItemCategory,
    project_path: &Path,
    agent_paths: &AgentPathConfig,
) -> (PathBuf, PathBuf) {
    let store_dir = store_path.join(category.store_dir());

    match category {
        AgentItemCategory::Command => {
            let file_name = if item_name.ends_with(".md") {
                item_name.to_string()
            } else {
                format!("{item_name}.md")
            };
            (
                store_dir.join(&file_name),
                project_path.join(agent_paths.commands).join(&file_name),
            )
        }
        AgentItemCategory::Subagent => (
            store_dir.join(item_name),
            project_path.join(agent_paths.root).join(item_name),
        ),
        AgentItemCategory::Skill => (
            store_dir.join(item_name),
            project_path.join(agent_paths.skills).join(item_name),
        ),
        AgentItemCategory::Hook => (
            store_dir.join(item_name),
            project_path.join(agent_paths.hooks).join(item_name),
        ),
        _ => unreachable!("resolve_ship_paths called for unhandled category: {category}"),
    }
}

/// Returns true if target_path is a symlink that points to expected_source.
/// Uses canonicalize only when both paths exist; falls back to lexical comparison
/// to avoid treating a broken symlink as an unknown item.
async fn check_existing_target(target_path: &Path, expected_source: &Path) -> bool {
    let Ok(link_target) = fs::read_link(target_path).await else {
        return false; // not a symlink
    };
    let resolved = if link_target.is_absolute() {
        link_target
    } else {
        target_path
            .parent()
            .unwrap_or(Path::new("/"))
            .join(link_target)
    };
    // Prefer canonical comparison when both sides exist (handles symlink chains).
    // Fall back to lexical comparison to avoid returning false on broken store paths.
    let resolved_canon = std::fs::canonicalize(&resolved).ok();
    let expected_canon = std::fs::canonicalize(expected_source).ok();
    match (resolved_canon, expected_canon) {
        (Some(rc), Some(ec)) => rc == ec,
        _ => resolved == expected_source,
    }
}

/// True if target content differs from store source.
/// For directories: shallow diff — compares top-level files only; nested subdirectory
/// changes are not detected. This is intentional for performance.
async fn content_differs(target: &Path, source: &Path, is_dir: bool) -> bool {
    if !is_dir {
        if !source.exists() {
            return false;
        }
        match (fs::read(target).await, fs::read(source).await) {
            (Ok(tb), Ok(sb)) => tb != sb,
            _ => false,
        }
    } else {
        let Ok(mut rd) = fs::read_dir(target).await else {
            return false;
        };
        while let Ok(Some(entry)) = rd.next_entry().await {
            if !entry.path().is_file() {
                continue;
            }
            let src_file = source.join(entry.file_name());
            if !src_file.exists() {
                return true;
            }
            match (fs::read(&entry.path()).await, fs::read(&src_file).await) {
                (Ok(tb), Ok(sb)) if tb != sb => return true,
                _ => {}
            }
        }
        false
    }
}

fn is_within_root(candidate: &Path, root: &Path) -> bool {
    candidate == root || candidate.starts_with(root)
}

async fn ship_mcp_server(
    store_path: &Path,
    server_name: &str,
    project_path: &Path,
    mcp_config_rel: &str,
) -> Result<()> {
    let fragment_path = store_path.join("mcp-servers").join(format!("{server_name}.json"));
    let fragment_content = fs::read_to_string(&fragment_path).await
        .map_err(|_| AppError::Internal(format!("MCP server fragment not found: {}", fragment_path.display())))?;
    let fragment: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&fragment_content)
        .map_err(|e| AppError::Internal(format!("Invalid MCP server JSON: {e}")))?;

    // Validate: fragment must be a non-empty map with string keys (server name → config).
    // Each value must be an object (the server config), not a primitive.
    if fragment.is_empty() {
        return Err(AppError::Internal(format!("MCP server fragment \"{server_name}\" is empty")));
    }
    for (key, val) in &fragment {
        if !val.is_object() {
            return Err(AppError::Internal(format!(
                "MCP server fragment \"{server_name}\": entry \"{key}\" must be an object, got {}", val
            )));
        }
    }

    let mcp_config_path = project_path.join(mcp_config_rel);
    if let Some(parent) = mcp_config_path.parent() {
        fs::create_dir_all(parent).await?;
    }

    let mut existing: serde_json::Value = if mcp_config_path.exists() {
        let raw = fs::read_to_string(&mcp_config_path).await?;
        serde_json::from_str(&raw).unwrap_or(serde_json::json!({"mcpServers": {}}))
    } else {
        serde_json::json!({"mcpServers": {}})
    };

    let servers = existing["mcpServers"].as_object_mut()
        .ok_or_else(|| AppError::Internal("mcpServers is not an object".to_string()))?;
    servers.extend(fragment);

    fs::write(&mcp_config_path, serde_json::to_string_pretty(&existing)?).await?;
    Ok(())
}

async fn unship_mcp_server(
    store_path: &Path,
    server_name: &str,
    project_path: &Path,
    mcp_config_rel: &str,
) -> Result<()> {
    let mcp_config_path = project_path.join(mcp_config_rel);
    if !mcp_config_path.exists() {
        return Ok(());
    }

    let raw = fs::read_to_string(&mcp_config_path).await?;
    let mut config: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();

    let fragment_path = store_path.join("mcp-servers").join(format!("{server_name}.json"));
    if let Some(servers) = config["mcpServers"].as_object_mut() {
        if fragment_path.exists() {
            let fragment_content = fs::read_to_string(&fragment_path).await?;
            if let Ok(fragment) = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&fragment_content) {
                for key in fragment.keys() {
                    servers.remove(key);
                }
            }
        } else {
            servers.remove(server_name);
        }
    }

    fs::write(&mcp_config_path, serde_json::to_string_pretty(&config)?).await?;
    Ok(())
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

#[cfg(unix)]
fn create_symlink(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(src, dst)
}

#[cfg(windows)]
fn create_symlink(src: &Path, dst: &Path) -> std::io::Result<()> {
    if src.is_dir() {
        std::os::windows::fs::symlink_dir(src, dst)
    } else {
        std::os::windows::fs::symlink_file(src, dst)
    }
}

#[cfg(not(any(unix, windows)))]
fn create_symlink(_src: &Path, _dst: &Path) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "symlinks not supported on this platform",
    ))
}
