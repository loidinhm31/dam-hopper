#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
cd -- "$REPO_ROOT"

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'bump-version: required command is unavailable: node' >&2
  exit 127
fi

exec node "$SCRIPT_DIR/bump-version.mjs" "$@"
