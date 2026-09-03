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
