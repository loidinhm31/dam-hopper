# Phase 01 — Layout and descriptor-relative runtime provisioning

## Context links

- [Plan](plan.md)
- [Scout report](agent://ScoutConfigUsage)
- [Research report](../reports/researcher-260914-0854-daemon-state-config.md)
- [Existing provisioning design](../260912-1221-idle-suspend-runtime-identity-reconciliation/phase-02-provision-api-runtime-paths.md)
- [`layout.rs`](../../server/src/linux_release/layout.rs) · [`api_runtime.rs`](../../server/src/linux_release/api_runtime.rs) · [`state.rs`](../../server/src/state.rs)

## Overview

- Priority: P2
- Status: pending
- Effort: 18h
- Goal: extend the existing fixed-path, refusal-based runtime gate so config and its coupled server audit live under `/var/lib/dam-hopper`, with deterministic copy-once legacy migration and failure-safe publication.
- Dependency: final rendered API identity and one privileged prestart from the completed runtime-identity plan.

## Key Insights

- `Layout` already owns `/var/lib/dam-hopper` and `/var/lib/dam-hopper/.config/dam-hopper`, but lacks canonical/legacy daemon TOML accessors.
- `api_runtime.rs` already supplies the correct security shape: trusted-root fd, `fstatat(AT_SYMLINK_NOFOLLOW)`, `openat(O_NOFOLLOW)`, exclusive creation, exact metadata, reverse cleanup, and fake syscalls.
- `AppState` derives the compatibility audit from `config_path.parent()`. Moving the config naturally moves the writer; the provisioner and diagnostics accessor must follow it.
- A legacy byte copy changes relative `projects[].path` meaning because parsing resolves it against the new parent. Reject relative project roots rather than silently rewriting operator bytes.
- Existing cleanup deletes regular files only while empty. A nonempty config needs staged publication, not a widened exception to unlink arbitrary content.
- `utils::atomic_write` creates a same-directory mode-`0600` temporary and renames it. Once the canonical parent/file are API-owned, `PUT /api/config` needs no sudo or privileged repair.

## Requirements

### Fixed layout and metadata

- Add `Layout::api_daemon_config_path()` → `<trusted-root>/var/lib/dam-hopper/dam-hopper.toml`.
- Add `Layout::legacy_api_daemon_config_path()` → `<trusted-root>/etc/dam-hopper/dam-hopper.toml`; name it explicitly as migration-only, never generic config authority.
- Change `Layout::api_audit_path()` → `<trusted-root>/var/lib/dam-hopper/idle-suspend-audit.jsonl`.
- Preserve `/var`, `/var/lib` as root `0:0` directories `0755`; preserve API state, `.config`, and `.config/dam-hopper` as final API UID:GID directories `0700`.
- Canonical config and canonical audit: regular final API UID:GID files `0600`.
- Remove `/etc`, `/etc/dam-hopper`, and old audit from the provisioner's created/managed-object set. Legacy traversal is read-only and optional; no API-runtime call creates, chmods, chowns, truncates, renames, or deletes an `/etc` object.

### Canonical/legacy decision table

| Canonical | Legacy | Required result |
| --- | --- | --- |
| Valid | any | Validate canonical type/UID/GID/mode and bounded readable TOML; preserve inode/bytes; do not inspect legacy for migration |
| Unsafe/mismatched | any | Typed refusal before mutation; starter unreachable |
| Absent | valid | Copy exact bytes through staged publication; preserve legacy inode/bytes/metadata |
| Absent | unsafe/present | Typed refusal; no seed and no mutation |
| Absent | absent | Publish exact minimal seed `[workspace]\nname = "default"\n` |
| Race creates canonical | any | No-replace publication refuses; preserve winner and clean only owned unpublished temp |

- Legacy acceptance is explicit: regular, no-follow, root UID/GID, mode `0644`, readable, valid UTF-8/TOML, maximum 64 KiB, and every `projects[].path` absolute and free of parent traversal.
- Canonical validation is bounded to 64 KiB and rejects invalid UTF-8/TOML. Exact schema validation remains the server parser's authority; provisioning only validates what safe migration/publication needs.
- Error text uses fixed logical paths, operation names, errno, and numeric expected/current metadata. Never include config bytes, symlink targets, project values, usernames beyond already validated unit identity, or attacker-controlled expanded paths.

### Durable publication and cleanup

- Extend the private syscall seam only with fixed-name descriptor operations needed for bounded read, complete write, file sync, parent sync, and no-replace rename. Handle short writes and `EINTR` without avoidable whole-buffer copies.
- Create one fixed unpublished sibling such as `.dam-hopper.toml.provisioning` with `O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC`, mode `0600`. Existing temp is refused, never reused or unlinked as stale.
- Write chosen bytes, sync file, set final ownership/mode through its descriptor, `fstat` exact type/identity/size/metadata, then atomically install with Linux no-replace semantics and sync the state directory.
- Before publication, cleanup may unlink only the call-created temp whose recorded `(dev, ino, type)` still matches. Replacement/nonempty ambiguity refuses and retains.
- After successful no-replace publication, never roll back the canonical file. A later directory-sync error is reported; rerun validates the published file without mutation.
- Create/validate the adjacent audit only after canonical publication succeeds. Keep its existing empty-file identity-bound cleanup behavior. Never touch the old `/etc` audit; it remains operator-owned rollback evidence until separately retired.

### Side-effect review checklist

- [ ] Existing canonical: no create/write/sync-metadata/chown/chmod/rename/unlink.
- [ ] Existing legacy: read only; never mutate even after successful migration.
- [ ] Failed staged config: only recorded unpublished temp eligible for cleanup.
- [ ] Valid rerun: no metadata/content/inode change for config or audit.
- [ ] Parent/type mismatch: no traversal below mismatched object and no starter call.
- [ ] Web role: this provisioner is never invoked by install/start/recovery.
- [ ] `state.rs` needs no alternate audit override; its config-parent behavior now agrees with `Layout`.

## Architecture

```text
final unit User/Group -> numeric API identity
          |
trusted Layout root fd
  -> var -> lib -> dam-hopper (0700 API)
                    |-- dam-hopper.toml (0600 API, canonical)
                    |-- idle-suspend-audit.jsonl (0600 API)
                    `-- .config/dam-hopper (0700 API, existing XDG state)
  -> etc -> dam-hopper -> dam-hopper.toml (read-only legacy source)
```

Provision sequence:

1. Validate non-root identity; open trusted root.
2. Walk and exact-validate/create fixed `/var` ancestors and API state descriptors.
3. `fstatat` canonical without following. If present, validate/read/parse and stop migration selection.
4. If absent, descriptor-walk optional root-owned `/etc/dam-hopper`; choose accepted legacy bytes or exact seed.
5. Publish via exclusive temp → complete write → file sync → metadata/fstat → no-replace rename → directory sync.
6. Create/validate canonical audit; on any refusal return before the starter seam.
7. Drop descriptors. No path-based recursive ownership operation exists.

Sole authority means the privileged gate provisions these fixed objects. The unprivileged API may later replace canonical contents atomically and append audit data; those are normal runtime mutations, not alternate provisioning.

## Related code files

| Action | File | Change |
| --- | --- | --- |
| Modify | `server/src/linux_release/layout.rs` | Add canonical/legacy config accessors; relocate audit accessor |
| Modify | `server/src/linux_release/api_runtime.rs` | Config selection, bounded descriptor reads, staged no-replace publication, relocated audit, fake syscall matrix |
| Modify if needed | `server/src/linux_release/error.rs` | Typed sanitized read/write/sync/no-replace/migration refusal details; reuse current variants where precise |
| Modify | `server/tests/idle_suspend_diagnostics_linux_smoke.rs` | Hash/check canonical config via new Layout accessor; preserve diagnostics no-mutation contract |
| Review only | `server/src/state.rs` | Confirm config-parent-derived audit equals `Layout::api_audit_path()`; do not add a second path authority |
| Review only | `server/src/idle_suspend/server_audit.rs` | Existing pre-provisioned no-follow consumer remains valid at relocated path |
| Review only | `server/src/utils/fs.rs` | Confirm API-user same-directory atomic replacement leaves canonical `0600`; no provisioning logic added |

## Implementation Steps

1. Add the two TOML accessors and change the audit accessor; update path unit assertions/fixtures that directly encode `/etc`.
2. Replace old `ETC_PATH`, `API_ETC_PATH`, and old `AUDIT_PATH` managed entries with canonical config and canonical audit constants under the retained state descriptor.
3. Add fixed-operation syscall methods for readable no-follow file descriptors, bounded reads, complete writes, file/directory sync, and `renameat2(RENAME_NOREPLACE)`; mirror exact behavior in `FakeSyscalls` including bytes and link/race identity.
4. Separate generic exact-metadata validation from purpose labels (`config`, `audit`) so errors no longer say “audit” for every regular file; keep the API private and fixed-name.
5. Implement canonical-first selection. Pre-existing canonical validates exact API UID:GID `0600`, bounded bytes, UTF-8/TOML, and causes zero mutation.
6. Implement optional descriptor-relative legacy inspection. Missing parent/file means absent; any unsafe present component/source fails closed. Enforce legacy metadata/size/content and reject relative project roots.
7. Add exact default bytes. Publish seed/copy bytes with the exclusive temp/no-replace sequence; record temp identity immediately after creation and apply the defined pre-/post-publication cleanup rules.
8. Create/validate the relocated audit after config publication. Preserve reverse cleanup for call-created audit/directories and never include legacy `/etc` objects.
9. Extend fake assertions so mutation includes write, chown, chmod, rename, unlink, and content changes. Preserve the provision→start ordering test.
10. Update diagnostics smoke's canonical config snapshot. Confirm `AppState` and collector converge through config parent/Layout without new coupling.

## Todo list

- [ ] Add canonical and migration-only Layout accessors.
- [ ] Relocate canonical audit authority.
- [ ] Implement canonical-first, legacy-only, and fresh-seed states.
- [ ] Implement durable exclusive staged publication.
- [ ] Extend identity-bound cleanup to unpublished config temp.
- [ ] Remove active API provisioning under `/etc`.
- [ ] Expand fake syscalls and focused failure/race coverage.
- [ ] Verify diagnostics and API atomic-write side effects.

## Success Criteria

- Exact seed, copied legacy bytes, canonical precedence, and relocated audit metadata are observable in focused `api_runtime` tests.
- Valid canonical rerun produces only inspect/open/read/fstat/close calls; config/audit inode, bytes, UID/GID, and modes are unchanged.
- Every canonical type/UID/GID/mode/content mismatch and legacy parent/source type/UID/GID/mode/read/size/UTF-8/TOML/relative-project failure returns a typed error, makes no pre-existing mutation, and records zero starts.
- Write, short-write retry, sync, chown, chmod, fstat, no-replace, parent-sync, and cleanup failure branches obey the publication boundary. A raced/replaced object is never deleted.
- `Layout::with_root` tests never touch host `/var` or `/etc`; Linux special-file test remains nonblocking/no-follow.
- Focused proof commands: `cargo test -p dam-hopper-server linux_release::api_runtime::tests` and the named diagnostics smoke test only.

## Risk Assessment

- **Nonempty cleanup deletes operator data:** publish through an unpublished exclusive inode; identity-check before unlink; never clean after publication.
- **Relative project roots silently move:** reject legacy migration until operator converts them to absolute paths.
- **Crash leaves temp:** refuse the unexpected fixed temp for manual inspection; never guess staleness.
- **Canonical publication races API/operator:** no-replace rename; preserve winner; rerun validates it.
- **Directory sync reports after visible publish:** return failure but retain complete canonical; next run validates without rewrite.
- **Historical audit split:** leave old audit untouched and document it as inactive rollback evidence; new records start at the canonical adjacent path.

## Security Considerations

- All provisioning traversal starts at `Layout::trusted_root()` and uses descriptor-relative, no-follow fixed components; no recursive `chown`, glob, shell, or arbitrary path operand.
- Pre-existing objects are refusal-only. Metadata comparison includes all permission bits and regular/directory type before use.
- Configuration is bounded before allocation/parsing. Errors never echo content or resolved operator paths.
- Root privilege ends after fixed provisioning. Canonical parent/file ownership makes API `atomic_write` possible as final service identity; no sudo bridge is introduced.
- The old `/etc` source is never writable by the API and never silently treated as absence when unsafe.

## Next steps

Phase 02 may change `ExecStart` only after these Layout/provisioning contracts and focused tests pass. Hand Phase 03 the canonical/legacy accessors and exact metadata/content decision table; it must not reimplement provisioning.

**Unresolved questions:** None.
