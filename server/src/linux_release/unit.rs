//! Template rendering and strict allowlisted token replacement for systemd units.

use super::error::ReleaseError;
use super::origin::validate_web_origins;
use super::unit_parser::ParsedUnit;
use super::unit_policy::{validate_api_unit_policy, validate_web_unit_policy};
use super::version::validate_version;
use std::path::{Path, PathBuf};

pub const TOKEN_RELEASE_ROOT: &str = "@RELEASE_ROOT@";
pub const TOKEN_RELEASE_VERSION: &str = "@RELEASE_VERSION@";
pub const TOKEN_PUBLIC_CONFIG: &str = "@PUBLIC_CONFIG@";
pub const TOKEN_API_ORIGINS: &str = "@API_ORIGINS@";
pub const TOKEN_API_USER: &str = "@API_USER@";
pub const TOKEN_API_GROUP: &str = "@API_GROUP@";
pub const TOKEN_API_HOME: &str = "@API_HOME@";

pub const ALLOWED_TOKENS: &[&str] = &[
    TOKEN_RELEASE_ROOT,
    TOKEN_RELEASE_VERSION,
    TOKEN_PUBLIC_CONFIG,
    TOKEN_API_ORIGINS,
    TOKEN_API_USER,
    TOKEN_API_GROUP,
    TOKEN_API_HOME,
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
            api_user: "dam-hopper".to_string(),
            api_group: "dam-hopper".to_string(),
            api_home: "/var/lib/dam-hopper".to_string(),
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
        validate_path_param("api_home", Path::new(&home))?;
        self.api_user = user;
        self.api_group = group;
        self.api_home = home;
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
                    && token[1..token.len() - 1].chars().all(|c| c.is_ascii_uppercase() || c == '_')
                    && !ALLOWED_TOKENS.contains(&token)
                {
                    return Err(ReleaseError::TemplateTokenInjection {
                        token: token.into(),
                        details: "token is not in the allowlist of unit template placeholders".into(),
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
    // Ensure no unresolved @TOKEN@ placeholders remain
    for line in rendered.lines() {
        let mut rest = line;
        while let Some(start) = rest.find('@') {
            if let Some(end) = rest[start + 1..].find('@') {
                let token = &rest[start..=start + 1 + end];
                if token.len() > 2
                    && token[1..token.len() - 1].chars().all(|c| c.is_ascii_uppercase() || c == '_')
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
    let actual_exec = parsed
        .get_value("Service", "ExecStart")
        .ok_or_else(|| ReleaseError::UnitPolicyViolation {
            unit: name.into(),
            reason: "missing ExecStart in recovery unit".into(),
        })?;
    if actual_exec != expected_exec {
        return Err(ReleaseError::UnitPolicyViolation {
            unit: name.into(),
            reason: format!(
                "ExecStart mismatch: expected '{expected_exec}', got '{actual_exec}'"
            ),
        });
    }
    Ok(rendered)
}
