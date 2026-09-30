#!/usr/bin/env bash
# Profiles the whole host-resource monitor in an isolated process.
#
# Usage: bash scripts/profile-host-resource-monitor.sh --workspace PATH [--warmup-seconds N] [--duration-seconds N] --output PATH
# The JSON result records synchronous startup and steady-state background monitor cost.

set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "ERROR: this profiler measures Linux /proc monitor work; use Linux host for profiling." >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

workspace=""
warmup_seconds="60"
duration_seconds="300"
output=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace)
      if [[ $# -lt 2 ]]; then echo "ERROR: missing argument for --workspace" >&2; exit 2; fi
      workspace="$2"
      shift 2
      ;;
    --warmup-seconds)
      if [[ $# -lt 2 ]]; then echo "ERROR: missing argument for --warmup-seconds" >&2; exit 2; fi
      warmup_seconds="$2"
      shift 2
      ;;
    --duration-seconds)
      if [[ $# -lt 2 ]]; then echo "ERROR: missing argument for --duration-seconds" >&2; exit 2; fi
      duration_seconds="$2"
      shift 2
      ;;
    --output)
      if [[ $# -lt 2 ]]; then echo "ERROR: missing argument for --output" >&2; exit 2; fi
      output="$2"
      shift 2
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$workspace" ]]; then
  echo "ERROR: --workspace PATH is required" >&2
  exit 2
fi

if [[ -z "$output" ]]; then
  echo "ERROR: --output PATH is required" >&2
  exit 2
fi

case "$warmup_seconds" in
  ''|*[!0-9]*) echo "ERROR: --warmup-seconds must be a non-negative integer" >&2; exit 2 ;;
esac

case "$duration_seconds" in
  ''|*[!0-9]*) echo "ERROR: --duration-seconds must be a positive integer" >&2; exit 2 ;;
esac

if (( duration_seconds == 0 )); then
  echo "ERROR: --duration-seconds must be greater than zero" >&2
  exit 2
fi

if [[ ! -d "$workspace" ]]; then
  echo "ERROR: workspace must be a readable directory: $workspace" >&2
  exit 2
fi

workspace="$(cd "$workspace" && pwd)"

# Ensure parent directory of output exists
output_dir="$(dirname "$output")"
mkdir -p "$output_dir"

# 1. Build the profile example before timing starts
(
  cd "$repo_root/server"
  cargo build --release --features vendored --example host_resource_monitor_profile
)

binary="$repo_root/server/target/release/examples/host_resource_monitor_profile"
if [[ ! -x "$binary" ]]; then
  echo "ERROR: failed to find compiled profiler binary at $binary" >&2
  exit 1
fi

timeout_seconds=$(( warmup_seconds + duration_seconds + 30 ))

set +e
timeout -s TERM -k 5s "${timeout_seconds}s" \
  "$binary" \
  --workspace "$workspace" \
  --warmup-seconds "$warmup_seconds" \
  --duration-seconds "$duration_seconds" \
  --output "$output"
child_exit=$?
set -e

if [[ $child_exit -ne 0 ]]; then
  # Check if a survivor process exists
  surviving_pids=$(pgrep -d ',' -f "host_resource_monitor_profile" || true)
  reason="profiler execution failed or timed out with exit code $child_exit"
  if [[ -n "$surviving_pids" ]]; then
    reason="$reason; surviving uninterruptible PID(s): $surviving_pids"
  fi

  python3 -c '
import json, os, platform, sys
reason, workspace, out_file = sys.argv[1], sys.argv[2], sys.argv[3]
report = {
    "schemaVersion": 1,
    "status": "blocked",
    "reason": reason,
    "host": {
        "hostname": platform.node(),
        "kernel": platform.release(),
        "os": platform.system(),
        "arch": platform.machine(),
        "cpuCores": os.cpu_count(),
        "workspace": workspace,
    },
    "config": None,
    "timing": None,
    "startup": None,
    "steady": None,
    "counts": None,
}
with open(out_file, "w") as f:
    json.dump(report, f, indent=2)
' "$reason" "$workspace" "$output"
  echo "ERROR: $reason" >&2
  exit "$child_exit"
fi
