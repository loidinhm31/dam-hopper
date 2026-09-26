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
/// Ensure the shared socket group exists and never resolves to root.
pub fn ensure_plugin_shared_group() -> Result<(), ReleaseError> {
    let name = super::constants::PLUGIN_SHARED_GROUP;
    if get_group_gid_by_name(name).is_none() {
        run_account_command("groupadd", &["-r", name])?;
    }
    match get_group_gid_by_name(name) {
        Some(gid) if gid != 0 => Ok(()),
        _ => Err(ReleaseError::Config(format!(
            "required plugin shared group '{name}' must resolve to a non-root GID"
        ))),
    }
}

fn run_account_command(program: &str, args: &[&str]) -> Result<(), ReleaseError> {
    let output = std::process::Command::new(program)
        .args(args)
        .output()
        .map_err(|error| ReleaseError::Io {
            action: "execute plugin account provisioning",
            details: format!("{program}: {error}"),
        })?;
    if !output.status.success() {
        return Err(ReleaseError::Config(format!(
            "{program} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(())
}

/// Only the implicit default account is manager-created. Explicit owners are
/// verified without changing their home, primary group, or supplementary groups.
pub fn ensure_plugin_runner_account(
    owner: Option<&str>,
    api_user: &str,
) -> Result<UserInfo, ReleaseError> {
    if let Some(owner) = owner {
        return verify_plugin_owner_account(owner, Some(api_user));
    }
    let owner = "dam-hopper-plugin-runner";
    ensure_plugin_shared_group()?;
    if get_user_by_name(owner).is_none() {
        run_account_command(
            "useradd",
            &[
                "-r",
                "-M",
                "-s",
                "/sbin/nologin",
                "-d",
                super::constants::DEFAULT_RUNNER_STATE_DIR,
                "-g",
                super::constants::PLUGIN_SHARED_GROUP,
                owner,
            ],
        )?;
    }
    let info = verify_api_service_account(owner)?;
    if info.home != super::constants::DEFAULT_RUNNER_STATE_DIR
        || ![
            "/sbin/nologin",
            "/usr/sbin/nologin",
            "/bin/false",
            "/usr/bin/false",
        ]
        .contains(&info.shell.as_str())
        || get_user_by_name(api_user).is_some_and(|api| api.uid == info.uid)
        || get_user_by_name(super::constants::WEB_SERVICE_IDENTITY)
            .is_some_and(|web| web.uid == info.uid)
    {
        return Err(ReleaseError::Config(
            "default plugin runner account has unsafe identity, home, or shell".into(),
        ));
    }
    provision_runner_state(
        std::path::Path::new(super::constants::DEFAULT_RUNNER_STATE_DIR),
        &info,
    )?;
    verify_plugin_owner_account(owner, Some(api_user))
}

/// Provision only runner-owned state, never a custom owner's home or account.
pub fn ensure_plugin_runner_state(owner: &str, api_user: &str) -> Result<(), ReleaseError> {
    let info = verify_plugin_owner_account(owner, Some(api_user))?;
    ensure_plugin_shared_group()?;
    provision_runner_state(
        std::path::Path::new(super::constants::DEFAULT_RUNNER_STATE_DIR),
        &info,
    )
}

fn provision_runner_state(path: &std::path::Path, info: &UserInfo) -> Result<(), ReleaseError> {
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    let io_error = |error: std::io::Error| ReleaseError::Io {
        action: "provision plugin runner state directory",
        details: format!("{}: {error}", path.display()),
    };
    // Walk every ancestor through pinned descriptors; owner-controlled symlinks
    // must never turn root provisioning into chmod/chown of an unrelated path.
    let mut dir = std::fs::File::open("/").map_err(io_error)?;
    let mut components = path.components().peekable();
    while let Some(component) = components.next() {
        let std::path::Component::Normal(name) = component else {
            if matches!(component, std::path::Component::RootDir) {
                continue;
            }
            return Err(ReleaseError::Config("invalid runner state path".into()));
        };
        use std::os::unix::ffi::OsStrExt;
        let name = CString::new(name.as_bytes())
            .map_err(|_| ReleaseError::Config("runner state path contains NUL".into()))?;
        let managed = components.peek().is_none();
        let created = if managed {
            let result = unsafe { libc::mkdirat(dir.as_raw_fd(), name.as_ptr(), 0o700) };
            if result != 0 {
                let error = std::io::Error::last_os_error();
                if error.kind() != std::io::ErrorKind::AlreadyExists {
                    return Err(io_error(error));
                }
            }
            result == 0
        } else {
            false
        };
        let fd = unsafe {
            libc::openat(
                dir.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(io_error(std::io::Error::last_os_error()));
        }
        dir = unsafe { std::fs::File::from_raw_fd(fd) };
        let meta = dir.metadata().map_err(io_error)?;
        if !managed {
            if meta.uid() != 0 || meta.mode() & 0o022 != 0 {
                return Err(ReleaseError::Config("unsafe runner state ancestor".into()));
            }
            continue;
        }
        if !created && (meta.uid() != info.uid || meta.gid() != info.gid) {
            return Err(ReleaseError::Config(format!(
                "runner state '{}' ownership differs from selected owner; migrate it explicitly",
                path.display()
            )));
        }
        if created && unsafe { libc::fchown(dir.as_raw_fd(), info.uid, info.gid) } != 0 {
            return Err(io_error(std::io::Error::last_os_error()));
        }
        dir.set_permissions(std::fs::Permissions::from_mode(0o700))
            .map_err(io_error)?;
    }
    // The runner creates its registry children itself. Do not recursively chown
    // existing packages, and do not follow an owner-controlled plugins symlink.
    dir.sync_all().map_err(io_error)
}

/// Publish the explicit administrator allowlist, including empty deny-all policy.
pub fn sync_plugin_admins_file(
    admins_file: &std::path::Path,
    admin_subjects: &[String],
) -> Result<(), ReleaseError> {
    let json_content = serde_json::json!({ "adminSubjects": admin_subjects });
    super::durable_fs::atomic_write_json(admins_file, &json_content, Some(0o644))
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

    let user = get_user_by_name(trimmed).ok_or_else(|| {
        ReleaseError::Config(format!("plugin owner user '{trimmed}' does not exist"))
    })?;

    if user.uid == 0 {
        return Err(ReleaseError::Config(format!(
            "plugin owner user '{trimmed}' cannot be root (UID 0)"
        )));
    }

    if get_user_by_name(super::constants::WEB_SERVICE_IDENTITY)
        .is_some_and(|web| web.uid == user.uid)
    {
        return Err(ReleaseError::Config(format!(
            "plugin owner user '{trimmed}' cannot share the web service UID"
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

    let disallowed_homes = [
        "/",
        "/root",
        "/tmp",
        "/var/tmp",
        "/dev/null",
        "/nonexistent",
    ];
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

    let resolved_home = std::fs::canonicalize(home_path).map_err(|error| {
        ReleaseError::Config(format!("cannot resolve plugin owner home: {error}"))
    })?;
    if disallowed_homes
        .iter()
        .any(|path| resolved_home == std::path::Path::new(path))
    {
        return Err(ReleaseError::Config(
            "plugin owner home resolves to an unsafe or restricted directory".into(),
        ));
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

#[cfg(test)]
mod provisioning_tests {
    use super::*;

    #[test]
    fn admin_policy_escapes_subjects_and_revokes_previous_grants() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("plugin-admins.json");
        let subjects = vec!["subject\"with\\escapes\n".to_string()];
        sync_plugin_admins_file(&path, &subjects).unwrap();
        let json: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(json["adminSubjects"], serde_json::json!(subjects));
        sync_plugin_admins_file(&path, &[]).unwrap();
        let json: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(json["adminSubjects"], serde_json::json!([]));
    }

    #[test]
    fn admin_policy_reports_publication_failure() {
        let root = tempfile::tempdir().unwrap();
        let parent = root.path().join("not-a-directory");
        std::fs::write(&parent, b"preserve").unwrap();
        assert!(sync_plugin_admins_file(&parent.join("plugin-admins.json"), &[]).is_err());
        assert_eq!(std::fs::read(parent).unwrap(), b"preserve");
    }
}
