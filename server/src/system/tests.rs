use std::path::{Path, PathBuf};

use super::{select_workspace_disk, usage_percent, DiskMountSnapshot};

#[test]
fn usage_percent_handles_zero_totals() {
    assert_eq!(usage_percent(10, 0), 0.0);
}

#[test]
fn usage_percent_clamps_to_hundred() {
    assert_eq!(usage_percent(150, 100), 100.0);
}

#[test]
fn selects_longest_matching_mount_for_workspace() {
    let selected = select_workspace_disk(
        Path::new("/work/repos/demo"),
        vec![
            DiskMountSnapshot {
                name: "root".into(),
                mount_point: PathBuf::from("/"),
                total_bytes: 100,
                available_bytes: 50,
            },
            DiskMountSnapshot {
                name: "work".into(),
                mount_point: PathBuf::from("/work"),
                total_bytes: 200,
                available_bytes: 80,
            },
            DiskMountSnapshot {
                name: "repos".into(),
                mount_point: PathBuf::from("/work/repos"),
                total_bytes: 300,
                available_bytes: 120,
            },
        ],
    )
    .expect("disk selected");

    assert_eq!(selected.name, "repos");
}

#[test]
fn ignores_non_matching_mounts() {
    let selected = select_workspace_disk(
        Path::new("/work/repos/demo"),
        vec![DiskMountSnapshot {
            name: "other".into(),
            mount_point: PathBuf::from("/var"),
            total_bytes: 100,
            available_bytes: 50,
        }],
    );

    assert!(selected.is_none());
}
