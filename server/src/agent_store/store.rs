use std::path::{Path, PathBuf};
use tokio::fs;

use crate::error::{AppError, Result};
use super::schema::{AgentItemCategory, AgentStoreItem, AgentType};

/// Parse YAML frontmatter from markdown content.
/// Returns (data_map, body_after_frontmatter).
pub fn parse_frontmatter(content: &str) -> (serde_json::Value, &str) {
    let normalized = content.trim_start_matches('\u{feff}'); // strip BOM
    if !normalized.starts_with("---\n") {
        return (serde_json::Value::Object(Default::default()), normalized);
    }
    if let Some(end) = normalized[4..].find("\n---") {
        let yaml_str = &normalized[4..4 + end];
        let body = &normalized[4 + end + 4..];
        let body = body.trim_start_matches('\n');
        match serde_yaml_ng::from_str::<serde_json::Value>(yaml_str) {
            Ok(v) => (v, body),
            Err(_) => (serde_json::Value::Object(Default::default()), body),
        }
    } else {
        (serde_json::Value::Object(Default::default()), normalized)
    }
}

pub struct AgentStoreService {
    store_path: PathBuf,
}

impl AgentStoreService {
    pub fn new(store_path: PathBuf) -> Self {
        Self { store_path }
    }

    pub fn store_path(&self) -> &Path {
        &self.store_path
    }

    /// Ensure the store directory structure exists.
    pub async fn init(&self) -> Result<()> {
        for cat in AgentItemCategory::all() {
            fs::create_dir_all(self.store_path.join(cat.store_dir())).await?;
        }
        Ok(())
    }

    /// List all items in the central store, optionally filtered by category.
    pub async fn list(&self, category: Option<AgentItemCategory>) -> Result<Vec<AgentStoreItem>> {
        let categories: Vec<AgentItemCategory> = match category {
            Some(c) => vec![c],
            None => AgentItemCategory::all().to_vec(),
        };

        let mut items = Vec::new();
        for cat in categories {
            let dir = self.store_path.join(cat.store_dir());
            items.extend(self.list_category(&dir, cat).await?);
        }
        Ok(items)
    }

    /// Add an item to the store (copy from source path).
    pub async fn add(
        &self,
        source_path: &Path,
        category: AgentItemCategory,
        name: Option<&str>,
    ) -> Result<AgentStoreItem> {
        let item_name = match name {
            Some(n) => n.to_string(),
            None => source_path
                .file_stem()
                .and_then(|s| s.to_str())
                .ok_or_else(|| AppError::InvalidInput(format!(
                    "Cannot derive item name from path: {}",
                    source_path.display()
                )))?
                .to_string(),
        };
        assert_safe_name(&item_name)?;

        let dest_path = if category == AgentItemCategory::Command {
            let fname = if item_name.ends_with(".md") {
                item_name.clone()
            } else {
                format!("{item_name}.md")
            };
            self.store_path.join(category.store_dir()).join(fname)
        } else {
            self.store_path.join(category.store_dir()).join(&item_name)
        };

        copy_recursive(source_path, &dest_path).await?;

        self.get(&item_name, category).await?.ok_or_else(|| {
            AppError::Internal(format!("Failed to read item after adding: {item_name}"))
        })
    }

    /// Remove an item from the store.
    /// Returns an error if the item does not exist in the given category.
    pub async fn remove(&self, name: &str, category: AgentItemCategory) -> Result<()> {
        assert_safe_name(name)?;

        // Verify the item actually exists in this category before deleting anything
        self.get(name, category).await?
            .ok_or_else(|| AppError::NotFound(format!("Item \"{name}\" not found in category {category}")))?;

        let base = self.store_path.join(category.store_dir()).join(name);
        if category == AgentItemCategory::Command {
            let md_path = self.store_path.join(category.store_dir()).join(format!("{name}.md"));
            let _ = fs::remove_file(&md_path).await;
        }
        let _ = fs::remove_dir_all(&base).await;
        let _ = fs::remove_file(&base).await;
        Ok(())
    }

    /// Get metadata for a single item.
    pub async fn get(&self, name: &str, category: AgentItemCategory) -> Result<Option<AgentStoreItem>> {
        assert_safe_name(name)?;
        let item_path = self.store_path.join(category.store_dir()).join(name);

        let result = match category {
            AgentItemCategory::Skill => {
                let skill_md = item_path.join("SKILL.md");
                match fs::read_to_string(&skill_md).await {
                    Err(_) => return Ok(None),
                    Ok(content) => {
                        let (data, _) = parse_frontmatter(&content);
                        let description = data.get("description").and_then(|v| v.as_str()).map(String::from);
                        let size_bytes = dir_size(&item_path).await;
                        let rel = format!("{}/{}", category.store_dir(), name);
                        AgentStoreItem {
                            name: name.to_string(),
                            category,
                            relative_path: rel,
                            description,
                            compatible_agents: vec![AgentType::Claude, AgentType::Gemini],
                            size_bytes: Some(size_bytes),
                        }
                    }
                }
            }
            AgentItemCategory::Command => {
                let file_path = if item_path.with_extension("md").exists() {
                    item_path.with_extension("md")
                } else {
                    item_path.clone()
                };
                match fs::read_to_string(&file_path).await {
                    Err(_) => return Ok(None),
                    Ok(content) => {
                        let (data, _) = parse_frontmatter(&content);
                        let description = data.get("description").and_then(|v| v.as_str()).map(String::from);
                        let size_bytes = fs::metadata(&file_path).await.ok().map(|m| m.len());
                        let rel = format!("{}/{}.md", category.store_dir(), name);
                        AgentStoreItem {
                            name: name.to_string(),
                            category,
                            relative_path: rel,
                            description,
                            compatible_agents: vec![AgentType::Claude, AgentType::Gemini],
                            size_bytes,
                        }
                    }
                }
            }
            AgentItemCategory::Subagent => {
                // Subagents may be bare or .md
                let resolved = if item_path.exists() {
                    item_path.clone()
                } else {
                    item_path.with_extension("md")
                };
                match fs::symlink_metadata(&resolved).await {
                    Err(_) => return Ok(None),
                    Ok(meta) => {
                        let size_bytes = if meta.is_dir() {
                            dir_size(&resolved).await
                        } else {
                            meta.len()
                        };
                        let description = if resolved.extension().and_then(|s| s.to_str()) == Some("md") {
                            fs::read_to_string(&resolved).await.ok().and_then(|c| {
                                let (data, _) = parse_frontmatter(&c);
                                data.get("description").and_then(|v| v.as_str()).map(String::from)
                            })
                        } else {
                            None
                        };
                        let rel_path = resolved.strip_prefix(&self.store_path)
                            .map(|p| p.to_string_lossy().into_owned())
                            .unwrap_or_else(|_| format!("{}/{}", category.store_dir(), name));
                        AgentStoreItem {
                            name: name.to_string(),
                            category,
                            relative_path: rel_path,
                            description,
                            compatible_agents: vec![AgentType::Claude, AgentType::Gemini],
                            size_bytes: Some(size_bytes),
                        }
                    }
                }
            }
            _ => {
                match fs::symlink_metadata(&item_path).await {
                    Err(_) => return Ok(None),
                    Ok(meta) => {
                        let size_bytes = if meta.is_dir() {
                            dir_size(&item_path).await
                        } else {
                            meta.len()
                        };
                        let rel = format!("{}/{}", category.store_dir(), name);
                        AgentStoreItem {
                            name: name.to_string(),
                            category,
                            relative_path: rel,
                            description: None,
                            compatible_agents: vec![AgentType::Claude, AgentType::Gemini],
                            size_bytes: Some(size_bytes),
                        }
                    }
                }
            }
        };

        Ok(Some(result))
    }

    /// Get the main file content for an item.
    pub async fn get_content(
        &self,
        name: &str,
        category: AgentItemCategory,
        file_name: Option<&str>,
    ) -> Result<String> {
        assert_safe_name(name)?;
        let item_path = self.store_path.join(category.store_dir()).join(name);

        if let Some(fname) = file_name {
            assert_safe_file_name(fname)?;
            return Ok(fs::read_to_string(item_path.join(fname)).await?);
        }

        match category {
            AgentItemCategory::Skill => Ok(fs::read_to_string(item_path.join("SKILL.md")).await?),
            AgentItemCategory::Command | AgentItemCategory::Subagent => {
                let md = item_path.with_extension("md");
                if md.exists() {
                    Ok(fs::read_to_string(md).await?)
                } else {
                    Ok(fs::read_to_string(&item_path).await?)
                }
            }
            _ => Ok(fs::read_to_string(&item_path).await?),
        }
    }

    async fn list_category(
        &self,
        dir: &Path,
        category: AgentItemCategory,
    ) -> Result<Vec<AgentStoreItem>> {
        let mut rd = match fs::read_dir(dir).await {
            Ok(rd) => rd,
            Err(_) => return Ok(vec![]),
        };

        let mut items = Vec::new();

        while let Ok(Some(entry)) = rd.next_entry().await {
            let ft = match entry.file_type().await {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            let entry_name = entry.file_name().to_string_lossy().into_owned();

            let name = match category {
                AgentItemCategory::Skill => {
                    if !ft.is_dir() {
                        continue;
                    }
                    entry_name
                }
                AgentItemCategory::Command => {
                    if !ft.is_file() || !entry_name.ends_with(".md") {
                        continue;
                    }
                    entry_name[..entry_name.len() - 3].to_string()
                }
                _ => {
                    // For hooks, mcp-server, subagent, memory-template:
                    // .md files take priority over same-named directories to avoid ambiguity
                    // on case-insensitive filesystems. Dedup by bare name (strip .md).
                    if ft.is_file() && entry_name.ends_with(".md") {
                        entry_name[..entry_name.len() - 3].to_string()
                    } else if ft.is_file() || ft.is_dir() {
                        entry_name
                    } else {
                        continue; // skip symlinks and other special files at store level
                    }
                }
            };

            if items.iter().any(|i: &AgentStoreItem| i.name == name) {
                continue;
            }

            if let Ok(Some(item)) = self.get(&name, category).await {
                items.push(item);
            }
        }

        Ok(items)
    }
}

pub fn assert_safe_name(name: &str) -> Result<()> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name == ".."
        || name == "."
    {
        return Err(AppError::Internal(format!("Invalid item name: \"{name}\"")));
    }
    Ok(())
}

pub fn assert_safe_file_name(name: &str) -> Result<()> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name == ".."
        || name == "."
    {
        return Err(AppError::Internal(format!("Invalid file name: \"{name}\"")));
    }
    Ok(())
}

/// Recursively compute directory size in bytes.
pub async fn dir_size(path: &Path) -> u64 {
    let Ok(mut rd) = fs::read_dir(path).await else {
        return 0;
    };
    let mut total = 0u64;
    while let Ok(Some(entry)) = rd.next_entry().await {
        if let Ok(meta) = entry.metadata().await {
            if meta.is_dir() {
                total += Box::pin(dir_size(&entry.path())).await;
            } else {
                total += meta.len();
            }
        }
    }
    total
}

async fn copy_recursive(src: &Path, dst: &Path) -> Result<()> {
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
