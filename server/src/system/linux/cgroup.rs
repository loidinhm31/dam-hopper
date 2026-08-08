use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

use crate::system::{
    platform::{read_bounded_text, HostResourceSource},
    Availability, CgroupMemory, MemoryPressure,
};

pub fn collect(source: &impl HostResourceSource, sampled_at: u64) -> Vec<CgroupMemory> {
    let mountinfo_path = source.proc_root().join("self/mountinfo");
    let mountinfo = match read_bounded_text(&mountinfo_path) {
        Ok(value) => value,
        Err(error) => {
            return vec![degraded(
                sampled_at,
                read_error_code(error),
                error_availability(sampled_at, error),
            )]
        }
    };
    let Some(mount) = discover_v2_mount(&mountinfo) else {
        return vec![degraded(
            sampled_at,
            "cgroupV2Unsupported",
            Availability::unsupported(sampled_at),
        )];
    };
    let mount_point = Path::new(&mount);
    let resolved_mount_root = source.cgroup_mount_root(mount_point);
    if !validate_mount_root(source.cgroup_root(), mount_point, &resolved_mount_root) {
        return vec![degraded(
            sampled_at,
            "cgroupRootInvalid",
            Availability::unavailable(sampled_at, "cgroupRootInvalid"),
        )];
    }
    let membership_input = match read_bounded_text(&source.proc_root().join("self/cgroup")) {
        Ok(value) => value,
        Err(error) => {
            return vec![degraded(
                sampled_at,
                "cgroupMembershipUnavailable",
                membership_error_availability(sampled_at, error),
            )]
        }
    };
    let Some(membership) = discover_membership(&membership_input) else {
        return vec![degraded(
            sampled_at,
            "cgroupMembershipMalformed",
            Availability::unavailable(sampled_at, "cgroupMembershipMalformed"),
        )];
    };
    let Some(path) = resolve_cgroup_path(source.cgroup_root(), &mount, &membership) else {
        return vec![degraded(
            sampled_at,
            "cgroupMembershipInvalid",
            Availability::unavailable(sampled_at, "cgroupMembershipInvalid"),
        )];
    };
    if !path.is_dir() {
        return vec![degraded(
            sampled_at,
            "cgroupPathUnavailable",
            Availability::unavailable(sampled_at, "cgroupPathUnavailable"),
        )];
    }
    vec![read_cgroup(&path, &membership, sampled_at)]
}

pub fn discover_v2_mount(input: &str) -> Option<String> {
    input.lines().find_map(|line| {
        let (before, after) = line.split_once(" - ")?;
        if after.split_ascii_whitespace().next()? != "cgroup2" {
            return None;
        }
        before.split_ascii_whitespace().nth(4).map(unescape_mount)
    })
}

pub fn discover_membership(input: &str) -> Option<String> {
    input.lines().find_map(|line| {
        let membership = line.strip_prefix("0::")?.trim();
        (!membership.is_empty() && membership.starts_with('/')).then(|| membership.into())
    })
}

fn validate_mount_root(root: &Path, mount_point: &Path, resolved_mount_root: &Path) -> bool {
    if !mount_point.is_absolute() || !root.is_dir() || !resolved_mount_root.is_dir() {
        return false;
    }
    same_directory(root, resolved_mount_root)
}

fn same_directory(left: &Path, right: &Path) -> bool {
    if left == right {
        return true;
    }
    let Ok(left) = std::fs::metadata(left) else {
        return false;
    };
    let Ok(right) = std::fs::metadata(right) else {
        return false;
    };
    left.dev() == right.dev() && left.ino() == right.ino()
}

fn resolve_cgroup_path(root: &Path, mount: &str, membership: &str) -> Option<PathBuf> {
    if !Path::new(mount).is_absolute() || !root.is_dir() || !membership.starts_with('/') {
        return None;
    }
    let relative = Path::new(membership.trim_start_matches('/'));
    relative
        .components()
        .all(|component| {
            matches!(
                component,
                std::path::Component::Normal(_) | std::path::Component::CurDir
            )
        })
        .then(|| root.join(relative))
}

fn read_cgroup(path: &Path, membership: &str, sampled_at: u64) -> CgroupMemory {
    let read = |name: &str| bounded(path.join(name));
    let current_bytes = read("memory.current").and_then(|value| parse_limit(&value).0);
    let (max_bytes, max_unlimited) = read("memory.max")
        .map(|value| parse_limit(&value))
        .unwrap_or((None, false));
    let (high_bytes, high_unlimited) = read("memory.high")
        .map(|value| parse_limit(&value))
        .unwrap_or((None, false));
    let stat = read("memory.stat")
        .map(|value| parse_counters(&value))
        .unwrap_or_default();
    let events = read("memory.events")
        .map(|value| parse_counters(&value).into_iter().collect())
        .unwrap_or_default();
    let pressure = read_pressure(&path.join("memory.pressure"), sampled_at);
    let availability = if current_bytes.is_some() {
        Availability::available(sampled_at)
    } else if path.exists() {
        Availability::unavailable(sampled_at, "cgroupMemoryUnavailable")
    } else {
        Availability::unsupported(sampled_at)
    };
    CgroupMemory {
        path: membership.to_string(),
        namespace: "cgroupV2".into(),
        current_bytes,
        max_bytes,
        max_unlimited,
        high_bytes,
        high_unlimited,
        file_cache_bytes: stat.get("file").copied(),
        events,
        pressure,
        availability,
    }
}

fn read_pressure(path: &Path, sampled_at: u64) -> MemoryPressure {
    match read_bounded_text(path) {
        Ok(value) => match super::psi::parse(&value) {
            Ok((some, full)) => MemoryPressure {
                some,
                full,
                availability: Availability::available(sampled_at),
            },
            Err(code) => MemoryPressure::unavailable(sampled_at, code),
        },
        Err(crate::system::platform::ReadTextError::Io(std::io::ErrorKind::NotFound)) => {
            MemoryPressure::unsupported(sampled_at)
        }
        Err(crate::system::platform::ReadTextError::Io(std::io::ErrorKind::PermissionDenied)) => {
            MemoryPressure::denied(sampled_at)
        }
        Err(_) => MemoryPressure::unavailable(sampled_at, "cgroupPsiUnavailable"),
    }
}

fn degraded(
    _sampled_at: u64,
    detail_code: &'static str,
    availability: Availability,
) -> CgroupMemory {
    CgroupMemory {
        path: String::new(),
        namespace: "cgroupV2".into(),
        current_bytes: None,
        max_bytes: None,
        max_unlimited: false,
        high_bytes: None,
        high_unlimited: false,
        file_cache_bytes: None,
        events: Vec::new(),
        pressure: MemoryPressure {
            some: None,
            full: None,
            availability: availability.clone(),
        },
        availability: Availability {
            detail_code: Some(detail_code.into()),
            ..availability
        },
    }
}

fn read_error_code(error: crate::system::platform::ReadTextError) -> &'static str {
    match error {
        crate::system::platform::ReadTextError::TooLarge => "cgroupMountInfoTooLarge",
        crate::system::platform::ReadTextError::InvalidUtf8 => "cgroupMountInfoInvalidUtf8",
        crate::system::platform::ReadTextError::Io(_) => "cgroupMountInfoUnavailable",
    }
}

fn error_availability(
    sampled_at: u64,
    error: crate::system::platform::ReadTextError,
) -> Availability {
    match error {
        crate::system::platform::ReadTextError::Io(std::io::ErrorKind::PermissionDenied) => {
            Availability::denied(sampled_at)
        }
        _ => Availability::unavailable(sampled_at, read_error_code(error)),
    }
}

fn membership_error_availability(
    sampled_at: u64,
    error: crate::system::platform::ReadTextError,
) -> Availability {
    match error {
        crate::system::platform::ReadTextError::Io(std::io::ErrorKind::PermissionDenied) => {
            Availability::denied(sampled_at)
        }
        _ => Availability::unavailable(sampled_at, "cgroupMembershipUnavailable"),
    }
}

fn bounded(path: PathBuf) -> Option<String> {
    read_bounded_text(&path).ok()
}
fn parse_limit(value: &str) -> (Option<u64>, bool) {
    let value = value.trim();
    if value == "max" {
        (None, true)
    } else {
        (value.parse().ok(), false)
    }
}
fn parse_counters(input: &str) -> BTreeMap<String, u64> {
    input
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_ascii_whitespace();
            let key = fields.next()?;
            let value = fields.next()?;
            Some((key.to_string(), value.parse().ok()?))
        })
        .collect()
}
fn unescape_mount(value: &str) -> String {
    value.replace("\\040", " ").replace("\\011", "\t")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovers_cgroup2_and_membership() {
        assert_eq!(
            discover_v2_mount(include_str!("../fixtures/linux/cgroup-v2/mountinfo.txt")),
            Some("/sys/fs/cgroup".into())
        );
        assert_eq!(
            discover_membership("0::/user.slice/app"),
            Some("/user.slice/app".into())
        );
    }

    #[test]
    fn rejects_invalid_membership_and_mount_roots() {
        assert_eq!(discover_membership("0::relative"), None);
        assert!(resolve_cgroup_path(Path::new("/tmp"), "/sys/fs/cgroup", "/ok").is_some());
        assert!(resolve_cgroup_path(Path::new("/tmp"), "relative", "/ok").is_none());
        assert!(resolve_cgroup_path(Path::new("/tmp"), "/sys/fs/cgroup", "/../escape").is_none());
        assert!(!validate_mount_root(
            Path::new("/tmp"),
            Path::new("/sys/fs/cgroup"),
            Path::new("/var")
        ));
    }

    #[test]
    fn permission_denied_membership_is_explicitly_degraded() {
        let availability = membership_error_availability(
            7,
            crate::system::platform::ReadTextError::Io(std::io::ErrorKind::PermissionDenied),
        );
        assert_eq!(
            availability.state,
            crate::system::AvailabilityState::PermissionDenied
        );
    }
}
