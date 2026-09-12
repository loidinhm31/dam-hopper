# Planning synthesis: runtime identity reconciliation

## Evidence reviewed

- [Runtime identity research](../research/researcher-01-report.md) traces the schema-v1 API `identity: "root"` check, host-selected account, late unit rewrite, and health fallbacks; its clean-cutover option C is adopted.
- [Provisioning research](../research/researcher-02-report.md) identifies fixed paths, no-follow traversal, startup ordering, and rollback seams. Its automatic-repair recommendation is superseded by the validated refusal decision below.
- [Parent plan](../../260912-0027-production-idle-suspend-diagnostics/plan.md) and [Phase 01](../../260912-0027-production-idle-suspend-diagnostics/phase-01-freeze-architecture-contracts.md) require an architecture-first gate before diagnostics Phase 02.
- [Planned architecture](../../../docs/system-architecture.md#production-idle-suspend-diagnostics-planned-and-approved-phase-01) lines 496–520 and 663–673 is design intent, not implemented behavior.

## Current contradictions

- One `SCHEMA_VERSION` drives both release-manifest and manager-state validation. The API manifest field is fixed to root even though rendered units support host-selected non-root identities.
- Staging and health use multiple fallbacks; activation can rewrite units after staging. The final unit is therefore not yet sole authority.
- The API audit writer creates state lazily. Both API and root helper units declare `StateDirectory=dam-hopper`, allowing systemd to create or repair the shared state tree before a custom gate.
- Explicit starts, recovery, rollback, and systemd automatic restarts need one invariant: validate/create the fixed API runtime paths from the installed final unit before the API executable runs.

## Validated decisions

### Manifest and identity

- Hard-cut release manifests to schema v2. Split `RELEASE_MANIFEST_SCHEMA_VERSION = 2` from `MANAGER_STATE_SCHEMA_VERSION = 1` so persisted manager state is not collateral damage.
- Remove API `identity` from the v2 JSON Schema, generator, Rust contract, validation, fixtures, and docs. Delete `API_SERVICE_IDENTITY`. Keep web identity required and enforced through a web-specific contract.
- Accept and emit release manifest v2 only. Do not dual-read v1, translate root, keep aliases, or preserve deprecated fields. Strict unknown-field/version rejection makes the boundary observable.
- Old managers cannot consume v2. Publication requires manager-first rollout, regenerated/signed v2 forward and rollback manifests, a qualified v2-manager rollback path, and an operational prohibition on manager downgrade while v2 assets are active.

### Runtime authority

- Resolve configured/default non-root API user plus its primary group only for rendering. Finalize and hash the unit before preflight.
- Independently parse one exact `User=` and `Group=` from the final pending/installed unit; resolve real accounts; reject root name, UID 0, GID 0, missing/duplicate directives, and non-primary group.
- Use only that unit-derived numeric pair for health and provisioning. Manifest, host config, `SUDO_USER`, username-as-group, and `(0,0)` are never runtime fallbacks.

### Provisioning and systemd

- Remove `StateDirectory=dam-hopper` and `StateDirectoryMode=` from both API and helper. Otherwise PID 1 may create/repair state before `ExecStartPre`, violating refusal semantics and creating a second authority.
- Keep the helper's runtime/log directories, hardening, execution, and protocol v1 unchanged. It must not claim `/var/lib/dam-hopper`.
- One descriptor-relative, fixed-path provisioner creates absent managed objects with exact metadata. For every pre-existing object, it verifies no-follow type, owner, group, and mode and refuses any mismatch without `chown`, `chmod`, replace, unlink, truncate, or content access.
- Managed API objects are three `0700` state directories and the regular `0600` audit file, all owned by final-unit UID/GID. `/etc/dam-hopper` is a fixed `0:0`, directory, `0755` safe anchor, created if absent and otherwise validated without repair.
- Preserve `Restart=on-failure`. The API unit has exactly one fixed `ExecStartPre` for the packaged command `bin/dam-hopper-manager provision-api-runtime` (rendered as `+@RELEASE_ROOT@/bin/dam-hopper-manager provision-api-runtime`); the root-only command accepts no operands and invokes the same provisioner used by explicit manager starts.
- The API audit writer consumes only an existing no-follow regular file with current effective UID/GID and mode `0600`; it appends/syncs without creating or repairing.

## Failure, rollback, and operator contract

- Pre-existing mismatch: return a sanitized error containing the fixed path and expected/current type, UID, GID, and mode; mutate nothing; invoke no API start. Operator repairs the object out of band, reruns, and the same validation succeeds. Existing helper orchestration remains unchanged.
- Call-created objects: retain only a list of creations and their descriptor identities. On later synchronous failure, unlink the new empty file and remove new empty directories in reverse order only when current identity/type still match; any cleanup race fails closed, retaining the object and reporting primary plus cleanup error. Never remove or mutate a pre-existing object; never keep a metadata mutation journal because existing metadata is never changed.
- Candidate activation failure enters existing transaction rollback. Restored units are reparsed and the gate reruns; if restored identity disagrees with existing paths, rollback start remains stopped and recovery/operator repair is required.
- First-install failure starts nothing. Boot recovery provisions the installed active server before returning success but never starts services; no active server role is provisioned. `ExecStartPre` failure prevents automatic restart from reaching `ExecStart`.

## Release and rollback gate

1. Ship and verify the v2-capable manager on every target before any v2 manifest is published.
2. Regenerate and sign the candidate and designated rollback release manifests as v2; v1 artifacts are not accepted by the new manager.
3. Qualify forward install and application rollback under the v2 manager. Keep the manager at v2 throughout rollback; do not downgrade it while any v2 release can be selected or recovered.
4. Publish only after the channel cannot route a v2 manifest to an old manager. Abort publication on mixed manager capability.

## Scope guard

No observer, upload, diagnostics producer/collector, idle-suspend policy, helper IPC/audit schema or Rust behavior, Phase 02 instrumentation, arbitrary filesystem API, real suspend/RTC/systemd tests, or host-path fallback.

## Current implementation status

- Phase 01 completed 2026-09-12; final API unit identity is authoritative for runtime UID/GID, health, and ownership.
- Phase 02 completed 2026-09-12 after terminal `REVIEW_PASS` (8.5/10), resolved advisor outcome, and passing focused checks. The exact packaged gate command is `bin/dam-hopper-manager provision-api-runtime`; refusal/no-follow provisioning, identity-bound fail-closed cleanup, active-server recovery provisioning without service starts, and pre-provisioned audit consumption are implemented.
- Phase 03 remains pending for qualification matrices, migration/release-gate evidence, and architecture/security/release-owner review.

## Unresolved questions

None.
