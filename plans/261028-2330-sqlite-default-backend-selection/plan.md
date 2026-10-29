---
title: "SQLite default backend selection and dual production support"
description: "Default unconfigured authenticated startup to SQLite while preserving explicit MongoDB selection and fail-closed configuration."
status: pending
priority: P2
effort: 12h
branch: main
tags: [feature, backend, auth, database]
created: 2026-10-28
---

# SQLite Default Backend Selection and Dual Production Support

## Outcome and authority
Implement selection ergonomics in existing `auth/config.rs` and `main.rs`; both datastores remain independently supported production backends. Source: [approved design](../reports/brainstorm-261028-2330-sqlite-default-backend-selection.md). Planning only; no implementation approval, execution state, or passing checks implied.

**Coordinator refinements supersede conflicting report wording:** set-empty/whitespace Mongo variables are malformed, not absent; only genuinely unset Mongo variables enable automatic SQLite. SQLite single-process ownership is an operational constraint, not a new runtime lock. Preserve warning-and-continue for Mongo index-initialization failures; separately verify connectivity once before accepting Mongo startup.

## Final precedence contract
Selector values trim/case-fold; unset/empty/whitespace selector means automatic. Mongo values must be UTF-8, nonblank when set; trim surrounding whitespace before use. Explicit SQLite ignores Mongo values entirely.

| `DAM_HOPPER_LITE_MODE` | Mongo variables | Outcome |
| --- | --- | --- |
| `true` / `1` | Any, including partial/malformed | SQLite, explicit |
| `false` / `0` | Both set and nonblank | MongoDB, enforced |
| `false` / `0` | Either unset, empty, whitespace, or malformed | Fatal actionable configuration error |
| Unset / empty / whitespace | Both set and nonblank | MongoDB, automatic |
| Unset / empty / whitespace | Both genuinely unset | SQLite, default |
| Unset / empty / whitespace | Any other combination | Fatal actionable configuration error |
| Invalid/non-Unicode selector | Any | Fatal selector error |

Malformed Mongo URI syntax, unreachable hosts, and rejected Mongo connectivity fail startup without creating an SQLite fallback. Index-initialization errors after successful connectivity retain existing warn-and-continue policy; no claim that all index failures are fatal.

## Scope and design boundary
- Resolve once after all dotenv loading; pass resolved Mongo credentials to startup, retain SQLite selection provenance for truthful logs.
- Default SQLite file: `auth.db` under existing global config resolver; Linux default `~/.config/dam-hopper/auth.db`. Preserve XDG/home, override, tilde, relative-path and collision behavior.
- Production: either production environment flag requires valid dedicated `DAM_HOPPER_MFA_KEY_FILE`; SQLite remains one server process per local file, never network/shared storage. MongoDB required for shared multi-node identities.
- `--no-auth`: separate loopback-only development bypass, skips auth selection/storage; forbidden in production.
- No new selector, CLI/TOML backend setting, connection-failure fallback, retries, data migration/synchronization, simultaneous stores, schema/adapter/policy/cryptography changes, or new file-lock mechanism.

## Phases and ownership
| Phase | Deliverable | Status | Effort |
| --- | --- | --- | --- |
| [01](./phase-01-resolver-and-precedence-matrix.md) | Pure resolver, errors, provenance, matrix unit tests | Pending | 3h |
| [02](./phase-02-runtime-startup-wiring.md) | Startup dispatch, Mongo connectivity, existing guards | Pending | 3h |
| [03](./phase-03-integration-and-failure-contract.md) | Process-isolated startup/failure tests; container fixture audit | Pending | 4h |
| [04](./phase-04-documentation-and-environment-examples.md) | Canonical docs/examples/changelog; integrated evidence gate | Pending | 2h |

Dependency graph: `resolve-auth-backend` → `wire-auth-startup` → {`cover-startup-contract`, `audit-container-backends`} → `document-backend-selection` → `qualify-backend-selection`. Sequential phases; no competing writers. Implementer owns source/test edits; docs owner alone writes product docs; coordinator owns integrated checks/review and any execution-state/evidence handling. All durable task records live in linked phases, not this overview.

## Acceptance criteria
1. Clean authenticated development startup opens default SQLite, logs exactly `Authentication backend: SQLite (default — MONGODB_URI not set)` plus structured selection reason, and protects routes (not dev bypass).
2. Complete valid Mongo configuration selects Mongo without selector; explicit false enforces it. Explicit true overrides all Mongo inputs.
3. Invalid selector, partial Mongo configuration, or any set-blank Mongo input outside explicit SQLite exits nonzero with variable-specific guidance and no auth.db fallback.
4. Invalid/unreachable Mongo fails during parsing/connectivity before serving authenticated traffic; never falls back. Existing post-connectivity index warning behavior remains unchanged.
5. Default and explicit production SQLite work with valid key; missing/empty/invalid/unreadable/insecure key fails closed before SQLite creation. Test both production environment flags.
6. SQLite override/default path behavior, session/telemetry collision rejection, permissions, WAL and persistence remain intact; one-process/local-file limits documented.
7. Loopback development `--no-auth` skips backend parsing and auth.db creation even with malformed backend env; production/nonloopback bypass remains rejected.
8. Default/explicit SQLite and Mongo regressions, restart persistence, fixture safety, and updated operator examples have recorded evidence; skips/blockers never count as passes.

## Evidence, compatibility, and rollback
Current source: `server/src/auth/config.rs:49-111`, `server/src/main.rs:549-617,857-861`; container fixture already supplies both Mongo variables (`packages/ui/e2e/fixtures/application-services.ts:224-237`). Current architecture describes warning-only Mongo indexes. Current global resolver (`server/src/config/global.rs:10-18`) does not implement the report's Windows APPDATA claim; preserve implementation, document accurately. Preserve existing bcrypt/MFA behavior, not the report's unsupported Argon2id description.

Related plans: [original SQLite auth](../261007-1047-sqlite-auth-lite-mode/plan.md) and [SQLite E2E](../261007-1933-sqlite-auth-e2e/plan.md) are informational, shipped-source prerequisites with stale pending labels, not imported task blockers. New precedence supersedes their old default-selection prose only. Serialize any live work on shared auth/startup/fixture/docs files; do not edit those plans.

Rollback: stop server; retain SQLite file and MFA key/backups; restore prior binary/config deliberately. For Mongo use both variables and explicit false; for old binaries retaining SQLite use explicit true. Switching backends never transfers identities. No data deletion, release bump, commit, or publication authorized.

## Planning gates and unresolved questions
Local design/source evidence sufficient; no external research needed. Auth architecture read; proposed changes specified here and in phases, not prematurely applied to shipped docs. All four linked phase task fences, exact fields, unique IDs, literal paths, dependency DAG and matching markers inspected against authoring contract; no execution-state hydration. Independent security/configuration review and final validation belong to coordinator and remain pending; this authoring result is not ready-to-code approval. Active-plan setter reported `EVCRATE_SESSION_ID` absent, so session activation did not persist; use this explicit path. No unresolved product questions; runtime qualification remains future work.
