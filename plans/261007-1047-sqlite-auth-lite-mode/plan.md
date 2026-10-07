---
title: "SQLite authentication lite mode"
description: "Add environment-selected SQLite authentication with full parity while retaining MongoDB as default."
status: pending
priority: P2
effort: 24h
branch: feat/sqlite-auth
tags: [feature, backend, auth, database]
created: 2026-10-07
---

# SQLite Authentication Lite Mode

## Overview
Same binary, authenticated **lite mode**, full existing security policy. No MongoDB service required in lite mode; MongoDB remains default when selector is absent/empty/false. Planning only: no source implementation or runtime qualification yet.

Worktree: `/home/loidinh/WS/worktrees/dam-hopper-sqlite-auth`, based on `main` at `8fb97ed8`.

## Confirmed User Decisions
- Runtime lite mode, not separate SQLite-only build.
- Full existing authentication, including MFA/session/role/transport enforcement.
- Fresh independent SQLite accounts/sessions; no data migration.
- Keep all work on the new feature branch/worktree.

## Proposed Environment
```dotenv
DAM_HOPPER_LITE_MODE=true
DAM_HOPPER_AUTH_SQLITE_PATH=/absolute/private/path/auth.db
DAM_HOPPER_MFA_KEY_FILE=/absolute/private/path/mfa-encryption.key
```
Path optional: defaults to `auth.db` in existing global DamHopper config directory. Unset/empty/false/0 lite selector -> MongoDB; true/1 -> SQLite; invalid values -> startup error. Lite mode does not imply `--no-auth`. Preserve existing `.env` precedence; no new CLI/TOML settings. See [contracts](./contracts.md).

## Architecture Decision
Shared async `AuthStore` facade, MongoDB and rusqlite adapters, existing `AuthService`/policy/crypto. Remove production raw MongoDB bypasses and `AppState.db`. Keep shared BSON record types for this same-binary feature; SQLite uses typed columns and explicit conversions. Registration remains disabled-by-default; approval/admin assignment and recovery use checked local operator SQL. No automatic first-user admin.

## Phases
| # | Phase | Status | Progress | Effort | Link |
| --- | --- | --- | --- | --- | --- |
| 01 | Shared store boundary and Mongo adapter | Pending | 0% | 4h | [Phase 01](./phase-01-shared-auth-store.md) |
| 02 | SQLite storage and atomic operations | Pending | 0% | 7h | [Phase 02](./phase-02-sqlite-auth-storage.md) |
| 03 | Environment selection and complete integration | Pending | 0% | 5h | [Phase 03](./phase-03-lite-mode-integration.md) |
| 04 | Security parity and real runtime qualification | Pending | 0% | 6h | [Phase 04](./phase-04-auth-parity-qualification.md) |
| 05 | Operator docs and release notes | Pending | 0% | 2h | [Phase 05](./phase-05-operator-documentation.md) |

Dependencies: 01 -> 02 -> 03 -> 04 -> 05. No phase is implemented, reviewed, or certified by creating this plan. Estimates are planning estimates, not promises.

Phase status after implementation is tracked in the derived overview [progress.md](./progress.md); completion authority is each phase's immutable receipt under `reports/`. Status cells above are captured planning wording.

## Completion Gate
- `.env` lite mode launches authenticated server with SQLite and no MongoDB; default Mongo startup remains unchanged.
- Users, challenges, MFA, sessions, admin/reauth, HTTP/WS/media enforcement share real selected storage; no mock/fallback authorization.
- Exact deadlines, revocation/version changes, concurrent CAS and throttle persistence proven with file-backed SQLite and independent connections.
- Real server enrollment, protected HTTP/WS, restart, logout smoke passes; Mongo regression executes against isolated reachable MongoDB with skips reported.
- Operator approval/recovery/backups and MFA key configuration documented; all affected callers/examples/tests migrate, no obsolete facade accessors.

## References
- [Frozen proposed contracts](./contracts.md), [storage research](./research/auth-storage-contracts.md), [consumer research](./research/auth-integration-map.md)
- [Auth architecture with proposed design](../../docs/architecture/authentication-state-and-cryptography.md)
- [Current auth API](../../docs/api/authentication.md), [environment/recovery](../../docs/configuration/server-environment-auth.md)

## Validation Summary
**Validated:** 2026-10-07. **Questions asked:** 3.

### Confirmed Decisions
- Account approval, administrator roles and MFA reset: documented local SQL; no admin CLI/API expansion.
- Missing SQLite path: global `auth.db` default in existing DamHopper config directory.
- Deployment: one server process per auth file; concurrent requests/operator connections supported. No shared network-file or multi-server deployment qualification.

### Action Items
Validation decisions reflected explicitly in Phases 02–05: global auth.db default, local SQL account operations, one server process per local auth file, and independent-connection CAS tests for concurrent requests/operator writes. Phase 01 shared-store design unchanged.

## Unresolved Questions
None. Implementation remains explicitly unstarted.
