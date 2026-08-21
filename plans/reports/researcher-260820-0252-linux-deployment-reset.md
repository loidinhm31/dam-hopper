# Linux deployment/reset research

Historical report for a superseded predecessor plan. Current acceptance status
is maintained by `../260820-0912-revalidation-build-run-service/`.

Date: 2026-08-20 02:52 Asia/Saigon
Scope: read-only repository and host inspection; commands below are proposals, not executed.
Repository: `/home/loidinh/WS/dam-hopper-ws/systemd-system-service`

## Executive result

The repository supports two launch modes:

1. Legacy user `nohup` on port `4800`, using `~/.config/dam-hopper/bin`, `server.conf`, PID, and append-only log files (`deploy/run-linux-nohup.sh:4-10,127-149`; `docs/linux-nohup.md:25-31`).
2. Production-style systemd on `127.0.0.1:4801`, using root-owned `/opt/dam-hopper` binary/web assets but user-owned config and databases (`deploy/systemd/dam-hopper.service:6-26`; `docs/linux-systemd.md:5-23`).

The safest reset is a controlled ownership handoff: stop and disable both launch mechanisms, verify no server process/listener/database owner remains, quarantine only deployment artifacts, and preserve all user runtime state. Do not delete the user config, token, OPAQUE setup, SQLite databases, project trees, or agent-store data by default.

The live host is not in the state implied by the repository’s older systemd notes: host inspection found an installed, enabled but inactive unit and installed `/opt` assets. It found no running `dam-hopper-server` and no listener on `4800` or `4801`. Existing validation reports still correctly say that their administrator acceptance was not evidence of installation (`plans/260817-1216-systemd-system-service/reports/03-verification-results.md:87-101`); the current host check is separate evidence.

## Current build and artifact map

| Concern | Current command/path | Evidence |
|---|---|---|
| Web production build | `pnpm build` → `apps/web/dist/` | `package.json:11`; `docs/linux-systemd.md:31-38`; `docs/system-architecture.md:7-14` |
| Rust release build | `pnpm build:server` → `server/target/release/dam-hopper-server` | `package.json:19`; `README.md:30-37` |
| Full repository check | `pnpm check` builds web/native, lints, tests Rust | `package.json:30` |
| Nohup installed binary | `~/.config/dam-hopper/bin/dam-hopper-server` | `deploy/run-linux-nohup.sh:4-10,96-105` |
| Nohup configuration | `~/.config/dam-hopper/server.conf`; exported into child environment | `deploy/run-linux-nohup.sh:63-80,108-116,140-145` |
| Nohup state | `server.pid`, `output.log` | `deploy/run-linux-nohup.sh:4-9,145-149,151-170` |
| Systemd binary | `/opt/dam-hopper/bin/dam-hopper-server` | `deploy/systemd/dam-hopper.service:13-16`; `docs/linux-systemd.md:80-84` |
| Systemd web assets | `/opt/dam-hopper/web` | `deploy/systemd/dam-hopper.service:13`; `docs/linux-systemd.md:5-9` |
| Container binary/web | `/usr/local/bin/dam-hopper-server`, `/opt/dam-hopper/web` | `Dockerfile:49-62` |

The Rust server serves the SPA/API from one origin when `DAM_HOPPER_WEB_DIR` is set (`deploy/systemd/dam-hopper.service:13-16`; `docs/linux-nohup.md:88-91`). The Dockerfile is a single application image, not a database stack: it has no Compose file, Mongo image, volume, or Mongo initialization asset. MongoDB is an optional externally supplied connection, only created when both `MONGODB_URI` and `MONGODB_DATABASE` are present (`server/src/main.rs:253-263`; `server/Cargo.toml:148-152`). The only repository Mongo strings are comments/docs/tests; no repository-managed Mongo data can be reset safely.

## Runtime data and preservation policy

The server always opens session persistence, defaulting to `~/.config/dam-hopper/sessions.db` (`server/src/main.rs:131-170`; `server/src/config/schema.rs:241-243,347-365`). Optional telemetry defaults to `~/.config/dam-hopper/telemetry.db` (`server/src/config/schema.rs:249-251,283-315`). Startup also creates/loads:

- `~/.config/dam-hopper/server-token` (`server/src/main.rs:364-438`)
- `~/.config/dam-hopper/opaque-server-setup` (`server/src/main.rs:265-267`)
- `~/.config/dam-hopper/dam-hopper.toml` and `config.toml` through global/config resolution (`server/src/config/resolve.rs:12-16`; `server/src/config/global.rs:9-24`)
- workspace `.dam-hopper/agent-store` by configured workspace path (`server/src/main.rs:235-243`)

Preserve by default: `dam-hopper.toml`, `config.toml`, `server-token`, `opaque-server-setup`, `sessions.db`, `telemetry.db`, `server.conf`, project repositories, workspace files, `.dam-hopper/`, and MongoDB data outside this repository. Preserve `output.log` for diagnosis unless its size is an operational issue; rotate/quarantine rather than purge.

Destructive/data-purge tier, requiring an explicit separate approval: delete or recreate `sessions.db` (loses sessions and scrollback), `telemetry.db` (loses usage history), `server-token` (invalidates clients), `opaque-server-setup` (invalidates OPAQUE state), global/workspace TOML (loses registry/preferences), project trees, `.dam-hopper/agent-store`, or external MongoDB collections. A fresh binary/web deployment does not require any of these.

## Host state observed (2026-08-20)

Read-only checks returned:

- `systemctl is-enabled dam-hopper.service`: `enabled`.
- `systemctl is-active dam-hopper.service`: `inactive` / `dead`; `MainPID=0`; installed fragment `/etc/systemd/system/dam-hopper.service`.
- Installed unit matches the repository unit: `User=loidinh`, `HOME=/home/loidinh`, `XDG_CONFIG_HOME=/home/loidinh/.config`, web dir `/opt/dam-hopper/web`, `RUST_ENV=production`, explicit `127.0.0.1:4801`, journald output, `Restart=on-failure`.
- No running server process and no `4800`/`4801` listener were observed. The only `pgrep` match was the inspection shell itself; do not use that literal output as a server PID.
- User runtime directory exists as mode `0700`, owned by `loidinh`; config, token, OPAQUE setup, sessions DB, and telemetry DB were mode `0600`, owned by `loidinh`.
- Nohup binary exists mode `0755`, but `server.pid` and `output.log` exist with mode `0644`; the PID is stale or requires identity verification because no server process is running. The log is about 49 MiB and should be retained/quarantined, not silently deleted.
- `/opt/dam-hopper`, its binary, and web tree exist root-owned with expected broad modes; `.systemd-fresh-install` exists but its contents were not read because the unprivileged user could not inspect the root-owned marker. Do not remove `/opt` until the marker/manifest is inspected by an administrator.
- Docker is running unrelated `glean-oak-host` and Playwright/Jenkins containers. No Mongo container or listener on `27017` was observed. Do not stop or remove those containers as part of this reset without separate ownership evidence.

## Proposed safest clean-reset sequence

Run interactively as an administrator where marked. These are proposed commands only.

### 1. Snapshot identities and exact paths

```bash
set -euo pipefail
repo=/home/loidinh/WS/dam-hopper-ws/systemd-system-service
runtime=/home/loidinh/.config/dam-hopper
stamp="$(date +%Y%m%d-%H%M%S)"
quarantine=/home/loidinh/.local/share/Trash/files/dam-hopper-reset-$stamp
install_root=/opt/dam-hopper

systemctl show dam-hopper.service -p FragmentPath -p MainPID -p ActiveState -p SubState
pgrep -af -- '(^|/)dam-hopper-server([[:space:]]|$)' || true
ss -ltnp | rg ':(4800|4801)([[:space:]]|$)' || true
stat -c '%n %F %a %u:%g %s' "$runtime" "$runtime"/* "$install_root" 2>/dev/null || true
```

Do not copy or print token/config contents into evidence. Before any stop, identify a PID by `/proc/$pid/exe`, command line, owner, and exact listener; never kill by a broad `pkill` pattern.

### 2. Stop and disable every DamHopper owner

```bash
# systemd: administrator command
sudo systemctl disable --now dam-hopper.service
sudo systemctl reset-failed dam-hopper.service || true

# nohup: run as loidinh from the repository, after checking the PID identity
pnpm server:stop
```

Then verify, and stop the reset if any check fails:

```bash
systemctl is-active dam-hopper.service
pgrep -af -- '(^|/)dam-hopper-server([[:space:]]|$)' || true
ss -ltnp | rg ':(4800|4801)([[:space:]]|$)' || true
sudo fuser -v "$runtime/sessions.db" "$runtime/telemetry.db" || true
```

The nohup helper sends `SIGTERM`, waits 6 seconds, then uses `SIGKILL` (`deploy/run-linux-nohup.sh:151-170`). The systemd unit allows 20 seconds and the server’s SIGTERM path snapshots PTY buffers, disposes tunnels/artifacts, shuts telemetry down, and joins persistence (`deploy/systemd/dam-hopper.service:19-22`; `server/src/main.rs:317-360`). If either mode fails to stop, investigate its exact process group before touching databases or assets.

### 3. Quarantine reversible deployment residue

After confirming no process/database owner remains, prefer an exact, recoverable move over deletion. Use an administrator-owned quarantine only for paths whose ownership is confirmed:

```bash
sudo install -d -o loidinh -g loidinh -m 0700 "$quarantine"

# Move only legacy launch artifacts; preserve config and all user data.
for p in "$runtime/bin/dam-hopper-server" "$runtime/server.pid" "$runtime/output.log"; do
  sudo test -e "$p" && sudo mv -- "$p" "$quarantine/"
done

# Move the installed systemd deployment only after inspecting and matching
# /opt/dam-hopper/.systemd-fresh-install/manifest.
sudo systemctl disable dam-hopper.service
sudo mv -- /etc/systemd/system/dam-hopper.service "$quarantine/"
sudo systemctl daemon-reload
sudo mv -- /opt/dam-hopper "$quarantine/"
```

The final two moves are not safe for an upgrade or an unverified pre-existing deployment. The repository’s marker-guarded rollback explicitly refuses mismatched ownership/content (`docs/linux-systemd.md:260-317`); use that guard or an administrator backup rather than an unconditional `rm -rf`.

### 4. Validate clean state before a fresh production-style install

```bash
test ! -e /etc/systemd/system/dam-hopper.service
test ! -e /opt/dam-hopper
! pgrep -af -- '(^|/)dam-hopper-server([[:space:]]|$)'
! ss -ltnp | rg ':(4800|4801)([[:space:]]|$)'
sudo fuser -v "$runtime/sessions.db" "$runtime/telemetry.db"; test "$?" -eq 1
sudo -u loidinh test -r "$runtime/dam-hopper.toml" -a -r "$runtime/sessions.db"
```

If retaining the legacy nohup mode instead, do not remove the runtime directory; reinstall only the binary and explicitly set `DAM_HOPPER_WEB_DIR` to a separately built readable `apps/web/dist` if the same process must serve the UI (`docs/linux-nohup.md:88-91`).

### 5. Fresh build/install choice

Preferred systemd path:

```bash
pnpm install --frozen-lockfile
pnpm build:server
env -u VITE_DAM_HOPPER_SERVER_URL pnpm build
pnpm test
pnpm lint
systemd-analyze verify deploy/systemd/dam-hopper.service
test -x server/target/release/dam-hopper-server
test -f apps/web/dist/index.html
```

Then use the existing guarded administrator handoff in `docs/linux-systemd.md:75-397`; it stages exact root-owned binary/web/unit assets, verifies hashes and modes, daemon-reloads, and enables/starts only after preflight. It intentionally does not copy `.env`, token, databases, or other runtime state (`docs/linux-systemd.md:59-69,374-397`).

## Simple build/run script vs systemd

| Option | Benefits | Risks/limitations | Exact files to change if selected |
|---|---|---|---|
| Simple user script | Low setup cost; works without root; existing `pnpm server:*` interface | PID file is not a supervisor; stale/reused PID risk; `nohup` log grows; no boot/start/restart policy; `SIGKILL` fallback can truncate persistence; current script defaults legacy `4800` and does not install web assets | `deploy/run-linux-nohup.sh:4-207`, `package.json:20-24`, `docs/linux-nohup.md:1-100`, `README.md:42-63`; add/update a narrowly scoped production script rather than mixing it with systemd |
| systemd-managed | Cgroup ownership, boot enablement, restart policy, journald, explicit user/paths, bounded stop, no shell/PID wrapper | Requires administrator install; hardcoded `/opt`, unit ownership, daemon reload; current repository asset uses isolated `4801`, so it must be an intentional cutover from `4800` | Existing `deploy/systemd/dam-hopper.service:1-30` and `docs/linux-systemd.md:1-397`; no Rust implementation change required for the documented path |

Recommendation: use systemd for production-style execution and retain nohup only as a documented legacy/development fallback. Do not run both against the same SQLite files, even on different ports (`docs/linux-systemd.md:7-11,59-69`; `docs/system-architecture.md:59-62`).

## Exact follow-up changes for a new clean-reset/fresh-install script

No implementation files should be changed for this investigation. If the next task implements automation, constrain changes to:

1. New `deploy/reset-linux-production.sh` (or an explicitly named replacement) with exact-path allowlists, PID identity checks, `systemctl`/nohup handoff, manifest verification, recoverable quarantine, and a separate explicit `--purge-data` gate.
2. `deploy/systemd/dam-hopper.service` only if production port/path/user/environment changes; otherwise reuse it unchanged.
3. `deploy/run-linux-nohup.sh` only if nohup remains supported; fix stale PID validation and document web asset handling rather than allowing a second owner.
4. `package.json` for new script aliases (`package.json:20-24`).
5. `docs/linux-systemd.md`, `docs/linux-nohup.md`, and `README.md` for the chosen ownership/cutover contract and exact rollback behavior.
6. `docs/system-architecture.md` only if the canonical launch mode/port changes; it currently records `4801` systemd and `4800` legacy (`docs/system-architecture.md:18,59-62`).

Do not add Mongo/Docker cleanup to this script. The repository has no Mongo orchestration assets, and Docker currently contains unrelated containers.

## Risks

- Starting systemd without stopping nohup can create two writers/readers of the same SQLite databases; the different ports do not make that safe.
- A stale/reused PID can make the nohup helper signal an unrelated process; verify `/proc` identity before any signal.
- `kill -9`, deleting SQLite files, or removing OPAQUE/token state can cause data loss or authentication invalidation.
- Moving `/opt` or `/etc/systemd/system/dam-hopper.service` without verifying the fresh-install marker can remove an administrator-owned upgrade or unrelated deployment.
- Copying `.env` or runtime secrets into `/opt` or a Docker image leaks credentials; the systemd docs explicitly prohibit this.
- `MONGODB_URI`/`MONGODB_DATABASE` may be supplied by an environment not visible in repository files; do not infer Mongo data absence solely from the repository.
- The installed root-owned marker was not readable as `loidinh`; administrator inspection is required before any deployment-artifact removal.

## Unresolved questions

1. Is `/opt/dam-hopper/.systemd-fresh-install/manifest` the repository’s first-install marker or an administrator-managed upgrade marker?
2. Should production remain on loopback `4801` behind a local reverse proxy, or should the service expose a trusted network/Tailscale address? The repository warns about cleartext authenticated non-loopback HTTP (`docs/linux-nohup.md:59`).
3. Is MongoDB intentionally absent on this host, or is an external URI injected by a private environment/service manager?
4. Should the fresh reset preserve legacy `server.conf`/log/binary in quarantine indefinitely, or is there an approved retention period?
5. What administrator-owned backup/evidence location should receive the marker, unit, `/opt` assets, and redacted service acceptance output?
