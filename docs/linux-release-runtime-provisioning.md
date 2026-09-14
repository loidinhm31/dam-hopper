# Linux API Runtime State Provisioning

**Status:** Phase 01 complete (2026-09-14)

This guide documents the Linux release-manager contract for provisioning the
API daemon's durable configuration and server audit state. It is intentionally
separate from release publication: the API systemd unit invokes the provisioner
before every API start or restart, and the API process is started only after
provisioning succeeds.

For service layout and lifecycle context, see [Linux systemd](./linux-systemd.md)
and [Linux Release Manager](./linux-release-manager.md). For the threat model,
see [Terminal Idle Suspend Security](./terminal-idle-suspend-security.md).

## Runtime authorities

The finalized API systemd unit's exact non-root `User=`/`Group=` pair is the
sole authority for API-owned UID/GID values. The release manifest, host role,
`SUDO_USER`, username-as-group inference, and root fallbacks cannot supply or
override that identity. A root UID or GID is refused before the trusted layout
root is opened.

| Path | Owner and mode | Authority and lifecycle |
| --- | --- | --- |
| `/var` | `root:root`, directory `0755` | Fixed traversal ancestor; created only when missing and exact-validated thereafter. |
| `/var/lib` | `root:root`, directory `0755` | Fixed traversal ancestor; created only when missing and exact-validated thereafter. |
| `/var/lib/dam-hopper` | API UID:GID, directory `0700` | Durable API state root. Reconciles pre-existing `0755` (created by systemd `StateDirectory=` in v0.2.0) by safely tightening to `0700` via descriptor `fchmod`. |
| `/var/lib/dam-hopper/.config` | API UID:GID, directory `0700` | API configuration root. |
| `/var/lib/dam-hopper/.config/dam-hopper` | API UID:GID, directory `0700` | API diagnostics and token parent. |
| `/var/lib/dam-hopper/dam-hopper.toml` | API UID:GID, regular file `0600` | Canonical API registry consumed at startup. |
| `/var/lib/dam-hopper/idle-suspend-audit.jsonl` | API UID:GID, regular file `0600` | Server timing/manual audit. |
| `/etc/dam-hopper/dam-hopper.toml` | `root:root`, regular file `0644` | Optional, read-only migration source used only while canonical config is absent. |
| `/var/lib/dam-hopper/.config/dam-hopper/diagnostics/idle-suspend-events-v1.jsonl` | API-owned diagnostic stream | Validated/used by the semantic event writer; not created by this Phase 01 gate. |

The old `/etc/dam-hopper/idle-suspend-audit.jsonl`, when present, is legacy
operator state. Phase 01 does not create, repair, truncate, delete, or migrate
that file. The helper audit remains under
`/var/log/dam-hopper/idle-suspend-helper.jsonl` and has its separate systemd
`LogsDirectory` authority.

## Configuration selection and migration

Provisioning makes one decision before it writes any configuration:

| Canonical config | Legacy config | Result |
| --- | --- | --- |
| Present and safe | Any | Validate canonical metadata and bounded UTF-8/TOML. Preserve its bytes and inode; do not inspect or modify legacy state. |
| Present but unsafe or mismatched | Any | Refuse with a typed error before mutation. API start is unreachable. |
| Absent | Present and safe | Read legacy through descriptors, validate it, and publish an exact-byte copy at the canonical path. Preserve the legacy inode, bytes, owner, and mode. |
| Absent | Present but unsafe or invalid | Refuse with no seed, copy, or legacy mutation. |
| Absent | Absent | Publish the bounded seed `[workspace]\nname = "default"\n`. |

The canonical and legacy documents are limited to 64 KiB and must be valid
UTF-8 and TOML. A legacy document additionally requires every
`projects[].path` value to be an absolute path without a parent-directory
component. These checks are bounded and occur before publication.

Migration is copy-once, not synchronization. After a successful copy, the
canonical file is the startup authority; later changes to the legacy file are
ignored. A rerun validates the canonical file and does not rewrite it. Operators
should edit `/var/lib/dam-hopper/dam-hopper.toml` for production policy changes,
then restart `dam-hopper-api.service` so startup captures the immutable idle
suspend policy. The legacy file may be retained for rollback evidence, but the
API runtime gate never mutates it.

## Descriptor-relative provisioning flow

The release manager receives no path operands for this operation. The fixed
sequence is:

1. Parse and validate the final API unit identity.
2. Open the trusted layout root as a directory descriptor with no-follow flags.
3. Walk `/var`, `/var/lib`, and the API state/configuration directories using
   directory descriptors. Missing managed objects are created with their final
   metadata; existing objects must match exactly.
4. Inspect the canonical config with no-follow, regular-file, identity, size,
   and content checks. If absent, inspect the optional legacy tree read-only or
   select the seed.
5. Stage the selected bytes in the fixed sibling
   `.dam-hopper.toml.provisioning` using exclusive creation, `O_NOFOLLOW`, and
   mode `0600`.
6. Write all bytes, synchronize the temporary file, set its final API UID/GID
   and mode, then re-stat type, identity, and exact size.
7. Publish with Linux `renameat2(RENAME_NOREPLACE)` into the canonical path and
   synchronize the API state directory.
8. Only after configuration publication succeeds, create or validate the
   server audit file with API UID:GID and mode `0600`.
9. Return success to systemd. The API starter is not called on any refusal or
   I/O failure.

All path components are fixed and opened without following symlinks. The
provisioner does not recursively change ownership and does not scan alternate
locations. Legacy traversal is optional/read-only; it never becomes a second
runtime authority.

## Refusal boundaries and failure behavior

The gate is deliberately refusal-based. It does not repair an operator-owned
object in place.

- A symlink, FIFO, socket, device, non-directory ancestor, or other unexpected
  object at a managed path is refused.
- A pre-existing managed directory or file with the wrong type, UID, GID, or
  mode is refused. Existing canonical bytes are not normalized or truncated.
- A present legacy `/etc` anchor or legacy config with unsafe metadata is
  refused; the gate does not create `/etc`, `/etc/dam-hopper`, or legacy files.
- An unexpected pre-existing `.dam-hopper.toml.provisioning` is never reused or
  deleted. The fixed temporary name is exclusive and no-follow.
- If another actor publishes the canonical file first, `RENAME_NOREPLACE`
  refuses the replacement. The winner is preserved and the call removes only
  its own identity-matching unpublished temporary file.
- A directory synchronization error after a successful rename is reported, but
  the published canonical file is not rolled back. A later invocation validates
  the visible canonical file without rewriting it.
- On failure, cleanup runs in reverse creation order and only for objects whose
  recorded `(device, inode, type)` still matches. Ordinary created files must
  still be empty; replaced, nonempty, or unidentifiable objects are retained
  and reported rather than removed.
- If both the primary failure and cleanup fail, the manager returns a combined
  provision/cleanup error. Error details use fixed logical operations, paths,
  and numeric metadata; configuration content and user-controlled path text are
  not copied into diagnostics.

The audit path is deliberately later in the sequence. A failure while creating
or validating it cannot cause the provisioner to roll back a configuration that
was already published.

## Operations checklist

### Fresh host or first API start

1. Confirm the installed API unit has one exact non-root `User=` and `Group=`.
2. Run the manager's fixed pre-start gate through the normal service start or
   restart. Do not pass alternate paths or identity operands.
3. Verify the canonical config and server audit have the API identity and mode
   `0600`; verify API state directories are `0700`.
4. If the gate refuses, inspect the typed path/operation/metadata error and
   repair the object out of band. Do not expect the manager to replace it.

### Legacy migration

Before restarting the API, ensure the legacy config is a regular root-owned
`0644` file, valid UTF-8/TOML, no larger than 64 KiB, and has only absolute,
non-traversing project paths. Restarting with no canonical file performs one
exact-byte staged copy. Confirm the resulting canonical inode/content and keep
the legacy file unchanged as evidence. Subsequent restarts use only the
canonical file.

### Production policy changes

Edit `/var/lib/dam-hopper/dam-hopper.toml`, preserving API ownership and mode,
then restart `dam-hopper-api.service`. Startup policy fields are captured at
boot; timing changes still use the authenticated timing API described in the
[configuration guide](./configuration-guide.md). Editing the legacy `/etc`
copy does not change a running or subsequently provisioned API once canonical
state exists.

The focused runtime unit suite exercises the descriptor walk, migration,
publication, race, and cleanup contract:

```bash
cargo test -p dam-hopper-server linux_release::api_runtime::tests
```

### Read-only diagnostics smoke

The Linux production diagnostics smoke is intentionally ignored and must be
run only against an approved host:

```bash
cargo test --test idle_suspend_diagnostics_linux_smoke -- --ignored
```

It snapshots host configuration, canonical config, helper audit, semantic server
events, RTC, and service-unit properties, writes output under a temporary
directory, and verifies those host sources remain unchanged. It does not
perform a real suspend/resume operation.

## Related implementation references

- `server/src/linux_release/layout.rs` — trusted-root-relative canonical,
  legacy, and audit accessors.
- `server/src/linux_release/api_runtime.rs` — descriptor walk, bounded content
  validation, staging, no-replace publication, cleanup, and fakeable syscall
  seam.
- `server/src/linux_release/error.rs` — typed metadata, configuration, I/O,
  cleanup, and combined provisioning errors.
- `server/tests/idle_suspend_diagnostics_linux_smoke.rs` — ignored read-only
  production-adapter smoke.
- [Linux Release Manager](./linux-release-manager.md) — unit lifecycle,
  activation, rollback, and manager filesystem layout.
- [System Architecture](./system-architecture.md) — source authority and
  diagnostic completeness model.
