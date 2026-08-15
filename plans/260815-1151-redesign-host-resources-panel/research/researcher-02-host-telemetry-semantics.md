# Research Report: Host telemetry semantics

Research date: 2026-08-15. Scope: semantics and edge cases for the redesigned Host resources panel (Linux-first Rust producer, React consumer).

## Executive Summary

Use “used” memory as `total - available`, where available means reclaimable memory, not merely `MemFree`; Linux explicitly says `MemAvailable` is an estimate and counters need not add up. Keep available/free as secondary detail. CPU usage is a rate between two cumulative samples, not a single instantaneous read; preserve a baseline and label the first/stale sample unavailable.

Treat a disk selection as a stable user preference with a mount identity (prefer filesystem/device identity plus mount point, with graceful re-resolution), while retaining an overall-disk aggregate in parentheses. Temperatures are sensor observations, not universally comparable health scores. Battery percentage (energy remaining) is distinct from capacity/health (design-vs-current full charge); show AC state separately and aggregate multiple batteries by energy where possible.

## Key Findings and Recommendations

### Memory

- Linux `/proc/meminfo` defines `MemAvailable` as an estimate of memory available for starting applications without swapping; it accounts for reclaimable cache/slab. `MemFree` is only unused pages. [Kernel proc documentation](https://www.kernel.org/doc/html/v6.9/filesystems/proc.html#meminfo)
- Headline: `used = total - available`, clamped to `[0,total]`; percentage `used/total * 100`. This matches the requested “used (not available)” presentation and existing server fields (`available_memory`, `used_memory`).
- Do not infer pressure from `used%` alone. Keep PSI/pressure and available bytes in expanded telemetry; `/proc` fields vary by architecture/configuration and may not sum exactly. Missing fields => unavailable, never zero.
- Container/cgroup limits can differ from host RAM. If the backend exposes cgroup limits, define the scope in the UI (“host” vs “process/container”) and do not silently mix denominators.

### CPU sampling

- CPU utilization requires deltas of cumulative idle/total CPU time (e.g., `/proc/stat`) across monotonic timestamps: `busy_delta / total_delta * 100`; clamp and handle counter reset/hotplug. Per-core and global values have different denominators. [proc(5)](https://man7.org/linux/man-pages/man5/proc_stat.5.html)
- Prime a baseline before rendering a percentage. On first sample, after a long poll gap, or when the sample is invalid, show `—`/stale rather than 0%. `sysinfo` documents a minimum CPU update interval and requires refresh before usage reads. [sysinfo CPU refresh docs](https://docs.rs/sysinfo/latest/sysinfo/struct.System.html)
- Poll on a monotonic interval; include `sampled_at`/age so React can mark stale data. Avoid averaging old samples into a new headline unless explicitly labelled.

### Filesystems and selection

- Filesystem usage should be `total - available` (or used blocks from `statvfs`), clamped; distinguish bytes from percentage. `statvfs(3)` documents block counts and flags. [statvfs(3)](https://man7.org/linux/man-pages/man3/statvfs.3.html)
- A mount path alone is not a durable identity: mounts can disappear, be remounted, or change source; bind mounts can represent the same underlying filesystem. Persist a user pin using a canonical identity tuple (device/source when available, filesystem type, mount point), then re-resolve against the current inventory. If no match, retain the pin as “missing” and fall back visibly; never silently switch the pinned label.
- Keep overall disk as a separate aggregate/metric and show selected filesystem beside it as `Selected: X (Overall: Y)`; do not sum overlapping mounts or count pseudo/network filesystems as physical capacity. `sysinfo` excludes tmpfs and network mounts by default and warns network refresh can hang. [sysinfo Disks](https://docs.rs/sysinfo/latest/sysinfo/struct.Disks.html)
- Selection UI must handle duplicate labels, long paths, mount churn, zero capacity, and permission errors. Use stable backend keys, not display names.

### Temperatures

- Enumerate all readable thermal zones/sensors and preserve labels/source IDs; labels can be absent, duplicated, or misleading. `/sys/class/thermal` and hwmon values are Linux-specific and typically millidegrees Celsius; validate finite values and plausible range before publishing. [Kernel thermal sysfs](https://www.kernel.org/doc/html/latest/driver-api/thermal/sysfs-api.html), [hwmon ABI](https://www.kernel.org/doc/html/latest/hwmon/sysfs-interface.html)
- Show every valid sensor in expanded content; top glance can summarize all temperatures (e.g., max plus count) only if labels remain discoverable. Missing/invalid sensors should be omitted from numeric rows with an explicit “unavailable” state, not rendered as 0 °C.
- Thresholds are sensor/platform policy, not universal constants. If backend supplies warning/critical limits, use them; otherwise avoid claiming “high” based on arbitrary CPU/GPU thresholds and merely show values.

### Battery and power

- UPower distinguishes `Percentage` (energy remaining, 0–100), `Capacity` (current full charge versus design capacity/health), `State` (charging/discharging/fully charged), `Online`, `EnergyRate`, and presence. Percentage can be approximate; coarse `BatteryLevel` should take precedence when available. [UPower Device reference](https://upower.freedesktop.org/docs/Device.html)
- Headline battery progress uses remaining percentage, not capacity/health. Show AC/online and charging state as text/icon; “100%” while plugged in is not equivalent to “healthy battery.” Keep capacity/health in expanded telemetry.
- Multiple batteries: aggregate remaining energy as `sum(energy)` / `sum(full)` when energy/full values exist; otherwise use a documented weighted/average fallback and expose per-battery rows. Exclude absent devices (`IsPresent=false`); UPS and non-battery power sources should not be mislabeled as laptop battery.
- Missing energy rate/time estimates are normal; omit rather than display zero. Avoid exposing serial numbers or native paths in UI/logs unless explicitly needed.

### Cross-cutting normalization, privacy, portability

- Every percentage: reject NaN/infinity, clamp `[0,100]`, preserve raw units internally, and carry `available`/`stale`/`sampled_at` metadata. Frontend progress bars are visualizations, not truth sources.
- Linux paths and sensors do not map directly to macOS/Windows. Define a normalized capability model with optional fields and an explicit unsupported state; do not fabricate values for unsupported platforms. `sysinfo` provides cross-platform system/disks/components abstractions but feature/platform coverage still varies. [sysinfo crate](https://docs.rs/sysinfo/latest/sysinfo/)
- Telemetry collection is local privileged-adjacent metadata. Read only required proc/sysfs/statvfs/UPower fields, handle permission/race errors, bound labels/paths, and avoid serial/device identifiers in telemetry sent to the browser.

## Suggested contract implications for the plan

Expose stable IDs, display labels, raw totals, normalized percentages, timestamp/age, and availability per metric. Separate `memory.used` from `memory.available`; separate `battery.remaining_percent` from `battery.capacity_percent`; separate selected filesystem from overall disk; represent sensor values as a list. React should render stale/unavailable states explicitly and preserve a missing disk pin until the user changes it.

## Unresolved Questions

- Should “overall disk” mean the workspace’s selected physical device, or an aggregate across all eligible persistent block devices?
- Does the backend target Linux only, or must the normalized contract support macOS/Windows in this release?
- Are cgroup limits and UPower available in every deployment mode (remote host, container, SSH)?
- What polling interval/staleness threshold is acceptable for the glance panel?
