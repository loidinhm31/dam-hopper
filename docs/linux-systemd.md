# Linux systemd system service

Status: repository asset plus guarded administrator workflow. The supported
systemd package is backend-only: it builds and installs the Rust server binary
and unit, while any browser UI is built and hosted separately. New stages use
marker format 2; format-1 web-bearing installs remain accepted only for guarded
reset/rollback cleanup. No command in this document performs a live reset or
production mutation by itself.

If installation stops on a stale safety assignment and no managed service
assets remain, run `pnpm linux:reset -- --runtime-only`. It preserves the
existing server environment file, rewrites the current safety assignments, and
requires typing `PREPARE /home/loidinh/.config/dam-hopper` before install is
retried.

## Supported production runner

Run every command from any checkout of this repository as `loidinh`; the scripts
resolve their repository root from their own location and accept any named
branch or detached commit. Complete the guarded reset first when taking
ownership of an existing host. It authenticates sudo
interactively, purges only the canonical local runtime tree after typed
confirmation, and recreates the private ordered environment files. Never place
the selected source inside that purge target or display its contents.

```bash
pnpm linux:reset -- --env-file /secure/path/production-settings
```

Operator note: use `pnpm linux:reset -- --runtime-only --env-file /secure/path/production-settings`
only after the marker-backed installed assets and `dam-hopper.service` have
already been removed. This recovery path preserves the existing runtime/config
files, rewrites only the two ordered environment files, still requires the
exact `PREPARE` confirmation, and does not perform the build, install, or start
steps. The selected source must be a private user-owned mode-600 file, and its
values must never be pasted or displayed.

Build is unprivileged, runs the backend test and release-build gate, emits a
unique retained server-only staging directory, and records its canonical path
in a private automatic-stage record (a mode-600 file under the runtime parent).
Install without `--staging` uses only that recorded stage and re-runs the
complete stage validation; a missing, malformed, stale, or ambiguous record
fails closed. Retained format-1 stages containing web assets are not installable;
build a fresh format-2 stage instead.
`--staging PATH` remains an explicit override. Install reloads systemd, enables
the unit, and deliberately does not start it. Start validates installed hashes,
ownership, ordered environment files, systemd identity, the configured listener,
processes, and SQLite holders without rebuilding. After systemd reports the unit
active, the runner waits up to 10 seconds for `0.0.0.0:4801`; `ss` errors or
diagnostic output fail closed instead of being treated as a free/valid listener
state. The staged-tree credential scan reads files as byte streams, so binary
artifacts are covered as well as text files.

A format-2 stage contains exactly `bin/dam-hopper-server`,
`dam-hopper.service`, `manifest`, and `nonce`. Its manifest records only
`format`, `nonce`, `binary_sha256`, and `unit_sha256`; it contains no browser
asset directory or web inventory.

```bash
pnpm linux:production -- build
pnpm linux:production -- install
pnpm linux:production -- status
pnpm linux:production -- start
pnpm linux:production -- rollback --dry-run
```

Use `install --staging /absolute/path` only when deliberately overriding the
last successful build record. Do not search `/tmp` for a stage or copy a path
from unrelated build output; the runner refuses missing, invalid, or ambiguous
automatic-stage state.

Rollback clears the private automatic-stage record, so a rolled-back build
cannot be reinstalled accidentally through the automatic path. Its temporary
stage directory remains usable only with an explicit `--staging PATH` override
until normal temporary-directory cleanup.

An actual rollback requires `--confirm` plus the exact interactive confirmation
shown by the runner. It removes only marker-backed `/opt` assets and the unit;
the user runtime tree, repositories, containers, and external MongoDB remain
outside its scope. The historical Phase 03 run (before the wildcard-bind and
server-only changes) recorded PASS for installed identity, loopback binding,
the authentication boundary, authenticated protected-route access, same-origin
SPA serving, restart, active-PTY/SIGTERM cleanup, bounded journal checks, and
marker-backed rollback. That record is legacy format-1 evidence and does not
validate the current backend-only package; see the redacted [acceptance report](../plans/reports/qa-260821-0142-linux-production-runner.md).

## Deployment decision

The systemd service is an API/backend deployment. It installs only the Rust
server binary and unit; it does not build or copy `apps/web` or `/opt/dam-hopper/web`.
If a browser UI is needed, build and host it separately and configure an exact
`DAM_HOPPER_CORS_ORIGINS` entry for that UI origin.

The production unit binds `0.0.0.0:4801` so Tailscale clients can reach it. This
is a wildcard IPv4 bind, not a Tailscale-only bind: the host firewall and
Tailscale ACLs must restrict access to the intended tailnet, and production
authentication remains enabled. It does not bind, stop, or reconfigure the
existing nohup service on `4800`. The current `4800` service and the new unit
must never run concurrently against the same user-owned SQLite files: an
administrator must perform an explicit, planned ownership handoff before
starting the unit.

The acceptance record below predates this wildcard-bind change and therefore
does not prove Tailscale reachability or firewall/ACL isolation. Repeat the
administrator acceptance checks after installing this unit.

The service process is always `loidinh`. The system manager owns the unit and deployment assets, while runtime configuration, token, OPAQUE setup, session database, telemetry database, project files, and other private state remain owned by `loidinh`.

## Unit invariants

[`deploy/systemd/dam-hopper.service`](../deploy/systemd/dam-hopper.service) is intentionally small:

- `User=loidinh` and `Group=loidinh`; the server never runs as root.
- Direct `ExecStart` with an absolute binary, config, host, and port; no shell, wrapper, PID file, sudo, or privileged helper. Ordered user environment files are explicit and mandatory.
- `HOME`, `XDG_CONFIG_HOME`, and `WorkingDirectory` are explicit; no web asset
  directory is part of the systemd install contract.
- `0.0.0.0:4801` is explicit for Tailscale access. Restrict port `4801` with the host firewall and Tailscale ACLs; `RUST_ENV=production` makes the existing no-auth guard fail closed if a home `.env` attempts to set `DAM_HOPPER_NO_AUTH`; the unit has no `--no-auth` flag.
- `Restart=on-failure` with a short delay and journald stdout/stderr.
- Normal stops send `SIGTERM`; the server snapshots buffers, marks PTYs killed, terminates their process groups, joins PTY readers before persistence shutdown, and gets 20 seconds before systemd's bounded cgroup cleanup.
- `UMask=0077` and `NoNewPrivileges=true` reduce accidental private-state exposure.

The unit is not proof of installation. Root ownership, enablement, the effective UID, and system-manager runtime state require administrator evidence.

## Developer preparation (non-privileged)

Run these steps as `loidinh` from the repository. They do not install a unit, use sudo, stop the current `4800` service, or open its databases.

```bash
pnpm build:server
pnpm test
systemd-analyze verify deploy/systemd/dam-hopper.service
test -x server/target/release/dam-hopper-server
```

In a repository checkout the unit's absolute binary under `/opt` is normally not installed yet, so direct `systemd-analyze verify` may report that missing executable. The runner's isolated temporary-root setup resolves a system `true` executable only as a verifier placeholder; it does not touch `/opt`, `/etc`, or host systemd state. The administrator reruns verification against the installed asset during the guarded install.

For a browser development run, keep the UI proxy on the isolated service port:

```bash
VITE_DAM_HOPPER_SERVER_URL=http://127.0.0.1:4801 pnpm dev -- --port 5173
```

The development UI command is only a local browser host. It does not change the production unit or the live `4800` process.

The production runner does not build or package the browser UI. If a separate
UI host is deployed, configure its backend URL and add that exact origin to
`DAM_HOPPER_CORS_ORIGINS`; the systemd service remains responsible only for the
authenticated API and WebSocket endpoints on `4801`.

Before an administrator installs the unit, independently confirm all of the following:

1. The intended server binary is complete and contains no secrets or `.env` files.
2. `/home/loidinh/.config/dam-hopper/dam-hopper.toml` exists and is readable by `loidinh`.
3. Existing token/OPAQUE state, session database, and telemetry database are user-owned and private (`0600` where applicable); the service may create missing secret files as `loidinh`.
4. The existing nohup launch is stopped for the planned cutover, and no process still owns the live SQLite files. A different port does not make shared SQLite ownership safe.
5. `0.0.0.0:4801` is free. Do not start a second server if the intended ownership checks fail.

The supported production runner performs this guarded preflight. It refuses to
overwrite an existing unit, binary, or fresh-install marker; if
any exact target exists, stop and make an administrator-owned backup/restore
plan before changing it.

Do not interpret a free `4801` listener as permission to leave the legacy process running: the administrator must complete the planned database ownership handoff first.

## Historical manual installer (unsupported reference)

> Do not execute the commands in this section. It is retained only as an
> archival record of the pre-runner handoff. The supported path is the guarded
> `pnpm linux:production -- install` followed by separate
> `status` and `start` commands shown above; the runner owns locking, staged
> manifest verification, non-root identity checks, and rollback boundaries.

The web-directory commands in this archival section describe legacy format-1
installations only. They are not part of the current server-only systemd
package.

The archived commands below are not a supported handoff. Do not run them
non-interactively, and do not substitute broad recursive paths; use the runner
commands above instead.

Install only the exact administrator-owned assets:

```bash
set -euo pipefail

install_root=/opt/dam-hopper
bin_dir="$install_root/bin"
web_dir="$install_root/web"
binary="$bin_dir/dam-hopper-server"
unit=/etc/systemd/system/dam-hopper.service
marker="$install_root/.systemd-fresh-install"
manifest="$marker/manifest"
nonce_file="$marker/nonce"
web_manifest="$marker/web.sha256"
staging_dir=""
install_committed=0
bin_installed=0
web_installed=0
unit_installed=0
service_start_attempted=0
runtime_dir=/home/loidinh/.config/dam-hopper
config_file="$runtime_dir/dam-hopper.toml"
token_file="$runtime_dir/server-token"
opaque_file="$runtime_dir/opaque-server-setup"
sessions_db="$runtime_dir/sessions.db"
telemetry_db="$runtime_dir/telemetry.db"
user_uid="$(id -u loidinh)"
user_gid="$(id -g loidinh)"
assert_absent() {
  local path="$1"
  if sudo test -e "$path" || sudo test -L "$path"; then
    echo "Refusing first install: target already exists: $path" >&2
    exit 1
  fi
}
assert_user_runtime_directory() {
  local actual access
  sudo test -d "$runtime_dir" && ! sudo test -L "$runtime_dir" || return 1
  sudo -u loidinh test -r "$runtime_dir" -a -w "$runtime_dir" -a -x "$runtime_dir" || return 1
  actual="$(sudo stat -c '%u:%g:%a' "$runtime_dir")" || return 1
  [ "$actual" = "$user_uid:$user_gid:700" ] || return 1
}
assert_user_private_file() {
  local path="$1" expected_mode="$2" actual
  sudo test -f "$path" && ! sudo test -L "$path" || return 1
  sudo -u loidinh test -r "$path" || return 1
  actual="$(sudo stat -c '%u:%g:%a' "$path")" || return 1
  [ "$actual" = "$user_uid:$user_gid:$expected_mode" ] || { echo "Refusing install: private state is not user-owned/readable: $path" >&2; return 1; }
}
assert_optional_user_private_file() {
  local path="$1" expected_mode="$2"
  if sudo test -e "$path" || sudo test -L "$path"; then assert_user_private_file "$path" "$expected_mode"; fi
}
assert_safe_directory() {
  local path="$1"
  if sudo test -L "$path"; then
    echo "Refusing first install: directory is a symlink: $path" >&2
    exit 1
  fi
  if sudo test -e "$path" && ! sudo test -d "$path"; then
    echo "Refusing first install: path is not a directory: $path" >&2
    exit 1
  fi
}
assert_root_owned_mode() {
  local path="$1"
  local expected="$2"
  local actual
  actual="$(sudo stat -c '%u:%g:%a' "$path")"
  if [ "$actual" != "$expected" ]; then
    echo "Refusing first install: unexpected ownership/mode for $path: $actual" >&2
    return 1
  fi
}

assert_find_empty() {
  local find_status=0
  local matches
  matches="$(sudo find "$@")" || find_status=$?
  [ "$find_status" -eq 0 ] || return "$find_status"
  [ -z "$matches" ]
}

safe_remove_staging() {
  if [ -z "$staging_dir" ]; then
    return 0
  fi
  if ! sudo test -e "$staging_dir" && ! sudo test -L "$staging_dir"; then
    return 0
  fi
  if sudo test -L "$staging_dir" || ! sudo test -d "$staging_dir"; then
    echo "Refusing cleanup: staging path is not a directory: $staging_dir" >&2
    return 1
  fi
  if [ "$(sudo stat -c '%u:%g:%a' "$staging_dir")" != "0:0:700" ]; then
    echo "Refusing cleanup: staging directory ownership/mode changed: $staging_dir" >&2
    return 1
  fi
  sudo find "$staging_dir" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  sudo rmdir -- "$staging_dir"
}

manifest_value() {
  local key="$1"
  sudo awk -F= -v key="$key" \
    '$1 == key { value = substr($0, index($0, "=") + 1); count++ }
     END { if (count != 1) exit 1; print value }' \
    "$manifest"
}

verify_sha256_asset() {
  local path="$1"
  local expected="$2"
  local actual
  if sudo test -L "$path" || ! sudo test -f "$path"; then
    return 1
  fi
  actual="$(sudo sha256sum -- "$path" | awk '{print $1}')"
  [ "$actual" = "$expected" ]
}

verify_owned_assets() {
  local expected_nonce actual_nonce expected_binary expected_unit
  local expected_web_files expected_web_dirs actual_web_files actual_web_dirs
  local expected_root actual_root expected_marker actual_marker

  sudo test -d "$install_root" || return 1
  ! sudo test -L "$install_root" || return 1
  assert_root_owned_mode "$install_root" "0:0:755" || return 1
  sudo test -d "$marker" || return 1
  ! sudo test -L "$marker" || return 1
  assert_root_owned_mode "$marker" "0:0:700" || return 1
  sudo test -f "$manifest" || return 1
  ! sudo test -L "$manifest" || return 1
  sudo test -f "$nonce_file" || return 1
  ! sudo test -L "$nonce_file" || return 1
  sudo test -f "$web_manifest" || return 1
  ! sudo test -L "$web_manifest" || return 1
  assert_root_owned_mode "$manifest" "0:0:600" || return 1
  assert_root_owned_mode "$nonce_file" "0:0:600" || return 1
  assert_root_owned_mode "$web_manifest" "0:0:600" || return 1
  expected_marker="$(printf '%s\n' manifest nonce web.sha256 | LC_ALL=C sort)"
  actual_marker="$(sudo find "$marker" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" || return 1
  [ "$actual_marker" = "$expected_marker" ] || return 1

  expected_nonce="$(manifest_value nonce)" || return 1
  actual_nonce="$(sudo cat "$nonce_file")" || return 1
  [ "$expected_nonce" = "$actual_nonce" ] || return 1
  expected_binary="$(manifest_value binary_sha256)" || return 1
  expected_unit="$(manifest_value unit_sha256)" || return 1
  expected_web_files="$(manifest_value web_file_count)" || return 1
  expected_web_dirs="$(manifest_value web_dir_count)" || return 1
  verify_sha256_asset "$binary" "$expected_binary" || return 1
  verify_sha256_asset "$unit" "$expected_unit" || return 1
  sudo test -d "$bin_dir" || return 1
  ! sudo test -L "$bin_dir" || return 1
  assert_root_owned_mode "$bin_dir" "0:0:755" || return 1
  assert_root_owned_mode "$binary" "0:0:755" || return 1
  assert_root_owned_mode "$unit" "0:0:644" || return 1

  sudo test -d "$web_dir" || return 1
  ! sudo test -L "$web_dir" || return 1
  assert_root_owned_mode "$web_dir" "0:0:755" || return 1
  assert_find_empty "$web_dir" -type d '!' -user root -print -quit || return 1
  assert_find_empty "$web_dir" -type d '!' -group root -print -quit || return 1
  assert_find_empty "$web_dir" -type d '!' -perm 0755 -print -quit || return 1
  assert_find_empty "$web_dir" -type f '!' -user root -print -quit || return 1
  assert_find_empty "$web_dir" -type f '!' -group root -print -quit || return 1
  assert_find_empty "$web_dir" -type f '!' -perm 0644 -print -quit || return 1
  assert_find_empty "$web_dir" -mindepth 1 '!' '(' -type f -o -type d ')' -print -quit || return 1
  actual_web_files="$(sudo find "$web_dir" -type f | wc -l)" || return 1
  actual_web_dirs="$(sudo find "$web_dir" -type d | wc -l)" || return 1
  [ "$actual_web_files" = "$expected_web_files" ] || return 1
  [ "$actual_web_dirs" = "$expected_web_dirs" ] || return 1
  (
    cd "$web_dir"
    sudo sha256sum --check "$web_manifest"
  ) || return 1

  expected_root="$(printf '%s\n' '.systemd-fresh-install' 'bin' 'web' | LC_ALL=C sort)"
  actual_root="$(sudo find "$install_root" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" || return 1
  [ "$actual_root" = "$expected_root" ] || return 1
  [ "$(sudo find "$bin_dir" -mindepth 1 -maxdepth 1 -printf '%f\n')" = "dam-hopper-server" ] || return 1
}

remove_marker() {
  sudo test -d "$marker" || return 1
  ! sudo test -L "$marker" || return 1
  assert_root_owned_mode "$marker" "0:0:700" || return 1
  expected_marker="$(printf '%s\n' manifest nonce web.sha256 | LC_ALL=C sort)"
  actual_marker="$(sudo find "$marker" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" || return 1
  [ "$actual_marker" = "$expected_marker" ] || return 1
  sudo find "$marker" -mindepth 1 -maxdepth 1 -type f -delete
  sudo rmdir -- "$marker"
}

cleanup_partial_install() {
  local status=$?
  local cleanup_status=0
  trap - EXIT

  if [ "$install_committed" -eq 0 ]; then
    set +e
    if [ "$service_start_attempted" -eq 1 ]; then
      sudo systemctl disable --now dam-hopper.service || cleanup_status=$?
    fi
    if [ "$cleanup_status" -eq 0 ] && { [ "$bin_installed" -eq 1 ] || [ "$web_installed" -eq 1 ] || [ "$unit_installed" -eq 1 ]; }; then
      if ! verify_owned_assets; then
        echo "Partial install assets no longer match the ownership manifest; retaining them" >&2
        cleanup_status=1
      fi
    fi
    if [ "$cleanup_status" -eq 0 ] && [ "$unit_installed" -eq 1 ]; then
      sudo rm -f -- "$unit" || cleanup_status=$?
      sudo systemctl daemon-reload || cleanup_status=$?
    fi
    if [ "$cleanup_status" -eq 0 ] && [ "$bin_installed" -eq 1 ]; then
      sudo rm -f -- "$binary" || cleanup_status=$?
      if sudo test -d "$bin_dir" && ! sudo test -L "$bin_dir"; then
        sudo rmdir -- "$bin_dir" || cleanup_status=$?
      fi
    fi
    if [ "$cleanup_status" -eq 0 ] && [ "$web_installed" -eq 1 ]; then
      if sudo test -d "$web_dir" && ! sudo test -L "$web_dir"; then
        sudo find "$web_dir" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + || cleanup_status=$?
        sudo rmdir -- "$web_dir" || cleanup_status=$?
      fi
    fi
    if [ "$cleanup_status" -eq 0 ]; then
      safe_remove_staging || cleanup_status=$?
    fi
    if [ "$cleanup_status" -eq 0 ]; then
      remove_marker || cleanup_status=$?
    fi
    set -e
  fi

  if [ "$cleanup_status" -ne 0 ]; then
    echo "Partial install cleanup failed; keep the marker and inspect before retrying" >&2
    exit "$cleanup_status"
  fi
  exit "$status"
}

assert_safe_directory "$install_root"
if sudo test -e "$install_root"; then
  assert_root_owned_mode "$install_root" "0:0:755"
  existing_root_entry="$(sudo find "$install_root" -mindepth 1 -maxdepth 1 -print -quit)"
  if [ -n "$existing_root_entry" ]; then
    echo "Refusing first install: install root is not empty: $existing_root_entry" >&2
    exit 1
  fi
else
  sudo install -d -o root -g root -m 0755 "$install_root"
fi
assert_absent "$unit"
assert_absent "$bin_dir"
assert_absent "$binary"
assert_absent "$web_dir"
assert_absent "$marker"
assert_user_runtime_directory
assert_user_private_file "$config_file" 600
assert_user_private_file "$sessions_db" 600
assert_user_private_file "$telemetry_db" 600
assert_optional_user_private_file "$token_file" 600
assert_optional_user_private_file "$opaque_file" 600

fuser_status=0
sudo fuser -v \
  /home/loidinh/.config/dam-hopper/sessions.db \
  /home/loidinh/.config/dam-hopper/telemetry.db || fuser_status=$?
if [ "$fuser_status" -eq 0 ]; then
  echo "Refusing install: a process owns a Dam Hopper database" >&2
  exit 1
elif [ "$fuser_status" -ne 1 ]; then
  echo "Unable to determine Dam Hopper database ownership" >&2
  exit "$fuser_status"
fi

pgrep_status=0
pgrep -af -- 'dam-hopper-server' || pgrep_status=$?
if [ "$pgrep_status" -eq 0 ]; then
  echo "Refusing install: stop the existing dam-hopper-server first" >&2
  exit 1
elif [ "$pgrep_status" -ne 1 ]; then
  echo "Unable to determine whether dam-hopper-server is running" >&2
  exit "$pgrep_status"
fi

listener_status=0
sudo fuser -n tcp 4801 || listener_status=$?
if [ "$listener_status" -eq 0 ]; then
  echo "Refusing install: port 4801 is already in use" >&2
  exit 1
elif [ "$listener_status" -ne 1 ]; then
  echo "Unable to determine port 4801 ownership" >&2
  exit "$listener_status"
fi

# Create the ownership manifest before any staged or live asset is written. If a
# later command fails, cleanup removes assets only when their recorded inventory
# still matches; otherwise the marker remains for manual inspection.
sudo install -d -o root -g root -m 0700 "$marker"
install_nonce="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
sudo install -o root -g root -m 0600 /dev/null "$manifest"
sudo install -o root -g root -m 0600 /dev/null "$nonce_file"
sudo install -o root -g root -m 0600 /dev/null "$web_manifest"
printf '%s\n' "$install_nonce" | sudo tee "$nonce_file" >/dev/null
trap cleanup_partial_install EXIT
staging_dir="$(sudo mktemp -d -p "$install_root" '.systemd-staging.XXXXXX')"
if [ "$(sudo stat -c '%u:%g:%a' "$staging_dir")" != "0:0:700" ]; then
  echo "Refusing install: mktemp returned an unexpected staging directory" >&2
  exit 1
fi
sudo install -d -o root -g root -m 0755 "$staging_dir/bin"
sudo install -d -o root -g root -m 0700 "$staging_dir/web"
sudo install -o root -g root -m 0755 \
  server/target/release/dam-hopper-server \
  "$staging_dir/bin/dam-hopper-server"
sudo cp -a apps/web/dist/. "$staging_dir/web/"
sudo chown -R root:root "$staging_dir/web"
sudo find "$staging_dir/web" -type d -exec chmod 0755 {} +
sudo find "$staging_dir/web" -type f -exec chmod 0644 {} +
sudo install -o root -g root -m 0644 \
  deploy/systemd/dam-hopper.service \
  "$staging_dir/dam-hopper.service"

binary_sha256="$(sudo sha256sum -- "$staging_dir/bin/dam-hopper-server" | awk '{print $1}')"
unit_sha256="$(sudo sha256sum -- "$staging_dir/dam-hopper.service" | awk '{print $1}')"
sudo bash -c '
  cd "$1"
  find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum
' _ "$staging_dir/web" | sudo tee "$web_manifest" >/dev/null
web_file_count="$(sudo find "$staging_dir/web" -type f | wc -l)"
web_dir_count="$(sudo find "$staging_dir/web" -type d | wc -l)"
{
  printf 'format=1\n'
  printf 'nonce=%s\n' "$install_nonce"
  printf 'binary_sha256=%s\n' "$binary_sha256"
  printf 'unit_sha256=%s\n' "$unit_sha256"
  printf 'web_file_count=%s\n' "$web_file_count"
  printf 'web_dir_count=%s\n' "$web_dir_count"
} | sudo tee "$manifest" >/dev/null

# The first-install absence gate makes these exact moves non-overwriting. -T
# also prevents a concurrent directory from turning a move into a nested copy.
sudo mv -T "$staging_dir/bin" "$bin_dir"
bin_installed=1
sudo mv -T "$staging_dir/web" "$web_dir"
web_installed=1
sudo mv -T "$staging_dir/dam-hopper.service" "$unit"
unit_installed=1
safe_remove_staging
if ! verify_owned_assets; then
  echo "Refusing install: live assets failed the ownership manifest verification" >&2
  exit 1
fi
sudo systemd-analyze verify "$unit"
sudo systemctl daemon-reload
service_start_attempted=1
sudo systemctl enable --now dam-hopper.service
install_committed=1
trap - EXIT
safe_remove_staging
```

The root-owned marker directory is created before staged assets move into their live paths and records a nonce, exact binary/unit hashes, and the web file inventory. A failed command therefore cleans only paths whose content and ownership still match that manifest; if verification or cleanup fails, the marker is retained so the administrator can inspect and retry the guarded rollback instead of guessing ownership. The staging directory is a unique `mktemp` directory with verified root ownership/mode. The installed binary directory is `0755` so `loidinh` can traverse it, while the binary remains `0755` and root-owned.

Do not copy the repository `.env`, user token, SQLite files, or any other runtime state into `/opt`.

## Administrator acceptance evidence

Record statuses, ownership, timestamps, and PIDs; never record a token or response body.

```bash
install_root=/opt/dam-hopper
bin_dir="$install_root/bin"
binary="$bin_dir/dam-hopper-server"
sudo test -d "$install_root"
sudo test -x "$install_root"
sudo test -d "$bin_dir"
sudo test -x "$bin_dir"
sudo -u loidinh test -x "$binary"
sudo systemctl is-enabled dam-hopper.service
sudo systemctl is-active dam-hopper.service
sudo systemctl show dam-hopper.service \
  -p User -p Group -p MainPID -p ExecMainPID -p ActiveState -p SubState
MAIN_PID="$(sudo systemctl show -p MainPID --value dam-hopper.service)"
ps -o pid=,ppid=,user=,euser=,group=,args= -p "$MAIN_PID"
ss -ltnp | rg ':4801[[:space:]]'
curl -sS -o /dev/null -w 'health=%{http_code}\n' \
  http://127.0.0.1:4801/api/health
curl -sS -o /dev/null -w 'unauthenticated_projects=%{http_code}\n' \
  http://127.0.0.1:4801/api/projects
# Obtain AUTH_JWT from the approved login flow without printing it. The
# server-token file is the JWT signing secret, not itself a bearer token.
# Supply the header on stdin so the JWT is not placed in curl's argv.
IFS= read -r AUTH_JWT
curl -sS -o /dev/null -w 'authenticated_projects=%{http_code}\n' \
  -H @- \
  http://127.0.0.1:4801/api/projects <<EOF
Authorization: Bearer ${AUTH_JWT}
EOF
unset AUTH_JWT
sudo journalctl -u dam-hopper.service --no-pager -n 50
```

Expected results:

- `User=loidinh`, `euser=loidinh`, and a non-root main process.
- The listener is exactly `0.0.0.0:4801`; confirm the host firewall and Tailscale ACLs restrict access as intended.
- Health is successful; the protected projects route rejects missing auth and accepts the valid token.
- Journald contains lifecycle output without secrets, including `Disposing all PTY sessions` and `Server shutdown complete` after a normal stop.

Validate the normal stop and bounded cleanup:

```bash
sudo systemctl stop dam-hopper.service
sudo journalctl -u dam-hopper.service -g 'Server shutdown complete' --no-pager -n 1
! ss -ltnp | rg ':4801[[:space:]]'
sudo systemctl is-inactive dam-hopper.service
```

Repeat the stop check once with a disposable active terminal session running a long-lived child. Confirm the child process group is gone after the stop and that the journal contains the PTY disposal message; this validates the application-level PTY cleanup before systemd's final cgroup enforcement.

Test `Restart=on-failure` only with an isolated copy of the config and databases. Do not inject a forced failure into the live service merely to collect restart evidence; a controlled crash test must not risk SQLite corruption or a second owner.

## Historical manual rollback (unsupported reference)

> Do not execute the commands in this section. The supported rollback path is
> `pnpm linux:production -- rollback --confirm`, after its dry run and exact
> interactive confirmation. This block is retained only as an archival record
> of the pre-runner handoff.

Rollback below is safe only for an installation that passed the first-install absence checks and created the verified ownership manifest under `/opt/dam-hopper/.systemd-fresh-install`. Do not run it when the marker or any manifest entry is absent/mismatched: that means this handoff did not establish ownership of the targets, and removal could destroy a prior deployment. For an upgrade or pre-existing target, restore the administrator backup/manifest instead.

```bash
set -euo pipefail

install_root=/opt/dam-hopper
bin_dir="$install_root/bin"
web_dir="$install_root/web"
binary="$bin_dir/dam-hopper-server"
unit=/etc/systemd/system/dam-hopper.service
marker="$install_root/.systemd-fresh-install"
manifest="$marker/manifest"
nonce_file="$marker/nonce"
web_manifest="$marker/web.sha256"

assert_root_owned_mode() {
  local path="$1"
  local expected="$2"
  local actual
  actual="$(sudo stat -c '%u:%g:%a' "$path")"
  if [ "$actual" != "$expected" ]; then
    echo "Refusing rollback: unexpected ownership/mode for $path: $actual" >&2
    return 1
  fi
}

manifest_value() {
  local key="$1"
  sudo awk -F= -v key="$key" \
    '$1 == key { value = substr($0, index($0, "=") + 1); count++ }
     END { if (count != 1) exit 1; print value }' \
    "$manifest"
}

verify_sha256_asset() {
  local path="$1"
  local expected="$2"
  local actual
  if sudo test -L "$path" || ! sudo test -f "$path"; then
    return 1
  fi
  actual="$(sudo sha256sum -- "$path" | awk '{print $1}')"
  [ "$actual" = "$expected" ]
}

assert_find_empty() {
  local find_status=0
  local matches
  matches="$(sudo find "$@")" || find_status=$?
  [ "$find_status" -eq 0 ] || return "$find_status"
  [ -z "$matches" ]
}

verify_owned_assets() {
  local expected_nonce actual_nonce expected_binary expected_unit
  local expected_web_files expected_web_dirs actual_web_files actual_web_dirs
  local expected_root actual_root expected_marker actual_marker

  sudo test -d "$install_root" || return 1
  ! sudo test -L "$install_root" || return 1
  assert_root_owned_mode "$install_root" "0:0:755" || return 1
  sudo test -d "$marker" || return 1
  ! sudo test -L "$marker" || return 1
  assert_root_owned_mode "$marker" "0:0:700" || return 1
  sudo test -f "$manifest" || return 1
  ! sudo test -L "$manifest" || return 1
  sudo test -f "$nonce_file" || return 1
  ! sudo test -L "$nonce_file" || return 1
  sudo test -f "$web_manifest" || return 1
  ! sudo test -L "$web_manifest" || return 1
  assert_root_owned_mode "$manifest" "0:0:600" || return 1
  assert_root_owned_mode "$nonce_file" "0:0:600" || return 1
  assert_root_owned_mode "$web_manifest" "0:0:600" || return 1
  expected_marker="$(printf '%s\n' manifest nonce web.sha256 | LC_ALL=C sort)"
  actual_marker="$(sudo find "$marker" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" || return 1
  [ "$actual_marker" = "$expected_marker" ] || return 1

  expected_nonce="$(manifest_value nonce)" || return 1
  actual_nonce="$(sudo cat "$nonce_file")" || return 1
  [ "$expected_nonce" = "$actual_nonce" ] || return 1
  expected_binary="$(manifest_value binary_sha256)" || return 1
  expected_unit="$(manifest_value unit_sha256)" || return 1
  expected_web_files="$(manifest_value web_file_count)" || return 1
  expected_web_dirs="$(manifest_value web_dir_count)" || return 1
  verify_sha256_asset "$binary" "$expected_binary" || return 1
  verify_sha256_asset "$unit" "$expected_unit" || return 1
  sudo test -d "$bin_dir" || return 1
  ! sudo test -L "$bin_dir" || return 1
  assert_root_owned_mode "$bin_dir" "0:0:755" || return 1
  assert_root_owned_mode "$binary" "0:0:755" || return 1
  assert_root_owned_mode "$unit" "0:0:644" || return 1
  sudo test -d "$web_dir" || return 1
  ! sudo test -L "$web_dir" || return 1
  assert_root_owned_mode "$web_dir" "0:0:755" || return 1
  assert_find_empty "$web_dir" -type d '!' -user root -print -quit || return 1
  assert_find_empty "$web_dir" -type d '!' -group root -print -quit || return 1
  assert_find_empty "$web_dir" -type d '!' -perm 0755 -print -quit || return 1
  assert_find_empty "$web_dir" -type f '!' -user root -print -quit || return 1
  assert_find_empty "$web_dir" -type f '!' -group root -print -quit || return 1
  assert_find_empty "$web_dir" -type f '!' -perm 0644 -print -quit || return 1
  assert_find_empty "$web_dir" -mindepth 1 '!' '(' -type f -o -type d ')' -print -quit || return 1
  actual_web_files="$(sudo find "$web_dir" -type f | wc -l)" || return 1
  actual_web_dirs="$(sudo find "$web_dir" -type d | wc -l)" || return 1
  [ "$actual_web_files" = "$expected_web_files" ] || return 1
  [ "$actual_web_dirs" = "$expected_web_dirs" ] || return 1
  (
    cd "$web_dir"
    sudo sha256sum --check "$web_manifest"
  ) || return 1

  expected_root="$(printf '%s\n' '.systemd-fresh-install' bin web | LC_ALL=C sort)"
  actual_root="$(sudo find "$install_root" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" || return 1
  [ "$actual_root" = "$expected_root" ] || return 1
  [ "$(sudo find "$bin_dir" -mindepth 1 -maxdepth 1 -printf '%f\n')" = "dam-hopper-server" ] || return 1
}

if ! verify_owned_assets; then
  echo "Refusing rollback: marker inventory, ownership, or content verification failed" >&2
  exit 1
fi

service_query_status=0
service_load_state="$(sudo systemctl show -p LoadState --value dam-hopper.service)" || service_query_status=$?
if [ "$service_query_status" -ne 0 ]; then
  echo "Refusing rollback: unable to query dam-hopper.service load state" >&2
  exit "$service_query_status"
fi
service_query_status=0
service_active_state="$(sudo systemctl show -p ActiveState --value dam-hopper.service)" || service_query_status=$?
if [ "$service_query_status" -ne 0 ]; then
  echo "Refusing rollback: unable to query dam-hopper.service active state" >&2
  exit "$service_query_status"
fi
case "$service_load_state" in
  loaded|not-found)
    ;;
  *)
    echo "Refusing rollback: unknown dam-hopper.service load state: $service_load_state" >&2
    exit 1
    ;;
esac
case "$service_active_state" in
  active|activating|deactivating|reloading)
    sudo systemctl stop dam-hopper.service
    sudo systemctl disable dam-hopper.service
    ;;
  inactive|failed)
    case "$service_load_state" in
      loaded)
        sudo systemctl disable dam-hopper.service
        ;;
      not-found)
        ;;
    esac
    ;;
  *)
    echo "Refusing rollback: unknown dam-hopper.service active state: $service_active_state" >&2
    exit 1
    ;;
esac

service_query_status=0
service_active_state="$(sudo systemctl show -p ActiveState --value dam-hopper.service)" || service_query_status=$?
if [ "$service_query_status" -ne 0 ]; then
  echo "Refusing rollback: unable to re-check dam-hopper.service active state" >&2
  exit "$service_query_status"
fi
case "$service_active_state" in
  inactive|failed)
    ;;
  *)
    echo "Refusing rollback: service did not become inactive before deletion: $service_active_state" >&2
    exit 1
    ;;
esac
if [ "$service_load_state" = "loaded" ]; then
  main_pid_status=0
  main_pid="$(sudo systemctl show -p MainPID --value dam-hopper.service)" || main_pid_status=$?
  if [ "$main_pid_status" -ne 0 ]; then
    echo "Refusing rollback: unable to query dam-hopper.service main PID" >&2
    exit "$main_pid_status"
  fi
  if [ "$main_pid" != "0" ]; then
    echo "Refusing rollback: dam-hopper.service still has MainPID=$main_pid" >&2
    exit 1
  fi
  control_group_status=0
  control_group="$(sudo systemctl show -p ControlGroup --value dam-hopper.service)" || control_group_status=$?
  if [ "$control_group_status" -ne 0 ]; then
    echo "Refusing rollback: unable to query dam-hopper.service cgroup" >&2
    exit "$control_group_status"
  fi
  case "$control_group" in
    /system.slice/dam-hopper.service)
      ;;
    *)
      echo "Refusing rollback: unexpected service cgroup: $control_group" >&2
      exit 1
      ;;
  esac
  cgroup_mount_status=0
  sudo test -d /sys/fs/cgroup || cgroup_mount_status=$?
  if [ "$cgroup_mount_status" -ne 0 ]; then
    echo "Refusing rollback: unable to inspect the cgroup filesystem" >&2
    exit "$cgroup_mount_status"
  fi
  cgroup_root="/sys/fs/cgroup${control_group}"
  cgroup_root_status=0
  sudo test -d "$cgroup_root" || cgroup_root_status=$?
  if [ "$cgroup_root_status" -eq 0 ]; then
    proc_files_status=0
    proc_files="$(sudo find "$cgroup_root" -type f -name cgroup.procs -print)" || proc_files_status=$?
    if [ "$proc_files_status" -ne 0 ]; then
      echo "Refusing rollback: unable to inspect service cgroup processes" >&2
      exit "$proc_files_status"
    fi
    while IFS= read -r proc_file; do
      [ -n "$proc_file" ] || continue
      proc_contents_status=0
      proc_contents="$(sudo awk 'NF { print; exit }' "$proc_file")" || proc_contents_status=$?
      if [ "$proc_contents_status" -ne 0 ]; then
        echo "Refusing rollback: unable to inspect service cgroup process file: $proc_file" >&2
        exit "$proc_contents_status"
      fi
      if [ -n "$proc_contents" ]; then
        echo "Refusing rollback: service cgroup still contains a process: $proc_file" >&2
        exit 1
      fi
    done <<< "$proc_files"
  elif [ "$cgroup_root_status" -ne 1 ]; then
    echo "Refusing rollback: unable to inspect service cgroup" >&2
    exit "$cgroup_root_status"
  fi
fi
listener_status=0
sudo fuser -n tcp 4801 || listener_status=$?
if [ "$listener_status" -eq 0 ]; then
  echo "Refusing rollback: a process still owns port 4801" >&2
  exit 1
elif [ "$listener_status" -ne 1 ]; then
  echo "Unable to determine port 4801 ownership" >&2
  exit "$listener_status"
fi

if sudo test -f "$unit" && ! sudo test -L "$unit"; then
  sudo rm -f -- "$unit"
  sudo systemctl daemon-reload
fi
sudo rm -f -- "$binary"
if sudo test -d "$web_dir" && ! sudo test -L "$web_dir"; then
  sudo find "$web_dir" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  sudo rmdir -- "$web_dir"
fi
if sudo test -d "$bin_dir" && ! sudo test -L "$bin_dir"; then
  sudo rmdir -- "$bin_dir"
fi
sudo find "$marker" -mindepth 1 -maxdepth 1 -type f -delete
sudo rmdir -- "$marker"
```

The cleanup targets are exact first-install assets; the marker and absence gate prevent deleting a prior deployment. Then verify that `4801` is closed, no service descendant remains, and all user-owned runtime files retain their pre-install ownership/mode and timestamps where applicable. Rollback never removes `/home/loidinh/.config/dam-hopper`, the user token, session/telemetry databases, OPAQUE setup, project files, or collector state.

Rollback verifies the root-owned manifest before querying the system manager. It independently
accepts only the known `loaded`/`not-found` load states and known active states. If the unit is
active, activating, or stopping—even when its unit-file path has disappeared—it must be stopped
and disabled first; rollback then re-checks that the service is inactive. A loaded unit must also
have `MainPID=0`, the expected cgroup, and no remaining cgroup processes; a `not-found` unit has
no unit-owned cgroup and skips those loaded-unit checks. Port `4801` must be free before deleting
the verified assets. An unknown manager status or changed asset aborts the rollback.

Restoring the legacy nohup launch is optional and requires a separate administrator decision. Do it only after checking that no process owns the live databases and that exactly one intended process will own the legacy `4800` listener. This repository does not perform that cutover.

## Phase 03 verification status

Repository evidence recorded on 2026-08-20 is non-privileged and does not establish live ownership:

- PASS — historical unit invariants matched the planned identity, paths, loopback port, production auth guard, journald, restart, and SIGTERM fields.
- PASS — `systemd-analyze verify` succeeds in an isolated verifier root containing a placeholder executable; the direct checkout invocation reports only the expected absent `/opt/dam-hopper/bin/dam-hopper-server`.
- PASS — the runner's current focused systemd-service build/stage path covers backend tests, the release server build, server-only artifact checks, and isolated unit verification; browser UI tests/builds and native/Tauri packaging are outside this gate.
- PASS — Phase 01/02 fixture assertions, Bash syntax, JSON parsing, whitespace, and scoped forbidden-pattern checks.
- CAVEAT — native desktop packaging is outside the systemd service build gate.
- PASS — historical 2026-08-21 administrator run installed the marker-backed assets without starting, started the pre-wildcard unit as `loidinh` on loopback `127.0.0.1:4801`, served public health JSON and the same-origin SPA, rejected unauthenticated protected health with `401`, accepted a signed protected-route request with `200`, passed a restart with a new PID, exercised active-PTY/SIGTERM cleanup, passed bounded journald checks, and completed marker-backed rollback.
- PASS — final rollback checks found no installed assets, no unit, no 4800/4801 listener, and preserved the user runtime directory and ordered environment files with `700`/`600` metadata; the environment copy matched without displaying its contents.
- NOT RUN — optional external MongoDB smoke.

The complete redacted command ledger and evidence boundaries are in the [2026-08-21 acceptance report](../plans/reports/qa-260821-0142-linux-production-runner.md). The host is intentionally rolled back after acceptance, so no systemd unit is currently installed.

## Evidence boundaries and onboarding

Developer evidence can cover unit text, `systemd-analyze verify`, release/UI builds, the PTY disposal test, an isolated `4801` smoke run, and a Vite browser smoke run. It cannot prove root-owned installed assets, system-manager enablement, journald collection, or the effective UID of an installed unit.

The bounded journal acceptance check is available as
`bash scripts/phase-03-journal-check.sh`; it stores journal data only in a
temporary file, prints status flags, and exits nonzero if any required check is
unavailable or fails.

Administrator onboarding requires:

- a built server binary; any browser UI is a separately managed deployment;
- an existing `loidinh` config and private runtime state;
- an explicit maintenance window for the old `4800` ownership handoff;
- an administrator account allowed to install `/opt` assets and `/etc/systemd/system/dam-hopper.service`;
- a safe isolated state for restart-failure testing; and
- a retained host evidence record with tokens and response bodies redacted.

The requested administrator handoff is verified for this run. Only the optional
external MongoDB smoke remains outside this sign-off.
