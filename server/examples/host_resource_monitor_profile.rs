//! Reproducible baseline profiler for the whole host-resource monitor.
//!
//! Run through `scripts/profile-host-resource-monitor.sh` on Linux. This example
//! measures real `HostResourceMonitor` synchronous startup work and steady-state
//! background sampling resource consumption without modifying production monitor code.

use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};

#[cfg(target_os = "linux")]
use std::time::Duration;

#[cfg(target_os = "linux")]
use tokio::sync::RwLock;

#[cfg(target_os = "linux")]
use dam_hopper_server::{
    pty::BroadcastEventSink,
    system::{config::HostResourceMonitorConfig, HostResourceMonitor},
};

#[cfg(target_os = "linux")]
fn process_cpu_nanos() -> u128 {
    let mut value = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    let result = unsafe { libc::clock_gettime(libc::CLOCK_PROCESS_CPUTIME_ID, &mut value) };
    assert_eq!(result, 0, "read process CPU clock");
    (value.tv_sec as u128) * 1_000_000_000 + value.tv_nsec as u128
}

#[cfg(target_os = "linux")]
fn rss_bytes() -> Option<u64> {
    let status = fs::read_to_string("/proc/self/status").ok()?;
    status.lines().find_map(|line| {
        let value = line
            .strip_prefix("VmRSS:")?
            .split_ascii_whitespace()
            .next()?;
        value.parse::<u64>().ok()?.checked_mul(1024)
    })
}

#[cfg(target_os = "linux")]
fn hwm_bytes() -> Option<u64> {
    let status = fs::read_to_string("/proc/self/status").ok()?;
    status.lines().find_map(|line| {
        let value = line
            .strip_prefix("VmHWM:")?
            .split_ascii_whitespace()
            .next()?;
        value.parse::<u64>().ok()?.checked_mul(1024)
    })
}

#[derive(Debug)]
struct CliArgs {
    workspace: PathBuf,
    warmup_seconds: u64,
    duration_seconds: u64,
    output: PathBuf,
}

fn parse_cli_args() -> Result<CliArgs, String> {
    let mut args = env::args().skip(1);
    let mut workspace: Option<PathBuf> = None;
    let mut warmup_seconds = 60_u64;
    let mut duration_seconds = 300_u64;
    let mut output: Option<PathBuf> = None;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--workspace" => {
                let val = args
                    .next()
                    .ok_or_else(|| "Missing argument for --workspace".to_string())?;
                workspace = Some(PathBuf::from(val));
            }
            "--warmup-seconds" => {
                let val = args
                    .next()
                    .ok_or_else(|| "Missing argument for --warmup-seconds".to_string())?;
                warmup_seconds = val
                    .parse::<u64>()
                    .map_err(|e| format!("Invalid --warmup-seconds: {e}"))?;
            }
            "--duration-seconds" => {
                let val = args
                    .next()
                    .ok_or_else(|| "Missing argument for --duration-seconds".to_string())?;
                duration_seconds = val
                    .parse::<u64>()
                    .map_err(|e| format!("Invalid --duration-seconds: {e}"))?;
                if duration_seconds == 0 {
                    return Err("--duration-seconds must be greater than zero".to_string());
                }
            }
            "--output" => {
                let val = args
                    .next()
                    .ok_or_else(|| "Missing argument for --output".to_string())?;
                output = Some(PathBuf::from(val));
            }
            other => return Err(format!("Unknown argument: {other}")),
        }
    }

    let workspace = workspace.ok_or_else(|| "Missing required --workspace argument".to_string())?;
    let output = output.ok_or_else(|| "Missing required --output argument".to_string())?;

    Ok(CliArgs {
        workspace,
        warmup_seconds,
        duration_seconds,
        output,
    })
}

#[cfg(target_os = "linux")]
fn write_blocked_report(output_path: &Path, reason: &str, workspace: &Path) {
    let report = serde_json::json!({
        "schemaVersion": 1,
        "status": "blocked",
        "reason": reason,
        "host": {
            "hostname": sysinfo::System::host_name(),
            "kernel": sysinfo::System::kernel_version(),
            "os": sysinfo::System::long_os_version().or_else(|| sysinfo::System::name()),
            "arch": std::env::consts::ARCH,
            "cpuCores": sysinfo::System::new_all().cpus().len(),
            "workspace": workspace.display().to_string(),
        },
        "config": null,
        "timing": null,
        "startup": null,
        "steady": null,
        "counts": null,
    });
    if let Ok(json_str) = serde_json::to_string_pretty(&report) {
        let _ = fs::write(output_path, json_str);
    }
}

#[cfg(target_os = "linux")]
fn main() {
    let args = match parse_cli_args() {
        Ok(args) => args,
        Err(err) => {
            eprintln!("Error: {err}");
            eprintln!(
                "Usage: host_resource_monitor_profile --workspace PATH [--warmup-seconds N] [--duration-seconds N] --output PATH"
            );
            std::process::exit(2);
        }
    };

    if !args.workspace.is_dir() {
        eprintln!(
            "Error: workspace does not exist or is not a directory: {}",
            args.workspace.display()
        );
        write_blocked_report(
            &args.output,
            "workspace does not exist or is not a directory",
            &args.workspace,
        );
        std::process::exit(1);
    }

    let canonical_workspace = fs::canonicalize(&args.workspace).unwrap_or(args.workspace.clone());

    let rt = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(err) => {
            eprintln!("Failed to initialize tokio runtime: {err}");
            write_blocked_report(
                &args.output,
                &format!("tokio runtime init failed: {err}"),
                &canonical_workspace,
            );
            std::process::exit(1);
        }
    };

    rt.block_on(async {
        let mut sys = sysinfo::System::new_all();
        sys.refresh_all();

        let hostname = sysinfo::System::host_name().unwrap_or_else(|| "unknown".into());
        let kernel = sysinfo::System::kernel_version().unwrap_or_else(|| "unknown".into());
        let os = sysinfo::System::long_os_version()
            .or_else(|| sysinfo::System::name())
            .unwrap_or_else(|| "unknown".into());
        let arch = std::env::consts::ARCH.to_string();
        let cpu_cores = sys.cpus().len();

        let config = HostResourceMonitorConfig::default().clamped();
        let config_dto = serde_json::json!({
            "lightSampleMs": config.light_sample_seconds.saturating_mul(1_000),
            "processSampleMs": config.process_sample_seconds.saturating_mul(1_000),
            "pssSampleMs": config.pss_sample_seconds.saturating_mul(1_000),
            "processDeadlineMs": config.process_deadline_millis,
            "snapshotWaitMs": config.snapshot_deadline_millis,
            "jitterMs": config.jitter_millis,
        });

        // 1. Measure startup CPU and Wall time
        let startup_wall_start = Instant::now();
        let startup_cpu_start = process_cpu_nanos();

        let workspace_dir = Arc::new(RwLock::new(canonical_workspace.clone()));
        let (event_sink, _event_rx) = BroadcastEventSink::new(100);
        let monitor = HostResourceMonitor::system(workspace_dir, event_sink, config.clone());

        let startup_cpu_nanos = process_cpu_nanos().saturating_sub(startup_cpu_start);
        let startup_wall_ms = startup_wall_start.elapsed().as_secs_f64() * 1_000.0;
        let startup_cpu_ms = (startup_cpu_nanos as f64) / 1_000_000.0;
        let startup_rss = rss_bytes();

        // 2. Start monitor task
        monitor.start();

        // 3. Warmup phase
        if args.warmup_seconds > 0 {
            tokio::time::sleep(Duration::from_secs(args.warmup_seconds)).await;
        }

        // 4. Steady phase measurement
        let steady_wall_start = Instant::now();
        let steady_cpu_start = process_cpu_nanos();
        let rss_start_bytes = rss_bytes();

        tokio::time::sleep(Duration::from_secs(args.duration_seconds)).await;

        let steady_wall_ms = steady_wall_start.elapsed().as_secs_f64() * 1_000.0;
        let steady_cpu_nanos = process_cpu_nanos().saturating_sub(steady_cpu_start);
        let steady_cpu_ms = (steady_cpu_nanos as f64) / 1_000_000.0;
        let cpu_percent_one_core = if steady_wall_ms > 0.0 {
            100.0 * steady_cpu_ms / steady_wall_ms
        } else {
            0.0
        };
        let rss_end_bytes = rss_bytes();
        let rss_peak_bytes = hwm_bytes().or(rss_end_bytes);

        // 5. Clean shutdown
        monitor.shutdown().await;

        let uninstrumented_leaf = serde_json::json!({
            "value": null,
            "reason": "uninstrumentedInProductionMonitor",
        });

        let report = serde_json::json!({
            "schemaVersion": 1,
            "status": "complete",
            "reason": null,
            "host": {
                "hostname": hostname,
                "kernel": kernel,
                "os": os,
                "arch": arch,
                "cpuCores": cpu_cores,
                "workspace": canonical_workspace.display().to_string(),
            },
            "config": config_dto,
            "timing": {
                "warmupSeconds": args.warmup_seconds,
                "durationSeconds": args.duration_seconds,
                "startupWallMs": startup_wall_ms,
                "steadyWallMs": steady_wall_ms,
            },
            "startup": {
                "cpuMs": startup_cpu_ms,
                "rssBytes": startup_rss,
            },
            "steady": {
                "cpuMs": steady_cpu_ms,
                "cpuPercentOneCore": cpu_percent_one_core,
                "rssStartBytes": rss_start_bytes,
                "rssEndBytes": rss_end_bytes,
                "rssPeakBytes": rss_peak_bytes,
            },
            "counts": {
                "lightTicks": uninstrumented_leaf,
                "deepInvocations": uninstrumented_leaf,
                "deepCompletions": uninstrumented_leaf,
                "deepDeadlines": uninstrumented_leaf,
                "legacyInvocations": uninstrumented_leaf,
                "legacyCompletions": uninstrumented_leaf,
                "processInvocations": uninstrumented_leaf,
                "pssInvocations": uninstrumented_leaf,
            },
        });

        let json_output = serde_json::to_string_pretty(&report).expect("report serialization");
        if let Some(parent) = args.output.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Err(e) = fs::write(&args.output, &json_output) {
            eprintln!("Failed to write output file {}: {e}", args.output.display());
            std::process::exit(1);
        }

        println!("{json_output}");
    });
}

#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("host_resource_monitor_profile requires Linux /proc; non-Linux platforms are unsupported");
    std::process::exit(2);
}
