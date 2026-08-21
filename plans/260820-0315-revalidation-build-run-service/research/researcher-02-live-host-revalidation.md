# Researcher 02 — live host revalidation

> Historical research from the superseded revalidation sequence. Current acceptance status is maintained by the [successor revalidation plan](../../260820-0912-revalidation-build-run-service/plan.md).

Date: 2026-08-20 03:19 Asia/Saigon
Scope: read-only Linux host checks for the build/run-service plan. No service,
container, process, file, or host state was started, stopped, removed, or changed.

## Executive result

The host is in an installed-but-not-running state. The systemd unit is enabled,
but inactive/dead with `MainPID=0`; neither planned port is listening and no
exact-name DamHopper process exists. Legacy nohup residue is present and its PID
file is stale. `/opt` deployment assets and private runtime files are present
with expected ownership/modes. Local MongoDB is unavailable/not observed;
Docker is available and unrelated containers remain running.

## Findings

| Check | Result | Redacted evidence |
|---|---|---|
| systemd enabled | PASS | `dam-hopper.service`: `enabled` |
| systemd active | STALE / FAIL for active-run acceptance | `inactive`, `dead` |
| MainPID | PASS for clean state | `MainPID=0`; no process identity to report |
| fragment | PASS | `/etc/systemd/system/dam-hopper.service`, root-owned, mode `0644` |
| configured service identity | PASS | `User=loidinh`, `Group=loidinh`; executable path `/opt/dam-hopper/bin/dam-hopper-server`; loopback port `4801` |
| listeners | PASS for clean reset | no TCP listeners on `4800` or `4801` |
| DamHopper process | PASS for clean reset | no exact-name `dam-hopper-server` process; no command-line contents read |
| database files | PASS ownership/mode | `sessions.db` and `telemetry.db`: `loidinh:loidinh`, mode `0600` |
| database process owners | PASS within unprivileged visibility | `fuser` and `lsof` reported no open owner for either DB; DB contents were not read |
| `/opt` binary/web | PASS | root-owned: root `0755`, `bin` `0755`, server binary `0755`, `web` `0755`, `web/index.html` `0644`; expected asset directories observed |
| fresh-install marker | UNKNOWN | `/opt/dam-hopper/.systemd-fresh-install` exists, root-owned mode `0700`; marker/manifest not readable by `loidinh` |
| user runtime directory | PASS | `/home/loidinh/.config/dam-hopper`: `loidinh:loidinh`, mode `0700` |
| private runtime files | PASS | token/setup/config/server.conf/database/key files observed as `loidinh:loidinh`, mode `0600`; values/contents omitted |
| nohup binary | STALE residue | `~/.config/dam-hopper/bin/dam-hopper-server`: `loidinh:loidinh`, mode `0755` |
| nohup PID | STALE | `server.pid` exists mode `0644`; numeric target process is absent |
| nohup log | STALE residue | `output.log` exists mode `0644`, approximately 49 MiB; contents not read |
| Docker | PASS availability / scope | Docker client/daemon responds; two unrelated running containers listed; none changed |
| MongoDB | NOT OBSERVED | no Mongo-named container, `mongod` service/process, Mongo CLI, or `27017` listener |

## Exact deployment/runtime metadata

- `/opt/dam-hopper`: root:root `0755`.
- `/opt/dam-hopper/bin`: root:root `0755`.
- `/opt/dam-hopper/bin/dam-hopper-server`: root:root `0755`.
- `/opt/dam-hopper/web`: root:root `0755`.
- `/opt/dam-hopper/web/index.html`: root:root `0644`.
- `/opt/dam-hopper/.systemd-fresh-install`: root:root `0700`; contents not read.
- `/home/loidinh/.config/dam-hopper`: loidinh:loidinh `0700`.
- `server.conf`, `server-token`, `opaque-server-setup`, both DB files, TOML,
  telemetry/key files: loidinh:loidinh `0600`; values/contents omitted.
- `server.pid.start`: loidinh:loidinh `0600`; `server.pid`: `0644`.

## Evidence gaps / unresolved questions

1. `sudo` is installed at `/usr/bin/sudo`, but non-interactive elevation failed
   exactly with: `sudo: a password is required`. Root-only marker/manifest
   contents, root-visible process/file handles, and administrator-level `/opt`
   verification remain unconfirmed.
2. Is the root-owned `.systemd-fresh-install` marker an authorized fresh install,
   and what manifest should an administrator verify before quarantine?
3. Should this revalidation target an intentionally inactive clean-reset state,
   or must an administrator later perform the active `4801` acceptance run?
4. Is MongoDB intentionally external/absent, or is a private URI injected by an
   environment not visible to these read-only checks?
5. Retention/quarantine approval for the stale PID and approximately 49 MiB log
   is unresolved; no cleanup was attempted.

Secret handling: no dotenv, token, database, log, command-line, or unit-content
values were read or written. Evidence is limited to redacted metadata and state.
