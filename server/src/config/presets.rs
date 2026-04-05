use super::schema::{CommandKind, ProjectConfig, ProjectType, ServiceConfig};

pub struct BuildPreset {
    pub build_command: &'static str,
    pub run_command: &'static str,
    pub dev_command: Option<&'static str>,
    pub marker_files: &'static [&'static str],
}

pub fn get_preset(project_type: &ProjectType) -> BuildPreset {
    match project_type {
        ProjectType::Maven => BuildPreset {
            build_command: "mvn clean install -DskipTests",
            run_command: "mvn spring-boot:run",
            dev_command: None,
            marker_files: &["pom.xml"],
        },
        ProjectType::Gradle => BuildPreset {
            build_command: "./gradlew build",
            run_command: "./gradlew bootRun",
            dev_command: None,
            marker_files: &["build.gradle", "build.gradle.kts"],
        },
        ProjectType::Npm => BuildPreset {
            build_command: "npm run build",
            run_command: "npm start",
            dev_command: Some("npm run dev"),
            marker_files: &["package-lock.json"],
        },
        ProjectType::Pnpm => BuildPreset {
            build_command: "pnpm build",
            run_command: "pnpm start",
            dev_command: Some("pnpm dev"),
            marker_files: &["pnpm-lock.yaml"],
        },
        ProjectType::Cargo => BuildPreset {
            build_command: "cargo build",
            run_command: "cargo run",
            dev_command: None,
            marker_files: &["Cargo.toml"],
        },
        ProjectType::Custom => BuildPreset {
            build_command: "",
            run_command: "",
            dev_command: None,
            marker_files: &[],
        },
    }
}

/// Returns user-defined services or a single preset-derived default service.
pub fn get_project_services(project: &ProjectConfig) -> Vec<ServiceConfig> {
    if let Some(services) = &project.services {
        if !services.is_empty() {
            return services.clone();
        }
    }
    let preset = get_preset(&project.project_type);
    vec![ServiceConfig {
        name: "default".to_string(),
        build_command: if preset.build_command.is_empty() {
            None
        } else {
            Some(preset.build_command.to_string())
        },
        run_command: if preset.run_command.is_empty() {
            None
        } else {
            Some(preset.run_command.to_string())
        },
    }]
}

pub fn get_effective_command(project: &ProjectConfig, command: CommandKind) -> String {
    let preset = get_preset(&project.project_type);
    if command == CommandKind::Dev {
        return preset.dev_command.unwrap_or("").to_string();
    }
    let services = get_project_services(project);
    let default_service = services.into_iter().next();
    match command {
        CommandKind::Build => default_service
            .and_then(|s| s.build_command)
            .unwrap_or_else(|| preset.build_command.to_string()),
        CommandKind::Run => default_service
            .and_then(|s| s.run_command)
            .unwrap_or_else(|| preset.run_command.to_string()),
        CommandKind::Dev => unreachable!(), // handled above
    }
}

// ──────────────────────────────────────────────
// Detection order for project type auto-discovery
// ──────────────────────────────────────────────

/// Priority-ordered project types for marker-file detection.
/// `Custom` is excluded — it has no marker files by definition and must be explicitly declared.
pub const DETECTION_ORDER: &[ProjectType] = &[
    ProjectType::Cargo,
    ProjectType::Maven,
    ProjectType::Gradle,
    ProjectType::Pnpm,
    ProjectType::Npm,
];
