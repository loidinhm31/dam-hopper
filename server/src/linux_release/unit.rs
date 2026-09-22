//! Template rendering and strict allowlisted token replacement for systemd units.

use super::constants::API_SERVICE_HOME;
use super::error::ReleaseError;
use super::origin::validate_web_origins;
use super::unit_parser::ParsedUnit;
use super::unit_policy::{
    validate_api_unit_policy, validate_helper_unit_policy, validate_runner_unit_policy,
    validate_web_unit_policy,
};
use super::version::validate_version;
use std::path::{Path, PathBuf};

pub const TOKEN_RELEASE_ROOT: &str = "@RELEASE_ROOT@";
pub const TOKEN_RELEASE_VERSION: &str = "@RELEASE_VERSION@";
pub const TOKEN_PUBLIC_CONFIG: &str = "@PUBLIC_CONFIG@";
pub const TOKEN_API_ORIGINS: &str = "@API_ORIGINS@";
pub const TOKEN_API_USER: &str = "@API_USER@";
pub const TOKEN_API_GROUP: &str = "@API_GROUP@";
pub const TOKEN_API_HOME: &str = "@API_HOME@";
pub const TOKEN_ADVISOR_OWNER_USER: &str = "@ADVISOR_OWNER_USER@";
pub const TOKEN_ADVISOR_OWNER_GROUP: &str = "@ADVISOR_OWNER_GROUP@";
pub const TOKEN_ADVISOR_OWNER_HOME: &str = "@ADVISOR_OWNER_HOME@";
pub const TOKEN_DAM_HOPPER_STATE_DIR: &str = "@DAM_HOPPER_STATE_DIR@";
pub const TOKEN_NODE_BIN: &str = "@NODE_BIN@";
pub const TOKEN_API_UID: &str = "@API_UID@";
pub const TOKEN_PLUGIN_SHARED_GROUP: &str = "@PLUGIN_SHARED_GROUP@";

pub const ALLOWED_TOKENS: &[&str] = &[
    TOKEN_RELEASE_ROOT,
    TOKEN_RELEASE_VERSION,
    TOKEN_PUBLIC_CONFIG,
    TOKEN_API_ORIGINS,
    TOKEN_API_USER,
    TOKEN_API_GROUP,
    TOKEN_API_HOME,
    TOKEN_ADVISOR_OWNER_USER,
    TOKEN_ADVISOR_OWNER_GROUP,
    TOKEN_ADVISOR_OWNER_HOME,
    TOKEN_DAM_HOPPER_STATE_DIR,
    TOKEN_NODE_BIN,
    TOKEN_API_UID,
    TOKEN_PLUGIN_SHARED_GROUP,
];

/// Execution context required to render candidate unit files.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnitRenderContext {
    pub release_root: PathBuf,
    pub release_version: String,
    pub public_config: PathBuf,
    pub api_origins: Vec<String>,
    pub api_user: String,
    pub api_group: String,
    pub api_home: String,
    pub advisor_owner_user: String,
    pub advisor_owner_group: String,
    pub advisor_owner_home: String,
    pub dam_hopper_state_dir: String,
    pub node_bin: String,
    pub api_uid: String,
    pub plugin_shared_group: String,
}
impl UnitRenderContext {
    pub fn new(
        release_root: PathBuf,
        release_version: String,
        public_config: PathBuf,
        api_origins: Vec<String>,
    ) -> Result<Self, ReleaseError> {
        validate_path_param("release_root", &release_root)?;
        validate_path_param("public_config", &public_config)?;
        validate_version(&release_version)?;
        let validated_origins = validate_web_origins(&api_origins)?;

        Ok(Self {
            release_root,
            release_version,
            public_config,
            api_origins: validated_origins,
            api_user: String::new(),
            api_group: String::new(),
            api_home: API_SERVICE_HOME.to_string(),
            advisor_owner_user: "dam-hopper-plugin-runner".to_string(),
            advisor_owner_group: super::constants::PLUGIN_SHARED_GROUP.to_string(),
            advisor_owner_home: "/var/lib/dam-hopper-plugin-runner".to_string(),
            dam_hopper_state_dir: super::constants::DEFAULT_RUNNER_STATE_DIR.to_string(),
            node_bin: "node".to_string(),
            api_uid: "1000".to_string(),
            plugin_shared_group: super::constants::PLUGIN_SHARED_GROUP.to_string(),
        })
    }

    pub fn with_api_identity(
        mut self,
        user: String,
        group: String,
        home: String,
    ) -> Result<Self, ReleaseError> {
        validate_ident_param("api_user", &user)?;
        validate_ident_param("api_group", &group)?;
        if home != API_SERVICE_HOME {
            return Err(ReleaseError::Config(format!(
                "API service home must be {API_SERVICE_HOME}"
            )));
        }
        let user_info = super::account::verify_api_service_account(&user)?;
        let group_gid = super::account::get_group_gid_by_name(&group).ok_or_else(|| {
            ReleaseError::Config(format!("API service group '{group}' does not resolve"))
        })?;
        if group_gid != user_info.gid {
            return Err(ReleaseError::Config(format!(
                "API service group '{group}' is not user '{user}' primary group"
            )));
        }
        self.api_user = user;
        self.api_group = group;
        self.api_home = home;
        Ok(self)
    }

    pub fn with_plugin_runner_identity(
        mut self,
        user: String,
        group: String,
        home: String,
        api_uid: u32,
        node_bin: Option<String>,
        state_dir: Option<String>,
    ) -> Result<Self, ReleaseError> {
        validate_ident_param("advisor_owner_user", &user)?;
        validate_ident_param("advisor_owner_group", &group)?;
        self.advisor_owner_user = user;
        self.advisor_owner_group = group;
        self.advisor_owner_home = home;
        self.api_uid = api_uid.to_string();
        if let Some(nb) = node_bin {
            self.node_bin = nb;
        }
        if let Some(sd) = state_dir {
            self.dam_hopper_state_dir = sd;
        }
        Ok(self)
    }
}

fn validate_path_param(name: &'static str, path: &Path) -> Result<(), ReleaseError> {
    if !path.is_absolute() {
        return Err(ReleaseError::TemplateTokenInjection {
            token: name.into(),
            details: format!("path must be absolute: '{}'", path.display()),
        });
    }

    let s = path.to_string_lossy();
    if s.contains('\n') || s.contains('\r') || s.contains('\0') || s.contains('\t') {
        return Err(ReleaseError::TemplateTokenInjection {
            token: name.into(),
            details: "path contains forbidden control characters".into(),
        });
    }

    Ok(())
}
fn validate_ident_param(name: &'static str, val: &str) -> Result<(), ReleaseError> {
    if val.is_empty()
        || val.contains('\n')
        || val.contains('\r')
        || val.contains('\0')
        || val.contains('\t')
        || val.contains(' ')
        || val.contains('@')
    {
        return Err(ReleaseError::TemplateTokenInjection {
            token: name.into(),
            details: format!("identity value contains forbidden characters: '{val}'"),
        });
    }
    Ok(())
}

/// Substitute allowlisted placeholders into unit template.
pub fn render_unit(template: &str, ctx: &UnitRenderContext) -> Result<String, ReleaseError> {
    // Scan for potential injection or unknown @TOKEN@ tokens
    for line in template.lines() {
        let mut rest = line;
        while let Some(start) = rest.find('@') {
            if let Some(end) = rest[start + 1..].find('@') {
                let token = &rest[start..=start + 1 + end];
                if token.len() > 2
                    && token[1..token.len() - 1]
                        .chars()
                        .all(|c| c.is_ascii_uppercase() || c == '_')
                    && !ALLOWED_TOKENS.contains(&token)
                {
                    return Err(ReleaseError::TemplateTokenInjection {
                        token: token.into(),
                        details: "token is not in the allowlist of unit template placeholders"
                            .into(),
                    });
                }
                rest = &rest[start + 2 + end..];
            } else {
                break;
            }
        }
    }

    let mut rendered = template.to_string();
    rendered = rendered.replace(TOKEN_RELEASE_ROOT, &ctx.release_root.to_string_lossy());
    rendered = rendered.replace(TOKEN_RELEASE_VERSION, &ctx.release_version);
    rendered = rendered.replace(TOKEN_PUBLIC_CONFIG, &ctx.public_config.to_string_lossy());
    rendered = rendered.replace(TOKEN_API_ORIGINS, &ctx.api_origins.join(","));
    rendered = rendered.replace(TOKEN_API_USER, &ctx.api_user);
    rendered = rendered.replace(TOKEN_API_GROUP, &ctx.api_group);
    rendered = rendered.replace(TOKEN_API_HOME, &ctx.api_home);
    rendered = rendered.replace(TOKEN_ADVISOR_OWNER_USER, &ctx.advisor_owner_user);
    rendered = rendered.replace(TOKEN_ADVISOR_OWNER_GROUP, &ctx.advisor_owner_group);
    rendered = rendered.replace(TOKEN_ADVISOR_OWNER_HOME, &ctx.advisor_owner_home);
    rendered = rendered.replace(TOKEN_DAM_HOPPER_STATE_DIR, &ctx.dam_hopper_state_dir);
    rendered = rendered.replace(TOKEN_NODE_BIN, &ctx.node_bin);
    rendered = rendered.replace(TOKEN_API_UID, &ctx.api_uid);
    rendered = rendered.replace(TOKEN_PLUGIN_SHARED_GROUP, &ctx.plugin_shared_group);
    // Ensure no unresolved @TOKEN@ placeholders remain
    for line in rendered.lines() {
        let mut rest = line;
        while let Some(start) = rest.find('@') {
            if let Some(end) = rest[start + 1..].find('@') {
                let token = &rest[start..=start + 1 + end];
                if token.len() > 2
                    && token[1..token.len() - 1]
                        .chars()
                        .all(|c| c.is_ascii_uppercase() || c == '_')
                {
                    return Err(ReleaseError::UnresolvedTemplateToken {
                        token: token.into(),
                    });
                }
                rest = &rest[start + 2 + end..];
            } else {
                break;
            }
        }
    }

    Ok(rendered)
}

/// Render API service unit and validate its strict systemd policy.
pub fn render_api_unit(template: &str, ctx: &UnitRenderContext) -> Result<String, ReleaseError> {
    let rendered = render_unit(template, ctx)?;
    let parsed = ParsedUnit::parse(&rendered)?;
    validate_api_unit_policy(&parsed, ctx)?;
    Ok(rendered)
}

/// Render Web service unit and validate its strict systemd policy.
pub fn render_web_unit(template: &str, ctx: &UnitRenderContext) -> Result<String, ReleaseError> {
    let rendered = render_unit(template, ctx)?;
    let parsed = ParsedUnit::parse(&rendered)?;
    validate_web_unit_policy(&parsed, ctx)?;
    Ok(rendered)
}

/// Render idle suspend helper unit and validate its strict systemd policy.
pub fn render_helper_unit(template: &str, ctx: &UnitRenderContext) -> Result<String, ReleaseError> {
    let rendered = render_unit(template, ctx)?;
    let parsed = ParsedUnit::parse(&rendered)?;
    validate_helper_unit_policy(&parsed, ctx)?;
    Ok(rendered)
}

/// Render plugin runner service unit and validate its strict systemd policy.
pub fn render_runner_unit(template: &str, ctx: &UnitRenderContext) -> Result<String, ReleaseError> {
    let rendered = render_unit(template, ctx)?;
    let parsed = ParsedUnit::parse(&rendered)?;
    validate_runner_unit_policy(&parsed, ctx)?;
    Ok(rendered)
}

/// Render recovery service unit and validate its strict systemd policy.
pub fn render_recovery_unit(
    template: &str,
    ctx: &UnitRenderContext,
) -> Result<String, ReleaseError> {
    let rendered = render_unit(template, ctx)?;
    let parsed = ParsedUnit::parse(&rendered)?;
    let name = "dam-hopper-recovery.service";
    let expected_exec = format!(
        "{}/bin/dam-hopper-manager recover --boot",
        ctx.release_root.display()
    );
    let actual_exec = parsed.get_value("Service", "ExecStart").ok_or_else(|| {
        ReleaseError::UnitPolicyViolation {
            unit: name.into(),
            reason: "missing ExecStart in recovery unit".into(),
        }
    })?;
    if actual_exec != expected_exec {
        return Err(ReleaseError::UnitPolicyViolation {
            unit: name.into(),
            reason: format!("ExecStart mismatch: expected '{expected_exec}', got '{actual_exec}'"),
        });
    }
    Ok(rendered)
}
