# Phase 03: Native Server Removal

## 1. Context links

- Plan Root: [plan.md](./plan.md)
- Scope and Architecture Decisions: [reports/00-scope-and-design.md](./reports/00-scope-and-design.md)
- Backend Research Report: [research/researcher-02-backend-docs-report.md](./research/researcher-02-backend-docs-report.md)
- Scout Inventory Report: [scout/scout-01-advisor-removal-report.md](./scout/scout-01-advisor-removal-report.md)
- Ownership Manifest: [reports/01-ownership-manifest.json](./reports/01-ownership-manifest.json)
- User Validation: [confirmed decisions](./plan.md#validation-summary).
- Linux Service Evidence: [installed service re-audit](./reports/03-linux-service-audit.md).

## 2. Parallelization Info

- **Group:** Parallel Group C (Rust domain service, API routes, AppState, server config, server tests and examples)
- **Concurrent Siblings:** Group A ([Phase 01](./phase-01-ui-presentation-removal.md)), Group B ([Phase 02](./phase-02-client-and-test-infrastructure-removal.md)), Group D ([Phase 04](./phase-04-feature-documentation-removal.md))
- **Editing Pre-requisites:** None. Can start editing immediately in parallel.
- **Validation Pre-requisites:** All editing groups (A, B, C, D) must complete before typecheck, test runners, or builds execute.
- **Unblocks:** [Phase 05](./phase-05-integration-verification.md) (Group E).

## 3. Overview

- **Date:** 2026-10-11
- **Description:** Delete Advisor domain/API/state/config and feature-only tests; remove now-unconsumed auth helpers; retain mixed SQLite authentication/storage-failure coverage through surviving production routes.
- **Priority:** P2
- **Status:** completed
- **Review:** Phase 03 implementation completed; domain excised, config Serde compatibility preserved, tests updated.

## 4. Key Insights

- The entire `server/src/advisor/` module (12 files) and `server/src/api/advisor.rs` are feature code to delete.
- In `server/src/api/router.rs`, deleting `advisor_routes` means any request to `/api/advisor/*` returns HTTP 404 naturally via standard Axum routing rules without requiring any shim, deprecated alias, or warning service.
- In `server/src/state.rs`, `advisor_service`, `advisor_settings_lock`, their initialization in `AppState::new()`, and `with_advisor_service()` are removed cleanly.
- `ServerConfig` and `DamHopperConfigRaw` do NOT have `deny_unknown_fields`. Removing `pub advisor: AdvisorConfig` from `ServerConfig` allows existing user configurations containing `[server.advisor]` to parse without error via standard Serde unknown-key semantics.
- In `server/src/config/parser.rs`, remove serialization of `[server.advisor]`. In `replacement.rs`, remove the check `candidate.server.advisor != current.server.advisor`.
- In `server/src/config/tests.rs`, remove advisor literals and dedicated tests, and add a test verifying that legacy configs containing `[server.advisor]` load cleanly and serialize without emitting the section.
- Advisor is the only production caller of `require_admin`; `get_user_role` is only used by that middleware and tests (`server/src/api/auth.rs:383-435`, `router.rs:621-623`). Delete both after removing their consumers. Do not add a test-only route to justify dead production code.
- In `server/tests/linux_release_native_phase07.rs`, delete `test_advisor_history_directory_validation_rejects_symlink` and its `dam_hopper_server::advisor` import.
- No Cargo dependencies are exclusive to advisor (axum, serde, etc. are shared across the server). `Cargo.toml` dependencies remain unchanged.
- Service audit found no dedicated Advisor unit in the queried system inventory. Advisor removal changes the API binary, not ownership of API/web/helper/recovery services.
- Installed legacy plugin runner is enabled/inactive and pins v0.8.4; current API/helper use v0.12.0. Its host cleanup is a separately approved Phase 05 operator gate, not a parallel source edit.

## 5. Requirements

- R03.1: Remove `pub mod advisor;` from `server/src/lib.rs` and `server/src/api/mod.rs`.
- R03.2: Delete entire `server/src/advisor/` directory (all 12 files).
- R03.3: Delete `server/src/api/advisor.rs`.
- R03.4: Remove `advisor_routes` and `advisor_api` from `server/src/api/router.rs`.
- R03.5: Remove `advisor_service` and `advisor_settings_lock` from `AppState` in `server/src/state.rs`.
- R03.6: Remove `pub advisor: AdvisorConfig` from `ServerConfig` and delete `AdvisorConfig` in `server/src/config/schema.rs`.
- R03.7: Remove `AdvisorConfig` re-export from `server/src/config/mod.rs`.
- R03.8: Remove `advisor` table emission from `server/src/config/parser.rs`.
- R03.9: Remove advisor check from `server/src/config/replacement.rs`.
- R03.10: Clean up `server/src/config/tests.rs` and add legacy TOML startup/roundtrip test.
- R03.11: Delete `server/examples/advisor_routing_browser_fixture.rs`.
- R03.12: Delete `server/tests/advisor_history_api.rs` and `advisor_policy_evaluations.rs`.
- R03.13: Remove feature-only administrator-gate coverage and role-helper assertions from `auth_lite_mode.rs`; preserve enabled-user/session/storage-failure/reauthentication guarantees via surviving `/api/projects`.
- R03.14: Update `server/tests/linux_release_native_phase07.rs` to remove the advisor history symlink test.
- R03.15: Delete unused `require_admin` and `get_user_role` from `server/src/api/auth.rs`; retain all surviving authentication and privileged-action gates.
- R03.16: Preserve current service units and legacy release recognition/cleanup safeguards; do not delete unrelated migration contracts because they contain runner names.
- R03.17: Preserve other-project OMP/Evcrate tooling/data. Hand the rebuilt server to Phase 05 for coordinated UI/server release; no service mutation during this phase.

## 6. Architecture

Clean cutover at the backend architecture boundary:
```
[AppState]
   │ (removes fields)
   ├── ✕ advisor_service: Arc<AdvisorService>
   └── ✕ advisor_settings_lock: Arc<Mutex<()>>

[Axum Router]
   └── ✕ advisor_routes (/api/advisor/*) ➔ returns 404 via fallback

[ServerConfig]
   └── ✕ pub advisor: AdvisorConfig ➔ [server.advisor] ignored via Serde
```

## 7. Related code files (exclusive)

All paths relative to `ROOT=/home/loidinh/WS/dam-hopper-ws/remove-advisor`:

### Deleted Files (16 files)
- `server/src/advisor/error.rs`
- `server/src/advisor/evaluation_comparison.rs`
- `server/src/advisor/evaluations.rs`
- `server/src/advisor/history.rs`
- `server/src/advisor/history_scan.rs`
- `server/src/advisor/metrics.rs`
- `server/src/advisor/mod.rs`
- `server/src/advisor/models.rs`
- `server/src/advisor/policy.rs`
- `server/src/advisor/snapshots.rs`
- `server/src/advisor/status.rs`
- `server/src/advisor/types.rs`
- `server/src/api/advisor.rs`
- `server/examples/advisor_routing_browser_fixture.rs`
- `server/tests/advisor_history_api.rs`
- `server/tests/advisor_policy_evaluations.rs`

### Modified Files (12 files)
- `server/src/lib.rs`
- `server/src/api/mod.rs`
- `server/src/api/router.rs`
- `server/src/state.rs`
- `server/src/api/auth.rs`
- `server/src/config/schema.rs`
- `server/src/config/mod.rs`
- `server/src/config/parser.rs`
- `server/src/config/replacement.rs`
- `server/src/config/tests.rs`
- `server/tests/auth_lite_mode.rs`
- `server/tests/linux_release_native_phase07.rs`

## 8. File Ownership

Phase 03 exclusively owns all 28 files listed in Section 7. No other phase modifies these files.

## 9. Implementation Steps

1. Delete all 12 files in `server/src/advisor/`.
2. Delete `server/src/api/advisor.rs`.
3. Delete `server/examples/advisor_routing_browser_fixture.rs`.
4. Delete `server/tests/advisor_history_api.rs` and `server/tests/advisor_policy_evaluations.rs`.
5. Edit `server/src/lib.rs`: Remove `pub mod advisor;` (line 1).
6. Edit `server/src/api/mod.rs`: Remove `pub mod advisor;` (line 1).
7. Edit `server/src/api/router.rs`:
   - Remove `use super::advisor as advisor_api;` or equivalent module import.
   - Delete `let advisor_routes = Router::new()...` block (lines 566–628).
   - Remove `.merge(advisor_routes)` from router construction (line 637).
8. Edit `server/src/state.rs`:
   - Remove `pub advisor_service: Arc<crate::advisor::AdvisorService>,` (line 137).
   - Remove `pub advisor_settings_lock: Arc<tokio::sync::Mutex<()>>,` (line 139).
   - In `AppState::new()`, remove initialization of `advisor_service` and `advisor_settings_lock` (lines 430–433).
   - Delete `pub fn with_advisor_service(...)` (lines 438–444).
9. Edit `server/src/config/schema.rs`:
   - Remove `pub advisor: AdvisorConfig,` from `ServerConfig` (line 681).
   - Remove `self.advisor.validate()?;` from `ServerConfig::validate()` (line 708).
   - Remove `advisor: AdvisorConfig::default(),` from `impl Default for ServerConfig` (line 724).
   - Delete struct `AdvisorConfig` and `impl AdvisorConfig` (lines 729–740).
10. Edit `server/src/config/mod.rs`:
    - Remove `AdvisorConfig,` from `pub use schema::{ ... }` (line 27).
11. Edit `server/src/config/parser.rs`:
    - Remove the `if server.advisor != Default::default() { ... }` block in `write_config` (lines 461–465).
12. Edit `server/src/config/replacement.rs`:
    - Remove the `if candidate.server.advisor != current.server.advisor { ... }` block (lines 20–24).
13. Edit `server/src/config/tests.rs`:
    - Remove `advisor: Default::default(),` in struct literals (line 1036).
    - Remove `advisor_config_default_and_roundtrip` (lines 2288–2322) and `advisor_config_protected_replacement` (lines 2324–2343).
    - Add unit test `legacy_toml_loads_without_advisor`: writes TOML containing `[server.advisor]\nenabled = true`, verifies `read_config` parses successfully, writes config back out, and verifies `[server.advisor]` is not present in written string.
14. Edit `server/src/api/auth.rs`:
    - Recheck references before deletion. LSP is not configured in this checkout; current native grep finds only Advisor router use of `require_admin`, and only that middleware/tests consume `get_user_role`.
    - Delete both helpers, their obsolete comments, and imports made unused. Preserve `require_auth`, enabled-user checks, actor credential validation and host-action authorization.
15. Edit `server/tests/auth_lite_mode.rs`:
    - Delete `administrator_gate_follows_the_selected_store`, which only exercises the removed middleware through Advisor.
    - In the mixed storage-failure scenario, use authenticated `/api/projects` as the live route: healthy store returns 200, missing accounts table must deny with a concrete non-success authentication/storage outcome, not route absence.
    - Remove `get_user_role` imports/assertions and obsolete middleware comments; retain `is_enabled_user`, credential verification, storage failure and password-zeroization checks.
    - No test-only admin endpoint, preserved mock handler or dead middleware.
16. Edit `server/tests/linux_release_native_phase07.rs`:
    - Remove `use dam_hopper_server::advisor::status::inspect_history_root;` (line 7).
    - Delete `test_advisor_history_directory_validation_rejects_symlink` (lines 220–249).

## 10. Todo list

- [x] Delete `server/src/advisor/` tree (12 files)
- [x] Delete `server/src/api/advisor.rs`, `server/examples/advisor_routing_browser_fixture.rs`, and tests
- [x] Modify `server/src/lib.rs` and `server/src/api/mod.rs`
- [x] Modify `server/src/api/router.rs`
- [x] Modify `server/src/state.rs`
- [x] Remove now-unused auth role middleware/helpers from `server/src/api/auth.rs`
- [x] Modify `server/src/config/schema.rs`, `mod.rs`, `parser.rs`, `replacement.rs`, and `tests.rs`
- [x] Modify `server/tests/auth_lite_mode.rs`
- [x] Modify `server/tests/linux_release_native_phase07.rs`

## 11. Success Criteria

- `cargo check` compiles after all editing phases settle; no new warnings attributable to removal. Record unrelated baseline warnings without expanding scope.
- Calling `/api/advisor/status` or `/api/advisor/settings` returns HTTP 404 via standard router.
- Legacy configuration files with `[server.advisor]` load cleanly without Serde error.
- Reserialized TOML omits `[server.advisor]`.
- All surviving Rust unit and integration tests pass.

## 12. Conflict Prevention

- Do not edit any files in `packages/ui/` (owned by Phases 01 and 02) or `docs/` (owned by Phase 04).
- Do not run `cargo test` or `cargo check` mid-flight.

## 13. Risk Assessment

- **Risk:** Existing user configurations with `[server.advisor]` fail to load.
  - **Mitigation:** Verified `ServerConfig` has no `deny_unknown_fields`. Explicit unit test added in `tests.rs` to guarantee legacy compatibility.
- **Risk:** Regressions in auth middleware verification.
  - **Mitigation:** Keep existing real-store session, enabled-user, credential and privileged-action tests; do not preserve Advisor-only middleware for tests.

## 14. Security Considerations

- Eliminates dead administrative endpoints.
- Preserves authentication and all surviving privileged-action gates while removing only code whose production consumers disappear.
- Completely avoids modifying external `~/.evcrate` history or policy files on the host.

## 15. Next steps

- Sibling Phase 04 executes documentation and guidance scrub in parallel.
- Hand the qualified server to Phase 05 for the confirmed coordinated release and separately approved legacy-runner cleanup; source completion does not establish installed-service cleanup.
