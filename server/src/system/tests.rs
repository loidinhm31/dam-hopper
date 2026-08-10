use std::path::{Path, PathBuf};

use super::{
    is_real_persistent_disk, read_thermal_zones, select_workspace_disk, sorted_disk_snapshots,
    usage_percent, DiskMountSnapshot,
};

#[test]
fn v1_snapshot_serializes_camel_case_contract() {
    use super::{Availability, MemorySnapshot, MountContext};
    let snapshot = super::HostResourceSnapshotV1::new(
        42,
        MemorySnapshot {
            availability: Availability::available(42),
            ..MemorySnapshot::empty()
        },
        MountContext::for_workspace(Path::new("/workspace")),
    );
    let value = serde_json::to_value(snapshot).unwrap();
    assert_eq!(value["schemaVersion"], 1);
    assert_eq!(value["sampledAt"], 42);
    assert!(value.get("actionCapabilities").is_some());
}

#[test]
fn legacy_host_metrics_serializes_compatibility_shape() {
    let metrics = super::HostMetrics {
        sampled_at: 1,
        hostname: Some("host".into()),
        os_name: Some("linux".into()),
        uptime_seconds: 2,
        cpu: super::CpuMetrics {
            usage_percent: 3.0,
            logical_core_count: 4,
            physical_core_count: Some(4),
            load_average: None,
        },
        memory: super::MemoryMetrics {
            total_bytes: 10,
            used_bytes: 5,
            available_bytes: 5,
            usage_percent: 50.0,
        },
        disk: super::DiskMetrics {
            name: "root".into(),
            mount_point: "/".into(),
            total_bytes: 10,
            available_bytes: 5,
            used_bytes: 5,
            usage_percent: 50.0,
            file_system: Some("ext4".into()),
            source: None,
            source_kind: super::DiskSourceKind::Unknown,
        },
        disks: Vec::new(),
        temperatures: Vec::new(),
    };
    let value = serde_json::to_value(metrics).unwrap();
    let keys = value
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    assert_eq!(keys.len(), 9);
    for key in [
        "sampledAt",
        "hostname",
        "osName",
        "uptimeSeconds",
        "cpu",
        "memory",
        "disk",
        "disks",
        "temperatures",
    ] {
        assert!(value.get(key).is_some(), "missing legacy key {key}");
    }
    assert_eq!(
        value["cpu"].as_object().unwrap().len(),
        4,
        "legacy CPU shape changed"
    );
    for key in [
        "usagePercent",
        "logicalCoreCount",
        "physicalCoreCount",
        "loadAverage",
    ] {
        assert!(
            value["cpu"].get(key).is_some(),
            "missing legacy cpu key {key}"
        );
    }
    for key in ["totalBytes", "usedBytes", "availableBytes", "usagePercent"] {
        assert!(
            value["memory"].get(key).is_some(),
            "missing legacy memory key {key}"
        );
    }
    for key in [
        "name",
        "mountPoint",
        "totalBytes",
        "availableBytes",
        "usedBytes",
        "usagePercent",
    ] {
        assert!(
            value["disk"].get(key).is_some(),
            "missing legacy disk key {key}"
        );
    }
    assert_eq!(value["disk"].as_object().unwrap().len(), 6);
}

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
                file_system: Some("ext4".into()),
                source: None,
                source_kind: super::DiskSourceKind::Unknown,
            },
            DiskMountSnapshot {
                name: "work".into(),
                mount_point: PathBuf::from("/work"),
                total_bytes: 200,
                available_bytes: 80,
                file_system: Some("ext4".into()),
                source: None,
                source_kind: super::DiskSourceKind::Unknown,
            },
            DiskMountSnapshot {
                name: "repos".into(),
                mount_point: PathBuf::from("/work/repos"),
                total_bytes: 300,
                available_bytes: 120,
                file_system: Some("ext4".into()),
                source: None,
                source_kind: super::DiskSourceKind::Unknown,
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
            file_system: Some("ext4".into()),
            source: None,
            source_kind: super::DiskSourceKind::Unknown,
        }],
    );

    assert!(selected.is_none());
}

#[test]
fn unmatched_workspace_disk_falls_back_to_workspace_path() {
    let fallback = super::fallback_disk(Path::new("/work/repos/demo"));

    assert_eq!(fallback.name, "workspace");
    assert_eq!(fallback.mount_point, PathBuf::from("/work/repos/demo"));
    assert_eq!(fallback.total_bytes, 0);
    assert_eq!(fallback.available_bytes, 0);
}

#[test]
fn sorts_disk_snapshots_by_mount_point_then_name() {
    let disks = sorted_disk_snapshots(vec![
        DiskMountSnapshot {
            name: "z-data".into(),
            mount_point: PathBuf::from("/data"),
            total_bytes: 100,
            available_bytes: 50,
            file_system: Some("ext4".into()),
            source: None,
            source_kind: super::DiskSourceKind::Unknown,
        },
        DiskMountSnapshot {
            name: "root".into(),
            mount_point: PathBuf::from("/"),
            total_bytes: 100,
            available_bytes: 50,
            file_system: Some("ext4".into()),
            source: None,
            source_kind: super::DiskSourceKind::Unknown,
        },
        DiskMountSnapshot {
            name: "a-data".into(),
            mount_point: PathBuf::from("/data"),
            total_bytes: 100,
            available_bytes: 50,
            file_system: Some("ext4".into()),
            source: None,
            source_kind: super::DiskSourceKind::Unknown,
        },
    ]);

    let ordered = disks
        .iter()
        .map(|disk| (disk.mount_point.as_path(), disk.name.as_str()))
        .collect::<Vec<_>>();

    assert_eq!(
        ordered,
        vec![
            (Path::new("/"), "root"),
            (Path::new("/data"), "a-data"),
            (Path::new("/data"), "z-data"),
        ]
    );
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

fn disk_metrics(
    source: Option<&str>,
    source_kind: super::DiskSourceKind,
    file_system: Option<&str>,
    mount_point: &str,
    total_bytes: u64,
    available_bytes: u64,
) -> super::DiskMetrics {
    super::DiskMetrics {
        name: "disk".into(),
        mount_point: mount_point.into(),
        total_bytes,
        available_bytes,
        used_bytes: total_bytes.saturating_sub(available_bytes),
        usage_percent: usage_percent(total_bytes.saturating_sub(available_bytes), total_bytes),
        file_system: file_system.map(str::to_owned),
        source: source.map(str::to_owned),
        source_kind,
    }
}

#[test]
fn classifies_only_verified_persistent_block_devices_as_alertable() {
    for (source, file_system) in [
        ("/dev/nvme0n1p2", "ext4"),
        ("/dev/vda1", "xfs"),
        ("/dev/mapper/fedora-root", "btrfs"),
    ] {
        assert!(
            is_real_persistent_disk(&disk_metrics(
                Some(source),
                super::DiskSourceKind::BlockDevice,
                Some(file_system),
                "/data",
                100,
                5,
            )),
            "{source} ({file_system}) must alert"
        );
    }
}

#[test]
fn classifier_rejects_virtual_bind_like_malformed_and_unknown_sources() {
    for source in ["/dev/loop0", "/dev/zram0", "/dev/ram0", "/dev/fd/4"] {
        assert!(
            !is_real_persistent_disk(&disk_metrics(
                Some(source),
                super::DiskSourceKind::BlockDevice,
                Some("ext4"),
                "/data",
                100,
                5,
            )),
            "virtual {source} must not alert even with ext4"
        );
    }
    for source in [Some("/workspace/bind"), Some("none"), Some("\0"), None] {
        assert!(
            !is_real_persistent_disk(&disk_metrics(
                source,
                super::DiskSourceKind::Unknown,
                Some("xfs"),
                "/data",
                100,
                5,
            )),
            "unknown or bind-like source must not alert"
        );
    }
    assert!(!is_real_persistent_disk(&disk_metrics(
        Some("/dev/nvme0n1p2"),
        super::DiskSourceKind::Virtual,
        Some("ext4"),
        "/data",
        100,
        5,
    )));
    assert!(!is_real_persistent_disk(&disk_metrics(
        Some("/dev/nvme0n1p2"),
        super::DiskSourceKind::BlockDevice,
        Some("mysteryfs"),
        "/data",
        100,
        5,
    )));
    assert!(!is_real_persistent_disk(&disk_metrics(
        Some("/dev/nvme0n1p2"),
        super::DiskSourceKind::BlockDevice,
        Some("ext4"),
        "relative",
        100,
        5,
    )));
    assert!(!is_real_persistent_disk(&disk_metrics(
        Some("/dev/nvme0n1p2"),
        super::DiskSourceKind::BlockDevice,
        Some("ext4"),
        "/data",
        0,
        0,
    )));
}
