use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct CommandDatabase {
    pub language: String,
    pub framework: String,
    #[serde(rename = "projectType")]
    pub project_type: String,
    pub commands: Vec<CommandDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandDefinition {
    pub name: String,
    pub command: String,
    pub description: String,
    pub tags: Vec<String>,
}

static MAVEN_JSON: &str = include_str!("definitions/maven.json");
static GRADLE_JSON: &str = include_str!("definitions/gradle.json");
static NPM_JSON: &str = include_str!("definitions/npm.json");
static PNPM_JSON: &str = include_str!("definitions/pnpm.json");
static CARGO_JSON: &str = include_str!("definitions/cargo.json");

pub fn load_all_databases() -> Vec<CommandDatabase> {
    [MAVEN_JSON, GRADLE_JSON, NPM_JSON, PNPM_JSON, CARGO_JSON]
        .iter()
        .filter_map(|s| serde_json::from_str(s).ok())
        .collect()
}
