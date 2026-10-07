# Phase 03 — Lite Mode Configuration and Integration

## Context links
[Plan](./plan.md) · [Environment/ownership contracts](./contracts.md) · [Consumer map](./research/auth-integration-map.md)
Dependencies: [Phase 01](./phase-01-shared-auth-store.md), [Phase 02](./phase-02-sqlite-auth-storage.md).

## Overview
Date: 2026-10-07. Priority: P2. Effort: 5h. Implementation: pending. Review: pending.
Select SQLite through .env and migrate every production auth consumer; preserve MongoDB default.

## Key Insights
- Main already loads several `.env` locations using non-overwrite semantics; resolve backend after final resolved-config load.
- State, registration, administrator middleware, host-actions and idle-suspend currently require raw MongoDB.
- Production validates DB and MFA key; new backend must satisfy these checks without bypassing them.
- Runtime currently skips database initialization under no-auth; preserve actual behavior rather than inaccurate env-only guard wording.

## Requirements
- Env-only `DAM_HOPPER_LITE_MODE` boolean and optional `DAM_HOPPER_AUTH_SQLITE_PATH`.
- Absent/empty/false/0 -> Mongo default; true/1 -> SQLite; invalid -> actionable error.
- SQLite config independent from PTY/workflow persistence; no implicit Mongo fallback.
- `AuthService` is selected-store authority, no raw `AppState.db` or duplicate availability flag.
- Full admin/reauth/disabled checks and MFA key requirements apply to both modes.
- Validated path default: `auth.db` in the existing global DamHopper config directory when SQLite path is absent/empty. One server process per local auth file; separate server deployments must configure separate files.
- Account approval/admin assignment/MFA recovery remain documented local SQL operations; no new management CLI/API.

## Architecture
After existing dotenv/config loading: resolve typed auth backend config; explicit no-auth branch skips DB open; otherwise open chosen store once, initialize adapter, pass optional store into state. State builds service once with existing MFA key and clock. Production requires store + key. APIs call shared store helpers; transports continue evaluating same `AuthService`.

## Related code files
Modify:
- `server/src/auth/mod.rs`; add `server/src/auth/config.rs` for environment parsing/path resolution if inline main helper would mix domain config with startup.
- `server/src/main.rs`: one-time backend initialization after dotenv; no-auth branch; selected backend startup message without secrets.
- `server/src/state.rs`: replace raw db parameter/field with selected store; generalized production/bypass/key checks; remove implicit runtime mock fallback (explicit test mocks stay).
- `server/src/api/auth.rs`: register/create_user, role/enabled/credential helpers via store; remove obsolete reduced `User` after migrating callers.
- `server/src/api/host_actions.rs`, `server/src/api/idle_suspend.rs`: availability/actor checks via selected service.
- Every `AppState::new` caller under server tests/API tests/examples: migrate exact signature; use explicit mocks only where existing tests genuinely need them.
- `server/src/telemetry/runtime.rs` only if needed to reuse existing path identity comparison for auth vs session/telemetry collision checks; do not refactor telemetry broadly.
Intentionally unchanged: frontend, JWT/cookie payloads, auth routes, workflow storage, release binaries.

## Implementation Steps
1. Inspect LSP references for exported state constructor/credential helpers/reduced User before changing types. Migrate full reference list, including tests and examples.
2. Parse selector/path according to contracts, after `main.rs` final resolved `.env` load. Never use Mongo URI presence as selector; lite true ignores stale Mongo vars. Default Mongo branch keeps existing production/development semantics.
3. Resolve default config-directory path, HOME/relative paths once at startup. Validate selected auth DB differs from session and configured telemetry DB using existing identity/normalization conventions; no destructive reuse of another subsystem database.
4. Instantiate selected store once; SQLite failures are fatal. Preserve Mongo current index-init warning behavior; do not use SQLite migration failure as unavailable dev fallback.
5. Replace `AppState.db` and db constructor argument; store lives in `AuthService`. Production store/key checks backend-neutral; no-auth/active-store rejected. With no configured store, runtime uses unavailable auth service, not default test account; adapt unrelated fixture helpers explicitly.
6. Migrate helper signatures to `Option<&AuthStore>`; retain same-subject reauth, enabled-user denial and password zeroization. Do not add bcrypt worker/algorithm redesign in this task.
7. Registration uses `UserRecord` and real `create_user`: bcrypt error -> failure, duplicate -> existing duplicate-user behavior, DB insert failure -> failure, never false success. Preserve disabled/user defaults and wire success shape.
8. Migrate admin middleware and availability/actor checks. Existing mock-admin test path remains explicit; normal runtime cannot consult mock records after missing store/error.
9. Keep REST/WS/media/status/logout on shared `AuthService`; no backend-specific shortcuts. Update constructor-only Mongo seed/qualification callers without new seed CLI flags.

## Todo list
- [ ] Parse and resolve .env selection/path.
- [ ] Initialize one selected store and migrate state.
- [ ] Generalize production/key/no-auth guards.
- [ ] Migrate registration, role and sensitive-action helpers.
- [ ] Migrate all consumers/tests/examples; no obsolete raw-db paths.

## Success Criteria
- `.env` lite true starts authenticated server with SQLite, even with no Mongo vars/service.
- Default/empty/false selects Mongo only; path alone does not select SQLite; invalid mode and invalid lite database do not fall back.
- Production lite + valid MFA key succeeds; production missing key/store and no-auth fail as applicable.
- Admin checks and reauth work with SQLite; disabled users denied; same-subject/password constraints preserved.
- No production raw `state.db`, Mongo collection lookup or `api::auth::User` remains; genuine Mongo adapter/fixtures remain explicit.

## Risk Assessment
Default-mode regression, env precedence drift, test-helper dependence on implicit mock service, storage path collisions. Use process-isolated env scenarios, complete LSP inventory, explicit fixture migration, and existing path identity helper.

## Security Considerations
Do not auto-enable/promote first account, relax MFA, accept signing-secret file as bearer, expose DB/passwords in logs, or create auth-file effects under no-auth. Unavailable storage must deny.

## Next steps
Phase 04 executes config/startup tests, security parity and real authenticated runtime smoke. Update current docs only after this behavior is proven; proposed architecture section remains labeled planning until then.
