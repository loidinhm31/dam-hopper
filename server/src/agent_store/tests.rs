use std::path::PathBuf;
use tempfile::TempDir;
use tokio::fs;

use super::schema::{AgentItemCategory, AgentType, DistributionMethod};
use super::store::AgentStoreService;
use super::scanner::scan_project;
use super::distributor::{ship, unship, health_check};
use super::memory::{render_template, TemplateContext, ProjectContext, WorkspaceContext, list_memory_templates};
use super::importer::{scan_local_dir, import_from_repo};

fn make_store(tmp: &TempDir) -> AgentStoreService {
    AgentStoreService::new(tmp.path().join("store"))
}

async fn setup_store(tmp: &TempDir) -> AgentStoreService {
    let svc = make_store(tmp);
    svc.init().await.unwrap();
    svc
}

async fn write_skill(dir: &PathBuf, skill_name: &str, description: &str) {
    let skill_dir = dir.join(skill_name);
    fs::create_dir_all(&skill_dir).await.unwrap();
    fs::write(
        skill_dir.join("SKILL.md"),
        format!("---\nname: {skill_name}\ndescription: {description}\n---\n# {skill_name}"),
    ).await.unwrap();
}

async fn write_command(dir: &PathBuf, cmd_name: &str, description: &str) {
    fs::create_dir_all(dir).await.unwrap();
    fs::write(
        dir.join(format!("{cmd_name}.md")),
        format!("---\ndescription: {description}\n---\n# {cmd_name}"),
    ).await.unwrap();
}

// ── Store tests ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_store_init_creates_dirs() {
    let tmp = TempDir::new().unwrap();
    let svc = setup_store(&tmp).await;

    for cat in AgentItemCategory::all() {
        let dir = svc.store_path().join(cat.store_dir());
        assert!(dir.exists(), "missing dir for {cat}");
    }
}

#[tokio::test]
async fn test_store_list_empty() {
    let tmp = TempDir::new().unwrap();
    let svc = setup_store(&tmp).await;
    let items = svc.list(None).await.unwrap();
    assert!(items.is_empty());
}

#[tokio::test]
async fn test_store_add_and_list_skill() {
    let tmp = TempDir::new().unwrap();
    let svc = setup_store(&tmp).await;

    let skill_src = tmp.path().join("my-skill");
    write_skill(&tmp.path().to_path_buf(), "my-skill", "A test skill").await;

    let item = svc.add(&skill_src, AgentItemCategory::Skill, Some("my-skill")).await.unwrap();
    assert_eq!(item.name, "my-skill");
    assert_eq!(item.description.as_deref(), Some("A test skill"));

    let items = svc.list(Some(AgentItemCategory::Skill)).await.unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].name, "my-skill");
}

#[tokio::test]
async fn test_store_add_and_remove_command() {
    let tmp = TempDir::new().unwrap();
    let svc = setup_store(&tmp).await;

    let cmd_dir = tmp.path().join("cmds");
    write_command(&cmd_dir, "deploy", "Deploy the app").await;
    let src = cmd_dir.join("deploy.md");

    svc.add(&src, AgentItemCategory::Command, Some("deploy")).await.unwrap();

    let items = svc.list(Some(AgentItemCategory::Command)).await.unwrap();
    assert_eq!(items.len(), 1);

    svc.remove("deploy", AgentItemCategory::Command).await.unwrap();
    let items = svc.list(Some(AgentItemCategory::Command)).await.unwrap();
    assert!(items.is_empty());
}

// ── Scanner tests ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_scan_project_no_agents() {
    let tmp = TempDir::new().unwrap();
    let result = scan_project("proj", tmp.path()).await;
    assert!(result.agents.is_empty());
}

#[tokio::test]
async fn test_scan_project_with_claude() {
    let tmp = TempDir::new().unwrap();
    let proj_path = tmp.path();

    // Create .claude structure
    let skills_dir = proj_path.join(".claude/skills");
    write_skill(&skills_dir, "code-review", "Reviews code").await;
    let cmds_dir = proj_path.join(".claude/commands");
    write_command(&cmds_dir, "deploy", "Deploy app").await;

    let result = scan_project("proj", proj_path).await;
    let claude = result.agents.get("claude").expect("claude agent not found");
    assert!(claude.has_config);
    assert_eq!(claude.skills.len(), 1);
    assert!(claude.skills.contains(&"code-review".to_string()));
    assert_eq!(claude.commands.len(), 1);
}

// ── Distributor tests ─────────────────────────────────────────────────────────

#[tokio::test]
async fn test_ship_skill_symlink() {
    let tmp = TempDir::new().unwrap();
    let svc = setup_store(&tmp).await;

    // Add a skill to the store
    let skill_src = tmp.path().join("src-skill");
    write_skill(&tmp.path().to_path_buf(), "src-skill", "Test").await;
    svc.add(&skill_src, AgentItemCategory::Skill, Some("test-skill")).await.unwrap();

    let project_path = tmp.path().join("project");
    fs::create_dir_all(&project_path).await.unwrap();

    let result = ship(
        svc.store_path(),
        "test-skill",
        AgentItemCategory::Skill,
        &project_path,
        AgentType::Claude,
        DistributionMethod::Symlink,
    ).await;

    assert!(result.success, "ship failed: {:?}", result.error);
    let target = project_path.join(".claude/skills/test-skill");
    assert!(target.exists() || tokio::fs::symlink_metadata(&target).await.is_ok());
}

#[tokio::test]
async fn test_ship_then_unship() {
    let tmp = TempDir::new().unwrap();
    let svc = setup_store(&tmp).await;

    let skill_src = tmp.path().join("src-skill2");
    write_skill(&tmp.path().to_path_buf(), "src-skill2", "Test2").await;
    svc.add(&skill_src, AgentItemCategory::Skill, Some("rmskill")).await.unwrap();

    let project_path = tmp.path().join("project2");
    fs::create_dir_all(&project_path).await.unwrap();

    let ship_result = ship(
        svc.store_path(), "rmskill", AgentItemCategory::Skill,
        &project_path, AgentType::Claude, DistributionMethod::Symlink,
    ).await;
    assert!(ship_result.success);

    let unship_result = unship(
        svc.store_path(), "rmskill", AgentItemCategory::Skill,
        &project_path, AgentType::Claude, false,
    ).await;
    assert!(unship_result.success, "unship failed: {:?}", unship_result.error);

    let target = project_path.join(".claude/skills/rmskill");
    assert!(!target.exists());
}

#[tokio::test]
async fn test_health_check_broken_symlink() {
    let tmp = TempDir::new().unwrap();

    let project_path = tmp.path().join("project");
    let skills_dir = project_path.join(".claude/skills");
    fs::create_dir_all(&skills_dir).await.unwrap();

    // Create a symlink pointing to a nonexistent target
    let broken_link = skills_dir.join("broken-skill");
    #[cfg(unix)]
    std::os::unix::fs::symlink("/nonexistent/path/broken", &broken_link).unwrap();
    #[cfg(not(unix))]
    {
        // Skip this test on non-unix
        return;
    }

    let store_path = tmp.path().join("store");
    let result = health_check(
        &store_path,
        &[("project", project_path.as_path())],
        AgentType::all(),
    ).await;

    assert_eq!(result.broken_symlinks.len(), 1, "expected 1 broken symlink");
    assert_eq!(result.broken_symlinks[0].project, "project");
}

// ── Memory template tests ─────────────────────────────────────────────────────

#[tokio::test]
async fn test_render_template_basic() {
    let template = "Hello {{project.name}} — type: {{project.type}}";
    let ctx = TemplateContext {
        project: ProjectContext {
            name: "my-app".to_string(),
            path: "/projects/my-app".to_string(),
            project_type: "cargo".to_string(),
            tags: Some(vec!["backend".to_string()]),
            tags_joined: "backend".to_string(),
        },
        workspace: WorkspaceContext {
            name: "dev".to_string(),
            root: "/workspace".to_string(),
        },
        agent: "claude".to_string(),
    };

    let rendered = render_template(template, &ctx).unwrap();
    assert_eq!(rendered, "Hello my-app — type: cargo");
}

#[tokio::test]
async fn test_render_template_eq_helper() {
    let template = "{{#if (eq project.type \"cargo\")}}rust project{{else}}other{{/if}}";
    let ctx = TemplateContext {
        project: ProjectContext {
            name: "server".to_string(),
            path: "/projects/server".to_string(),
            project_type: "cargo".to_string(),
            tags: None,
            tags_joined: String::new(),
        },
        workspace: WorkspaceContext {
            name: "dev".to_string(),
            root: "/workspace".to_string(),
        },
        agent: "claude".to_string(),
    };

    let rendered = render_template(template, &ctx).unwrap();
    assert_eq!(rendered, "rust project");
}

#[tokio::test]
async fn test_list_memory_templates_empty() {
    let tmp = TempDir::new().unwrap();
    let store_path = tmp.path().join("store");
    fs::create_dir_all(store_path.join("memory-templates")).await.unwrap();

    let templates = list_memory_templates(&store_path).await.unwrap();
    assert!(templates.is_empty());
}

#[tokio::test]
async fn test_list_memory_templates() {
    let tmp = TempDir::new().unwrap();
    let store_path = tmp.path().join("store");
    fs::create_dir_all(store_path.join("memory-templates")).await.unwrap();
    fs::write(
        store_path.join("memory-templates/generic.md"),
        "# Generic template for {{project.name}}",
    ).await.unwrap();

    let templates = list_memory_templates(&store_path).await.unwrap();
    assert_eq!(templates.len(), 1);
    assert_eq!(templates[0].name, "generic");
}

// ── Importer tests ────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_scan_local_dir_finds_skills() {
    let tmp = TempDir::new().unwrap();

    // Set up a skill in .claude/skills/
    let skills_dir = tmp.path().join(".claude/skills");
    write_skill(&skills_dir, "my-skill", "My test skill").await;

    let result = scan_local_dir(tmp.path()).await.unwrap();
    let skills: Vec<_> = result.items.iter().filter(|i| i.category == AgentItemCategory::Skill).collect();
    assert!(!skills.is_empty(), "no skills found");
    assert!(skills.iter().any(|s| s.name == "my-skill"));
}

#[tokio::test]
async fn test_import_from_repo_no_overwrite() {
    let tmp = TempDir::new().unwrap();

    let src_dir = tmp.path().join("src");
    write_skill(&src_dir, "existing-skill", "Already exists").await;

    let store_path = tmp.path().join("store");
    // Pre-populate store with the same skill
    let store_skills = store_path.join("skills/existing-skill");
    fs::create_dir_all(&store_skills).await.unwrap();
    fs::write(store_skills.join("SKILL.md"), "existing").await.unwrap();

    let items = vec![super::importer::RepoScanItem {
        name: "existing-skill".to_string(),
        category: AgentItemCategory::Skill,
        description: None,
        relative_path: "existing-skill".to_string(),
    }];

    let results = import_from_repo(&src_dir, &items, &store_path).await.unwrap();
    assert_eq!(results.len(), 1);
    assert!(!results[0].success);
    assert!(results[0].error.as_deref().unwrap_or("").contains("Already exists"));
}
