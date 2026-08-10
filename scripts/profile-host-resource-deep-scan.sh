#!/usr/bin/env bash
# Profiles only the deep host-resource collector in a single-purpose process.
#
# Usage: bash scripts/profile-host-resource-deep-scan.sh [iterations] [workspace]
# The JSON result includes per-collection CPU/wall peaks and retained RSS delta.

set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "ERROR: this profiler measures Linux /proc collector work; use CI for non-Linux validation." >&2
  exit 2
fi

iterations="${1:-100}"
workspace_input="${2:-$PWD}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

case "$iterations" in
  ''|*[!0-9]*) echo "ERROR: iterations must be a positive integer" >&2; exit 2 ;;
esac
if (( iterations == 0 )); then
  echo "ERROR: iterations must be a positive integer" >&2
  exit 2
fi
if [[ ! -d "$workspace_input" ]]; then
  echo "ERROR: workspace must be a readable directory" >&2
  exit 2
fi
workspace="$(cd "$workspace_input" && pwd)"

(
  cd "$repo_root/server"
  cargo build --release --features vendored --example host_resource_profile
  exec target/release/examples/host_resource_profile "$iterations" "$workspace"
)
