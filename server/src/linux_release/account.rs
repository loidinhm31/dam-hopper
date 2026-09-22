//! User account information and system identity verification via libc.

use super::constants::DEFAULT_API_SERVICE_USER;
use super::error::ReleaseError;
use super::unit_parser::ParsedUnit;
use std::ffi::CString;

/// Concrete API runtime identity resolved from a finalized systemd unit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiRuntimeIdentity {
    pub user: String,
    pub group: String,
    pub uid: u32,
    pub gid: u32,
}

/// Resolve exactly one non-root User=/Group= pair from a finalized API unit.
pub fn resolve_api_runtime_identity(unit: &ParsedUnit) -> Result<ApiRuntimeIdentity, ReleaseError> {
    let users = unit.get_all_values("Service", "User");
    let groups = unit.get_all_values("Service", "Group");
    if users.len() != 1 || groups.len() != 1 {
        return Err(ReleaseError::Config(format!(
            "API unit requires exactly one User= and one Group= directive (got {} and {})",
            users.len(),
            groups.len()
        )));
    }
    let user = users[0].trim();
    let group = groups[0].trim();
    if user.is_empty() || group.is_empty() || user == "root" || group == "root" {
        return Err(ReleaseError::Config(
            "API unit runtime identity must be non-root".into(),
        ));
    }
    let user_info = verify_api_service_account(user)?;
    let gid = get_group_gid_by_name(group).ok_or_else(|| {
        ReleaseError::Config(format!("API unit Group='{group}' does not resolve"))
    })?;
    if gid == 0 || gid != user_info.gid {
        return Err(ReleaseError::Config(format!(
            "API unit Group='{group}' is not User='{user}' primary group"
        )));
    }
    Ok(ApiRuntimeIdentity {
        user: user.to_string(),
        group: group.to_string(),
        uid: user_info.uid,
        gid,
    })
}

/// Resolved user account information from libc passwd database.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserInfo {
    pub uid: u32,
    pub gid: u32,
    pub home: String,
    pub shell: String,
}

/// Retrieve user account information by username.
pub fn get_user_by_name(username: &str) -> Option<UserInfo> {
    let c_name = CString::new(username).ok()?;
    let pwd = unsafe { libc::getpwnam(c_name.as_ptr()) };
    if pwd.is_null() {
        return None;
    }
    let pwd_ref = unsafe { &*pwd };
    let home = unsafe {
        std::ffi::CStr::from_ptr(pwd_ref.pw_dir)
            .to_string_lossy()
            .into_owned()
    };
    let shell = unsafe {
        std::ffi::CStr::from_ptr(pwd_ref.pw_shell)
            .to_string_lossy()
            .into_owned()
    };

    Some(UserInfo {
        uid: pwd_ref.pw_uid,
        gid: pwd_ref.pw_gid,
        home,
        shell,
    })
}

/// Verify that the dedicated web system user satisfies security constraints.
pub fn verify_web_sysuser_account(username: &str) -> Result<UserInfo, ReleaseError> {
    let user = get_user_by_name(username).ok_or_else(|| ReleaseError::SysusersFailed {
        reason: format!("system user '{username}' does not exist"),
    })?;

    if user.uid == 0 {
        return Err(ReleaseError::SysusersFailed {
            reason: format!("user '{username}' must not be root (uid 0)"),
        });
    }

    let valid_shells = [
        "/sbin/nologin",
        "/usr/sbin/nologin",
        "/bin/false",
        "/usr/bin/false",
    ];
    if !valid_shells.contains(&user.shell.as_str()) {
        return Err(ReleaseError::SysusersFailed {
            reason: format!(
                "user '{username}' shell must be non-login (e.g. /sbin/nologin), got '{}'",
                user.shell
            ),
        });
    }

    if !user.home.starts_with("/nonexistent") && user.home != "/dev/null" && user.home != "/" {
        return Err(ReleaseError::SysusersFailed {
            reason: format!(
                "user '{username}' home must be nonexistent or restricted, got '{}'",
                user.home
            ),
        });
    }

    Ok(user)
}

/// Retrieve group name by GID.
pub fn get_group_by_gid(gid: u32) -> Option<String> {
    let grp = unsafe { libc::getgrgid(gid) };
    if grp.is_null() {
        return None;
    }
    let grp_ref = unsafe { &*grp };
    Some(unsafe {
        std::ffi::CStr::from_ptr(grp_ref.gr_name)
            .to_string_lossy()
            .into_owned()
    })
}
/// Retrieve group ID by name.
pub fn get_group_gid_by_name(groupname: &str) -> Option<u32> {
    let c_name = CString::new(groupname).ok()?;
    let grp = unsafe { libc::getgrnam(c_name.as_ptr()) };
    if grp.is_null() {
        return None;
    }
    Some(unsafe { (*grp).gr_gid })
}

/// Verify that the API service account exists, has a primary group, and is not root.
pub fn verify_api_service_account(username: &str) -> Result<UserInfo, ReleaseError> {
    let trimmed = username.trim();
    if trimmed.is_empty() {
        return Err(ReleaseError::Config("service user cannot be empty".into()));
    }
    let user = get_user_by_name(trimmed)
        .ok_or_else(|| ReleaseError::Config(format!("system user '{trimmed}' does not exist")))?;
    if trimmed == "root" || user.uid == 0 {
        return Err(ReleaseError::Config(format!(
            "service user '{trimmed}' cannot be root (UID 0)"
        )));
    }
    if user.gid == 0 || get_group_by_gid(user.gid).is_none() {
        return Err(ReleaseError::Config(format!(
            "service user '{trimmed}' has no valid non-root primary group"
        )));
    }
    Ok(user)
}

/// Verify an explicitly selected API service user; never creates or repairs accounts.
pub fn ensure_or_verify_service_user(username: &str) -> Result<UserInfo, ReleaseError> {
    verify_api_service_account(username)
}

/// Interactively prompt or automatically resolve the service user for dam-hopper-api.
pub fn resolve_service_user(
    explicit: Option<&str>,
    non_interactive: bool,
) -> Result<String, ReleaseError> {
    if let Some(user) = explicit {
        let trimmed = user.trim();
        ensure_or_verify_service_user(trimmed)?;
        return Ok(trimmed.to_string());
    }

    let default_user = if get_user_by_name(DEFAULT_API_SERVICE_USER)
        .map(|u| u.uid != 0 && u.gid != 0)
        .unwrap_or(false)
    {
        Some(DEFAULT_API_SERVICE_USER.to_string())
    } else {
        None
    };

    use std::io::IsTerminal;
    if std::io::stdin().is_terminal() && !non_interactive {
        let prompt_default = default_user.as_deref().ok_or_else(|| {
            ReleaseError::Config(
                "default API service user is unavailable; specify --service-user".into(),
            )
        })?;
        eprintln!("Select the system user to run dam-hopper-api (cannot be root):");
        eprint!("Service user [{prompt_default}]: ");
        use std::io::Write;
        let _ = std::io::stderr().flush();

        let mut input = String::new();
        std::io::stdin()
            .read_line(&mut input)
            .map_err(|e| ReleaseError::Io {
                action: "read service user from stdin",
                details: e.to_string(),
            })?;
        let chosen = input.trim();
        let final_user = if chosen.is_empty() {
            prompt_default
        } else {
            chosen
        };
        ensure_or_verify_service_user(final_user)?;
        Ok(final_user.to_string())
    } else if let Some(user) = default_user {
        ensure_or_verify_service_user(&user)?;
        Ok(user)
    } else {
        Err(ReleaseError::Config(
            "service user must be specified via --service-user in non-interactive mode (cannot be root)".into()
        ))
    }
}

/// Verify that the plugin owner user satisfies security constraints:
/// - Exists in libc database
/// - Not root (UID 0)
/// - Not matching the API service user
/// - Not matching the web service identity
/// - Has a valid non-root primary group
/// - Has a safe, existing, non-root, non-world-writable home directory
pub fn verify_plugin_owner_account(
    owner_username: &str,
    api_username: Option<&str>,
) -> Result<UserInfo, ReleaseError> {
    let trimmed = owner_username.trim();
    if trimmed.is_empty() {
        return Err(ReleaseError::Config(
            "plugin owner user cannot be empty".into(),
        ));
    }

    if trimmed == "root" {
        return Err(ReleaseError::Config(
            "plugin owner user 'root' cannot be root (UID 0)".into(),
        ));
    }

    if trimmed == super::constants::WEB_SERVICE_IDENTITY {
        return Err(ReleaseError::Config(format!(
            "plugin owner user '{trimmed}' cannot be the web service user ('{}')",
            super::constants::WEB_SERVICE_IDENTITY
        )));
    }

    if let Some(api_user) = api_username {
        if trimmed == api_user.trim() {
            return Err(ReleaseError::Config(format!(
                "plugin owner user '{trimmed}' cannot be the API service user ('{api_user}')"
            )));
        }
    }

    let user = get_user_by_name(trimmed)
        .ok_or_else(|| ReleaseError::Config(format!("plugin owner user '{trimmed}' does not exist")))?;

    if user.uid == 0 {
        return Err(ReleaseError::Config(format!(
            "plugin owner user '{trimmed}' cannot be root (UID 0)"
        )));
    }

    if let Some(api_user) = api_username {
        if let Some(api_info) = get_user_by_name(api_user.trim()) {
            if user.uid == api_info.uid {
                return Err(ReleaseError::Config(format!(
                    "plugin owner user '{trimmed}' cannot share UID {} with API service user '{api_user}'",
                    user.uid
                )));
            }
        }
    }

    if user.gid == 0 || get_group_by_gid(user.gid).is_none() {
        return Err(ReleaseError::Config(format!(
            "plugin owner user '{trimmed}' has no valid non-root primary group"
        )));
    }

    let home_path = std::path::Path::new(&user.home);
    if !home_path.is_absolute() {
        return Err(ReleaseError::Config(format!(
            "plugin owner user '{trimmed}' home directory must be an absolute path, got '{}'",
            user.home
        )));
    }

    let disallowed_homes = ["/", "/root", "/tmp", "/var/tmp", "/dev/null", "/nonexistent"];
    if disallowed_homes.contains(&user.home.as_str()) {
        return Err(ReleaseError::Config(format!(
            "plugin owner user '{trimmed}' has unsafe or restricted home directory '{}'",
            user.home
        )));
    }

    let meta = std::fs::symlink_metadata(home_path).map_err(|e| {
        ReleaseError::Config(format!(
            "plugin owner user '{trimmed}' home directory '{}' is inaccessible: {e}",
            user.home
        ))
    })?;

    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err(ReleaseError::Config(format!(
            "plugin owner user '{trimmed}' home directory '{}' must be a regular directory",
            user.home
        )));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = meta.permissions().mode();
        if mode & 0o002 != 0 {
            return Err(ReleaseError::Config(format!(
                "plugin owner user '{trimmed}' home directory '{}' must not be world-writable (mode {:o})",
                user.home, mode
            )));
        }
    }

    Ok(user)
}
