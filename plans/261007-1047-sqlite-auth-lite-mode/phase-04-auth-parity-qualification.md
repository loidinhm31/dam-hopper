# Phase 04 — Authentication Parity and Runtime Qualification

## Context links
[Plan](./plan.md) · [Security contracts](./contracts.md) · [Consumer map](./research/auth-integration-map.md)
Dependencies: completed [Phase 03](./phase-03-lite-mode-integration.md); real SQLite store and runtime integration exist before executing these commands.

## Overview
Date: 2026-10-07. Priority: P2. Effort: 6h. Implementation: complete. Review: complete.
Prove consumer-visible auth behavior with real SQLite, live server, and default Mongo regression; do not certify via compile or mock echoes.

## Key Insights
- Existing auth suites may skip when Mongo is unavailable. SQLite acceptance must be deterministic and cannot silently skip.
- End-to-end login requires enabled account + configured MFA key; password-only login returns challenge, not JWT.
- SQL CAS needs independent connections for race evidence. A shared-mutex fixture alone cannot establish database correctness.
- Actual server smoke is separate from router tests; no-auth/mock sessions cannot qualify authenticated lite mode.

## Requirements
- Retain meaningful existing policy/MFA/transport regressions; adapt shared behavioral cases to SQLite or run backend-parametrized fixtures.
- Retain Mongo-specific unique-index/legacy-BSON tests and seed behavior; execute them on reachable isolated Mongo.
- Add only uncertain boundary/transition/regression tests; no source-text/forwarding/incidental-default tests.
- Record exact commands, executed/skipped counts, runtime results, platform limitations and failure diagnostics without secrets.
- Qualify one server process per local auth file. Independent-connection races model concurrent requests and operator writes, not multi-server/network-filesystem deployment support.
- Exercise validated global auth.db fallback and checked local SQL approval/admin/MFA reset; do not substitute an admin CLI or automatically promoted account.

## Architecture
Test fixtures own TempDir auth file + dedicated MFA key + injected clock; helpers insert/read via shared store or backend-specific isolated mutation helpers for operator reset. Production remains free of fixture/mock/backdoor code. Separate live-server smoke uses real .env and real HTTP/WS in isolated HOME/config.

## Related code files
Modify:
- `server/tests/common/auth_fixtures.rs`: shared fixture store and real SQLite constructor, local mutation helpers; preserve explicit Mongo fixture when collection behavior matters.
- `server/tests/auth_mfa.rs`, `auth_mfa_api.rs`, `auth_state_and_policy.rs`, `transport_enforcement_phase03.rs`, `auth_no_auth.rs`: migrate callers and run generic security behaviors against SQLite; preserve Mongo-specific cases.
- `server/src/api/tests.rs`, `server/src/api/resource_events.rs`: raw state/constructor callers.
- `server/examples/application_e2e_seed.rs`: constructor migration, unchanged Mongo default seed output/inputs.
Create:
- `server/tests/auth_sqlite_store.rs`: durable schema, duplicate/invalid state, exact CAS and independent-connection races.
- `server/tests/auth_lite_mode.rs`: isolated process/environment startup selection scenarios if existing startup tests cannot host them cleanly.
Intentionally unchanged: frontend suite architecture and release workflow; no new permanent smoke shell script required.

## Implementation Steps
1. Identify generic auth suite cases vs Mongo-specific index/BSON checks; migrate generic fixtures instead of duplicating entire suites. Generic SQLite tests must fail normally on unavailable fixture setup.
2. Cover store transitions: exact username duplicates/case sensitivity; preserving immutable IDs; complete session/challenge fields including step-up binding; reopen persistence; failed/corrupt decoding denies lookup.
3. Cover races using two independently opened connections to one temp file: enrollment, equal-step replay, challenge consume, session credential update, concurrent account attempts. Assert winning state plus denied loser, not counts alone.
4. Cover injected-clock boundaries: five-minute challenge, five attempts, ten-attempt/ten-minute account throttle/cooldown, ten-day MFA freshness, thirty-day absolute expiry; exact `now == deadline` denied.
5. Cover stale account/credential versions, disabled/deleted users, revoke one/all, conditional immutable-ID operator MFA reset, stale reset no-match. Verify old JWT/challenge denial and fresh enrollment after reset.
6. Cover registration: disabled/user defaults at API boundary; duplicate registration cannot overwrite; storage/hash errors cannot return `{ok:true}`. Admin and same-subject reauth enforce enabled status and correct credentials; helper-only test allowed where host executor unavailable.
7. Cover process-isolated .env selection: absent/empty/false/0; true/1; invalid; SQLite-path-only; lite with stale/unreachable Mongo vars; absolute/relative/HOME/default path; existing dotenv precedence. No global env mutation races in shared tests.
8. Cover production lite valid key; missing/unreadable key; unwritable/corrupt/newer-schema SQLite; no-auth production rejection and no-auth avoiding auth DB side effects. Preserve default Mongo startup semantics, reporting unavailable real Mongo rather than fake success.
9. Cover protected HTTP, administrator route, WS admission/live revocation/deadlines and auth-bound media policy with real selected SQLite fixture. Keep existing origin, cookie/bearer and capability policies intact.
10. Run final formatting, compilation and suites once integrated; fix observed failures without narrowing behavioral acceptance.
11. Run real server smoke below, observe protocol responses and persistent file state; remove temporary files/processes afterward. Persist evidence report under plan reports, not secrets.

## Todo list
- [x] Migrate reusable auth fixtures and preserve Mongo-specific qualification.
- [x] Add deterministic durable/CAS/config boundary cases.
- [x] Run final Rust gates and real Mongo regressions.
- [x] Exercise authenticated live SQLite server and restart/logout.
- [x] Record evidence and clean temporary smoke artifacts.

## Success Criteria
### Planned commands (not executed during planning)
From worktree `server/`:
```bash
cargo fmt --check
cargo check --all-targets
cargo test --test auth_sqlite_store
cargo test --test auth_lite_mode
cargo test --test auth_state_and_policy --test auth_mfa --test auth_mfa_api --test auth_no_auth --test transport_enforcement_phase03
cargo test
```
New test targets above become valid only when implemented. Run existing Mongo-specific coverage with `TEST_MONGODB_URI` targeting a real isolated instance; report skips and do not call a skipped path qualified. Format only changed Rust files if repository-wide existing drift exists.

### Required real-server smoke
1. Isolated HOME/global config/CWD, auth `.env`, key mode 0600, loopback port, and explicit config; no no-auth, no Mongo service/settings. Launch actual `dam-hopper-server` with existing `--config`, `--host`, `--port` arguments.
2. Health responds. Register an account; pending approval denies login. Local checked SQL enables/promotes verified immutable user ID; no first-user auto-promotion.
3. Login returns `enrollmentRequired` without token. Setup returns same pending secret for repeated setup. Generate valid six-digit TOTP and confirm; observe real V2 JWT + cookie, then authenticated status.
4. Use bearer on `GET /api/projects` (protected route) and `GET /api/advisor/status` (admin status accessible even when Advisor disabled). Downgrade local role -> admin route denied; restore for subsequent smoke if needed.
5. Connect `/ws` with supported real session credential; observe admission and normal protocol response. Include browser credential/origin constraints already enforced, not a test bypass.
6. Restart same server with same DB, signing secret and MFA key; old valid session still works, account stays enrolled. Create subsequent login challenge and verify a newer TOTP step; replay denied.
7. Logout: old JWT status/protected route denied and live WS closes within existing watcher budget (runbook: 5s poll + 2s DB cap, smoke timeout 8s). Account reset/disable denial demonstrated in deterministic transport fixtures and, where practical, live smoke.
8. Repeat default Mongo runtime without lite selector on real isolated Mongo and existing seeded/enrolled account; demonstrate default branch and auth flow, not just selector parsing.

## Risk Assessment
Mongo skips, nondeterministic real-time TOTP races, leaked fixture credentials, destructive host-action execution, port/state interference. Mitigate with injected clock for permanent boundary tests; isolated HOME/files/ports and disposable accounts for runtime; no production data or actual privileged executor actions.

## Security Considerations
Evidence records status/state transitions, not passwords, TOTP secrets, raw JWTs, MFA key, signing secret or private live DB. Storage failure is denial. No mock/new backdoor to make smoke pass.

## Next steps
Phase 05 updates operator docs only after runtime proof. Qualification failures keep feature pending; no release claim on Windows without native runtime evidence.
