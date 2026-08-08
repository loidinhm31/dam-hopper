use std::path::{Path, PathBuf};

use crate::system::{
    platform::{read_bounded_text, HostResourceSource, ReadTextError},
    AttributionLabel, Availability, CacheAttribution, Confidence, MountContext,
};

pub fn collect(
    source: &impl HostResourceSource,
    workspace: &Path,
    sampled_at: u64,
) -> MountContext {
    let proc_root = source.proc_root();
    let mountinfo = match read_bounded_text(&proc_root.join("self/mountinfo")) {
        Ok(value) => value,
        Err(error) => return unavailable_for_error(workspace, sampled_at, error),
    };
    let Some(mount) = parse_mounts(&mountinfo)
        .into_iter()
        .filter(|mount| workspace.starts_with(&mount.point))
        .max_by_key(|mount| mount.point.components().count())
    else {
        return unavailable(workspace, sampled_at, "workspaceMountUnknown");
    };
    MountContext {
        mount_point: mount.point.to_string_lossy().to_string(),
        fs_type: Some(mount.fs_type),
        free_bytes: source.free_bytes(&mount.point),
        active_mapped_paths: Vec::new(),
        active_mapped_paths_availability: Availability::unsupported(sampled_at),
        cache_attribution: CacheAttribution {
            label: AttributionLabel::MountFileMappings,
            bytes: None,
            confidence: Confidence::Low,
            method: "mountContextOnly".into(),
        },
        availability: Availability::available(sampled_at),
    }
}

#[derive(Debug, PartialEq)]
pub struct Mount {
    point: PathBuf,
    fs_type: String,
}
pub fn parse_mounts(input: &str) -> Vec<Mount> {
    input
        .lines()
        .filter_map(|line| {
            let (before, after) = line.split_once(" - ")?;
            let point = before.split_ascii_whitespace().nth(4)?;
            let fs_type = after.split_ascii_whitespace().next()?;
            Some(Mount {
                point: PathBuf::from(unescape(point)),
                fs_type: fs_type.to_string(),
            })
        })
        .collect()
}
fn unavailable(workspace: &Path, sampled_at: u64, code: &'static str) -> MountContext {
    let mut context = MountContext::for_workspace_at(workspace, sampled_at);
    context.availability = Availability::unavailable(sampled_at, code);
    context
}

fn unavailable_for_error(workspace: &Path, sampled_at: u64, error: ReadTextError) -> MountContext {
    let mut context = MountContext::for_workspace_at(workspace, sampled_at);
    context.availability = match error {
        ReadTextError::Io(std::io::ErrorKind::PermissionDenied) => Availability::denied(sampled_at),
        ReadTextError::TooLarge => Availability::unavailable(sampled_at, "mountinfoTooLarge"),
        ReadTextError::InvalidUtf8 => Availability::unavailable(sampled_at, "mountinfoInvalidUtf8"),
        ReadTextError::Io(_) => Availability::unavailable(sampled_at, "mountinfoUnavailable"),
    };
    context
}
fn unescape(value: &str) -> String {
    value.replace("\\040", " ").replace("\\011", "\t")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_escaped_mount_points() {
        let mounts = parse_mounts(include_str!("../fixtures/linux/mountinfo/happy.txt"));
        assert_eq!(
            mounts[0],
            Mount {
                point: PathBuf::from("/mnt/data"),
                fs_type: "ext4".into()
            }
        );
    }

    #[test]
    fn preserves_mount_permission_degradation() {
        let context = unavailable_for_error(
            Path::new("/workspace"),
            7,
            ReadTextError::Io(std::io::ErrorKind::PermissionDenied),
        );
        assert_eq!(
            context.availability.state,
            crate::system::AvailabilityState::PermissionDenied
        );
    }
}
