//! Staging and isolated verification of candidate systemd units and public host config.

use super::error::ReleaseError;
use super::host_config::{load_host_public_config, save_host_public_config, HostPublicConfig};
use super::inventory::TargetRole;
use super::layout::Layout;
use super::manifest::ReleaseManifest;
use super::systemd::systemd_analyze_verify;
use super::unit::{
    render_api_unit, render_recovery_unit, render_web_unit, UnitRenderContext,
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
    fs::create_dir_all(&pending_units_dir).map_err(|e| ReleaseError::Io {
        action: "create pending-units directory",
        details: e.to_string(),
    })?;

    let ctx = UnitRenderContext::new(
        target_dir.to_path_buf(),
        manifest.release.version.clone(),
        layout.host_config_json_path(),
        allow_origins.to_vec(),
    )?;

    let mut staged_unit_paths = Vec::new();

    // 0. Stage Recovery service unit (required dependency of app units)
    let recovery_template = load_template(target_dir, "systemd/dam-hopper-recovery.service.in")
        .or_else(|_| load_template(target_dir, "systemd/dam-hopper-recovery.service"))?;
    let rendered_recovery = render_recovery_unit(&recovery_template, &ctx)?;
    let recovery_unit_path = pending_units_dir.join("dam-hopper-recovery.service");
    write_file_with_mode(&recovery_unit_path, rendered_recovery.as_bytes(), 0o644)?;
    staged_unit_paths.push(recovery_unit_path);

    // 1. Stage API service unit if role includes Server
    if role.includes_server() {
        let template = load_template(target_dir, "systemd/dam-hopper-api.service.in")
            .or_else(|_| load_template(target_dir, "systemd/dam-hopper-api.service"))?;
        let rendered = render_api_unit(&template, &ctx)?;
        let unit_path = pending_units_dir.join("dam-hopper-api.service");
        write_file_with_mode(&unit_path, rendered.as_bytes(), 0o644)?;
        staged_unit_paths.push(unit_path);
    }

    // 2. Stage Web service unit and sysusers if role includes Web
    if role.includes_web() {
        let template = load_template(target_dir, "systemd/dam-hopper-web.service.in")
            .or_else(|_| load_template(target_dir, "systemd/dam-hopper-web.service"))?;
        let rendered = render_web_unit(&template, &ctx)?;
        let unit_path = pending_units_dir.join("dam-hopper-web.service");
        write_file_with_mode(&unit_path, rendered.as_bytes(), 0o644)?;
        staged_unit_paths.push(unit_path);

        // Stage sysusers.d config
        let sysusers_src = target_dir.join("sysusers.d/dam-hopper-web.conf");
        let sysusers_content = if sysusers_src.exists() {
            fs::read_to_string(&sysusers_src).map_err(|e| ReleaseError::Io {
                action: "read sysusers.d config from release",
                details: e.to_string(),
            })?
        } else {
            include_str!("../../../deploy/sysusers.d/dam-hopper-web.conf").to_string()
        };
        let sysusers_dest = pending_units_dir.join("dam-hopper-web.conf");
        write_file_with_mode(&sysusers_dest, sysusers_content.as_bytes(), 0o644)?;
    }

    // 3. Stage candidate host-config.json
    let profile_id = match load_host_public_config(&layout.host_config_json_path())? {
        Some(existing) => existing.profile_id,
        None => uuid::Uuid::new_v4().to_string(),
    };
    let api_url = "http://127.0.0.1:4801".to_string();
    let host_public_config = HostPublicConfig::new(
        role,
        manifest.release.version.clone(),
        profile_id,
        api_url,
        allow_origins.to_vec(),
    )?;
    save_host_public_config(&layout.pending_host_config_json_path(), &host_public_config)?;

    // 4. Verify candidate units with systemd-analyze if binary exists
    if which_bin_exists("systemd-analyze") && !staged_unit_paths.is_empty() {
        systemd_analyze_verify(&staged_unit_paths, None)?;
    }

    Ok(pending_units_dir)
}

fn load_template(release_dir: &Path, rel_path: &str) -> Result<String, ReleaseError> {
    let path = release_dir.join(rel_path);
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| ReleaseError::Io {
            action: "read unit template from release",
            details: e.to_string(),
        })
    } else {
        // Fallback to checked-in template if not present in release directory
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
            Ok(fallback.to_string())
        } else {
            Err(ReleaseError::InvalidBundle {
                path: path.display().to_string(),
                reason: format!("missing required unit template '{rel_path}'"),
            })
        }
    }
}

fn write_file_with_mode(path: &Path, content: &[u8], mode: u32) -> Result<(), ReleaseError> {
    fs::write(path, content).map_err(|e| ReleaseError::Io {
        action: "write staged unit file",
        details: e.to_string(),
    })?;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(mode));
    Ok(())
}

fn which_bin_exists(bin: &str) -> bool {
    std::process::Command::new("which")
        .arg(bin)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
