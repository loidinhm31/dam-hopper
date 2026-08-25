mod cgroup;
mod meminfo;
mod mounts;
mod power_supply;
mod power_supply_aggregation;
#[cfg(test)]
mod power_supply_edge_tests;
#[cfg(test)]
mod power_supply_tests;
mod process;
mod psi;

use std::path::Path;

use uuid::Uuid;

use super::{platform::HostResourceSource, *};

pub fn collect(source: &(dyn HostResourceSource + '_), workspace: &Path) -> HostResourceSnapshotV1 {
    collect_with_options(source, workspace, true, true, 100)
}

pub fn collect_with_options(
    source: &(dyn HostResourceSource + '_),
    workspace: &Path,
    collect_processes: bool,
    collect_pss: bool,
    process_deadline_millis: u64,
) -> HostResourceSnapshotV1 {
    let sampled_at = source.now_ms();
    let memory = meminfo::collect(source.proc_root(), sampled_at);
    let battery = power_supply::collect(source.sys_root(), sampled_at);
    let pressure = psi::collect(source.proc_root(), sampled_at);
    let cgroups = cgroup::collect(source, sampled_at);
    let processes = if collect_processes {
        process::collect_with_options(
            source.proc_root(),
            sampled_at,
            collect_pss,
            std::time::Duration::from_millis(process_deadline_millis),
        )
    } else {
        super::ProcessInventory::unavailable(sampled_at, "processCadenceSkipped")
    };
    let mount_context = mounts::collect(source, workspace, sampled_at);
    let mut snapshot = HostResourceSnapshotV1::new(sampled_at, memory, mount_context);
    snapshot.host.boot_id = bounded_file(&source.proc_root().join("sys/kernel/random/boot_id"));
    snapshot.capabilities.linux_deep_metrics = Availability::available(sampled_at);
    snapshot.battery = battery;
    snapshot.pressure.memory = pressure;
    snapshot.cgroups = cgroups;
    snapshot.processes = processes;
    snapshot
}

fn bounded_file(path: &Path) -> Option<String> {
    super::platform::read_bounded_text(path)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .filter(|value| Uuid::parse_str(value).is_ok())
}
