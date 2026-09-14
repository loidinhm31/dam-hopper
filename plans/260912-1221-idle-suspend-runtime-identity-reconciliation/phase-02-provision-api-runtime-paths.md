# Phase 02 — Provision API runtime paths

## Context links

- [Plan](plan.md) · [Synthesis](reports/01-planning-synthesis.md) · [Provisioning research](research/researcher-02-report.md)
- [Phase 01](phase-01-reconcile-runtime-identity-authority.md)
- [Parent diagnostics plan](../260912-0027-production-idle-suspend-diagnostics/plan.md)

## Overview

- Effort: 18h
- Date: 2026-09-12
- Description: add one secure refusal-based gate that creates absent API audit/state paths and validates existing paths from final-unit UID/GID before every API start.
- Priority: P2
- Implementation status: completed 2026-09-12
- Review status: approved 2026-09-12

## Key Insights

- Privileged provisioning must not follow symlinks or trust path-based check-then-use operations.
- The validated contract rejects pre-existing metadata mismatches; it does not repair them. Therefore rollback tracks creations only, never prior metadata.
- `StateDirectory=` is incompatible with refusal semantics: systemd can create or repair state ownership/mode before `ExecStartPre`. Remove it from API and helper so the fixed provisioner is sole authority.
- `Restart=on-failure` creates starts outside manager orchestration. One fixed root-privileged, zero-operand `ExecStartPre` must call the same provisioner.
- Provisioning failure must prevent API start in explicit flows and prevent API `ExecStart` in automatic restart. Do not reorder or otherwise change helper startup/error handling; existing transaction recovery remains responsible for release state.

## Requirements

- From Phase 01 final-unit identity, enforce:
  - `/var/lib/dam-hopper` — API UID/GID, directory, `0700`.
  - `/var/lib/dam-hopper/.config` — API UID/GID, directory, `0700`.
  - `/var/lib/dam-hopper/.config/dam-hopper` — API UID/GID, directory, `0700`.
  - `/etc/dam-hopper/idle-suspend-audit.jsonl` — API UID/GID, regular file, `0600`.
- Treat `/etc/dam-hopper` as a fixed `0:0`, directory, `0755` safe anchor: create safely if absent; if present, validate exact type/owner/group/mode without repair.
- Traverse from trusted `Layout` root with directory descriptors. Use fixed component arrays and `openat`/`mkdirat`, `O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC`; create the audit with `O_CREAT|O_EXCL|O_APPEND|O_NOFOLLOW|O_CLOEXEC`, never `O_TRUNC`.
- For an absent object, create with restrictive mode, assign final ownership on the newly created descriptor, and re-`fstat` exact postconditions before continuing.
- For every pre-existing object, `fstat` and require exact type, UID, GID, and permission bits. On mismatch, return error without `chown`, `chmod`, replacement, unlink, truncate, write, or traversal into an unsafe component.
- Preserve existing audit bytes and inode. A fully valid rerun is a read-only metadata check plus close; it performs no ownership/mode/content mutation.
- Errors report fixed logical path and expected/current type, UID, GID, and normalized mode. Do not report audit contents, symlink targets, account database records, or attacker-controlled path expansion.
- On synchronous failure, remove only empty objects created by that call, in reverse order. Cleanup is identity-bound: re-stat each created object and unlink only when its type and recorded object identity still match; any identity/type drift fails closed, retaining the object and reporting primary plus cleanup error.
- Remove `StateDirectory=dam-hopper` and `StateDirectoryMode=` from both API and helper templates/policy. Preserve helper `RuntimeDirectory`, `LogsDirectory`, groups, sandboxing, executable behavior, and protocol v1.
- Provision immediately before each API start during active start and candidate activation. Failure makes the API starter unreachable; existing helper ordering and error handling remain unchanged.
- Automatic rollback restores units, reparses the restored final API unit identity, and provisions before the API restart. Mismatch yields existing failure/recovery-required behavior and operator repair, not automatic metadata conversion; helper orchestration remains unchanged and cannot own API state.
- Boot recovery validates and provisions the installed active server unit before returning success, but never starts services; no active server role means no API provisioning.
- Preserve API `Restart=on-failure`. Add exactly one fixed root-privileged `ExecStartPre` whose packaged command is `bin/dam-hopper-manager provision-api-runtime` (rendered as `+@RELEASE_ROOT@/bin/dam-hopper-manager provision-api-runtime`); it accepts no user, group, mode, path, or other operands.
- API audit writer opens only the pre-provisioned existing file with no-follow, verifies regular/current effective UID/GID/`0600`, appends, and syncs. Reads use no-follow open and regular-file validation; neither path is created or repaired by the audit consumer.

## Architecture

- Extend `Layout` only with trusted-root and exact API path accessors needed by production `/` and `Layout::with_root(tempdir)`.
- `provision_api_runtime(layout, identity)` owns a fixed-path state machine: open safe ancestor → open-or-exclusive-create each object → validate descriptor metadata → continue. The final rendered API unit's parsed `User=`/`Group=` identity is authoritative; pre-existing mismatch exits before mutation.
- Creation cleanup stores only call-created object descriptors/names plus their identities. Reverse cleanup unlinks the new empty audit then removes new empty directories only when current identity/type still match; any mismatch fails closed with no unlink.
- A private fixed-operation syscall seam injects create/metadata/failure outcomes where unprivileged tests cannot change ownership. It accepts no arbitrary production path.
- `provision_and_start_api(layout, unit_path, starter)` parses the final API unit → provisions → invokes starter. Tests record order; production starter uses the existing systemd start call.
- Hidden `provision-api-runtime` CLI dispatch verifies zero operands and EUID 0, uses production `Layout`, reparses the installed final API unit, and calls the same provisioner. Unit policy permits `+` only for the exact packaged command `bin/dam-hopper-manager provision-api-runtime`.
- Candidate/active/rollback use the installed or transaction-final unit appropriate to their state. Boot recovery uses the installed active server unit to provision before success and does not start services. Systemd repeats the gate before every API executable start.
- Neither unit claims the shared state tree. The provisioner exclusively establishes API ownership; helper restart cannot retake it through systemd directory management.

## Related code files

| Action | Absolute path | Intended symbol/change | Dependency |
| --- | --- | --- | --- |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/linux_release/layout.rs` | Trusted root and exact API state/config/audit accessors | None |
| Create | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/linux_release/api_runtime.rs` | Descriptor-relative create/validate gate, creation-only cleanup, provision→start seam | Phase 01 unit resolver |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/linux_release/error.rs` | Typed create/type/metadata/cleanup errors with sanitized fixed paths | Provisioner design |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/linux_release/mod.rs` | Register/export only required entrypoint; internals private | New module |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/linux_release/cli.rs` | Hidden zero-operand `ProvisionApiRuntime` command | New module |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/bin/dam-hopper.rs` | EUID-0 fixed provisioning dispatch | CLI command |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/linux_release/privilege.rs` | Root requirement for provisioning command | CLI command |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/deploy/systemd/dam-hopper-api.service.in` | Remove StateDirectory directives; add exact privileged ExecStartPre; retain Restart and hardening | Provisioning command |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/deploy/systemd/dam-hopper-idle-suspend-helper.service.in` | Remove StateDirectory claim only; retain runtime/log/protocol behavior | Sole path authority |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/linux_release/unit_policy.rs` | Require absence of StateDirectory claims and exact sole ExecStartPre | Unit templates |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/linux_release/activate.rs` | Route active/candidate starts through provision-first boundary | New module |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/linux_release/rollback.rs` | Validate restored-unit paths before rollback starts | New module |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/linux_release/recovery.rs` | Gate successful boot recovery on active-unit provisioning | New module |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/idle_suspend/server_audit.rs` | Remove lazy creation; no-follow open/read and exact metadata check | Provisioned audit contract |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/idle_suspend/tests.rs` | Existing-file append plus absent/mismatch/symlink refusal | Audit writer change |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/tests/linux_release_state_machine.rs` | Provision/start/rollback/recovery order via injected starter | Start seam |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/tests/linux_release_ownership.rs` | Creation, no-mutation mismatch, manual-repair rerun, symlink, cleanup matrix | Provisioner |

## Implementation Steps

1. Add exact path accessors and fixed expected metadata constants; keep arbitrary path input out of the API.
2. Implement root-dirfd traversal with no-follow opens. Distinguish `ENOENT` from all other failures; exclusively create only missing fixed objects.
3. For newly created descriptors only, establish final owner/mode and verify with `fstat`. For pre-existing descriptors, compare exact metadata and return a typed mismatch before any mutating syscall.
4. Track creation order plus each created object's descriptor identity. On later failure, remove call-created empty objects in reverse order only when current identity/type still match; any cleanup race fails closed, and never restore metadata because no pre-existing metadata is changed.
5. Add sanitized expected/current mismatch errors and combined primary/cleanup error handling.
6. Add provision→starter seam; starter is unreachable on identity/provisioning error and called once after all postconditions.
7. Add zero-operand, root-only CLI dispatch for the packaged `bin/dam-hopper-manager provision-api-runtime` command. In API template remove state-directory directives, retain `Restart=on-failure`, and add the exact privileged `ExecStartPre`. In helper template remove the shared state claim only. Tighten unit policy accordingly.
8. Route active/candidate API starts through the seam without moving or changing helper startup/error handling.
9. In automatic rollback, restore/reparse units then provision before restart. In boot recovery, provision installed active server unit before successful return. Never start services inside recovery.
10. Make server audit append/read consume only a pre-existing verified no-follow file; keep record schema and bytes unchanged.
11. Add temp-root/fake-syscall tests for absent creation, valid rerun, every mismatch with no mutation, operator repair followed by success, symlink/special-file refusal, cleanup at each creation failure, explicit ordering, and fixed unit gate. Never execute host systemd/helper/suspend/RTC or touch production paths.

## Todo list

- [x] Implement fixed descriptor-relative create/validate gate.
- [x] Refuse every pre-existing mismatch without mutation.
- [x] Bound cleanup to call-created empty objects with identity-bound, fail-closed removal.
- [x] Remove both units' StateDirectory claims.
- [x] Add exact zero-operand ExecStartPre while preserving Restart.
- [x] Gate activation, rollback, and recovery.
- [x] Convert audit writer to a verified pre-provisioned/no-follow consumer.
## Completion record

- Implementation completed 2026-09-12.
- Final review approved after terminal `REVIEW_PASS` (8.5/10); advisor outcome resolved; focused Phase 02 checks passed.
- Final API unit `User=`/`Group=` identity is authoritative. The packaged gate command is `bin/dam-hopper-manager provision-api-runtime`; recovery provisions an active server before success but does not start services; cleanup is identity-bound and fail-closed; audit consumption is pre-provisioned and no-follow.

## Success Criteria

- Missing managed objects are created with final-unit UID/GID and exact type/mode before starter invocation.
- A valid second run changes no metadata, content, or inode.
- Each pre-existing owner/group/mode/type mismatch fails, reports expected/current safely, mutates no object, and records zero starts; explicit manual repair followed by rerun succeeds.
- Audit and each managed parent symlink/special-file case fails without following or modifying the target and records zero starts.
- Injected failure removes only call-created empty objects in reverse order when recorded identity/type still match; any cleanup identity/type drift fails closed, and pre-existing metadata/content/inodes remain byte-for-byte/stat-equivalent unchanged.
- Candidate failure enters existing rollback; restored final-unit identity is reparsed and must match existing paths before its single API start. A mismatch leaves service stopped for operator repair.
- Boot recovery provisions the installed active server unit before success and never starts services; it cannot succeed for an active server role when validation fails.
- API unit preserves `Restart=on-failure`, has one exact fixed root-privileged zero-operand `ExecStartPre` for `bin/dam-hopper-manager provision-api-runtime`, and has no StateDirectory directive. Helper has no shared StateDirectory claim and otherwise retains runtime/log/hardening behavior.
- Audit writer fails on absent, linked, non-regular, wrong-owner/group, or wrong-mode file; valid append preserves prior bytes and schema.
- Narrow verification: `cargo test -p dam-hopper-server linux_release::api_runtime::tests`; `cargo test -p dam-hopper-server --test linux_release_ownership`; `cargo test -p dam-hopper-server --test linux_release_state_machine test_api_runtime`; `cargo test -p dam-hopper-server idle_suspend::tests::test_server_audit_preprovisioned_contract`.

## Risk Assessment

- systemd silently pre-creates/repairs paths: remove `StateDirectory`/`StateDirectoryMode` from both units and assert absence in policy/tests.
- Creation briefly has root ownership: create restrictive and operate through retained descriptors; do not expose before final `fstat` succeeds.
- Refusal blocks upgrades on legacy root-owned paths: make the migration gate inspect/report before service stop, publish exact manual repair steps, and rerun validation before activation.
- Creation or cleanup races must fail closed: only the call-created object whose recorded identity/type still matches may be removed; never unlink a replaced object.
- Rollback identity differs from candidate: reparse restored unit; refuse mismatch and enter recovery rather than changing ownership.

## Security Considerations
- No symlink following, arbitrary path operands, recursive ownership changes, or pre-existing metadata mutation.
- Compare normalized permission bits; reject special types and unsafe anchors before descending.
- Cleanup is identity-bound and fail-closed; log fixed paths and numeric metadata only, never file contents, symlink targets, or account database entries.
- Root privilege exists only in the fixed provisioner command. Helper runtime/log/protocol v1 behavior remains unchanged.

## Next steps

Phase 03 qualifies observable refusal/no-mutation behavior, startup coverage, unit authority, v2 migration sequencing, and unchanged helper protocol before documentation approval.

## Unresolved questions

None.
