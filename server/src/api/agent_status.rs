use axum::{
    extract::{Path as AxumPath, Query, State},
    response::Json,
};
use serde::Deserialize;
use std::path::PathBuf;

use crate::agent_status::{
    check_extension_status, check_native_integration_status, install_extension,
    install_native_integration, uninstall_extension, uninstall_native_integration,
    AgentKind, AgentPathsVerification, AgentStatusSnapshotV1, ExtensionStatusReport,
    IntegrationError, ManagedExtensionStatus, ManagedInstallationStatus,
    ManagedReadinessStatus, NativeIntegrationStatusReport, MANAGED_ADAPTER_VERSION,
    MANAGED_LAUNCHER_SUBPATH, MANAGED_MANIFEST_SUBPATH,
};
use crate::api::error::ApiError;
use crate::state::AppState;

/// Query parameters for extension inspection and uninstallation.
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionQuery {
    pub agent_dir: Option<String>,
}

/// Request body for extension installation.
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionInstallBody {
    pub agent_dir: Option<String>,
}

/// Query parameters for agent paths verification.
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PathsVerificationQuery {
    pub agent_dir: Option<String>,
    pub codex_dir: Option<String>,
    pub claude_dir: Option<String>,
}

#[cfg(unix)]
fn resolve_user_home_by_name(username: &str) -> Option<PathBuf> {
    let c_user = std::ffi::CString::new(username).ok()?;
    let mut pwd = std::mem::MaybeUninit::<libc::passwd>::uninit();
    let mut result = std::ptr::null_mut();
    let mut buf = vec![0u8; 4096];
    let rc = unsafe {
        libc::getpwnam_r(
            c_user.as_ptr(),
            pwd.as_mut_ptr(),
            buf.as_mut_ptr() as *mut libc::c_char,
            buf.len(),
            &mut result,
        )
    };
    if rc == 0 && !result.is_null() {
        let pwd_ref = unsafe { &*result };
        let home = unsafe {
            std::ffi::CStr::from_ptr(pwd_ref.pw_dir)
                .to_string_lossy()
                .into_owned()
        };
        if !home.is_empty() {
            return Some(PathBuf::from(home));
        }
    }
    None
}

pub(crate) fn resolve_effective_home() -> Option<PathBuf> {
    #[cfg(unix)]
    {
        if let Ok(host_toml_content) = std::fs::read_to_string("/etc/dam-hopper/host.toml") {
            if let Ok(table) = host_toml_content.parse::<toml::Table>() {
                if let Some(user_val) = table.get("service_user").or_else(|| table.get("plugin_owner_user")) {
                    if let Some(username) = user_val.as_str() {
                        if let Some(home) = resolve_user_home_by_name(username) {
                            return Some(home);
                        }
                    }
                }
            }
        }
    }

    dirs::home_dir()
}

pub(crate) fn expand_and_validate_path(
    raw: &str,
    effective_home: Option<&std::path::Path>,
) -> Result<PathBuf, IntegrationError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(IntegrationError::NonAbsolutePath(PathBuf::from(raw)));
    }
    if trimmed == "~" || (trimmed.starts_with('~') && !trimmed.starts_with("~/")) {
        return Err(IntegrationError::NonAbsolutePath(PathBuf::from(raw)));
    }
    let candidate = if let Some(sub) = trimmed.strip_prefix("~/") {
        if let Some(home) = effective_home {
            home.join(sub)
        } else {
            return Err(IntegrationError::InvalidAgentDirectory(PathBuf::from(raw)));
        }
    } else {
        PathBuf::from(trimmed)
    };

    if !candidate.is_absolute() {
        return Err(IntegrationError::NonAbsolutePath(candidate));
    }

    for comp in candidate.components() {
        if matches!(comp, std::path::Component::ParentDir) {
            return Err(IntegrationError::InvalidAgentDirectory(candidate));
        }
    }

    Ok(candidate)
}

pub(crate) fn resolve_target_agent_dir(explicit: Option<&str>) -> Result<PathBuf, IntegrationError> {
    let effective_home = resolve_effective_home();
    if let Some(raw) = explicit {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return expand_and_validate_path(trimmed, effective_home.as_deref());
        }
    }

    if let Ok(dir) = std::env::var("PI_CODING_AGENT_DIR") {
        let p = PathBuf::from(dir);
        if p.is_absolute() {
            return Ok(p);
        }
    }

    effective_home
        .map(|h| h.join(".omp").join("agent"))
        .ok_or_else(|| {
            IntegrationError::InvalidAgentDirectory(PathBuf::from("~/.omp/agent"))
        })
}

pub(crate) fn resolve_native_target_dir(
    agent_kind: AgentKind,
    explicit: Option<&str>,
) -> Result<PathBuf, IntegrationError> {
    let effective_home = resolve_effective_home();
    if let Some(raw) = explicit {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return expand_and_validate_path(trimmed, effective_home.as_deref());
        }
    }

    match agent_kind {
        AgentKind::Codex => {
            if let Ok(dir) = std::env::var("CODEX_HOME") {
                let p = PathBuf::from(dir);
                if p.is_absolute() {
                    return Ok(p);
                }
            }
            effective_home
                .map(|h| h.join(".codex"))
                .ok_or_else(|| IntegrationError::InvalidAgentDirectory(PathBuf::from("~/.codex")))
        }
        AgentKind::Claude => {
            if let Ok(dir) = std::env::var("CLAUDE_CONFIG_DIR") {
                let p = PathBuf::from(dir);
                if p.is_absolute() {
                    return Ok(p);
                }
            }
            effective_home
                .map(|h| h.join(".claude"))
                .ok_or_else(|| IntegrationError::InvalidAgentDirectory(PathBuf::from("~/.claude")))
        }
        AgentKind::Omp => resolve_target_agent_dir(explicit),
    }
}

pub(crate) fn parse_native_agent_kind(agent: &str) -> Result<AgentKind, ApiError> {
    match agent.to_ascii_lowercase().as_str() {
        "codex" => Ok(AgentKind::Codex),
        "claude" => Ok(AgentKind::Claude),
        other => Err(ApiError::from_app(crate::error::AppError::InvalidInput(format!(
            "Unknown or unsupported native agent integration: '{other}'"
        )))),
    }
}

/// Verify OMP and Codex paths for notification eligibility.
pub async fn get_agent_paths_verification(
    Query(q): Query<PathsVerificationQuery>,
) -> Result<Json<AgentPathsVerification>, ApiError> {
    let home = resolve_effective_home().unwrap_or_else(|| PathBuf::from("/"));
    let effective_home = home.to_string_lossy().into_owned();

    // 1. OMP paths
    let omp_notification_dir_buf = std::env::var("PI_CODING_AGENT_DIR")
        .ok()
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .unwrap_or_else(|| home.join(".omp").join("agent"));
    let omp_notification_dir = omp_notification_dir_buf.to_string_lossy().into_owned();

    let (omp_install_dir_buf, omp_resolve_err) = match q.agent_dir.as_deref().filter(|s| !s.trim().is_empty()) {
        Some(explicit) => match expand_and_validate_path(explicit, Some(&home)) {
            Ok(p) => (p, None),
            Err(e) => (omp_notification_dir_buf.clone(), Some(e.to_string())),
        },
        None => (omp_notification_dir_buf.clone(), None),
    };
    let omp_install_dir = omp_install_dir_buf.to_string_lossy().into_owned();

    let (omp_status, omp_can_enable, omp_reason) = if let Some(err) = omp_resolve_err {
        (ManagedExtensionStatus::Absent, false, Some(err))
    } else {
        let status = check_extension_status(&omp_install_dir_buf)
            .map(|r| r.status)
            .unwrap_or(ManagedExtensionStatus::Absent);
        let paths_match = omp_install_dir_buf == omp_notification_dir_buf;
        if !paths_match {
            (
                status,
                false,
                Some(format!(
                    "Configured install path ({}) does not match notification runtime path ({})",
                    omp_install_dir, omp_notification_dir
                )),
            )
        } else if status != ManagedExtensionStatus::Current {
            (
                status,
                false,
                Some(format!(
                    "OMP extension is not installed at {} (status: {})",
                    omp_install_dir, status
                )),
            )
        } else {
            (status, true, None)
        }
    };

    // 2. Codex paths
    let codex_notification_dir_buf = std::env::var("CODEX_HOME")
        .ok()
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .unwrap_or_else(|| home.join(".codex"));
    let codex_notification_dir = codex_notification_dir_buf.to_string_lossy().into_owned();

    let (codex_config_dir_buf, codex_resolve_err) = match q.codex_dir.as_deref().filter(|s| !s.trim().is_empty()) {
        Some(explicit) => match expand_and_validate_path(explicit, Some(&home)) {
            Ok(p) => (p, None),
            Err(e) => (codex_notification_dir_buf.clone(), Some(e.to_string())),
        },
        None => (codex_notification_dir_buf.clone(), None),
    };
    let codex_config_dir = codex_config_dir_buf.to_string_lossy().into_owned();

    let (codex_config_exists, codex_can_enable, codex_reason) = if let Some(err) = codex_resolve_err {
        (false, false, Some(err))
    } else {
        let config_file = codex_config_dir_buf.join("config.toml");
        let hooks_file = codex_config_dir_buf.join("hooks.json");
        let hooks_dir = codex_config_dir_buf.join("hooks");
        let exists = config_file.is_file() || hooks_file.is_file() || hooks_dir.is_dir();
        let paths_match = codex_config_dir_buf == codex_notification_dir_buf;
        if !paths_match {
            (
                exists,
                false,
                Some(format!(
                    "Configured Codex path ({}) does not match notification runtime path ({})",
                    codex_config_dir, codex_notification_dir
                )),
            )
        } else if !exists {
            (
                false,
                false,
                Some(format!(
                    "Codex config file not found (neither config.toml nor hooks.json exists at {})",
                    codex_config_dir
                )),
            )
        } else {
            (
                true,
                false,
                Some("Codex native hooks track status only; terminal alert notifications are not supported in this rollout".to_string()),
            )
        }
    };

    // 3. Claude paths
    let claude_notification_dir_buf = std::env::var("CLAUDE_CONFIG_DIR")
        .ok()
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .unwrap_or_else(|| home.join(".claude"));
    let claude_notification_dir = claude_notification_dir_buf.to_string_lossy().into_owned();

    let (claude_config_dir_buf, claude_resolve_err) = match q.claude_dir.as_deref().filter(|s| !s.trim().is_empty()) {
        Some(explicit) => match expand_and_validate_path(explicit, Some(&home)) {
            Ok(p) => (p, None),
            Err(e) => (claude_notification_dir_buf.clone(), Some(e.to_string())),
        },
        None => (claude_notification_dir_buf.clone(), None),
    };
    let claude_config_dir = claude_config_dir_buf.to_string_lossy().into_owned();

    let (claude_config_exists, claude_can_enable, claude_reason) = if let Some(err) = claude_resolve_err {
        (false, false, Some(err))
    } else {
        let settings_file = claude_config_dir_buf.join("settings.json");
        let exists = settings_file.is_file();
        let paths_match = claude_config_dir_buf == claude_notification_dir_buf;
        if !paths_match {
            (
                exists,
                false,
                Some(format!(
                    "Configured Claude path ({}) does not match notification runtime path ({})",
                    claude_config_dir, claude_notification_dir
                )),
            )
        } else {
            match check_native_integration_status(AgentKind::Claude, &claude_config_dir_buf) {
                Ok(report) => {
                    if report.readiness == ManagedReadinessStatus::Ready {
                        (exists, true, None)
                    } else {
                        (
                            exists,
                            false,
                            Some(format!(
                                "Claude native integration is not ready ({})",
                                report.readiness
                            )),
                        )
                    }
                }
                Err(e) => (
                    exists,
                    false,
                    Some(format!("Failed to verify Claude integration: {e}")),
                ),
            }
        }
    };

    Ok(Json(AgentPathsVerification {
        effective_home,
        omp_install_dir,
        omp_notification_dir,
        omp_status,
        omp_can_enable,
        omp_reason,
        codex_config_dir,
        codex_notification_dir,
        codex_config_exists,
        codex_can_enable,
        codex_reason,
        claude_config_dir: Some(claude_config_dir),
        claude_notification_dir: Some(claude_notification_dir),
        claude_config_exists: Some(claude_config_exists),
        claude_can_enable: Some(claude_can_enable),
        claude_reason,
    }))
}

/// Get current public agent status snapshot across all terminals.
pub async fn get_snapshot(State(state): State<AppState>) -> Json<AgentStatusSnapshotV1> {
    Json(state.agent_status.snapshot())
}

/// Check status of the managed OMP extension.
pub async fn get_omp_extension_status(
    Query(q): Query<ExtensionQuery>,
) -> Result<Json<ExtensionStatusReport>, ApiError> {
    let agent_dir = resolve_target_agent_dir(q.agent_dir.as_deref())
        .map_err(ApiError::from)?;
    let report = check_extension_status(&agent_dir).map_err(ApiError::from)?;
    Ok(Json(report))
}

/// Install or upgrade the managed OMP extension.
pub async fn install_omp_extension(
    Json(body): Json<ExtensionInstallBody>,
) -> Result<Json<ExtensionStatusReport>, ApiError> {
    let agent_dir = resolve_target_agent_dir(body.agent_dir.as_deref())
        .map_err(ApiError::from)?;

    if !agent_dir.exists() {
        std::fs::create_dir_all(&agent_dir)
            .map_err(|e| ApiError::from_app(IntegrationError::Io(e).into()))?;
    }

    let report = install_extension(&agent_dir).map_err(ApiError::from)?;
    Ok(Json(report))
}

/// Uninstall the managed OMP extension.
pub async fn uninstall_omp_extension(
    Query(q): Query<ExtensionQuery>,
) -> Result<Json<ExtensionStatusReport>, ApiError> {
    let agent_dir = resolve_target_agent_dir(q.agent_dir.as_deref())
        .map_err(ApiError::from)?;
    let report = uninstall_extension(&agent_dir).map_err(ApiError::from)?;
    Ok(Json(report))
}

/// Check status of a native agent integration (Codex, Claude).
pub async fn get_native_integration_status(
    AxumPath(agent): AxumPath<String>,
    Query(q): Query<ExtensionQuery>,
) -> Result<Json<NativeIntegrationStatusReport>, ApiError> {
    let agent_kind = parse_native_agent_kind(&agent)?;
    let target_dir = resolve_native_target_dir(agent_kind, q.agent_dir.as_deref())
        .map_err(ApiError::from)?;

    if !target_dir.is_dir() {
        let launcher_path = target_dir.join(MANAGED_LAUNCHER_SUBPATH);
        let manifest_path = target_dir.join(MANAGED_MANIFEST_SUBPATH);
        return Ok(Json(NativeIntegrationStatusReport {
            agent_kind,
            status: ManagedInstallationStatus::Absent,
            readiness: ManagedReadinessStatus::Unverified,
            target_path: launcher_path.clone(),
            launcher_path,
            manifest_path,
            config_path: None,
            version: None,
            bundled_version: MANAGED_ADAPTER_VERSION.to_string(),
            content_hash: None,
            bundled_hash: String::new(),
            details: Some("Agent directory does not exist".to_string()),
        }));
    }

    let report = check_native_integration_status(agent_kind, &target_dir)
        .map_err(ApiError::from)?;
    Ok(Json(report))
}

/// Install or upgrade a native agent integration (Codex, Claude).
pub async fn install_native_integration_handler(
    AxumPath(agent): AxumPath<String>,
    Json(body): Json<ExtensionInstallBody>,
) -> Result<Json<NativeIntegrationStatusReport>, ApiError> {
    let agent_kind = parse_native_agent_kind(&agent)?;
    let target_dir = resolve_native_target_dir(agent_kind, body.agent_dir.as_deref())
        .map_err(ApiError::from)?;

    if !target_dir.exists() {
        std::fs::create_dir_all(&target_dir)
            .map_err(|e| ApiError::from_app(IntegrationError::Io(e).into()))?;
    }

    let report = install_native_integration(agent_kind, &target_dir)
        .map_err(ApiError::from)?;
    Ok(Json(report))
}

/// Uninstall a native agent integration (Codex, Claude).
pub async fn uninstall_native_integration_handler(
    AxumPath(agent): AxumPath<String>,
    Query(q): Query<ExtensionQuery>,
) -> Result<Json<NativeIntegrationStatusReport>, ApiError> {
    let agent_kind = parse_native_agent_kind(&agent)?;
    let target_dir = resolve_native_target_dir(agent_kind, q.agent_dir.as_deref())
        .map_err(ApiError::from)?;

    if !target_dir.is_dir() {
        let launcher_path = target_dir.join(MANAGED_LAUNCHER_SUBPATH);
        let manifest_path = target_dir.join(MANAGED_MANIFEST_SUBPATH);
        return Ok(Json(NativeIntegrationStatusReport {
            agent_kind,
            status: ManagedInstallationStatus::Absent,
            readiness: ManagedReadinessStatus::Unverified,
            target_path: launcher_path.clone(),
            launcher_path,
            manifest_path,
            config_path: None,
            version: None,
            bundled_version: MANAGED_ADAPTER_VERSION.to_string(),
            content_hash: None,
            bundled_hash: String::new(),
            details: None,
        }));
    }

    let report = uninstall_native_integration(agent_kind, &target_dir)
        .map_err(ApiError::from)?;
    Ok(Json(report))
}
