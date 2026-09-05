# Research Report: Fedora 44 systemd transaction runtime

**Conducted:** 2026-09-03 (Asia/Saigon)  
**Scope:** accepted *Manifest-Gated Immutable Release with Role-Selected Dual systemd Services*; Fedora 44 x86_64, glibc 2.43, systemd 259. Prior atomic-systemd research is treated as validated input; this report narrows it to runtime, identity, state, and migration.

## Recommendation

Use the release CLI as the transaction coordinator; use systemd only for independent process supervision. Install stages and verifies an immutable candidate but does not start it. Explicit activation stops the selected old units, switches to the exact candidate, starts them, probes both direct ports, and commits only after an exact-version health stability window. `Restart=on-failure` is crash supervision, **not** release rollback ([systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)).

Ship one lockstep Fedora archive containing `dam-hopper` (manager), `dam-hopper-server`, `dam-hopper-web`, service templates, and the built `apps/web/dist`. Role selection determines ownership, not versions:

| Role | Runtime owned | Unit/port |
|---|---|---|
| server | CLI + API | `dam-hopper-api.service`, `0.0.0.0:4801` |
| web | CLI + web host + `dist` | `dam-hopper-web.service`, `0.0.0.0:4802` |
| both | all payloads | both units, one activation transaction |

Do not couple API and web with `Requires=`. A target may `Wants=`/order both, but health and rollback belong to the CLI; systemd dependency relationships do not provide application readiness or version rollback ([systemd.unit](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html)).

## Repository evidence and migration implications

- `deploy/systemd/dam-hopper.service:1-30` is one `Type=simple` unit, `User=loidinh`, fixed `/opt/dam-hopper/bin/dam-hopper-server`, explicit home/config env, port 4801, `Restart=on-failure`, `KillMode=mixed`, and `NoNewPrivileges=false`. New units must not silently preserve that weaker policy.
- `deploy/run-linux-production.sh:5-15,122-140,794-1005` is backend-only, marker format 2, and deliberately separates `install` (enable, never start) from `start`. Its preflight rejects exact server processes, SQLite holders, and occupied legacy 4800/4801. Preserve these fail-closed checks while replacing the single fixed path with role-aware release metadata.
- `deploy/reset-linux-production.sh:36-55,145-176,249-320,671-718` treats `/home/loidinh/.config/dam-hopper` as user runtime, validates private dotenv ownership, and has a destructive marker-backed purge plus a state-preserving runtime-only repair. Migration must not require that purge; unknown or drifted assets should enter recovery instead.
- `server/src/main.rs:24-60,131-153,379-441` defaults the server to `0.0.0.0:4800`, loads dotenv, derives config/token/session paths from `HOME`/`XDG_CONFIG_HOME`, and persists SQLite sessions. The API also owns PTY/build/SSH-adjacent capabilities; its identity cannot be treated like a static web account.
- `server/src/api/router.rs:65-72,426-467` exposes `/api/health`, currently serves SPA fallback through `ServeDir`, and reads `DAM_HOPPER_WEB_DIR` (default `/opt/dam-hopper/web`). The accepted cutover must remove static ownership from the API and make API 404s remain API 404s.
- `server/src/api/settings.rs:83-92` returns `{status:"ok", version:CARGO_PKG_VERSION}`. Use it as the API probe, but require a dedicated web health/version response so an HTML fallback cannot pass activation.
- `apps/web/vite.config.ts:12-29,44-72` rejects a backend URL during production builds, marks packaged builds same-origin, and emits Vite’s `dist` payload. `package.json:11-28` confirms Node/pnpm/Cargo are build-time tools, not target runtime requirements.
- `tests/deploy/linux-production-fixtures.sh:537-550,676-745` records current install-without-start, marker-backed rollback, legacy format handling, and runtime preservation as contract touchpoints. No tests or validation commands were run for this report.

## Units, boundaries, and tiny web host

**API unit (`dam-hopper-api.service`).** Initially retain `User=loidinh`/`Group=loidinh`: PTY, project, SSH, and home-based state currently require it. Never run as root. Set `HOME`, `XDG_CONFIG_HOME`, `WorkingDirectory`, config/state paths, and the exact release executable explicitly. Prefer `Type=exec` so missing executable/user failures reach `systemctl`; current source has no `sd_notify` readiness protocol, so HTTP health remains the coordinator’s gate. Use `Restart=on-failure`, bounded restart limits, `KillMode=control-group` (the default; it kills descendants on stop), `TimeoutStopSec` compatible with graceful PTY shutdown, `NoNewPrivileges=yes`, minimal capabilities, `ProtectSystem=strict`, and narrowly declared write paths. Do **not** enable `ProtectHome=yes` until workspace and SSH requirements are redesigned; scope read/write access instead ([systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html), [systemd.kill](https://www.freedesktop.org/software/systemd/man/latest/systemd.kill.html)).

**Web unit (`dam-hopper-web.service`).** Use a separate fixed unprivileged `dam-hopper-web` identity. Read only the selected release’s `web/` tree; no API env, token, SQLite, project/repository, upload, or `/home/loidinh` access. `ProtectHome=yes`, `ProtectSystem=strict`, `PrivateTmp=yes`, no capabilities, and cgroup cleanup are appropriate. The deliberately small Rust host serves only GET/HEAD, MIME-correct static files, SPA `index.html` fallback for non-file routes, conservative index/version caching, and exact `/__dam-hopper/health` + release version. No directory listing, writes/uploads, proxy/admin API, runtime JS, or Node dependency.

Direct ports are accepted for v1, but wildcard binds require host firewall/Tailscale controls and authentication. Web-only hosts pointing at a remote API need exact HTTP CORS and WebSocket origin allowlists; credentials must not be widened to `*` (the router rejects wildcard origins).

## Filesystem and role state

Keep release bytes and mutable state disjoint:

```text
/opt/dam-hopper/releases/<tag>/       root-owned immutable CLI/API/web + dist
/opt/dam-hopper/.staging/<txn>/       root-only candidate extraction
/opt/dam-hopper/current -> releases/* human convenience pointer only
/usr/local/bin/dam-hopper              root-owned manager entrypoint
/etc/systemd/system/dam-hopper-*.service
/var/lib/dam-hopper-manager/           active, previous, pending, journal, backups
/home/loidinh/.config/dam-hopper/      existing API config, token, SQLite, user state
```

`active` metadata is authoritative; a symlink is convenience and may lag after a crash. Manager updates active/journal files with temp-file + `rename()` and directory `fsync()`; `rename()` gives atomic visibility, while `fsync()` is needed for crash durability ([rename(2)](https://man7.org/linux/man-pages/man2/rename.2.html), [fsync(2)](https://man7.org/linux/man-pages/man2/fsync.2.html)). Unit files must contain concrete, verified release paths and be root-owned; do not let a service follow a mutable executable path.

A role change is explicit. Server-only and web-only activation touch only their selected unit/files; both-role activation switches API and web together. Any candidate whose manifest has unequal CLI/API/web versions, wrong profile, or partial role inventory is rejected before privileged writes. For one initial host profile, retain at least active plus one previous known-good release; GC must protect active, previous, pending, staged, and journal-referenced trees.

## Pending install and health-gated activation

1. **Acquire/stage:** download as invoking user, resolve `latest` once to an exact tag, verify manifest/archive hashes and chosen attestation/signature, reject traversal/device/unapproved links, then acquire a root deployment lock. Verify Fedora profile, inventory, owners, modes, unit syntax (`systemd-analyze verify`), and role.
2. **Install:** atomically retain the immutable candidate under `/opt`; install only selected units; `daemon-reload`; write durable `pending` with candidate/old versions, role, hashes, unit hashes, and transaction ID. Leave old pointer, processes, and health untouched; fresh install remains disabled/inactive.
3. **Activate:** under the same lock, reconcile pending/journal; snapshot state only under the migration policy; stop selected old units; prove their cgroups empty and 4801/4802 listeners released; record `QUIESCED`; switch concrete units and authoritative active metadata atomically; `daemon-reload`; start selected candidate units.
4. **Probe/commit:** verify systemd active/MainPID, executable path, expected UID, listener, API JSON health/version, web health/version, and (if applicable) public routes. Keep probing through a chosen stability window. Only then mark `COMMITTED`, move old to `previous`, clear pending, and enable the committed units.

Rollback on candidate start/health/early-crash failure: stop candidate units, prove cgroups/listeners clear, restore old units and active metadata, reload, restart old selected units, and verify old exact versions/health. Preserve candidate and failure reason. First-install failure restores no active release and disabled units. Report rollback success only when old health succeeds.

Crash recovery journal states: `ABSENT|ACTIVE → STAGED → PENDING → QUIESCED → SWITCHED → PROBING → COMMITTED`. Crash before switch keeps old active; after switch but before durable commit conservatively restores old; after durable commit keeps candidate and repairs convenience pointers. Any pointer/journal/version mismatch is `RECOVERY_REQUIRED`; never guess or delete the only known-good tree.

## Rollback limits and acceptance risks

Rollback covers immutable release files, selected unit definitions, active/previous pointers, and managed service processes. It cannot atomically undo arbitrary SQLite migrations, external MongoDB/schema changes, user-written data, token rotation, filesystem changes made by API jobs, package/SELinux/firewall/TLS changes, or processes/listeners outside the managed cgroups. Therefore lockstep releases must remain backward-compatible with the immediately previous supported state; breaking migrations need a separate maintenance/backup design. A post-commit crash is normally handled by systemd restart policy, not automatic version reversal: inferring that a release caused every later crash risks data loss and rollback loops.

Highest acceptance risks: API identity remains broad (`loidinh`); web isolation can regress through unit drop-ins or symlinks; `Type=exec` is not readiness; HTML 200 can masquerade as health; a different port does not make two SQLite owners safe; Fedora SELinux labels may reject new paths; and direct wildcard ports depend on host policy outside installer scope. Validate effective sandboxing and labels on the actual Fedora 44/systemd 259 host, not only with static unit syntax.

## Primary sources

- [systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html), [systemd.unit](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html), [systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html), [systemd.kill](https://www.freedesktop.org/software/systemd/man/latest/systemd.kill.html)
- [systemd-sysusers](https://www.freedesktop.org/software/systemd/man/latest/systemd-sysusers.html), [systemd-analyze](https://www.freedesktop.org/software/systemd/man/latest/systemd-analyze.html)
- [Filesystem Hierarchy Standard](https://refspecs.linuxfoundation.org/FHS_3.0/fhs-3.0.html), [rename(2)](https://man7.org/linux/man-pages/man2/rename.2.html), [fsync(2)](https://man7.org/linux/man-pages/man2/fsync.2.html)

## Unresolved questions

1. Exact unit rendering/pointer mechanism: concrete per-release `ExecStart` versus a generated `EnvironmentFile`; what is the compatibility policy for legacy `dam-hopper.service`?
2. What health stability duration and retry budget satisfy Fedora startup variance without prolonging downtime?
3. Is the initial API `loidinh` identity permanent for v1, and which workspace/SSH paths permit a later `dam-hopper-api` migration?
4. What backup/compatibility contract governs SQLite and external MongoDB changes, especially on first install and failed activation?
5. Required SELinux file contexts and policy for `/opt`, `/var/lib/dam-hopper-manager`, direct ports, and the two identities?
6. Release retention count/disk budget and operator procedure when previous-release health itself fails?
