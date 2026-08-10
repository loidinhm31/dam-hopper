//! Reproducible, local-only profiler for the bounded deep host-resource collector.
//!
//! Run through `../../scripts/profile-host-resource-deep-scan.sh` on Linux. This
//! is deliberately an example rather than a server binary: it must not change
//! production sampling, cache retention, or the release artifact surface.

use std::{env, path::PathBuf, time::Instant};

use dam_hopper_server::system::platform::{
    collect_host_resource_snapshot_with_options, SystemHostResourceSource,
};

#[cfg(target_os = "linux")]
fn process_cpu_nanos() -> u128 {
    let mut value = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // CLOCK_PROCESS_CPUTIME_ID measures this otherwise idle profiler process;
    // the interval below therefore isolates collector CPU from server work.
    let result = unsafe { libc::clock_gettime(libc::CLOCK_PROCESS_CPUTIME_ID, &mut value) };
    assert_eq!(result, 0, "read process CPU clock");
    (value.tv_sec as u128) * 1_000_000_000 + value.tv_nsec as u128
}

#[cfg(target_os = "linux")]
fn rss_bytes() -> Option<u64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    status.lines().find_map(|line| {
        let value = line
            .strip_prefix("VmRSS:")?
            .split_ascii_whitespace()
            .next()?;
        value.parse::<u64>().ok()?.checked_mul(1024)
    })
}

#[cfg(target_os = "linux")]
fn main() {
    let mut args = env::args().skip(1);
    let iterations = args
        .next()
        .map(|value| {
            value
                .parse::<usize>()
                .expect("iterations must be a positive integer")
        })
        .unwrap_or(100);
    assert!(iterations > 0, "iterations must be greater than zero");
    let workspace = args
        .next()
        .map(PathBuf::from)
        .unwrap_or_else(|| env::current_dir().expect("current working directory"));
    assert!(
        args.next().is_none(),
        "usage: host-resource-profile [iterations] [workspace]"
    );

    let source = SystemHostResourceSource::default();
    let rss_before = rss_bytes();
    let mut total_cpu_nanos = 0_u128;
    let mut max_cpu_nanos = 0_u128;
    let mut max_wall_nanos = 0_u128;
    let mut max_snapshot_bytes = 0_usize;
    let mut max_scanned_processes = 0_usize;
    let mut deadline_exceeded_samples = 0_usize;

    for _ in 0..iterations {
        let cpu_started = process_cpu_nanos();
        let wall_started = Instant::now();
        let snapshot =
            collect_host_resource_snapshot_with_options(&source, &workspace, true, true, 150);
        let cpu_nanos = process_cpu_nanos().saturating_sub(cpu_started);
        let wall_nanos = wall_started.elapsed().as_nanos();
        total_cpu_nanos += cpu_nanos;
        max_cpu_nanos = max_cpu_nanos.max(cpu_nanos);
        max_wall_nanos = max_wall_nanos.max(wall_nanos);
        max_snapshot_bytes = max_snapshot_bytes.max(
            serde_json::to_vec(&snapshot)
                .expect("snapshot serialization")
                .len(),
        );
        max_scanned_processes = max_scanned_processes.max(snapshot.processes.scanned_count);
        deadline_exceeded_samples += usize::from(snapshot.processes.deadline_exceeded);
    }

    let rss_after = rss_bytes();
    let retained_rss_delta_bytes = rss_after
        .zip(rss_before)
        .map(|(after, before)| after as i128 - before as i128);
    println!(
        "{}",
        serde_json::json!({
            "iterations": iterations,
            "collectorCpuNanosTotal": total_cpu_nanos,
            "collectorCpuNanosPeak": max_cpu_nanos,
            "collectorWallNanosPeak": max_wall_nanos,
            "rssBeforeBytes": rss_before,
            "rssAfterBytes": rss_after,
            "retainedRssDeltaBytes": retained_rss_delta_bytes,
            "snapshotBytesPeak": max_snapshot_bytes,
            "scannedProcessesPeak": max_scanned_processes,
            "deadlineExceededSamples": deadline_exceeded_samples,
        }),
    );
}

#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("host-resource-profile requires Linux /proc; non-Linux snapshots are intentionally unsupported");
    std::process::exit(2);
}
