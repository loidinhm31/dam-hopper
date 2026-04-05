use std::path::Path;
use handlebars::{Handlebars, handlebars_helper};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::fs;

use crate::error::{AppError, Result};
use super::schema::{AgentType, agent_paths};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateContext {
    pub project: ProjectContext,
    pub workspace: WorkspaceContext,
    pub agent: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectContext {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub project_type: String,
    pub tags: Option<Vec<String>>,
    /// Convenience: tags joined as comma-separated string.
    pub tags_joined: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceContext {
    pub name: String,
    pub root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryTemplateInfo {
    pub name: String,
    pub content: String,
}

handlebars_helper!(eq_helper: |a: Value, b: Value| a == b);

/// Render a Handlebars memory template with project/workspace variables.
pub fn render_template(template: &str, ctx: &TemplateContext) -> Result<String> {
    let mut reg = Handlebars::new();
    reg.register_helper("eq", Box::new(eq_helper));
    reg.set_strict_mode(false);

    // Augment context with tags_joined if not already set
    let mut value = serde_json::to_value(ctx)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    if let Some(tags) = ctx.project.tags.as_ref() {
        let joined = tags.join(", ");
        if let Some(proj) = value.get_mut("project") {
            if let Some(obj) = proj.as_object_mut() {
                obj.insert("tagsJoined".to_string(), serde_json::Value::String(joined));
                obj.insert("tags_joined".to_string(), serde_json::Value::String(ctx.project.tags_joined.clone()));
            }
        }
    }

    reg.render_template(template, &value)
        .map_err(|e| AppError::Internal(format!("Template render error: {e}")))
}

/// List all memory templates in the store (.md files in memory-templates/).
pub async fn list_memory_templates(store_path: &Path) -> Result<Vec<MemoryTemplateInfo>> {
    let dir = store_path.join("memory-templates");
    let mut rd = match fs::read_dir(&dir).await {
        Ok(rd) => rd,
        Err(_) => return Ok(vec![]),
    };

    let mut results = Vec::new();
    while let Ok(Some(entry)) = rd.next_entry().await {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.ends_with(".md") {
            continue;
        }
        let Ok(ft) = entry.file_type().await else {
            continue;
        };
        if !ft.is_file() {
            continue;
        }
        if let Ok(content) = fs::read_to_string(entry.path()).await {
            results.push(MemoryTemplateInfo {
                name: name[..name.len() - 3].to_string(),
                content,
            });
        }
    }
    Ok(results)
}

/// Get the current memory file content for a project + agent.
pub async fn get_memory_file(project_path: &Path, agent: AgentType) -> Result<Option<String>> {
    let file_path = project_path.join(agent_paths(agent).memory_file);
    match fs::read_to_string(&file_path).await {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Write/overwrite a project's memory file.
pub async fn update_memory_file(project_path: &Path, agent: AgentType, content: &str) -> Result<()> {
    let file_path = project_path.join(agent_paths(agent).memory_file);
    fs::write(&file_path, content).await?;
    Ok(())
}

/// Render a named template from the store and return the rendered content.
pub async fn apply_template(store_path: &Path, template_name: &str, ctx: &TemplateContext) -> Result<String> {
    let template_path = store_path.join("memory-templates").join(format!("{template_name}.md"));
    let template = fs::read_to_string(&template_path).await
        .map_err(|_| AppError::NotFound(format!("Memory template not found: {template_name}")))?;
    render_template(&template, ctx)
}
