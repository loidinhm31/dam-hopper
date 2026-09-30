use std::path::Path;

use dam_hopper_server::system::{
    alerts::{
        AlertEvidence, AlertSeverity, AlertState, AlertSummary, ResourceAlertEvidence,
        ResourceAlertKind, ResourceAlertState, ResourceAlertSummary,
    },
    ActionCapabilities, AttributionLabel, Availability, BatterySnapshot, BatteryStatus,
    CacheAttribution, CgroupMemory, Confidence, CpuMetrics, HostIdentity, HostMetrics,
    HostMetricsSampler, HostResourceSnapshotV1, LoadAverageMetrics, MemoryMetrics, MemoryPressure,
    MemorySnapshot, MountContext, PressureSnapshot, ProcessInventory, ProcessMemory, PsiLine,
    SnapshotCapabilities, TemperatureMetrics,
};

/// Deterministic millisecond timestamp used across fixtures.
pub const FIXTURE_SAMPLED_AT_MS: u64 = 1_700_000_000_000;

/// Returns a representative healthy, fully available snapshot and matching legacy metrics pair.
pub fn representative_pair() -> (HostResourceSnapshotV1, HostMetrics) {
    let now = FIXTURE_SAMPLED_AT_MS;
    let workspace = Path::new("/workspace");

    let mut snapshot = HostResourceSnapshotV1::unavailable(now, workspace);
    snapshot.sample_id = "00000000-0000-0000-0000-000000000001".to_string();
    snapshot.host = HostIdentity {
        boot_id: Some("00000000-0000-0000-0000-000000000000".to_string()),
        hostname: Some("fixture-host".to_string()),
        os_name: Some("Linux".to_string()),
    };
    snapshot.capabilities = SnapshotCapabilities {
        linux_deep_metrics: Availability::available(now),
    };
    snapshot.memory = MemorySnapshot {
        total_bytes: Some(16 * 1024 * 1024 * 1024),
        available_bytes: Some(8 * 1024 * 1024 * 1024),
        anon_bytes: Some(4 * 1024 * 1024 * 1024),
        file_cache_bytes: Some(3 * 1024 * 1024 * 1024),
        reclaimable_slab_bytes: Some(1024 * 1024 * 1024),
        swap_used_bytes: Some(512 * 1024 * 1024),
        availability: Availability::available(now),
    };
    snapshot.battery = BatterySnapshot {
        count: 1,
        capacity_percent: Some(95.0),
        status: Some(BatteryStatus::Full),
        remaining_energy_wh: Some(50.0),
        instantaneous_power_w: Some(0.0),
        availability: Availability::available(now),
    };
    snapshot.pressure = PressureSnapshot {
        memory: MemoryPressure {
            some: Some(PsiLine {
                avg10: 0.1,
                avg60: 0.05,
                avg300: 0.01,
                total_micros: 10_000,
            }),
            full: Some(PsiLine {
                avg10: 0.0,
                avg60: 0.0,
                avg300: 0.0,
                total_micros: 0,
            }),
            availability: Availability::available(now),
        },
    };
    snapshot.cgroups = vec![CgroupMemory {
        path: "/user.slice".to_string(),
        namespace: "user".to_string(),
        current_bytes: Some(2 * 1024 * 1024 * 1024),
        max_bytes: Some(8 * 1024 * 1024 * 1024),
        max_unlimited: false,
        high_bytes: Some(6 * 1024 * 1024 * 1024),
        high_unlimited: false,
        file_cache_bytes: Some(512 * 1024 * 1024),
        events: vec![("oom".to_string(), 0)],
        pressure: MemoryPressure {
            some: Some(PsiLine {
                avg10: 0.05,
                avg60: 0.02,
                avg300: 0.01,
                total_micros: 5_000,
            }),
            full: None,
            availability: Availability::available(now),
        },
        availability: Availability::available(now),
    }];
    snapshot.processes = ProcessInventory {
        processes: vec![
            ProcessMemory {
                pid: 1001,
                start_ticks: Some(100),
                uid: Some(1000),
                name: "dam-hopper-server".to_string(),
                command_summary: Some("dam-hopper-server".to_string()),
                rss_bytes: Some(128 * 1024 * 1024),
                anon_rss_bytes: Some(96 * 1024 * 1024),
                file_rss_bytes: Some(24 * 1024 * 1024),
                shmem_rss_bytes: Some(8 * 1024 * 1024),
                pss_bytes: Some(110 * 1024 * 1024),
                availability: Availability::available(now),
            },
            ProcessMemory {
                pid: 1002,
                start_ticks: Some(200),
                uid: Some(1000),
                name: "node".to_string(),
                command_summary: Some("node vite".to_string()),
                rss_bytes: Some(256 * 1024 * 1024),
                anon_rss_bytes: Some(200 * 1024 * 1024),
                file_rss_bytes: Some(40 * 1024 * 1024),
                shmem_rss_bytes: Some(16 * 1024 * 1024),
                pss_bytes: Some(220 * 1024 * 1024),
                availability: Availability::available(now),
            },
        ],
        scanned_count: 2,
        truncated: false,
        deadline_exceeded: false,
        skipped_count: 0,
        permission_denied_count: 0,
        invalid_utf8_count: 0,
        malformed_count: 0,
        disappeared_count: 0,
        availability: Availability::available(now),
    };
    snapshot.mount_context = MountContext {
        mount_point: "/workspace".to_string(),
        fs_type: Some("ext4".to_string()),
        free_bytes: Some(50 * 1024 * 1024 * 1024),
        active_mapped_paths: vec!["/workspace/file1".to_string()],
        active_mapped_paths_availability: Availability::available(now),
        cache_attribution: CacheAttribution {
            label: AttributionLabel::SystemFileCache,
            bytes: Some(1024 * 1024 * 1024),
            confidence: Confidence::High,
            method: "mountMap".to_string(),
        },
        availability: Availability::available(now),
    };
    snapshot.alert = Some(AlertSummary {
        state: AlertState::Healthy,
        severity: AlertSeverity::Info,
        incident_id: None,
        opened_at: None,
        updated_at: now,
        duration_seconds: 0,
        scope: "host".to_string(),
        confidence: Confidence::High,
        threshold: "nominal".to_string(),
        evidence: AlertEvidence {
            available_percent: Some(50.0),
            reclaimable_percent: Some(25.0),
            psi_some_avg10: Some(0.1),
            psi_full_avg10: Some(0.0),
            cgroup_oom_delta: false,
        },
        next_action: "No action required".to_string(),
    });
    snapshot.current_alerts = Vec::new();
    snapshot.action_capabilities = ActionCapabilities {
        availability: Availability::unsupported(now),
    };

    let temp_dir = std::env::temp_dir();
    let mut metrics = HostMetricsSampler::new().sample(&temp_dir);
    metrics.sampled_at = now;
    metrics.hostname = Some("fixture-host".to_string());
    metrics.os_name = Some("Linux".to_string());
    metrics.uptime_seconds = 86400;
    metrics.cpu = CpuMetrics {
        usage_percent: 15.0,
        logical_core_count: 8,
        physical_core_count: Some(4),
        load_average: Some(LoadAverageMetrics {
            one: 0.5,
            five: 0.3,
            fifteen: 0.1,
        }),
    };
    metrics.memory = MemoryMetrics {
        total_bytes: 16 * 1024 * 1024 * 1024,
        used_bytes: 8 * 1024 * 1024 * 1024,
        available_bytes: 8 * 1024 * 1024 * 1024,
        usage_percent: 50.0,
    };
    metrics.disk.name = "/dev/sda1".to_string();
    metrics.disk.mount_point = "/workspace".to_string();
    metrics.disk.total_bytes = 100 * 1024 * 1024 * 1024;
    metrics.disk.available_bytes = 50 * 1024 * 1024 * 1024;
    metrics.disk.used_bytes = 50 * 1024 * 1024 * 1024;
    metrics.disk.usage_percent = 50.0;
    metrics.disks = vec![metrics.disk.clone()];
    metrics.temperatures = vec![TemperatureMetrics {
        label: "CPU".to_string(),
        celsius: 45.0,
        source: "coretemp".to_string(),
    }];

    (snapshot, metrics)
}

/// Returns a representative degraded snapshot and matching legacy metrics pair with active alerts,
/// deadline-exceeded process inventory, and elevated pressure.
pub fn degraded_pair() -> (HostResourceSnapshotV1, HostMetrics) {
    let now = FIXTURE_SAMPLED_AT_MS;
    let workspace = Path::new("/workspace");

    let mut snapshot = HostResourceSnapshotV1::unavailable(now, workspace);
    snapshot.sample_id = "00000000-0000-0000-0000-000000000002".to_string();
    snapshot.host = HostIdentity {
        boot_id: Some("00000000-0000-0000-0000-000000000000".to_string()),
        hostname: Some("fixture-host".to_string()),
        os_name: Some("Linux".to_string()),
    };
    snapshot.capabilities = SnapshotCapabilities {
        linux_deep_metrics: Availability::unavailable(now, "samplerDegraded"),
    };
    snapshot.memory = MemorySnapshot {
        total_bytes: Some(16 * 1024 * 1024 * 1024),
        available_bytes: Some(512 * 1024 * 1024),
        anon_bytes: Some(14 * 1024 * 1024 * 1024),
        file_cache_bytes: Some(512 * 1024 * 1024),
        reclaimable_slab_bytes: Some(256 * 1024 * 1024),
        swap_used_bytes: Some(4 * 1024 * 1024 * 1024),
        availability: Availability::available(now),
    };
    snapshot.battery = BatterySnapshot::unavailable(now, "batteryMissing");
    snapshot.pressure = PressureSnapshot {
        memory: MemoryPressure {
            some: Some(PsiLine {
                avg10: 28.5,
                avg60: 18.2,
                avg300: 12.0,
                total_micros: 50_000_000,
            }),
            full: Some(PsiLine {
                avg10: 8.5,
                avg60: 4.2,
                avg300: 2.1,
                total_micros: 15_000_000,
            }),
            availability: Availability::available(now),
        },
    };
    snapshot.cgroups = vec![CgroupMemory {
        path: "/user.slice".to_string(),
        namespace: "user".to_string(),
        current_bytes: Some(14 * 1024 * 1024 * 1024),
        max_bytes: Some(15 * 1024 * 1024 * 1024),
        max_unlimited: false,
        high_bytes: Some(12 * 1024 * 1024 * 1024),
        high_unlimited: false,
        file_cache_bytes: Some(256 * 1024 * 1024),
        events: vec![("oom".to_string(), 3), ("oom_kill".to_string(), 1)],
        pressure: MemoryPressure {
            some: Some(PsiLine {
                avg10: 25.0,
                avg60: 15.0,
                avg300: 10.0,
                total_micros: 45_000_000,
            }),
            full: Some(PsiLine {
                avg10: 7.0,
                avg60: 3.5,
                avg300: 1.5,
                total_micros: 12_000_000,
            }),
            availability: Availability::available(now),
        },
        availability: Availability::available(now),
    }];
    snapshot.processes = ProcessInventory {
        processes: vec![ProcessMemory {
            pid: 9999,
            start_ticks: Some(50),
            uid: Some(1000),
            name: "heavy-worker".to_string(),
            command_summary: Some("heavy-worker --threads 32".to_string()),
            rss_bytes: Some(8 * 1024 * 1024 * 1024),
            anon_rss_bytes: Some(7 * 1024 * 1024 * 1024),
            file_rss_bytes: Some(512 * 1024 * 1024),
            shmem_rss_bytes: Some(512 * 1024 * 1024),
            pss_bytes: Some(7500 * 1024 * 1024),
            availability: Availability::available(now),
        }],
        scanned_count: 512,
        truncated: true,
        deadline_exceeded: true,
        skipped_count: 48,
        permission_denied_count: 12,
        invalid_utf8_count: 2,
        malformed_count: 1,
        disappeared_count: 5,
        availability: Availability::unavailable(now, "processScanDeadlineExceeded"),
    };
    snapshot.mount_context = MountContext {
        mount_point: "/workspace".to_string(),
        fs_type: Some("ext4".to_string()),
        free_bytes: Some(1024 * 1024 * 1024),
        active_mapped_paths: vec![],
        active_mapped_paths_availability: Availability::unavailable(now, "mountDegraded"),
        cache_attribution: CacheAttribution {
            label: AttributionLabel::UnattributedSharedCache,
            bytes: None,
            confidence: Confidence::Low,
            method: "unattributed".to_string(),
        },
        availability: Availability::available(now),
    };
    snapshot.alert = Some(AlertSummary {
        state: AlertState::MemoryPressure,
        severity: AlertSeverity::Warning,
        incident_id: Some("inc-mem-001".to_string()),
        opened_at: Some(1_699_999_950_000),
        updated_at: now,
        duration_seconds: 50,
        scope: "host".to_string(),
        confidence: Confidence::High,
        threshold: "psi_some > 10.0".to_string(),
        evidence: AlertEvidence {
            available_percent: Some(3.125),
            reclaimable_percent: Some(3.125),
            psi_some_avg10: Some(28.5),
            psi_full_avg10: Some(8.5),
            cgroup_oom_delta: true,
        },
        next_action: "Inspect top consumers, PSI, swap, and cgroup limits".to_string(),
    });
    snapshot.current_alerts = vec![
        ResourceAlertSummary {
            kind: ResourceAlertKind::Temperature,
            key: "thermal-high".to_string(),
            state: ResourceAlertState::TemperatureHigh,
            severity: AlertSeverity::Warning,
            incident_id: "inc-thermal-001".to_string(),
            opened_at: 1_699_999_900_000,
            updated_at: now,
            duration_seconds: 100,
            scope: "coretemp-package-0".to_string(),
            evidence: ResourceAlertEvidence {
                temperature_source: Some("coretemp".to_string()),
                temperature_label: Some("Package id 0".to_string()),
                temperature_celsius: Some(88.5),
                disk_mount_point: None,
                disk_name: None,
                disk_usage_percent: None,
            },
            threshold: "> 85.0C".to_string(),
            next_action: "Check system cooling and high CPU processes".to_string(),
        },
        ResourceAlertSummary {
            kind: ResourceAlertKind::Disk,
            key: "disk-full-workspace".to_string(),
            state: ResourceAlertState::DiskFull,
            severity: AlertSeverity::Critical,
            incident_id: "inc-disk-001".to_string(),
            opened_at: 1_699_999_800_000,
            updated_at: now,
            duration_seconds: 200,
            scope: "/workspace".to_string(),
            evidence: ResourceAlertEvidence {
                temperature_source: None,
                temperature_label: None,
                temperature_celsius: None,
                disk_mount_point: Some("/workspace".to_string()),
                disk_name: Some("/dev/sda1".to_string()),
                disk_usage_percent: Some(99.0),
            },
            threshold: "> 95.0%".to_string(),
            next_action: "Free disk space in /workspace".to_string(),
        },
    ];
    snapshot.action_capabilities = ActionCapabilities {
        availability: Availability::unsupported(now),
    };

    let temp_dir = std::env::temp_dir();
    let mut metrics = HostMetricsSampler::new().sample(&temp_dir);
    metrics.sampled_at = now;
    metrics.hostname = Some("fixture-host".to_string());
    metrics.os_name = Some("Linux".to_string());
    metrics.uptime_seconds = 86400;
    metrics.cpu = CpuMetrics {
        usage_percent: 98.5,
        logical_core_count: 8,
        physical_core_count: Some(4),
        load_average: Some(LoadAverageMetrics {
            one: 12.5,
            five: 8.2,
            fifteen: 5.1,
        }),
    };
    metrics.memory = MemoryMetrics {
        total_bytes: 16 * 1024 * 1024 * 1024,
        used_bytes: 15500 * 1024 * 1024,
        available_bytes: 512 * 1024 * 1024,
        usage_percent: 96.8,
    };
    metrics.disk.name = "/dev/sda1".to_string();
    metrics.disk.mount_point = "/workspace".to_string();
    metrics.disk.total_bytes = 100 * 1024 * 1024 * 1024;
    metrics.disk.available_bytes = 1024 * 1024 * 1024;
    metrics.disk.used_bytes = 99 * 1024 * 1024 * 1024;
    metrics.disk.usage_percent = 99.0;
    metrics.disks = vec![metrics.disk.clone()];
    metrics.temperatures = vec![TemperatureMetrics {
        label: "Package id 0".to_string(),
        celsius: 88.5,
        source: "coretemp".to_string(),
    }];

    (snapshot, metrics)
}
