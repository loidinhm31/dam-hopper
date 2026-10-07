# Auth Integration & Consumer Map (Lite Mode / SQLite Auth)

## 1. Executive Summary
Lite mode provides SQLite-backed authentication without requiring a MongoDB service. Same binary retains the MongoDB driver. Several production consumers query `state.db` directly; a clean cutover moves them onto the existing shared `AuthStore` boundary. [Parent contracts](../contracts.md) are authoritative.

## 2. Inventory of Direct MongoDB & DB Consumers
| Consumer File & Location | Symbols / Invocations | Purpose & Current Behavior | Migration Action |
|---|---|---|---|
| `server/src/state.rs:77,370` | `AppState.db: Option<mongodb::Database>` | Stores DB instance; instantiates `AuthStore` | Replace/wrap in `AuthBackend` or unified storage enum |
| `server/src/api/auth.rs:389,423` | `get_user_role`, `require_admin` | Enabled-account role lookup and administrator gate | Keep helper, query shared `AuthStore::get_user` |
| `server/src/api/auth.rs:348,455` | `verify_enabled_user`, `verify_actor_credentials` | Same-subject password reauthentication | Shared user lookup; retain bcrypt and password zeroization |
| `server/src/api/auth.rs:459-499` | `register` | Direct Mongo registration, disabled default user | Shared `create_user`; preserve approval policy and report storage failures |
| `server/src/api/auth.rs:375` | `is_enabled_user` | Actor enablement lookup | Shared `get_user` |
| `server/src/api/host_actions.rs:54,227,241,254` | Store presence and enabled actor | Capability and sensitive-action admission | Derive presence from `auth_service.store()`; no cached flag |
| `server/src/api/idle_suspend.rs:121,137` | Store presence and enabled actor | Idle-suspend admission | Same shared-store check |
| `server/src/main.rs:730-756` | `MONGODB_URI`, `AuthStore::new`, `init_indexes` | Connects Mongo and initializes indexes | Branch on lite-mode selector before Mongo connection |

## 3. Configuration & Environment Precedence
- Proposed env-only selection: `DAM_HOPPER_LITE_MODE` and `DAM_HOPPER_AUTH_SQLITE_PATH`. No CLI or TOML scope expansion.
- Missing/empty/false/0 selector preserves MongoDB default. True/1 selects SQLite; invalid values fail.
- Startup loads process/CWD dotenv, global dotenv, explicit config-adjacent dotenv before Clap, then resolved config-adjacent dotenv before DB initialization (`main.rs:500–513,562–565`). Dotenv fills missing values, never overrides process environment.
- Default auth file: existing global DamHopper config directory + `auth.db`; independent of PTY/workflow `sessions.db`. Relative explicit paths resolve against startup CWD; HOME expansion documented in parent contracts.
- Existing SQLite isolation helper `ensure_distinct_database_paths` compares session/telemetry paths; evaluate reuse for auth as part of integration, not a new precedence rule.

## 4. Account Lifecycle & First-User Provisioning
- `api/auth.rs:489–496` uses **bcrypt**, creates `is_enabled=false`, `role=user`, `auth_version=0`.
- Keep registration approval unchanged. Operators approve/promote SQLite users locally using checked SQL; no automatic first-user admin, CLI account-management expansion, or public backdoor.
- Key provisioning remains `DAM_HOPPER_MFA_KEY_FILE`; current AES-256-GCM/TOTP and signing secret are unchanged.
- SQLite initializes versioned schema on explicit lite-mode startup; failure aborts, never degrades to another backend.

## 5. Middleware, Production Guards & Sensitive Action Safety
- Production detection is `RUST_ENV=production` **or** `ENVIRONMENT=production` (`main.rs:741–743`, `state.rs:314–321`). Require selected auth store and existing production MFA key, regardless of backend.
- Preserve startup no-auth bypass: database initialization is skipped (`main.rs:730–732`); state rejects an actual active store with bypass. Environment presence alone is not the current guard.
- Host-actions and idle-suspend checks must work with either store and deny unavailable/disabled actors. Do not enable unrelated currently unavailable host executors.

## 6. Test & Seed Impact
- `server/tests/common/auth_fixtures.rs`: add file-backed SQLite fixture; move generic auth parity cases to real SQLite; keep genuine Mongo collection/index/legacy BSON qualification.
- `server/tests/auth_mfa_api.rs`, `auth_mfa.rs`, `auth_state_and_policy.rs`, `transport_enforcement_phase03.rs`, `auth_no_auth.rs`: migrate constructor and generic fixture callers; map direct collection mutations into SQLite fixture helpers where parity cases require them.
- `server/src/api/tests.rs:7999`, `server/src/api/resource_events.rs:1019`: constructor/raw-state test callers need migration.
- `server/examples/application_e2e_seed.rs`: migrate Mongo store constructor; default Mongo seed behavior remains unchanged. A live SQLite smoke can use real registration + local approval, so new seed flags are not required.

## 7. Real Runtime Smoke Verification Strategy
1. Isolated HOME/config/MFA key and `.env`; lite mode true, real auth file, no Mongo settings or no-auth.
2. Register; verify disabled-by-default denial; approve/promote immutable user ID locally.
3. Password login -> enrollment challenge **without JWT**; setup + valid TOTP confirmation -> real JWT/cookie.
4. Use concrete protected HTTP route and `/ws`; exercise actual administrator-only Advisor settings route with a registered user/admin fixture, not an assumed admin route.
5. Host-action executor may remain unavailable; verify auth admission/denial separately, not an invented successful destructive action.
6. Restart with same DB, key, and signing secret; verify enrolled state/session survives; logout denies prior JWT and closes live WS within existing watcher bound.

## 8. Explicit Uncertainties
None blocking. Parent adjudicated env spelling/path defaults; no new registration policy, password algorithm, admin CLI, or migration scope.
