//! Staging and isolated verification of candidate systemd units and public host config.

use super::constants::{HELPER_SERVICE_UNIT, RUNNER_SERVICE_UNIT, RUNNER_TMPFILES_CONF};
use super::durable_fs::atomic_write_file;
use super::error::ReleaseError;
use super::host_config::{
    load_host_public_config, save_host_public_config, HostConfig, HostPublicConfig,
};
use super::inventory::TargetRole;
use super::layout::Layout;
use super::manifest::ReleaseManifest;
use super::systemd::systemd_analyze_verify;
use super::unit::{
    render_api_unit, render_helper_unit, render_recovery_unit, render_runner_unit, render_unit,
    render_web_unit, UnitRenderContext,
};
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
        None,
        None,
    )
}

/// Re-render transaction-scoped units with an explicit API user before activation.
pub(crate) fn stage_candidate_units_for_release_with_identity(
    layout: &Layout,
    target_dir: &Path,
    render_root: &Path,
    manifest: &ReleaseManifest,
    role: TargetRole,
    allow_origins: &[String],
    pending_units_dir: &Path,
    pending_host_config_path: &Path,
    service_user: Option<&str>,
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
        service_user,
        None,
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
        None,
        None,
    )
}
/// Render using the selected host configuration, before it is persisted.
pub(crate) fn stage_candidate_units_for_release_with_host_config(
    layout: &Layout,
    target_dir: &Path,
    render_root: &Path,
    manifest: &ReleaseManifest,
    role: TargetRole,
    allow_origins: &[String],
    pending_units_dir: &Path,
    pending_host_config_path: &Path,
    host_config: &HostConfig,
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
        None,
        Some(host_config),
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
    service_user_override: Option<&str>,
    selected_host_config: Option<&HostConfig>,
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

    let stored_host_config;
    let host_config = if let Some(selected) = selected_host_config {
        Some(selected)
    } else {
        stored_host_config = super::host_config::load_host_config(&layout.host_config_path())?;
        stored_host_config.as_ref()
    };
    let explicit_user = service_user_override.or_else(|| {
        host_config
            .as_ref()
            .and_then(|config| config.service_user.as_deref())
    });
    let base_ctx = UnitRenderContext::new(
        render_root.to_path_buf(),
        manifest.release.version.clone(),
        layout.host_config_json_path(),
        allow_origins.to_vec(),
    )?;
    let ctx = if role.includes_server() {
        let service_user = super::account::resolve_service_user(explicit_user, true)?;
        let user_info = super::account::verify_api_service_account(&service_user)?;
        let service_group = super::account::get_group_by_gid(user_info.gid).ok_or_else(|| {
            ReleaseError::Config(format!(
                "primary group for API service user '{service_user}' does not resolve"
            ))
        })?;
        let mut server_ctx = base_ctx.with_api_identity(
            service_user.clone(),
            service_group,
            super::constants::API_SERVICE_HOME.to_string(),
        )?;
        server_ctx.api_uid = user_info.uid.to_string();
        let selected_owner = host_config.and_then(|config| config.plugin_owner_user.as_deref());
        let owner_info = if layout == &Layout::new() {
            Some(super::account::ensure_plugin_runner_account(
                selected_owner,
                &service_user,
            )?)
        } else if let Some(owner) = selected_owner {
            Some(super::account::verify_plugin_owner_account(
                owner,
                Some(&service_user),
            )?)
        } else {
            None
        };
        if let Some(owner_info) = owner_info {
            let owner = selected_owner.unwrap_or("dam-hopper-plugin-runner");
            let owner_group =
                super::account::get_group_by_gid(owner_info.gid).ok_or_else(|| {
                    ReleaseError::Config(format!(
                        "primary group for plugin owner '{owner}' does not resolve"
                    ))
                })?;
            server_ctx = server_ctx.with_plugin_runner_identity(
                owner.to_string(),
                owner_group,
                owner_info.home,
                user_info.uid,
                None,
                None,
            )?;
        }
        server_ctx
    } else {
        base_ctx
    };
    let recovery_template = load_release_template(
        target_dir,
        "systemd/dam-hopper-recovery.service.in",
        "systemd/dam-hopper-recovery.service",
        allow_checked_in_fallback,
    )?;
    let mut staged_unit_paths = Vec::new();
    let rendered_recovery = render_recovery_unit(&recovery_template, &ctx)?;
    let recovery_unit_path = pending_units_dir.join("dam-hopper-recovery.service");
    write_file_with_mode(&recovery_unit_path, rendered_recovery.as_bytes(), 0o644)?;
    staged_unit_paths.push(recovery_unit_path);

    if role.includes_server() {
        let node_path = target_dir.join("bin/node");
        let node_meta = fs::symlink_metadata(&node_path).map_err(|error| ReleaseError::Io {
            action: "inspect bundled plugin worker runtime",
            details: format!("{}: {error}", node_path.display()),
        })?;
        if !node_meta.is_file() || node_meta.permissions().mode() & 0o111 == 0 {
            return Err(ReleaseError::Config(
                "bundled plugin worker runtime must be a regular executable".into(),
            ));
        }
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

        let helper_template = load_release_template(
            target_dir,
            "systemd/dam-hopper-idle-suspend-helper.service.in",
            "systemd/dam-hopper-idle-suspend-helper.service",
            allow_checked_in_fallback,
        )?;
        let rendered_helper = render_helper_unit(&helper_template, &ctx)?;
        let helper_unit_path = pending_units_dir.join(HELPER_SERVICE_UNIT);
        write_file_with_mode(&helper_unit_path, rendered_helper.as_bytes(), 0o644)?;
        staged_unit_paths.push(helper_unit_path);

        let runner_template = load_release_template(
            target_dir,
            "systemd/dam-hopper-plugin-runner.service.in",
            "systemd/dam-hopper-plugin-runner.service",
            allow_checked_in_fallback,
        )?;
        let rendered_runner = render_runner_unit(&runner_template, &ctx)?;
        let runner_unit_path = pending_units_dir.join(RUNNER_SERVICE_UNIT);
        write_file_with_mode(&runner_unit_path, rendered_runner.as_bytes(), 0o644)?;
        staged_unit_paths.push(runner_unit_path);

        let tmpfiles_template = load_template(
            target_dir,
            "tmpfiles.d/dam-hopper-plugin-runner.conf.in",
            allow_checked_in_fallback,
        )
        .or_else(|_| {
            load_template(
                target_dir,
                "tmpfiles.d/dam-hopper-plugin-runner.conf",
                allow_checked_in_fallback,
            )
        })?;
        let rendered_tmpfiles = render_unit(&tmpfiles_template, &ctx)?;
        let tmpfiles_dest = pending_units_dir.join(RUNNER_TMPFILES_CONF);
        write_file_with_mode(&tmpfiles_dest, rendered_tmpfiles.as_bytes(), 0o644)?;
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
            p if p.contains("dam-hopper-idle-suspend-helper") => {
                include_str!("../../../deploy/systemd/dam-hopper-idle-suspend-helper.service.in")
            }
            p if p.contains("dam-hopper-plugin-runner.service") => {
                include_str!("../../../deploy/systemd/dam-hopper-plugin-runner.service.in")
            }
            p if p.contains("dam-hopper-plugin-runner.conf") => {
                include_str!("../../../deploy/tmpfiles.d/dam-hopper-plugin-runner.conf.in")
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
