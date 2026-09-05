//! User account information and system identity verification via libc.

use super::error::ReleaseError;
use std::ffi::CString;

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

/// Verify that the API service account exists and is not root.
pub fn verify_api_service_account(username: &str) -> Result<UserInfo, ReleaseError> {
    let trimmed = username.trim();
    if trimmed.is_empty() {
        return Err(ReleaseError::Config("service user cannot be empty".into()));
    }
    let user = get_user_by_name(trimmed)
        .ok_or_else(|| ReleaseError::Config(format!("system user '{trimmed}' does not exist")))?;

    if user.uid == 0 || trimmed == "root" {
        return Err(ReleaseError::Config(format!(
            "service user '{trimmed}' cannot be root (UID 0)"
        )));
    }

    Ok(user)
}

/// Ensure the requested service user exists, creating it as a system user if root and missing.
pub fn ensure_or_verify_service_user(username: &str) -> Result<UserInfo, ReleaseError> {
    if let Some(_user) = get_user_by_name(username) {
        return verify_api_service_account(username);
    }
    #[cfg(unix)]
    if unsafe { libc::geteuid() } == 0 {
        eprintln!(
            "User '{username}' does not exist. Creating dedicated system user '{username}'..."
        );
        let res = std::process::Command::new("useradd")
            .args([
                "--system",
                "--shell",
                "/usr/sbin/nologin",
                "--home-dir",
                &format!("/var/lib/{username}"),
                "--create-home",
                username,
            ])
            .output();
        if let Ok(output) = res {
            if output.status.success() {
                eprintln!("Successfully created system user '{username}'.");
            }
        }
        if get_user_by_name(username).is_none() {
            let _ = std::process::Command::new("useradd")
                .args(["--system", "--create-home", username])
                .output();
        }
    }
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

    let sudo_user = std::env::var("SUDO_USER")
        .ok()
        .filter(|u| !u.trim().is_empty());
    let default_candidate = if let Some(su) = &sudo_user {
        if su != "root" && get_user_by_name(su).map(|u| u.uid != 0).unwrap_or(false) {
            Some(su.clone())
        } else {
            None
        }
    } else {
        None
    };

    let default_user = default_candidate.or_else(|| {
        if get_user_by_name("dam-hopper")
            .map(|u| u.uid != 0)
            .unwrap_or(false)
        {
            Some("dam-hopper".to_string())
        } else {
            None
        }
    });

    use std::io::IsTerminal;
    if std::io::stdin().is_terminal() && !non_interactive {
        let prompt_default = default_user.as_deref().unwrap_or("dam-hopper");
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
