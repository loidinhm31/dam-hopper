//! Staging and isolated verification of candidate systemd units and public host config.

use super::durable_fs::atomic_write_file;
use super::error::ReleaseError;
use super::host_config::{HostPublicConfig, load_host_public_config, save_host_public_config};
use super::inventory::TargetRole;
use super::layout::Layout;
use super::manifest::ReleaseManifest;
use super::systemd::systemd_analyze_verify;
use super::unit::{UnitRenderContext, render_api_unit, render_recovery_unit, render_web_unit};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

/// Stage candidate systemd units, sysusers config, and pending host config.
pub fn stage_candidate_units(
    layout: &Layout,
    target_dir: &Path,
    manifest: &ReleaseManifest,
    role: TargetRole,
    allow_origins: &[String],
) -> Result<PathBuf, ReleaseError> {
    let pending_units_dir = layout.pending_units_dir();
    stage_candidate_units_inner(
        layout,
        target_dir,
        target_dir,
        manifest,
        role,
        allow_origins,
        &pending_units_dir,
        &layout.pending_host_config_json_path(),
        true,
        false,
    )
}

/// Stage release-owned units with transaction-scoped unit and public-config paths.
pub(crate) fn stage_candidate_units_for_release_with_render_root_and_config(
    layout: &Layout,
    target_dir: &Path,
    render_root: &Path,
    manifest: &ReleaseManifest,
    role: TargetRole,
    allow_origins: &[String],
    pending_units_dir: &Path,
    pending_host_config_path: &Path,
) -> Result<PathBuf, ReleaseError> {
    stage_candidate_units_inner(
        layout,
        target_dir,
        render_root,
        manifest,
        role,
        allow_origins,
        pending_units_dir,
        pending_host_config_path,
        false,
        true,
    )
}

fn stage_candidate_units_inner(
    layout: &Layout,
    target_dir: &Path,
    render_root: &Path,
    manifest: &ReleaseManifest,
    role: TargetRole,
    allow_origins: &[String],
    pending_units_dir: &Path,
    pending_host_config_path: &Path,
    allow_checked_in_fallback: bool,
    require_systemd_validation: bool,
) -> Result<PathBuf, ReleaseError> {
    match fs::symlink_metadata(pending_units_dir) {
        Ok(meta) if meta.file_type().is_dir() => {
            fs::remove_dir_all(pending_units_dir).map_err(|e| ReleaseError::Io {
                action: "clear pending units directory",
                details: e.to_string(),
            })?;
        }
        Ok(_) => {
            return Err(ReleaseError::OwnershipViolation {
                path: pending_units_dir.display().to_string(),
                expected: "0700 regular directory".into(),
                got: "non-directory or symbolic link".into(),
            });
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect pending units directory",
                details: error.to_string(),
            });
        }
    }
    fs::create_dir_all(pending_units_dir).map_err(|e| ReleaseError::Io {
        action: "create pending-units directory",
        details: e.to_string(),
    })?;
    fs::set_permissions(pending_units_dir, fs::Permissions::from_mode(0o700)).map_err(|e| {
        ReleaseError::Io {
            action: "set pending-units directory permissions",
            details: e.to_string(),
        }
    })?;

    let existing_public_config = load_host_public_config(&layout.host_config_json_path())?;
    let profile_id = existing_public_config
        .as_ref()
        .map(|config| config.profile_id.clone())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let api_url = existing_public_config.and_then(|config| config.api_url);

    let host_config = super::host_config::load_host_config(&layout.host_config_path())?;
    let (service_user, service_group, service_home) = if let Some(config) = &host_config {
        if let Some(user_name) = &config.service_user {
            if let Some(user) = super::account::get_user_by_name(user_name) {
                let group =
                    super::account::get_group_by_gid(user.gid).unwrap_or_else(|| user_name.clone());
                (user_name.clone(), group, "/var/lib/dam-hopper".to_string())
            } else {
                (
                    user_name.clone(),
                    user_name.clone(),
                    "/var/lib/dam-hopper".to_string(),
                )
            }
        } else {
            resolve_staging_service_identity()
        }
    } else {
        resolve_staging_service_identity()
    };

    let ctx = UnitRenderContext::new(
        render_root.to_path_buf(),
        manifest.release.version.clone(),
        layout.host_config_json_path(),
        allow_origins.to_vec(),
    )?
    .with_api_identity(service_user, service_group, service_home)?;
    let mut staged_unit_paths = Vec::new();

    let recovery_template = load_release_template(
        target_dir,
        "systemd/dam-hopper-recovery.service.in",
        "systemd/dam-hopper-recovery.service",
        allow_checked_in_fallback,
    )?;
    let rendered_recovery = render_recovery_unit(&recovery_template, &ctx)?;
    let recovery_unit_path = pending_units_dir.join("dam-hopper-recovery.service");
    write_file_with_mode(&recovery_unit_path, rendered_recovery.as_bytes(), 0o644)?;
    staged_unit_paths.push(recovery_unit_path);

    if role.includes_server() {
        let template = load_release_template(
            target_dir,
            "systemd/dam-hopper-api.service.in",
            "systemd/dam-hopper-api.service",
            allow_checked_in_fallback,
        )?;
        let rendered = render_api_unit(&template, &ctx)?;
        let unit_path = pending_units_dir.join("dam-hopper-api.service");
        write_file_with_mode(&unit_path, rendered.as_bytes(), 0o644)?;
        staged_unit_paths.push(unit_path);
    }

    if role.includes_web() {
        let template = load_release_template(
            target_dir,
            "systemd/dam-hopper-web.service.in",
            "systemd/dam-hopper-web.service",
            allow_checked_in_fallback,
        )?;
        let rendered = render_web_unit(&template, &ctx)?;
        let unit_path = pending_units_dir.join("dam-hopper-web.service");
        write_file_with_mode(&unit_path, rendered.as_bytes(), 0o644)?;
        staged_unit_paths.push(unit_path);

        let sysusers_src = target_dir.join("sysusers.d/dam-hopper-web.conf");
        let sysusers_content = match fs::symlink_metadata(&sysusers_src) {
            Ok(meta) if meta.file_type().is_file() => {
                fs::read_to_string(&sysusers_src).map_err(|e| ReleaseError::Io {
                    action: "read sysusers.d config from release",
                    details: e.to_string(),
                })?
            }
            Ok(_) => {
                return Err(ReleaseError::InvalidBundle {
                    path: sysusers_src.display().to_string(),
                    reason: "sysusers.d config must be a regular file".to_string(),
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if allow_checked_in_fallback {
                    include_str!("../../../deploy/sysusers.d/dam-hopper-web.conf").to_string()
                } else {
                    return Err(ReleaseError::InvalidBundle {
                        path: sysusers_src.display().to_string(),
                        reason: "missing required sysusers.d config".to_string(),
                    });
                }
            }
            Err(error) => {
                return Err(ReleaseError::Io {
                    action: "inspect sysusers.d config in release",
                    details: error.to_string(),
                });
            }
        };
        let sysusers_dest = pending_units_dir.join("dam-hopper-web.conf");
        write_file_with_mode(&sysusers_dest, sysusers_content.as_bytes(), 0o644)?;
    }

    let host_public_config = HostPublicConfig::new(
        role,
        manifest.release.version.clone(),
        profile_id,
        api_url,
        allow_origins.to_vec(),
    )?;

    if !staged_unit_paths.is_empty() {
        if require_systemd_validation && !which_bin_exists("systemd-analyze") {
            return Err(ReleaseError::Config(
                "systemd-analyze is required for production unit validation".to_string(),
            ));
        }
        if which_bin_exists("systemd-analyze") {
            systemd_analyze_verify(&staged_unit_paths, None)?;
        }
    }

    save_host_public_config(pending_host_config_path, &host_public_config)?;

    Ok(pending_units_dir.to_path_buf())
}

fn load_release_template(
    release_dir: &Path,
    template_path: &str,
    plain_path: &str,
    allow_checked_in_fallback: bool,
) -> Result<String, ReleaseError> {
    match load_template(release_dir, template_path, allow_checked_in_fallback) {
        Ok(template) => Ok(template),
        Err(ReleaseError::InvalidBundle { path, reason })
            if reason.starts_with("missing required unit template") =>
        {
            load_template(release_dir, plain_path, allow_checked_in_fallback).map_err(|error| {
                match error {
                    ReleaseError::InvalidBundle {
                        path: fallback_path,
                        reason: fallback_reason,
                    } => ReleaseError::InvalidBundle {
                        path: format!("{path} (fallback {fallback_path})"),
                        reason: fallback_reason,
                    },
                    other => other,
                }
            })
        }
        Err(error) => Err(error),
    }
}

fn load_template(
    release_dir: &Path,
    rel_path: &str,
    allow_checked_in_fallback: bool,
) -> Result<String, ReleaseError> {
    let path = release_dir.join(rel_path);
    match fs::symlink_metadata(&path) {
        Ok(meta) if meta.file_type().is_file() => {
            return fs::read_to_string(&path).map_err(|e| ReleaseError::Io {
                action: "read unit template from release",
                details: e.to_string(),
            });
        }
        Ok(_) => {
            return Err(ReleaseError::InvalidBundle {
                path: path.display().to_string(),
                reason: "unit template must be a regular file".to_string(),
            });
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect unit template in release",
                details: error.to_string(),
            });
        }
    }

    if allow_checked_in_fallback {
        let fallback = match rel_path {
            p if p.contains("dam-hopper-recovery") => {
                include_str!("../../../deploy/systemd/dam-hopper-recovery.service.in")
            }
            p if p.contains("dam-hopper-api") => {
                include_str!("../../../deploy/systemd/dam-hopper-api.service.in")
            }
            p if p.contains("dam-hopper-web") => {
                include_str!("../../../deploy/systemd/dam-hopper-web.service.in")
            }
            _ => "",
        };
        if !fallback.is_empty() {
            return Ok(fallback.to_string());
        }
    }

    Err(ReleaseError::InvalidBundle {
        path: path.display().to_string(),
        reason: format!("missing required unit template '{rel_path}'"),
    })
}

fn write_file_with_mode(path: &Path, content: &[u8], mode: u32) -> Result<(), ReleaseError> {
    atomic_write_file(path, content, Some(mode))
}

fn which_bin_exists(bin: &str) -> bool {
    std::process::Command::new("which")
        .arg(bin)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn resolve_staging_service_identity() -> (String, String, String) {
    if let Ok(su) = std::env::var("SUDO_USER") {
        let trimmed = su.trim();
        if !trimmed.is_empty() && trimmed != "root" {
            if let Some(user) = super::account::get_user_by_name(trimmed) {
                if user.uid != 0 {
                    let group = super::account::get_group_by_gid(user.gid)
                        .unwrap_or_else(|| trimmed.to_string());
                    return (trimmed.to_string(), group, user.home);
                }
            }
        }
    }
    if let Some(user) = super::account::get_user_by_name("dam-hopper") {
        if user.uid != 0 {
            let group = super::account::get_group_by_gid(user.gid)
                .unwrap_or_else(|| "dam-hopper".to_string());
            return ("dam-hopper".to_string(), group, user.home);
        }
    }
    (
        "dam-hopper".to_string(),
        "dam-hopper".to_string(),
        "/var/lib/dam-hopper".to_string(),
    )
}
