# Command plan

## Goal

Implement the approved runtime-identity reconciliation without diagnostics Phase 02 work.

## Guardrails

- Release manifests: hard v2 only; manager state stays v1; no dual read or compatibility shim.
- Runtime authority: final API unit `User=`/`Group=` is the sole runtime identity authority.
- Provisioning: create absent objects; refuse every pre-existing metadata/type mismatch without mutation; cleanup is identity-bound and fails closed.
- Startup: preserve `Restart=on-failure`; use exactly one fixed root, zero-operand `ExecStartPre` for the packaged command `bin/dam-hopper-manager provision-api-runtime`; explicit starts use the same gate.
- Audit: consume only the pre-provisioned no-follow audit file; never create or repair it in the consumer.
- Units: remove `StateDirectory=dam-hopper` from API and helper; helper runtime/log/protocol v1 remains unchanged.
- Scope: no observer, upload, diagnostics producer, idle-suspend policy, helper Rust behavior, suspend, or RTC changes.

## Phases

1. [Manifest v2 and identity authority](phase-01-reconcile-runtime-identity-authority.md)
   - Split manifest/state constants to v2/v1.
   - Remove API identity field/constant and all runtime fallbacks.
   - Finalize, validate, and parse exact non-root unit identity.
   - Define manager-first publication and v2 rollback-release gate.
2. [Refusal-based runtime provisioning](phase-02-provision-api-runtime-paths.md)
   - Descriptor-relative no-follow create/validate for fixed paths.
   - Never repair or mutate pre-existing objects; cleanup only call-created objects with identity-bound, fail-closed removal.
   - Gate explicit starts, rollback, and automatic restarts; boot recovery provisions an active server before success without starting services.
3. [Qualification and review](phase-03-qualify-and-review-reconciliation.md)
   - Default/custom/root/mismatch identity matrix.
   - Missing-create, mismatch-no-mutation, manual-repair-rerun, symlink, cleanup, and ordering matrix.
   - Prove v2-only producer/consumer, v1 state retention, migration gate, helper v1 compatibility.

## Focused commands after implementation

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

- [Synthesis](reports/01-planning-synthesis.md): hard v2 release-manifest cutover; final API unit is sole runtime identity authority; exact packaged gate is `bin/dam-hopper-manager provision-api-runtime`; unsafe pre-existing paths require manual repair before a retry; recovery provisions active server before success without starting services.
