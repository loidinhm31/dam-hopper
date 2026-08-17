# Phase 01 Manual Feasibility Results

- Date: 2026-08-17 (UTC)
- Evidence status: PASS — authoritative corrected rerun
- Phase delivery status: pending review at capture time
- Evidence source: non-privileged local smoke run as `loidinh`

## Scope and safety boundary

- Existing process `dam-hopper-server`, PID `289730`, owned `0.0.0.0:4800` before and after the authoritative run. It was not stopped or queried for database contents.
- Only `ss` listener metadata was collected for `4800`; no live config, SQLite database, token, or process environment was opened.
- Port `4801` was free before the authoritative run and closed after shutdown.
- Authentication stayed enabled. No `--no-auth` flag or `DAM_HOPPER_NO_AUTH` environment variable was used.
- A release binary had been built successfully by `pnpm build:server` before this smoke run.

## Build provenance

```text
binary: /home/loidinh/WS/dam-hopper-ws/systemd-system-service/server/target/release/dam-hopper-server
source revision: a5bdba17a8d7dc4c202c227b43dd2ecc513e142a
binary sha256: 889de326a45d4db927908da3b38c49d19f2d58a766ef5415875085e34425c648
```

## Authoritative isolated run

All paths below are literal paths from the authoritative run. The root was moved to recoverable user trash after evidence capture.

```text
/tmp/dam-hopper-phase01-4801-authoritative-WaUfyj                 mode 0700 owner 1000:1000
/tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/home            mode 0700 owner 1000:1000
/tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/xdg-config      mode 0700 owner 1000:1000
/tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/xdg-config/dam-hopper mode 0700 owner 1000:1000
/tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/work            mode 0700 owner 1000:1000
/tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/web             mode 0700 owner 1000:1000
/tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/project         mode 0700 owner 1000:1000
/tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/work/isolated-dam-hopper.toml mode 0600 owner 1000:1000
/tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/xdg-config/dam-hopper/server-token mode 0600 owner 1000:1000
/tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/xdg-config/dam-hopper/sessions.db mode 0600 owner 1000:1000
/tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/xdg-config/dam-hopper/opaque-server-setup mode 0600 owner 1000:1000
/tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/server.log mode 0600 owner 1000:1000
```

Distinct absolute paths configured:

```text
config:       /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/work/isolated-dam-hopper.toml
session DB:   /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/xdg-config/dam-hopper/sessions.db
telemetry DB: /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/xdg-config/dam-hopper/telemetry.db
token:        /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/xdg-config/dam-hopper/server-token
opaque setup: /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/xdg-config/dam-hopper/opaque-server-setup
web:          /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/web
working dir:  /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/work
```

Telemetry was explicitly configured but its file was absent because telemetry was disabled. This gate validates configured path isolation, not telemetry worker/database creation. All created runtime files were under the temporary root, UID `1000` (`loidinh`), mode `0600`.

## Exact redacted command ledger

The following is the safe command sequence for the authoritative run. The only substitutions are shell variables assigned to the literal paths shown; no token or JWT value is present.

```text
umask 077
ROOT=/tmp/dam-hopper-phase01-4801-authoritative-WaUfyj
BIN=/home/loidinh/WS/dam-hopper-ws/systemd-system-service/server/target/release/dam-hopper-server
FIXED_PATH=/usr/bin:/bin
mkdir -p "$ROOT/home" "$ROOT/xdg-config/dam-hopper" "$ROOT/work" "$ROOT/web" "$ROOT/project"
chmod 700 "$ROOT" "$ROOT/home" "$ROOT/xdg-config" "$ROOT/xdg-config/dam-hopper" "$ROOT/work" "$ROOT/web" "$ROOT/project"
printf '%s\n' '[workspace]' 'name = "phase-01-isolated-authoritative"' 'root = "."' '' '[[projects]]' 'name = "isolated-project"' 'path = "/tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/project"' 'type = "custom"' 'restart = "never"' 'restart_max_retries = 0' 'terminals = []' '' '[server]' 'session_db_path = "/tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/xdg-config/dam-hopper/sessions.db"' '' '[server.telemetry]' 'enabled = false' 'db_path = "/tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/xdg-config/dam-hopper/telemetry.db"' > /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/work/isolated-dam-hopper.toml
chmod 600 /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/work/isolated-dam-hopper.toml
printf '%s\n' '<!doctype html><title>isolated phase 01 authoritative</title>' > /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/web/index.html
chmod 600 /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/web/index.html
cd /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/work
env -i HOME=/tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/home XDG_CONFIG_HOME=/tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/xdg-config DAM_HOPPER_WEB_DIR=/tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/web RUST_LOG=info PATH=/usr/bin:/bin LC_ALL=C /home/loidinh/WS/dam-hopper-ws/systemd-system-service/server/target/release/dam-hopper-server --config /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/work/isolated-dam-hopper.toml --host 127.0.0.1 --port 4801 > /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/server.log 2>&1 &
```

Process environment keys were exactly `DAM_HOPPER_WEB_DIR,HOME,LC_ALL,PATH,RUST_LOG,XDG_CONFIG_HOME`; `PATH` was exactly `/usr/bin:/bin`. The process current directory was outside the repository and had no `.env` file. Readiness polling used `ss -ltn` with `rg -q ':4801[[:space:]]'` and a 20-second startup budget.

The readiness command was:

```text
READY=0
for _ in $(seq 1 100); do
  if ss -ltn 2>/dev/null | rg -q ':4801[[:space:]]'; then READY=1; break; fi
  if ! kill -0 1277653 2>/dev/null; then break; fi
  sleep 0.2
done
test "$READY" = 1
```

HTTP checks used status-only commands:

```text
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4801/api/health
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4801/api/projects
TOKEN_FILE=/tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/xdg-config/dam-hopper/server-token
TOKEN=$(<"$TOKEN_FILE")
b64url() { printf '%s' "$1" | base64 -w0 | tr '+/' '-_' | tr -d '='; }
HEADER=$(b64url '{"alg":"HS256","typ":"JWT"}')
PAYLOAD=$(b64url "{\"sub\":\"phase-01-authoritative\",\"exp\":$(($(date +%s)+900))}")
SIGNING_INPUT="$HEADER.$PAYLOAD"
SIGNATURE=$(printf '%s' "$SIGNING_INPUT" | openssl dgst -sha256 -hmac "$TOKEN" -binary | base64 -w0 | tr '+/' '-_' | tr -d '=')
JWT="$SIGNING_INPUT.$SIGNATURE"
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $JWT" http://127.0.0.1:4801/api/projects
unset TOKEN JWT SIGNATURE SIGNING_INPUT HEADER PAYLOAD
```

Path checks used this exact shell sequence; every existing-path command returned exit `0`, while the disabled telemetry DB `test ! -e` returned exit `0`:

```text
for path in /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj \
  /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/home \
  /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/xdg-config \
  /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/xdg-config/dam-hopper \
  /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/work \
  /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/web \
  /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/project \
  /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/work/isolated-dam-hopper.toml \
  /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/xdg-config/dam-hopper/server-token \
  /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/xdg-config/dam-hopper/sessions.db \
  /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/xdg-config/dam-hopper/opaque-server-setup \
  /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/server.log; do
  realpath -e "$path"
  stat -c '%n mode=%a owner=%u:%g' "$path"
done
case /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/work/isolated-dam-hopper.toml in /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/*) ;; *) exit 1 ;; esac
test /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/xdg-config/dam-hopper/sessions.db != /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/xdg-config/dam-hopper/telemetry.db
test ! -e /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/xdg-config/dam-hopper/telemetry.db
```

No response body or secret value was recorded.

Shutdown used this bounded sequence:

```text
kill -TERM 1277653
STOP_BOUND=20
STOP_BOUND_EXCEEDED=no
DEADLINE=$((SECONDS+STOP_BOUND))
while kill -0 1277653 2>/dev/null; do
  if (( SECONDS >= DEADLINE )); then STOP_BOUND_EXCEEDED=yes; break; fi
  sleep 0.2
done
wait 1277653; WAIT_RC=$?
test "$STOP_BOUND_EXCEEDED" = no
test "$WAIT_RC" = 0
rg -n -F 'Server shutdown complete' /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/server.log
! ss -ltn | rg -q ':4801[[:space:]]'  # exit 0 means 4801 is closed
test ! -e /proc/1277653
ss -ltn | rg -q ':4800[[:space:]]'
```

Cleanup moved only the exact temporary root to recoverable user trash:

```text
mkdir -p /home/loidinh/.local/share/Trash/files
mv -- /tmp/dam-hopper-phase01-4801-authoritative-WaUfyj /home/loidinh/.local/share/Trash/files/dam-hopper-phase01-4801-authoritative-WaUfyj
```

## Authoritative observed output

```text
2026-08-17T08:06:12Z identity=loidinh:1000
2026-08-17T08:06:12Z port_4801_before=free port_4800_before=occupied
2026-08-17T08:06:12Z server_pid=1277653 ready=1 effective_user=loidinh:1000
2026-08-17T08:06:12Z root_realpath=/tmp/dam-hopper-phase01-4801-authoritative-WaUfyj
2026-08-17T08:06:12Z config_realpath=/tmp/dam-hopper-phase01-4801-authoritative-WaUfyj/work/isolated-dam-hopper.toml
2026-08-17T08:06:12Z root_stat=mode=700 owner=1000:1000 config_stat=mode=600 owner=1000:1000
2026-08-17T08:06:12Z forbidden_env_absent=pass cmd_has_no_auth=no
2026-08-17T08:06:12Z /api/health status=200
2026-08-17T08:06:12Z unauthenticated /api/projects status=401
2026-08-17T08:06:12Z authenticated /api/projects status=200
2026-08-17T08:06:12Z paths_contained=pass db_paths_distinct=pass config_has_live_path=no telemetry_db_exists=no
2026-08-17T08:06:12Z realpath/stat exit=0 for every listed existing path; telemetry DB test exit=0 because disabled
2026-08-17T08:06:12Z path_stats: each listed directory mode=0700 owner=1000:1000; each listed file mode=0600 owner=1000:1000
2026-08-17T08:06:12Z token_present=yes token_length=32 token_mode=600; token value omitted
2026-08-17T08:06:12Z process_env_keys=DAM_HOPPER_WEB_DIR,HOME,LC_ALL,PATH,RUST_LOG,XDG_CONFIG_HOME
2026-08-17T08:06:12Z fixed_path=/usr/bin:/bin
2026-08-17T08:06:12Z SIGTERM wait_rc=0 stop_bound_seconds=20 stop_bound_exceeded=no shutdown_seconds=0.206
2026-08-17T08:06:12Z shutdown_marker="Server shutdown complete" marker_present=pass
2026-08-17T08:06:12Z marker_line=Server shutdown complete
2026-08-17T08:06:12Z listener_4801_after=closed descendants_after=none live_4800_after=present
2026-08-17T08:06:12Z token_in_log=absent
```

The server log contained the exact marker `Server shutdown complete`. The generated token secret remained in its isolated `0600` file; neither it nor the derived JWT was printed, logged, or stored in this report.

## Corrected-run note

Earlier evidence-capture attempts used an over-escaped listener matcher. Their listener fields were discarded. Only the authoritative run above is evidence for this phase; it used the corrected `:[port][[:space:]]` matcher and an absolute executable path.

## Supplementary process-group verification

A second isolated run verified process-group cleanup with `setsid` so the server owned its own process group. It used the same absolute binary, loopback `4801`, fixed environment, fresh paths, and no production state. This run was not used for the HTTP/auth gate; it supplemented child/process evidence.

```text
UTC: 2026-08-17T08:44:06Z
root: /tmp/dam-hopper-phase01-4801-process-group-uIBwG1
command: setsid env -i HOME=/tmp/dam-hopper-phase01-4801-process-group-uIBwG1/home XDG_CONFIG_HOME=/tmp/dam-hopper-phase01-4801-process-group-uIBwG1/xdg-config DAM_HOPPER_WEB_DIR=/tmp/dam-hopper-phase01-4801-process-group-uIBwG1/web RUST_LOG=info PATH=/usr/bin:/bin LC_ALL=C /home/loidinh/WS/dam-hopper-ws/systemd-system-service/server/target/release/dam-hopper-server --config /tmp/dam-hopper-phase01-4801-process-group-uIBwG1/work/isolated-dam-hopper.toml --host 127.0.0.1 --port 4801
pid=1310796 pgid=1310796 ready=1 identity=loidinh:1000
group_before: one process, PID/PGID 1310796, no children
health_status=200
wait_rc=0 stop_bound_exceeded=no shutdown_seconds=0.205
parent_after_wait=absent
group_after_wait=empty
listener_4801_after=closed live_4800_after=present
shutdown_marker=present
cleanup_tmp_root=absent
```

The process-group root was moved to `/home/loidinh/.local/share/Trash/files/dam-hopper-phase01-4801-process-group-uIBwG1`; it contains only disposable isolated test state. Both retained test roots are user-private and contain no production token or database.

## Gate decision

Phase 01 local feasibility passes. The server ran as `loidinh` with explicit isolated paths, loopback binding, authentication, and graceful SIGTERM shutdown on `4801`. At evidence capture time, the plan phase remained pending until this evidence was reviewed and approved; the review is now complete and Phase 01 is marked done.

## Not tested — administrator/future phases

- systemd unit syntax, root-owned unit/binary/web assets, enable/start, journald, and effective UID under the system manager;
- `Restart=on-failure` behavior;
- production `4800` cutover or live SQLite ownership handoff;
- rollback of an installed unit and preservation of user-owned state;
- production `/opt/dam-hopper/web` UI assets or external-UI CORS choice.

These checks belong to later phases and require administrator evidence where noted by the plan. The disabled telemetry DB creation and systemd restart behavior are intentionally outside this API-only gate.

## Unresolved questions

- Phase 02 must choose same-process `/opt/dam-hopper/web` hosting versus an external UI host and exact CORS allowlist.
- An accepting administrator and retention location for signed host evidence remain unspecified.
