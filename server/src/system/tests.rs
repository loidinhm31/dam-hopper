use std::path::{Path, PathBuf};

use super::{read_thermal_zones, select_workspace_disk, usage_percent, DiskMountSnapshot};

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

#[test]
fn reads_linux_thermal_zones_in_celsius() {
    let temp = tempfile::tempdir().unwrap();
    let zone = temp.path().join("thermal_zone0");
    std::fs::create_dir(&zone).unwrap();
    std::fs::write(zone.join("type"), "acpitz\n").unwrap();
    std::fs::write(zone.join("temp"), "44000\n").unwrap();

    let readings = read_thermal_zones(temp.path());

    assert_eq!(readings.len(), 1);
    assert_eq!(readings[0].label, "acpitz");
    assert_eq!(readings[0].source, "thermal_zone0");
    assert_eq!(readings[0].celsius, 44.0);
}

#[test]
fn ignores_invalid_thermal_zones() {
    let temp = tempfile::tempdir().unwrap();
    let valid = temp.path().join("thermal_zone1");
    let invalid = temp.path().join("thermal_zone2");
    std::fs::create_dir(&valid).unwrap();
    std::fs::create_dir(&invalid).unwrap();
    std::fs::write(valid.join("temp"), "45123\n").unwrap();
    std::fs::write(invalid.join("temp"), "not-a-number\n").unwrap();

    let readings = read_thermal_zones(temp.path());

    assert_eq!(readings.len(), 1);
    assert_eq!(readings[0].label, "thermal_zone1");
    assert_eq!(readings[0].celsius, 45.123);
}

#[test]
fn missing_thermal_root_returns_no_temperatures() {
    let temp = tempfile::tempdir().unwrap();

    let readings = read_thermal_zones(&temp.path().join("missing"));

    assert!(readings.is_empty());
}
