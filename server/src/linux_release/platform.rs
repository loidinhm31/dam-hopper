//! Target platform and host profile verification for Fedora 44.

use super::constants::{
    PROFILE_ARCH, PROFILE_GLIBC_MIN, PROFILE_OS_ID, PROFILE_OS_VERSION, PROFILE_SYSTEMD_MIN,
};
use super::error::ReleaseError;
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

/// Parsed fields from `/etc/os-release`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OsRelease {
    pub id: String,
    pub version_id: String,
}

/// Parse an `os-release` formatted file content.
pub fn parse_os_release(content: &str) -> OsRelease {
    let mut map = HashMap::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = trimmed.split_once('=') {
            let key = k.trim();
            let mut val = v.trim();
            if ((val.starts_with('"') && val.ends_with('"'))
                || (val.starts_with('\'') && val.ends_with('\'')))
                && val.len() >= 2
            {
                val = &val[1..val.len() - 1];
            }
            map.insert(key.to_string(), val.to_string());
        }
    }

    OsRelease {
        id: map.remove("ID").unwrap_or_default(),
        version_id: map.remove("VERSION_ID").unwrap_or_default(),
    }
}

/// Verify that the OS is Fedora 44.
pub fn verify_os_release(os: &OsRelease) -> Result<(), ReleaseError> {
    if os.id != PROFILE_OS_ID {
        return Err(ReleaseError::UnsupportedOs {
            expected: PROFILE_OS_ID.to_string(),
            got: os.id.clone(),
        });
    }
    if os.version_id != PROFILE_OS_VERSION {
        return Err(ReleaseError::UnsupportedOsVersion {
            expected: PROFILE_OS_VERSION.to_string(),
            got: os.version_id.clone(),
        });
    }
    Ok(())
}

/// Verify target architecture.
pub fn verify_arch(arch: &str) -> Result<(), ReleaseError> {
    if arch != PROFILE_ARCH {
        return Err(ReleaseError::UnsupportedArch {
            expected: PROFILE_ARCH.to_string(),
            got: arch.to_string(),
        });
    }
    Ok(())
}

/// Parse and compare glibc versions (e.g. "2.43" >= "2.43").
pub fn verify_glibc_version(version_str: &str) -> Result<(), ReleaseError> {
    let parse_ver = |s: &str| -> Option<(u32, u32)> {
        let mut parts = s.split('.');
        let major = parts.next()?.parse::<u32>().ok()?;
        let minor = parts.next()?.parse::<u32>().ok()?;
        Some((major, minor))
    };

    let actual = parse_ver(version_str).ok_or_else(|| ReleaseError::GlibcVersionTooLow {
        expected: PROFILE_GLIBC_MIN.to_string(),
        got: version_str.to_string(),
    })?;

    let expected = parse_ver(PROFILE_GLIBC_MIN).expect("valid constant");

    if actual < expected {
        return Err(ReleaseError::GlibcVersionTooLow {
            expected: PROFILE_GLIBC_MIN.to_string(),
            got: version_str.to_string(),
        });
    }

    Ok(())
}

/// Query runtime glibc version via libc on GNU targets.
#[cfg(target_env = "gnu")]
pub fn get_runtime_glibc_version() -> Option<String> {
    unsafe {
        let ptr = libc::gnu_get_libc_version();
        if ptr.is_null() {
            None
        } else {
            let cstr = std::ffi::CStr::from_ptr(ptr);
            cstr.to_str().ok().map(|s| s.to_string())
        }
    }
}

#[cfg(not(target_env = "gnu"))]
pub fn get_runtime_glibc_version() -> Option<String> {
    None
}

/// Parse systemd version number from `systemctl --version` output.
pub fn parse_systemd_version(output: &str) -> Option<u32> {
    let first_line = output.lines().next()?.trim();
    let mut parts = first_line.split_whitespace();
    if parts.next()? != "systemd" {
        return None;
    }
    let ver_str = parts.next()?;
    ver_str.parse::<u32>().ok()
}

/// Verify that systemd version meets the minimum requirement.
pub fn verify_systemd_version(version: u32) -> Result<(), ReleaseError> {
    if version < PROFILE_SYSTEMD_MIN {
        return Err(ReleaseError::SystemdVersionTooLow {
            expected: PROFILE_SYSTEMD_MIN,
            got: version,
        });
    }
    Ok(())
}

/// Check if systemd is booted and running as system manager (PID 1).
pub fn is_systemd_booted() -> bool {
    Path::new("/run/systemd/system").exists()
}

/// Query actual systemd version by executing `systemctl --version`.
pub fn get_runtime_systemd_version() -> Option<u32> {
    let output = Command::new("systemctl").arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    parse_systemd_version(&text)
}

/// Comprehensive host profile verification for the target system.
pub fn verify_host_platform() -> Result<(), ReleaseError> {
    let os_release_content = std::fs::read_to_string("/etc/os-release")
        .map_err(|e| ReleaseError::Config(format!("failed to read /etc/os-release: {e}")))?;
    let os = parse_os_release(&os_release_content);
    verify_os_release(&os)?;

    verify_arch(std::env::consts::ARCH)?;

    let glibc_ver =
        get_runtime_glibc_version().ok_or_else(|| ReleaseError::GlibcVersionTooLow {
            expected: PROFILE_GLIBC_MIN.to_string(),
            got: "unknown".to_string(),
        })?;
    verify_glibc_version(&glibc_ver)?;

    if !is_systemd_booted() {
        return Err(ReleaseError::SystemdNotActive);
    }

    let sysd_ver =
        get_runtime_systemd_version().ok_or(ReleaseError::SystemdVersionTooLow {
            expected: PROFILE_SYSTEMD_MIN,
            got: 0,
        })?;
    verify_systemd_version(sysd_ver)?;

    Ok(())
}
