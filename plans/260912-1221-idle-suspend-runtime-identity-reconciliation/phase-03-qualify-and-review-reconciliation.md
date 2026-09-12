# Phase 03 — Qualify and review reconciliation

## Context links

- [Plan](plan.md) · [Synthesis](reports/01-planning-synthesis.md)
- [Phase 01](phase-01-reconcile-runtime-identity-authority.md) · [Phase 02](phase-02-provision-api-runtime-paths.md)
- [Parent diagnostics plan](../260912-0027-production-idle-suspend-diagnostics/plan.md)
- [System architecture](../../docs/system-architecture.md) · [Codebase summary](../../docs/codebase-summary.md) · [Code standards](../../docs/code-standards.md) · [PDR](../../docs/project-overview-pdr.md)

## Overview

- Effort: 8h
- Date: 2026-09-12
- Description: prove v2 identity authority and refusal-based pre-start provisioning, qualify migration/rollback, preserve helper v1, then re-review architecture.
- Priority: P2
- Implementation status: pending
- Review status: architecture, security, and release-owner approval required

## Key Insights

- Tests must observe serialized manifests, rendered units, numeric metadata, unchanged existing objects, failure outcomes, and start ordering—not constants, source text, or field forwarding.
- Refusal and automatic repair are mutually exclusive. Qualification must prove mismatch-no-mutation and operator-repair-then-success, not a repair path.
- `StateDirectory=` can mutate before `ExecStartPre`; unit contract evidence must prove it is absent from both API and helper while API `Restart=on-failure` and the fixed gate remain.
- The v2 cutover needs deployability evidence: old-manager incompatibility is accepted only with manager-first rollout and a prequalified v2 rollback release.
- Planned architecture lines 496–520 and 663–673 cannot be marked implemented until behavior and source review agree. Parent diagnostics Phase 02 remains blocked through approval.

## Requirements

- Cover default identity, custom identity with differently named primary group, render-context/final-unit and live-process mismatch, root name/UID alias/root group rejection, and health UID/GID.
- Cover absent-path creation, valid no-op rerun, each pre-existing owner/group/mode/type mismatch with no mutation, manual repair then success, each managed-component symlink, special audit type, failure cleanup, and provisioning-before-start where a start occurs; boot recovery must provision an active server before success without starting services.
- Assert existing audit bytes/inode and every pre-existing object's stat metadata remain unchanged on both success-no-op and failure.
- Prove API/helper templates have no `StateDirectory`/`StateDirectoryMode`; API preserves `Restart=on-failure` and has exactly one fixed privileged zero-operand provisioning `ExecStartPre`; helper runtime/log/hardening directives remain unchanged.
- Keep tests in existing `linux_release_*` suites or beside focused modules. Use temp roots, private fake account/syscall source, and injected starter. No global `PATH` mutation, host account creation, real systemd, helper execution, suspend, RTC, socket, or production paths.
- Prove generator/schema/Rust parser/fixtures are v2-only, API identity is absent/rejected, manager state remains v1, and web identity validation remains enforced.
- Prove the release gate artifact/process rejects mixed old/new manager capability, requires regenerated/signed v2 forward and rollback manifests, and blocks manager downgrade while v2 assets are active. Do not add a dual-read shim.
- Review every API start path: active start, candidate activation, automatic rollback, boot recovery ordering, modern manual rollback re-entry, first install, and `Restart=on-failure`.
- Run existing helper protocol v1 focused tests unchanged; no helper Rust runtime/log/protocol behavior change is allowed.
- Update live docs only after evidence. Mark runtime identity/provisioning implemented, preserve diagnostics Phase 02 as planned, and document refusal/manual-repair plus manifest v2 migration gates. Do not edit the parent plan.

## Architecture

- Qualification layers:
  1. Manifest v2/state v1 serialization and exact unit/account contracts.
  2. Descriptor-relative provisioner and audit consumer in temp roots.
  3. Activation/rollback/recovery orchestration with recorded starter.
  4. API/helper rendered unit policy, including automatic-restart gate.
  5. Release publication/rollback migration gate and owner approval.
- Identity matrix: final unit pair → numeric identity → health and four API-owned filesystem postconditions. Manifest and host selection are absent from runtime lookup.
- Existing-object matrix snapshots metadata/content/inode before call and compares afterward; every mismatch has zero starts. A separate fixture applies explicit operator repair, then reruns to success.
- Failure matrix records earliest injected creation fault, exact call-created empty objects removed, pre-existing objects unchanged, starter count/order, and transaction recovery outcome.
- Documentation distinguishes implemented reconciliation from planned diagnostics producers/collector.

## Related code files

| Action | Absolute path | Intended symbol/change | Dependency |
| --- | --- | --- | --- |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/linux_release/api_runtime.rs` | Focused module tests for refusal, creation cleanup, and ordering seam | Phase 02 |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/idle_suspend/tests.rs` | Pre-provisioned audit consumer tests without helper behavior change | Phase 02 |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/tests/linux_release_manifest.rs` | v2-only round-trip, v1 rejection, manager-state v1 independence | Phase 01 |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/tests/linux_release_manifest_errors.rs` | Removed API field rejection and unchanged web identity validation | Phase 01 |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/tests/linux_release_unit_policy.rs` | Identity matrix; StateDirectory absence; fixed ExecStartPre; retained Restart/helper directives | Phase 01–02 |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/tests/linux_release_staging.rs` | Final unit identity/digest and no late fallback | Phase 01 |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/tests/linux_release_ownership.rs` | Create, mismatch-no-mutation, operator-repair success, symlink, cleanup matrix | Phase 02 |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/tests/linux_release_state_machine.rs` | Active/candidate/rollback/recovery ordering and zero-start failures | Phase 02 |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/tests/linux_release_publisher_contract.rs` | v2-only producer/consumer plus forward/rollback publication contract | Manifest producer |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/tests/deploy/linux-release-common.sh` | Align isolated mock manifests to v2 with no API identity | Manifest producer |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/docs/system-architecture.md` | After evidence, record v2 authority, refusal semantics, sole provisioner, and planned diagnostics boundary | Approval gate |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/docs/codebase-summary.md` | Update module/test/release-gate map | Architecture approval |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/docs/code-standards.md` | Add concise final-unit/no-follow/no-repair invariants | Architecture approval |
| Inspect only | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/docs/project-overview-pdr.md` | Prevent overclaim beyond evidence | Review gate |
| Inspect only | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/plans/260912-0027-production-idle-suspend-diagnostics/plan.md` | Verify Phase 02 remains blocked; do not edit | Final approval |

## Implementation Steps

1. Build table-driven v2 manifest/state cases: valid v2 without API identity, v1 rejection, v2 API identity rejection, web identity drift rejection, and unchanged v1 manager-state read/write.
2. Build account/unit matrix: default, custom user with differently named primary group, root name, UID-0 alias, GID-0 group, non-primary group, missing/duplicate directives, render mismatch, and live-process mismatch.
3. Under temp roots, create each absent-path combination and assert exact final owner/group/type/mode before the recorded starter can run.
4. Snapshot pre-existing bytes/inodes/stat. For each owner/group/mode/type mismatch, assert sanitized error, identical snapshot afterward, and zero starts. Apply explicit fixture-side operator repair and assert rerun succeeds; production provisioner performs no repair.
5. Replace each managed component with a symlink/special object and prove target/non-managed content is unchanged. Inject failure after each creation and prove only call-created empty objects whose recorded identity/type still match are cleaned in reverse order; any cleanup race fails closed.
6. Exercise active/candidate/automatic rollback with recorded adapters and boot recovery with its no-start path. Assert restored identity is reparsed, mismatch blocks rollback start for operator action, active-server recovery provisions before success without starting services, first install stays stopped, and explicit successful order is provision then start.
7. Parse rendered units: neither has StateDirectory directives; API retains `Restart=on-failure` and one exact fixed privileged zero-operand `ExecStartPre`; helper retains runtime/log/hardening directives. Prove `ExecStartPre` failure prevents `ExecStart` contractually without real systemd.
8. Exercise audit consumer against valid existing file and absent/mismatch/symlink cases. Preserve record schema/append+sync behavior and do not execute helper.
9. Qualify v2 publication workflow: v2 manager prerequisite, candidate and rollback manifests both regenerated/signed v2, mixed-capability refusal, application rollback under v2 manager, manager downgrade prohibited. Avoid source-text-only assertions; test the existing publisher/validator boundary or smoke the scripts in isolated fixtures.
10. Run unchanged helper v1 framing/round-trip/behavior tests and confirm helper Rust/runtime/log/protocol behavior has no diff.
11. Audit callsites and remove obsolete repair, v1 compatibility, API identity, fallback, StateDirectory, and mutation-journal tests/comments/exports.
12. Update architecture/codebase/standards from observed evidence; obtain architecture, security, and release-owner approval before parent Phase 02 handoff.

## Todo list

- [ ] Prove v2-only manifests and manager-state v1 independence.
- [ ] Complete final-unit identity matrix.
- [ ] Complete create/refuse/no-mutation/manual-repair/cleanup matrix.
- [ ] Prove every explicit and automatic start is gated.
- [ ] Qualify manager-first publication and v2 rollback release.
- [ ] Prove helper v1 and unrelated unit behavior unchanged.
- [ ] Record three-owner approval.

## Success Criteria

- Manifest producer/consumer accept v2 only; v1 and API identity fail; manager state remains v1; web identity remains enforced.
- Default/custom final-unit identity drives health and ownership; every root/mismatch/fallback case fails closed.
- Missing objects are created exactly; a valid rerun is mutation-free.
- Every pre-existing mismatch and symlink/special-file case produces no mutation and zero starts; explicit operator repair followed by rerun succeeds.
- Creation failure cleans only call-created empty objects whose recorded identity/type still match; any cleanup race fails closed; no pre-existing metadata/content/inode changes.
- All explicit starts and rollback pass the provisioner. Boot recovery provisions the installed active server before success without starting services. API automatic restart retains `Restart=on-failure` and cannot bypass the exact privileged `ExecStartPre`.
- Neither API nor helper unit contains StateDirectory directives; the helper does not claim `/var/lib/dam-hopper` and retains runtime/log/hardening/protocol behavior.
- Publication gate demonstrates old managers cannot consume v2, requires v2 candidate+rollback manifests and homogeneous manager rollout, and blocks manager downgrade without introducing dual read.
- Helper protocol v1 focused evidence passes unchanged. Architecture describes only implemented reconciliation; diagnostics producer/collector remains planned.
- Narrow verification commands:
  - `cargo test -p dam-hopper-server --test linux_release_manifest`
  - `cargo test -p dam-hopper-server --test linux_release_manifest_errors`
  - `cargo test -p dam-hopper-server --test linux_release_unit_policy`
  - `cargo test -p dam-hopper-server --test linux_release_staging`
  - `cargo test -p dam-hopper-server linux_release::api_runtime::tests`
  - `cargo test -p dam-hopper-server --test linux_release_ownership`
  - `cargo test -p dam-hopper-server --test linux_release_state_machine test_api_runtime`
  - `cargo test -p dam-hopper-server idle_suspend::tests::test_server_audit_preprovisioned_contract`
  - `cargo test -p dam-hopper-server idle_suspend::tests::test_helper_protocol_suspend_roundtrip`
  - `cargo test -p dam-hopper-server --test linux_release_publisher_contract`

## Risk Assessment

- Tests accidentally encode implementation details: assert serialized contracts, filesystem snapshots, error class, and starter reachability instead.
- Ownership mismatch cases may need privilege: isolate numeric ownership transitions behind the private fixed-operation fake while real temp-root cases prove type/mode/content/no-follow behavior.
- Migration test understates operational incompatibility: require both manager capability and v2 rollback artifact before publication is considered ready.
- StateDirectory residue can invalidate refusal semantics: review both templates, policy parser, rendered fixtures, and docs.
- Documentation can overclaim diagnostics delivery: update only reconciliation and keep parent Phase 02 planned/blocked.

## Security Considerations

- Review descriptor lifetime, no-follow flags, exclusive create, exact metadata comparison, bounded empty cleanup, root UID/GID rejection, and error sanitization.
- No fault injection option ships in CLI/environment; test seams remain private.
- Never inspect/log audit content beyond fixed fixture bytes; never expose symlink targets or account records.
- Helper protocol, runtime/log behavior, peer enrollment, RTC, and suspend ordering are frozen.

## Next steps

After focused evidence, architecture/security/release owners issue one no-contradiction disposition. Only then may the parent diagnostics plan treat runtime identity and API path ownership as implemented prerequisites.

## Unresolved questions

None.
