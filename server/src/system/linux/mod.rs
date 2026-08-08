mod cgroup;
mod meminfo;
mod mounts;
mod process;
mod psi;

use std::path::Path;

use uuid::Uuid;

use super::{platform::HostResourceSource, *};

pub fn collect(source: &impl HostResourceSource, workspace: &Path) -> HostResourceSnapshotV1 {
    let sampled_at = source.now_ms();
    let memory = meminfo::collect(source.proc_root(), sampled_at);
    let pressure = psi::collect(source.proc_root(), sampled_at);
    let cgroups = cgroup::collect(source, sampled_at);
    let processes = process::collect(source.proc_root(), sampled_at);
    let mount_context = mounts::collect(source, workspace, sampled_at);
    let mut snapshot = HostResourceSnapshotV1::new(sampled_at, memory, mount_context);
    snapshot.host.boot_id = bounded_file(&source.proc_root().join("sys/kernel/random/boot_id"));
    snapshot.capabilities.linux_deep_metrics = Availability::available(sampled_at);
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
