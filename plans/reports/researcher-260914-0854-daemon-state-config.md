# Research: daemon-state config migration

**Date:** 2026-09-14 (Asia/Saigon)  
**Decision under review:** Option B, clean system-daemon state: canonical API TOML at `/var/lib/dam-hopper/dam-hopper.toml`; `/etc/dam-hopper` remains a root-owned host/compatibility anchor.

## Existing contract and constraints

- `Layout` already derives `/var/lib/dam-hopper` and `/var/lib/dam-hopper/.config/dam-hopper`, but has no accessor for the daemon TOML; `api_etc_dir()` and the audit accessor still describe `/etc` ([layout.rs](../../server/src/linux_release/layout.rs#L61-L79)). Add distinct canonical and legacy accessors; do not overload `api_config_dir()`.
- `api_runtime` walks fixed components with `openat`/`fstatat`, `O_NOFOLLOW`, and descriptor-relative operations; its `ensure_dir`/`ensure_file` validate pre-existing type, UID, GID, and mode before mutation ([api_runtime.rs](../../server/src/linux_release/api_runtime.rs#L159-L248), [api_runtime.rs](../../server/src/linux_release/api_runtime.rs#L342-L457)).
- Current runtime ownership authority is the final rendered API unit identity, not installer input; provisioning rejects root identities and the start callback is unreachable after a provisioning error ([api_runtime.rs](../../server/src/linux_release/api_runtime.rs#L582-L615)).
- The API unit deliberately has one privileged `ExecStartPre` and no `StateDirectory=`; systemd's `StateDirectory=` can create/manage state before the gate. `ExecStartPre` failures prevent later commands ([unit_policy.rs](../../server/src/linux_release/unit_policy.rs#L39-L63), [systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#RuntimeDirectory=,%20StateDirectory=,%20CacheDirectory=,%20LogsDirectory=,%20ConfigurationDirectory=), [systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html#ExecStartPre=)).

## 1. Migration mechanics and recommendation

**Recommend copy-once, never silent defaulting, when only the legacy file exists.**

1. Add canonical `api_daemon_config_path()` = `/var/lib/dam-hopper/dam-hopper.toml` and `legacy_api_daemon_config_path()` = `/etc/dam-hopper/dam-hopper.toml` to `Layout`.
2. In the privileged runtime gate, inspect the canonical entry first with no-follow metadata. If present, require regular file, final API UID:GID, and `0600`; preserve inode and bytes, and perform no copy, seed, chmod, chown, truncation, or replacement.
3. If canonical is absent and legacy is present, inspect legacy with `symlink_metadata`/`O_NOFOLLOW`; require regular file, impose the existing 64 KiB bound, read its bytes, and create the canonical file exclusively. Write bytes through the newly created descriptor, `sync_data`/`fsync`, apply final ownership/mode through the descriptor, then `fstat` and validate. Preserve legacy unchanged for rollback and operator verification. `O_CREAT|O_EXCL|O_NOFOLLOW` and descriptor-relative `renameat` semantics are documented by [openat(2)](https://man7.org/linux/man-pages/man2/openat.2.html) and [rename(2)](https://man7.org/linux/man-pages/man2/rename.2.html).
4. If both are absent, create the minimal valid seed (`[workspace]\nname = "default"\n`); an empty TOML is not valid because `workspace` is required ([schema.rs](../../server/src/config/schema.rs#L617-L706)).
5. If legacy is a symlink/special file, unreadable, over the bound, invalid UTF-8/TOML, or copy/write/sync/final-validation fails, fail closed. Do not seed a default over an operator's possibly unreadable configuration and do not remove the legacy source. Use fixed-path error labels; never expose arbitrary contents/targets.

This should be one authority: remove shell `cp`/`tee` migration and old-file chmod repair from the installer. The installer currently creates `/etc/dam-hopper/dam-hopper.toml` as root `0644` ([dam-hopper-install.sh](../../deploy/release/dam-hopper-install.sh#L345-L368)); instead leave that file untouched, keep only the anchor needed for host/env files, and let `provision-api-runtime` migrate after final unit identity resolution. Only server/both roles need API state.

**Important semantic edge:** `read_config` resolves relative `projects[].path` against the config's parent ([parser.rs](../../server/src/config/parser.rs#L15-L50), [parser.rs](../../server/src/config/parser.rs#L156-L214)). A byte-for-byte move from `/etc/dam-hopper` changes relative project roots (and derived terminal paths). Before copying, require absolute project paths or normalize legacy-relative paths against the old parent; never silently relocate a workspace. Absolute `server.session_db_path` values remain unchanged.

## 2. Refusal and cleanup behavior

For a pre-existing canonical entry, preserve the current refusal contract: metadata mismatch returns `ApiRuntimeMetadataMismatch` before any mutating syscall, and `provision_and_start_api_with` must not invoke the starter. Wrong type (including symlink), UID, GID, or any mode bit mismatch is an operator-repair condition, not something the manager repairs ([error.rs](../../server/src/linux_release/error.rs#L236-L265)). The expected final file is regular, API UID:GID, `0600`; source legacy metadata need not be API-owned because historical installer output is root-owned `0644`, but its acceptance policy must be explicit.

Creation differs from today's empty audit file: copied/seeded config is nonempty, so the existing cleanup rule (“remove only empty created regular files”) cannot blindly delete a partially written config. Create config last, complete write+sync+descriptor metadata validation before success, and either:

- extend the creation record with an exact-content/size guard and remove only the call-created inode on failure; or
- use a fixed temporary name under the state directory, write/sync/validate it, and atomically install with an exclusive no-replace operation, retaining any replacement/race and reporting combined primary+cleanup errors.

Never delete a pre-existing canonical file, legacy file, or a replacement inode. Existing tests already pin reverse-order, identity-bound cleanup and retention of nonempty/replaced files ([api_runtime.rs](../../server/src/linux_release/api_runtime.rs#L459-L487), [api_runtime.rs](../../server/src/linux_release/api_runtime.rs#L1133-L1254)); extend those invariants to config creation.

## 3. SQLite preflight during migration

`resolve_configured_sqlite_paths` currently reads only `/etc/dam-hopper/dam-hopper.toml`, expands `~` as `/root` plus the current process home, and checks one fallback `/etc/dam-hopper/sessions.db` ([activate_preflight.rs](../../server/src/linux_release/activate_preflight.rs#L24-L103)). Its caller checks every returned DB with existing `-wal`/`-shm` holder inspection ([activate_preflight.rs](../../server/src/linux_release/activate_preflight.rs#L318-L326)).

During the finite migration window:

- inspect canonical first; if valid, parse it as authority;
- if legacy exists, inspect/parse it too and union each configured `server.session_db_path`, then deduplicate paths; this protects an old daemon still using the legacy config while the new daemon uses canonical;
- if canonical is absent and legacy regular, use legacy's configured path (never default silently); if both are absent, use the default;
- reject symlink/nonregular/unreadable/oversized/malformed files rather than ignoring the unsafe legacy entry;
- retain the existing SQLite, `-wal`, and `-shm` checks for every candidate.

Expand `~` in the daemon context to fixed API HOME `/var/lib/dam-hopper`, so the default resolves to `Layout::api_config_dir()/sessions.db`; add compatibility fallbacks for the canonical and legacy locations only as required by the migration contract, deduplicated. Keep absolute configured paths unchanged. Once legacy retirement is complete and verified, stop scanning the old file; do not leave an indefinite alternate authority.

## 4. Required implementation tests and smoke coverage

### `api_runtime.rs` mock-syscall tests

Extend `MANAGED_PATHS` and the fake seam with bounded `write`, `sync`, and (if needed) source-read operations. Cover:

- both absent → exact default bytes, API UID:GID, `0600`;
- legacy-only → exact byte preservation, canonical inode/metadata, legacy unchanged;
- both present → canonical bytes win; no write/copy/metadata mutation;
- canonical type/UID/GID/mode mismatch and legacy symlink/special/read/size/copy failures → typed refusal, no mutation, no start;
- rerun is read-only; post-create write/sync/chown/chmod/fstat failures clean only call-created objects under the chosen nonempty-file rule; races/replacements remain;
- relative-path migration either rejects or verifies normalization, rather than silently changing resolved project roots.

### Unit-policy and staging assertions

Change the expected `ExecStart` in `unit_policy.rs`, `deploy/systemd/dam-hopper-api.service.in`, and checked-in `deploy/systemd/dam-hopper-api.service` to exactly `--config /var/lib/dam-hopper/dam-hopper.toml`. Preserve `Type=exec`, one exact privileged prestart, no `StateDirectory`/`StateDirectoryMode`, `HOME`, `XDG_CONFIG_HOME`, `UMask`, and restart policy. Add positive canonical-path and negative legacy-path assertions in [`linux_release_unit_policy.rs`](../../server/tests/linux_release_unit_policy.rs#L24-L115) and rendered staging assertions ([linux_release_staging.rs](../../server/tests/linux_release_staging.rs#L299-L307)).

### Deployment smoke

Keep rootless smoke's explicit temporary `--config` unchanged ([linux-release-rootless-smoke.sh](../../tests/deploy/linux-release-rootless-smoke.sh#L75-L82), [linux-release-rootless-smoke.sh](../../tests/deploy/linux-release-rootless-smoke.sh#L187-L212)); it is not the production systemd contract. Extend protected/clean-install coverage to verify fresh default seed, legacy-only migration (bytes/session DB path preserved), canonical precedence when both exist, exact owner/group/mode/inode/bytes, no symlink, wrong metadata blocks API start, and DB/WAL/SHM checks for both paths. Update security smoke to assert canonical ExecStart and absence of the legacy TOML path; the common bundle copies the template automatically ([linux-release-common.sh](../../tests/deploy/linux-release-common.sh#L96-L144), [linux-release-security.sh](../../tests/deploy/linux-release-security.sh#L10-L40)). Update reset script default/help from `/etc` to canonical ([reset-linux-production.sh](../../deploy/reset-linux-production.sh#L8-L23)).

## Cross-cutting decision: audit path

`AppState` derives `idle-suspend-audit.jsonl` beside `config.config_path` ([state.rs](../../server/src/state.rs#L308-L327)), while runtime currently provisions `/etc/dam-hopper/idle-suspend-audit.jsonl` ([layout.rs](../../server/src/linux_release/layout.rs#L71-L79)). Moving only TOML makes producer and provisioner disagree; audit opening is strict regular API UID:GID `0600` and never lazily creates ([server_audit.rs](../../server/src/idle_suspend/server_audit.rs#L236-L258)). Option B should therefore move/provision/migrate the compatibility audit alongside canonical state, or explicitly decouple its path and update layout, diagnostics, docs, and tests together.

## Unresolved questions

1. Move compatibility audit to `/var/lib/dam-hopper/idle-suspend-audit.jsonl` (recommended for clean state) or retain fixed `/etc` with explicit decoupling?
2. What legacy metadata is accepted (root `0644` only, or any regular readable file)?
3. Exact nonempty-created-file cleanup mechanism: guarded unlink versus temporary-file/no-replace install?
4. Normalize relative project paths automatically or require operator conversion before migration?
5. When is the legacy file retired, and what durable marker tells preflight to stop scanning it?
