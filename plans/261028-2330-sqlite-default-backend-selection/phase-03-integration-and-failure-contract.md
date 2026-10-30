# Phase 03 — Integration Tests and Failure Contract Verification

Priority P2 · Status pending · Effort 4h

## Context and architecture
- [Final contract](./plan.md), [runtime behavior](./phase-02-runtime-startup-wiring.md).
- Existing `server/tests/auth_lite_mode.rs` and `auth_no_auth.rs` exercise routed/AppState behavior; they do not replace testing `main.rs` environment selection.
- Existing file-backed `auth_sqlite_store.rs` proves adapter invariants; reuse without changing schema or storage implementation.
- Container fixture already sends both Mongo variables and explicitly true for SQLite (`application-services.ts:224-237`). Keep this established backend split; audit before making edits.

## Task: cover-startup-contract
Create `server/tests/auth_backend_startup.rs`; keep harness local to this test binary, not a new shared framework.

### Implementation steps
1. Launch `env!("CARGO_BIN_EXE_dam-hopper-server")` as child process with isolated temp HOME, XDG config/state/data paths, CWD, workspace, minimal explicit TOML config, session/telemetry paths, and loopback host/unique port. On Windows preserve necessary OS/runtime variables and isolate USERPROFILE/APPDATA as applicable; do not change production path resolution.
2. Clear backend/auth/production flags explicitly and eliminate inherited dotenv inputs: temp CWD, global config directory and config/workspace parent must contain no `.env`. Preserve only required runtime environment values. No mutation of test-runner global env.
3. Reuse production CLI/config schema and readiness route discovered in existing fixtures. Poll observable readiness/child exit with a finite deadline; capture bounded stdout/stderr continuously so pipes cannot deadlock. Child RAII guard kills and waits on every return/panic; clean only its tempdir/resources. No writes to developer's real auth.db/key/config.
4. Test development clean default WITHOUT SQLite override; inspect isolated default auth.db using read-only SQLite and assert auth schema/application ID. Verify exact default log and protected route rejection. Empty/whitespace selector still automatic.
5. Test explicit true with both Mongo variables, partial Mongo, malformed URI and set-empty Mongo values; actual SQLite opens, no Mongo needed. Test path override independently from default and confirm explicit-selection log.
6. Parameterize fatal config cases: explicit false without both variables; partial Mongo in each direction; either/both values set-empty/whitespace; invalid selector. Assert nonzero child exit, variable-specific diagnostic, no auth.db at default OR override path, no backend readiness. Both genuinely absent is the only automatic-SQLite case.
7. With both Mongo variables present, malformed URI and a known-unreachable loopback endpoint must fail without fallback, with unset selector and explicit false. Bound driver waiting through standard URI timeout options. Assert sentinel URI credentials do not appear in logs/errors.
8. Production SQLite: test RUST_ENV and ENVIRONMENT separately (including one production flag with the other development); absent, empty, missing-path, malformed and Unix insecure-permission key failures occur before auth.db creation. Valid dedicated owner-only key permits both default and explicit SQLite startup. Reuse existing key semantics rather than invent stricter formats.
9. `--no-auth`: loopback development starts even with invalid selector/partial/set-empty Mongo and invalid SQLite path; does not create auth.db. Both production flags reject bypass. Nonloopback bypass remains denied; preserve existing guard semantics and cover applicable configured bind addresses.
10. SQLite startup failures: session/telemetry collision, invalid path/permissions, and corrupt/foreign DB remain fatal, no Mongo fallback. Keep broad WAL/CAS tests in existing suite instead of duplicating them.
11. Restart default SQLite after creating a disabled registration via real API; assert persisted user remains disabled and second registration conflicts, no automatic first-user admin. Keep approval/enrollment/cryptography regression in existing `auth_lite_mode` suite.
12. Add live Mongo happy cases in the same test file using an explicitly configured isolated test service/database: automatic selection and explicit false each start, Mongo auth-state is observable, and no auth.db is created. Reuse existing test-only `TEST_MONGODB_URI` naming (`server/tests/common/auth_fixtures.rs:45`); require it explicitly for these new live cases instead of silently choosing a service. Generate a unique database per case and drop only that owned database during cleanup. Never use a production database or an ambient product URI silently. Clearly report service unavailability as blocked/skipped, never substitute SQLite or report a full pass.
13. Preserve index-warning policy explicitly: live fixture uses an existing real index-conflict/permission mechanism only if safely available to force index failure after successful ping; confirm continued Mongo mode. Otherwise record this runtime branch unexercised and require source-review evidence of unchanged warning behavior, not a fabricated test result. Do not alter product code to manufacture the failure.

### Expected case outcomes
| Group | Expected |
| --- | --- |
| Automatic, Mongo variables genuinely unset | SQLite default file + default log + protected HTTP |
| Explicit true, arbitrary Mongo env | SQLite explicit log + no external DB dependency |
| Both nonblank valid Mongo vars | Real Mongo startup without lite selector |
| Explicit false, absent/partial/blank vars | Fatal config error + no auth.db |
| Automatic partial/blank vars; invalid selector | Fatal config error + no auth.db |
| Mongo invalid/unreachable | Fatal before auth readiness + no auth.db |
| SQLite production invalid key | Fatal before SQLite creation |
| Allowed no-auth bypass | No backend parsing/auth.db; existing development API behavior |
| Restart same default path | Same disabled user persists; no implicit promotion |

## Task: audit-container-backends
1. Read existing `packages/ui/e2e/fixtures/application-services.ts`, fixture probe spec, and SQLite journey. Mongo-specific tests already supply `MONGODB_URI` plus `MONGODB_DATABASE`; retain this explicit configuration and real Mongo service.
2. Audit container image/environment injection for inherited `DAM_HOPPER_LITE_MODE=true`: Mongo startup must not accidentally force SQLite. If necessary pass `DAM_HOPPER_LITE_MODE=false` in the Mongo branch to enforce intended store. Existing explicit SQLite branch remains true; no change to fixture default backend or seeding format.
3. Add focused assertions to existing fixture probe for actual intended backend/storage and no accidental fallback where missing. Keep SQLite no-Mongo-container assertion. Do not add redundant assertions if existing probes already prove the contract; unchanged source is acceptable with documented audit evidence.
4. Do not expand the fixture API solely to test unset selectors: Rust subprocess tests already own zero-config startup. Preserve seeded-session/production-MFA safety checks and existing E2E journey.

## Ownership and risk controls
- Create only `server/tests/auth_backend_startup.rs` for subprocess coverage. No other test-helper writes unless coordinator approves an exact scope revision.
- Fixture task may modify `packages/ui/e2e/fixtures/application-services.ts` and `packages/ui/e2e/fixtures/application-services.spec.ts` only when the audit finds a gap. Existing SQLite journey intentionally unchanged.
- No tests execute while dependent edits are underway. Single coordinator verification owner runs focused commands after phases land; real Mongo/container prerequisite absence remains explicit.
- No mock success, silent SQLite substitute, broad retries, brittle sleeps, raw secret logging, production DB fixtures, or process leaks. Rollback removes only new test file/scoped fixture edits, never databases outside temporary fixtures.

## Durable task contract
```evcrate-tasks
[
  {
    "id": "cover-startup-contract",
    "title": "Add isolated real-binary backend startup and failure regressions",
    "blocked_by": ["wire-auth-startup"],
    "allowed_files": ["server/tests/auth_backend_startup.rs"],
    "constraints": ["Use isolated child environments and real binary/datastores; no global-env races or developer-state access.", "Keep live Mongo optional prerequisites explicit; skipped/unexercised branches are not passes.", "No runtime locking mechanism, schema changes, crypto changes or altered Mongo index policy.", "Author tests only; integrated execution belongs to coordinator after edits land."],
    "acceptance": ["Real startup proves automatic/explicit SQLite, Mongo selection, fatal config/connection/key cases and no fallback.", "Set-empty/whitespace Mongo values fail outside explicit SQLite; genuinely unset values default correctly.", "No-auth bypass and production/host guards retain behavior; default SQLite restart preserves disabled-account state.", "All child processes/temp resources are reclaimed; diagnostics exclude sentinel secrets."],
    "verification": ["Coordinator sets TEST_MONGODB_URI to an isolated test service, runs cargo test --manifest-path server/Cargo.toml --test auth_backend_startup -- --test-threads=1, and records exact cases, failures, skips and Mongo prerequisites.", "Coordinator runs existing auth_lite_mode, auth_no_auth and auth_sqlite_store integration targets; no replacement of existing security regressions."]
  },
  {
    "id": "audit-container-backends",
    "title": "Audit explicit Mongo and SQLite container backend fixtures",
    "blocked_by": ["wire-auth-startup"],
    "allowed_files": ["packages/ui/e2e/fixtures/application-services.ts", "packages/ui/e2e/fixtures/application-services.spec.ts"],
    "constraints": ["Retain real datastore containers, current fixture API and backend default; change only a demonstrated gap.", "Keep both Mongo variables present and explicit SQLite precedence; no unnecessary new fixture selection mode.", "Do not execute container builds or tests mid-flight; coordinator owns coherent verification."],
    "acceptance": ["Mongo-specific fixture cannot silently run SQLite; its selected store matches seeded data.", "Existing SQLite journey still runs with no Mongo container and a valid production MFA key.", "Audit records whether files required edits; unchanged correct configuration is intentional."],
    "verification": ["Coordinator runs pnpm --filter @dam-hopper/ui test:e2e:typecheck and existing test:e2e:probes with required container engine/images.", "Coordinator runs pnpm --filter @dam-hopper/ui test:e2e -- sqlite-auth-lite-mode/sqlite-auth-lite-mode.spec.ts and records exact container/browser prerequisites and outcomes."]
  }
]
```

- [ ] <!-- evcrate-task:cover-startup-contract --> Cover real startup and failure boundaries
- [ ] <!-- evcrate-task:audit-container-backends --> Audit container selection and regression fixtures

## Handoff
Phase 04 documents final behavior and owns the one integrated qualification task. Product behavior is not accepted merely because tests were authored or existing skipped tests returned exit zero.
